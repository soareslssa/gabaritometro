/**
 * Roda no MAIN world (mesmo contexto JS da página) para ler o estado do
 * AngularJS do TEC Concursos. É a fonte autoritativa: o objeto `vm.questao`
 * já contém idQuestao, correcaoQuestao (acertou/errou), anulada, matéria,
 * assunto, banca, órgão e ano — nada de adivinhar classe CSS.
 *
 * Não modifica nada da página. Só lê e manda window.postMessage para o
 * content script isolado, que é quem tem acesso ao chrome.storage.
 *
 * Fallback: se o Angular sumir (reescrita do site), avisa o painel, que
 * passa a operar no modo manual.
 */
(() => {
  'use strict';

  const TAG = 'RC_TEC';
  const POLL_MS = 400;

  const post = (type, payload) => {
    try {
      window.postMessage({ __rc: TAG, type, payload }, window.location.origin);
    } catch (_) {
      /* noop */
    }
  };

  /**
   * Acha o scope que tem `vm.questao`. Os ids do TEC mudam menos que as
   * classes, mas ainda assim varremos vários candidatos e, em último caso,
   * o DOM inteiro (uma vez só, com cache).
   */
  let cachedEl = null;
  const CANDIDATES = [
    '#label-alternativa-0',
    '#questao-directive',
    '#ancoraQuestao',
    '#questao-desempenho-directive',
    '[id^="label-alternativa-"]',
  ];

  function scopeWithVm(el) {
    if (!el || !window.angular) return null;
    let sc = null;
    try {
      const ng = window.angular.element(el);
      sc = (ng.isolateScope && ng.isolateScope()) || ng.scope();
    } catch (_) {
      return null;
    }
    let guard = 0;
    while (sc && guard++ < 12) {
      if (sc.vm && sc.vm.questao) return sc;
      sc = sc.$parent;
    }
    return null;
  }

  function findScope() {
    if (cachedEl && document.contains(cachedEl)) {
      const sc = scopeWithVm(cachedEl);
      if (sc) return sc;
    }
    for (const sel of CANDIDATES) {
      const el = document.querySelector(sel);
      const sc = scopeWithVm(el);
      if (sc) {
        cachedEl = el;
        return sc;
      }
    }
    // Varredura ampla, só quando os atalhos falharem.
    if (window.angular) {
      const all = document.querySelectorAll('[ng-controller], [id], [class]');
      for (let i = 0; i < all.length; i += 1) {
        const sc = scopeWithVm(all[i]);
        if (sc) {
          cachedEl = all[i];
          return sc;
        }
      }
    }
    return null;
  }

  /** true acertou | false errou | null ainda não respondeu */
  function resultOf(q) {
    if (q.anulada === true) return 'anulada';
    if (q.correcaoQuestao === true) return true;
    if (q.correcaoQuestao === false) return false;
    return null;
  }

  function snapshot(sc) {
    const q = sc.vm.questao || {};
    const cad = sc.vm.caderno || {};
    return {
      idQuestao: q.idQuestao,
      result: resultOf(q),
      materia: q.nomeMateria || null,
      assunto: q.nomeAssunto || null,
      idMateria: q.idMateria || null,
      idAssunto: q.idAssunto || null,
      banca: q.bancaSigla || null,
      orgao: q.orgaoSigla || null,
      ano: q.concursoAno || null,
      tipo: q.tipoQuestao || null,
      selecionada: q.alternativaSelecionada,
      correta: q.numeroAlternativaCorreta,
      idCaderno: cad.idCaderno || null,
      caderno: cad.nome || null,
      cadernoResolvidas: cad.numeroQuestoesResolvidas,
      cadernoAcertos: cad.numeroAcertos,
      cadernoAnuladas: cad.numeroAnuladas,
      cadernoTotal: cad.numeroTotalQuestoes,
      url: location.href,
    };
  }

  // ---- máquina de estado --------------------------------------------------
  let lastId = null;
  let lastResult = null;
  let openedAt = 0; // quando a questão atual apareceu na tela
  let angularSeen = false;
  let warned = false;

  function tick() {
    let sc;
    try {
      sc = findScope();
    } catch (_) {
      sc = null;
    }

    if (!sc) {
      if (angularSeen && !warned) {
        warned = true;
        post('degraded', { reason: 'scope-lost' });
      }
      return;
    }
    if (!angularSeen) {
      angularSeen = true;
      post('ready', {});
    }

    let s;
    try {
      s = snapshot(sc);
    } catch (_) {
      return;
    }
    if (!s.idQuestao) return;

    if (s.idQuestao !== lastId) {
      // Trocou de questão: reinicia o cronômetro e o estado.
      lastId = s.idQuestao;
      lastResult = s.result;
      openedAt = Date.now();
      post('question', s);
      return;
    }

    // Mesma questão: só interessa a transição "sem resposta" -> "respondida".
    if (s.result !== lastResult) {
      const wasUnanswered = lastResult === null;
      lastResult = s.result;
      if (s.result !== null) {
        post('answered', {
          ...s,
          seconds: wasUnanswered && openedAt ? (Date.now() - openedAt) / 1000 : null,
        });
      }
    }
  }

  /**
   * O polling já cobre tudo, mas observar o XHR faz a captura ser instantânea
   * (o Angular só repinta depois da resposta da API). Apenas observa — não
   * altera request, response nem headers.
   */
  function hookXHR() {
    const XHR = window.XMLHttpRequest;
    if (!XHR || XHR.prototype.__rcHooked) return;
    const open = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      try {
        this.__rcUrl = String(url || '');
        this.__rcMethod = String(method || '').toUpperCase();
      } catch (_) {
        /* noop */
      }
      return open.apply(this, arguments);
    };
    const send = XHR.prototype.send;
    XHR.prototype.send = function () {
      try {
        const u = this.__rcUrl || '';
        if (this.__rcMethod !== 'GET' && /\/api\//.test(u) && /resol|questao|questoes/i.test(u)) {
          this.addEventListener('loadend', () => {
            // Dá um respiro pro Angular aplicar o resultado no scope.
            setTimeout(tick, 60);
            setTimeout(tick, 350);
          });
        }
      } catch (_) {
        /* noop */
      }
      return send.apply(this, arguments);
    };
    XHR.prototype.__rcHooked = true;
  }

  try {
    hookXHR();
  } catch (_) {
    /* noop */
  }

  setInterval(tick, POLL_MS);
  tick();

  // Responde a pedidos de estado vindos do painel (ex.: sincronizar caderno).
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__rc !== TAG + '_REQ') return;
    if (ev.data.type === 'snapshot') {
      const sc = findScope();
      post('snapshot', sc ? snapshot(sc) : null);
    }
  });
})();
