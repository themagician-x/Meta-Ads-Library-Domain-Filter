importScripts('config.js', 'shared.js');

const SYNC_ALARM = 'sheet-sync';

chrome.runtime.onInstalled.addListener(async () => {
  const { enabled, mode } = await chrome.storage.local.get(['enabled', 'mode']);
  await chrome.storage.local.set({ enabled: enabled !== false, mode: mode || 'dim' });
  setup();
});

chrome.runtime.onStartup.addListener(setup);

function setup() {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES });
  syncSheet().catch(() => {});
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) syncSheet().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'sync') {
    syncSheet()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async response
  }
  if (msg?.type === 'syncIfStale') {
    chrome.storage.local.get('lastSync').then(({ lastSync }) => {
      if (!lastSync || Date.now() - lastSync > STALE_AFTER_MINUTES * 60_000) syncSheet().catch(() => {});
    });
  }
});

let syncing = null;

// Downloads the sheet and stores the list of root domains.
// On failure the previous list is kept, so a network hiccup never unhides everything.
function syncSheet() {
  if (!syncing) syncing = doSync().finally(() => (syncing = null));
  return syncing;
}

async function doSync() {
  await chrome.storage.local.set({ syncing: true });
  try {
    const csvUrl = toCsvExportUrl(SHEET_URL || '');
    if (!csvUrl) throw new Error('Sheet link is not set in config.js.');

    const res = await fetch(csvUrl, { credentials: 'include', redirect: 'follow', cache: 'no-store' });
    const text = await res.text();
    if (!res.ok || /^\s*<!doctype html|<html/i.test(text.slice(0, 200))) {
      throw new Error('Sheet is not accessible. Share it as "Anyone with the link can view".');
    }

    const { domains, columnFound } = extractFromCsv(text, LINK_COLUMN);
    if (!domains.size) throw new Error(`No links found in the "${LINK_COLUMN}" column.`);

    const result = {
      domains: [...domains],
      domainCount: domains.size,
      lastSync: Date.now(),
      lastSyncError: columnFound ? '' : `Column "${LINK_COLUMN}" not found — read links from all columns.`
    };
    await chrome.storage.local.set({ ...result, syncing: false });
    return { domainCount: result.domainCount, lastSync: result.lastSync, lastSyncError: result.lastSyncError };
  } catch (err) {
    await chrome.storage.local.set({ lastSyncError: err.message, syncing: false });
    throw err;
  }
}
