import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from subsleuth import (
    DEFAULT_OUTPUT_DIR,
    analyze_takeout,
    build_channel_ref,
    build_explanation,
    compare_analyses,
    format_table,
    load_config,
    normalize_url,
    parse_watch_history_html,
    prepare_takeout_source,
    rewatch_ratio,
    write_channel_csv,
    write_html_report,
)


def test_analyze_takeout_filters_current_subscriptions_and_tracks_dates(tmp_path: Path) -> None:
    youtube_dir = tmp_path / "Takeout" / "YouTube and YouTube Music"
    history_dir = youtube_dir / "history"
    subs_dir = youtube_dir / "subscriptions"
    history_dir.mkdir(parents=True)
    subs_dir.mkdir(parents=True)

    (history_dir / "watch-history.json").write_text(
        """
[
  {
    "title": "Watched Video 1",
    "titleUrl": "https://www.youtube.com/watch?v=1",
    "time": "2026-04-02T12:00:00Z",
    "subtitles": [{"name": "Channel A", "url": "https://www.youtube.com/channel/AAA"}]
  },
  {
    "title": "Watched Video 2",
    "titleUrl": "https://www.youtube.com/watch?v=2",
    "time": "2026-05-02T12:00:00Z",
    "subtitles": [{"name": "Channel A", "url": "https://www.youtube.com/channel/AAA"}]
  },
  {
    "title": "Watched Video 3",
    "titleUrl": "https://www.youtube.com/watch?v=3",
    "time": "2026-04-12T12:00:00Z",
    "subtitles": [{"name": "Channel B", "url": "https://www.youtube.com/channel/BBB"}]
  },
  {
    "title": "Watched Video 4",
    "titleUrl": "https://www.youtube.com/watch?v=4",
    "time": "2026-03-12T12:00:00Z",
    "subtitles": [{"name": "Channel C", "url": "https://www.youtube.com/@chan_c"}]
  }
]
""".strip(),
        encoding="utf-8",
    )

    (subs_dir / "subscriptions.csv").write_text(
        """
Channel Id,Channel Url,Channel Title
BBB,https://www.youtube.com/channel/BBB,Channel B
""".strip(),
        encoding="utf-8",
    )

    analysis = analyze_takeout(tmp_path, now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)

    assert len(analysis.watch_files) == 1
    assert len(analysis.subscription_files) == 1
    assert [item.channel_name for item in analysis.unsubscribed_channels] == ["Channel A", "Channel C"]
    assert analysis.unsubscribed_channels[0].first_watched.date().isoformat() == "2026-04-02"
    assert analysis.unsubscribed_channels[0].last_watched.date().isoformat() == "2026-05-02"
    assert "last watched 2026-05-02" in analysis.unsubscribed_channels[0].explanation


def test_min_videos_filter_and_csv_include_explanations(tmp_path: Path) -> None:
    analysis = analyze_takeout(_seed_takeout(tmp_path), now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=2)
    assert [item.channel_name for item in analysis.unsubscribed_channels] == ["Channel A"]

    csv_path = tmp_path / DEFAULT_OUTPUT_DIR.name / "results.csv"
    csv_path.parent.mkdir()
    write_channel_csv(csv_path, analysis.unsubscribed_channels, limit=5)
    csv_text = csv_path.read_text(encoding="utf-8")
    assert "why_ranked_high" in csv_text
    assert "Channel A" in csv_text


def test_zip_input_is_supported(tmp_path: Path) -> None:
    source_dir = _seed_takeout(tmp_path / "source")
    zip_path = tmp_path / "takeout.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        for file_path in source_dir.rglob("*"):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(source_dir))

    extracted = prepare_takeout_source(zip_path, tmp_path / "unzipped")
    analysis = analyze_takeout(extracted, now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)
    assert analysis.unsubscribed_channels[0].channel_name == "Channel A"


def test_html_report_and_recent_sections_are_generated(tmp_path: Path) -> None:
    analysis = analyze_takeout(_seed_takeout(tmp_path), now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)
    html_path = tmp_path / "report.html"
    write_html_report(
        html_path,
        analysis,
        limit=10,
        recent_months=(3, 6, 12),
        comparison=None,
        older_path=None,
    )
    html_text = html_path.read_text(encoding="utf-8")
    assert "Likely Accidental Unsubscribes" in html_text
    assert "Top Channels Overall" in html_text
    assert "Recently Forgotten: Last 3 Months" in html_text


def test_html_watch_history_is_parsed(tmp_path: Path) -> None:
    takeout_dir = tmp_path / "Takeout" / "YouTube and YouTube Music" / "history"
    takeout_dir.mkdir(parents=True)
    (takeout_dir / "watch-history.html").write_text(
        """
<html><body>
Watched <a href="https://www.youtube.com/watch?v=abc123">Some Video</a><br>
<a href="https://www.youtube.com/@channel_a">Channel A</a><br>
Jun 02, 2026, 12:30:00 PM UTC<br><br>
Watched <a href="/watch?v=def456">Another Video</a><br>
<a href="/user/channelb">Channel B</a><br>
May 01, 2026, 10:00:00 AM UTC<br>
</body></html>
""".strip(),
        encoding="utf-8",
    )

    parsed = parse_watch_history_html((takeout_dir / "watch-history.html").read_text(encoding="utf-8"))
    assert len(parsed) == 2
    assert parsed[0]["subtitles"][0]["name"] == "Channel A"
    assert parsed[1]["subtitles"][0]["url"] == "https://www.youtube.com/user/channelb"

    analysis = analyze_takeout(tmp_path, now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)
    assert [item.channel_name for item in analysis.overall_channels] == ["Channel A", "Channel B"]
    assert analysis.overall_channels[0].last_watched.date().isoformat() == "2026-06-02"


def test_html_watch_history_supports_takeout_bst_dates() -> None:
    parsed = parse_watch_history_html(
        """
<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">
Watched <a href="https://www.youtube.com/watch?v=abc123">Some Video</a><br>
<a href="https://www.youtube.com/channel/UC123">Channel A</a><br>
5 May 2025, 14:19:55 BST<br>
</div>
""".strip()
    )
    assert parsed[0]["time"].startswith("2025-05-05T13:19:55")


def test_compare_mode_finds_channels_that_dropped(tmp_path: Path) -> None:
    older = analyze_takeout(_seed_takeout(tmp_path / "older"), now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)

    current_dir = tmp_path / "current"
    history_dir = current_dir / "history"
    history_dir.mkdir(parents=True)
    (history_dir / "watch-history.json").write_text(
        """
[
  {
    "title": "One newer watch",
    "titleUrl": "https://www.youtube.com/watch?v=newer-1",
    "time": "2026-05-01T12:00:00Z",
    "subtitles": [{"name": "Channel A", "url": "https://www.youtube.com/@channel_a"}]
  }
]
""".strip(),
        encoding="utf-8",
    )

    current = analyze_takeout(current_dir, now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)
    comparison = compare_analyses(current, older, limit=10)
    assert comparison[0].channel_name == "Channel A"
    assert comparison[0].watch_drop == 1


def test_alias_matching_handles_legacy_user_urls(tmp_path: Path) -> None:
    youtube_dir = tmp_path / "Takeout"
    history_dir = youtube_dir / "history"
    subs_dir = youtube_dir / "subscriptions"
    history_dir.mkdir(parents=True)
    subs_dir.mkdir(parents=True)

    (history_dir / "watch-history.json").write_text(
        """
[
  {
    "title": "Watched Video 1",
    "titleUrl": "https://www.youtube.com/watch?v=legacy-1",
    "time": "2026-04-02T12:00:00Z",
    "subtitles": [{"name": "Legacy Channel", "url": "https://www.youtube.com/@legacychannel"}]
  }
]
""".strip(),
        encoding="utf-8",
    )
    (subs_dir / "subscriptions.csv").write_text(
        """
Channel Id,Channel Url,Channel Title
,https://www.youtube.com/user/legacychannel,Legacy Channel
""".strip(),
        encoding="utf-8",
    )

    analysis = analyze_takeout(youtube_dir, now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)
    assert analysis.unsubscribed_channels == []
    assert build_channel_ref("Legacy Channel", "https://www.youtube.com/@legacychannel").alias == "legacychannel"


def test_subscription_csv_header_variants_are_matched_case_insensitively(tmp_path: Path) -> None:
    youtube_dir = tmp_path / "Takeout"
    history_dir = youtube_dir / "history"
    subs_dir = youtube_dir / "subscriptions"
    history_dir.mkdir(parents=True)
    subs_dir.mkdir(parents=True)

    (history_dir / "watch-history.json").write_text(
        """
[
  {
    "title": "Watched Video 1",
    "titleUrl": "https://www.youtube.com/watch?v=abc123",
    "time": "2026-04-02T12:00:00Z",
    "subtitles": [{"name": "Linus Tech Tips", "url": "https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw"}]
  }
]
""".strip(),
        encoding="utf-8",
    )
    (subs_dir / "subscriptions.csv").write_text(
        """
Channel ID,Channel URL,Channel title
UCXuqSBlHAE6Xw-yeJA0Tunw,http://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw,Linus Tech Tips
""".strip(),
        encoding="utf-8",
    )

    analysis = analyze_takeout(youtube_dir, now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)
    assert analysis.unsubscribed_channels == []


def test_url_normalization_handles_http_mobile_and_https_variants() -> None:
    assert normalize_url("http://www.youtube.com/channel/ABC/") == "https://www.youtube.com/channel/ABC"
    assert normalize_url("https://youtube.com/@creator") == "https://www.youtube.com/@creator"
    assert normalize_url("https://m.youtube.com/user/legacy") == "https://www.youtube.com/user/legacy"


def test_config_file_loads_custom_defaults(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps(
            {
                "limit": 15,
                "min_videos": 3,
                "output_dir": "custom-output",
                "recent_month_windows": [2, 4],
            }
        ),
        encoding="utf-8",
    )
    config = load_config(config_path)
    assert config.limit == 15
    assert config.min_videos == 3
    assert config.output_dir == Path("custom-output")
    assert config.recent_month_windows == (2, 4)


def test_rewatch_ratio_and_explanation() -> None:
    assert rewatch_ratio(6, 3) == 2.0
    assert rewatch_ratio(5, 0) == 0.0
    assert rewatch_ratio(4, 4) == 1.0

    explanation = build_explanation(
        watch_count=6,
        unique_video_count=3,
        first_watched=datetime(2026, 1, 1, tzinfo=UTC),
        last_watched=datetime(2026, 5, 1, tzinfo=UTC),
    )
    assert "rewatch ratio 2.0" in explanation
    assert "6 watched videos" in explanation
    assert "3 unique videos" in explanation


def test_stale_months_filter_excludes_old_unsubscribed_channels(tmp_path: Path) -> None:
    takeout = _seed_takeout(tmp_path)
    now = datetime(2026, 6, 4, tzinfo=UTC)

    without_stale = analyze_takeout(takeout, now=now, min_videos=1, stale_months=0)
    assert [item.channel_name for item in without_stale.unsubscribed_channels] == ["Channel A", "Channel C"]

    with_stale = analyze_takeout(takeout, now=now, min_videos=1, stale_months=6)
    assert [item.channel_name for item in with_stale.unsubscribed_channels] == ["Channel A"]


def test_inactive_subscriptions_lists_subs_without_recent_watches(tmp_path: Path) -> None:
    youtube_dir = tmp_path / "Takeout" / "YouTube and YouTube Music"
    history_dir = youtube_dir / "history"
    subs_dir = youtube_dir / "subscriptions"
    history_dir.mkdir(parents=True)
    subs_dir.mkdir(parents=True)

    (history_dir / "watch-history.json").write_text(
        """
[
  {
    "title": "Recent sub watch",
    "titleUrl": "https://www.youtube.com/watch?v=recent",
    "time": "2026-05-15T12:00:00Z",
    "subtitles": [{"name": "Active Sub", "url": "https://www.youtube.com/channel/ACT"}]
  },
  {
    "title": "Old sub watch",
    "titleUrl": "https://www.youtube.com/watch?v=old",
    "time": "2025-01-10T12:00:00Z",
    "subtitles": [{"name": "Stale Sub", "url": "https://www.youtube.com/channel/STL"}]
  },
  {
    "title": "Unsub watch",
    "titleUrl": "https://www.youtube.com/watch?v=free",
    "time": "2026-04-01T12:00:00Z",
    "subtitles": [{"name": "Not Subscribed", "url": "https://www.youtube.com/channel/FRE"}]
  }
]
""".strip(),
        encoding="utf-8",
    )
    (subs_dir / "subscriptions.csv").write_text(
        """
Channel Id,Channel Url,Channel Title
ACT,https://www.youtube.com/channel/ACT,Active Sub
STL,https://www.youtube.com/channel/STL,Stale Sub
GND,https://www.youtube.com/channel/GND,Ghost Sub
""".strip(),
        encoding="utf-8",
    )

    analysis = analyze_takeout(
        tmp_path,
        now=datetime(2026, 6, 4, tzinfo=UTC),
        min_videos=1,
        inactive_recent_months=6,
    )

    assert [item.channel_name for item in analysis.unsubscribed_channels] == ["Not Subscribed"]
    assert {item.channel_name for item in analysis.inactive_subscriptions} == {"Stale Sub", "Ghost Sub"}
    assert analysis.inactive_subscriptions[0].explanation.startswith("subscribed")
    ghost = next(item for item in analysis.inactive_subscriptions if item.channel_name == "Ghost Sub")
    assert "no watches in last 6 months" in ghost.explanation


def test_analyze_takeout_includes_rewatch_ratio_in_explanation(tmp_path: Path) -> None:
    analysis = analyze_takeout(_seed_takeout(tmp_path), now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)
    channel_a = analysis.unsubscribed_channels[0]
    assert channel_a.watch_count == 2
    assert channel_a.unique_video_count == 2
    assert "rewatch ratio 1.0" in channel_a.explanation


def test_format_table_includes_dates_and_explanations(tmp_path: Path) -> None:
    analysis = analyze_takeout(_seed_takeout(tmp_path), now=datetime(2026, 6, 4, tzinfo=UTC), min_videos=1)
    output = format_table(analysis.unsubscribed_channels, limit=1)
    assert "Last Watched" in output
    assert "last watched 2026-05-02" in output


def _seed_takeout(tmp_path: Path) -> Path:
    history_dir = tmp_path / "history"
    history_dir.mkdir(parents=True)
    (history_dir / "watch-history.json").write_text(
        """
[
  {
    "title": "A1",
    "titleUrl": "https://www.youtube.com/watch?v=a1",
    "time": "2026-04-02T12:00:00Z",
    "subtitles": [{"name": "Channel A", "url": "https://www.youtube.com/@channel_a"}]
  },
  {
    "title": "A2",
    "titleUrl": "https://www.youtube.com/watch?v=a2",
    "time": "2026-05-02T12:00:00Z",
    "subtitles": [{"name": "Channel A", "url": "https://www.youtube.com/@channel_a"}]
  },
  {
    "title": "C1",
    "titleUrl": "https://www.youtube.com/watch?v=c1",
    "time": "2025-11-01T12:00:00Z",
    "subtitles": [{"name": "Channel C", "url": "https://www.youtube.com/@channel_c"}]
  }
]
""".strip(),
        encoding="utf-8",
    )
    return tmp_path
