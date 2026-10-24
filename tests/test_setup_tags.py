"""Setup tags (api/services/setup_tags.py): the chart's UCT Intelligence Setups list as text.

Three things are proved here, each on synthetic bars built in this file:

1. EVERY EVENT TAG IS ITS TEXTBOOK DEFINITION. One fixture per event that meets the textbook,
   run through the REAL registered detector and the module's TEXTBOOK narrowing. Where the detector
   is looser than the textbook (kicker, oops reversal, HVE), a second fixture the detector fires on
   but the textbook rejects proves the narrowing actually narrows.
2. THE WINDOW IS THE LAST THREE COMPLETED SESSIONS, for the detectors that look back on their own
   and for the two that judge only the newest bar (NR7, outside bar).
3. THE MEMBER GATE: bullish only (NR7 excepted), member set only, member round only; and the route
   adds no key at all while the flag is off.
"""
import datetime as _dt
import uuid

import pytest

from api.services import setup_tags as st
from api.services.pattern_engine.detectors import registry as reg
from api.services.pattern_engine.primitives.context import build_context


# ── synthetic bars ──────────────────────────────────────────────────────────────

def _days(n, start=_dt.date(2025, 1, 2)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += _dt.timedelta(days=1)
    return out


def _flat(n, price=50.0, rng=1.0, vol=1_000_000.0, drift=0.0):
    """n quiet bars: close drifting by `drift` a session, range `rng`, open at the prior close."""
    ts = _days(n)
    bars, c = [], price
    for i in range(n):
        o = c
        c = round(c + drift + (0.05 if i % 2 else -0.05), 4)
        bars.append({"t": ts[i], "o": o, "h": max(o, c) + rng / 2, "l": min(o, c) - rng / 2,
                     "c": c, "v": vol})
    return bars


def _set(bars, i, **kw):
    bars[i] = {**bars[i], **kw}
    return bars


def _detect(pid, bars):
    st._register_detectors()
    fn = reg.get_detector(pid)
    return [d for d in fn(bars, build_context(bars[-reg.SCAN_BASE_DEPTH:], sym="TEST"))
            if d.get("pattern_id") == pid]


def _textbook(pid, rows):
    check = st.TEXTBOOK.get(pid)
    return [r for r in rows if check is None or check(r)]


# ── 1. one textbook fixture per event, through the real detector ───────────────

def _kicker(textbook=True):
    b = _flat(60)
    if textbook:     # red candle, then a green candle opening above the red candle's OPEN
        _set(b, -2, o=51.0, h=51.2, l=49.4, c=49.5)
        _set(b, -1, o=51.5, h=53.0, l=51.3, c=52.8)
    else:            # green weak close, then a gap over the prior CLOSE only: the trader rule
        _set(b, -2, o=49.4, h=51.2, l=49.4, c=49.6)
        _set(b, -1, o=50.0, h=51.5, l=49.9, c=51.4)
    return b


def test_kicker_fires_on_the_textbook_kicker_and_the_tag_keeps_it():
    rows = _detect("uct_kicker", _kicker())
    assert rows and _textbook("uct_kicker", rows)


def test_kicker_the_trader_rule_without_a_red_candle_is_NOT_a_textbook_kicker():
    rows = _detect("uct_kicker", _kicker(textbook=False))
    assert rows, "control: the detector's own rule fires on this fixture"
    assert _textbook("uct_kicker", rows) == []


def _oops(textbook=True):
    b = _flat(60)
    _set(b, -3, c=50.2)
    _set(b, -2, o=50.2, h=50.5, l=49.5, c=49.7)        # a down session
    if textbook:     # opens BELOW the prior low, closes above the prior close
        _set(b, -1, o=49.0, h=50.2, l=48.5, c=50.0)
    else:            # opens under the prior close but above the prior low
        _set(b, -1, o=49.6, h=50.2, l=49.2, c=50.0)
    return b


def test_oops_reversal_fires_on_the_textbook_oops_and_the_tag_keeps_it():
    rows = _detect("uct_oops_reversal", _oops())
    assert rows and _textbook("uct_oops_reversal", rows)


def test_oops_reversal_an_open_above_the_prior_low_is_NOT_a_textbook_oops():
    rows = _detect("uct_oops_reversal", _oops(textbook=False))
    assert rows, "control: the scan variant fires on this fixture"
    assert _textbook("uct_oops_reversal", rows) == []


def _slingshot():
    b = _flat(80, price=40.0, drift=0.2)
    s = len(b) - 12                                     # a strength day inside the last 25
    _set(b, s, o=b[s - 1]["c"], c=round(b[s - 1]["c"] * 1.05, 4), h=round(b[s - 1]["c"] * 1.055, 4),
         v=3_000_000.0)
    for k in range(s + 1, len(b)):                      # resume the drift from the strength close
        prev = b[k - 1]["c"]
        c = round(prev + 0.05, 4)
        _set(b, k, o=prev, c=c, h=max(prev, c) + 0.5, l=min(prev, c) - 0.5)
    prev = b[-2]["c"]
    _set(b, -1, o=prev, c=prev + 2.0, h=prev + 2.2, l=prev - 0.1)   # the close back over E4H
    return b


def test_slingshot_fires_on_a_first_close_back_over_the_4ema_of_highs():
    b = _slingshot()
    rows = _detect("uct_slingshot", b)
    assert rows and _textbook("uct_slingshot", rows)
    assert st.event_t(rows[0], b) == b[-1]["t"]


def _hve(n=st.SETUP_TAG_HVE_DEPTH):
    b = _flat(n)
    prev = b[-2]["c"]
    return _set(b, -1, o=prev, c=prev + 1.0, h=prev + 1.2, l=prev - 0.1, v=5_000_000.0)


def test_hve_fires_on_a_one_year_volume_record_and_the_tag_keeps_it():
    rows = _detect("uct_hve", _hve())
    assert rows and _textbook("uct_hve", rows)
    assert rows[0]["direction"] == "bullish"


def test_hve_at_the_scans_200_bars_is_NOT_a_one_year_record():
    rows = _detect("uct_hve", _hve(reg.SCAN_BASE_DEPTH))
    assert rows, "control: the detector fires on a 199-session record"
    assert _textbook("uct_hve", rows) == []


def test_nr7_fires_when_the_range_is_the_narrowest_of_seven():
    b = _flat(40)
    c = b[-2]["c"]
    _set(b, -1, o=c, c=c + 0.02, h=c + 0.15, l=c - 0.1)
    rows = _detect("nr7", b)
    assert rows and rows[0]["direction"] == "neutral"


def test_nr7_does_not_fire_when_one_of_the_prior_six_is_narrower():
    b = _flat(40)
    c = b[-2]["c"]
    _set(b, -4, h=b[-4]["c"] + 0.05, l=b[-4]["c"] - 0.05)
    _set(b, -1, o=c, c=c + 0.02, h=c + 0.15, l=c - 0.1)
    assert _detect("nr7", b) == []


def _outside(up=True):
    b = _flat(60)
    p = b[-2]
    hi, lo = p["h"] + 0.6, p["l"] - 0.6
    return _set(b, -1, o=p["c"], h=hi, l=lo, c=(hi - 0.1) if up else (lo + 0.1), v=2_000_000.0)


def test_outside_bar_fires_on_a_higher_high_and_lower_low():
    rows = _detect("outside_bar", _outside())
    assert rows and rows[0]["direction"] == "bullish"
    rows = _detect("outside_bar", _outside(up=False))
    assert rows and rows[0]["direction"] == "bearish"


def test_outside_bar_does_not_fire_on_an_inside_range():
    b = _flat(60)
    p = b[-2]
    _set(b, -1, o=p["c"], h=p["h"] - 0.1, l=p["l"] - 0.6, c=p["c"], v=2_000_000.0)
    assert _detect("outside_bar", b) == []


def _ep():
    b = _flat(80)
    prev = b[-2]["c"]
    o = round(prev * 1.05, 4)
    return _set(b, -1, o=o, h=o + 2.5, l=o - 0.2, c=o + 2.3, v=4_000_000.0)


def test_episodic_pivot_fires_on_a_4pct_gap_on_volume_out_of_a_base():
    b = _ep()
    rows = _detect("episodic_pivot", b)
    assert rows and rows[0]["direction"] == "bullish"
    assert st.event_t(rows[0], b) == b[-1]["t"]


def test_episodic_pivot_does_not_fire_without_the_gap():
    b = _flat(80)
    prev = b[-2]["c"]
    _set(b, -1, o=prev, h=prev + 3.0, l=prev - 0.1, c=prev + 2.8, v=4_000_000.0)
    assert _detect("episodic_pivot", b) == []


# ── 2. the window: the last three completed sessions ───────────────────────────

def _pad_after(bars, k):
    """Append k quiet sessions that never trade under the last bar's low."""
    out = list(bars)
    ts = _days(len(bars) + k)
    for j in range(k):
        prev = out[-1]
        c = prev["c"] + 0.1
        out.append({"t": ts[len(bars) + j], "o": prev["c"], "h": c + 0.4, "l": prev["c"] - 0.05,
                    "c": c, "v": 900_000.0})
    return out


def _pids(tags):
    return {t["setup"] for t in tags}


def test_a_kicker_two_sessions_back_is_tagged_and_four_back_is_not():
    k = _kicker()
    assert "uct_kicker" in _pids(st.compute_tags("TEST", _pad_after(k, 2)))
    assert "uct_kicker" not in _pids(st.compute_tags("TEST", _pad_after(k, 3)))


def test_an_outside_bar_two_sessions_back_is_tagged_though_it_judges_only_the_newest_bar():
    o = _outside()
    tags = st.compute_tags("TEST", _pad_after(o, 2))
    hit = [t for t in tags if t["setup"] == "outside_bar"]
    assert hit and hit[0]["asof_date"] == st._ymd_text(o[-1]["t"])
    assert "outside_bar" not in _pids(st.compute_tags("TEST", _pad_after(o, 3)))


def test_compute_tags_shows_the_textbook_hve_that_the_scans_depth_cannot_see():
    tags = st.compute_tags("TEST", _hve(300))
    hit = [t for t in tags if t["setup"] == "uct_hve"]
    assert hit and hit[0]["setup_name"] == "Highest Volume in a Year"


def test_every_tag_carries_its_name_and_definition():
    tags = st.compute_tags("TEST", _kicker())
    assert tags
    for t in tags:
        name, definition, kind = st.TAG_DEFS[t["setup"]]
        assert t["setup_name"] == name and t["setup_definition"] == definition
        assert t["kind"] == kind and t["tag_round"] == st.TAGS_ROUND


# ── 3. the member gate ──────────────────────────────────────────────────────────

def _tag(pid, direction, rnd=st.TAGS_ROUND):
    name, definition, kind = st.TAG_DEFS.get(pid, ("x", "x.", "event"))
    return {"setup": pid, "setup_name": name, "setup_definition": definition,
            "asof_date": "2026-10-22", "kind": kind, "direction": direction, "tag_round": rnd}


def test_member_gate_keeps_bullish_and_nr7_and_drops_bearish_neutral_and_unknown():
    tags = [_tag("uct_kicker", "bullish"), _tag("uct_hve", "bearish"), _tag("outside_bar", "neutral"),
            _tag("outside_bar", "bearish"), _tag("nr7", "neutral"), _tag("uct_launch_pad_v4", "bullish"),
            _tag("power_earnings_gap", "bullish"), _tag("uct_go_signal", "")]
    kept = st.member_tags(tags)
    assert [(t["setup"], t["direction"]) for t in kept] == [
        ("uct_kicker", "bullish"), ("nr7", "neutral"), ("uct_launch_pad_v4", "bullish")]


def test_member_gate_serves_nothing_off_the_member_round(monkeypatch):
    from api.services import auto_structures
    tags = [_tag("uct_kicker", "bullish")]
    assert st.member_tags(tags)
    assert st.member_tags([_tag("uct_kicker", "bullish", rnd=st.TAGS_ROUND + 1)]) == []
    monkeypatch.setattr(auto_structures, "MEMBER_SETUP_TAGS_ROUND", None)
    assert st.member_tags(tags) == []


def test_the_tag_sets_are_text_only_and_every_id_is_defined():
    assert set(reg.SETUP_TAG_TEAM_SET) == set(st.TAG_DEFS)
    assert reg.SETUP_TAG_MEMBER_SET <= reg.SETUP_TAG_TEAM_SET
    assert not reg.SETUP_TAG_TEAM_SET & reg.DISPLAY_TEAM_SET
    assert "uct_episodic_pivot_v2" not in reg.SETUP_TAG_TEAM_SET
    assert "power_earnings_gap" not in reg.SETUP_TAG_TEAM_SET
    for definition in (d for _, d, _ in st.TAG_DEFS.values()):
        assert definition.endswith(".") and "\n" not in definition


def test_tags_for_is_none_while_either_flag_is_off(monkeypatch):
    monkeypatch.delenv("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", raising=False)
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    assert st.tags_for("TEST", member=True) is None
    monkeypatch.setenv("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "0")
    assert st.tags_for("TEST", member=False) is None


def test_tags_for_fails_closed(monkeypatch):
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", "1")

    def _boom(sym):
        raise RuntimeError("bars store down")
    monkeypatch.setattr(st, "_completed_daily_bars", _boom)
    assert st.tags_for("TEST", member=True) == []


# ── the route: no key while off, member vs admin while on ──────────────────────

@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from api.main import app
    from api.services.auth_db import init_db as auth_init_db
    auth_init_db()
    return TestClient(app)


def _login(client, role="member"):
    from api.services.auth_db import get_connection
    from api.services.auth_service import create_user, create_session
    user = create_user(f"st_{uuid.uuid4()}@example.com", "password123")
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user["id"]))
        conn.execute("INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'pro', 'active')",
                     (uuid.uuid4().hex, user["id"]))
        conn.commit()
    finally:
        conn.close()
    client.cookies.set("uct_session", create_session(user["id"]))


@pytest.fixture
def seeded_bars(monkeypatch, tmp_path):
    import importlib
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    st._CACHE.clear()
    # a textbook kicker one session before the newest completed session
    monkeypatch.setattr(st, "_completed_daily_bars", lambda sym: _pad_after(_kicker(), 1))
    yield
    st._CACHE.clear()


def test_the_route_carries_no_setup_tags_key_while_the_flag_is_off(client, seeded_bars, monkeypatch):
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.delenv("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", raising=False)
    _login(client)
    body = client.get("/api/patterns/TAGX?tf=D&confirmed_only=true").json()
    assert "verdicts" in body and "setup_tags" not in body


def test_the_route_serves_a_member_the_member_tags_and_an_admin_the_team_tags(client, seeded_bars, monkeypatch):
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", "1")
    team = [_tag("uct_kicker", "bullish"), _tag("uct_hve", "bearish"), _tag("uct_launch_pad_v4", "bullish")]
    monkeypatch.setattr(st, "_team_tags_cached", lambda sym: list(team))
    _login(client)
    member = client.get("/api/patterns/TAGX?tf=D&confirmed_only=true").json()["setup_tags"]
    assert [t["setup"] for t in member] == ["uct_kicker", "uct_launch_pad_v4"]
    _login(client, role="admin")
    admin = client.get("/api/patterns/TAGX?tf=D&confirmed_only=true").json()["setup_tags"]
    assert [t["setup"] for t in admin] == ["uct_kicker", "uct_hve", "uct_launch_pad_v4"]
    # weekly charts get no tags at all
    assert "setup_tags" not in client.get("/api/patterns/TAGX?tf=W&confirmed_only=true").json()


def test_the_route_end_to_end_tags_a_real_kicker_for_a_member(client, seeded_bars, monkeypatch):
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", "1")
    _login(client)
    tags = client.get("/api/patterns/TAGX?tf=D&confirmed_only=true").json()["setup_tags"]
    hit = [t for t in tags if t["setup"] == "uct_kicker"]
    assert hit and hit[0]["setup_name"] == "Kicker" and hit[0]["setup_definition"]
