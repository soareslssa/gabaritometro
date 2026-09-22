(() => {
  'use strict';
  const RC = globalThis.RC;
  const $ = (id) => document.getElementById(id);

  const color = (rate) => (rate >= 75 ? '#37d67a' : rate >= 55 ? '#f2b63c' : '#ff6b6b');

  function renderSpark(series) {
    const el = $('spark');
    el.innerHTML = '';
    const max = Math.max(1, ...series.map((d) => d.total));
    for (const d of series) {
      const col = document.createElement('div');
      col.title = `${d.day}: ${d.total} questões · ${d.hits} certas · ${d.misses} erradas`;
      const h = (d.total / max) * 100;
      if (d.total) {
        const hits = document.createElement('i');
        hits.className = 'h';
        hits.style.cssText = `display:block;height:${(d.hits / d.total) * h}%`;
        const miss = document.createElement('i');
        miss.className = 'm';
        miss.style.cssText = `display:block;height:${((d.total - d.hits) / d.total) * h}%`;
        col.append(miss, hits);
      }
      el.appendChild(col);
    }
  }

  function renderSubjects(subjects, min, byMateria) {
    const rows = RC.stats.bySubject(subjects, min, byMateria);
    const el = $('subjects');
    el.innerHTML = '';
    if (!rows.length) {
      el.innerHTML = `<p class="empty">Resolva pelo menos ${min} questões de uma matéria para ela aparecer aqui.</p>`;
      $('subjnote').textContent = '';
      return;
    }
    for (const r of rows.slice(0, 12)) {
      const div = document.createElement('div');
      div.className = 'subj';
      const c = color(r.rate);
      div.innerHTML = `
        <div class="subjtop"><span></span><span class="pct" style="color:${c}">${Math.round(r.rate)}%</span></div>
        <div class="sbar"><i style="width:${r.rate}%;background:${c}"></i></div>
        <div class="subjmeta"></div>`;
      div.querySelector('.subjtop span').textContent = r.label;
      div.querySelector('.subjmeta').textContent =
        `${r.hits}/${r.hits + r.misses} certas · média ${RC.fmtDuration(r.avg)}` +
        (r.guessHits ? ` · ${r.guessHits} no chute` : '');
      el.appendChild(div);
    }
    $('subjnote').textContent = `Ordenado da pior para a melhor · mínimo de ${min} questões.`;
  }

  /** Horas líquidas: hoje, semana, e o cruzamento tempo × questões. */
  function renderTime(time, days) {
    const today = time[RC.dayKey()] || { totalMs: 0, blocks: 0, byMateria: {} };
    $('h-today').textContent = today.totalMs ? RC.fmtHours(today.totalMs) : '—';
    $('h-blocks').textContent = today.blocks || 0;

    let weekMs = 0;
    for (const d of RC.stats.series(days, 7)) weekMs += (time[d.day] || {}).totalMs || 0;
    $('h-week').textContent = weekMs ? RC.fmtHours(weekMs) : '—';

    const t = RC.stats.today(days);
    $('h-perq').textContent =
      today.totalMs && t.total ? RC.fmtDuration(today.totalMs / 1000 / t.total) : '—';

    const tops = Object.entries(today.byMateria || {}).sort((a, b) => b[1] - a[1]);
    $('hnote').textContent = tops.length
      ? 'Hoje: ' + tops.slice(0, 3).map(([m, ms]) => `${m} ${RC.fmtHours(ms)}`).join(' · ')
      : 'Inicie um bloco no painel do TEC para contar horas líquidas.';
  }

  /**
   * Widget do bloco de estudo.
   *
   * O popup NÃO carrega o clock.js: ele fecha ao perder o foco, então não pode
   * ser a superfície que tiqueta. Ele escreve o estado no storage e delega a
   * contagem à janela do contador (ou ao painel do TEC), que é quem fica vivo.
   * Por isso iniciar um bloco aqui também abre aquela janela — sem uma
   * superfície viva, o bloco não acumularia nada.
   */
  let timerState = null;

  function renderBlock() {
    const s = timerState;
    const now = Date.now();
    const row = $('blockrow');
    const running = !!(s && s.running);
    const done = !!(s && s.finished);
    row.classList.toggle('running', running);
    row.classList.toggle('paused', !!s && !running && !done);
    row.classList.toggle('done', done);

    const live = s && !done;
    $('b-presets').style.display = live ? 'none' : 'flex';
    $('b-toggle').style.display = live ? '' : 'none';
    $('b-stop').style.display = live ? '' : 'none';
    $('b-state').textContent = RC.timer.label(s, now).text;

    if (!s) {
      $('b-time').textContent = '0:00';
      $('b-fill').style.width = '0%';
      $('bnote').textContent = 'Iniciar um bloco abre a janela do contador, que é quem mantém a contagem.';
      return;
    }
    const el = RC.timer.elapsedMs(s, now);
    $('b-time').textContent = RC.fmtClock(el);
    $('b-fill').style.width = Math.min(100, (el / s.blockMs) * 100) + '%';
    $('b-toggle').innerHTML = running ? '&#9208;' : '&#9205;';
    $('bnote').textContent = done
      ? 'Bloco fechado. As horas já entraram no total do dia.'
      : 'A contagem corre na janela do contador; fechá-la ou minimizá-la pausa.';
  }

  async function startBlock(minutes) {
    const now = Date.now();
    const fresh = RC.timer.create(Math.max(1, minutes) * 60000, now, RC.dayKey(now));
    fresh.committedMs = 0;
    // owner nulo: a primeira superfície viva assume o bloco.
    timerState = await RC.store.setTimer(RC.timer.resume(fresh, now, null));
    renderBlock();
    chrome.runtime.sendMessage({ type: 'rc:openCounter', block: minutes });
    window.close();
  }

  function renderBlockPresets(presets) {
    const el = $('b-presets');
    el.innerHTML = '';
    for (const min of presets || [45, 56, 75]) {
      const b = document.createElement('button');
      b.className = 'preset';
      b.textContent = `${min}min`;
      b.addEventListener('click', () => startBlock(min));
      el.appendChild(b);
    }
  }

  $('b-toggle').addEventListener('click', async () => {
    if (!timerState) return;
    if (timerState.running) {
      timerState = await RC.store.settleTimer(Date.now(), 'user', false);
    } else {
      timerState = await RC.store.setTimer(RC.timer.resume(timerState, Date.now(), null));
    }
    renderBlock();
  });

  $('b-stop').addEventListener('click', async () => {
    if (!timerState) return;
    timerState = await RC.store.settleTimer(Date.now(), null, true);
    renderBlock();
    render();
  });

  /** Split TEC × PDF: lido dos attempts, sem inflar a árvore de agregados. */
  function renderOrigin(attempts) {
    let tec = 0;
    let pdf = 0;
    for (const a of attempts) {
      if (a.origin === 'pdf') pdf++;
      else tec++;
    }
    return pdf ? `TEC ${tec} · PDF ${pdf}` : '';
  }

  async function render() {
    const { days, subjects, streak, settings, time, attempts } = await RC.store.getAll();
    timerState = await RC.store.getTimer();
    renderBlockPresets(settings.blockPresets);
    renderBlock();
    renderTime(time || {}, days);

    const t = RC.stats.today(days);
    $('t-total').textContent = t.total;
    $('t-hit').textContent = t.hits;
    $('t-miss').textContent = t.misses;
    const tv = t.hits + t.misses;
    $('t-rate').textContent = tv ? Math.round(RC.hitRate(t)) + '%' : '—';

    const goal = Math.max(1, settings.dailyGoal);
    $('fill').style.width = Math.min(100, (t.total / goal) * 100) + '%';
    $('fill').parentElement.classList.toggle('done', t.total >= goal);
    $('goaltxt').textContent = `${t.total} / ${goal} hoje`;

    const w = RC.stats.weekDelta(days);
    const d = $('deltatxt');
    if (w.rateCur != null && w.ratePrev != null) {
      const diff = w.rateCur - w.ratePrev;
      d.className = diff >= 0 ? 'up' : 'down';
      d.textContent = `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)} p.p. vs. semana anterior`;
    } else {
      d.textContent = '';
    }

    $('streak').textContent = `🔥 ${streak.current}`;
    $('streak').title = `Ofensiva atual: ${streak.current} dia(s) · recorde: ${streak.best}`;

    const g = RC.stats.overall(days);
    const gv = g.hits + g.misses;
    $('g-total').textContent = g.total;
    $('g-rate').textContent = gv ? Math.round(RC.hitRate(g)) + '%' : '—';
    $('g-solid').textContent = gv ? Math.round(RC.solidRate(g)) + '%' : '—';
    $('g-avg').textContent = RC.fmtDuration(RC.avgSeconds(g));
    const split = renderOrigin(attempts);
    $('guessnote').textContent =
      (split ? split + ' · ' : '') +
      (g.guesses
        ? `${g.guesses} chute(s), ${g.guessHits} deram certo e não contam como domínio.`
        : 'Marque "🎲 Chutei" para separar sorte de conhecimento.');

    renderSpark(RC.stats.series(days, 30));
    renderSubjects(subjects, settings.minQuestionsPerSubject, $('bymateria').checked);
  }

  $('bymateria').addEventListener('change', render);
  $('opt').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('counter').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'rc:openCounter' });
    window.close();
  });

  $('resetday').addEventListener('click', async () => {
    const { days, time } = await RC.store.getAll();
    const day = RC.dayKey();
    const q = (days[day] || {}).total || 0;
    const ms = (time[day] || {}).totalMs || 0;
    if (!q && !ms) {
      alert('Não há nada registrado hoje.');
      return;
    }
    // O diálogo diz exatamente o que some — "zerar" sem número é um convite a erro.
    const parts = [];
    if (q) parts.push(`${q} questão(ões)`);
    if (ms) parts.push(`${RC.fmtHours(ms)} de horas líquidas`);
    if (!confirm(`Apagar ${parts.join(' e ')} de hoje?\n\nOs dias anteriores não são afetados. Isso não tem volta.`)) return;
    await RC.store.resetDay(day);
    chrome.runtime.sendMessage({ type: 'rc:recorded' }).catch(() => {});
    render();
  });
  $('exp').addEventListener('click', async () => {
    const json = await RC.store.exportJSON();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `gabaritometro-${RC.dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  render();
})();
