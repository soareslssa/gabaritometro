/**
 * Cronômetro de blocos ("horas líquidas") — a parte que conversa com o
 * navegador. A lógica de tempo mora em src/shared/timer.js e a de presença em
 * src/shared/presence.js.
 *
 * Roda em duas superfícies: no painel do TEC (content script) e na janela do
 * contador (página da extensão). `KIND` distingue as duas sem script inline,
 * que o CSP de página de extensão bloquearia.
 *
 * O bloco é sustentado enquanto QUALQUER superfície estiver visível. Decidir
 * por aba era o defeito antigo: ler um PDF em outra aba deixa a aba do TEC
 * oculta, e o cronômetro morria exatamente no momento em que devia contar.
 *
 * Ociosidade por evento de página só vale no TEC, onde você interage com a
 * página. Na janela do contador, a ausência de `mousemove` numa janela fora de
 * foco não informa nada — manter a regra ali só geraria pausa falsa no meio do
 * estudo. Em troca, deixar a janela aberta e sair de perto conta tempo; o dano
 * é limitado ao alvo do bloco, que `settle` já não deixa estourar.
 */
(() => {
  'use strict';
  const RC = globalThis.RC;
  const T = RC.timer;
  const P = RC.presence;

  const TICK_MS = 1000;
  const KIND = location.protocol === 'chrome-extension:' ? 'counter' : 'tec';
  // Token desta superfície: identifica dono do bloco e entrada de presença.
  const TAB = `${KIND}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let state = null;
  let presence = {};
  let settings = RC.DEFAULT_SETTINGS;
  let lastActivity = Date.now();
  let lastBeat = 0;
  let lastPresenceBeat = 0;
  let ticking = null;
  let booted = false;

  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(state); } catch (_) {} });

  const idleMs = () => Math.max(30, (settings.idleMinutes || 5) * 60) * 1000;
  const visible = () => !document.hidden;

  async function persist(next) {
    state = next;
    await RC.store.setTimer(state);
    emit();
  }

  /**
   * Assume o bloco se ele está órfão — sem dono, ou com um dono que não
   * reporta mais presença (aba fechada). Sem isso, o dono ir para segundo
   * plano deixaria ninguém batendo, e o clamp do batimento cortaria o tempo
   * de quem está estudando.
   */
  function claimIfOrphan(now) {
    if (!state || !state.running) return false;
    const owner = state.owner;
    if (owner === TAB) return true;
    const ownerAlive = owner && P.prune(presence, now)[owner];
    if (!owner || !ownerAlive) {
      state = { ...state, owner: TAB };
      RC.store.setTimer(state);
      return true;
    }
    return false;
  }

  const isOwner = () => !!state && state.owner === TAB;

  /** Settle + crédito + gravação, atômico no storage (ver RC.store.settleTimer). */
  async function settle(reason, closedBlock) {
    const next = await RC.store.settleTimer(Date.now(), reason, closedBlock);
    if (next) {
      state = next;
      emit();
    }
    return next;
  }

  async function pause(reason) {
    if (!state || !state.running) return;
    await settle(reason, false);
  }

  async function resume(auto) {
    if (!state || state.finished) return;
    if (auto && !T.canAutoResume(state)) return;
    const now = Date.now();
    lastActivity = now;
    lastBeat = now;
    await persist(T.resume(state, now, TAB));
  }

  async function finish() {
    const before = state;
    const next = await settle(null, true);
    chrome.runtime
      .sendMessage({
        type: 'rc:blockFinished',
        minutes: Math.round(((next || before).blockMs || 0) / 60000),
        materia: T.dominantMateria(next || before),
      })
      .catch(() => {});
  }

  // ---- laço principal -----------------------------------------------------
  async function tick() {
    const now = Date.now();

    // Presença primeiro: é o que sustenta o bloco para as outras superfícies.
    if (now - lastPresenceBeat >= P.BEAT_MS) {
      lastPresenceBeat = now;
      presence = await RC.store.touchPresence(TAB, KIND, visible());
    }

    if (!state || !state.running) return;
    if (!claimIfOrphan(now) && !isOwner()) return;

    if (T.isFinished(state, now)) {
      await finish();
      return;
    }

    // Ninguém visível em nenhuma superfície: ninguém está estudando.
    if (!P.anyVisible(presence, now)) {
      await pause('hidden');
      return;
    }

    // Ociosidade só faz sentido onde você interage com a página.
    if (KIND === 'tec' && visible() && now - lastActivity > idleMs()) {
      await pause('idle');
      return;
    }

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
      if (state && !state.running && state.pausedReason === 'idle' && visible()) resume(true);
    };
  })();

  ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, noteActivity, { passive: true, capture: true })
  );

  document.addEventListener('visibilitychange', async () => {
    if (!booted) return;
    const now = Date.now();
    presence = await RC.store.touchPresence(TAB, KIND, visible());

    if (!visible()) {
      // Só pausa se mais ninguém estiver sustentando o bloco.
      if (!P.anyVisible(presence, now)) await pause('hidden');
      return;
    }
    lastActivity = now;
    await resume(true);
  });

  // Navegar dentro do TEC recarrega a página: some da presença e grava o que deve.
  window.addEventListener('pagehide', () => {
    RC.store.touchPresence(TAB, KIND, false);
    if (!state || !state.running) return;
    // pagehide não espera promise; dispara e o storage conclui.
    RC.store.settleTimer(Date.now(), 'hidden', false);
  });

  // ---- API usada pelas superfícies ---------------------------------------
  RC.clock = {
    KIND,
    get state() {
      return state;
    },
    get presence() {
      return presence;
    },
    onChange: (fn) => listeners.add(fn),

    async start(minutes) {
      const now = Date.now();
      const fresh = T.create(Math.max(1, minutes) * 60000, now, RC.dayKey(now));
      fresh.committedMs = 0;
      presence = await RC.store.touchPresence(TAB, KIND, visible());
      await persist(T.resume(fresh, now, TAB));
    },

    async toggle() {
      if (!state) return;
      if (state.running) await pause('user');
      else await resume(false);
    },

    /** Encerra o bloco antes da hora, creditando o que já foi feito. */
    async stop() {
      if (!state) return;
      await settle(null, true);
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
    presence = await RC.store.touchPresence(TAB, KIND, visible());
    const stored = await RC.store.getTimer();

    if (stored) {
      // Ficou `running` no storage: ou a página recarregou, ou o navegador
      // morreu. settleTimer aplica o teto do batimento e credita só o tempo
      // que existiu de fato.
      state = stored;
      if (stored.running && !P.anyVisibleExcept(presence, TAB, Date.now())) {
        state = (await RC.store.settleTimer(Date.now(), 'hidden', false)) || stored;
      }
    }

    booted = true;
    startTicking();
    emit();

    if (state && visible()) resume(true);
  })();

  // Outra superfície mexeu no bloco: reflete sem esperar o próximo tique.
  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes[RC.KEYS.timer]) {
      state = changes[RC.KEYS.timer].newValue || null;
      emit();
    }
    if (changes[RC.KEYS.presence]) presence = changes[RC.KEYS.presence].newValue || {};
  });
})();
