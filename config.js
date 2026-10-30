// ===== Extension configuration =====

// The shared Google Sheet ("Anyone with the link can view").
// Paste the normal sheet URL — the tab's gid is taken from the URL (defaults to the first tab).
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Ornr9gGDRpad8vZ4YhGu1EkvqFvXSnusmpTRCb89gOo/edit?usp=sharing';

// Header of the column that holds the competitor links.
const LINK_COLUMN = "Competitor's link";

// How often the sheet is re-downloaded in the background.
const SYNC_INTERVAL_MINUTES = 10;

// When an Ads Library page is opened, re-sync if the data is older than this.
const STALE_AFTER_MINUTES = 5;
