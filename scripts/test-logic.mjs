const db={};
globalThis.chrome={storage:{local:{
  async get(k){const ks=Array.isArray(k)?k:[k];const o={};for(const x of ks)if(x in db)o[x]=JSON.parse(JSON.stringify(db[x]));return o},
  async set(o){Object.assign(db,JSON.parse(JSON.stringify(o)))},
  async remove(k){for(const x of (Array.isArray(k)?k:[k]))delete db[x]},
  async clear(){for(const k in db)delete db[k]},
}}};
await import('../src/shared/schema.js');
await import('../src/shared/storage.js');
await import('../src/shared/stats.js');
const RC=globalThis.RC;
const DAY=86400000, now=Date.now();
const q=(id,ok,ts,mat,ass,sec)=>({idQuestao:id,correct:ok,anulada:ok===null,materia:mat,assunto:ass,seconds:sec,ts});

let fail=0; const ck=(n,a,b)=>{const p=JSON.stringify(a)===JSON.stringify(b);if(!p){fail++;console.log('FAIL',n,'got',a,'want',b)}else console.log('ok  ',n)};

// 4 hoje: 3 certas 1 errada
await RC.store.record(q(1,true ,now,'Português','Crase',30));
await RC.store.record(q(2,true ,now,'Português','Crase',40));
await RC.store.record(q(3,false,now,'Português','Regência',90));
await RC.store.record(q(4,true ,now,'RLM','Lógica',60));
let s=await RC.store.getAll();
ck('total hoje',RC.stats.today(s.days).total,4);
ck('acertos',RC.stats.today(s.days).hits,3);
ck('% acerto',Math.round(RC.hitRate(RC.stats.today(s.days))),75);

// dedupe: mesma questão, mesmo dia
const d=await RC.store.record(q(1,false,now,'Português','Crase',10));
ck('dedupe ignorado',d.saved,false);
s=await RC.store.getAll(); ck('total segue 4',RC.stats.today(s.days).total,4);

// anulada sai do denominador
await RC.store.record(q(5,null,now,'RLM','Lógica',20));
s=await RC.store.getAll();
ck('anulada conta no total',RC.stats.today(s.days).total,5);
ck('% ignora anulada',Math.round(RC.hitRate(RC.stats.today(s.days))),75);

// mesma questão em outro dia conta de novo (revisão)
await RC.store.record(q(1,true,now-DAY,'Português','Crase',25));
s=await RC.store.getAll(); ck('revisão em outro dia',s.attempts.length,6);

// streak: ontem + hoje = 2
ck('streak',s.streak.current,2);

// pior matéria primeiro
const by=RC.stats.bySubject(s.subjects,1,true);
ck('pior matéria',by[0].label,'Português');
ck('RLM 100%',Math.round(by.find(x=>x.label==='RLM').rate),100);

// undo
await RC.store.undoLast(); s=await RC.store.getAll();
ck('undo',s.attempts.length,5);

// export/import idempotente
const json=await RC.store.exportJSON();
const imp=await RC.store.importJSON(json);
ck('import sem duplicar',imp.added,0);

// tempo médio
ck('tempo médio',Math.round(RC.avgSeconds(RC.stats.overall(s.days))),48);

// ---- chute ----------------------------------------------------------------
await RC.store.reset();
await RC.store.record({idQuestao:10,correct:true ,materia:'RLM',assunto:'Lógica',seconds:20,ts:now,guessed:true});
await RC.store.record({idQuestao:11,correct:true ,materia:'RLM',assunto:'Lógica',seconds:20,ts:now});
await RC.store.record({idQuestao:12,correct:false,materia:'RLM',assunto:'Lógica',seconds:20,ts:now});
s=await RC.store.getAll();
let ov=RC.stats.overall(s.days);
ck('chute: % acerto bruto',Math.round(RC.hitRate(ov)),67);
ck('chute: % domínio desconta',Math.round(RC.solidRate(ov)),33);
ck('chute: contador',[ov.guesses,ov.guessHits],[1,1]);

// marcar chute retroativamente
const fg=await RC.store.setGuess('tec:11',true);
ck('setGuess aplicou',fg.changed,true);
s=await RC.store.getAll(); ov=RC.stats.overall(s.days);
ck('domínio após retro',Math.round(RC.solidRate(ov)),0);
ck('acerto bruto inalterado',Math.round(RC.hitRate(ov)),67);
ck('total inalterado',ov.total,3);

// desmarcar volta ao estado anterior
await RC.store.setGuess('tec:11',false);
s=await RC.store.getAll(); ov=RC.stats.overall(s.days);
ck('desmarcar chute',Math.round(RC.solidRate(ov)),33);
ck('setGuess idempotente',(await RC.store.setGuess('tec:11',false)).changed,false);

// ---- modo simulado --------------------------------------------------------
await RC.store.clearSimulado();
let sim=await RC.store.startSimulado(3);
ck('simulado inicia ativo',sim.active,true);
sim=await RC.store.pushSimulado('tec:20',true,30);
sim=await RC.store.pushSimulado('tec:21',false,45);
ck('simulado em curso',[sim.active,sim.ids.length],[true,2]);
sim=await RC.store.pushSimulado('tec:20',true,30);
ck('simulado ignora repetida',sim.ids.length,2);
sim=await RC.store.pushSimulado('tec:22',true,25);
ck('simulado fecha ao atingir N',[sim.active,sim.hits,sim.misses],[false,2,1]);
ck('simulado soma tempo',sim.seconds,100);
sim=await RC.store.pushSimulado('tec:23',true,10);
ck('fechado não aceita mais',sim.ids.length,3);

console.log(fail?`\n${fail} FALHA(S)`:'\nTodos os testes passaram');
process.exit(fail?1:0);
