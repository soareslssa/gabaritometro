/**
 * Formato dos dados e helpers puros, sem I/O.
 * Carregado como script clássico (content script, popup, options) e via import
 * dinâmico no service worker — por isso expõe tudo em globalThis.RC.
 */
(function (root) {
  const RC = (root.RC = root.RC || {});

  RC.SCHEMA_VERSION = 1;

  RC.KEYS = {
    version: 'rc_version',
    attempts: 'rc_attempts',
    days: 'rc_days',
    subjects: 'rc_subjects',
    settings: 'rc_settings',
    streak: 'rc_streak',
    simulado: 'rc_simulado',
    timer: 'rc_timer',
    time: 'rc_time',
    list: 'rc_list',
    presence: 'rc_presence',
  };

  /** Lista de questões em curso (um agrupamento que você abre e fecha). */
  RC.emptyList = function (info, now) {
    return {
      id: `L${(now || Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      origin: info.origin || 'pdf',
      materia: info.materia || null,
      assunto: info.assunto || null,
      banca: info.banca || null,
      name: info.name || null,
      startedAt: now || Date.now(),
      finishedAt: null,
      total: 0,
      hits: 0,
      misses: 0,
      voids: 0,
      seconds: 0,
      n: 0, // ordinal do próximo registro, pra compor ids únicos
    };
  };

  /** Aplica (sign=-1 desfaz) um registro nos contadores da lista. */
  RC.applyToList = function (list, a, sign) {
    const s = sign || 1;
    list.total += s;
    if (a.correct === true) list.hits += s;
    else if (a.correct === false) list.misses += s;
    else list.voids += s;
    if (Number.isFinite(a.seconds)) list.seconds += s * a.seconds;
    return list;
  };

  /** Teto de registros individuais guardados. Os agregados nunca são podados. */
  RC.MAX_ATTEMPTS = 20000;

  RC.DEFAULT_SETTINGS = {
    dailyGoal: 50,
    slowThresholdSec: 180,
    panelEnabled: true,
    minQuestionsPerSubject: 5, // amostra mínima pra ranquear uma disciplina
    countMode: 'first', // 'first' = 1ª resposta do dia vale | 'last' = última sobrescreve
    simuladoSize: 20, // questões por bloco no modo simulado
    blockPresets: [45, 56, 75], // durações de bloco, em minutos
    blockMinutes: 45, // preset selecionado
    idleMinutes: 5, // sem mouse/teclado por isso => pausa automática
  };

  /** "YYYY-MM-DD" no fuso local (não UTC — o dia de estudo é o dia do usuário). */
  RC.dayKey = function (ts) {
    const d = ts == null ? new Date() : new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  RC.dayKeyOffset = function (dayStr, deltaDays) {
    const [y, m, d] = dayStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaDays);
    return RC.dayKey(dt.getTime());
  };

  /** Chave de deduplicação: mesma questão, mesmo dia, conta uma vez. */
  RC.attemptKey = function (a) {
    return `${a.id}@${RC.dayKey(a.ts)}`;
  };

  RC.subjectKey = function (a) {
    return `${a.materia || '—'}||${a.assunto || '—'}`;
  };

  /** Normaliza o objeto vindo do hook Angular para o registro que persistimos. */
  RC.normalize = function (raw) {
    const correct = raw.anulada ? null : raw.correct === true;
    const origin = raw.origin || 'tec';
    return {
      // Id pronto tem precedência: quem cria o registro é dono da chave, em vez
      // de remontá-la por fora e arriscar divergir (foi assim que o "chutei"
      // retroativo quebrou em silêncio para registros manuais).
      id: raw.id || `${origin}:${raw.idQuestao}`,
      origin, // 'tec' | 'pdf'
      listId: raw.listId || null,
      ts: raw.ts || Date.now(),
      correct, // true | false | null (anulada)
      source: raw.source || 'auto',
      materia: raw.materia || null,
      assunto: raw.assunto || null,
      banca: raw.banca || null,
      orgao: raw.orgao || null,
      ano: raw.ano || null,
      caderno: raw.caderno || null,
      idCaderno: raw.idCaderno || null,
      seconds: Number.isFinite(raw.seconds) ? Math.max(0, Math.round(raw.seconds)) : null,
      guessed: raw.guessed === true,
      simulado: raw.simulado === true,
      url: raw.url || null,
    };
  };

  RC.emptyBucket = function () {
    return { total: 0, hits: 0, misses: 0, voids: 0, seconds: 0, timed: 0, guesses: 0, guessHits: 0 };
  };

  /** Buckets antigos não tinham os campos de chute. */
  function ensure(bucket) {
    if (bucket.guesses == null) bucket.guesses = 0;
    if (bucket.guessHits == null) bucket.guessHits = 0;
    return bucket;
  }
  RC.ensureBucket = ensure;

  /** Aplica (ou desfaz, com sign = -1) um registro sobre um bucket agregado. */
  RC.applyToBucket = function (bucket, a, sign) {
    const s = sign || 1;
    ensure(bucket);
    bucket.total += s;
    if (a.correct === true) bucket.hits += s;
    else if (a.correct === false) bucket.misses += s;
    else bucket.voids += s;
    if (Number.isFinite(a.seconds)) {
      bucket.seconds += s * a.seconds;
      bucket.timed += s;
    }
    if (a.guessed) {
      bucket.guesses += s;
      if (a.correct === true) bucket.guessHits += s;
    }
    return bucket;
  };

  /** % de acerto sobre questões válidas (anuladas saem do denominador). */
  RC.hitRate = function (bucket) {
    const valid = bucket.hits + bucket.misses;
    return valid > 0 ? (bucket.hits / valid) * 100 : 0;
  };

  /**
   * % de domínio: acerto no chute não é conhecimento. Desconta do numerador
   * os acertos que você marcou como chute, mantendo o mesmo denominador.
   */
  RC.solidRate = function (bucket) {
    ensure(bucket);
    const valid = bucket.hits + bucket.misses;
    return valid > 0 ? ((bucket.hits - bucket.guessHits) / valid) * 100 : 0;
  };

  RC.avgSeconds = function (bucket) {
    return bucket.timed > 0 ? bucket.seconds / bucket.timed : 0;
  };

  RC.fmtDuration = function (sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '—';
    const s = Math.round(sec);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
  };

  /** Relógio do cronômetro: "32:10" ou "1:05:22". */
  RC.fmtClock = function (ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    const p = (n) => String(n).padStart(2, '0');
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  };

  /** Horas líquidas no formato "3h20" / "45min". */
  RC.fmtHours = function (ms) {
    const min = Math.round((ms || 0) / 60000);
    if (min < 60) return `${min}min`;
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
