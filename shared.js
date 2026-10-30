// Helpers shared by the background worker, popup and content script.

// Domains that should never be treated as "existing" landing pages,
// otherwise every ad (which links to its Facebook page) would be hidden.
const IGNORED_DOMAINS = new Set([
  'facebook.com', 'fb.com', 'fb.me', 'fbcdn.net', 'messenger.com', 'm.me',
  'instagram.com', 'meta.com', 'whatsapp.com', 'wa.me', 'threads.net',
  'google.com', 'goo.gl',
  // Marketplaces: one product link there must not hide every seller's ads.
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.com.au', 'amazon.de', 'amzn.to', 'a.co',
  'ebay.com', 'walmart.com', 'etsy.com', 'aliexpress.com', 'alibaba.com', 'temu.com',
  'tiktok.com', 'target.com', 'shein.com'
]);

// Hosting platforms where each subdomain is a different store/site,
// so "a.myshopify.com" and "b.myshopify.com" must not be treated as the same website.
const PLATFORM_SUFFIXES = [
  'myshopify.com', 'shopifypreview.com', 'replit.app', 'whop.site', 'pagedeck.app',
  'vercel.app', 'netlify.app', 'pages.dev', 'web.app', 'firebaseapp.com', 'github.io',
  'herokuapp.com', 'wixsite.com', 'square.site', 'carrd.co', 'mystrikingly.com',
  'godaddysites.com', 'blogspot.com', 'webflow.io', 'framer.website', 'framer.ai',
  'myclickfunnels.com', 'systeme.io', 'gumroad.com', 'company.site', 'ecwid.com',
  'mybigcommerce.com', 'wordpress.com', 'squarespace.com', 'notion.site', 'linktr.ee'
];

// Second-level labels used under country TLDs, e.g. shop.com.au, brand.co.uk.
const COUNTRY_SECOND_LEVELS = new Set([
  'com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'ltd', 'plc', 'me', 'gen', 'ne', 'or', 'go', 'nom', 'biz', 'info'
]);

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/;

// Turns any URL-ish string into a normalized hostname, or null.
function normalizeDomain(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s || !s.includes('.') || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
  let host;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^www\d*\./, '');
  if (!DOMAIN_RE.test(host)) return null;
  return host;
}

// "try.myoralux.com" -> "myoralux.com", "shop.brand.com.au" -> "brand.com.au",
// "store1.myshopify.com" -> "store1.myshopify.com".
function rootDomain(host) {
  if (!host) return null;
  for (const suffix of PLATFORM_SUFFIXES) {
    if (host === suffix) return host;
    if (host.endsWith('.' + suffix)) {
      const rest = host.slice(0, -suffix.length - 1).split('.');
      return rest[rest.length - 1] + '.' + suffix;
    }
  }
  const parts = host.split('.');
  let keep = 2;
  const tld = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  if (tld.length === 2 && parts.length > 2 && COUNTRY_SECOND_LEVELS.has(second)) keep = 3;
  return parts.slice(-keep).join('.');
}

function isIgnored(host) {
  return IGNORED_DOMAINS.has(rootDomain(host));
}

// Facebook wraps outbound links as l.facebook.com/l.php?u=<real url>.
function unwrapFacebookLink(href) {
  try {
    const u = new URL(href);
    if (/(^|\.)facebook\.com$/.test(u.hostname) && u.pathname === '/l.php') {
      return u.searchParams.get('u') || href;
    }
  } catch {}
  return href;
}

// Minimal RFC 4180 CSV parser (handles quoted cells with commas/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const normalizeHeader = (h) => String(h).trim().toLowerCase().replace(/[’‘`]/g, "'");

// Pulls root domains out of the sheet's CSV export, reading only the link column.
// Falls back to any "link"/"url" column, then to every cell, if the header isn't found.
function extractFromCsv(text, linkColumn) {
  const rows = parseCsv(String(text));
  const header = (rows[0] || []).map(normalizeHeader);
  let col = header.indexOf(normalizeHeader(linkColumn || ''));
  if (col === -1) col = header.findIndex((h) => /link|url/.test(h));
  const cells = col === -1 ? rows.flat() : rows.slice(1).map((r) => r[col] || '');

  const domains = new Set();
  for (const raw of cells) {
    const cell = raw.trim();
    if (!cell || /\s/.test(cell) || !cell.includes('.')) continue;
    const host = normalizeDomain(unwrapFacebookLink(cell));
    if (host && !isIgnored(host)) domains.add(rootDomain(host));
  }
  return { domains, columnFound: col !== -1 };
}

// Converts a normal Google Sheets URL into its CSV export URL.
function toCsvExportUrl(sheetUrl) {
  const url = sheetUrl.trim();
  if (!url) return null;
  if (/output=csv|format=csv|tqx=out:csv/.test(url)) return url; // already CSV
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
}

// True if the host's website (root domain) is in the set.
function domainInSet(host, set) {
  return !!host && set.has(rootDomain(host));
}
