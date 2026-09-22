(() => {
  'use strict';
  const RC = globalThis.RC;
  const $ = (id) => document.getElementById(id);

  let statusTimer = null;
  function say(msg, bad) {
    const el = $('status');
    el.textContent = msg;
    el.style.color = bad ? '#ff6b6b' : '#37d67a';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (el.textContent = ''), 4000);
  }

  async function load() {
    const { settings, attempts, days } = await RC.store.getAll();
    $('goal').value = settings.dailyGoal;
    $('slow').value = settings.slowThresholdSec;
    $('minsample').value = settings.minQuestionsPerSubject;
    $('mode').value = settings.countMode;
    $('simsize').value = settings.simuladoSize;
    $('presets').value = (settings.blockPresets || []).join(', ');
    $('idle').value = settings.idleMinutes;
    $('panel').checked = settings.panelEnabled;
    $('summary').textContent = `${attempts.length} questões registradas em ${Object.keys(days).length} dia(s).`;
  }

  const save = (patch) => RC.store.setSettings(patch).then(() => say('Salvo.'));

  $('goal').addEventListener('change', (e) => save({ dailyGoal: Math.max(1, +e.target.value || 1) }));
  $('slow').addEventListener('change', (e) => save({ slowThresholdSec: Math.max(10, +e.target.value || 180) }));
  $('minsample').addEventListener('change', (e) => save({ minQuestionsPerSubject: Math.max(1, +e.target.value || 5) }));
  $('mode').addEventListener('change', (e) => save({ countMode: e.target.value }));
  $('simsize').addEventListener('change', (e) => save({ simuladoSize: Math.max(1, +e.target.value || 20) }));
  $('idle').addEventListener('change', (e) => save({ idleMinutes: Math.max(1, +e.target.value || 5) }));
  $('presets').addEventListener('change', (e) => {
    const list = e.target.value
      .split(/[,;\s]+/)
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 4);
    if (!list.length) {
      say('Informe ao menos uma duração válida.', true);
      e.target.value = (RC.DEFAULT_SETTINGS.blockPresets || []).join(', ');
      return;
    }
    save({ blockPresets: list });
    e.target.value = list.join(', ');
  });
  $('panel').addEventListener('change', (e) => save({ panelEnabled: e.target.checked }));

  $('exp').addEventListener('click', async () => {
    const json = await RC.store.exportJSON();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `gabaritometro-${RC.dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  $('imp').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await RC.store.importJSON(await f.text());
      say(`Importado: ${r.added} novas, ${r.total} no total.`);
      load();
    } catch (err) {
      say('Falha ao importar: ' + err.message, true);
    }
    e.target.value = '';
  });

  $('reset').addEventListener('click', async () => {
    if (!confirm('Apagar TODO o histórico de questões? As configurações são mantidas. Isso não tem volta.')) return;
    await RC.store.reset();
    say('Histórico apagado.');
    load();
  });

  load();
})();
