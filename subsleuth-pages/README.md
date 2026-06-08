# SubSleuth Pages

Browser version of SubSleuth for static hosting such as GitHub Pages. This is the recommended way to use SubSleuth.

## What it does

- Step-by-step wizard for Google Takeout export and upload
- Parses `watch-history.json` / `.html` and `subscriptions.csv` / `.json`, including `.zip` Takeout archives
- Finds channels you still watch but are not currently subscribed to
- Exports a ranked CSV directly from the browser
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
- `subsleuth.js`
- `.nojekyll`

No build step is required.

## Privacy

- **Your Takeout export** is read and analyzed entirely in the browser. It is not uploaded to SubSleuth or any backend.
- **Cached data** may be stored in this browser only so you can refresh and continue without re-uploading.
- **External requests** are limited to static dependencies and any image/avatar URLs used by the page.

## External dependencies

| Dependency | Purpose |
|------------|---------|
| [JSZip](https://www.jsdelivr.com/package/npm/jszip) (jsDelivr CDN) | Parse Takeout `.zip` files in the browser |

## Local preview

Open `index.html` in a modern browser, or serve the folder with any static file server:

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
