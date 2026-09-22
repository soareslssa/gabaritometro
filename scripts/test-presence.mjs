/**
 * Testes de presença entre superfícies e do fechamento atômico do bloco.
 * O "agora" é injetado — nenhum teste espera tempo real.
 */
const db = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(k) { const ks = Array.isArray(k) ? k : [k]; const o = {}; for (const x of ks) if (x in db) o[x] = JSON.parse(JSON.stringify(db[x])); return o; },
      async set(o) { Object.assign(db, JSON.parse(JSON.stringify(o))); },
      async remove(k) { for (const x of (Array.isArray(k) ? k : [k])) delete db[x]; },
      async clear() { for (const k in db) delete db[k]; },
    },
  },
};
await import('../src/shared/schema.js');
await import('../src/shared/presence.js');
await import('../src/shared/timer.js');
await import('../src/shared/storage.js');
await import('../src/shared/stats.js');
const RC = globalThis.RC;
const P = RC.presence;
const T = RC.timer;

let fail = 0;
const ck = (n, a, b) => {
  const p = JSON.stringify(a) === JSON.stringify(b);
  if (!p) { fail++; console.log('FAIL', n, 'got', a, 'want', b); } else console.log('ok  ', n);
};
const MIN = 60000;
const T0 = 1758000000000;

// ---- registro de presença ---------------------------------------------------
let reg = {};
reg = P.touch(reg, 'tec-1', 'tec', true, T0);
ck('uma superfície sustenta', P.anyVisible(reg, T0), true);

// aba do TEC oculta, janela do contador visível: o bloco tem que continuar.
// É o caso que falhava — ler PDF derrubava o cronômetro.
reg = P.touch(reg, 'counter-1', 'counter', true, T0);
reg = P.touch(reg, 'tec-1', 'tec', false, T0 + 1000);
ck('TEC oculto, contador visível ainda sustenta', P.anyVisible(reg, T0 + 1000), true);
ck('kinds presentes', P.kinds(reg, T0 + 1000), ['counter']);

// contador fecha: ninguém sustenta
reg = P.touch(reg, 'counter-1', 'counter', false, T0 + 2000);
ck('nenhuma superfície visível', P.anyVisible(reg, T0 + 2000), false);

// entrada velha não sustenta (aba morta sem avisar)
reg = P.touch({}, 'counter-2', 'counter', true, T0);
ck('presença fresca vale', P.anyVisible(reg, T0 + P.TTL_MS - 1), true);
ck('presença vencida não vale', P.anyVisible(reg, T0 + P.TTL_MS + 1), false);
ck('prune remove vencida', Object.keys(P.prune(reg, T0 + P.TTL_MS + 1)), []);

// "além de mim, tem mais alguém?" — usado no boot pra decidir se pausa
reg = P.touch({}, 'tec-9', 'tec', true, T0);
ck('só eu presente', P.anyVisibleExcept(reg, 'tec-9', T0), false);
reg = P.touch(reg, 'counter-9', 'counter', true, T0);
ck('outro presente', P.anyVisibleExcept(reg, 'tec-9', T0), true);

// ---- persistência da presença ----------------------------------------------
await RC.store.touchPresence('tec-a', 'tec', true);
await RC.store.touchPresence('counter-a', 'counter', true);
ck('presença gravada', Object.keys(await RC.store.getPresence()).sort(), ['counter-a', 'tec-a']);
await RC.store.touchPresence('tec-a', 'tec', false);
ck('presença removida', Object.keys(await RC.store.getPresence()), ['counter-a']);

// ---- settleTimer: atômico e idempotente ------------------------------------
// Duas superfícies podem pausar o mesmo bloco. Se as duas creditassem o
// pendente, o mesmo tempo entraria em dobro nas horas do dia.
function runFor(state, from, ms) {
  let t = from;
  while (t < from + ms) { t = Math.min(from + ms, t + T.HEARTBEAT_MS); state = T.beat(state, t); }
  return { state, now: from + ms };
}
await chrome.storage.local.clear();
let s = T.resume(T.create(45 * MIN, T0, RC.dayKey(T0)), T0, 'tec-a');
s.committedMs = 0;
let r = runFor(s, T0, 10 * MIN);
await RC.store.setTimer(r.state);

const first = await RC.store.settleTimer(r.now, 'user', false);
ck('settle credita o pendente', Math.round(first.accumulatedMs / MIN), 10);
let time = await RC.store.getTime();
ck('horas do dia após 1º settle', Math.round(time[RC.dayKey(T0)].totalMs / MIN), 10);

// segunda chamada (outra superfície) não pode creditar de novo
await RC.store.settleTimer(r.now, 'user', false);
time = await RC.store.getTime();
ck('settle repetido não dobra as horas', Math.round(time[RC.dayKey(T0)].totalMs / MIN), 10);
ck('motivo da pausa preservado', (await RC.store.getTimer()).pausedReason, 'user');

// encerrar credita o bloco e marca fechado
let s2 = T.resume(await RC.store.getTimer(), r.now, 'counter-a');
r = runFor(s2, r.now, 5 * MIN);
await RC.store.setTimer(r.state);
const closed = await RC.store.settleTimer(r.now, null, true);
ck('bloco marcado como fechado', [closed.finished, closed.running], [true, false]);
time = await RC.store.getTime();
ck('horas totais do bloco', Math.round(time[RC.dayKey(T0)].totalMs / MIN), 15);
ck('bloco contado uma vez', time[RC.dayKey(T0)].blocks, 1);

// tempo de leitura sem questões fica sem matéria, por decisão de projeto
ck('leitura cai em "—"', Math.round(time[RC.dayKey(T0)].byMateria['—'] / MIN), 15);

// ---- clamp do batimento sobrevive à troca de superfície ---------------------
// A janela que sustentava o bloco foi fechada: o batimento congelou e o
// crédito tem que parar ali, não no relógio de parede.
await chrome.storage.local.clear();
let s3 = T.resume(T.create(45 * MIN, T0, RC.dayKey(T0)), T0, 'counter-b');
s3.committedMs = 0;
s3 = T.beat(s3, T0 + 30000); // último sinal de vida
await RC.store.setTimer(s3);
const late = await RC.store.settleTimer(T0 + 6 * 3600 * 1000, 'hidden', false);
ck('janela fechada não credita 6h', late.accumulatedMs < 40000, true);
ck('credita até o último batimento', Math.round(late.accumulatedMs / 1000), 37);

// ---- rótulos compartilhados --------------------------------------------------
ck('rótulo sem bloco', T.label(null, T0).kind, 'none');
ck('rótulo rodando', T.label(T.resume(T.create(45 * MIN, T0, '2026-09-21'), T0, 'x'), T0).kind, 'running');
ck('rótulo pausa do usuário', T.label({ ...s3, running: false, pausedReason: 'user' }, T0).text, 'pausado por você');
ck('rótulo sem janela visível', T.label({ ...s3, running: false, pausedReason: 'hidden' }, T0).text, 'pausado — nenhuma janela visível');
ck('rótulo ocioso', T.label({ ...s3, running: false, pausedReason: 'idle' }, T0).text, 'pausado — sem atividade');

console.log(fail ? `\n${fail} FALHA(S)` : '\nTodos os testes de presença passaram');
process.exit(fail ? 1 : 0);
