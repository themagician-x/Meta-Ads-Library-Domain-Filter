<p align="center">
  <img src="icons/icon128.png" width="96" alt="Meta Ads Library Domain Filter logo" />
</p>

<h1 align="center">Meta Ads Library Domain Filter</h1>

<p align="center">
  A Chrome extension that hides (or highlights) ads in the <a href="https://www.facebook.com/ads/library/">Meta Ads Library</a>
  whose website is already in our product research Google Sheet, so you only see <b>new</b> competitors.
</p>

---

## Features

- **Hides ads you've already found.** Any ad that links to a website from the sheet's **Competitor's link** column is flagged.
- **Two modes:**
  - **Highlight** puts a red box, a red overlay and an *"Already in sheet · domain.com"* label on the ad.
  - **Vanish** removes those ads from the results completely.
- **Floating control** in the bottom-right corner of the Ads Library page shows how many existing ads are on screen. Switch between *Vanish* and *Show* with one click.
- **Auto-sync** pulls the latest sheet every 10 minutes and whenever you open the Ads Library. No setup needed.
- **Matches the whole website.** If the sheet has `try.brand.com`, ads for `brand.com` or `shop.brand.com` are caught too. Country domains (`.com.au`, `.co.uk`, …) and Shopify stores are handled correctly.
- **Works with infinite scroll.** New ads are checked as they load.

## Install (2 minutes)

1. **Download** the extension:
   [**⬇ Download ZIP**](https://github.com/themagician-x/Meta-Ads-Library-Domain-Filter/archive/refs/heads/main.zip)
   (or click the green **Code** button → **Download ZIP**).
2. **Unzip** it. You'll get a folder called `Meta-Ads-Library-Domain-Filter-main`.
3. Open Chrome and go to **`chrome://extensions`**.
4. Turn on **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
6. Pin the extension: click the 🧩 puzzle icon in the toolbar, then the 📌 pin next to *Ads Library Domain Filter*.

That's it. Open the [Ads Library](https://www.facebook.com/ads/library/), search for anything, and ads that are already in the sheet will be flagged.

> Don't delete or move the unzipped folder after installing. Chrome loads the extension from it.

## Usage

| Where | What you can do |
|---|---|
| **Popup** (toolbar icon) | Turn filtering on/off, switch *Vanish / Highlight*, see how many websites are in the sheet and how many existing ads are on the current page, and force a **Sync now**. |
| **Page control** (bottom-right) | `● 12 existing ads  [Vanish]`. Click **Vanish** to remove them, then **Show** to bring them back highlighted. |

## Updating

When a new version is pushed here:

1. Download the ZIP again and replace the old folder's contents with the new files.
2. Go to `chrome://extensions` and click the **↻ reload** icon on the extension.

Sheet data does **not** need an extension update. New rows in the sheet are picked up automatically.

## How it works

- The sheet is downloaded as CSV (`config.js` → `SHEET_URL`) and only the **Competitor's link** column is read.
- Each link is reduced to its root website (e.g. `https://try.myoralux.com/product?utm=…` → `myoralux.com`).
- On the Ads Library page, each ad card's outbound links and its domain caption are compared against that list.
- Facebook/Instagram links and big marketplaces (Amazon, eBay, Etsy, AliExpress, Temu, …) are ignored, so a single marketplace link can't hide every ad.

### Configuration

Edit [`config.js`](config.js):

| Setting | Default | Meaning |
|---|---|---|
| `SHEET_URL` | team sheet | Google Sheet link (must be shared as *Anyone with the link can view*) |
| `LINK_COLUMN` | `Competitor's link` | Column header holding competitor links |
| `SYNC_INTERVAL_MINUTES` | `10` | Background sync interval |
| `STALE_AFTER_MINUTES` | `5` | Re-sync when an Ads Library page opens and data is older than this |

### Project structure

```
manifest.json   Chrome extension manifest (MV3)
config.js       Sheet link and sync settings
shared.js       Domain parsing / matching helpers (used everywhere)
background.js   Downloads and syncs the sheet
content.js      Finds ad cards on the Ads Library page and flags matches
content.css     Red box, overlay, label and floating control styles
popup.*         Extension popup UI
icons/          Extension icons
```

## Troubleshooting

- **Nothing is flagged.** Open the popup and check that *websites in sheet* shows a number and the footer dot is green. Click **Sync now**.
- **"Sheet is not accessible".** The sheet must be shared as *Anyone with the link can view*.
- **Facebook in another language.** Ads are detected using the English *"Library ID"* label, so set Facebook to English.

---

<p align="center">Developed with ♥ by <b>Aqeel Ahmed</b></p>
