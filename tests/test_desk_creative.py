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


# ---------------------------------------------------------------------------
# Phase 2 — content-aware cover refresh once the transcript lands
# (thumbnails are replaceable any time; YouTube titles are not)
# ---------------------------------------------------------------------------

def test_parse_session_title_classic_and_creative():
    assert dc.parse_session_title("Evening Update — August 19, 2026") == \
        ("Evening Update", "August 19, 2026")
    assert dc.parse_session_title(
        "MRNA Rips, We Watch | Evening Update — August 19, 2026") == \
        ("Evening Update", "August 19, 2026")
    assert dc.parse_session_title("no structural separator") is None
    assert dc.parse_session_title("") is None


def test_render_cover_facts_reach_the_director(tmp_path):
    seen = {}
    def llm(system, user):
        seen["user"] = user
        return json.dumps(GOOD_SPEC)
    dc.render_cover(
        section="Evening Update", eyebrow="EVENING UPDATE", date_text="August 19, 2026",
        ctx=CTX, llm=llm, imagegen=lambda scene: _png_1536x1024(),
        history_path=str(tmp_path / "ch.json"),
        facts={"this_sessions_headline": "MU breakout dissected live",
               "tickers_discussed_in_session": ["MU", "DELL"]})
    assert "MU breakout dissected live" in seen["user"]
    assert "tickers_discussed_in_session" in seen["user"]


class _RefreshYT:
    def __init__(self):
        self.calls = []
    def set_thumbnail(self, video_id, image_bytes):
        self.calls.append((video_id, image_bytes))


_V = {"id": 307, "youtube_id": "YT307",
      "title": "Hook Line | Evening Update — August 19, 2026",
      "category": "Evening Update"}
# The store's real shapes (education_service docstring + announce's test pin):
# dicts keyed "ticker"/"symbol" AND legacy bare strings, sometimes "$"-prefixed.
_INS = {"headline": "MU breakout dissected live",
        "ticker_moments": [{"ticker": "$mu"}, {"symbol": "dell"}, "MU"]}


def test_refresh_sets_content_aware_thumbnail(monkeypatch):
    from api.services import desk_session_insights as dsi
    from api.services import desk_creative
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    marker = b"REFRESHED" * 100
    seen = {}
    def fake_render(**kw):
        seen.update(kw)
        return marker
    monkeypatch.setattr(desk_creative, "render_cover", fake_render)
    yt = _RefreshYT()
    assert dsi.refresh_creative_cover(_V, _INS, youtube=yt) is True
    assert yt.calls == [("YT307", marker)]
    assert seen["facts"]["tickers_discussed_in_session"] == ["MU", "DELL"]  # deduped
    assert seen["facts"]["this_sessions_headline"] == "MU breakout dissected live"
    assert seen["eyebrow"] == "EVENING UPDATE"
    assert seen["date_text"] == "August 19, 2026"


def test_refresh_noop_when_thumbs_flag_off(monkeypatch):
    from api.services import desk_session_insights as dsi
    from api.services import desk_creative
    monkeypatch.delenv("DESK_CREATIVE_THUMBS", raising=False)
    def boom(**kw):
        raise AssertionError("render_cover must not run with the flag off")
    monkeypatch.setattr(desk_creative, "render_cover", boom)
    yt = _RefreshYT()
    assert dsi.refresh_creative_cover(_V, _INS, youtube=yt) is False
    assert yt.calls == []


def test_refresh_none_keeps_the_existing_cover(monkeypatch):
    from api.services import desk_session_insights as dsi
    from api.services import desk_creative
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setattr(desk_creative, "render_cover", lambda **kw: None)
    yt = _RefreshYT()
    assert dsi.refresh_creative_cover(_V, _INS, youtube=yt) is False
    assert yt.calls == []                       # publish-time cover untouched


def test_refresh_never_raises(monkeypatch):
    from api.services import desk_session_insights as dsi
    from api.services import desk_creative
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    def boom(**kw):
        raise RuntimeError("director down")
    monkeypatch.setattr(desk_creative, "render_cover", boom)
    assert dsi.refresh_creative_cover(_V, _INS, youtube=_RefreshYT()) is False


def test_refresh_skips_unparseable_title_and_blank_video_id(monkeypatch):
    from api.services import desk_session_insights as dsi
    from api.services import desk_creative
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setattr(desk_creative, "render_cover", lambda **kw: b"X" * 2000)
    yt = _RefreshYT()
    assert dsi.refresh_creative_cover({"youtube_id": "YT1", "title": "garbage"},
                                      _INS, youtube=yt) is False
    assert dsi.refresh_creative_cover({"youtube_id": "", **{"title": _V["title"]}},
                                      _INS, youtube=yt) is False
    assert yt.calls == []


def test_refresh_is_wired_into_the_generated_path():
    # AST over the module (never a grep): _run_one_pending must CALL
    # refresh_creative_cover — with a non-vacuity control on a sibling call.
    import ast, inspect
    from api.services import desk_session_insights as dsi
    tree = ast.parse(inspect.getsource(dsi))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "_run_one_pending")
    calls = {c.func.attr if isinstance(c.func, ast.Attribute) else
             getattr(c.func, "id", "")
             for c in ast.walk(fn) if isinstance(c, ast.Call)}
    assert "maybe_post_recap" in calls          # control: the probe can see siblings
    assert "refresh_creative_cover" in calls


# ---------------------------------------------------------------------------
# Second review round (2026-08-19): token-honest number gate, pipe ban,
# resilient JSON parsing, opener symmetry, per-session cover history
# ---------------------------------------------------------------------------

def test_number_substring_of_a_real_figure_is_still_invented(tmp_path):
    # "74" hides inside 749.53; "767" is the honest integer part of 767.63.
    t = _title(tmp_path, _slate("SPY Needs 74 More Points", "SPY Holds 767"))
    assert t.startswith("SPY Holds 767 | ")


def test_pipe_in_hook_is_cut(tmp_path):
    # " | " is OUR structural separator — a hook carrying one would confuse
    # every downstream parser (announce, article links, recall).
    t = _title(tmp_path, _slate("MU | The Line Holds", "MU Holds 767"))
    assert t.startswith("MU Holds 767 | ")


def test_slate_with_leadin_sentence_still_parses(tmp_path):
    raw = 'Here are six hooks:\n{"slate": ["MU Holds 767"]}'
    t = _title(tmp_path, lambda s, u: raw)
    assert t.startswith("MU Holds 767 | ")


def test_opener_echo_catches_a_short_hook_repeat(tmp_path):
    # Yesterday's stored FULL title must not hide a 2-word hook repeat.
    hp = tmp_path / "th.json"
    hp.write_text(json.dumps([{
        "title": "MU Leads | Live Trading Session — August 18, 2026",
        "opener": "mu leads"}]), encoding="utf-8")
    t = dc.compose_title(ctx=CTX, llm=_slate("MU Leads", "DELL Holds 767"),
                         history_path=str(hp), **SHOW)
    assert t.startswith("DELL Holds 767 | ")


def test_opener_echo_falls_back_to_hook_of_stored_title(tmp_path):
    # Entries without the opener field (older ledgers) still gate on the HOOK.
    hp = tmp_path / "th.json"
    hp.write_text(json.dumps([{
        "title": "MU Leads | Live Trading Session — August 18, 2026"}]),
        encoding="utf-8")
    t = dc.compose_title(ctx=CTX, llm=_slate("MU Leads", "DELL Holds 767"),
                         history_path=str(hp), **SHOW)
    assert t.startswith("DELL Holds 767 | ")


def test_refresh_render_replaces_the_sessions_cover_history_entry(tmp_path):
    # Upload render + transcript refresh = ONE ledger entry per session, so
    # RECENT_STYLE_BAN keeps spanning three SESSIONS, not 1.5.
    hp = str(tmp_path / "ch.json")
    for _ in range(2):                       # upload, then refresh, same session
        dc.render_cover(section="Sunday Scans", eyebrow="SUNDAY SCANS",
                        date_text="August 19, 2026", ctx=CTX,
                        llm=lambda s, u: json.dumps(GOOD_SPEC),
                        imagegen=lambda scene: _png_1536x1024(), history_path=hp)
    hist = json.loads(open(hp, encoding="utf-8").read())
    assert len(hist) == 1


def test_refresh_skips_when_transcript_gave_no_facts(monkeypatch):
    # A recording spy, NOT a raiser — refresh swallows exceptions by contract,
    # so a boom-based probe would pass vacuously.
    from api.services import desk_session_insights as dsi
    from api.services import desk_creative
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    rendered = []
    monkeypatch.setattr(desk_creative, "render_cover",
                        lambda **kw: rendered.append(1) or b"X" * 2000)
    yt = _RefreshYT()
    empty = {"headline": "", "ticker_moments": []}
    assert dsi.refresh_creative_cover(_V, empty, youtube=yt) is False
    assert rendered == []                    # no paid re-render without new facts
    assert yt.calls == []


# ---------------------------------------------------------------------------
# 2026-08-20 — the desk picks, rotates forms, reads the whole brief and the
# session itself; the image render retries a throttled API.
# ---------------------------------------------------------------------------

def _slate_v2(hooks, pick=""):
    """An llm stub returning the {angle, hooks[{form,hook}], pick} contract."""
    def llm(system, user):
        return json.dumps({"angle": "a", "hooks": [{"form": f, "hook": h} for f, h in hooks],
                           "pick": pick})
    return llm


def test_editors_pick_ships_before_slate_order(tmp_path):
    llm = _slate_v2([("deadpan", "Flat open, flat desk"), ("stakes", "MU decides the week")],
                    pick="MU decides the week")
    assert _title(tmp_path, llm).startswith("MU decides the week | ")


def test_a_pick_that_fails_a_gate_walks_down_to_the_slate(tmp_path):
    llm = _slate_v2([("deadpan", "Flat open, flat desk"), ("stakes", "Buckle up, MU decides")],
                    pick="Buckle up, MU decides")
    assert _title(tmp_path, llm).startswith("Flat open, flat desk | ")


def test_recently_used_forms_drop_to_the_back_and_are_named_to_the_desk(tmp_path):
    hp = tmp_path / "th.json"
    hp.write_text(json.dumps([
        {"date": "2026-08-18", "show": "Live Trading Session", "form": "deadpan",
         "title": "Old one | Live Trading Session — August 18, 2026", "opener": "old one"},
        {"date": "2026-08-19", "show": "Live Trading Session", "form": "deadpan",
         "title": "Older one | Live Trading Session — August 19, 2026", "opener": "older one"},
    ]))
    seen = {}

    def llm(system, user):
        seen["user"] = user
        return json.dumps({"hooks": [{"form": "deadpan", "hook": "Flat open, flat desk"},
                                     {"form": "question", "hook": "Who sold MU at the open?"}]})
    t = dc.compose_title(ctx=CTX, llm=llm, history_path=str(hp), **SHOW)
    assert t.startswith("Who sold MU at the open? | ")
    assert "FORMS USED BY THE LAST TITLES" in seen["user"] and "deadpan" in seen["user"]


def test_form_is_recorded_and_carried_through_record_shipped_title(tmp_path):
    hp = tmp_path / "th.json"
    t = dc.compose_title(ctx=CTX, llm=_slate_v2([("image", "One foot in, one near the exit")]),
                         history_path=str(hp), record=False, **SHOW)
    assert not hp.exists()
    dc.record_shipped_title(t, show="Live Trading Session", history_path=str(hp))
    rec = json.loads(hp.read_text(encoding="utf-8"))[-1]
    assert rec["form"] == "image" and rec["title"] == t


def test_legacy_bare_slate_still_parses_with_positional_forms(tmp_path):
    hp = tmp_path / "th.json"
    t = dc.compose_title(ctx=CTX, llm=_slate("Flat open, flat desk", "Second"),
                         history_path=str(hp), **SHOW)
    assert t.startswith("Flat open, flat desk | ")
    assert json.loads(hp.read_text(encoding="utf-8"))[-1]["form"] == "deadpan"


def test_session_facts_reach_the_title_desk_and_feed_the_number_gate(tmp_path):
    seen = {}

    def llm(system, user):
        seen["user"] = user
        return json.dumps({"slate": ["MU out at 950, clean"]})
    t = dc.compose_title(ctx=CTX, llm=llm, history_path=str(tmp_path / "th.json"),
                         facts={"this_sessions_summary": "Closed MU at 950.10 into the chop",
                                "this_sessions_chapters": ["MU exit", "Watching WMT"]},
                         **SHOW)
    assert t.startswith("MU out at 950, clean | ")          # 950 exists in the facts
    assert "Closed MU at 950.10" in seen["user"] and "Watching WMT" in seen["user"]


def test_day_context_carries_the_whole_brief_and_drops_empties(monkeypatch):
    from api.services import engine
    wire = {
        "date": "2026-08-20", "exposure": {"score": 55, "note": "Grind mode"},
        "breadth": {"market_phase": "Confirmed Uptrend",
                    "distribution_days": [{"sessions_ago": 19, "pct": -1.9},
                                          {"sessions_ago": 1, "pct": -1.69}]},
        "game_plan": {"market_line": "SPY holding", "tech_check": "QQQ chopping",
                      "regime": "FTD Confirmed · Restraint Rule", "play": "Reduced size",
                      "focus": ["MU", "DELL"]},
        "index_levels": {"indices": [{"sym": "SPY", "px": 767.67, "read": "constructive", "flip": 750.17}]},
        "leadership": [{"sym": "MU", "score": 99}],
        "movers": {"ripping": [{"sym": "BULL", "pct": "+11%", "headline": "Q2 beat"}],
                   "drilling": [{"sym": "AAP", "pct": "-15%", "reason": "Advance Auto Parts"}]},
        "rotation": {"note": "Money into Health Care, out of Tech."},
        "earnings": {"bmo": [{"symbol": "WMT", "eps_actual": 0.81, "eps_estimate": 0.73, "ew_total": 90},
                             {"symbol": "BABA", "eps_actual": 1.01, "eps_estimate": 1.94, "ew_total": 59}]},
        "risk_calendar": {"econ": [{"event": "Initial Jobless Claims"}], "amc": ["ROST", "OSIS"], "fed": []},
        "trade_idea": {"sym": "MU", "setup": "20EMA Hold"},
        "watch_list": [{"sym": "CDNA", "state": "triggered"}, {"sym": "PBF", "state": "approaching"}],
    }
    monkeypatch.setattr(engine, "_load_wire_data", lambda: wire)
    ctx = dc.day_context()
    assert ctx["regime"] == "FTD Confirmed · Restraint Rule" and ctx["the_plan"] == "Reduced size"
    assert ctx["focus_names"] == ["MU", "DELL"]
    assert ctx["index_reads"] == ["SPY 767.67 — constructive — line in the sand 750.17"]
    assert ctx["ripping"] == ["BULL +11% — Q2 beat"] and ctx["drilling"] == ["AAP -15% — Advance Auto Parts"]
    assert ctx["rotation"].startswith("Money into")
    assert ctx["earnings_this_morning"] == ["WMT beat (EPS 0.81 vs 0.73 est)", "BABA missed (EPS 1.01 vs 1.94 est)"]
    assert ctx["earnings_tonight"] == ["ROST", "OSIS"] and ctx["econ_today"] == ["Initial Jobless Claims"]
    assert ctx["distribution_days"].startswith("2 distribution days") and "1 session(s) ago" in ctx["distribution_days"]
    assert ctx["wire_trade_idea"] == "MU — 20EMA Hold" and ctx["watchlist_triggered"] == ["CDNA"]
    assert ctx["exposure_note"] == "Grind mode"
    assert "fed_today" not in ctx                               # empty material is not sent
    # the original keys survive untouched (the tests above pin them)
    assert ctx["market_line"] == "SPY holding" and ctx["leaders"] == ["MU"]

    sparse = {"date": "2026-08-20", "exposure": {"score": 80}, "game_plan": {}}
    monkeypatch.setattr(engine, "_load_wire_data", lambda: sparse)
    ctx = dc.day_context()
    assert ctx["tone"] == "risk-on"
    assert not any(k in ctx for k in ("regime", "ripping", "earnings_this_morning", "index_reads"))


class _SummaryZoom:
    def __init__(self, files=None, raw=None, boom=False):
        self.files, self.raw, self.boom = files, raw, boom

    def get_recording_files(self, uuid):
        if self.boom:
            raise RuntimeError("zoom 500")
        return {"recording_files": self.files or []}

    def download_text(self, url):
        return self.raw or ""


_SUMMARY_FILE = [{"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://s"},
                 {"file_type": "SUMMARY", "recording_type": "summary_next_steps", "download_url": "http://n"}]
_SUMMARY_RAW = json.dumps({
    "overall_summary": "Patrick traded MU off the 21 EMA and faded the QQQ chop.",
    "items": [{"label": "MU entry at the 21", "start_time": "00:05:00.000", "summary": "Bought MU on the hold."},
              {"label": "Passing on WMT", "start_time": "00:20:00.000", "summary": "No chase on the gap."}]})


def test_session_facts_from_zoom_distills_headline_chapters_points():
    facts = dc.session_facts_from_zoom(_SummaryZoom(_SUMMARY_FILE, _SUMMARY_RAW), "uuid")
    assert facts["this_sessions_summary"].startswith("Patrick traded MU")
    assert facts["this_sessions_chapters"] == ["MU entry at the 21", "Passing on WMT"]
    assert facts["this_sessions_key_points"] == ["Bought MU on the hold.", "No chase on the gap."]


def test_session_facts_are_none_when_absent_or_broken():
    assert dc.session_facts_from_zoom(_SummaryZoom([], ""), "uuid") is None          # no summary yet
    assert dc.session_facts_from_zoom(_SummaryZoom(_SUMMARY_FILE, "{nope"), "uuid") is None
    assert dc.session_facts_from_zoom(_SummaryZoom(boom=True), "uuid") is None       # never raises
    assert dc.session_facts_from_zoom(object(), "uuid") is None                      # a zoom without the API
    assert dc.session_facts_from_zoom(_SummaryZoom(_SUMMARY_FILE, _SUMMARY_RAW), "") is None


def test_session_facts_reach_the_cover_director(tmp_path):
    seen = {}

    def llm(system, user):
        seen["user"] = user
        return json.dumps(GOOD_SPEC)
    dc.render_cover(section="Live Trading Sessions", eyebrow="LIVE TRADING SESSION",
                    date_text="August 20, 2026", ctx=CTX, llm=llm,
                    imagegen=lambda scene: _png_1536x1024(),
                    history_path=str(tmp_path / "ch.json"),
                    facts={"this_sessions_summary": "MU off the 21, QQQ faded"})
    assert "MU off the 21, QQQ faded" in seen["user"]
    assert "THE SESSION is the story" in dc._COVER_SYSTEM


# ── the image render retries a throttled API ──────────────────────────────

class _Resp:
    def __init__(self, status, body="", headers=None, b64=None):
        self.status_code, self.text, self.headers = status, body, headers or {}
        self._b64 = b64

    def json(self):
        return {"data": [{"b64_json": self._b64}]} if self._b64 else {}


def _fake_post(monkeypatch, responses):
    import base64
    import requests
    calls, sleeps = [], []
    seq = list(responses)

    def post(url, **kw):
        calls.append(kw["json"]["prompt"])
        r = seq.pop(0)
        if isinstance(r, Exception):
            raise r
        return r
    monkeypatch.setattr(requests, "post", post)
    monkeypatch.setattr(dc, "_sleep", lambda s: sleeps.append(s))
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    return calls, sleeps, base64.b64encode(b"PNGDATA").decode()


_B64 = __import__("base64").b64encode(b"PNGDATA").decode()


def test_image_render_retries_a_429_then_succeeds(monkeypatch):
    calls, sleeps, b64 = _fake_post(monkeypatch, [
        _Resp(429, "Rate limit reached for gpt-image-1", {"Retry-After": "7"}),
        _Resp(200, b64=_B64)])
    monkeypatch.setattr(dc, "_IMAGE_BACKOFF_SECS", (20.0, 60.0))
    assert dc._openai_generate("a scene") == b"PNGDATA"
    assert len(calls) == 2 and sleeps == [7.0]                 # Retry-After honored


def test_image_render_gives_up_after_attempts_and_logs_the_reason(monkeypatch, capsys):
    calls, sleeps, _ = _fake_post(monkeypatch, [
        _Resp(429, '{"error":{"message":"Rate limit reached: images per minute"}}'),
        _Resp(503, "overloaded"),
        _Resp(429, "still throttled")])
    assert dc._openai_generate("a scene") is None
    assert len(calls) == 3 and sleeps == [20.0, 60.0]
    out = capsys.readouterr().out
    assert "HTTP 429" in out and "images per minute" in out and "failed" in out


def test_image_render_does_not_retry_a_4xx_that_is_not_throttling(monkeypatch):
    calls, sleeps, _ = _fake_post(monkeypatch, [_Resp(400, "moderation_blocked")])
    assert dc._openai_generate("a scene") is None
    assert len(calls) == 1 and sleeps == []


def test_image_render_retries_a_transport_error(monkeypatch):
    import requests
    calls, sleeps, b64 = _fake_post(monkeypatch, [requests.ConnectionError("reset"), _Resp(200, b64=_B64)])
    assert dc._openai_generate("a scene") == b"PNGDATA"
    assert len(calls) == 2 and sleeps == [20.0]


def test_image_render_attempts_env_is_respected(monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_IMAGE_ATTEMPTS", "1")
    calls, sleeps, _ = _fake_post(monkeypatch, [_Resp(429, "x")])
    assert dc._openai_generate("a scene") is None
    assert len(calls) == 1 and sleeps == []


def test_refresh_success_resolves_a_queued_retry(monkeypatch, tmp_path):
    from api.services import desk_cover_retry as cr
    from api.services import desk_session_insights as dsi
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setenv("DESK_CREATIVE_DATA_DIR", str(tmp_path))
    cr.enqueue("ytid", section="Live Trading Sessions", eyebrow="LIVE TRADING SESSION",
               date_text="August 20, 2026")
    monkeypatch.setattr(dc, "render_cover", lambda **kw: b"J")

    class _YT:
        def set_thumbnail(self, *a):
            pass
    ok = dsi.refresh_creative_cover(
        {"youtube_id": "ytid", "title": "X | Live Trading Session — August 20, 2026",
         "category": "Live Trading Sessions"},
        {"headline": "h", "ticker_moments": [{"ticker": "MU"}]}, youtube=_YT())
    assert ok and cr.pending() == []


# ── the Anthropic call shape (anthropic 1.0.0 dropped `temperature` from
#    messages.create on 2026-08-20 and TypeError'd BOTH composers) ──────────

def test_llm_call_shape_is_kwarg_minimal_and_has_no_temperature():
    kw = dc._llm_kwargs("SYS", "USER")
    assert "temperature" not in kw
    assert set(kw) == {"model", "max_tokens", "thinking", "system", "messages"}
    assert kw["thinking"] == {"type": "disabled"}
    assert kw["system"] == "SYS" and kw["messages"] == [{"role": "user", "content": "USER"}]


def test_llm_passes_exactly_the_pinned_shape_to_the_client(monkeypatch):
    from api.services import engine
    seen = {}

    class _Block:
        type = "text"
        text = '{"slate": ["ok"]}'

    class _Msg:
        content = [_Block()]

    class _Messages:
        def create(self, **kw):
            seen.update(kw)
            return _Msg()

    class _Client:
        messages = _Messages()

        def with_options(self, **kw):
            seen["timeout"] = kw.get("timeout")
            return self
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Client())
    monkeypatch.setenv("DESK_CREATIVE_MODEL", "claude-test-1")
    out = dc._llm("SYS", "USER")
    assert out == '{"slate": ["ok"]}'
    assert "temperature" not in seen and seen["model"] == "claude-test-1"
    assert seen["timeout"] == 90.0


# ── 8/20 owner verdict on the slate: no virtue-signaling restraint ─────────

@pytest.mark.parametrize("hook", [
    "WMT beat, MU held, we still sat out",
    "Do-nothing day, and that was the trade",
    "QQQ pinned to the 20 and 50, hands off",
    "Biotech hype cooled, we chased nothing",
    "MU held the 21, we held our nerve",
    "Sat on hands while tech bled",
    "Two stops, one winner, no regrets",
])
def test_soft_restraint_hooks_are_cut_and_the_slate_walks_down(tmp_path, hook):
    t = _title(tmp_path, _slate(hook, "Dead Tape. Don't Force It."))
    assert t.startswith("Dead Tape. Don't Force It. | "), t


def test_blunt_tape_verdicts_pass_the_soft_gate(tmp_path):
    for hook in ("Chop Fest at the Highs", "TEM Rips While Biotech Rolls Over",
                 "Dead Tape. Don't Force It.", "Who's Still Buying MRNA?",
                 "Three Distribution Days and Counting", "MU Is the Only Thing Working"):
        assert _title(tmp_path, _slate(hook)).startswith(hook + " | "), hook


def test_register_has_no_two_clause_restraint_template():
    # The 8/20 slate was six copies of "A, B, we sat out" because every GOOD
    # example in the register had that shape. Keep the examples varied.
    good = dc._TITLE_SYSTEM.split("GOOD:")[1].split("BAD:")[0]
    examples = [e.strip(" '\n\"") for e in good.split("·")]
    assert len(examples) >= 5
    assert sum("," in e for e in examples) <= 1
    assert not any(dc._SOFT.search(e) for e in examples)
