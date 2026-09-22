/**
 * Lógica pura do cronômetro de blocos ("horas líquidas").
 * Sem I/O, sem DOM, sem Date.now() implícito — o agora sempre entra por
 * parâmetro. É isso que deixa o comportamento testável sem esperar tempo real.
 *
 * Invariante central: o tempo creditado NUNCA pode passar do último batimento
 * conhecido + tolerância. Sem esse limite, um Chrome morto durante a noite
 * viraria 8 horas de estudo no dia seguinte.
 */
(function (root) {
  const RC = (root.RC = root.RC || {});

  const HEARTBEAT_MS = 5000;
  // Tolerância = um batimento perdido + folga pra thread ocupada.
  const GRACE_MS = HEARTBEAT_MS + 2000;

  // Teto de duração de bloco. Existe porque `settle` limita o crédito ao alvo:
  // um alvo absurdo (digitar 99999 por engano) viraria um bloco que nunca fecha
  // e acumularia tempo fantasma até alguém notar.
  const MAX_MINUTES = 600;

  RC.timer = {
    HEARTBEAT_MS,
    GRACE_MS,
    MAX_MINUTES,

    /**
     * Interpreta o que um campo de texto realmente entrega.
     * Devolve inteiro de 1 a MAX_MINUTES, ou null quando não dá para usar.
     */
    normalizeMinutes(value) {
      if (value == null) return null;
      const raw = String(value).trim().replace(',', '.'); // teclado brasileiro
      if (!raw) return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      const rounded = Math.round(n);
      if (rounded < 1) return null;
      return Math.min(rounded, MAX_MINUTES);
    },

    create(blockMs, now, day) {
      return {
        running: false,
        pausedReason: null, // 'user' | 'hidden' | 'idle' | null
        blockMs,
        accumulatedMs: 0,
        startedAt: null,
        heartbeatAt: now,
        materiaCount: {},
        owner: null,
        day: day || RC.dayKey(now),
        finished: false,
        createdAt: now,
      };
    },

    /**
     * Quanto vale o trecho em curso. Limitado pelo último batimento: se o
     * navegador morreu, `heartbeatAt` parou de avançar e o crédito para junto.
     */
    segmentMs(s, now) {
      if (!s || !s.running || !s.startedAt) return 0;
      const ceiling = (s.heartbeatAt || s.startedAt) + GRACE_MS;
      return Math.max(0, Math.min(now, ceiling) - s.startedAt);
    },

    /** Tempo líquido total do bloco, incluindo o trecho em curso. */
    elapsedMs(s, now) {
      if (!s) return 0;
      return Math.min(s.accumulatedMs + RC.timer.segmentMs(s, now), s.blockMs);
    },

    remainingMs(s, now) {
      return Math.max(0, s.blockMs - RC.timer.elapsedMs(s, now));
    },

    /**
     * Fecha o trecho em curso, incorporando-o ao acumulado. Idempotente.
     * Limita no alvo do bloco: um bloco de 45 min jamais credita 46. O tick
     * fecha em ~1s, mas se a máquina hibernar no meio o excedente seria real.
     */
    settle(s, now) {
      if (!s) return s;
      const add = RC.timer.segmentMs(s, now);
      const accumulatedMs = Math.min(s.accumulatedMs + add, s.blockMs);
      return {
        ...s,
        accumulatedMs,
        startedAt: null,
        running: false,
        finished: s.finished || accumulatedMs >= s.blockMs,
      };
    },

    resume(s, now, owner) {
      if (!s || s.finished) return s;
      const base = s.running ? RC.timer.settle(s, now) : s;
      if (base.accumulatedMs >= base.blockMs) {
        return { ...base, finished: true, running: false, startedAt: null };
      }
      return {
        ...base,
        running: true,
        pausedReason: null,
        startedAt: now,
        heartbeatAt: now,
        owner: owner || base.owner,
      };
    },

    pause(s, now, reason) {
      if (!s) return s;
      const settled = RC.timer.settle(s, now);
      return { ...settled, pausedReason: reason || 'user' };
    },

    /** Batimento: só faz sentido enquanto roda. */
    beat(s, now) {
      if (!s || !s.running) return s;
      return { ...s, heartbeatAt: now };
    },

    isFinished(s, now) {
      if (!s) return false;
      return s.finished || s.accumulatedMs + RC.timer.segmentMs(s, now) >= s.blockMs;
    },

    /**
     * Retomada automática só vale se a pausa também foi automática.
     * Pausa feita pelo usuário tem que sobreviver a trocar de aba.
     */
    canAutoResume(s) {
      return !!s && !s.finished && !s.running && s.pausedReason !== 'user';
    },

    /**
     * Rótulo de estado do bloco. Fica aqui porque três superfícies (painel do
     * TEC, janela do contador, popup) mostram a mesma coisa — duplicar o texto
     * é como elas passam a divergir.
     */
    label(s, now) {
      if (!s) return { kind: 'none', text: 'nenhum bloco em curso' };
      if (s.finished) {
        return { kind: 'done', text: `bloco concluído — ${RC.fmtHours(RC.timer.elapsedMs(s, now))}` };
      }
      if (s.running) {
        return { kind: 'running', text: `faltam ${RC.fmtClock(RC.timer.remainingMs(s, now))}` };
      }
      const why = {
        user: 'pausado por você',
        hidden: 'pausado — nenhuma janela visível',
        idle: 'pausado — sem atividade',
      };
      return { kind: 'paused', text: why[s.pausedReason] || 'pausado' };
    },

    countMateria(s, materia) {
      if (!s || !materia) return s;
      const materiaCount = { ...s.materiaCount, [materia]: (s.materiaCount[materia] || 0) + 1 };
      return { ...s, materiaCount };
    },

    /** Matéria com mais questões no bloco. Empate resolvido alfabeticamente. */
    dominantMateria(s) {
      if (!s || !s.materiaCount) return null;
      const entries = Object.entries(s.materiaCount);
      if (!entries.length) return null;
      entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return entries[0][0];
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
