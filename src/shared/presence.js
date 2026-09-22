/**
 * Registro de presença das superfícies da extensão (aba do TEC, janela do
 * contador). Lógica pura, sem I/O e sem DOM — o "agora" entra por parâmetro.
 *
 * Existe porque a decisão de pausar o cronômetro não pode ser por aba: ler um
 * PDF em outra aba deixa a aba do TEC oculta, e o bloco não deve cair por isso
 * se a janela do contador está visível sustentando o estudo.
 */
(function (root) {
  const RC = (root.RC = root.RC || {});

  // Presença vale por 15s: três batimentos de 5s de folga antes de considerar
  // que a superfície morreu (aba fechada, navegador encerrado).
  const TTL_MS = 15000;
  const BEAT_MS = 5000;

  RC.presence = {
    TTL_MS,
    BEAT_MS,

    /** Marca (ou apaga, com visible=false) a presença de uma superfície. */
    touch(reg, token, kind, visible, now) {
      const next = { ...(reg || {}) };
      if (visible) next[token] = { at: now, kind, visible: true };
      else delete next[token];
      return RC.presence.prune(next, now);
    },

    /** Remove entradas vencidas: superfície que não bate mais não sustenta nada. */
    prune(reg, now, ttl) {
      const limit = ttl || TTL_MS;
      const out = {};
      for (const [token, p] of Object.entries(reg || {})) {
        if (p && p.visible && now - p.at <= limit) out[token] = p;
      }
      return out;
    },

    /** Alguma superfície visível e viva? É isso que sustenta o bloco. */
    anyVisible(reg, now, ttl) {
      return Object.keys(RC.presence.prune(reg, now, ttl)).length > 0;
    },

    /** Idem, mas ignorando uma superfície — "além de mim, tem mais alguém?" */
    anyVisibleExcept(reg, token, now, ttl) {
      const pruned = RC.presence.prune(reg, now, ttl);
      delete pruned[token];
      return Object.keys(pruned).length > 0;
    },

    kinds(reg, now, ttl) {
      return [...new Set(Object.values(RC.presence.prune(reg, now, ttl)).map((p) => p.kind))].sort();
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
