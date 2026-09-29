"""TERM-048 (FB-A12-01) -- watchlist price alerts onto S7's receipt and lease.

A LIVE member feature is being migrated, so the flag defaults to the CURRENT
behaviour and this file proves four things, each with a control that could
fail:

  1. FLAG OFF IS TODAY. Same fire, same report, same bell entry, same email,
     and the S7 store is never touched (its file is never even created).
  2. FLAG ON FIRES ONCE, across every channel, even when a second checker saw
     the row armed. The control runs the same race with the flag off and
     watches it deliver twice -- so the rail can tell the two apart.
  3. EVERY FLAG-ON FIRE LANDS IN `alert_fires` via `record_fire` (never
     `user_alerts`) with its lease claimed and its channel outcome stamped.
  4. EXISTING `watchlist_alerts` ROWS (price / trendline / line), created
     before the flag, fire through S7 unchanged, and one-shot dedup holds.

⛔ TEMP DBs ONLY: `auth_db._DB_PATH`, `alert_durability._DB_PATH` and the
taxonomy `DB_PATH` are redirected to `tmp_path`.
"""
from __future__ import annotations

import ast
import os
import pathlib
import re
import sqlite3
import threading
import time
import uuid

import pytest

from api.services import alert_durability
from api.services import alerts as alerts_svc
from api.services import auth_db
from api.services import watchlist_alert_service as wls
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import receipts
from api.services.alert_taxonomy import watchlist_price_alerts as wpa

_REPO = pathlib.Path(__file__).resolve().parents[1]
FLAG = wpa.FLAG


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def env(tmp_path, monkeypatch):
    """Three temp stores, one member, every channel silent and succeeding.

    `add_alert` stays the REAL one (it owns the bell entry the browser
    notification and the sound are derived from); a spy only counts calls.
    """
    auth_path = str(tmp_path / "auth.db")
    at_path = str(tmp_path / "alert_taxonomy.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", auth_path)
    monkeypatch.setattr(alert_durability, "_DB_PATH", auth_path)
    monkeypatch.setattr(at_db, "DB_PATH", at_path)
    monkeypatch.delenv(FLAG, raising=False)
    monkeypatch.setenv("DISCORD_ALERT_WEBHOOK", "")
    auth_db.init_db()
    alert_durability.init_schema()

    user_id = f"u_{uuid.uuid4().hex[:10]}"
    conn = auth_db.get_connection()
    conn.execute("INSERT INTO users (id, email, password_hash) VALUES (?,?,?)",
                 (user_id, f"{user_id}@local.test", "x"))
    conn.commit()
    conn.close()

    calls = {"add_alert": [], "email": []}
    real_add_alert = wls.add_alert

    def spy_add_alert(*a, **k):
        calls["add_alert"].append((a, {kk: v for kk, v in k.items() if kk != "channels"}))
        return real_add_alert(*a, **k)

    def spy_email(to, subject, html):
        calls["email"].append((to, subject, html))
        return True

    monkeypatch.setattr(wls, "add_alert", spy_add_alert)
    monkeypatch.setattr(wls, "send_email", spy_email)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: "member@test")
    return {"user": user_id, "at_path": at_path, "calls": calls, "mp": monkeypatch}


def _flag_on(env):
    env["mp"].setenv(FLAG, "1")


def _row(alert_id):
    conn = auth_db.get_connection()
    try:
        return dict(conn.execute("SELECT * FROM watchlist_alerts WHERE id = ?",
                                 (alert_id,)).fetchone())
    finally:
        conn.close()


def _rearm(alert_id):
    """A SECOND checker's view: it selected the row while it was still armed,
    before the first checker's `_trigger_alert` landed. `_trigger_alert`'s
    UPDATE is not a compare-and-set, so both proceed to deliver."""
    conn = auth_db.get_connection()
    conn.execute("UPDATE watchlist_alerts SET is_active = 1 WHERE id = ?", (alert_id,))
    conn.commit()
    conn.close()


def _fires(env):
    return receipts.list_fires(env["user"], limit=50)


# ─── the flag ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    (None, False), ("0", False), ("", False), ("true", False), ("yes", False),
    ("on", False), (" 1", False), ("1", True),
])
def test_the_flag_defaults_OFF_and_only_1_arms_it(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, value)
    assert wpa.enabled() is expected


def test_the_flag_is_read_per_call_not_captured_at_import(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    assert wpa.enabled() is False
    monkeypatch.setenv(FLAG, "1")
    assert wpa.enabled() is True, "a module-level capture would make rollback a redeploy"


def test_an_unreadable_flag_falls_to_the_CURRENT_behaviour(env, monkeypatch):
    """The flag read itself must never be able to break today's lane."""
    monkeypatch.setenv(FLAG, "1")
    monkeypatch.setattr(wpa, "enabled",
                        lambda: (_ for _ in ()).throw(RuntimeError("simulated")))
    assert wls._s7_route_enabled() is False
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    assert len(wls.check_alerts_against_prices({"AKAM": 96.0})) == 1
    assert len(env["calls"]["email"]) == 1
    assert not os.path.exists(env["at_path"])


def test_the_bridge_constants_ARE_price_levels_own():
    """The bridge restates two price_level constants so it does not import
    price_level (flow-worker closure). This pins the restatement."""
    from api.services.alert_taxonomy import price_level
    assert wpa.TRIGGER_TYPE == price_level.TYPE_ID
    assert wpa.DEFAULT_LEVEL_KIND == price_level.FIXED
    tree = ast.parse(pathlib.Path(wpa.__file__).read_text(encoding="utf-8"))
    imported = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
    imported |= {a.name for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
                 for a in n.names}
    assert "receipts" in imported, "non-vacuity: the scan must see the real import"
    assert not any("price_level" in (m or "") for m in imported)


# ─── 1. FLAG OFF == today ────────────────────────────────────────────────────

# The observable shape of today's lane, pinned as literals read off the code
# at 322d92f86 -- not derived from the function under test.
_TODAY_REPORT = {
    "claimed": True,
    "channels": {"in_app": "ok", "discord": "skipped", "email": "ok"},
    "channels_ok": 2,
    "channels_failed": 0,
    "errors": {},
}


def test_FLAG_OFF_fires_exactly_as_today_and_never_touches_the_S7_store(env, monkeypatch):
    def must_not_run(*a, **k):
        raise AssertionError("flag OFF reached the S7 bridge")
    monkeypatch.setattr(wpa, "open_fire", must_not_run)
    monkeypatch.setattr(wpa, "close_fire", must_not_run)

    a = wls.create_alert(env["user"], "AKAM", 95.0, "above")
    reports: list = []
    fired = wls.check_alerts_against_prices({"AKAM": 96.0}, reports=reports)

    assert [f["id"] for f in fired] == [a["id"]]
    assert reports == [_TODAY_REPORT]
    assert _row(a["id"])["is_active"] == 0 and _row(a["id"])["triggered_at"]

    (args, kwargs), = env["calls"]["add_alert"]
    assert args == ("price_alert", "Alert: AKAM $96.00",
                    "AKAM crossed above $95.00 (now $96.00)")
    assert kwargs["user_id"] == env["user"] and kwargs["severity"] == "warning"
    assert kwargs["data"] == {"symbol": "AKAM", "target_price": 95.0,
                              "current_price": 96.0, "direction": "above",
                              "research_url": "/research/AKAM"}
    (to, subject, _html), = env["calls"]["email"]
    assert (to, subject) == ("member@test", "UCT Alert: AKAM hit $95.00")

    # ⭐ The strongest form of "nothing changed": the S7 store was never opened.
    assert not os.path.exists(env["at_path"]), (
        "flag OFF created alert_taxonomy.db -- the legacy lane touched the S7 store")


def test_FLAG_OFF_dedup_is_todays_one_shot(env):
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    assert len(wls.check_alerts_against_prices({"AKAM": 96.0})) == 1
    for _ in range(3):
        assert wls.check_alerts_against_prices({"AKAM": 97.0}) == []
    assert len(env["calls"]["add_alert"]) == 1 and len(env["calls"]["email"]) == 1


def test_flag_ON_tells_the_member_the_SAME_thing_as_flag_OFF(env):
    """Member content parity: the S7 route changes the receipt, never the words."""
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    off_reports: list = []
    wls.check_alerts_against_prices({"AKAM": 96.0}, reports=off_reports)

    _flag_on(env)
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    on_reports: list = []
    wls.check_alerts_against_prices({"AKAM": 96.0}, reports=on_reports)

    off_call, on_call = env["calls"]["add_alert"]
    assert off_call == on_call
    (_, s_off, h_off), (_, s_on, h_on) = env["calls"]["email"]
    assert (s_off, h_off) == (s_on, h_on)
    assert off_reports == on_reports == [_TODAY_REPORT]


# ─── 2 + 3. FLAG ON: once, with a receipt in alert_fires ─────────────────────

def test_FLAG_ON_one_crossing_writes_ONE_receipt_in_alert_fires(env):
    _flag_on(env)
    a = wls.create_alert(env["user"], "AKAM", 95.0, "above")
    reports: list = []
    fired = wls.check_alerts_against_prices({"AKAM": 96.0}, reports=reports)
    assert [f["id"] for f in fired] == [a["id"]]
    assert reports == [_TODAY_REPORT]

    (f,) = _fires(env)
    assert f["trigger_type"] == "price-level"
    assert f["predicate_id"] == f"watchlist:{a['id']}"
    assert f["fire_key"] == f"fire:{a['id']}"
    assert f["user_id"] == env["user"] and f["entity_ref"] == "AKAM"
    assert f["triggering_value"] == 96.0
    assert f["source_data_class"] == "quote" and f["freshness_class"] is None
    assert f["delivered_at"] is not None and f["delivery_attempts"] == 1
    assert f["delivery_channels"] == _TODAY_REPORT["channels"]
    assert f["channels_failed"] == 0
    assert f["detail"]["rule"] == wpa.LEGACY_RULE
    assert f["detail"]["legacy_alert_id"] == a["id"]
    assert f["detail"]["level"] == 95.0 and f["detail"]["level_kind"] == "price"

    # The lease is held: nothing can claim this fire a second time.
    assert receipts.claim_delivery(f["id"]) is False


def test_FLAG_ON_never_writes_user_alerts_as_the_receipt(env):
    """Standing ruling: the durable member ALERT RECORD is alert_fires. The
    bell's own durable copy (alert_durability, written by add_alert exactly as
    on the legacy lane) is untouched and is not this feature's receipt."""
    _flag_on(env)
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    wls.check_alerts_against_prices({"AKAM": 96.0})
    src = pathlib.Path(wpa.__file__).read_text(encoding="utf-8")
    code = _code_only(src)
    assert "user_alerts" not in code and "alert_durability" not in code
    assert "record_fire" in code
    assert len(_fires(env)) == 1


def test_FLAG_ON_a_second_checker_that_saw_the_row_armed_delivers_NOTHING(env):
    """⛔ THE NO-DUPLICATE RAIL. Two checkers both select the row while armed;
    both deactivate it (not a compare-and-set) and both reach delivery. The
    S7 receipt's UNIQUE(predicate_id, fire_key) lets exactly one through --
    across every channel: bell (and so browser + sound), email, Discord."""
    _flag_on(env)
    a = wls.create_alert(env["user"], "AKAM", 95.0, "above")
    assert len(wls.check_alerts_against_prices({"AKAM": 96.0})) == 1
    time.sleep(0.01)            # a later instant: the fire key must not carry time
    _rearm(a["id"])
    assert wls.check_alerts_against_prices({"AKAM": 96.5}) == []

    assert len(env["calls"]["add_alert"]) == 1, "the bell (browser + sound) fired twice"
    assert len(env["calls"]["email"]) == 1, "the email went out twice"
    assert len(_fires(env)) == 1
    bell = [x for x in alerts_svc.get_alerts(limit=50, user_id=env["user"])
            if x.get("type") == "price_alert"]
    assert len(bell) == 1, f"the member's bell carries {len(bell)} entries for one crossing"


def test_CONTROL_the_same_race_with_the_flag_OFF_delivers_twice(env):
    """Without this the rail above could be passing because the fixture never
    produced a second delivery attempt at all."""
    a = wls.create_alert(env["user"], "AKAM", 95.0, "above")
    assert len(wls.check_alerts_against_prices({"AKAM": 96.0})) == 1
    _rearm(a["id"])
    assert len(wls.check_alerts_against_prices({"AKAM": 96.5})) == 1
    assert len(env["calls"]["add_alert"]) == 2 and len(env["calls"]["email"]) == 2


def test_the_bridge_itself_refuses_the_second_open_for_the_same_row(env):
    _flag_on(env)
    a = wls.create_alert(env["user"], "AKAM", 95.0, "above")
    row = _row(a["id"])
    first = wpa.open_fire(row, 96.0, 95.0, 1_000.0)
    second = wpa.open_fire(row, 97.0, 95.0, 2_000.0)
    assert isinstance(first, int) and second is None


def test_the_bell_carries_ONE_entry_and_no_S7_reconstruction(env):
    """Browser notification and sound fire per NEW bell id. The S7 durable
    feed bridge has no price-level branch, so a receipt can never surface as a
    second bell row next to the ephemeral one."""
    _flag_on(env)
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    wls.check_alerts_against_prices({"AKAM": 96.0})
    feed = alerts_svc.get_alerts(limit=50, user_id=env["user"])
    assert [x["type"] for x in feed].count("price_alert") == 1
    assert not [x for x in feed if str(x.get("id", "")).startswith(alerts_svc._S7_FIRE_PREFIX)]


# ─── cooldown / dedup / failure ──────────────────────────────────────────────

def test_FLAG_ON_one_shot_holds_across_later_cycles(env):
    _flag_on(env)
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    assert len(wls.check_alerts_against_prices({"AKAM": 96.0})) == 1
    for p in (97.0, 94.0, 99.0, 96.0, 101.0):
        assert wls.check_alerts_against_prices({"AKAM": p}) == []
    assert len(env["calls"]["add_alert"]) == 1 and len(_fires(env)) == 1


def test_FLAG_ON_a_total_delivery_failure_is_recorded_and_NOT_retried(env, monkeypatch):
    _flag_on(env)
    monkeypatch.setattr(wls, "add_alert",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("cache down")))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: False)
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    first: list = []
    assert len(wls.check_alerts_against_prices({"AKAM": 96.0}, reports=first)) == 1
    assert first[0]["channels_ok"] == 0

    (f,) = _fires(env)
    assert f["channels_failed"] == 2
    assert f["delivery_channels"]["in_app"] == "failed"
    assert f["delivery_attempts"] == 1, "the lease was released for a retry"
    assert wls.check_alerts_against_prices({"AKAM": 96.0}) == []


def test_FLAG_ON_a_receipt_store_failure_still_tells_the_member_ONCE(env, monkeypatch):
    """Only a positive 'already owned' answer suppresses delivery. A store that
    cannot be written must not turn into a silently missed alert."""
    _flag_on(env)

    def broken(*a, **k):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(wpa._receipts, "record_fire", broken)
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    reports: list = []
    assert len(wls.check_alerts_against_prices({"AKAM": 96.0}, reports=reports)) == 1
    assert reports == [_TODAY_REPORT]
    assert len(env["calls"]["add_alert"]) == 1 and len(env["calls"]["email"]) == 1
    assert wls.check_alerts_against_prices({"AKAM": 96.0}) == []
    assert len(env["calls"]["add_alert"]) == 1


# ─── 4. existing rows are honoured ───────────────────────────────────────────

def test_rows_created_BEFORE_the_flag_fire_through_S7_with_their_own_geometry(env):
    now = time.time()
    fixed = wls.create_alert(env["user"], "AKAM", 95.0, "above")
    trend = wls.create_alert(env["user"], "NVDA", 100.0, "above", alert_type="trendline",
                             anchors=(now - 1_000, 50.0, now + 1_000, 150.0))
    line = wls.create_alert(env["user"], "AMD", 80.0, "below", alert_type="line",
                            drawing_id="drw_1")
    idle = wls.create_alert(env["user"], "TSLA", 500.0, "above")

    _flag_on(env)
    fired = wls.check_alerts_against_prices({"AKAM": 96.0, "NVDA": 120.0, "AMD": 70.0})
    assert {f["id"] for f in fired} == {fixed["id"], trend["id"], line["id"]}

    by_pred = {f["predicate_id"]: f for f in _fires(env)}
    assert set(by_pred) == {f"watchlist:{x['id']}" for x in (fixed, trend, line)}
    t = by_pred[f"watchlist:{trend['id']}"]["detail"]
    assert t["level_kind"] == "trendline" and 99.0 < t["level"] < 101.0, (
        "the trendline's level must be interpolated at fire time, not target_price")
    ln = by_pred[f"watchlist:{line['id']}"]["detail"]
    assert ln["level_kind"] == "line" and ln["level"] == 80.0 and ln["drawing_id"] == "drw_1"

    assert _row(idle["id"])["is_active"] == 1, "an unpriced row must stay armed"
    assert f"watchlist:{idle['id']}" not in by_pred


# ─── reachability + re-arm rail ──────────────────────────────────────────────

def test_the_flag_on_route_is_reachable_from_the_live_price_poll(env):
    """`run_alert_check` is what `/api/live-prices` calls. A flag-on path that
    only unit tests reach is built, green and unreachable."""
    _flag_on(env)
    wls.create_alert(env["user"], "AKAM", 95.0, "above")
    wls.run_alert_check({"AKAM": {"price": 96.0}})
    for t in [t for t in threading.enumerate() if t.name == "alert-check"]:
        t.join(timeout=10)
    assert len(_fires(env)) == 1


def _code_only(src: str) -> str:
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) \
                and isinstance(node.value.value, str):
            node.value.value = ""
    return ast.unparse(tree)


_SET_RE = re.compile(r"UPDATE\s+watchlist_alerts\s+SET\s+(.*?)(?:\s+WHERE\s|$)",
                     re.IGNORECASE | re.DOTALL)


def _rearming_statements(src: str) -> tuple[list[str], list[str]]:
    """(every UPDATE-watchlist_alerts statement, the ones whose SET re-arms)."""
    seen, rearm = [], []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) \
                and "watchlist_alerts" in node.value:
            m = _SET_RE.search(node.value)
            if m:
                seen.append(node.value)
                if re.search(r"is_active\s*=\s*(1|TRUE)\b", m.group(1), re.IGNORECASE):
                    rearm.append(node.value)
    return seen, rearm


def test_nothing_re_arms_a_watchlist_alert_row():
    """⛔ The flag-on fire key carries no arm generation, because a row is
    one-shot. A re-arm path would make its second crossing collide with the
    first receipt and be SWALLOWED. If this goes red, put the arm generation
    into `watchlist_price_alerts.fire_key_for` before shipping the re-arm."""
    seen_all, rearm_all = [], []
    for root in ("api", "scripts", "tools"):
        for p in sorted((_REPO / root).rglob("*.py")):
            try:
                s, r = _rearming_statements(p.read_text(encoding="utf-8", errors="replace"))
            except SyntaxError:
                continue
            seen_all += s
            rearm_all += [f"{p.relative_to(_REPO)}: {x!r}" for x in r]
    # NON-VACUITY: the scan must see the deactivation and the resync statements.
    assert any("is_active = 0" in s for s in seen_all), seen_all
    assert any("drawing_id = ?" in s for s in seen_all), seen_all
    assert rearm_all == [], rearm_all


def test_CONTROL_the_re_arm_scan_can_fire():
    _, rearm = _rearming_statements(
        'x = "UPDATE watchlist_alerts SET is_active = 1, triggered_at = NULL WHERE id = ?"')
    assert len(rearm) == 1
    _, quiet = _rearming_statements(
        'x = "UPDATE watchlist_alerts SET target_price = ? WHERE id = ? AND is_active = 1"')
    assert quiet == [], "a WHERE-clause is_active = 1 is a filter, not a re-arm"
