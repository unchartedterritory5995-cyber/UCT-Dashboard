"""desk_creative — per-session topical titles + AI covers for The Desk.

The contract under test: both composers are fed the day's story (a distilled
wire brief), run behind deterministic gates, and can NEVER break a publish —
every failure path lands on exactly what ships today (classic title / themed
card via the caller's fallback).
"""
import io
import json
import os

import pytest
from PIL import Image

from api.services import desk_creative as dc

CTX = {
    "date": "2026-08-19",
    "phase": "FTD Confirmed · Restraint Rule active",
    "tone": "cautious",
    "exposure": "55%",
    "market_line": "SPY 767.63 holding above its MAs — 749.53 is the line",
    "tech_check": "QQQ 716.11 — above key MAs, confirming",
    "leaders": ["MU", "DELL", "LITE"],
    "big_mover": "MRNA +73% — cancer vaccine trial win",
    "our_watchlist_sectors": ["Tech", "Energy"],
    "background_hot_theme_this_week": "Memory & HBM (+14.4% on the week)",
}

SHOW = dict(section="Live Trading Sessions",
            title_prefix="Live Trading Session",
            date_text="August 19, 2026")
CLASSIC = "Live Trading Session — August 19, 2026"


def _slate(*hooks):
    """An llm stub returning the given hooks as the slate."""
    def llm(system, user):
        return json.dumps({"slate": list(hooks)})
    return llm


def _title(tmp_path, llm, ctx=CTX):
    return dc.compose_title(ctx=ctx, llm=llm,
                            history_path=str(tmp_path / "th.json"), **SHOW)


# ---------------------------------------------------------------------------
# compose_title — the headline desk
# ---------------------------------------------------------------------------

def test_first_gate_passing_hook_ships_with_show_and_date(tmp_path):
    t = _title(tmp_path, _slate("MRNA Rips 73%, We Stay Disciplined"))
    assert t == "MRNA Rips 73%, We Stay Disciplined | Live Trading Session — August 19, 2026"


def test_llm_failure_falls_back_to_classic_title(tmp_path):
    def boom(system, user):
        raise RuntimeError("api down")
    assert _title(tmp_path, boom) == CLASSIC


def test_unparseable_slate_falls_back(tmp_path):
    assert _title(tmp_path, lambda s, u: "not json at all") == CLASSIC


def test_missing_wire_context_falls_back_without_calling_llm(tmp_path):
    calls = []
    def llm(system, user):
        calls.append(1)
        return json.dumps({"slate": ["Anything"]})
    assert _title(tmp_path, llm, ctx=None) == CLASSIC
    assert calls == []


def test_hook_em_dash_is_scrubbed_but_date_separator_stays(tmp_path):
    t = _title(tmp_path, _slate("Restraint Rule On — MU Leads Anyway"))
    hook = t.split(" | ")[0]
    assert "—" not in hook
    assert t.count("—") == 1          # only the structural " — date" separator


def test_corny_hook_is_cut_and_slate_walks_down(tmp_path):
    t = _title(tmp_path, _slate("Buckle Up for a Wild Ride",
                                "MU Holds the Line at 767"))
    assert t.startswith("MU Holds the Line at 767 | ")


def test_emoji_hook_is_cut(tmp_path):
    t = _title(tmp_path, _slate("MRNA Moon Day \U0001F680", "MRNA Rips 73%"))
    assert t.startswith("MRNA Rips 73% | ")


def test_market_bullish_claim_on_cautious_tape_is_cut(tmp_path):
    # tone=cautious: a MARKET-subject rally claim is a lie; a single-stock one is not.
    t = _title(tmp_path, _slate("The Market Is Ripping Higher",
                                "MRNA Rips 73%, Tape Stays Cautious"))
    assert t.startswith("MRNA Rips 73%, Tape Stays Cautious | ")


def test_invented_number_is_cut(tmp_path):
    # 800 appears nowhere in the day's data; 767 does.
    t = _title(tmp_path, _slate("SPY Reclaims 800", "SPY Holds 767"))
    assert t.startswith("SPY Holds 767 | ")


def test_full_title_never_exceeds_youtube_cap(tmp_path):
    long_hook = "Memory Names Keep Working While The Rest Of The Watchlist Just Sits There Waiting"
    t = _title(tmp_path, _slate(long_hook, "MU Leads"))
    assert len(t) <= 100
    assert t.startswith("MU Leads | ")


def test_opener_echo_against_recent_titles_is_cut(tmp_path):
    hp = tmp_path / "th.json"
    hp.write_text(json.dumps([{"date": "2026-08-18",
                               "title": "MRNA Rips Again Today | Evening Update — August 18, 2026",
                               "opener": "mrna rips again"}]), encoding="utf-8")
    t = dc.compose_title(ctx=CTX, llm=_slate("MRNA Rips Again Somehow", "MU Holds 767"),
                         history_path=str(hp), **SHOW)
    assert t.startswith("MU Holds 767 | ")


def test_slate_exhausted_falls_back(tmp_path):
    t = _title(tmp_path, _slate("Buckle Up", "Insane Move \U0001F680"))
    assert t == CLASSIC


def test_shipped_title_is_recorded_in_history(tmp_path):
    hp = tmp_path / "th.json"
    dc.compose_title(ctx=CTX, llm=_slate("MU Holds 767"),
                     history_path=str(hp), **SHOW)
    hist = json.loads(hp.read_text(encoding="utf-8"))
    assert hist and hist[-1]["title"].startswith("MU Holds 767 | ")


def test_fallback_is_never_recorded_in_history(tmp_path):
    hp = tmp_path / "th.json"
    dc.compose_title(ctx=CTX, llm=_slate("Buckle Up"), history_path=str(hp), **SHOW)
    assert not hp.exists() or json.loads(hp.read_text(encoding="utf-8")) == []


# ---------------------------------------------------------------------------
# day_context — the pod-side day brief
# ---------------------------------------------------------------------------

def test_day_context_is_none_without_wire_data(monkeypatch):
    from api.services import engine
    monkeypatch.setattr(engine, "_load_wire_data", lambda: None)
    assert dc.day_context() is None


def test_day_context_distills_the_day_story(monkeypatch):
    from api.services import engine
    wire = {
        "date": "2026-08-19",
        "exposure": {"score": 55},
        "breadth": {"market_phase": "FTD Confirmed"},
        "game_plan": {"market_line": "SPY holding", "tech_check": "QQQ confirming"},
        "leadership": [{"sym": "MU", "score": 99}, {"sym": "DELL", "score": 98},
                       {"sym": "LITE", "score": 97}, {"sym": "XYZ", "score": 1}],
        "movers": {"ripping": [{"sym": "MRNA", "pct": "+73%",
                                "headline": "vaccine win"}]},
    }
    monkeypatch.setattr(engine, "_load_wire_data", lambda: wire)
    ctx = dc.day_context()
    assert ctx["date"] == "2026-08-19"
    assert ctx["tone"] == "cautious"                # 40 <= 55 < 70
    assert ctx["leaders"] == ["MU", "DELL", "LITE"]
    assert "MRNA" in ctx["big_mover"]
    assert ctx["market_line"] == "SPY holding"


# ---------------------------------------------------------------------------
# render_cover — the art director
# ---------------------------------------------------------------------------

def _png_1536x1024():
    img = Image.new("RGB", (1536, 1024), (30, 20, 10))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


GOOD_SPEC = {"style": "expedition-map", "metaphor": "candlestick mountains",
             "scene": "an aged explorer's map with candlestick mountain ranges"}


def _cover(tmp_path, llm=None, imagegen=None, ctx=CTX):
    return dc.render_cover(
        section="Sunday Scans", eyebrow="SUNDAY SCANS", date_text="August 19, 2026",
        ctx=ctx,
        llm=llm or (lambda s, u: json.dumps(GOOD_SPEC)),
        imagegen=imagegen or (lambda scene: _png_1536x1024()),
        history_path=str(tmp_path / "ch.json"))


def test_cover_happy_path_returns_1280x720_jpeg(tmp_path):
    out = _cover(tmp_path)
    img = Image.open(io.BytesIO(out))
    assert img.format == "JPEG"
    assert img.size == (1280, 720)


def test_cover_is_none_when_imagegen_fails(tmp_path):
    assert _cover(tmp_path, imagegen=lambda scene: None) is None


def test_cover_is_none_when_llm_raises(tmp_path):
    def boom(s, u):
        raise RuntimeError("api down")
    assert _cover(tmp_path, llm=boom) is None


def test_cover_is_none_without_wire_context(tmp_path):
    calls = []
    def llm(s, u):
        calls.append(1)
        return json.dumps(GOOD_SPEC)
    assert _cover(tmp_path, llm=llm, ctx=None) is None
    assert calls == []


def test_forbidden_scene_gets_one_reask_then_gives_up(tmp_path):
    calls = []
    def llm(s, u):
        calls.append(1)
        return json.dumps({"style": "arena", "metaphor": "m",
                           "scene": "Elon Musk rings the opening bell"})
    assert _cover(tmp_path, llm=llm) is None
    assert len(calls) == 2                          # exactly one re-ask


def test_recently_used_style_is_replaced_not_repeated(tmp_path):
    hp = tmp_path / "ch.json"
    hp.write_text(json.dumps([{"style": "expedition-map"},
                              {"style": "arena"},
                              {"style": "neon-noir"}]), encoding="utf-8")
    out = dc.render_cover(
        section="Sunday Scans", eyebrow="SUNDAY SCANS", date_text="August 19, 2026",
        ctx=CTX, llm=lambda s, u: json.dumps(GOOD_SPEC),
        imagegen=lambda scene: _png_1536x1024(), history_path=str(hp))
    assert out is not None
    hist = json.loads(hp.read_text(encoding="utf-8"))
    assert hist[-1]["style"] not in {"expedition-map", "arena", "neon-noir"}


def test_cover_history_records_style_and_metaphor(tmp_path):
    hp = tmp_path / "ch.json"
    dc.render_cover(
        section="Sunday Scans", eyebrow="SUNDAY SCANS", date_text="August 19, 2026",
        ctx=CTX, llm=lambda s, u: json.dumps(GOOD_SPEC),
        imagegen=lambda scene: _png_1536x1024(), history_path=str(hp))
    hist = json.loads(hp.read_text(encoding="utf-8"))
    assert hist[-1]["style"] == "expedition-map"
    assert hist[-1]["metaphor"] == "candlestick mountains"


def test_frame_handles_tall_source_still_1280x720():
    img = Image.new("RGB", (1024, 1536), (10, 10, 10))
    buf = io.BytesIO(); img.save(buf, "PNG")
    out = dc._frame(buf.getvalue(), "EVENING UPDATE", "August 19, 2026")
    got = Image.open(io.BytesIO(out))
    assert got.size == (1280, 720)


# ---------------------------------------------------------------------------
# flags — blank env means exactly today's behavior
# ---------------------------------------------------------------------------

def test_flags_default_off(monkeypatch):
    monkeypatch.delenv("DESK_CREATIVE_TITLES", raising=False)
    monkeypatch.delenv("DESK_CREATIVE_THUMBS", raising=False)
    assert dc.titles_enabled() is False
    assert dc.thumbs_enabled() is False


def test_flags_on(monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_TITLES", "1")
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    assert dc.titles_enabled() is True
    assert dc.thumbs_enabled() is True


# ---------------------------------------------------------------------------
# Review fixes (2026-08-19): retry consistency, honest rotation, emoji width
# ---------------------------------------------------------------------------

def test_star_and_bang_emoji_hooks_are_cut(tmp_path):
    # U+2B50 / U+203C fall outside the naive emoji blocks; they must still cut.
    t = _title(tmp_path, _slate("⭐ MRNA Rips 73%", "‼ MU Alert", "MU Holds 767"))
    assert t.startswith("MU Holds 767 | ")


def test_record_false_composes_without_writing_history(tmp_path):
    hp = tmp_path / "th.json"
    t = dc.compose_title(ctx=CTX, llm=_slate("MU Holds 767"),
                         history_path=str(hp), record=False, **SHOW)
    assert t.startswith("MU Holds 767 | ")
    assert not hp.exists()


def test_record_shipped_title_then_recall_round_trip(tmp_path):
    hp = str(tmp_path / "th.json")
    shipped = "MU Holds 767 | Live Trading Session — August 19, 2026"
    dc.record_shipped_title(shipped, show="Live Trading Session", history_path=hp)
    assert dc.recall_title("Live Trading Session", "August 19, 2026",
                           history_path=hp) == shipped


def test_recall_title_is_none_for_other_date_or_show(tmp_path):
    hp = str(tmp_path / "th.json")
    dc.record_shipped_title("Hook | Evening Update — August 19, 2026",
                            show="Evening Update", history_path=hp)
    assert dc.recall_title("Evening Update", "August 18, 2026", history_path=hp) is None
    assert dc.recall_title("Live Trading Session", "August 19, 2026", history_path=hp) is None


def test_recall_title_ignores_classic_entries(tmp_path):
    # A classic title (no hook) recorded by accident must not be "recalled" as creative.
    hp = str(tmp_path / "th.json")
    dc.record_shipped_title("Evening Update — August 19, 2026",
                            show="Evening Update", history_path=hp)
    assert dc.recall_title("Evening Update", "August 19, 2026", history_path=hp) is None


def test_banned_style_steers_the_render_not_just_the_record(tmp_path):
    # Director ignores the ban: the SCENE fed to the image model must be pulled
    # into the replacement lane, not rendered as-written in the banned lane.
    hp = tmp_path / "ch.json"
    hp.write_text(json.dumps([{"style": "neon-noir"}]), encoding="utf-8")
    captured = {}
    def imagegen(scene):
        captured["scene"] = scene
        return _png_1536x1024()
    dc.render_cover(
        section="Evening Update", eyebrow="EVENING UPDATE", date_text="August 19, 2026",
        ctx=CTX,
        llm=lambda s, u: json.dumps({"style": "neon-noir", "metaphor": "m",
                                     "scene": "rain-slick neon streets"}),
        imagegen=imagegen, history_path=str(hp))
    lanes = [k for k in dc.ART_DIRECTIONS if k != "neon-noir"]
    expected = lanes[dc._seed("August 19, 2026|EVENING UPDATE") % len(lanes)]
    assert captured["scene"].startswith(dc.ART_DIRECTIONS[expected])
    hist = json.loads(hp.read_text(encoding="utf-8"))
    assert hist[-1]["style"] == expected


# ---------------------------------------------------------------------------
# One owner for the "{show} — {date}" format (second-authority defect class)
# ---------------------------------------------------------------------------

def test_classic_title_and_suffix_share_one_owner():
    assert dc.date_suffix("August 19, 2026") == "— August 19, 2026"
    assert dc.classic_title("Evening Update", "August 19, 2026") == \
        "Evening Update — August 19, 2026"
    assert dc.classic_title("Evening Update", "August 19, 2026").endswith(
        dc.date_suffix("August 19, 2026"))
