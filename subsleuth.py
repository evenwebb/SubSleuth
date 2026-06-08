from __future__ import annotations

import argparse
import csv
import html
import json
import re
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit


CHANNEL_ID_PATTERN = re.compile(r"/channel/([A-Za-z0-9_-]+)")
HANDLE_PATTERN = re.compile(r"/@([A-Za-z0-9._-]+)")
USER_PATTERN = re.compile(r"/user/([A-Za-z0-9._-]+)")
CUSTOM_PATTERN = re.compile(r"/c/([A-Za-z0-9._-]+)")
WATCH_HISTORY_FILENAMES = {"watch-history.json", "watch-history.html"}
SUBSCRIPTION_FILENAMES = {"subscriptions.csv", "subscriptions.json"}

DEFAULT_INPUT_PATH = Path("input")
DEFAULT_OUTPUT_DIR = Path("output")
DEFAULT_CONFIG_PATH = Path("config.json")
DEFAULT_RECENT_MONTHS = [3, 6, 12]
LARGE_FILE_BYTES = 8 * 1024 * 1024
PROGRESS_FILE_BYTES = 1024 * 1024
PRESETS = {
    "focused": {"limit": 12, "min_videos": 3, "stale_months": 12},
    "balanced": {"limit": 18, "min_videos": 3, "stale_months": 0},
    "explore": {"limit": 24, "min_videos": 2, "stale_months": 0},
}


@dataclass(frozen=True)
class AppConfig:
    limit: int = 50
    min_videos: int = 1
    stale_months: int = 0
    inactive_recent_months: int = 6
    output_dir: Path = DEFAULT_OUTPUT_DIR
    unsubscribed_csv: str = "subsleuth-results.csv"
    overall_csv: str = "subsleuth-top-channels.csv"
    inactive_csv: str = "subsleuth-inactive-subs.csv"
    comparison_csv: str = "subsleuth-comparison.csv"
    html_report: str = "subsleuth-report.html"
    recent_month_windows: tuple[int, ...] = (3, 6, 12)


@dataclass(frozen=True)
class ChannelRef:
    name: str
    url: str | None = None
    channel_id: str | None = None
    alias: str | None = None


@dataclass(frozen=True)
class ChannelWatchStat:
    channel_name: str
    watch_count: int
    unique_video_count: int
    first_watched: datetime | None
    last_watched: datetime | None
    channel_url: str | None = None
    channel_id: str | None = None
    score: float = 0.0
    explanation: str = ""


@dataclass(frozen=True)
class ImportDiagnostics:
    watch_json_files: tuple[Path, ...]
    watch_html_files: tuple[Path, ...]
    subscription_files: tuple[Path, ...]
    total_watch_bytes: int
    using_html_fallback: bool
    memory_warning: str | None = None

    @property
    def watch_file_count(self) -> int:
        return len(self.watch_json_files) + len(self.watch_html_files)


@dataclass(frozen=True)
class TakeoutAnalysis:
    overall_channels: list[ChannelWatchStat]
    unsubscribed_channels: list[ChannelWatchStat]
    inactive_subscriptions: list[ChannelWatchStat]
    watch_files: list[Path]
    subscription_files: list[Path]
    diagnostics: ImportDiagnostics


@dataclass(frozen=True)
class ComparisonStat:
    channel_name: str
    older_watch_count: int
    current_watch_count: int
    watch_drop: int
    channel_url: str | None
    explanation: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="subsleuth",
        description=(
            "Find YouTube channels you watched the most videos from but are not "
            "currently subscribed to, using a Google Takeout export."
        ),
    )
    parser.add_argument(
        "takeout_path",
        nargs="?",
        type=Path,
        default=DEFAULT_INPUT_PATH,
        help="Path to the current Takeout folder or zip file. Defaults to ./input",
    )
    parser.add_argument(
        "--compare-to",
        type=Path,
        help="Optional older Takeout folder or zip file to compare against the current export.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG_PATH,
        help="Path to a JSON config file. Defaults to ./config.json",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Maximum number of rows to show and save.",
    )
    parser.add_argument(
        "--min-videos",
        type=int,
        help="Only include channels with at least this many watched videos.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directory for CSV and HTML outputs.",
    )
    parser.add_argument(
        "--stale-months",
        type=int,
        help="Exclude unsubscribed channels not watched within this many months (0 disables).",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Prompt for takeout path, preset, and limits instead of using only CLI flags.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    config = load_config(args.config)
    if args.interactive:
        args = run_interactive_prompts(args, config)

    limit = args.limit if args.limit is not None else config.limit
    min_videos = args.min_videos if args.min_videos is not None else config.min_videos
    stale_months = args.stale_months if args.stale_months is not None else config.stale_months
    output_dir = (args.output_dir or config.output_dir).expanduser().resolve()
    current_path = args.takeout_path.expanduser().resolve()
    older_path = args.compare_to.expanduser().resolve() if args.compare_to else None

    if limit <= 0:
        parser.error("--limit must be greater than 0")
    if min_videos <= 0:
        parser.error("--min-videos must be greater than 0")
    if stale_months < 0:
        parser.error("--stale-months must be 0 or greater")
    if not current_path.exists():
        parser.error(f"path does not exist: {current_path}")
    if older_path and not older_path.exists():
        parser.error(f"comparison path does not exist: {older_path}")

    now = datetime.now(UTC)

    with tempfile.TemporaryDirectory(prefix="subsleuth-") as tmp_dir:
        temp_root = Path(tmp_dir)
        current_root = prepare_takeout_source(current_path, temp_root / "current")
        current_analysis = analyze_takeout(
            current_root,
            now=now,
            min_videos=min_videos,
            stale_months=stale_months,
            inactive_recent_months=config.inactive_recent_months,
        )

        comparison = None
        if older_path:
            older_root = prepare_takeout_source(older_path, temp_root / "older")
            older_analysis = analyze_takeout(
                older_root,
                now=now,
                min_videos=min_videos,
                stale_months=stale_months,
                inactive_recent_months=config.inactive_recent_months,
            )
            comparison = compare_analyses(current_analysis, older_analysis, limit=limit)

        output_dir.mkdir(parents=True, exist_ok=True)
        unsubscribed_csv = output_dir / config.unsubscribed_csv
        overall_csv = output_dir / config.overall_csv
        inactive_csv = output_dir / config.inactive_csv
        comparison_csv = output_dir / config.comparison_csv
        html_report = output_dir / config.html_report

        write_channel_csv(unsubscribed_csv, current_analysis.unsubscribed_channels, limit=limit)
        write_channel_csv(overall_csv, current_analysis.overall_channels, limit=limit)
        write_channel_csv(inactive_csv, current_analysis.inactive_subscriptions, limit=limit)
        if comparison is not None:
            write_comparison_csv(comparison_csv, comparison)
        write_html_report(
            html_report,
            current_analysis,
            limit=limit,
            recent_months=config.recent_month_windows,
            comparison=comparison,
            older_path=older_path,
            inactive_recent_months=config.inactive_recent_months,
        )

    print_import_summary(current_path, current_analysis)
    print(f"Unsubscribed CSV: {unsubscribed_csv}")
    print(f"Overall CSV: {overall_csv}")
    print(f"Inactive subs CSV: {inactive_csv}")
    print(f"HTML report: {html_report}")
    if comparison is not None:
        print(f"Comparison CSV: {comparison_csv}")
    print()
    print(format_table(current_analysis.unsubscribed_channels, limit=limit))

    return 0


def run_interactive_prompts(args: argparse.Namespace, config: AppConfig) -> argparse.Namespace:
    print("SubSleuth interactive mode")
    path_input = input(f"Takeout folder or zip [{args.takeout_path}]: ").strip()
    if path_input:
        args.takeout_path = Path(path_input)

    preset_input = input("Preset (focused/balanced/explore) [balanced]: ").strip().lower() or "balanced"
    preset = PRESETS.get(preset_input, PRESETS["balanced"])
    if args.limit is None:
        args.limit = preset["limit"]
    if args.min_videos is None:
        args.min_videos = preset["min_videos"]
    if args.stale_months is None:
        args.stale_months = preset["stale_months"]

    if args.limit is None:
        args.limit = config.limit
    if args.min_videos is None:
        args.min_videos = config.min_videos
    if args.stale_months is None:
        args.stale_months = config.stale_months

    compare_input = input("Older Takeout to compare against (optional): ").strip()
    if compare_input:
        args.compare_to = Path(compare_input)
    return args


def print_import_summary(source: Path, analysis: TakeoutAnalysis) -> None:
    diag = analysis.diagnostics
    print(f"Input source: {source}")
    print(f"Watch history files: {diag.watch_file_count}")
    for path in diag.watch_json_files:
        print(f"  JSON: {path.name}")
    for path in diag.watch_html_files:
        print(f"  HTML: {path.name}")
    if diag.using_html_fallback:
        print("Note: no watch-history.json found; parsed watch-history.html instead.")
    print(f"Subscription files found: {len(analysis.subscription_files)}")
    print(f"Total watch-history size: {format_bytes(diag.total_watch_bytes)}")
    if diag.memory_warning:
        print(f"Warning: {diag.memory_warning}")
    print(f"Inactive subscriptions (no recent watches): {len(analysis.inactive_subscriptions)}")


def load_config(path: Path) -> AppConfig:
    if not path.exists():
        return AppConfig()

    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return AppConfig()

    recent_windows = tuple(
        value for value in data.get("recent_month_windows", DEFAULT_RECENT_MONTHS)
        if isinstance(value, int) and value > 0
    )
    return AppConfig(
        limit=as_positive_int(data.get("limit"), 50),
        min_videos=as_positive_int(data.get("min_videos"), 1),
        stale_months=max(0, int(data["stale_months"])) if isinstance(data.get("stale_months"), int) else 0,
        inactive_recent_months=as_positive_int(data.get("inactive_recent_months"), 6),
        output_dir=Path(data.get("output_dir", str(DEFAULT_OUTPUT_DIR))),
        unsubscribed_csv=as_non_empty_string(data.get("unsubscribed_csv"), "subsleuth-results.csv"),
        overall_csv=as_non_empty_string(data.get("overall_csv"), "subsleuth-top-channels.csv"),
        inactive_csv=as_non_empty_string(data.get("inactive_csv"), "subsleuth-inactive-subs.csv"),
        comparison_csv=as_non_empty_string(data.get("comparison_csv"), "subsleuth-comparison.csv"),
        html_report=as_non_empty_string(data.get("html_report"), "subsleuth-report.html"),
        recent_month_windows=recent_windows or tuple(DEFAULT_RECENT_MONTHS),
    )


def prepare_takeout_source(source: Path, extract_root: Path) -> Path:
    if source.is_dir():
        return source

    if source.is_file() and source.suffix.lower() == ".zip":
        extract_root.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(source) as archive:
            archive.extractall(extract_root)
        return extract_root

    return source


def analyze_takeout(
    root: Path,
    *,
    now: datetime,
    min_videos: int,
    stale_months: int = 0,
    inactive_recent_months: int = 6,
) -> TakeoutAnalysis:
    watch_files, subscription_files = discover_files(root)
    diagnostics = build_import_diagnostics(watch_files, subscription_files)
    if diagnostics.memory_warning:
        print(f"Warning: {diagnostics.memory_warning}", flush=True)

    watched_channels = load_watch_history(watch_files, now=now)
    subscribed_keys = load_subscriptions(subscription_files)
    subscribed_channels = load_subscription_channels(subscription_files)

    overall_channels = sort_and_filter_channels(watched_channels.values(), min_videos=min_videos)
    unsubscribed_channels = filter_unsubscribed_channels(
        watched_channels,
        subscribed_keys,
        min_videos=min_videos,
        stale_months=stale_months,
        now=now,
    )
    inactive_subscriptions = find_inactive_subscriptions(
        watched_channels,
        subscribed_channels,
        recent_months=inactive_recent_months,
        now=now,
    )

    return TakeoutAnalysis(
        overall_channels=overall_channels,
        unsubscribed_channels=unsubscribed_channels,
        inactive_subscriptions=inactive_subscriptions,
        watch_files=watch_files,
        subscription_files=subscription_files,
        diagnostics=diagnostics,
    )


def build_import_diagnostics(
    watch_files: list[Path],
    subscription_files: list[Path],
) -> ImportDiagnostics:
    json_files = tuple(path for path in watch_files if path.name.lower().endswith(".json"))
    html_files = tuple(path for path in watch_files if path.name.lower().endswith(".html"))
    total_bytes = sum(path.stat().st_size for path in watch_files if path.exists())
    memory_warning = None
    if total_bytes > LARGE_FILE_BYTES:
        memory_warning = (
            f"Large watch history ({format_bytes(total_bytes)}). Parsing may use a lot of memory."
        )
    return ImportDiagnostics(
        watch_json_files=json_files,
        watch_html_files=html_files,
        subscription_files=tuple(subscription_files),
        total_watch_bytes=total_bytes,
        using_html_fallback=not json_files and bool(html_files),
        memory_warning=memory_warning,
    )


def format_bytes(value: int) -> str:
    if value < 1024:
        return f"{value} B"
    if value < 1024 * 1024:
        return f"{value / 1024:.1f} KB"
    return f"{value / (1024 * 1024):.1f} MB"


def discover_files(root: Path) -> tuple[list[Path], list[Path]]:
    watch_files: list[Path] = []
    subscription_files: list[Path] = []

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        filename = path.name.lower()
        if filename in WATCH_HISTORY_FILENAMES:
            watch_files.append(path)
        elif filename in SUBSCRIPTION_FILENAMES:
            subscription_files.append(path)

    return sorted(watch_files), sorted(subscription_files)


def load_watch_history(files: list[Path], *, now: datetime) -> dict[str, ChannelWatchStat]:
    aggregate: dict[str, dict[str, Any]] = {}
    resolver = ChannelKeyResolver()

    for path in files:
        if path.stat().st_size >= PROGRESS_FILE_BYTES:
            print(f"Parsing {path.name} ({format_bytes(path.stat().st_size)})...", flush=True)
        entries = load_watch_history_entries(path)

        for entry in entries:
            channel = channel_from_watch_entry(entry)
            if channel is None:
                continue

            watched_at = parse_watch_time(entry.get("time"))
            video_key = unique_video_key(entry)
            aggregate_key = resolver.resolve(channel)

            current = aggregate.setdefault(
                aggregate_key,
                {
                    "channel_name": channel.name,
                    "channel_url": channel.url,
                    "channel_id": channel.channel_id,
                    "watch_count": 0,
                    "video_keys": set(),
                    "first_watched": None,
                    "last_watched": None,
                },
            )

            current["watch_count"] += 1
            current["video_keys"].add(video_key)

            if not current["channel_url"] and channel.url:
                current["channel_url"] = channel.url
            if not current["channel_id"] and channel.channel_id:
                current["channel_id"] = channel.channel_id

            first_watched = current["first_watched"]
            last_watched = current["last_watched"]
            if watched_at and (first_watched is None or watched_at < first_watched):
                current["first_watched"] = watched_at
            if watched_at and (last_watched is None or watched_at > last_watched):
                current["last_watched"] = watched_at

    result: dict[str, ChannelWatchStat] = {}
    for key, value in aggregate.items():
        unique_video_count = len(value["video_keys"])
        score = score_channel(
            watch_count=value["watch_count"],
            unique_video_count=unique_video_count,
            first_watched=value["first_watched"],
            last_watched=value["last_watched"],
            now=now,
        )
        result[key] = ChannelWatchStat(
            channel_name=value["channel_name"],
            watch_count=value["watch_count"],
            unique_video_count=unique_video_count,
            first_watched=value["first_watched"],
            last_watched=value["last_watched"],
            channel_url=value["channel_url"],
            channel_id=value["channel_id"],
            score=score,
            explanation=build_explanation(
                watch_count=value["watch_count"],
                unique_video_count=unique_video_count,
                first_watched=value["first_watched"],
                last_watched=value["last_watched"],
            ),
        )
    return result


def load_watch_history_entries(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    if suffix == ".html":
        return parse_watch_history_html(path.read_text(encoding="utf-8"))
    return []


def channel_from_watch_entry(entry: Any) -> ChannelRef | None:
    if not isinstance(entry, dict):
        return None

    subtitles = entry.get("subtitles")
    if not isinstance(subtitles, list) or not subtitles:
        return None

    first = subtitles[0]
    if not isinstance(first, dict):
        return None

    name = clean_name(first.get("name"))
    if not name:
        return None

    return build_channel_ref(name=name, url=as_optional_string(first.get("url")))


def parse_watch_history_html(raw_html: str) -> list[dict[str, Any]]:
    parser = WatchHistoryHTMLParser()
    parser.feed(raw_html)
    return parser.entries


def load_subscription_channels(files: list[Path]) -> list[ChannelRef]:
    channels: list[ChannelRef] = []
    seen: set[str] = set()
    for path in files:
        if path.suffix.lower() == ".csv":
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                for row in csv.DictReader(handle):
                    ref = build_channel_ref(
                        name=first_present(row, "Channel Title", "Channel title", "Title", "Name"),
                        url=first_present(row, "Channel URL", "Channel Url", "Channel URI", "URL"),
                        channel_id=first_present(row, "Channel ID", "Channel Id"),
                    )
                    key = stable_channel_key(ref)
                    if key in seen:
                        continue
                    seen.add(key)
                    channels.append(ref)
        elif path.suffix.lower() == ".json":
            data = json.loads(path.read_text(encoding="utf-8"))
            items = data if isinstance(data, list) else []
            for row in items:
                if not isinstance(row, dict):
                    continue
                snippet = row.get("snippet", {})
                resource = snippet.get("resourceId", {}) if isinstance(snippet, dict) else {}
                ref = build_channel_ref(
                    name=clean_name(row.get("name") or row.get("title") or row.get("channelTitle") or snippet.get("title")),
                    url=as_optional_string(row.get("url") or row.get("channelUrl")),
                    channel_id=as_optional_string(row.get("channelId") or resource.get("channelId")),
                )
                key = stable_channel_key(ref)
                if key in seen:
                    continue
                seen.add(key)
                channels.append(ref)
    return channels


def find_inactive_subscriptions(
    watched_channels: dict[str, ChannelWatchStat],
    subscribed_channels: list[ChannelRef],
    *,
    recent_months: int,
    now: datetime,
) -> list[ChannelWatchStat]:
    cutoff = now - timedelta(days=30 * recent_months)
    inactive: list[ChannelWatchStat] = []
    for sub in subscribed_channels:
        stat = find_watch_stat_for_ref(sub, watched_channels)
        if stat is not None and stat.last_watched and stat.last_watched >= cutoff:
            continue
        inactive.append(
            ChannelWatchStat(
                channel_name=sub.name,
                watch_count=stat.watch_count if stat else 0,
                unique_video_count=stat.unique_video_count if stat else 0,
                first_watched=stat.first_watched if stat else None,
                last_watched=stat.last_watched if stat else None,
                channel_url=sub.url or (stat.channel_url if stat else None),
                channel_id=sub.channel_id or (stat.channel_id if stat else None),
                score=stat.score if stat else 0.0,
                explanation=(
                    f"subscribed but no watches in last {recent_months} months"
                    if stat is None or stat.last_watched is None
                    else f"subscribed; last watched {format_date(stat.last_watched)}"
                ),
            )
        )
    return sorted(inactive, key=lambda item: (item.last_watched is None, item.channel_name.casefold()))


def find_watch_stat_for_ref(
    ref: ChannelRef,
    watched_channels: dict[str, ChannelWatchStat],
) -> ChannelWatchStat | None:
    ref_keys = all_channel_keys(ref)
    best: ChannelWatchStat | None = None
    for stat in watched_channels.values():
        candidate = build_channel_ref(stat.channel_name, stat.channel_url, stat.channel_id)
        if ref_keys.intersection(all_channel_keys(candidate)):
            if best is None or stat.watch_count > best.watch_count:
                best = stat
    return best


def load_subscriptions(files: list[Path]) -> set[str]:
    subscribed_keys: set[str] = set()
    for path in files:
        if path.suffix.lower() == ".csv":
            subscribed_keys.update(load_subscriptions_csv(path))
        elif path.suffix.lower() == ".json":
            subscribed_keys.update(load_subscriptions_json(path))
    return subscribed_keys


def load_subscriptions_csv(path: Path) -> set[str]:
    keys: set[str] = set()
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            channel = build_channel_ref(
                name=first_present(
                    row,
                    "Channel Title",
                    "Channel title",
                    "Title",
                    "Name",
                ),
                url=first_present(
                    row,
                    "Channel URL",
                    "Channel Url",
                    "Channel URI",
                    "URL",
                ),
                channel_id=first_present(
                    row,
                    "Channel ID",
                    "Channel Id",
                ),
            )
            keys.update(all_channel_keys(channel))
    return keys


def load_subscriptions_json(path: Path) -> set[str]:
    keys: set[str] = set()
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data if isinstance(data, list) else []
    for row in items:
        if not isinstance(row, dict):
            continue
        snippet = row.get("snippet", {})
        resource = snippet.get("resourceId", {}) if isinstance(snippet, dict) else {}
        channel = build_channel_ref(
            name=clean_name(row.get("name") or row.get("title") or row.get("channelTitle") or snippet.get("title")),
            url=as_optional_string(row.get("url") or row.get("channelUrl")),
            channel_id=as_optional_string(row.get("channelId") or resource.get("channelId")),
        )
        keys.update(all_channel_keys(channel))
    return keys


def filter_unsubscribed_channels(
    watched_channels: dict[str, ChannelWatchStat],
    subscribed_keys: set[str],
    *,
    min_videos: int,
    stale_months: int = 0,
    now: datetime,
) -> list[ChannelWatchStat]:
    stale_cutoff = now - timedelta(days=30 * stale_months) if stale_months > 0 else None
    results: list[ChannelWatchStat] = []
    for stat in watched_channels.values():
        candidate = build_channel_ref(
            name=stat.channel_name,
            url=stat.channel_url,
            channel_id=stat.channel_id,
        )
        if subscribed_keys.intersection(all_channel_keys(candidate)):
            continue
        if stat.watch_count < min_videos:
            continue
        if stale_cutoff is not None and (stat.last_watched is None or stat.last_watched < stale_cutoff):
            continue
        results.append(stat)
    return sort_channels(results)


def sort_and_filter_channels(channels: list[ChannelWatchStat], *, min_videos: int) -> list[ChannelWatchStat]:
    return sort_channels([channel for channel in channels if channel.watch_count >= min_videos])


def sort_channels(channels: list[ChannelWatchStat]) -> list[ChannelWatchStat]:
    return sorted(
        channels,
        key=lambda item: (-item.score, -item.watch_count, -item.unique_video_count, item.channel_name.casefold()),
    )


def compare_analyses(
    current_analysis: TakeoutAnalysis,
    older_analysis: TakeoutAnalysis,
    *,
    limit: int,
) -> list[ComparisonStat]:
    current_map = build_channel_map(current_analysis.overall_channels)
    older_map = build_channel_map(older_analysis.overall_channels)

    comparisons: list[ComparisonStat] = []
    for key, older in older_map.items():
        current = current_map.get(key)
        current_count = current.watch_count if current else 0
        drop = older.watch_count - current_count
        if drop <= 0:
            continue
        comparisons.append(
            ComparisonStat(
                channel_name=older.channel_name,
                older_watch_count=older.watch_count,
                current_watch_count=current_count,
                watch_drop=drop,
                channel_url=older.channel_url or (current.channel_url if current else None),
                explanation=(
                    f"Older export had {older.watch_count} watches; current export has "
                    f"{current_count}."
                ),
            )
        )

    comparisons.sort(key=lambda item: (-item.watch_drop, -item.older_watch_count, item.channel_name.casefold()))
    return comparisons[:limit]


def build_channel_map(channels: list[ChannelWatchStat]) -> dict[str, ChannelWatchStat]:
    result: dict[str, ChannelWatchStat] = {}
    for channel in channels:
        key = stable_channel_key(
            build_channel_ref(
                name=channel.channel_name,
                url=channel.channel_url,
                channel_id=channel.channel_id,
            )
        )
        result[key] = channel
    return result


def score_channel(
    *,
    watch_count: int,
    unique_video_count: int,
    first_watched: datetime | None,
    last_watched: datetime | None,
    now: datetime,
) -> float:
    diversity_bonus = min(unique_video_count, 25) * 1.75
    recency_bonus = 0.0
    span_bonus = 0.0

    if last_watched is not None:
        days_since = max((now - last_watched).days, 0)
        recency_bonus = max(0.0, 36.0 - min(days_since / 10.0, 36.0))
    if first_watched is not None and last_watched is not None:
        span_days = max((last_watched - first_watched).days, 0)
        span_bonus = min(span_days / 30.0, 18.0)

    return round((watch_count * 3.5) + diversity_bonus + recency_bonus + span_bonus, 2)


def rewatch_ratio(watch_count: int, unique_video_count: int) -> float:
    if unique_video_count <= 0:
        return 0.0
    return round(watch_count / unique_video_count, 2)


def build_explanation(
    *,
    watch_count: int,
    unique_video_count: int,
    first_watched: datetime | None,
    last_watched: datetime | None,
) -> str:
    parts = [f"{watch_count} watched videos", f"{unique_video_count} unique videos"]
    parts.append(f"rewatch ratio {rewatch_ratio(watch_count, unique_video_count)}")
    if first_watched:
        parts.append(f"first watched {format_date(first_watched)}")
    if last_watched:
        parts.append(f"last watched {format_date(last_watched)}")
    return ", ".join(parts)


def format_table(results: list[ChannelWatchStat], limit: int | None = None) -> str:
    shown = results if limit is None else results[:limit]
    if not shown:
        return "No unsubscribed watched channels found."

    rank_width = len(str(len(shown)))
    count_width = max(len("Videos"), max(len(str(item.watch_count)) for item in shown))
    unique_width = max(len("Unique"), max(len(str(item.unique_video_count)) for item in shown))
    name_width = max(len("Channel"), max(len(item.channel_name) for item in shown))
    date_width = len("Last Watched")

    ratio_width = len("Rewatch")
    header = (
        f"{'#':>{rank_width}}  "
        f"{'Videos':>{count_width}}  "
        f"{'Unique':>{unique_width}}  "
        f"{'Rewatch':>{ratio_width}}  "
        f"{'Last Watched':<{date_width}}  "
        f"{'Channel':<{name_width}}  "
        "Why"
    )
    divider = "-" * len(header)
    lines = [header, divider]

    for index, item in enumerate(shown, start=1):
        lines.append(
            f"{index:>{rank_width}}  "
            f"{item.watch_count:>{count_width}}  "
            f"{item.unique_video_count:>{unique_width}}  "
            f"{rewatch_ratio(item.watch_count, item.unique_video_count):>{ratio_width}}  "
            f"{format_date(item.last_watched):<{date_width}}  "
            f"{item.channel_name:<{name_width}}  "
            f"{item.explanation}"
        )

    return "\n".join(lines)


def write_channel_csv(path: Path, results: list[ChannelWatchStat], *, limit: int | None = None) -> None:
    shown = results if limit is None else results[:limit]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "rank",
                "score",
                "videos_watched",
                "unique_videos",
                "rewatch_ratio",
                "first_watched",
                "last_watched",
                "channel_name",
                "channel_url",
                "channel_id",
                "why_ranked_high",
            ]
        )
        for index, item in enumerate(shown, start=1):
            writer.writerow(
                [
                    index,
                    item.score,
                    item.watch_count,
                    item.unique_video_count,
                    rewatch_ratio(item.watch_count, item.unique_video_count),
                    format_date(item.first_watched),
                    format_date(item.last_watched),
                    item.channel_name,
                    item.channel_url or "",
                    item.channel_id or "",
                    item.explanation,
                ]
            )


def write_comparison_csv(path: Path, comparison: list[ComparisonStat]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "rank",
                "channel_name",
                "older_watch_count",
                "current_watch_count",
                "watch_drop",
                "channel_url",
                "why_ranked_high",
            ]
        )
        for index, item in enumerate(comparison, start=1):
            writer.writerow(
                [
                    index,
                    item.channel_name,
                    item.older_watch_count,
                    item.current_watch_count,
                    item.watch_drop,
                    item.channel_url or "",
                    item.explanation,
                ]
            )


def channel_avatar_url(stat: ChannelWatchStat) -> str | None:
    ref = build_channel_ref(stat.channel_name, stat.channel_url, stat.channel_id)
    lookup = ref.channel_id or ref.alias
    if not lookup and ref.url:
        user_match = USER_PATTERN.search(ref.url)
        custom_match = CUSTOM_PATTERN.search(ref.url)
        lookup = user_match.group(1) if user_match else (
            custom_match.group(1) if custom_match else None
        )
    if not lookup:
        return None
    banner_url = (
        f"https://banner.yt/api/banner/{quote(lookup, safe='')}"
        f"?type=avatar&format=jpeg&width=88&height=88"
    )
    return (
        "https://wsrv.nl/?url="
        f"{quote(banner_url, safe='')}&w=88&h=88&fit=cover&output=jpg"
    )


def write_html_report(
    path: Path,
    analysis: TakeoutAnalysis,
    *,
    limit: int,
    recent_months: tuple[int, ...],
    comparison: list[ComparisonStat] | None,
    older_path: Path | None,
    inactive_recent_months: int = 6,
) -> None:
    recent_sections = [
        (months, channels_watched_within(analysis.unsubscribed_channels, months=months))
        for months in recent_months
    ]
    diag = analysis.diagnostics
    import_notes = []
    if diag.using_html_fallback:
        import_notes.append("Parsed watch-history.html because no watch-history.json was found.")
    if len(diag.watch_json_files) + len(diag.watch_html_files) > 1:
        import_notes.append(
            f"Merged {diag.watch_file_count} watch-history files: "
            + ", ".join(path.name for path in (*diag.watch_json_files, *diag.watch_html_files))
        )
    if diag.memory_warning:
        import_notes.append(diag.memory_warning)
    import_notes_html = "".join(f"<li>{html.escape(note)}</li>" for note in import_notes)
    html_text = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SubSleuth Report</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f6f1e8;
      --card: #fffdf8;
      --ink: #1f1b16;
      --muted: #6a6257;
      --accent: #a33f1f;
      --line: #ded4c6;
    }}
    body {{
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: radial-gradient(circle at top, #fff8ec 0%, var(--bg) 60%);
      color: var(--ink);
    }}
    .wrap {{
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 60px;
    }}
    .hero, .card {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 10px 30px rgba(45, 35, 24, 0.08);
    }}
    .hero {{
      padding: 28px;
      margin-bottom: 20px;
    }}
    h1, h2 {{
      margin: 0 0 12px;
      line-height: 1.1;
    }}
    h1 {{
      font-size: 2.5rem;
    }}
    p, li {{
      color: var(--muted);
    }}
    .stats {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 20px;
    }}
    .stat {{
      padding: 14px;
      border-radius: 14px;
      background: #fff8ec;
      border: 1px solid var(--line);
    }}
    .grid {{
      display: grid;
      gap: 20px;
    }}
    .card {{
      padding: 22px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
    }}
    th, td {{
      text-align: left;
      vertical-align: top;
      padding: 10px 8px;
      border-bottom: 1px solid var(--line);
    }}
    th {{
      position: sticky;
      top: 0;
      background: var(--card);
    }}
    a {{
      color: var(--accent);
    }}
    .hint {{
      font-size: 0.9rem;
    }}
    .channel-cell {{
      display: flex;
      align-items: center;
      gap: 10px;
    }}
    .channel-avatar {{
      width: 32px;
      height: 32px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
      background: #eef0f3;
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>SubSleuth Report</h1>
      <p>Channels you watched a lot, no longer subscribe to, and may want to revisit.</p>
      <div class="stats">
        <div class="stat"><strong>{diag.watch_file_count}</strong><br>watch history files</div>
        <div class="stat"><strong>{len(analysis.subscription_files)}</strong><br>subscription files</div>
        <div class="stat"><strong>{len(analysis.unsubscribed_channels)}</strong><br>unsubscribed candidates</div>
        <div class="stat"><strong>{len(analysis.inactive_subscriptions)}</strong><br>inactive subscriptions</div>
        <div class="stat"><strong>{len(analysis.overall_channels)}</strong><br>top watched channels</div>
      </div>
      {"<ul class=\"hint\">" + import_notes_html + "</ul>" if import_notes_html else ""}
    </section>
    <div class="grid">
      <section class="card">
        <h2>Likely Accidental Unsubscribes</h2>
        <p class="hint">Ranked by a score that blends watch count, unique videos, watch recency, and long-term repeat viewing.</p>
        {render_channel_table(analysis.unsubscribed_channels[:limit])}
      </section>
      <section class="card">
        <h2>Top Channels Overall</h2>
        <p class="hint">This is the all-channels leaderboard, including channels you still subscribe to.</p>
        {render_channel_table(analysis.overall_channels[:limit])}
      </section>
      {render_recent_sections(recent_sections, limit)}
      <section class="card">
        <h2>Inactive Subscriptions</h2>
        <p class="hint">Channels you still subscribe to but have not watched in the last {inactive_recent_months} months.</p>
        {render_channel_table(analysis.inactive_subscriptions[:limit])}
      </section>
      {render_comparison_section(comparison, older_path)}
    </div>
  </div>
</body>
</html>
"""
    path.write_text(html_text, encoding="utf-8")


def render_channel_table(channels: list[ChannelWatchStat]) -> str:
    if not channels:
        return "<p>No channels found for this section.</p>"

    rows = []
    for index, channel in enumerate(channels, start=1):
        channel_link = (
            f'<a href="{html.escape(channel.channel_url)}">{html.escape(channel.channel_name)}</a>'
            if channel.channel_url
            else html.escape(channel.channel_name)
        )
        avatar_url = channel_avatar_url(channel)
        avatar_html = (
            f'<img class="channel-avatar" src="{html.escape(avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">'
            if avatar_url
            else ""
        )
        rows.append(
            "<tr>"
            f"<td>{index}</td>"
            f'<td><div class="channel-cell">{avatar_html}<span>{channel_link}</span></div></td>'
            f"<td>{channel.watch_count}</td>"
            f"<td>{channel.unique_video_count}</td>"
            f"<td>{rewatch_ratio(channel.watch_count, channel.unique_video_count)}</td>"
            f"<td>{channel.score}</td>"
            f"<td>{html.escape(format_date(channel.first_watched))}</td>"
            f"<td>{html.escape(format_date(channel.last_watched))}</td>"
            f"<td>{html.escape(channel.explanation)}</td>"
            "</tr>"
        )

    return (
        "<table>"
        "<thead><tr><th>#</th><th>Channel</th><th>Videos</th><th>Unique</th><th>Rewatch</th><th>Score</th>"
        "<th>First Watched</th><th>Last Watched</th><th>Why It Ranked High</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
    )


def render_recent_sections(recent_sections: list[tuple[int, list[ChannelWatchStat]]], limit: int) -> str:
    blocks: list[str] = []
    for months, channels in recent_sections:
        blocks.append(
            "<section class=\"card\">"
            f"<h2>Recently Forgotten: Last {months} Months</h2>"
            f"<p class=\"hint\">Channels watched within the last {months} months but not currently subscribed.</p>"
            f"{render_channel_table(channels[:limit])}"
            "</section>"
        )
    return "".join(blocks)


def render_comparison_section(comparison: list[ComparisonStat] | None, older_path: Path | None) -> str:
    if comparison is None:
        return ""

    if not comparison:
        return (
            "<section class=\"card\">"
            "<h2>Comparison To Older Export</h2>"
            f"<p class=\"hint\">No channels had a meaningful watch drop versus {html.escape(str(older_path))}.</p>"
            "</section>"
        )

    rows = []
    for index, item in enumerate(comparison, start=1):
        link = (
            f'<a href="{html.escape(item.channel_url)}">{html.escape(item.channel_name)}</a>'
            if item.channel_url
            else html.escape(item.channel_name)
        )
        rows.append(
            "<tr>"
            f"<td>{index}</td>"
            f"<td>{link}</td>"
            f"<td>{item.older_watch_count}</td>"
            f"<td>{item.current_watch_count}</td>"
            f"<td>{item.watch_drop}</td>"
            f"<td>{html.escape(item.explanation)}</td>"
            "</tr>"
        )

    return (
        "<section class=\"card\">"
        "<h2>Channels You Used To Watch More</h2>"
        f"<p class=\"hint\">Compared against older export: {html.escape(str(older_path))}</p>"
        "<table>"
        "<thead><tr><th>#</th><th>Channel</th><th>Older Watches</th><th>Current Watches</th><th>Drop</th><th>Why It Ranked High</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
        "</section>"
    )


def channels_watched_within(channels: list[ChannelWatchStat], *, months: int) -> list[ChannelWatchStat]:
    cutoff = datetime.now(UTC) - timedelta(days=30 * months)
    return [channel for channel in channels if channel.last_watched and channel.last_watched >= cutoff]


class ChannelKeyResolver:
    def __init__(self) -> None:
        self._canonical_for_key: dict[str, str] = {}
        self._canonical_for_name: dict[str, str] = {}

    def resolve(self, channel: ChannelRef) -> str:
        keys = all_channel_keys(channel)
        name_fold = normalize_name(channel.name) if channel.name else ""
        candidates: set[str] = set()
        for key in keys:
            if key in self._canonical_for_key:
                candidates.add(self._canonical_for_key[key])
        if name_fold and name_fold in self._canonical_for_name:
            candidates.add(self._canonical_for_name[name_fold])

        if len(candidates) == 1:
            canonical = next(iter(candidates))
        elif len(candidates) > 1:
            canonical = sorted(candidates)[0]
            for other in sorted(candidates)[1:]:
                self._merge_canonical(other, canonical)
        elif name_fold and name_fold in self._canonical_for_name:
            canonical = self._canonical_for_name[name_fold]
        else:
            canonical = preferred_canonical_key(channel)

        self._register(channel, canonical)
        return canonical

    def _merge_canonical(self, old: str, new: str) -> None:
        for key, value in list(self._canonical_for_key.items()):
            if value == old:
                self._canonical_for_key[key] = new
        for name, value in list(self._canonical_for_name.items()):
            if value == old:
                self._canonical_for_name[name] = new

    def _register(self, channel: ChannelRef, canonical: str) -> None:
        for key in all_channel_keys(channel):
            self._canonical_for_key[key] = canonical
        name_fold = normalize_name(channel.name)
        if name_fold:
            self._canonical_for_name[name_fold] = canonical


def preferred_canonical_key(channel: ChannelRef) -> str:
    if channel.channel_id:
        return f"id:{channel.channel_id.casefold()}"
    if channel.alias:
        return f"alias:{channel.alias.casefold()}"
    if channel.url:
        return f"url:{normalize_url(channel.url)}"
    return f"name:{normalize_name(channel.name)}"


def stable_channel_key(channel: ChannelRef) -> str:
    return preferred_canonical_key(channel)


def all_channel_keys(channel: ChannelRef) -> set[str]:
    keys: set[str] = set()
    if channel.channel_id:
        keys.add(f"id:{channel.channel_id.casefold()}")
    if channel.alias:
        folded = channel.alias.casefold()
        keys.add(f"alias:{folded}")
        keys.add(f"handle:{folded}")
        keys.add(f"user:{folded}")
        keys.add(f"custom:{folded}")
    if channel.url:
        keys.add(f"url:{normalize_url(channel.url)}")
    if channel.name:
        keys.add(f"name:{normalize_name(channel.name)}")
    return keys


def build_channel_ref(
    name: str | None,
    url: str | None = None,
    channel_id: str | None = None,
) -> ChannelRef:
    cleaned_name = clean_name(name) or "Unknown Channel"
    cleaned_url = normalize_url(url) if url else None
    cleaned_channel_id = clean_name(channel_id)
    alias = None

    if cleaned_url:
        cleaned_channel_id = cleaned_channel_id or extract_channel_id(cleaned_url)
        alias = extract_alias(cleaned_url)

    return ChannelRef(
        name=cleaned_name,
        url=cleaned_url,
        channel_id=cleaned_channel_id,
        alias=alias,
    )


def extract_channel_id(url: str) -> str | None:
    match = CHANNEL_ID_PATTERN.search(url)
    return match.group(1) if match else None


def extract_alias(url: str) -> str | None:
    for pattern in (HANDLE_PATTERN, USER_PATTERN, CUSTOM_PATTERN):
        match = pattern.search(url)
        if match:
            return match.group(1)
    return None


def unique_video_key(entry: dict[str, Any]) -> str:
    title_url = as_optional_string(entry.get("titleUrl"))
    if title_url:
        return f"url:{normalize_url(title_url)}"
    title = clean_name(entry.get("title"))
    if title:
        return f"title:{normalize_name(title)}"
    return "unknown-video"


def parse_watch_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def normalize_url(value: str) -> str:
    raw = value.strip().rstrip("/")
    if not raw:
        return raw

    parts = urlsplit(raw)
    scheme = "https" if parts.scheme in {"http", "https"} else parts.scheme
    netloc = parts.netloc.casefold()
    if netloc == "m.youtube.com":
        netloc = "www.youtube.com"
    if netloc == "youtube.com":
        netloc = "www.youtube.com"

    if scheme and netloc:
        return urlunsplit((scheme, netloc, parts.path, parts.query, ""))
    return raw


def normalize_name(value: str) -> str:
    return " ".join(value.split()).casefold()


def clean_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split()).strip()
    return cleaned or None


def as_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def first_present(row: dict[str, Any], *keys: str) -> str | None:
    normalized_row = {normalize_lookup_key(key): value for key, value in row.items()}
    for key in keys:
        value = normalized_row.get(normalize_lookup_key(key))
        if isinstance(value, str) and value.strip():
            return value
    return None


def format_date(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone(UTC).date().isoformat()


def as_positive_int(value: Any, fallback: int) -> int:
    return value if isinstance(value, int) and value > 0 else fallback


def as_non_empty_string(value: Any, fallback: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def normalize_lookup_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


class WatchHistoryHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.entries: list[dict[str, Any]] = []
        self._current_href: str | None = None
        self._current_text: list[str] = []
        self._pending_link: tuple[str, str] | None = None
        self._current_entry: dict[str, Any] | None = None
        self._text_buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._current_href = dict(attrs).get("href")
            self._current_text = []
        elif tag == "br":
            self._flush_pending_link()
            self._flush_text_buffer()

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            text = " ".join("".join(self._current_text).split()).strip()
            href = self._current_href
            self._current_href = None
            self._current_text = []
            if text and href:
                self._pending_link = (text, href)

    def handle_data(self, data: str) -> None:
        if self._current_href is not None:
            self._current_text.append(data)
        else:
            self._text_buffer.append(data)

    def close(self) -> None:
        self._flush_pending_link()
        self._flush_text_buffer()
        super().close()

    def _flush_pending_link(self) -> None:
        if not self._pending_link:
            return

        text, href = self._pending_link
        self._pending_link = None
        normalized_href = normalize_watch_url(href)
        if "/watch?" in normalized_href:
            self._finish_entry()
            self._current_entry = {
                "title": text,
                "titleUrl": normalized_href,
                "subtitles": [],
            }
            return

        if self._current_entry is not None:
            self._current_entry["subtitles"] = [{"name": text, "url": normalized_href}]

    def _flush_text_buffer(self) -> None:
        if not self._current_entry:
            self._text_buffer.clear()
            return

        text = " ".join("".join(self._text_buffer).split()).strip()
        self._text_buffer.clear()
        if not text:
            return

        if "Products:" in text or "Why is this here?" in text:
            self._finish_entry()
            return

        if "watched" in text.casefold() and not self._current_entry.get("title"):
            self._current_entry["title"] = text
            return

        parsed_time = parse_watch_time_text(text)
        if parsed_time and not self._current_entry.get("time"):
            self._current_entry["time"] = parsed_time
            self._finish_entry()

    def _finish_entry(self) -> None:
        if not self._current_entry:
            return
        subtitles = self._current_entry.get("subtitles")
        if subtitles:
            self.entries.append(self._current_entry)
        self._current_entry = None


def normalize_watch_url(url: str) -> str:
    trimmed = url.strip()
    if trimmed.startswith("http://") or trimmed.startswith("https://"):
        return normalize_url(trimmed)
    return normalize_url(f"https://www.youtube.com{trimmed}")


def parse_watch_time_text(value: str) -> str | None:
    cleaned = " ".join(
        value.replace("UTC", "+0000").replace("GMT", "+0000").replace("BST", "+0100").split()
    )
    candidates = [
        "%b %d, %Y, %I:%M:%S %p %z",
        "%b %d, %Y, %I:%M:%S %p",
        "%b %d, %Y, %I:%M %p %z",
        "%b %d, %Y, %I:%M %p",
        "%d %b %Y, %H:%M:%S %z",
        "%d %b %Y, %H:%M:%S",
        "%d %B %Y, %H:%M:%S %z",
        "%d %B %Y, %H:%M:%S",
    ]
    for fmt in candidates:
        try:
            parsed = datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat()
    return None


if __name__ == "__main__":
    raise SystemExit(main())
