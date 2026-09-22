/**
 * Painel flutuante na página do TEC. Usa Shadow DOM para que o CSS do site
 * não vaze pra cá (e vice-versa).
 */
(() => {
  'use strict';
  const RC = globalThis.RC;

  const host = document.createElement('div');
  host.id = 'gabaritometro-host';
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483600;';
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
      .box {
        width: 236px; background: #10141c; color: #e8ecf3; border: 1px solid #2a3244;
        border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.38); overflow: hidden;
        font-size: 12px; line-height: 1.35;
      }
      .top { display:flex; align-items:center; gap:6px; padding:8px 10px; background:#151b26; cursor:default; }
      .dot { width:7px; height:7px; border-radius:50%; background:#37d67a; flex:none; }
      .dot.manual { background:#f2b63c; }
      .ttl { font-weight:600; font-size:11px; letter-spacing:.3px; flex:1; }
      .icon { background:none; border:none; color:#8b97ab; cursor:pointer; font-size:13px; padding:0 3px; line-height:1; }
      .icon:hover { color:#e8ecf3; }
      .body { padding:10px; display:flex; flex-direction:column; gap:9px; }
      .row { display:flex; gap:6px; }
      .stat { flex:1; background:#171d29; border-radius:8px; padding:6px 8px; text-align:center; }
      .stat b { display:block; font-size:16px; font-weight:700; }
      .stat span { font-size:9px; color:#8b97ab; text-transform:uppercase; letter-spacing:.5px; }
      .hit b { color:#37d67a; } .miss b { color:#ff6b6b; } .rate b { color:#4ea8ff; }
      .bar { height:5px; background:#222a38; border-radius:3px; overflow:hidden; }
      .bar > i { display:block; height:100%; background:#4ea8ff; width:0; transition:width .25s; }
      .bar.done > i { background:#37d67a; }
      .meta { display:flex; justify-content:space-between; color:#8b97ab; font-size:10px; }
      .btns { display:flex; gap:5px; }
      .btn { flex:1; border:none; border-radius:7px; padding:7px 4px; font-size:11px; font-weight:600;
             cursor:pointer; color:#0d1117; }
      .ok { background:#37d67a; } .no { background:#ff6b6b; } .nul { background:#5a6577; color:#e8ecf3; flex:0 0 46px; }
      .btn:active { transform: translateY(1px); }
      .ghost { background:#222a38; color:#8b97ab; border:1px solid #2a3244; }
      .ghost.on { background:#f2b63c; color:#0d1117; border-color:#f2b63c; }
      .sim { background:#222a38; color:#b9c4d6; border:1px solid #2a3244; }
      .sim.on { background:#7a5cff; color:#fff; border-color:#7a5cff; }
      .clock { background:#171d29; border-radius:8px; padding:7px 8px; }
      .clocktop { display:flex; align-items:baseline; gap:6px; margin-bottom:5px; }
      .ctime { font-size:19px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:.5px; }
      .ctarget { font-size:10px; color:#8b97ab; flex:1; }
      .cbtn { background:#222a38; border:1px solid #2a3244; color:#e8ecf3; border-radius:6px;
              width:24px; height:22px; font-size:11px; cursor:pointer; padding:0; }
      .cbtn:hover { background:#2c3648; }
      .presets { display:flex; gap:4px; margin-top:6px; }
      .preset { flex:1; background:#222a38; border:1px solid #2a3244; color:#b9c4d6; border-radius:6px;
                padding:5px 0; font-size:10px; cursor:pointer; }
      .preset:hover { background:#2c3648; }
      .preset-input { flex:0 0 42px; min-width:0; background:#10141c; border:1px solid #2a3244;
                      color:#e8ecf3; border-radius:6px; padding:5px 4px; font-size:10px;
                      text-align:center; -moz-appearance:textfield; }
      .preset-input::-webkit-inner-spin-button, .preset-input::-webkit-outer-spin-button {
                      -webkit-appearance:none; margin:0; }
      .preset-input:focus { outline:none; border-color:#4ea8ff; }
      .preset-input.invalid { border-color:#ff6b6b; }
      .preset-go { flex:0 0 26px; }
      .cstate { font-size:10px; margin-top:5px; color:#7b8699; }
      .cstate.paused { color:#f2b63c; }
      .cstate.done { color:#37d67a; font-weight:600; }
      .running .ctime { color:#37d67a; }
      .paused .ctime { color:#f2b63c; }
      .done .ctime { color:#4ea8ff; }
      .simbox { background:#171d29; border-radius:8px; padding:7px 8px; display:none; }
      .simbox.show { display:block; }
      .simhead { display:flex; justify-content:space-between; font-size:10px; color:#b9c4d6; margin-bottom:5px; }
      .hint { color:#7b8699; font-size:10px; text-align:center; }
      .hint.warn { color:#f2b63c; }
      .collapsed .body { display:none; }
      .mini { padding:6px 10px; font-size:11px; display:none; gap:8px; }
      .collapsed .mini { display:flex; }
      .flash { animation: fl .5s ease; }
      @keyframes fl { 0% { background:#1d2736; } 100% { background:#10141c; } }
    </style>
    <div class="box" id="box">
      <div class="top">
        <i class="dot" id="dot"></i>
        <span class="ttl">Gabaritômetro</span>
        <button class="icon" id="undo" title="Desfazer último registro">&#8630;</button>
        <button class="icon" id="toggle" title="Recolher">&#9662;</button>
      </div>
      <div class="mini" id="mini"></div>
      <div class="body">
        <div class="row">
          <div class="stat"><b id="n-total">0</b><span>feitas</span></div>
          <div class="stat hit"><b id="n-hit">0</b><span>certas</span></div>
          <div class="stat miss"><b id="n-miss">0</b><span>erradas</span></div>
          <div class="stat rate"><b id="n-rate">—</b><span>acerto</span></div>
        </div>
        <div>
          <div class="bar" id="bar"><i id="fill"></i></div>
          <div class="meta"><span id="goal">meta 0/0</span><span id="timer">&#9201; 0s</span></div>
        </div>
        <div class="clock" id="clock">
          <div class="clocktop">
            <span class="ctime" id="c-time">0:00</span>
            <span class="ctarget" id="c-target"></span>
            <button class="cbtn" id="c-toggle" title="Pausar / retomar">&#9208;</button>
            <button class="cbtn" id="c-stop" title="Encerrar bloco">&#9632;</button>
          </div>
          <div class="bar"><i id="c-fill"></i></div>
          <div class="presets" id="c-presets"></div>
          <div class="cstate" id="c-state">sem bloco em curso</div>
        </div>
        <div class="simbox" id="simbox">
          <div class="simhead"><span id="sim-lbl">Simulado</span><span id="sim-cnt"></span></div>
          <div class="bar"><i id="sim-fill"></i></div>
        </div>
        <div class="btns">
          <button class="btn ok" id="b-ok">Acertei</button>
          <button class="btn no" id="b-no">Errei</button>
          <button class="btn nul" id="b-nul">Anul.</button>
        </div>
        <div class="btns">
          <button class="btn ghost" id="b-guess" title="Acerto no chute não conta como domínio do assunto">🎲 Chutei</button>
          <button class="btn sim" id="b-sim" title="Esconde o gabarito até fechar o bloco">Simulado</button>
        </div>
        <button class="btn ghost" id="b-list" style="display:none" title="Fecha o agrupamento atual sem apagar nada">Finalizar lista</button>
        <div class="hint" id="hint">detectando…</div>
      </div>
    </div>`;

  const $ = (id) => shadow.getElementById(id);
  const box = $('box');

  let settings = RC.DEFAULT_SETTINGS;
  let tickTimer = null;

  async function refresh(flash) {
    const { days, settings: s } = await RC.store.getAll();
    settings = s;
    const t = RC.stats.today(days);
    $('n-total').textContent = t.total;
    $('n-hit').textContent = t.hits;
    $('n-miss').textContent = t.misses;
    const valid = t.hits + t.misses;
    $('n-rate').textContent = valid ? Math.round(RC.hitRate(t)) + '%' : '—';

    const goal = Math.max(1, s.dailyGoal);
    const pct = Math.min(100, (t.total / goal) * 100);
    $('fill').style.width = pct + '%';
    $('bar').classList.toggle('done', t.total >= goal);
    $('goal').textContent = `meta ${t.total}/${goal}`;
    $('mini').textContent = `${t.total} · ${valid ? Math.round(RC.hitRate(t)) + '%' : '—'}`;

    if (flash) {
      box.classList.add('flash');
      setTimeout(() => box.classList.remove('flash'), 500);
    }
  }

  function setMode(auto) {
    $('dot').classList.toggle('manual', !auto);
    const h = $('hint');
    if (auto) {
      h.classList.remove('warn');
      h.textContent = 'contando automaticamente';
    } else {
      h.classList.add('warn');
      h.textContent = 'modo manual — use os botões';
    }
  }

  function startTimer() {
    clearInterval(tickTimer);
    const t0 = Date.now();
    tickTimer = setInterval(() => {
      const sec = (Date.now() - t0) / 1000;
      const el = $('timer');
      el.textContent = '⏱ ' + RC.fmtDuration(sec);
      el.style.color = sec > settings.slowThresholdSec ? '#f2b63c' : '#8b97ab';
    }, 1000);
  }

  $('toggle').addEventListener('click', () => {
    const c = box.classList.toggle('collapsed');
    $('toggle').innerHTML = c ? '&#9652;' : '&#9662;';
  });
  $('undo').addEventListener('click', async () => {
    const r = await RC.bridge.undo();
    if (r.undone) refresh(true);
  });
  $('b-ok').addEventListener('click', () => RC.bridge.manual(true));
  $('b-no').addEventListener('click', () => RC.bridge.manual(false));
  $('b-nul').addEventListener('click', () => RC.bridge.manual(null));
  $('b-guess').addEventListener('click', () => RC.bridge.toggleGuess());

  $('b-sim').addEventListener('click', async () => {
    const s = RC.bridge.simulado;
    if (s && s.active) {
      await RC.bridge.stopSimulado();
    } else {
      await RC.bridge.clearSimulado();
      await RC.bridge.startSimulado(Math.max(1, settings.simuladoSize));
    }
  });

  // ---- cronômetro de blocos ------------------------------------------------
  function renderPresets() {
    RC.blockPicker.render($('c-presets'), settings.blockPresets, (min) => RC.clock.start(min));
  }

  function renderClock(s) {
    const box = $('clock');
    const running = !!(s && s.running);
    const done = !!(s && s.finished);
    box.classList.toggle('running', running);
    box.classList.toggle('paused', !!s && !running && !done);
    box.classList.toggle('done', done);

    // Sem bloco: só os presets, que é a única ação possível.
    $('c-presets').style.display = s && !done ? 'none' : 'flex';
    $('c-toggle').style.display = s && !done ? '' : 'none';
    $('c-stop').style.display = s && !done ? '' : 'none';

    if (!s) {
      $('c-time').textContent = '0:00';
      $('c-target').textContent = 'hora líquida';
      $('c-fill').style.width = '0%';
      $('c-state').className = 'cstate';
      $('c-state').textContent = 'escolha a duração do bloco';
      return;
    }

    const el = RC.timer.elapsedMs(s, Date.now());
    $('c-time').textContent = RC.fmtClock(el);
    $('c-target').textContent = `/ ${RC.fmtClock(s.blockMs)}`;
    $('c-fill').style.width = Math.min(100, (el / s.blockMs) * 100) + '%';
    $('c-toggle').innerHTML = running ? '&#9208;' : '&#9205;';

    // Rótulo vem de RC.timer.label: painel, contador e popup mostram o mesmo.
    const lbl = RC.timer.label(s, Date.now());
    const st = $('c-state');
    st.className = 'cstate' + (lbl.kind === 'done' ? ' done' : lbl.kind === 'paused' ? ' paused' : '');
    const mat = done ? RC.timer.dominantMateria(s) : null;
    st.textContent = lbl.text + (mat ? ' · ' + mat : '');
  }

  $('c-toggle').addEventListener('click', () => RC.clock.toggle());
  $('c-stop').addEventListener('click', () => RC.clock.stop());
  $('c-state').addEventListener('click', () => {
    // Clicar no aviso de bloco concluído limpa e libera novo bloco.
    const s = RC.clock.state;
    if (s && s.finished) RC.clock.dismiss();
  });
  RC.clock.onChange(renderClock);

  /** O botão só existe quando há lista aberta — senão não teria o que fechar. */
  function renderListBtn(l) {
    const b = $('b-list');
    const open = !!(l && !l.finishedAt);
    b.style.display = open ? '' : 'none';
    if (open) b.textContent = `Finalizar lista (${l.total})`;
  }

  $('b-list').addEventListener('click', async () => {
    const l = await RC.bridge.finishList();
    if (!l) return;
    const valid = l.hits + l.misses;
    $('hint').textContent = `lista fechada: ${l.total} questões, ${valid ? Math.round((l.hits / valid) * 100) : 0}%`;
    await RC.bridge.clearList();
  });

  /** Reflete a sessão de simulado: blackout do gabarito + barra de progresso. */
  function renderSimulado(s) {
    const on = !!(s && s.active);
    RC.simulado.apply(on);
    $('b-sim').classList.toggle('on', on);
    $('b-sim').textContent = on ? 'Encerrar' : 'Simulado';
    const box = $('simbox');
    box.classList.toggle('show', !!s);
    if (!s) return;

    const done = s.ids.length;
    $('sim-fill').style.width = Math.min(100, (done / s.size) * 100) + '%';
    if (on) {
      $('sim-lbl').textContent = 'Simulado em curso — gabarito oculto';
      $('sim-cnt').textContent = `${done}/${s.size}`;
    } else {
      const valid = s.hits + s.misses;
      const pct = valid ? Math.round((s.hits / valid) * 100) : 0;
      $('sim-lbl').textContent = `Resultado: ${s.hits} certas, ${s.misses} erradas`;
      $('sim-cnt').textContent = `${pct}% · ${RC.fmtDuration(s.seconds)}`;
    }
  }

  RC.bridge.onChange((evt) => {
    if (evt.kind === 'mode') setMode(evt.auto);
    if (evt.kind === 'question') {
      startTimer();
      $('b-guess').classList.remove('on');
      // Questão já respondida antes (revisita): o gabarito continua oculto.
      RC.simulado.setAnswered(evt.snap && evt.snap.result !== null);
      // Alimenta a eleição da matéria dominante do bloco.
      if (evt.snap) RC.clock.noteMateria(evt.snap.materia);
      const s = evt.snap;
      if (s && s.materia) $('hint').textContent = s.assunto ? `${s.materia} › ${s.assunto}` : s.materia;
    }
    if (evt.kind === 'guess') {
      $('b-guess').classList.toggle('on', evt.armed);
      $('hint').textContent = evt.armed
        ? evt.retro ? 'marcada como chute' : 'próxima resposta conta como chute'
        : 'chute desmarcado';
      if (evt.retro) refresh(false);
    }
    if (evt.kind === 'simulado') renderSimulado(evt.session);
    if (evt.kind === 'list') renderListBtn(evt.list);
    if (evt.kind === 'saved') RC.simulado.setAnswered(true);
    if (evt.kind === 'saved' && evt.result.saved) refresh(true);
    if (evt.kind === 'saved' && !evt.result.saved) $('hint').textContent = 'já contada hoje';
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[RC.KEYS.days] || changes[RC.KEYS.settings]) refresh(false);
  });

  (async () => {
    const s = await RC.store.getSettings();
    if (!s.panelEnabled) return;
    document.documentElement.appendChild(host);
    await refresh(false);
    startTimer();
    renderPresets();
    renderClock(RC.clock.state);
    renderSimulado(await RC.store.getSimulado());
    RC.bridge.requestSnapshot();
  })();
})();
