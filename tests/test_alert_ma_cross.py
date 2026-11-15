"""Moving-average crossover alerts (`ma_cross`) in the CANONICAL alert engine.

Design: docs/alerts/MA-CROSS-DESIGN.md. Every fire here goes through the shipped
cycle (`_run_one_cycle` → `record_trigger` → the delivery hook), every MA value
is cross-checked against `indicator_compute` itself (never a formula typed in
this file), and every refusal is read off the real router.
"""
from __future__ import annotations

import json

import pytest

from api.services import alert_series
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import indicator_compute as ic
from api.services import watchlist_alert_service as wls

STEP = 300                      # 5-minute bars
T0 = 1_700_000_000              # 2023 — every bar is closed by the wall clock


# 2026-11-07 (RS fix U1, review #2) -- PIN MOVED. The RS alert catalog and the
# create door now follow `registry_defs.RS_V2_ENABLED` (and, for `rs_line.rating`,
# `api.main.rs_history_enabled()`), dark by default; registration is unchanged.
# The pins in this file describe the LIT shape, so both flags are lit here,
# deterministically. The dark shape is railed in tests/test_rs_fix_u1_alert_lane.py.
@pytest.fixture(autouse=True)
def _rs_alert_flags_lit(monkeypatch):
    from api.services.signature import registry_defs as _rs_flag_defs
    monkeypatch.setattr(_rs_flag_defs, "RS_V2_ENABLED", True)
    import api.main  # noqa: F401 -- import BEFORE lighting RS_SPLIT_ENABLED: api.main registers providers for the split rows, which registry_defs only built if the flag was on at ITS import
    monkeypatch.setattr(_rs_flag_defs, "RS_SPLIT_ENABLED", True)  # 2026-11-10 (RS split, S2): the lit shape includes the split alerts
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")


def _bars(closes, start_t=T0, step=STEP):
    return [{"t": start_t + i * step, "o": float(c), "h": float(c) + 0.5,
             "l": float(c) - 0.5, "c": float(c), "v": 100_000}
            for i, c in enumerate(closes)]


# Flat, a rally, a slide, a second rally: two up-crosses and one down-cross for a
# fast/slow pair, at bars this file computes from `indicator_compute` itself.
CLOSES = ([100.0] * 30 + [100.0 + 1.5 * i for i in range(1, 16)]
          + [122.5 - 2.0 * i for i in range(1, 21)] + [82.5 + 2.5 * i for i in range(1, 21)])
BARS = _bars(CLOSES)


def _oracle_crosses(closes, ma_type, fast, slow):
    """(up, down) bar indexes where fast crosses slow — straight off indicator_compute."""
    f = (ic.compute_ema if ma_type == "ema" else ic.compute_sma)
    a, b = f(list(closes), fast), f(list(closes), slow)
    up, down = [], []
    for i in range(1, len(closes)):
        if None in (a[i], b[i], a[i - 1], b[i - 1]):
            continue
        p, c = a[i - 1] - b[i - 1], a[i] - b[i]
        if p <= 0 < c:
            up.append(i)
        if p >= 0 > c:
            down.append(i)
    return up, down


def _alert(condition="cross_above", params=None, tf="5", **kw):
    return {"id": 1, "user_id": "u", "sym": "TEST", "indicator": "ma_cross",
            "condition": condition, "threshold": None, "tf": tf,
            "params_json": json.dumps(params if params is not None
                                      else {"ma_type": "ema", "fast": 9, "slow": 20}),
            "last_value": None, **kw}


def _fires_by_walking(alert, bars, mode=None):
    """Judge every bar as the newest CLOSED one, exactly as the cycle would."""
    out = []
    for n in range(2, len(bars) + 1):
        window = bars[:n]
        now = ev.bar_close_epoch(window[-1]["t"], alert["tf"])
        _v, trig, idx = ev._evaluate_for_cycle(alert, window, mode=mode, now_epoch=now)
        if trig:
            out.append(idx)
    return out


# ─── the catalog ────────────────────────────────────────────────────────────

def test_ma_cross_is_a_catalog_entry_with_its_params_and_two_crossings():
    # 2026-11-06 (RS 2b-05): the SEVENTEENTH group; `rs_line` is appended after it
    # (the order itself is pinned by `test_catalog_order_is_the_dropdown_order_and_it_did_not_change`).
    entry = ev.alert_catalog()[16]
    assert entry["indicator"] == "ma_cross" and entry["label"] == "MA Cross"
    (plot,) = entry["plots"]
    assert plot["value"] == "ma_cross"
    assert plot["inputs"] == {"ma_type": "ema", "fast": 9, "slow": 20}
    assert plot["input_options"] == {"ma_type": ["ema", "sma"]}
    assert plot["instance_defs"] == ["movingAverage"]
    assert [c["value"] for c in plot["conditions"]] == ["cross_above", "cross_below"]
    assert all(c["needs_threshold"] is False for c in plot["conditions"])
    assert plot["instance_label"] == "EMA(9) vs EMA(20)"


def test_the_frozen_grid_and_every_existing_entry_are_unmoved():
    """Not a level: INDICATOR_FUNCS stays 28 (the replay grid), and no other
    plot grows a key — `input_options` / `instance_defs` exist only where declared."""
    assert len(ev.INDICATOR_FUNCS) == 28 and "ma_cross" not in ev.INDICATOR_FUNCS
    assert "ma_cross" not in ev.THRESHOLD_ADDRESSES
    # 2026-11-06 (RS 2b-05): the eleven `rs_line.*` addresses are appended AFTER `ma_cross`.
    assert ev.all_addresses()[31] == "ma_cross" and len(ev.all_addresses()) == 51  # 2026-11-12 (RS Exit Warnings): 48 -> 51, +3 rs_exit; 2026-11-10 (RS split, S2): 44 -> 48, +rs_phases.flipBlue/flipRed +rs_vs_ema.crossUp/crossDown; 2026-11-07 (RS 2b-06): +rs_line.rating
    # …every group BEFORE `ma_cross`. 2026-11-06 (RS 2b-05): `rs_line`, after it,
    # declares both keys on every plot too (its columns carry `input_options` and
    # `instance_defs`), by the same rule — only where the column declares them.
    catalog = ev.alert_catalog()
    assert [e["indicator"] for e in catalog[16:]] == ["ma_cross", "rs_line", "rs_phases", "rs_vs_ema", "rs_exit"]  # 2026-11-10 (RS split, S2); 2026-11-12: +rs_exit
    for entry in catalog[:16]:
        for plot in entry["plots"]:
            assert "input_options" not in plot and "instance_defs" not in plot, plot["value"]


def test_the_cross_reuses_indicator_compute_and_never_a_second_formula():
    for ma_type, fn in (("ema", ic.compute_ema), ("sma", ic.compute_sma)):
        closes = [b["c"] for b in BARS]
        want = [None if (a is None or b is None) else a - b
                for a, b in zip(fn(closes, 5), fn(closes, 13))]
        got = alert_series.series_for("ma_cross", BARS, {"ma_type": ma_type, "fast": 5, "slow": 13})
        assert got == want


# ─── evaluation on synthetic bars ───────────────────────────────────────────

@pytest.mark.parametrize("ma_type", ["ema", "sma"])
def test_cross_above_and_below_fire_exactly_on_the_crossing_bars(ma_type):
    params = {"ma_type": ma_type, "fast": 5, "slow": 13}
    up, down = _oracle_crosses(CLOSES, ma_type, 5, 13)
    assert len(up) >= 2 and len(down) >= 1, "the fixture must cross both ways"
    assert _fires_by_walking(_alert("cross_above", params), BARS) == up
    assert _fires_by_walking(_alert("cross_below", params), BARS) == down


def test_ema_and_sma_are_different_alerts_on_the_same_bars():
    ema = _fires_by_walking(_alert("cross_above", {"ma_type": "ema", "fast": 5, "slow": 13}), BARS)
    sma = _fires_by_walking(_alert("cross_above", {"ma_type": "sma", "fast": 5, "slow": 13}), BARS)
    assert ema and sma and ema != sma


def _forming_cross_window():
    """A window whose NEWEST bar crosses, and whose previous bar does not."""
    up, _ = _oracle_crosses(CLOSES, "ema", 5, 13)
    i = up[0]
    return BARS[:i + 1], i


def test_no_trigger_intrabar_the_forming_bar_is_never_judged():
    window, i = _forming_cross_window()
    alert = _alert("cross_above", {"ma_type": "ema", "fast": 5, "slow": 13})
    mid_bar = window[-1]["t"] + STEP / 2               # bar i is still forming
    v, trig, idx = ev._evaluate_for_cycle(alert, window, now_epoch=mid_bar)
    assert idx == i - 1 and trig is False
    closed = ev.bar_close_epoch(window[-1]["t"], "5")   # …and once it closes, it fires
    v, trig, idx = ev._evaluate_for_cycle(alert, window, now_epoch=closed)
    assert idx == i and trig is True


def test_the_rollback_lever_cannot_make_an_ma_cross_fire_intrabar(monkeypatch):
    """`ALERT_EVAL_MODE=forming` moves the legacy addresses — never this one."""
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    assert ev.eval_mode() == "forming"
    window, i = _forming_cross_window()
    alert = _alert("cross_above", {"ma_type": "ema", "fast": 5, "slow": 13})
    mid_bar = window[-1]["t"] + STEP / 2
    for mode in (None, "forming"):
        _v, trig, idx = ev._evaluate_for_cycle(alert, window, mode=mode, now_epoch=mid_bar)
        assert (trig, idx) == (False, i - 1)
        assert ev._evaluate_one(alert, window, mode=mode, now_epoch=mid_bar)[1] is False
    # positive control: a legacy address DOES follow the lever to the newest bar
    rsi = dict(_alert(), indicator="rsi", condition="above", threshold=0.0, params_json=None)
    assert ev._evaluate_for_cycle(rsi, window, now_epoch=mid_bar)[2] == len(window) - 1


def test_invalid_params_never_produce_a_value():
    for bad in ({"fast": 20, "slow": 9}, {"fast": 9, "slow": 9}, {"ma_type": "wma"},
                {"fast": 0}, {"slow": 9999}, {"fast": 2.5}, {"fast": True}):
        assert set(alert_series.series_for("ma_cross", BARS, bad)) == {None}, bad


# ─── the shipped cycle: one trigger per cross, then re-arm ──────────────────

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(ias, "_DB_PATH", str(path))
    ias.init_schema()
    return path


@pytest.fixture
def delivered(monkeypatch):
    """Spies DOWNSTREAM of the fire-once gate (the bell), the real delivery hook in between."""
    got: list = []
    monkeypatch.setattr(wls, "add_alert", lambda *a, **k: got.append((a, k)))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    import api.services.alerts as _alerts
    monkeypatch.setattr(_alerts, "_fire_discord", lambda payload: None)
    monkeypatch.setattr(ev, "_accrue_ledger_receipt", lambda *a, **k: None)
    return got


def test_one_trigger_per_cross_event_and_it_rearms_for_the_next(tmp_db, delivered, monkeypatch):
    params = {"ma_type": "ema", "fast": 5, "slow": 13, "direction": "above", "confirm": "close"}
    up, _ = _oracle_crosses(CLOSES, "ema", 5, 13)
    holder = {"bars": BARS[:2]}
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=400: [dict(b) for b in holder["bars"]])
    aid = ias.create(user_id="u1", sym="TEST", indicator="ma_cross", condition="cross_above",
                     threshold=None, tf="5", params_json=params)
    fired_at = []
    for n in range(2, len(BARS) + 1):
        holder["bars"] = BARS[:n]
        before = len(delivered)
        # the cycle runs SEVERAL times per bar (60 s loop, 5 m bars): still one fire
        for _ in range(3):
            ev._run_one_cycle()
        if len(delivered) > before:
            assert len(delivered) - before == 1
            fired_at.append(n - 1)
    assert fired_at == up and len(up) >= 2, "re-arm: the SECOND cross must fire too"
    row = ias.get(aid)
    assert row["trigger_count"] == len(up)
    fires = ias.list_fires("u1", 50)
    assert len(fires) == len(up)
    assert all(str(f.get("fire_key", "bar:")).startswith("bar:") for f in fires)
    assert "EMA(5) vs EMA(13)" in json.dumps(delivered[0], default=str)


# ─── the create door (router) and permissions ───────────────────────────────

@pytest.fixture
def client(tmp_db):
    from fastapi.testclient import TestClient
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "member-1", "role": "member"}
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _post(client, **over):
    body = {"sym": "NVDA", "indicator": "ma_cross", "condition": "cross_above", "tf": "D",
            "params": {"ma_type": "ema", "fast": 9, "slow": 20, "direction": "above",
                       "confirm": "close"}}
    body.update(over)
    return client.post("/api/indicator-alerts", json=body)


def test_the_catalog_is_served_with_the_entry(client):
    r = client.get("/api/indicator-alerts/catalog")
    assert r.status_code == 200
    assert r.json()["catalog"][16]["indicator"] == "ma_cross"   # 2026-11-06 (RS 2b-05): `rs_line` follows


def test_a_valid_cross_is_armed_with_its_params(client):
    r = _post(client)
    assert r.status_code == 200, r.text
    row = ias.get(int(r.json()["id"]))
    assert row["indicator"] == "ma_cross" and row["condition"] == "cross_above"
    assert row["threshold"] is None and row["tf"] == "D"
    stored = row["params_json"] if isinstance(row["params_json"], dict) else json.loads(row["params_json"])
    assert stored == {"ma_type": "ema", "fast": 9, "slow": 20, "direction": "above", "confirm": "close"}


@pytest.mark.parametrize("over, words", [
    ({"params": {"ma_type": "ema", "fast": 20, "slow": 9}}, "fast period below the slow"),
    ({"params": {"ma_type": "ema", "fast": 20, "slow": 20}}, "fast period below the slow"),
    ({"params": {"ma_type": "wma", "fast": 9, "slow": 20}}, "ma_type must be one of"),
    ({"params": {"ma_type": "ema", "fast": 0, "slow": 20}}, "whole number from 1"),
    ({"params": {"ma_type": "ema", "fast": 9, "slow": 20, "confirm": "intrabar"}}, "completed candle"),
    ({"params": {"ma_type": "ema", "fast": 9, "slow": 20, "direction": "below"}}, "disagrees"),
    ({"condition": "above", "threshold": 1.0}, "offers cross_above, cross_below"),
])
def test_invalid_crosses_are_refused_at_the_door(client, over, words):
    r = _post(client, **over)
    assert r.status_code == 400 and words in r.json()["detail"], r.text
    assert ias.list_for_user("member-1") == []


def test_the_member_cap_still_applies(client, monkeypatch):
    monkeypatch.setattr(ias, "MAX_ALERTS_PER_USER", 1)
    assert _post(client).status_code == 200
    r = _post(client, condition="cross_below", params={"ma_type": "sma", "fast": 50, "slow": 200})
    assert r.status_code == 400


def test_the_routes_still_need_a_session(tmp_db):
    from fastapi.testclient import TestClient
    from api.main import app
    c = TestClient(app)
    assert c.get("/api/indicator-alerts/catalog").status_code == 401
    assert _post(c).status_code == 401
    assert ias.list_for_user("member-1") == []


def test_other_addresses_are_untouched_by_the_params_gate():
    assert ev.params_refusal("rsi", "above", {"period": 99999}) is None
    assert ev.params_refusal("price_vs_ma", "above", {"period": 50, "type": "ema"}) is None


# ─── review round 1 (PR #762) ───────────────────────────────────────────────

import math


def _long_bars(n=5200):
    """A long tape with a big early regime the evaluator's window never sees,
    then oscillation slow enough that 50/200 and 100/500 cross several times."""
    closes = []
    for i in range(n):
        base = 400.0 if i < 1500 else 100.0          # the early regime
        closes.append(base + 25.0 * math.sin(i / 160.0) + 12.0 * math.sin(i / 37.0) + 0.002 * i)
    return _bars(closes)


@pytest.mark.parametrize("fast, slow", [(50, 200), (100, 500)])
def test_long_ema_crosses_land_on_the_FULL_HISTORY_bar(fast, slow):
    """The cross bar matches an EMA seeded at the start of the whole tape (what the
    chart draws), not one seeded at the start of a short window."""
    bars = _long_bars()
    closes = [b["c"] for b in bars]
    params = {"ma_type": "ema", "fast": fast, "slow": slow}
    alert = _alert("cross_above", params)
    want = ev.bars_needed_for_alert(alert)
    assert want == ev.bars_wanted(6 * slow)
    up, down = _oracle_crosses(closes, "ema", fast, slow)
    tail = [c for c in up + down if c >= want + 10]
    assert len(tail) >= 2, "the fixture must cross inside the judged region"
    for c in up + down:
        if c < want + 10:
            continue
        cond = "cross_above" if c in up else "cross_below"
        a = _alert(cond, params)
        for j, expect in ((c, True), (c - 1, (c - 1) in (up if c in up else down))):
            window = bars[max(0, j + 1 - want):j + 1]      # exactly what the store hands it
            now = ev.bar_close_epoch(window[-1]["t"], "5")
            assert ev._evaluate_for_cycle(a, window, now_epoch=now)[1] is expect, (fast, slow, c, j)


def test_the_OLD_short_window_would_have_moved_a_cross_non_vacuity():
    """Control: an EMA seeded 400+fast+slow bars back misses at least one 100/500
    cross bar on this tape — the defect the convergence prefix closes."""
    bars = _long_bars()
    closes = [b["c"] for b in bars]
    up, _ = _oracle_crosses(closes, "ema", 100, 500)
    old_w = 400 + 100 + 500
    moved = 0
    for c in up:
        if c < 3400 + 10:
            continue
        w = closes[c + 1 - old_w:c + 1]
        f, s = ic.compute_ema(w, 100), ic.compute_ema(w, 500)
        if not (f[-2] - s[-2] <= 0 < f[-1] - s[-1]):
            moved += 1
    assert moved >= 1


def test_a_neighbours_wider_window_does_not_change_this_alerts_answer():
    """One fetch per (sym, tf) is sized by the WIDEST alert; ours must not care."""
    bars = _long_bars()
    params = {"ma_type": "ema", "fast": 9, "slow": 20}
    own = ev.bars_needed_for_alert(_alert("cross_above", params))
    neighbour = ev.bars_needed_for_alert(_alert("cross_above", {"ma_type": "ema", "fast": 100, "slow": 500}))
    assert neighbour > own
    a = alert_series.series_for("ma_cross", bars[-own:], params)
    b = alert_series.series_for("ma_cross", bars[-neighbour:], params)
    assert b[-own:] == a and any(v is not None for v in a)


def test_string_periods_are_stored_as_ints_and_size_the_same_window(client):
    r = _post(client, params={"ma_type": "EMA", "fast": "50", "slow": "200.0",
                              "direction": "Above", "confirm": "CLOSE"})
    assert r.status_code == 200, r.text
    row = ias.get(int(r.json()["id"]))
    stored = row["params_json"] if isinstance(row["params_json"], dict) else json.loads(row["params_json"])
    assert stored == {"ma_type": "ema", "fast": 50, "slow": 200, "direction": "above", "confirm": "close"}
    as_str = ev.bars_needed_for_alert(_alert(params={"ma_type": "ema", "fast": "50", "slow": "200"}))
    as_int = ev.bars_needed_for_alert(_alert(params={"ma_type": "ema", "fast": 50, "slow": 200}))
    assert as_str == as_int == ev.bars_wanted(1200)


def test_touch_at_zero_follows_the_frozen_oracle():
    """Spread 1, 0, 1 (the lines touch and part) fires cross_above on the bar AFTER
    the touch — `check_condition`'s `prev <= thr < cur`, unchanged; −1 → 0 does not."""
    thr = ev.THRESHOLD_OPERAND[("ma_cross", "cross_above")]["value"]
    assert thr == 0.0
    from api.services.alert_conditions import check_condition
    spread = [1.0, 0.0, 1.0]
    fires = [i for i in range(1, 3) if check_condition("cross_above", spread[i], spread[i - 1], thr)]
    assert fires == [2]
    assert check_condition("cross_above", 0.0, -1.0, thr) is False
    assert check_condition("cross_below", -1.0, 0.0, thr) is True
