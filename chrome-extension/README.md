# WJP Chrome Extension

Detects credit card sign-up confirmation screens on common US bank sites and offers to import them into the user's WJP Debt Tracking account.

## Local install (development)

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this directory

## Production publish (later)

- Add icons to `icons/` (16, 32, 48, 128 px PNGs)
- Bump version in manifest.json
- Zip the directory
- Upload to Chrome Web Store (one-time $5 dev fee)

## Files

- `manifest.json` — MV3 declaration
- `background.js` — service worker, listens for detected cards, manages badge count
- `content.js` — runs on bank sites, scrapes confirmation screens, emits detection events
- `popup.html` / `popup.js` — extension popup UI showing recent detections
- `icons/` — placeholder, replace with real artwork before publish

## Detected sites (matchers in manifest.json)

Chase, Capital One, Discover, Citi, Amex, Wells Fargo, Bank of America, US Bank, Synchrony.
Add more by extending the `content_scripts.matches` array.
