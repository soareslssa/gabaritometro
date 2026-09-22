/**
 * Janela do contador manual — para questões que você resolve fora do TEC
 * (PDF aberto no Chrome, prova impressa, tablet).
 *
 * É uma página da própria extensão aberta como janela destacada, e não o popup
 * do ícone: o popup fecha ao primeiro clique fora dele, o que o torna inútil
 * para contar enquanto se lê um PDF. Sendo página da extensão, tem acesso ao
 * chrome.storage sem precisar de permissão para ler os sites que você visita.
 */
(() => {
  'use strict';
  const RC = globalThis.RC;
  const $ = (id) => document.getElementById(id);

  let list = null;
  let guessArmed = false;
  let lastSavedId = null;
  let questionStart = Date.now();
  let lastMateria = null;

  // ---- sugestões a partir do que você já estudou --------------------------
  async function fillSuggestions() {
    const { subjects, attempts } = await RC.store.getAll();
    const materias = new Set();
    const assuntos = new Set();
    for (const key of Object.keys(subjects)) {
      const [m, a] = key.split('||');
      if (m && m !== '—') materias.add(m);
      if (a && a !== '—') assuntos.add(a);
    }
    const bancas = new Set(attempts.map((a) => a.banca).filter(Boolean));
    const put = (el, values) => {
      el.innerHTML = '';
      for (const v of [...values].sort()) {
        const o = document.createElement('option');
        o.value = v;
        el.appendChild(o);
      }
    };
    put($('materias'), materias);
    put($('assuntos'), assuntos);
    put($('bancas'), bancas);
  }

  // ---- renderização --------------------------------------------------------
  function show(section) {
    for (const id of ['setup', 'running', 'done']) $(id).hidden = id !== section;
  }

  function renderList() {
    if (!list) {
      show('setup');
      $('setupnote').textContent = lastMateria
        ? `Última matéria: ${lastMateria}`
        : 'Os registros entram nas mesmas estatísticas do TEC, marcados como PDF.';
      return;
    }
    const valid = list.hits + list.misses;
    const label = [list.materia, list.assunto, list.banca].filter(Boolean).join(' › ') || 'Lista';

    if (list.finishedAt) {
      show('done');
      $('d-total').textContent = list.total;
      $('d-rate').textContent = valid ? Math.round((list.hits / valid) * 100) + '%' : '—';
      $('d-avg').textContent = list.total ? RC.fmtDuration(list.seconds / list.total) : '—';
      $('donenote').textContent =
        `${label} · ${list.hits} certas, ${list.misses} erradas` +
        (list.voids ? `, ${list.voids} anuladas` : '') +
        ` · ${RC.fmtDuration(list.seconds)}`;
      return;
    }

    show('running');
    $('listlabel').textContent = list.name ? `${list.name} — ${label}` : label;
    $('listelapsed').textContent = RC.fmtDuration(list.seconds);
    $('l-total').textContent = list.total;
    $('l-hit').textContent = list.hits;
    $('l-miss').textContent = list.misses;
    $('l-rate').textContent = valid ? Math.round((list.hits / valid) * 100) + '%' : '—';
    $('b-guess').classList.toggle('on', guessArmed);
  }

  // ---- ações ---------------------------------------------------------------
  async function record(correct) {
    if (!list || list.finishedAt) return;
    const { id, listId } = await RC.store.nextListId();
    const seconds = (Date.now() - questionStart) / 1000;

    const res = await RC.store.record({
      id,
      listId,
      origin: 'pdf',
      source: 'manual',
      correct,
      anulada: correct === null,
      materia: list.materia,
      assunto: list.assunto,
      banca: list.banca,
      seconds,
      guessed: guessArmed,
    });

    lastSavedId = res.id;
    guessArmed = false;
    questionStart = Date.now();
    list = res.list || (await RC.store.getList());
    chrome.runtime.sendMessage({ type: 'rc:recorded' }).catch(() => {});
    renderList();
  }

  $('start').addEventListener('click', async () => {
    const materia = $('materia').value.trim();
    if (!materia) {
      $('materia').focus();
      $('setupnote').textContent = 'Informe ao menos a matéria.';
      return;
    }
    list = await RC.store.startList({
      origin: 'pdf',
      materia,
      assunto: $('assunto').value.trim() || null,
      banca: $('banca').value.trim() || null,
      name: $('nome').value.trim() || null,
    });
    lastMateria = materia;
    questionStart = Date.now();
    renderList();
  });

  $('b-ok').addEventListener('click', () => record(true));
  $('b-no').addEventListener('click', () => record(false));
  $('b-nul').addEventListener('click', () => record(null));

  $('b-guess').addEventListener('click', async () => {
    // Antes de responder, arma. Depois de responder, aplica no último registro.
    if (lastSavedId) {
      const r = await RC.store.setGuess(lastSavedId, true);
      $('runnote').textContent = r.changed ? 'última marcada como chute' : 'já estava marcada';
      return;
    }
    guessArmed = !guessArmed;
    $('b-guess').classList.toggle('on', guessArmed);
  });

  $('b-undo').addEventListener('click', async () => {
    const r = await RC.store.undoLast();
    if (!r.undone) return;
    lastSavedId = null;
    list = r.list || (await RC.store.getList());
    chrome.runtime.sendMessage({ type: 'rc:recorded' }).catch(() => {});
    renderList();
  });

  $('finish').addEventListener('click', async () => {
    list = await RC.store.finishList();
    lastSavedId = null;
    renderList();
  });

  $('again').addEventListener('click', async () => {
    const prev = list;
    await RC.store.clearList();
    list = null;
    // Pré-preenche com a matéria anterior: repetir é um clique, trocar é editar.
    if (prev) {
      $('materia').value = prev.materia || '';
      $('assunto').value = '';
      $('banca').value = prev.banca || '';
      $('nome').value = '';
      lastMateria = prev.materia || null;
    }
    renderList();
    $('materia').focus();
  });

  $('openpopup').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html') });
  });

  // ---- bloco de horas líquidas ---------------------------------------------
  // Esta janela é a âncora do bloco quando você estuda fora do TEC: enquanto
  // ela estiver visível, o cronômetro corre mesmo com o PDF em foco.
  let settings = RC.DEFAULT_SETTINGS;

  function renderPresets() {
    RC.blockPicker.render($('b-presets'), settings.blockPresets, (min) => RC.clock.start(min));
  }

  function renderClock(s) {
    const now = Date.now();
    const box = $('blockbox');
    const running = !!(s && s.running);
    const done = !!(s && s.finished);
    box.classList.toggle('running', running);
    box.classList.toggle('paused', !!s && !running && !done);
    box.classList.toggle('done', done);

    const live = s && !done;
    $('b-presets').style.display = live ? 'none' : 'flex';
    $('b-toggle').style.display = live ? '' : 'none';
    $('b-stop').style.display = live ? '' : 'none';

    const lbl = RC.timer.label(s, now);
    $('b-state').textContent = lbl.text;

    if (!s) {
      $('b-time').textContent = '0:00';
      $('b-target').textContent = 'hora líquida';
      $('b-fill').style.width = '0%';
      return;
    }
    const el = RC.timer.elapsedMs(s, now);
    $('b-time').textContent = RC.fmtClock(el);
    $('b-target').textContent = `/ ${RC.fmtClock(s.blockMs)}`;
    $('b-fill').style.width = Math.min(100, (el / s.blockMs) * 100) + '%';
    $('b-toggle').innerHTML = running ? '&#9208;' : '&#9205;';
  }

  $('b-toggle').addEventListener('click', () => RC.clock.toggle());
  $('b-stop').addEventListener('click', () => RC.clock.stop());
  $('b-state').addEventListener('click', () => {
    const s = RC.clock.state;
    if (s && s.finished) RC.clock.dismiss();
  });
  RC.clock.onChange(renderClock);
  // O relógio precisa andar mesmo sem evento: o tique do clock só emite quando
  // o bloco está rodando e esta janela é a dona.
  setInterval(() => renderClock(RC.clock.state), 1000);

  // O cronômetro por questão é só visual; o valor gravado usa questionStart.
  setInterval(() => {
    if (list && !list.finishedAt) {
      $('runnote').textContent = '⏱ ' + RC.fmtDuration((Date.now() - questionStart) / 1000) + ' nesta questão';
    }
  }, 1000);

  // ---- boot ----------------------------------------------------------------
  (async () => {
    settings = await RC.store.getSettings();
    await fillSuggestions();
    list = await RC.store.getList();
    if (list && list.materia) lastMateria = list.materia;
    questionStart = Date.now();
    renderList();
    renderPresets();
    renderClock(RC.clock.state);

    // O popup pede "abra a janela já com um bloco de N min rodando".
    const params = new URLSearchParams(location.search);
    const startMin = parseInt(params.get('block'), 10);
    if (Number.isFinite(startMin) && startMin > 0 && !RC.clock.state) {
      await RC.clock.start(startMin);
    }

    if (!list) $('materia').focus();
  })();

  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes[RC.KEYS.list]) {
      list = await RC.store.getList();
      renderList();
    }
  });
})();
