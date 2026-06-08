import hashlib
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = ROOT / "subsleuth-pages"
JS_PATH = PAGES / "subsleuth.js"
PY_PATH = ROOT / "subsleuth.py"


def test_subsleuth_js_syntax() -> None:
    subprocess.run(["node", "--check", str(JS_PATH)], check=True)


def test_pages_bundle_files_exist() -> None:
    assert (PAGES / "index.html").is_file()
    assert (PAGES / "subsleuth.css").is_file()
    assert JS_PATH.is_file()
    assert (PAGES / ".nojekyll").is_file()


def test_scoring_constants_match_between_cli_and_browser() -> None:
    js_text = JS_PATH.read_text(encoding="utf-8")
    py_text = PY_PATH.read_text(encoding="utf-8")
    names = [
        "SCORE_WATCH_WEIGHT",
        "SCORE_UNIQUE_CAP",
        "SCORE_UNIQUE_WEIGHT",
        "SCORE_RECENCY_MAX",
        "SCORE_RECENCY_DIVISOR",
        "SCORE_SPAN_DIVISOR",
        "SCORE_SPAN_MAX",
    ]
    for name in names:
        py_match = re.search(rf"^{name}\s*=\s*([0-9.]+)", py_text, re.MULTILINE)
        js_match = re.search(rf"const {name}\s*=\s*([0-9.]+)", js_text)
        assert py_match and js_match, f"missing constant {name}"
        assert float(py_match.group(1)) == float(js_match.group(1)), f"{name} mismatch"


def test_jszip_script_has_integrity_attribute() -> None:
    html = (PAGES / "index.html").read_text(encoding="utf-8")
    assert 'integrity="sha384-' in html
    assert "jszip@3.10.1/dist/jszip.min.js" in html


def test_upload_step_supports_takeout_folder_selection() -> None:
    html = (PAGES / "index.html").read_text(encoding="utf-8")
    assert 'id="folderInput"' in html
    assert "webkitdirectory" in html
    assert 'id="browseFolderButton"' in html


def test_wizard_copy_mentions_five_steps() -> None:
    html = (PAGES / "index.html").read_text(encoding="utf-8")
    assert "Five steps" in html
    assert "Step 1 of 5" in html


def test_settings_copy_does_not_claim_automatic_rescore() -> None:
    html = (PAGES / "index.html").read_text(encoding="utf-8")
    assert "re-score your import automatically" not in html
    assert "without re-uploading" in html


def test_preset_description_defaults_to_balanced() -> None:
    html = (PAGES / "index.html").read_text(encoding="utf-8")
    assert "Balanced: good default for most exports." in html


def test_demo_cta_points_to_upload_step() -> None:
    js = JS_PATH.read_text(encoding="utf-8")
    assert 'demoCtaButton.addEventListener("click", () => setWizardStep("upload"))' in js


def test_preset_values_match_cli() -> None:
    js_text = JS_PATH.read_text(encoding="utf-8")
    py_text = PY_PATH.read_text(encoding="utf-8")
    for preset in ("focused", "balanced", "explore"):
        for field, py_key in (("minVideos", "min_videos"), ("limit", "limit"), ("staleMonths", "stale_months")):
            py_match = re.search(rf'"{preset}": \{{[^}}]*"{py_key}": (\d+)', py_text)
            js_match = re.search(rf'{preset}: \{{[^}}]*{field}: (\d+)', js_text)
            assert py_match and js_match, f"missing preset field {preset}.{field}"
            assert int(py_match.group(1)) == int(js_match.group(1))


def test_subsleuth_js_is_cache_busted_in_html() -> None:
    html = (PAGES / "index.html").read_text(encoding="utf-8")
    assert "subsleuth.js?v=" in html
    assert "subsleuth.css?v=" in html


def test_index_html_uses_external_stylesheet_not_inline_css() -> None:
    html = (PAGES / "index.html").read_text(encoding="utf-8")
    assert "<style>" not in html
    assert 'rel="stylesheet"' in html
    assert 'rel="preload"' in html
    assert 'name="description"' in html
    assert 'rel="preconnect"' in html
    assert 'class="skip-link"' in html
    assert 'aria-controls="panelWelcome"' in html


def test_stylesheet_has_render_perf_rules() -> None:
    css = (PAGES / "subsleuth.css").read_text(encoding="utf-8")
    assert "content-visibility:hidden" in css.replace(" ", "")
    assert "color-scheme:light" in css.replace(" ", "")


def test_pages_readme_documents_demo_mode() -> None:
    readme = (PAGES / "README.md").read_text(encoding="utf-8")
    assert "demo data" in readme.lower()
