"""Desk markers, dossier and badges adapters, and their hooks in existing consumers.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. ticker_mentions: any change to the payload while the flag is off (the cached object is
   returned untouched, no wisdom.db read); the gate moved INSIDE the per-symbol cache (a
   flip-off would keep serving Wisdom rows for 600 s); a cached payload mutated; a Wisdom
   row taking over a day's click-to-video marker; guests or rejected records as markers.
2. dossier: `_gather_sources` bundle or hash changed while the flag is off; a price,
   level or date reaching a dossier line; an unlabelled line.
3. badges: badges while the flag is off (without an explicit preview); a stale or guest
   badge; a shape other than {kind, speaker, stated_at, label}.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import pytest

from api.services import ai_search_dossier as dos
from api.services import ticker_mentions
from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish.adapters import badges, common, dossier
from tests.test_wisdom_publish_adapters_store import adapters_db, seeded  # noqa: F401

VIDEO_KEYS = {"video_id", "youtube_id", "title", "anchor_date", "t", "note"}


@pytest.fixture
def touched(monkeypatch):
    calls: list = []
    real = store.connect
    monkeypatch.setattr(store, "connect", lambda *a, **k: calls.append(1) or real(*a, **k))
    return calls


def _video_rows():
    created = int(datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc).timestamp())  # 2026-09-08 ET
    return [{"id": 42, "youtube_id": "ytLIVE42", "title": "Live Trading Sessions — Sep 8, 2026",
             "created_at": created, "ticker_moments": '[{"ticker": "NVDA", "t": 30, "note": "opening look"}]'}]


# ── desk markers ─────────────────────────────────────────────────────────────

def test_flag_off_returns_the_cached_video_payload_untouched(seeded, monkeypatch, touched):
    ticker_mentions._cache.clear()
    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", _video_rows)
    monkeypatch.delenv("WISDOM_DESK_MARKERS_ENABLED", raising=False)
    out = ticker_mentions.mentions_for_symbol("NVDA")
    assert out is ticker_mentions._cache["NVDA"][1]
    assert [set(m) for m in out["mentions"]] == [VIDEO_KEYS]
    assert touched == []


def test_flag_on_adds_wisdom_rows_after_the_days_video_rows_without_mutating_the_cache(seeded, monkeypatch):
    ticker_mentions._cache.clear()
    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", _video_rows)
    monkeypatch.setenv("WISDOM_DESK_MARKERS_ENABLED", "1")
    out = ticker_mentions.mentions_for_symbol("NVDA")
    rows = out["mentions"]
    assert [(m["anchor_date"], m.get("source", "video")) for m in rows] == [
        ("2026-09-08", "video"), ("2026-09-08", "wisdom"), ("2026-09-06", "wisdom")]
    video, live_call, scan_call = rows
    assert set(video) == VIDEO_KEYS and video["video_id"] == 42 and video["t"] == 30
    assert live_call["video_id"] == 42 and live_call["youtube_id"] == "ytLIVE42" and live_call["t"] == 120
    assert live_call["kind"] == "call" and live_call["status"] == "provisional"
    assert live_call["note"].startswith("TSDR (provisional): ")
    assert scan_call["video_id"] is None and scan_call["youtube_id"] is None and scan_call["t"] == 0
    assert all(common.LOCATOR_RE.match(m["locator"]) for m in rows[1:])
    # the frontend keeps the FIRST row per day: 2026-09-08 must still be the video row
    first_per_day: dict = {}
    for m in rows:
        first_per_day.setdefault(m["anchor_date"], m)
    assert "source" not in first_per_day["2026-09-08"]
    # the cache still holds the video-only payload, and a flip-off takes effect at once
    cached = ticker_mentions._cache["NVDA"][1]
    assert [set(m) for m in cached["mentions"]] == [VIDEO_KEYS]
    monkeypatch.delenv("WISDOM_DESK_MARKERS_ENABLED")
    assert ticker_mentions.mentions_for_symbol("NVDA") is cached


def test_guests_rejected_and_negative_calls_are_not_markers(seeded, monkeypatch):
    ticker_mentions._cache.clear()
    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", lambda: [])
    monkeypatch.setenv("WISDOM_DESK_MARKERS_ENABLED", "1")
    assert ticker_mentions.mentions_for_symbol("TSLA")["mentions"] == []   # guest MENTION
    assert ticker_mentions.mentions_for_symbol("AMD")["mentions"] == []    # rejected MENTION + a NEGATIVE_CALL
    # control: the same switch does produce NVDA rows
    assert ticker_mentions.mentions_for_symbol("NVDA")["mentions"]


# ── dossier ──────────────────────────────────────────────────────────────────

def _stub_dossier_sources(monkeypatch):
    from api.services import brain_kb_service

    monkeypatch.setattr(dos, "_fund_line", lambda s: "market_cap 1")
    monkeypatch.setattr(dos, "_analyst_line", lambda s: "")
    monkeypatch.setattr(dos, "_insider_line", lambda s: "net buying")
    monkeypatch.setattr(dos, "_evergreen_qa", lambda s, limit=8: ["Q: moat?\nA: platform"])
    monkeypatch.setattr(dos, "_recent_ts_qa", lambda s, limit=4: ["[RECENT EVENT CONTEXT] Q: why up\nA: guidance"])
    monkeypatch.setattr(brain_kb_service, "search", lambda q, k=3: [{"title": "KB", "text": "kb text"}])


def test_gather_sources_is_byte_identical_with_the_flag_off(seeded, monkeypatch, touched):
    _stub_dossier_sources(monkeypatch)
    monkeypatch.delenv("WISDOM_DOSSIER_ENABLED", raising=False)
    bundle, digest = dos._gather_sources("NVDA", "ticker")
    expected = "\n".join(["[FUNDAMENTALS] market_cap 1", "[INSIDER] net buying", "Q: moat?\nA: platform",
                          "[RECENT EVENT CONTEXT] Q: why up\nA: guidance", "[KB KB] kb text"])[:6000]
    assert bundle == expected
    assert digest == hashlib.sha256(expected.encode("utf-8", "ignore")).hexdigest()
    assert touched == []


def test_flag_on_appends_labelled_durable_lines_without_levels_or_dates(seeded, monkeypatch):
    _stub_dossier_sources(monkeypatch)
    monkeypatch.delenv("WISDOM_DOSSIER_ENABLED", raising=False)
    off_bundle, off_digest = dos._gather_sources("NVDA", "ticker")
    monkeypatch.setenv("WISDOM_DOSSIER_ENABLED", "1")
    bundle, digest = dos._gather_sources("NVDA", "ticker")
    assert digest != off_digest
    added = [line for line in bundle.split("\n") if line.startswith(dossier.LABEL)]
    assert added and all(line.startswith(dossier.LABEL + " TSDR: ") for line in added)
    assert any("(provisional)" in line for line in added) and any("(confirmed)" in line for line in added)
    joined = " ".join(added)
    for forbidden in ("131.5", "140.25", "142.75", "160", "2026-09-08", "2026", "$"):
        assert forbidden not in joined, forbidden
    # the Wisdom lines sit right after the recent-event lane, before the KB passages
    order = bundle.split("\n")
    assert order.index(added[0]) > order.index("A: guidance") and order.index(added[-1]) < order.index("[KB KB] kb text")


def test_the_scrub_keeps_vocabulary_numbers_and_drops_prices_levels_and_dates():
    text = "Buy the 20EMA pullback over $142.75, stop 131.5, sell 50% by Sep 18 or 9/18/2026 — 10-day low."
    out = common.scrub_levels_and_dates(text)
    for kept in ("20EMA", "50%", "10-day"):
        assert kept in out, out
    for gone in ("142.75", "131.5", "Sep 18", "9/18", "2026"):
        assert gone not in out, out


# ── badges ───────────────────────────────────────────────────────────────────

def test_badges_are_empty_with_the_flag_off_unless_previewed(seeded, monkeypatch, touched):
    monkeypatch.delenv("WISDOM_BADGES_ENABLED", raising=False)
    now = datetime(2026, 9, 12, 12, 0, tzinfo=timeutil.ET)
    assert badges.badges_for(["NVDA", "AMD"], now=now) == {}
    assert touched == []
    preview = badges.badges_for(["NVDA"], preview=True, now=now)
    assert preview["NVDA"]["preview"] is True


def test_badges_shape_window_and_exclusions(seeded, monkeypatch):
    monkeypatch.setenv("WISDOM_BADGES_ENABLED", "1")
    now = datetime(2026, 9, 12, 12, 0, tzinfo=timeutil.ET)
    out = badges.badges_for(["nvda", "$AMD", "TSLA", "ZZZZ"], now=now)
    assert set(out) == {"NVDA"}
    assert out["NVDA"] == {"kind": "call", "speaker": "TSDR", "stated_at": "2026-09-08T10:05:00-04:00",
                           "label": "UCT said · provisional"}
    assert badges.badges_for(["NVDA"], now=datetime(2026, 9, 30, 12, 0, tzinfo=timeutil.ET)) == {}
    assert badges.parse_tickers(" nvda, $amd ,, NVDA ") == ["NVDA", "AMD"]
