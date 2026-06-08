# SubSleuth Pages

Browser version of SubSleuth for static hosting such as GitHub Pages. This is the recommended way to use SubSleuth.

## What it does

- Step-by-step wizard for Google Takeout export and upload
- **Try demo data** on the welcome screen to explore results without uploading anything
- Parses `watch-history.json` / `.html` and `subscriptions.csv` / `.json`, including `.zip` Takeout archives
- Finds channels you still watch but are not currently subscribed to
- Exports ranked tables as a ZIP (CSV files for not-subscribed, top channels, and inactive subs)
- Runs fully client-side with no app backend

## Hosting on GitHub Pages

This repo is already set up for GitHub Pages deployment with GitHub Actions.

1. Push the repo to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. This has to be turned on once by a repo admin before the workflow can deploy successfully.
4. Push to `main`, or run the **Deploy GitHub Pages** workflow manually.
5. GitHub will publish this folder at `https://<user>.github.io/<repo>/`.

Required files in this folder:

- `index.html`
- `subsleuth.css`
- `subsleuth.js`
- `.nojekyll`

No build step is required.

## Privacy

- **Your Takeout export** is read and analyzed entirely in the browser. It is not uploaded to SubSleuth or any backend.
- **Cached data** may be stored in this browser only so you can refresh and continue without re-uploading. Use **Clear all local data** in Settings or **Start fresh** on Results to wipe it.
- **External requests** are limited to static dependencies and optional channel avatar images.
- **Local only: skip channel images** (Settings) blocks avatar network requests entirely. Channels show initials instead. Your Takeout data still never leaves the browser.

## Troubleshooting

- **Zip upload finds no files:** Make sure the archive is a Google Takeout export with `watch-history.json` or `.html` and `subscriptions.csv` or `.json` somewhere inside it.
- **Extracted Takeout folder:** Use **Choose Takeout folder** (or drag the unzipped `Takeout` folder onto the dropzone). Do not pick files one at a time from deep inside the folder unless you select both watch history and subscriptions together.
- **Everything looks unsubscribed:** Your subscriptions file may be missing. Re-export from Takeout with the subscriptions format enabled.
- **HTML fallback warning:** Takeout did not include `watch-history.json`. HTML parsing works but is slower and less reliable.
- **Large export feels slow:** Very big JSON files may pause the tab briefly while parsing. Leave the tab open until the progress bar finishes.
- **Results after refresh but re-run fails:** The cached import was cleared or blocked. Upload the Takeout zip again.
- **Channel images fail to load:** Turn on **Local only: skip channel images**, or check ad blockers and strict network policies.

## External dependencies

| Dependency | Purpose |
|------------|---------|
| [JSZip](https://www.jsdelivr.com/package/npm/jszip) (jsDelivr CDN) | Parse Takeout `.zip` files in the browser |

## Local preview

Serving over `http://` is recommended. Opening `index.html` directly (`file://`) still works for zip uploads, but folder upload and IndexedDB caching may be limited.

Serve the folder with any static file server:

```bash
python3 -m http.server 8080 --directory subsleuth-pages
```

Then visit `http://localhost:8080`.

## Browser vs CLI

| Browser app (this folder) | Python CLI |
|---------------------------|------------|
| Default for most users | Power users and automation |
| Wizard, filters, exports | `--compare-to` for older exports |
| No install needed | Writes batch files to `output/` |

Use this web app unless you need comparison mode or scripting. See the main [README](../README.md#browser-vs-cli).
