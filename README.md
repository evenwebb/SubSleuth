# SubSleuth

SubSleuth scans your YouTube Google Takeout export and helps you find channels you used to watch heavily but are not currently subscribed to.

It is designed for the "I think YouTube unsubscribed me and I forgot about that channel" problem.

## Browser vs CLI

| | **Browser app** (default) | **Python CLI** (power user) |
|---|---------------------------|-----------------------------|
| Best for | Most people — guided wizard, live filters, sorting, demo | Scripts, automation, batch output to disk |
| Compare two exports | Not yet | `--compare-to` |
| Output | Download CSV/HTML from the page | Writes to `output/` automatically |
| Privacy | Takeout stays local; avatars use CDNs | Fully offline possible (no avatar fetch for CSV) |

**Use the browser app** unless you need comparison mode, cron jobs, or piping results into other tools.

## Browser app

The easiest way to use SubSleuth is the static web UI in [`subsleuth-pages/`](subsleuth-pages/). Host it on GitHub Pages or open `subsleuth-pages/index.html` locally.

The wizard walks you through Takeout export, upload, settings, and results. Your export is parsed in the browser. Results can be filtered, sorted, exported as CSV/HTML, and cached locally so you can tweak settings without re-uploading.

See [`subsleuth-pages/README.md`](subsleuth-pages/README.md) for hosting, privacy notes, and dependencies.

## GitHub-ready deploy checklist

- Push the repo with `main` as the default branch.
- In **Settings → Pages**, choose **Build and deployment → GitHub Actions**.
- Keep the static app in `subsleuth-pages/`; the included workflow deploys that folder automatically.
- Keep `.nojekyll` in `subsleuth-pages/` so GitHub Pages serves the files exactly as-is.
- Do not commit personal Takeout exports. Archives, `input/`, `output/`, caches, and generated files should stay ignored.

## GitHub Actions

- `.github/workflows/tests.yml` runs the Python test suite on pushes and pull requests.
- `.github/workflows/deploy-pages.yml` publishes `subsleuth-pages/` to GitHub Pages on pushes to `main`.

## Recommended repo polish

- Add a GitHub repo description such as `Browser and CLI tool for finding YouTube channels you still watch but are no longer subscribed to.`
- Add topics like `youtube`, `google-takeout`, `github-pages`, `python`, and `static-site`.
- If you later want a custom domain, add `subsleuth-pages/CNAME` and configure DNS before enabling HTTPS in Pages.

## Python CLI

The CLI is for scripting, automation, batch runs, and comparing two exports on disk. Feature parity is close, but the browser app has the richer interactive experience (sortable tables, hide/review flow, demo data, start fresh, and so on).

## What It Does

- Accepts an extracted Takeout folder or a `.zip` Takeout export.
- Finds your most-watched channels that are not in your current subscriptions export.
- Builds a score for likely accidental unsubscribes using watch count, unique videos, recency, rewatch ratio, and repeat viewing over time.
- Flags inactive subscriptions (still subscribed, but no recent watches).
- Includes first watched date, last watched date, and a plain-English explanation for each ranked channel.
- Produces an HTML report and CSV files in `output/`.
- Produces a separate top-channels-overall report for context.
- Supports comparison against an older export to find channels you used to watch more.
- Reads defaults from `config.json`.

## Project Layout

```text
subsleuth/
├── config.json
├── input/
├── output/
├── subsleuth-pages/     # browser app (GitHub Pages)
├── subsleuth.py         # CLI
├── pyproject.toml
└── tests/
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Basic Usage

If your current export is inside `input/`, just run:

```bash
subsleuth
```

You can also point it to an extracted Takeout folder:

```bash
subsleuth /path/to/Takeout
```

Or directly to a Takeout zip file:

```bash
subsleuth /path/to/takeout-2026-06-04.zip
```

## Interactive mode

```bash
subsleuth --interactive
```

Prompts for takeout path, preset, limits, and optional comparison export.

## Comparison Mode

To compare your current export against an older export and see channels you used to watch more often:

```bash
subsleuth /path/to/current-takeout --compare-to /path/to/older-takeout
```

`--compare-to` should be the older export.

## Useful Options

```bash
subsleuth --limit 25
subsleuth --min-videos 5
subsleuth --stale-months 12
subsleuth --output-dir output
subsleuth --config config.json
```

`--stale-months` excludes unsubscribed channels not watched within that many months (`0` disables).

## Output Files

By default SubSleuth writes:

- `output/subsleuth-results.csv`
- `output/subsleuth-top-channels.csv`
- `output/subsleuth-inactive-subs.csv`
- `output/subsleuth-report.html`
- `output/subsleuth-comparison.csv` when `--compare-to` is used

## Config File

`config.json` controls the default run behavior:

```json
{
  "limit": 50,
  "min_videos": 1,
  "stale_months": 0,
  "inactive_recent_months": 6,
  "output_dir": "output",
  "unsubscribed_csv": "subsleuth-results.csv",
  "overall_csv": "subsleuth-top-channels.csv",
  "inactive_csv": "subsleuth-inactive-subs.csv",
  "comparison_csv": "subsleuth-comparison.csv",
  "html_report": "subsleuth-report.html",
  "recent_month_windows": [3, 6, 12]
}
```

## Expected Takeout Files

SubSleuth searches recursively for:

- `watch-history.json` or `watch-history.html`
- `subscriptions.csv` or `subscriptions.json`

## Notes

- Do not commit your Takeout zip or exports — `input/` and `output/` contents are gitignored by default.
- Matching works best when channel IDs, handles, or URLs are present.
- Legacy `/user/` links and newer `@handle` links are normalized together when possible.
- Deleted videos, renamed channels, and incomplete exports can still reduce accuracy.
- Ranking is based on watched video count and behavior patterns, not direct watch time.

## Development

```bash
python3 -m pytest -q
```

For a local Pages preview:

```bash
python3 -m http.server 8080 --directory subsleuth-pages
```
