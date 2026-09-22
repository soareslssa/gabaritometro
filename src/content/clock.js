/**
 * Cronômetro de blocos ("horas líquidas") — a parte que conversa com o
 * navegador. A lógica de tempo em si mora em src/shared/timer.js.
 *
 * Pausa sozinho quando:
 *   - a aba fica oculta (troca de aba, minimizar, bloquear a tela)
 *   - você fica N minutos sem mouse/teclado/scroll
 *   - a página é descarregada (navegar no TEC é reload completo)
 * Retoma sozinho ao voltar — exceto se a pausa tiver sido sua, no botão.
 *
 * Não pausa por perda de foco com a janela ainda visível: estudar com um PDF
 * aberto ao lado é uso normal, e pausar aí tornaria o número inútil.
 */
(() => {
  'use strict';
  const RC = globalThis.RC;
  const T = RC.timer;

  const TICK_MS = 1000;
  // Token desta aba: evita que duas janelas do TEC contem o mesmo tempo duas vezes.
  const TAB = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let state = null;
  let settings = RC.DEFAULT_SETTINGS;
  let lastActivity = Date.now();
  let lastBeat = 0;
  let ticking = null;
  let booted = false;

  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(state); } catch (_) {} });

  const idleMs = () => Math.max(30, (settings.idleMinutes || 5) * 60) * 1000;
  const isOwner = () => !state || !state.owner || state.owner === TAB;

  async function persist(next) {
    state = next;
    await RC.store.setTimer(state);
    emit();
  }

  /**
   * Credita o tempo acumulado no histórico e zera o acumulador do bloco.
   * Chamado ao pausar, ao fechar a página e ao encerrar o bloco — por isso
   * precisa ser idempotente: o que já foi creditado sai do acumulado.
   */
  async function flush(closedBlock) {
    if (!state) return;
    const settled = T.settle(state, Date.now());
    const pending = settled.accumulatedMs - (settled.committedMs || 0);
    if (pending > 0) {
      await RC.store.commitTime(settled.day, T.dominantMateria(settled), pending, !!closedBlock);
      settled.committedMs = settled.accumulatedMs;
    }
    return settled;
  }

  async function pause(reason) {
    if (!state || !state.running) return;
    const settled = await flush(false);
    await persist({ ...settled, pausedReason: reason });
  }

  async function resume(auto) {
    if (!state || state.finished) return;
    if (auto && !T.canAutoResume(state)) return;
    lastActivity = Date.now();
    await persist(T.resume(state, Date.now(), TAB));
  }

  async function finish() {
    const settled = await flush(true);
    const materia = T.dominantMateria(settled);
    await persist({ ...settled, running: false, finished: true, pausedReason: null });
    chrome.runtime
      .sendMessage({
        type: 'rc:blockFinished',
        minutes: Math.round(settled.blockMs / 60000),
        materia,
      })
      .catch(() => {});
  }

  // ---- laço principal -----------------------------------------------------
  async function tick() {
    if (!state || !state.running || !isOwner()) return;
    const now = Date.now();

    if (T.isFinished(state, now)) {
      await finish();
      return;
    }
    if (now - lastActivity > idleMs()) {
      await pause('idle');
      return;
    }
    // Batimento: é ele que limita o crédito se o navegador morrer de repente.
    if (now - lastBeat >= T.HEARTBEAT_MS) {
      lastBeat = now;
      state = T.beat(state, now);
      RC.store.setTimer(state);
    }
    emit();
  }

  function startTicking() {
    if (ticking) return;
    ticking = setInterval(tick, TICK_MS);
  }

  // ---- eventos do navegador ----------------------------------------------
  const noteActivity = (() => {
    let throttled = false;
    return () => {
      lastActivity = Date.now();
      if (throttled) return;
      throttled = true;
      setTimeout(() => (throttled = false), 1000);
      // Voltou a mexer depois de uma pausa por ociosidade: retoma sozinho.
      if (state && !state.running && state.pausedReason === 'idle' && !document.hidden) resume(true);
    };
  })();

  ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, noteActivity, { passive: true, capture: true })
  );

  document.addEventListener('visibilitychange', () => {
    if (!booted) return;
    if (document.hidden) pause('hidden');
    else {
      lastActivity = Date.now();
      resume(true);
    }
  });

  // Navegar dentro do TEC recarrega a página: grava antes de sair.
  window.addEventListener('pagehide', () => {
    if (!state || !state.running) return;
    const settled = T.settle(state, Date.now());
    const pending = settled.accumulatedMs - (settled.committedMs || 0);
    settled.pausedReason = 'hidden';
    // pagehide não espera promise; o set é disparado e o SW conclui.
    if (pending > 0) RC.store.commitTime(settled.day, T.dominantMateria(settled), pending, false);
    settled.committedMs = settled.accumulatedMs;
    RC.store.setTimer(settled);
  });

  // ---- API usada pelo painel ---------------------------------------------
  RC.clock = {
    get state() {
      return state;
    },
    onChange: (fn) => listeners.add(fn),

    async start(minutes) {
      const now = Date.now();
      const fresh = T.create(Math.max(1, minutes) * 60000, now, RC.dayKey(now));
      fresh.committedMs = 0;
      await persist(T.resume(fresh, now, TAB));
      lastActivity = now;
      lastBeat = now;
    },

    async toggle() {
      if (!state) return;
      if (state.running) await pause('user');
      else await resume(false);
    },

    /** Encerra o bloco antes da hora, creditando o que já foi feito. */
    async stop() {
      if (!state) return;
      const settled = await flush(true);
      await persist({ ...settled, running: false, finished: true, pausedReason: null });
    },

    async dismiss() {
      await RC.store.clearTimer();
      state = null;
      emit();
    },

    /** Contabiliza a matéria da questão atual, pra eleger a dominante do bloco. */
    noteMateria(materia) {
      if (!state || !state.running || !materia) return;
      state = T.countMateria(state, materia);
      RC.store.setTimer(state);
    },
  };

  // ---- boot ---------------------------------------------------------------
  (async () => {
    settings = await RC.store.getSettings();
    const stored = await RC.store.getTimer();

    if (stored) {
      // Se ficou `running` no storage, ou a página foi recarregada ou o
      // navegador morreu. settle() aplica o teto do batimento e devolve
      // só o tempo que realmente existiu.
      state = stored.running ? T.settle(stored, Date.now()) : stored;
      if (stored.running) {
        state.pausedReason = 'hidden';
        await flush(false);
        await RC.store.setTimer(state);
      }
    }

    booted = true;
    startTicking();
    emit();

    // Retoma sozinho se a aba está visível e a pausa não foi sua.
    if (state && !document.hidden) resume(true);
  })();
})();
