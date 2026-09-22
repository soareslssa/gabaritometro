/**
 * Testes de lista de questões, origem (TEC × PDF) e zerar o dia.
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
await import('../src/shared/storage.js');
await import('../src/shared/stats.js');
const RC = globalThis.RC;

let fail = 0;
const ck = (n, a, b) => {
  const p = JSON.stringify(a) === JSON.stringify(b);
  if (!p) { fail++; console.log('FAIL', n, 'got', a, 'want', b); } else console.log('ok  ', n);
};
const DAY = 86400000;
const now = Date.now();

/** Registra na lista ativa como a janela do contador faz. */
async function rec(correct, seconds, extra) {
  const { id, listId } = await RC.store.nextListId();
  return RC.store.record({ id, listId, origin: 'pdf', source: 'manual', correct, anulada: correct === null, seconds, ...extra });
}

// ---- ciclo de vida da lista -------------------------------------------------
let list = await RC.store.startList({ origin: 'pdf', materia: 'Português', assunto: 'Crase', banca: 'FGV' });
ck('lista começa vazia', [list.total, list.hits, !!list.finishedAt], [0, 0, false]);

await rec(true, 30);
await rec(true, 40);
await rec(false, 50);
await rec(true, 20);
await rec(null, 10);
list = await RC.store.getList();
ck('contadores da lista', [list.total, list.hits, list.misses, list.voids], [5, 3, 1, 1]);
ck('tempo somado', list.seconds, 150);

// os registros entram nas estatísticas gerais como qualquer outro
let all = await RC.store.getAll();
ck('entra no dia', RC.stats.today(all.days).total, 5);
ck('herda matéria da lista', RC.stats.bySubject(all.subjects, 1, true)[0].label, 'Português');
ck('% ignora anulada', Math.round(RC.hitRate(RC.stats.today(all.days))), 75);

// ---- finalizar não altera nada do histórico ---------------------------------
const antes = JSON.stringify((await RC.store.getAll()).days);
const done = await RC.store.finishList();
ck('lista marcada como fechada', !!done.finishedAt, true);
ck('finalizar não muda o dia', JSON.stringify((await RC.store.getAll()).days), antes);
ck('registro em lista fechada não conta', (await rec(true, 10)).list, null);
all = await RC.store.getAll();
ck('mas o registro avulso ainda entra no dia', RC.stats.today(all.days).total, 6);

// ---- ids únicos mesmo no mesmo milissegundo ---------------------------------
await RC.store.clearList();
await RC.store.startList({ origin: 'pdf', materia: 'RLM' });
const ids = [];
for (let i = 0; i < 5; i++) ids.push((await RC.store.nextListId()).id);
ck('ids sequenciais e únicos', new Set(ids).size, 5);

// ---- regressão: chute retroativo em registro manual -------------------------
// Antes, o id era remontado por fora e virava "tec:undefined"; setGuess falhava
// em silêncio e o acerto no chute seguia contando como domínio.
const r = await rec(true, 25);
ck('record devolve o id gravado', typeof r.id === 'string' && r.id.startsWith('pdf:'), true);
const fg = await RC.store.setGuess(r.id, true);
ck('chute retroativo funciona', fg.changed, true);
all = await RC.store.getAll();
const ov = RC.stats.overall(all.days);
ck('chute contabilizado', [ov.guesses, ov.guessHits], [1, 1]);

// ---- origem -----------------------------------------------------------------
await RC.store.clearList();
await RC.store.record({ idQuestao: 999, origin: 'tec', correct: true, seconds: 15 });
all = await RC.store.getAll();
const byOrigin = all.attempts.reduce((acc, a) => { acc[a.origin] = (acc[a.origin] || 0) + 1; return acc; }, {});
// 5 da 1ª lista + 1 avulso + 1 da 2ª lista = 7. As reservas de id acima não
// viram registro, e é justamente isso que o número confirma.
ck('origem gravada', [byOrigin.pdf, byOrigin.tec], [7, 1]);
ck('id do TEC mantém o prefixo', all.attempts.at(-1).id, 'tec:999');

// ---- zerar o dia --------------------------------------------------------------
// ontem: 2 questões de Português + 1h líquida
await RC.store.record({ id: 'pdf:ontem:1', origin: 'pdf', correct: true, materia: 'Português', ts: now - DAY, seconds: 30 });
await RC.store.record({ id: 'pdf:ontem:2', origin: 'pdf', correct: false, materia: 'Português', ts: now - DAY, seconds: 30 });
await RC.store.commitTime(RC.dayKey(now - DAY), 'Português', 3600000, true);
await RC.store.commitTime(RC.dayKey(now), 'Português', 1800000, true);

const hojeAntes = RC.stats.today((await RC.store.getAll()).days).total;
const res = await RC.store.resetDay(RC.dayKey(now));
ck('reportou o que apagou', [res.removed, res.timeMs], [hojeAntes, 1800000]);

all = await RC.store.getAll();
ck('hoje zerado', RC.stats.today(all.days).total, 0);
ck('ontem preservado', all.days[RC.dayKey(now - DAY)].total, 2);
ck('horas de hoje zeradas', all.time[RC.dayKey(now)], undefined);
ck('horas de ontem preservadas', all.time[RC.dayKey(now - DAY)].totalMs, 3600000);
ck('subjects só com o que sobrou', RC.stats.bySubject(all.subjects, 1, true).map((x) => [x.label, x.total]), [['Português', 2]]);
ck('attempts de hoje removidos', all.attempts.every((a) => RC.dayKey(a.ts) !== RC.dayKey(now)), true);
ck('ofensiva recalculada', all.streak.current, 1);
ck('lista de hoje descartada', await RC.store.getList(), null);

// resetDay não pode depender de reconstruir a partir de attempts: se o histórico
// antigo já foi podado, os agregados daquele período têm que continuar de pé.
db[RC.KEYS.attempts] = [];
await RC.store.record({ id: 'pdf:hoje:x', origin: 'pdf', correct: true, materia: 'RLM', ts: now });
await RC.store.resetDay(RC.dayKey(now));
all = await RC.store.getAll();
ck('agregado antigo sobrevive à poda', all.days[RC.dayKey(now - DAY)].total, 2);

console.log(fail ? `\n${fail} FALHA(S)` : '\nTodos os testes de lista passaram');
process.exit(fail ? 1 : 0);
