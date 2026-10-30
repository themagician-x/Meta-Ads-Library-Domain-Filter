// Runs on facebook.com/ads/library and hides ad cards whose domain is already known.

const LIBRARY_LABEL_RE = /Library ID/i;
const LIBRARY_ID_RE = /Library ID:?\s*(\d{5,})/i;
const PAGE_CHROME_SELECTOR =
  'input[type="search"], input[placeholder*="Search" i], [role="combobox"], [role="navigation"], [role="banner"]';
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
  const scheduleScan = throttle(scan, 300, 1000);
  new MutationObserver((records) => {
    // Ignore changes made inside our own floating control.
    if (records.every((r) => r.target.closest?.('.adf-bar'))) return;
    scheduleScan();
  }).observe(document.body, { childList: true, subtree: true });
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
// ancestor of that label which contains no *other* ad's ID.
//
// Built to survive other extensions (TrendTrack, PPSPY, BrandSearch, …) that inject
// buttons, checkboxes, copied "Library ID" labels or split the ID into links:
// - the "Library ID" text and the number may be in separate nodes,
// - several labels with the same ID inside one card count as one ad,
// - injected inputs inside a card don't stop the climb.
function findCards() {
  const labels = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      LIBRARY_LABEL_RE.test(n.nodeValue) && !n.parentElement?.closest('.adf-bar')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
  });
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    const id = el && libraryIdFor(el);
    if (id) labels.push({ el, key: id }); // labels without a number (e.g. injected "Copy Library ID" buttons) are ignored
  }

  // For every ancestor, the set of distinct ads (IDs) it contains.
  const adsInside = new Map();
  for (const { el, key } of labels) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      let set = adsInside.get(node);
      if (!set) adsInside.set(node, (set = new Set()));
      set.add(key);
    }
  }
  const singleAd = new Set(labels.map((l) => l.key)).size === 1;

  // Climb from each label; when the same ad ID appears in several places
  // (injected copies, extension sidebars), keep the biggest container — the real card.
  const best = new Map();
  for (const { el, key } of labels) {
    let card = el;
    for (let depth = 0; depth < 30; depth++) {
      const parent = card.parentElement;
      if (!parent || parent === document.body || adsInside.get(parent).size !== 1) break;
      if (singleAd && (parent.querySelector(PAGE_CHROME_SELECTOR) || isGridEdge(card, parent))) break;
      card = parent;
    }
    const size = card.getElementsByTagName('*').length;
    if (!best.has(key) || size > best.get(key).size) best.set(key, { card, size });
  }
  return [...best.values()].map((b) => b.card);
}

// With a single ad on screen, nothing else stops the climb: stop once the card holds
// the ad's outbound link and the parent is much wider (i.e. it's the results grid).
function isGridEdge(card, parent) {
  if (!card.offsetWidth || parent.offsetWidth < card.offsetWidth * 1.5) return false;
  return [...card.querySelectorAll('a[href]')].some((a) => {
    const host = normalizeDomain(unwrapFacebookLink(a.href));
    return host && !isIgnored(host);
  });
}

// Reads the numeric ad ID near a "Library ID" label (the number may be in a sibling/child node).
function libraryIdFor(el) {
  for (let node = el, i = 0; node && i < 3; node = node.parentElement, i++) {
    const m = node.textContent.match(LIBRARY_ID_RE);
    if (m) return m[1];
  }
  return null;
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

// Waits for a quiet moment of `wait` ms, but never longer than `maxWait` ms —
// other extensions can change the page constantly, which would starve a plain debounce.
function throttle(fn, wait, maxWait) {
  let timer = null;
  let first = 0;
  return () => {
    const now = Date.now();
    if (!timer) first = now;
    clearTimeout(timer);
    const delay = Math.min(wait, Math.max(0, maxWait - (now - first)));
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
}
