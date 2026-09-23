/**
 * Content script isolado: recebe os eventos do hook Angular (MAIN world),
 * grava no chrome.storage e expõe RC.bridge para o painel.
 */
(() => {
  'use strict';
  const RC = globalThis.RC;
  const TAG = 'RC_TEC';

  const state = {
    auto: false, // hook Angular vivo?
    current: null, // snapshot da questão na tela
    openedAt: 0,
    guessArmed: false, // "chutei" marcado antes de responder
    lastSavedId: null, // id normalizado do último registro gravado
    simulado: null,
  };
  RC.bridge = state;

  const listeners = new Set();
  RC.bridge.onChange = (fn) => listeners.add(fn);
  const emit = (evt) => listeners.forEach((fn) => { try { fn(evt); } catch (_) {} });

  async function save(snap, source, secondsOverride) {
    const seconds = Number.isFinite(secondsOverride) ? secondsOverride : snap.seconds;
    const correct = source === 'manual' ? snap.manualCorrect : snap.result === true;
    const anulada = snap.result === 'anulada' || snap.manualCorrect === null;
    const inSimulado = !!(state.simulado && state.simulado.active);

    // Registro manual sem questão na tela precisa de chave única própria.
    const idQuestao =
      snap && snap.idQuestao ? snap.idQuestao : `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const res = await RC.store.record({
      idQuestao,
      origin: 'tec',
      correct,
      anulada,
      materia: snap.materia,
      assunto: snap.assunto,
      banca: snap.banca,
      orgao: snap.orgao,
      ano: snap.ano,
      caderno: snap.caderno,
      idCaderno: snap.idCaderno,
      seconds,
      url: snap.url || location.href,
      source,
      guessed: state.guessArmed,
      simulado: inSimulado,
    });

    if (res.saved) {
      // O id vem de quem gravou. Remontá-lo aqui já quebrou o chute retroativo
      // em registros manuais, que viravam "tec:undefined" e sumiam.
      state.lastSavedId = res.id;
      state.list = res.list || state.list;
      chrome.runtime.sendMessage({ type: 'rc:recorded' }).catch(() => {});
      if (inSimulado) {
        state.simulado = await RC.store.pushSimulado(state.lastSavedId, anulada ? null : correct, seconds);
        emit({ kind: 'simulado', session: state.simulado });
      }
    }
    emit({ kind: 'saved', result: res, guessed: state.guessArmed });
    state.guessArmed = false;
    return res;
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__rc !== TAG) return;
    const { type, payload } = ev.data;

    if (type === 'ready') {
      state.auto = true;
      emit({ kind: 'mode', auto: true });
      return;
    }
    if (type === 'degraded') {
      state.auto = false;
      emit({ kind: 'mode', auto: false });
      return;
    }
    if (type === 'question' || type === 'snapshot') {
      if (!payload) return;
      state.current = payload;
      state.openedAt = Date.now();
      state.guessArmed = false;
      state.lastSavedId = null;
      emit({ kind: 'question', snap: payload });
      return;
    }
    if (type === 'answered') {
      state.current = payload;
      save(payload, 'auto');
    }
  });

  /** Usado pelos botões Acertei/Errei/Anular do painel. */
  RC.bridge.manual = function (correct) {
    const base = state.current || {};
    const seconds = state.openedAt ? (Date.now() - state.openedAt) / 1000 : null;
    return save({ ...base, manualCorrect: correct }, 'manual', seconds);
  };

  /**
   * "Chutei". Antes de responder, arma a marcação. Depois de responder,
   * aplica retroativamente no registro que acabou de ser gravado — assim
   * você não precisa lembrar de clicar antes.
   */
  RC.bridge.toggleGuess = async function () {
    if (state.lastSavedId) {
      const cur = state.guessArmed;
      const r = await RC.store.setGuess(state.lastSavedId, !cur);
      state.guessArmed = r.attempt ? !!r.attempt.guessed : !cur;
      emit({ kind: 'guess', armed: state.guessArmed, retro: true });
      return state.guessArmed;
    }
    state.guessArmed = !state.guessArmed;
    emit({ kind: 'guess', armed: state.guessArmed, retro: false });
    return state.guessArmed;
  };

  RC.bridge.undo = async function () {
    const r = await RC.store.undoLast();
    state.lastSavedId = null;
    chrome.runtime.sendMessage({ type: 'rc:recorded' }).catch(() => {});
    emit({ kind: 'saved', result: { saved: true, reason: 'undo' } });
    return r;
  };

  // ---- modo simulado ------------------------------------------------------
  RC.bridge.startSimulado = async function (size) {
    state.simulado = await RC.store.startSimulado(size);
    emit({ kind: 'simulado', session: state.simulado });
    return state.simulado;
  };

  RC.bridge.stopSimulado = async function () {
    state.simulado = await RC.store.stopSimulado();
    emit({ kind: 'simulado', session: state.simulado });
    return state.simulado;
  };

  RC.bridge.clearSimulado = async function () {
    await RC.store.clearSimulado();
    state.simulado = null;
    emit({ kind: 'simulado', session: null });
  };

  RC.bridge.requestSnapshot = function () {
    window.postMessage({ __rc: TAG + '_REQ', type: 'snapshot' }, location.origin);
  };

  // ---- lista em curso -----------------------------------------------------
  /**
   * Abre uma lista pelo painel do TEC. Sem matéria/assunto: o TEC traz esses
   * dados por questão, e `record()` só herda o que vier vazio.
   */
  RC.bridge.startList = async function () {
    const cur = state.current || {};
    state.list = await RC.store.startList({ origin: 'tec', name: cur.caderno || null });
    emit({ kind: 'list', list: state.list });
    return state.list;
  };

  RC.bridge.finishList = async function () {
    state.list = await RC.store.finishList();
    emit({ kind: 'list', list: state.list });
    return state.list;
  };

  RC.bridge.clearList = async function () {
    await RC.store.clearList();
    state.list = null;
    emit({ kind: 'list', list: null });
  };

  (async () => {
    state.simulado = await RC.store.getSimulado();
    if (state.simulado) emit({ kind: 'simulado', session: state.simulado });
    state.list = await RC.store.getList();
    emit({ kind: 'list', list: state.list });
  })();

  // Se em 4s o Angular não apareceu, avisa o painel pra mostrar modo manual.
  setTimeout(() => {
    if (!state.auto) emit({ kind: 'mode', auto: false });
  }, 4000);
})();
