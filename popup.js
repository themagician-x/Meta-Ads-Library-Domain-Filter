const $ = (id) => document.getElementById(id);

init();

async function init() {
  const s = await chrome.storage.local.get(['enabled', 'mode', 'domainCount', 'lastSync', 'lastSyncError', 'syncing']);
  renderEnabled(s.enabled !== false);
  renderMode(s.mode || 'dim');
  renderSync(s);

  $('enabled').addEventListener('change', () => {
    renderEnabled($('enabled').checked);
    chrome.storage.local.set({ enabled: $('enabled').checked });
  });
  document.querySelectorAll('.segmented button').forEach((btn) =>
    btn.addEventListener('click', () => {
      renderMode(btn.dataset.mode);
      chrome.storage.local.set({ mode: btn.dataset.mode });
    })
  );
  $('sync').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {}));

  // Keep the popup live while it's open.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if ('mode' in changes) renderMode(changes.mode.newValue);
    if ('enabled' in changes) renderEnabled(changes.enabled.newValue !== false);
    renderSync(await chrome.storage.local.get(['domainCount', 'lastSync', 'lastSyncError', 'syncing']));
  });
  refreshPageStats();
  setInterval(refreshPageStats, 1000);
  setInterval(async () => renderSync(await chrome.storage.local.get(['domainCount', 'lastSync', 'lastSyncError', 'syncing'])), 30_000);
}

async function refreshPageStats() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let res = null;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'stats' });
  } catch {
    // Not an Ads Library tab (no content script there).
  }
  if (!res) {
    $('hiddenCount').textContent = '–';
    $('hiddenLabel').textContent = 'open the Ads Library';
    return;
  }
  $('hiddenCount').textContent = res.hiddenCount;
  $('hiddenLabel').textContent = `existing of ${res.totalCount} ads on this page`;
}

function renderEnabled(on) {
  $('enabled').checked = on;
  document.body.classList.toggle('disabled', !on);
}

function renderMode(mode) {
  document.querySelectorAll('.segmented button').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active);
  });
}

function renderSync(s) {
  $('domainCount').textContent = s.domainCount ? s.domainCount.toLocaleString() : '–';
  $('error').hidden = !s.lastSyncError;
  $('error').textContent = s.lastSyncError || '';
  $('sync').disabled = !!s.syncing;

  const dot = $('syncDot');
  dot.className = 'dot ' + (s.syncing ? 'busy' : s.lastSyncError ? 'err' : s.lastSync ? 'ok' : '');
  $('syncText').textContent = s.syncing
    ? 'Syncing…'
    : s.lastSync
      ? `Synced ${timeAgo(s.lastSync)} · auto every 10 min`
      : 'Not synced yet';
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : new Date(ts).toLocaleDateString();
}
