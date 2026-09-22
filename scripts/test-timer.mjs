/**
 * Testes do cronômetro de horas líquidas.
 * O "agora" é sempre injetado, então nada aqui espera tempo real passar.
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
await import('../src/shared/timer.js');
const RC = globalThis.RC;
const T = RC.timer;

let fail = 0;
const ck = (n, a, b) => {
  const p = JSON.stringify(a) === JSON.stringify(b);
  if (!p) { fail++; console.log('FAIL', n, 'got', a, 'want', b); } else console.log('ok  ', n);
};
const MIN = 60000;
const T0 = 1758000000000; // instante fixo, pra não depender do relógio da máquina

/** Simula o batimento de 5s enquanto o tempo avança. */
function runFor(state, from, ms) {
  let t = from;
  const end = from + ms;
  while (t < end) {
    t = Math.min(end, t + T.HEARTBEAT_MS);
    state = T.beat(state, t);
  }
  return { state, now: end };
}

// ---- acumulação em trechos -------------------------------------------------
let s = T.create(45 * MIN, T0, '2026-09-21');
s = T.resume(s, T0, 'tabA');
let r = runFor(s, T0, 10 * MIN);
s = T.pause(r.state, r.now, 'user');
ck('10 min corridos', Math.round(s.accumulatedMs / MIN), 10);

// 5 minutos pausado não contam
const afterIdle = r.now + 5 * MIN;
ck('pausa não acumula', Math.round(T.elapsedMs(s, afterIdle) / MIN), 10);

s = T.resume(s, afterIdle, 'tabA');
r = runFor(s, afterIdle, 10 * MIN);
s = T.settle(r.state, r.now);
ck('10 + pausa + 10 = 20, não 25', Math.round(s.accumulatedMs / MIN), 20);

// ---- clamp do heartbeat (o teste que justifica a feature) ------------------
let crash = T.create(45 * MIN, T0, '2026-09-21');
crash = T.resume(crash, T0, 'tabA');
crash = T.beat(crash, T0 + 30 * 1000); // último sinal de vida: 30s depois
const seisHorasDepois = T0 + 6 * 3600 * 1000;
const creditado = T.elapsedMs(crash, seisHorasDepois);
ck('crash não vira 6h', creditado < 40 * 1000, true);
ck('crash credita até o último batimento', Math.round(creditado / 1000), 37);
ck('settle após crash é estável', Math.round(T.settle(crash, seisHorasDepois).accumulatedMs / 1000), 37);

// ---- pausa manual x automática ---------------------------------------------
let m = T.resume(T.create(45 * MIN, T0, '2026-09-21'), T0, 'tabA');
m = T.pause(m, T0 + MIN, 'user');
ck('pausa do usuário não auto-retoma', T.canAutoResume(m), false);
let a = T.resume(T.create(45 * MIN, T0, '2026-09-21'), T0, 'tabA');
a = T.pause(a, T0 + MIN, 'hidden');
ck('pausa por aba oculta auto-retoma', T.canAutoResume(a), true);
a = T.pause(a, T0 + MIN, 'idle');
ck('pausa por ociosidade auto-retoma', T.canAutoResume(a), true);

// ---- fim do bloco -----------------------------------------------------------
let f = T.resume(T.create(2 * MIN, T0, '2026-09-21'), T0, 'tabA');
r = runFor(f, T0, 5 * MIN); // deixa passar MUITO do alvo
ck('não passa do alvo', T.elapsedMs(r.state, r.now), 2 * MIN);
ck('detecta fim', T.isFinished(r.state, r.now), true);
f = T.settle(r.state, r.now);
ck('finished marcado ao fechar', f.finished, true);
ck('acumulado não estoura o alvo', Math.round(f.accumulatedMs / MIN), 2);
ck('bloco fechado não retoma', T.resume(f, r.now + MIN, 'tabA').running, false);

// ---- matéria dominante ------------------------------------------------------
let d = T.create(45 * MIN, T0, '2026-09-21');
['Português', 'RLM', 'Português', 'Português', 'RLM'].forEach((x) => (d = T.countMateria(d, x)));
ck('dominante por contagem', T.dominantMateria(d), 'Português');
let tie = T.create(45 * MIN, T0, '2026-09-21');
['RLM', 'Português'].forEach((x) => (tie = T.countMateria(tie, x)));
ck('empate é determinístico', T.dominantMateria(tie), T.dominantMateria(tie));
ck('empate resolve alfabeticamente', T.dominantMateria(tie), 'Português');
ck('sem questões, sem matéria', T.dominantMateria(T.create(45 * MIN, T0, '2026-09-21')), null);
ck('matéria nula é ignorada', T.countMateria(d, null), d);

// ---- persistência do tempo --------------------------------------------------
await RC.store.commitTime('2026-09-21', 'Português', 45 * MIN, true);
await RC.store.commitTime('2026-09-21', 'Português', 15 * MIN, false);
await RC.store.commitTime('2026-09-21', 'RLM', 30 * MIN, true);
await RC.store.commitTime('2026-09-20', 'RLM', 60 * MIN, true);
let time = await RC.store.getTime();
ck('total do dia', Math.round(time['2026-09-21'].totalMs / MIN), 90);
ck('blocos fechados contados', time['2026-09-21'].blocks, 2);
ck('tempo por matéria', Math.round(time['2026-09-21'].byMateria['Português'] / MIN), 60);
ck('dias separados', Math.round(time['2026-09-20'].totalMs / MIN), 60);
ck('tempo zero é ignorado', await RC.store.commitTime('2026-09-21', 'X', 0, false), null);

// reimportar o mesmo export não pode dobrar as horas
const json = await RC.store.exportJSON();
await RC.store.importJSON(json);
time = await RC.store.getTime();
ck('import não dobra horas', Math.round(time['2026-09-21'].totalMs / MIN), 90);

// ---- duração digitada à mão ------------------------------------------------
// O campo é <input type="number">, mas o valor chega como string e o usuário
// pode digitar qualquer coisa. Nada disso pode virar um bloco inválido.
const nm = T.normalizeMinutes;
ck('vazio é rejeitado', nm(''), null);
ck('espaços são rejeitados', nm('   '), null);
ck('null é rejeitado', nm(null), null);
ck('undefined é rejeitado', nm(undefined), null);
ck('texto é rejeitado', nm('abc'), null);
ck('zero é rejeitado', nm(0), null);
ck('negativo é rejeitado', nm(-5), null);
ck('menor que 1 min é rejeitado', nm(0.4), null);
ck('string numérica', nm('30'), 30);
ck('string com espaços', nm('  45 '), 45);
ck('número direto', nm(56), 56);
ck('arredonda pra baixo', nm(30.4), 30);
ck('arredonda pra cima', nm(30.6), 31);
ck('vírgula decimal do teclado BR', nm('30,6'), 31);
ck('0,7 arredonda pra 1', nm('0,7'), 1);
ck('teto aplicado', nm(99999), T.MAX_MINUTES);
ck('teto aplicado em string', nm('1e9'), T.MAX_MINUTES);
// Infinity não é duração: cai fora em vez de virar o teto.
ck('Infinity é rejeitado', nm(Infinity), null);
ck('-Infinity é rejeitado', nm(-Infinity), null);
ck('NaN é rejeitado', nm(NaN), null);

// o valor normalizado tem que produzir um bloco coerente
const custom = T.create(nm('30') * MIN, T0, '2026-09-21');
ck('bloco de 30 min', custom.blockMs, 30 * MIN);
ck('bloco no teto fecha', T.isFinished({ ...custom, blockMs: nm(99999) * MIN, accumulatedMs: T.MAX_MINUTES * MIN }, T0), true);

// ---- componente do seletor de duração --------------------------------------
// Ele é o único caminho para iniciar bloco nas três superfícies, então um erro
// aqui quebraria todas de uma vez. DOM mínimo, só o que o componente usa.
function fakeEl(tag) {
  return {
    tagName: tag, children: [], className: '', value: '', type: '', attrs: {}, _h: {},
    classList: { add() {}, remove() {} },
    addEventListener(t, f) { this._h[t] = f; },
    appendChild(c) { this.children.push(c); },
    append(...cs) { this.children.push(...cs); },
    setAttribute(k, v) { this.attrs[k] = v; },
    focus() {},
    set innerHTML(v) { if (!v) this.children = []; },
    get innerHTML() { return ''; },
  };
}
globalThis.document = { createElement: fakeEl };
await import('../src/shared/blockpicker.js');

const picked = [];
const box = fakeEl('div');
RC.blockPicker.render(box, [45, 56, 75], (m) => picked.push(m));
const btns = box.children.filter((c) => c.tagName === 'button');
const field = box.children.find((c) => c.tagName === 'input');
ck('monta 3 presets + botão iniciar', btns.length, 4);
ck('monta o campo', !!field, true);
ck('campo começa vazio', field.value, '');
ck('teto no atributo max', field.attrs === undefined ? null : field.max, String(T.MAX_MINUTES));

btns[0]._h.click();
ck('clicar preset dispara', picked, [45]);

field.value = '30';
field._h.keydown({ key: 'Enter', preventDefault() {} });
ck('Enter usa o valor digitado', picked, [45, 30]);
ck('campo é limpo após iniciar', field.value, '');

field.value = 'abc';
field._h.keydown({ key: 'Enter', preventDefault() {} });
ck('valor inválido não inicia', picked, [45, 30]);
ck('campo inválido é limpo', field.value, '');

field.value = '20';
field._h.keydown({ key: 'a', preventDefault() {} });
ck('outra tecla não inicia', picked, [45, 30]);

field.value = '99999';
btns[3]._h.click();
ck('botão iniciar respeita o teto', picked, [45, 30, T.MAX_MINUTES]);

RC.blockPicker.render(box, [], () => {});
ck('sem presets usa o padrão', box.children.filter((c) => c.tagName === 'button').length, 4);

console.log(fail ? `\n${fail} FALHA(S)` : '\nTodos os testes do cronômetro passaram');
process.exit(fail ? 1 : 0);
