/**
 * Modo simulado: esconde o gabarito enquanto o bloco de questões está em curso.
 *
 * Como isso foi descoberto (importa pra quem for mexer depois):
 * a alternativa correta recebe `li.acerto`, pintada de verde. Essa cor NÃO é
 * sobrescrevível — medido na página real, nem regra com 3 ids e `!important`,
 * nem `style` inline com `!important` alteram o background-color dela, embora
 * outras propriedades da mesma regra (outline, border) apliquem normalmente.
 *
 * Então não brigamos com a cor: quando a questão já foi respondida dentro de um
 * simulado, escondemos a lista de alternativas inteira com `display:none` — que
 * foi verificado funcionar e reverter sem reload. Esconder a lista toda (e não
 * só a alternativa marcada) é proposital: apagar só a certa entregaria a
 * resposta pela ausência.
 *
 * Só CSS, nada de mexer no DOM do Angular — ele repintaria por cima.
 */
(() => {
  'use strict';
  const RC = globalThis.RC;
  const STYLE_ID = 'rc-simulado-style';
  const ON = 'rc-simulado';
  const ANSWERED = 'rc-simulado-respondida';

  const CSS = `
  /* Enquanto o simulado roda, some com o placar corrente do caderno. */
  html.${ON} .questao-cabecalho-acertos { display: none !important; }

  /* Depois de responder: esconde alternativas, veredito e comentários. */
  html.${ON}.${ANSWERED} .questao-enunciado-alternativas,
  html.${ON}.${ANSWERED} [class*="questao-enunciado-resolucao"],
  html.${ON}.${ANSWERED} #questao-comentario-directive,
  html.${ON}.${ANSWERED} #questao-discussao-directive,
  html.${ON}.${ANSWERED} #questao-desempenho-directive {
    display: none !important;
  }`;

  function ensureStyle() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    }
    return el;
  }

  let active = false;

  RC.simulado = {
    /** Liga/desliga o modo. Ao desligar, limpa as duas classes. */
    apply(on) {
      ensureStyle();
      active = !!on;
      const cl = document.documentElement.classList;
      cl.toggle(ON, active);
      if (!active) cl.remove(ANSWERED);
    },

    /** Marca se a questão na tela já foi respondida (aí o gabarito some). */
    setAnswered(answered) {
      if (!active) return;
      document.documentElement.classList.toggle(ANSWERED, !!answered);
    },
  };
})();
