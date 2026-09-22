/**
 * Service worker: mantém o badge do ícone com o total de hoje.
 * Sem alarms nem rede — só reage a mudanças no storage.
 */
import '../shared/schema.js';
import '../shared/presence.js';
import '../shared/timer.js';
import '../shared/storage.js';

const RC = globalThis.RC;

async function updateBadge() {
  const { [RC.KEYS.days]: days = {}, [RC.KEYS.settings]: s } = await chrome.storage.local.get([
    RC.KEYS.days,
    RC.KEYS.settings,
  ]);
  const goal = (s && s.dailyGoal) || RC.DEFAULT_SETTINGS.dailyGoal;
  const today = days[RC.dayKey()] || RC.emptyBucket();
  const n = today.total;
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: n >= goal ? '#37d67a' : '#4ea8ff' });
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
/** Content script não alcança chrome.notifications — ele avisa, nós disparamos. */
function notifyBlockFinished(msg) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: `Bloco de ${msg.minutes} min concluído`,
    message: msg.materia
      ? `${msg.minutes} minutos líquidos de ${msg.materia}. Hora da pausa.`
      : `${msg.minutes} minutos líquidos registrados. Hora da pausa.`,
    priority: 2,
  });
}

/**
 * Abre a janela do contador em instância única. Duas janelas contando a mesma
 * lista dariam números divergentes sem nenhum aviso, então se já existe uma,
 * ela é focada em vez de aberta de novo.
 */
const COUNTER_URL = chrome.runtime.getURL('src/counter/counter.html');

async function openCounter(blockMinutes) {
  try {
    // Filtra por prefixo: a URL pode carregar ?block=N.
    const all = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const existing = (all || []).filter((c) => c.documentUrl && c.documentUrl.startsWith(COUNTER_URL));
    if (existing.length) {
      await chrome.windows.update(existing[0].windowId, { focused: true, drawAttention: true });
      return;
    }
  } catch (_) {
    // getContexts não disponível: cai para abrir uma nova.
  }
  const url = blockMinutes ? `${COUNTER_URL}?block=${encodeURIComponent(blockMinutes)}` : COUNTER_URL;
  await chrome.windows.create({ url, type: 'popup', width: 360, height: 680 });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'rc:recorded') updateBadge();
  if (msg.type === 'rc:blockFinished') notifyBlockFinished(msg);
  if (msg.type === 'rc:openCounter') openCounter(msg.block);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[RC.KEYS.days] || changes[RC.KEYS.settings])) updateBadge();
});

updateBadge();
