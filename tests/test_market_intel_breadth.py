"""Breadth Slice 1 (Market Intelligence) — synthetic, deterministic tests.

Every value below is FAKE. No network, no model, no real market data: the canonical breadth functions
are replaced with in-memory fixtures, and a socket guard proves nothing leaves the process.
Covers: supported metrics, date alignment (weekend / holiday / missing session snapping), coverage
floors, finalized-only (D5) handling, missing data, unsupported requests, bounds, and answer accuracy.
"""
from __future__ import annotations

import re
import time
from pathlib import Path

import pytest

from api.services import breadth_metrics as bm
from api.services.market_intel import breadth_answer as ba
from api.services.market_intel import breadth_reads as br

# ── synthetic fixture world (shared with the Agent's leak tests) ─────────────
from tests.market_intel_breadth_fixtures import (  # noqa: E402
    FIRST, HOLIDAY, LAST_SEALED, MISSING, SESSIONS, synthetic_breadth_world,
)
from tests.market_intel_breadth_fixtures import value as _value  # noqa: E402


@pytest.fixture
def world(monkeypatch):
    return synthetic_breadth_world(monkeypatch)


def idx(day: str) -> int:
    return SESSIONS.index(day)


# ── B: reads ─────────────────────────────────────────────────────────────────

def test_value_latest_is_the_last_finalized_session(world):
    r = br.read({"mode": "value", "universe": "us", "metrics": ["pct_above_50sma"], "date": None})
    m = r["metrics"][0]
    assert r["status"] == "ok" and m["as_of"] == LAST_SEALED and m["snapped"] is False
    assert m["value"] == _value("pct_above_50sma", idx(LAST_SEALED))
    assert m["prior_session"] == SESSIONS[-2]


def test_provisional_sessions_after_the_watermark_never_surface(world):
    """D5: finalized EOD only — the 99999 provisional bars are dropped, not substituted."""
    for mode_req in ({"mode": "value", "date": None},
                     {"mode": "series", "start": "2026-10-01", "end": None}):
        r = br.read({**mode_req, "universe": "nyse", "metrics": ["new_52w_highs"]})
        blob = repr(r)
        assert "99999" not in blob and "2026-10-12" not in blob and "2026-10-13" not in blob


@pytest.mark.parametrize("asked,expect", [
    ("2026-10-10", "2026-10-09"),     # Saturday → Friday
    (HOLIDAY, "2026-07-02"),          # holiday → prior session
    (MISSING, "2026-08-19"),          # a session with no bar → prior session, never interpolated
])
def test_dates_snap_to_the_nearest_earlier_finalized_session(world, asked, expect):
    r = br.read({"mode": "value", "universe": "nasdaq", "metrics": ["advancing"], "date": asked})
    m = r["metrics"][0]
    assert m["as_of"] == expect and m["snapped"] is True and m["requested_date"] == asked
    assert m["value"] == _value("advancing", idx(expect))


def test_a_not_yet_finalized_session_is_refused_not_snapped(world):
    """D5: 2026-10-13 is a trading day whose (provisional) bar exists but is not finalized — saying
    "2026-10-09's value" for it would be stale data presented as that date's. Refuse instead."""
    m = br.read({"mode": "value", "universe": "us", "metrics": ["advancing"], "date": "2026-10-13"})["metrics"][0]
    assert m["status"] == "refused" and m["reason"] == "after_latest" and m["latest_finalized"] == LAST_SEALED


def test_exact_session_is_not_marked_snapped(world):
    m = br.read({"mode": "value", "universe": "us", "metrics": ["advancing"], "date": "2026-08-19"})["metrics"][0]
    assert m["as_of"] == "2026-08-19" and m["snapped"] is False


def test_before_history_and_after_latest_are_refused_with_the_bounds(world):
    early = br.read({"mode": "value", "universe": "us", "metrics": ["advancing"], "date": "2020-01-02"})["metrics"][0]
    late = br.read({"mode": "value", "universe": "us", "metrics": ["advancing"], "date": "2026-12-01"})["metrics"][0]
    assert early["status"] == "refused" and early["reason"] == "before_history" and early["history_start"] == FIRST
    assert late["status"] == "refused" and late["reason"] == "after_latest" and late["latest_finalized"] == LAST_SEALED


@pytest.mark.parametrize("bad", ["2024-02-30", "10/09/2026", "yesterday", 20261009])
def test_malformed_dates_are_refused(world, bad):
    r = br.read({"mode": "value", "universe": "us", "metrics": ["advancing"], "date": bad})
    assert r["status"] == "refused" and r["reason"] == "bad_date"


@pytest.mark.parametrize("req,reason", [
    ({"mode": "value", "universe": "uct", "metrics": ["advancing"]}, "unsupported_universe"),
    ({"mode": "value", "universe": "lse", "metrics": ["advancing"]}, "unsupported_universe"),
    ({"mode": "value", "universe": "us", "metrics": ["up_on_volume"]}, "unknown_metric"),
    ({"mode": "value", "universe": "us", "metrics": ["breadth_score"]}, "unknown_metric"),     # UCT composite: excluded
    ({"mode": "value", "universe": "us", "metrics": ["a", "b", "c", "d", "e"]}, "too_many_metrics"),
    ({"mode": "value", "universe": "us", "metrics": []}, "bad_request"),
    ({"mode": "forecast", "universe": "us", "metrics": ["advancing"]}, "bad_request"),
    ({"mode": "value", "universe": "us", "metrics": ["advancing"], "start": "2026-07-01"}, "bad_request"),
    ({"mode": "series", "universe": "us", "metrics": ["advancing"], "from": "2026-07-01", "to": None}, "bad_request"),
    ({"mode": "series", "universe": "us", "metrics": ["advancing"], "start": "2026-09-01", "end": "2026-08-01"}, "bad_date"),
    ({"mode": "compare", "universe": "us", "metrics": ["advancing"], "date": None}, "bad_date"),
    ("not a dict", "bad_request"),
])
def test_unsupported_requests_are_refused_without_reading(world, req, reason):
    r = br.read(req)
    assert r["status"] == "refused" and r["reason"] == reason
    assert world["calls"] == []                                 # validation happens before any read


def test_all_slice_metrics_are_supported_for_all_three_universes(world):
    for u in br.SLICE1_UNIVERSES:
        for i in range(0, len(br.SLICE1_METRICS), 4):
            chunk = list(br.SLICE1_METRICS[i:i + 4])
            r = br.read({"mode": "value", "universe": u, "metrics": chunk, "date": "2026-09-15"})
            assert r["status"] == "ok", (u, chunk, r)
            for m in r["metrics"]:
                assert m["value"] == _value(m["metric"], idx("2026-09-15"))
                assert m["unit"] == bm.get(m["metric"])["unit"]


def test_unpublished_metric_is_refused_and_others_still_answer(world):
    world["unpublished"].add("NH")
    r = br.read({"mode": "value", "universe": "us", "metrics": ["new_52w_highs", "advancing"], "date": None})
    assert r["status"] == "partial"
    assert r["metrics"][0]["reason"] == "not_published" and r["metrics"][1]["status"] == "ok"


def test_missing_series_is_unavailable_not_zero(world):
    world["empty"].add("declining")
    r = br.read({"mode": "value", "universe": "us", "metrics": ["declining"], "date": None})
    assert r["status"] == "unavailable" and r["metrics"][0]["reason"] == "read_failed"
    assert "value" not in r["metrics"][0]


def test_without_an_authority_the_watermark_is_not_trusted(world):
    """B10: the fallback store's `last` can include provisional rows — refuse rather than guess."""
    world["avail"]["us"].pop("authority")
    r = br.read({"mode": "value", "universe": "us", "metrics": ["advancing"], "date": None})
    assert r["status"] == "unavailable" and r["reason"] == "not_finalized"
    assert world["calls"] == []


def test_universe_missing_from_availability_is_refused(world):
    world["avail"].pop("nyse")
    r = br.read({"mode": "value", "universe": "nyse", "metrics": ["advancing"], "date": None})
    assert r["status"] == "refused" and r["reason"] == "universe_not_enabled"


def test_slow_store_returns_warming_within_the_deadline(world):
    world["slow"] = 0.5
    t0 = time.monotonic()
    r = br.read({"mode": "value", "universe": "us", "metrics": ["advancing"], "date": None}, deadline_s=0.1)
    assert time.monotonic() - t0 < 0.45
    assert r["status"] == "unavailable" and r["reason"] == "warming"


def test_store_failure_never_raises(world):
    world["raise"] = True
    r = br.read({"mode": "value", "universe": "us", "metrics": ["advancing"], "date": None})
    assert r["status"] == "unavailable" and r["metrics"][0]["reason"] == "read_failed"


def test_out_of_domain_values_are_dropped_by_the_catalogue_rule(world, monkeypatch):
    real = br._bs.build_breadth_bars

    def with_bad(sym, tf="D", n=400):
        p = real(sym, tf, n)
        p["bars"] = [{**b, "c": 140.0} if b["t"] == LAST_SEALED else b for b in p["bars"]]   # 140% is not a reading
        return p
    monkeypatch.setattr(br._bs, "build_breadth_bars", with_bad)
    m = br.read({"mode": "value", "universe": "us", "metrics": ["pct_above_50sma"], "date": None})["metrics"][0]
    assert m["as_of"] == SESSIONS[-2]          # the bad session is skipped, not shown


def test_compare_reports_both_sessions_and_the_change(world):
    r = br.read({"mode": "compare", "universe": "us", "metrics": ["pct_above_200sma"],
                 "date": None, "compare_date": "2026-07-04"})
    m = r["metrics"][0]
    assert m["current"]["as_of"] == LAST_SEALED
    assert m["other"]["as_of"] == "2026-07-02" and m["other"]["snapped"] is True     # 07-03 holiday, 07-04 Sat
    assert m["change"] == pytest.approx(m["current"]["value"] - m["other"]["value"])


def test_series_summary_is_exact_and_bounded(world):
    r = br.read({"mode": "series", "universe": "nasdaq", "metrics": ["net_new_high_low"],
                 "start": "2026-07-01", "end": "2026-09-30"})
    m = r["metrics"][0]
    win = [(s, _value("net_new_high_low", i)) for i, s in enumerate(SESSIONS) if "2026-07-01" <= s <= "2026-09-30"]
    vals = [v for _, v in win]
    assert m["sessions"] == len(win) and m["start"] == win[0][0] and m["end"] == win[-1][0]
    assert m["first"]["value"] == vals[0] and m["last"]["value"] == vals[-1]
    assert m["min"]["value"] == min(vals) and m["max"]["value"] == max(vals)
    assert m["mean"] == pytest.approx(sum(vals) / len(vals))
    assert m["change"] == pytest.approx(vals[-1] - vals[0])
    dates = [p["date"] for p in m["sampled"]]
    assert len(dates) <= br.SAMPLE_POINTS and dates == sorted(dates)
    assert {win[0][0], win[-1][0], m["min"]["date"], m["max"]["date"]} <= set(dates)


def test_series_clipped_to_finalized_coverage_says_so(world):
    m = br.read({"mode": "series", "universe": "us", "metrics": ["advancing"],
                 "start": "2026-05-01", "end": "2026-12-31"})["metrics"][0]
    assert m["start"] == FIRST and m["end"] == LAST_SEALED and m["clipped_start"] and m["clipped_end"]


def test_range_cap(world, monkeypatch):
    monkeypatch.setattr(br, "MAX_RANGE_SESSIONS", 10)
    m = br.read({"mode": "series", "universe": "us", "metrics": ["advancing"],
                 "start": "2026-06-01", "end": None})["metrics"][0]
    assert m["status"] == "refused" and m["reason"] == "range_too_long"


def test_result_carries_coverage_freshness_and_provenance(world):
    r = br.read({"mode": "value", "universe": "nyse", "metrics": ["advancing"], "date": None})
    assert r["coverage"]["first"] == FIRST and r["coverage"]["last"] == LAST_SEALED
    assert r["coverage"]["authority"] == "exchange-breadth-v1"
    assert r["basis"] == "end-of-day, finalized sessions only"
    assert r["provenance"]["service"] == "breadth_symbols.build_breadth_bars"
    assert "point-in-time" in (r["universe_description"] or "")


def test_reads_use_the_canonical_symbol_and_full_history(world):
    br.read({"mode": "value", "universe": "us", "metrics": ["pct_above_50sma"], "date": None})
    assert world["calls"] == [("US:A50", "D", br.FULL_HISTORY_BARS)]


# ── C: deterministic answers ─────────────────────────────────────────────────

def _nums(text: str) -> set[str]:
    return set(re.findall(r"\d[\d,]*\.?\d*", text))


def test_value_answer_states_value_session_units_and_source(world):
    res = br.read({"mode": "value", "universe": "us", "metrics": ["pct_above_50sma"], "date": "2026-10-10"})
    a = ba.answer(res)
    v = _value("pct_above_50sma", idx(LAST_SEALED))
    assert f"{v:.1f}%" in a["text"] and LAST_SEALED in a["text"]
    assert "you asked for 2026-10-10" in a["text"] and "nearest earlier" in a["text"]
    assert "Source: UCT Breadth — US." in a["text"] and "Finalized end-of-day data" in a["text"]
    assert a["table"]["columns"][0]["key"] == "metric" and a["table"]["rows"][0]["session"] == LAST_SEALED


def test_answer_numbers_all_come_from_the_read(world):
    """Accuracy rail: every number in the text is a value, date part, label number or coverage bound."""
    res = br.read({"mode": "compare", "universe": "nasdaq", "metrics": ["net_new_high_low", "ratio_5day"],
                   "date": None, "compare_date": "2026-08-20"})
    text = ba.answer(res)["text"]
    allowed = set()
    for m in res["metrics"]:
        allowed |= _nums(m["label"])
        for p in (m["current"], m["other"]):
            allowed |= _nums(ba.fmt_value(m["unit"], m["domain"], p["value"])) | set(p["as_of"].split("-"))
            allowed |= set((p.get("requested_date") or "").split("-"))
        allowed |= _nums(ba.fmt_change(m["unit"], m["change"]))
    allowed |= set(FIRST.split("-")) | set(LAST_SEALED.split("-")) | _nums(res["universe_description"])
    stray = {n for n in _nums(text) if n.strip(",.") not in {a.strip(",.") for a in allowed}}
    assert not stray, stray


def test_signed_counts_and_ratios_are_formatted_by_unit(world):
    assert ba.fmt_value(bm.UNIT_COUNT, bm.DOMAIN_SIGNED, -38) == "-38"
    assert ba.fmt_value(bm.UNIT_COUNT, bm.DOMAIN_SIGNED, 112) == "+112"
    assert ba.fmt_value(bm.UNIT_COUNT, bm.DOMAIN_NONNEG, 1234) == "1,234"
    assert ba.fmt_value(bm.UNIT_RATIO, bm.DOMAIN_RATIO, 1.5) == "1.50"
    assert ba.fmt_change(bm.UNIT_PERCENT, -3.25) == "-3.2 pts" or ba.fmt_change(bm.UNIT_PERCENT, -3.25) == "-3.3 pts"


def test_partial_answer_marks_what_is_missing(world):
    world["unpublished"].add("NL")
    a = ba.answer(br.read({"mode": "value", "universe": "us", "metrics": ["new_52w_lows", "advancing"], "date": None}))
    assert a["status"] == "partial"
    assert "New 52-Week Lows: not available" in a["text"] and "isn't available; those measures are marked" in a["text"]


def test_refusal_answers_never_contain_a_value(world):
    for req in ({"mode": "value", "universe": "uct", "metrics": ["advancing"]},
                {"mode": "value", "universe": "us", "metrics": ["advancing"], "date": "2026-12-01"}):
        a = ba.answer(br.read(req))
        assert "99999" not in a["text"]
        if a["status"] == "refused":
            assert a["table"] is None or all(r["value"] == "—" for r in a["table"]["rows"])


def test_series_answer_states_range_low_high_and_average(world):
    a = ba.answer(br.read({"mode": "series", "universe": "nyse", "metrics": ["stage2_count"],
                           "start": "2026-09-01", "end": "2026-09-30"}))
    assert "2026-09-01 to 2026-09-30" in a["text"] and "low " in a["text"] and "high " in a["text"]
    assert "average" in a["text"]


def test_answer_is_deterministic(world):
    req = {"mode": "series", "universe": "us", "metrics": ["advancing", "declining"], "start": "2026-06-15", "end": None}
    assert ba.answer(br.read(req)) == ba.answer(br.read(req))


# ── boundary rails ───────────────────────────────────────────────────────────

def test_market_intel_modules_import_no_model_or_network_client():
    root = Path(br.__file__).parent
    forbidden = re.compile(r"^\s*(?:from|import)\s+(anthropic|openai|requests|httpx|urllib|aiohttp)\b"
                           r"|perplexity|voice_tools|_get_anthropic_client", re.M)
    for f in root.glob("*.py"):
        assert not forbidden.search(f.read_text(encoding="utf-8")), f.name


# ── interface additions (Agent review 2026-10-11) ────────────────────────────

def test_date_context_carries_dates_only(world):
    ctx = br.date_context()
    assert ctx == {"today_et": "2026-10-11",
                   "latest_finalized": {"us": LAST_SEALED, "nyse": LAST_SEALED, "nasdaq": LAST_SEALED}}
    assert world["calls"] == []                       # no series read: no breadth value can be in it


def test_latest_finalized_never_raises_and_respects_the_authority(world, monkeypatch):
    world["avail"]["nyse"].pop("authority")
    assert br.latest_finalized("nyse") is None        # an untrusted watermark is not offered as a date
    monkeypatch.setattr(br._bs, "availability", lambda: (_ for _ in ()).throw(RuntimeError("down")))
    assert br.latest_finalized("us") is None


def test_metric_guide_is_compact_and_covers_every_metric():
    assert len(br.METRIC_GUIDE) <= 600
    assert not re.search(r"\d+\.\d", br.METRIC_GUIDE)  # words only, no readings
    covered = br.METRIC_GUIDE
    for m in br.SLICE1_METRICS:
        if m.startswith("pct_above_"):
            n = m[len("pct_above_"):-len("sma")]
            assert n in covered, m
        else:
            assert m in covered, m


def test_sentinel_world_puts_the_sentinel_on_the_session(monkeypatch):
    synthetic_breadth_world(monkeypatch, sentinel=73.4567)
    a = ba.answer(br.read({"mode": "value", "universe": "us", "metrics": ["pct_above_50sma"], "date": None}))
    assert "73.5%" in a["text"] and LAST_SEALED in a["text"]


# ── boundary contracts the Agent relies on (Agent review 2026-10-11) ─────────

@pytest.mark.parametrize("req", [
    {"mode": "value", "universe": "us", "metrics": ["pct_above_50sma"], "date": "2026-10-09"},
    {"mode": "compare", "universe": "nyse", "metrics": ["advancing", "declining"], "date": None, "compare_date": "2026-09-01"},
    {"mode": "series", "universe": "nasdaq", "metrics": ["net_new_high_low"], "start": "2026-07-01", "end": None},
])
def test_validate_is_pure_and_value_free(world, req):
    ok, err = br.validate(dict(req, note="73.4567 sneaked in", extra={"v": 73.4567}))
    assert err is None and world["calls"] == []                      # no read of any kind
    allowed = {"mode", "universe", "metrics", "date", "compare_date", "start", "end"}
    assert set(ok) <= allowed                                        # unknown keys never copied through
    for k, v in ok.items():
        if k == "metrics":
            assert all(m in br.SLICE1_METRICS for m in v)
        elif k in ("date", "compare_date", "start", "end"):
            assert v is None or re.fullmatch(r"\d{4}-\d{2}-\d{2}", v)
        else:
            assert v in br.MODES + br.SLICE1_UNIVERSES
    assert "73.4567" not in repr(ok)


def test_loopback_is_allowed_but_the_network_is_not(world):
    import socket
    a, b = socket.socketpair()                                       # what Windows asyncio needs
    a.close(); b.close()
    with pytest.raises(AssertionError):
        socket.create_connection(("93.184.216.34", 443), timeout=0.1)
    s = socket.socket()
    try:
        with pytest.raises(AssertionError):
            s.connect(("93.184.216.34", 443))
    finally:
        s.close()


def test_all_metrics_refused_says_each_specific_reason_not_the_generic_line(world):
    """Agent review 2026-10-12: a request whose every metric is refused had no top-level reason, so the
    member saw "That breadth answer isn't available." instead of WHY."""
    a = ba.answer(br.read({"mode": "value", "universe": "us", "metrics": ["advancing", "declining"],
                           "date": "2026-10-13"}))
    assert a["status"] == "refused" and "isn't available." not in a["text"].split("\n")[0][-30:]
    assert "after the latest finalized session" in a["text"] and LAST_SEALED in a["text"]
    assert "US · Advancing Issues:" in a["text"] and "US · Declining Issues:" in a["text"]
    early = ba.answer(br.read({"mode": "value", "universe": "us", "metrics": ["advancing"], "date": "2020-01-02"}))
    assert "before this breadth history begins" in early["text"]
