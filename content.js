// Runs on facebook.com/ads/library and hides ad cards whose domain is already known.

const LIBRARY_ID_RE = /Library ID:?\s*\d+/i;
const CAPTION_DOMAIN_RE = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}\/?$/i;

let state = { enabled: true, mode: 'dim', domains: new Set() };
let hiddenCount = 0;
let totalCount = 0;
let badge;

init();

async function init() {
  chrome.runtime.sendMessage({ type: 'syncIfStale' }).catch(() => {});
  await loadState();
  createBadge();
  scan();
  new MutationObserver(debounce(scan, 300)).observe(document.body, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (['enabled', 'mode', 'domains'].some((k) => k in changes)) {
      await loadState();
      scan();
    }
  });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'stats') sendResponse({ hiddenCount, totalCount, mode: state.mode });
  });
}

async function loadState() {
  const s = await chrome.storage.local.get(['enabled', 'mode', 'domains']);
  state = {
    enabled: s.enabled !== false,
    mode: s.mode || 'dim',
    domains: new Set(s.domains || [])
  };
}

// Every ad card contains a "Library ID: 123" label. The card root is the highest
// ancestor of that label which contains no other label.
function findCards() {
  const labels = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (LIBRARY_ID_RE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
  });
  while (walker.nextNode()) labels.push(walker.currentNode.parentElement);

  const counts = new Map();
  for (const label of labels) {
    for (let el = label; el && el !== document.body; el = el.parentElement) {
      counts.set(el, (counts.get(el) || 0) + 1);
    }
  }

  const cards = [];
  for (const label of labels) {
    let card = label;
    for (let depth = 0; depth < 25; depth++) {
      const parent = card.parentElement;
      if (!parent || parent === document.body || counts.get(parent) !== 1) break;
      // Never climb into page chrome (search bar, filters) when only one ad is on screen.
      if (parent.querySelector('input, [role="combobox"], [role="navigation"]')) break;
      card = parent;
    }
    cards.push(card);
  }
  return cards;
}

function cardDomains(card) {
  const hosts = new Set();
  for (const a of card.querySelectorAll('a[href]')) {
    const host = normalizeDomain(unwrapFacebookLink(a.href));
    if (host && !isIgnored(host)) hosts.add(host);
  }
  // The link preview shows the domain as plain text, e.g. "SHOP.EXAMPLE.COM".
  for (const el of card.querySelectorAll('div, span')) {
    if (el.childElementCount) continue;
    const text = el.textContent.trim();
    if (text.length > 80 || !CAPTION_DOMAIN_RE.test(text)) continue;
    const host = normalizeDomain(text);
    if (host && !isIgnored(host)) hosts.add(host);
  }
  return hosts;
}

function scan() {
  let count = 0;
  const cards = findCards();
  for (const card of cards) {
    let match = null;
    if (state.enabled) {
      for (const host of cardDomains(card)) {
        if (domainInSet(host, state.domains)) { match = rootDomain(host); break; }
      }
    }
    applyCard(card, match);
    if (match) count++;
  }
  hiddenCount = count;
  totalCount = cards.length;
  updateBadge();
}

const FADE_MS = 280;

// Card states: '' (normal), 'marked' (red box + overlay), 'hidden' (vanished).
// Only touches the DOM when the state actually changes, so re-scans don't re-trigger animations.
function applyCard(card, match) {
  const target = !match ? '' : state.mode === 'hide' ? 'hidden' : 'marked';
  const current = card.dataset.adfState || '';
  if (match) card.dataset.adfMatch = match;
  if (target === current) return;
  card.dataset.adfState = target;
  clearTimeout(card._adfTimer);

  if (target === '') {
    card.classList.remove('adf-marked', 'adf-hidden', 'adf-leaving');
    delete card.dataset.adfMatch;
    return;
  }

  if (target === 'marked') {
    const wasHidden = card.classList.contains('adf-hidden');
    card.classList.remove('adf-hidden', 'adf-leaving');
    card.classList.add('adf-marked');
    if (wasHidden) {
      // Fade back in from the vanished state.
      card.classList.add('adf-leaving');
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('adf-leaving')));
    }
    return;
  }

  // target === 'hidden': mark it, fade/shrink out, then remove from layout.
  card.classList.add('adf-marked', 'adf-leaving');
  card._adfTimer = setTimeout(() => {
    if (card.dataset.adfState === 'hidden') card.classList.add('adf-hidden');
  }, FADE_MS);
}

async function setMode(mode) {
  state.mode = mode;
  scan();
  await chrome.storage.local.set({ mode });
}

function createBadge() {
  badge = document.createElement('div');
  badge.className = 'adf-bar';
  badge.innerHTML = `
    <button class="adf-count" title="Show existing ads"><span class="adf-dot"></span><span class="adf-text"></span></button>
    <button class="adf-action"></button>`;
  badge.querySelector('.adf-count').addEventListener('click', () => setMode('dim'));
  badge.querySelector('.adf-action').addEventListener('click', () =>
    setMode(state.mode === 'hide' ? 'dim' : 'hide')
  );
  document.body.appendChild(badge);
}

function updateBadge() {
  if (!badge) return;
  badge.style.display = state.enabled ? '' : 'none';
  const vanished = state.mode === 'hide';
  badge.classList.toggle('adf-is-hidden', vanished);
  badge.querySelector('.adf-text').textContent =
    `${hiddenCount} existing ${hiddenCount === 1 ? 'ad' : 'ads'}${vanished ? ' hidden' : ''}`;
  badge.querySelector('.adf-action').textContent = vanished ? 'Show' : 'Vanish';
}

function debounce(fn, ms) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
