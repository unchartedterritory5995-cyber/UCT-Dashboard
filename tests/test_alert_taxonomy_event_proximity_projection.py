"""GATE-S7-EVENT-PROXIMITY CP3 — the read-only projection, admin cohort, the
calendar re-read per tick, and the reschedule reset.

⛔ Approval line 2 (owner, 2026-09-12). No delivery, no legacy change.
"""
from __future__ import annotations

import ast
import pathlib
import uuid
from datetime import date, timedelta

import pytest

from api.services import auth_db as _auth_db
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import event_proximity as ep
from api.services.alert_taxonomy import event_proximity_compare as cmp_
from api.services.alert_taxonomy import event_proximity_projection as proj
from api.services.alert_taxonomy import receipts as _receipts

_REPO = pathlib.Path(__file__).resolve().parents[1]
_AT = _REPO / "api" / "services" / "alert_taxonomy"

TODAY = date(2026, 9, 14)
TOMORROW = TODAY + timedelta(days=1)


@pytest.fixture(autouse=True)
def auth(tmp_path, monkeypatch):
    """A FRESH auth.db per test — the projection returns EVERY admin row, so a
    row left by an earlier test is one this test silently compares against."""
    p = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(p))
    monkeypatch.setattr(_auth_db, "_DB_PATH", str(p))
    _auth_db.init_db()
    return p


@pytest.fixture()
def dbp(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    ep.register(db_path=p)
    return p


def _user(role: str) -> str:
    uid = "u-" + uuid.uuid4().hex[:12]
    conn = _auth_db.get_connection()
    try:
        conn.execute("INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
                     (uid, f"{uid}@example.test", "x", role))
        conn.commit()
    finally:
        conn.close()
    return uid


@pytest.fixture()
def world(monkeypatch):
    """Stub the two sources the projection reads: My Stocks, and THE CALENDAR.

    ⭐ The calendar stub is a dict the test mutates — that is how a RESCHEDULE is
    expressed, and it is the whole subject of this checkpoint.
    """
    import api.services.calendar_alerts as cal
    import api.services.calendar_personalization as cp

    state = {"mine": {}, "reporters": {}}
    monkeypatch.setattr(cp, "get_user_ticker_sets",
                        lambda uid: {"all_mine": state["mine"].get(uid, set())})
    monkeypatch.setattr(cal, "_get_reporters_for_date",
                        lambda md: state["reporters"].get(md, set()))
    return state


# --- the role gate ----------------------------------------------------------

def test_only_admin_accounts_are_projected(world):
    """⛔ THE COHORT GATE. CP3 is approved for admin accounts only."""
    admin, member = _user("admin"), _user("member")
    world["mine"] = {admin: {"NVDA"}, member: {"AAPL"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA", "AAPL"}}

    got = proj.project_admin_event_predicates(TODAY)
    refs = {(p["user_id"], p["entity_ref"]) for p in got}
    # NON-VACUITY: an empty projection satisfies "the member is absent" for the
    # wrong reason.
    assert (admin, "NVDA") in refs, "the admin row must project, or this proves nothing"
    assert (member, "AAPL") not in refs, "a member-role account must NEVER be projected"


def test_CONTROL_the_member_would_project_if_the_role_were_the_only_difference(world):
    """CONTROL: the member's ticker IS in the calendar and IS in their My Stocks —
    the only thing keeping it out is the role."""
    member = _user("member")
    world["mine"] = {member: {"AAPL"}}
    world["reporters"] = {TODAY.isoformat(): {"AAPL"}}
    assert proj.project_admin_event_predicates(TODAY) == []

    conn = _auth_db.get_connection()
    try:
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (member,))
        conn.commit()
    finally:
        conn.close()
    assert len(proj.project_admin_event_predicates(TODAY)) == 1, (
        "promoting the SAME row must project it — so the role really is the gate")


def test_MUTATION_the_role_gate_is_load_bearing(world):
    """⛔ MUTATION PROOF, against the module's OWN SQL.

    "The member is absent" passes against a projection returning nothing, one
    whose calendar stub is empty, and one with no gate at all. So the role
    predicate is dropped FROM THE REAL QUERY STRING and the member row must LEAK.
    ⛔ Restored by rebinding, never by `git checkout`.
    """
    admin, member = _user("admin"), _user("member")
    world["mine"] = {admin: {"NVDA"}, member: {"AAPL"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA", "AAPL"}}

    src = (_AT / "event_proximity_projection.py").read_text(encoding="utf-8")
    gate = '"SELECT id FROM users WHERE role = ?", (ADMIN_ROLE,)'
    assert src.count(gate) == 1, (
        "the role gate is not where this mutation expects it — fix the probe, "
        "not the product")

    ns: dict = {}
    exec(compile(src.replace(gate, '"SELECT id FROM users WHERE ? IS NOT NULL", (ADMIN_ROLE,)'),
                 "<mutated event_proximity_projection>", "exec"), ns)
    leaked = {(p["user_id"], p["entity_ref"])
              for p in ns["project_admin_event_predicates"](TODAY)}

    assert (admin, "NVDA") in leaked, "the mutant must still see the admin (control)"
    assert (member, "AAPL") in leaked, (
        "DROPPING THE ROLE PREDICATE DID NOT LEAK THE MEMBER — the gate test "
        "above passes for some other reason and proves nothing about the cohort")

    refs = {(p["user_id"], p["entity_ref"])
            for p in proj.project_admin_event_predicates(TODAY)}
    assert (member, "AAPL") not in refs


# --- the calendar is re-read every tick -------------------------------------

def test_the_projection_RE_READS_the_calendar_each_tick(world):
    """⛔⛔ THE RULING'S CENTRE. The stored date is an audit snapshot; the truth
    is whatever the calendar says NOW."""
    admin = _user("admin")
    world["mine"] = {admin: {"NVDA"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA"}}
    first = proj.project_admin_event_predicates(TODAY)
    assert [p["event_date"] for p in first] == [TODAY.isoformat()]

    # The company reschedules to tomorrow. NOTHING in our store is updated.
    world["reporters"] = {TOMORROW.isoformat(): {"NVDA"}}
    second = proj.project_admin_event_predicates(TODAY)
    assert [p["event_date"] for p in second] == [TOMORROW.isoformat()], (
        "the projection cached the old date — it must re-read the calendar")
    assert [p["lead_days"] for p in second] == [1]


def test_a_ticker_that_leaves_the_calendar_leaves_the_projection(world):
    admin = _user("admin")
    world["mine"] = {admin: {"NVDA"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA"}}
    assert len(proj.project_admin_event_predicates(TODAY)) == 1
    world["reporters"] = {}
    assert proj.project_admin_event_predicates(TODAY) == []


def test_one_members_broken_ticker_set_does_not_empty_the_cohort(world, monkeypatch):
    """⛔ An exception for one account must not read downstream as "nobody is
    watching anything", which is indistinguishable from a quiet day."""
    a, b = _user("admin"), _user("admin")
    import api.services.calendar_personalization as cp

    def flaky(uid):
        if uid == a:
            raise RuntimeError("ticker sets exploded")
        return {"all_mine": {"NVDA"}}
    monkeypatch.setattr(cp, "get_user_ticker_sets", flaky)
    world["reporters"] = {TODAY.isoformat(): {"NVDA"}}

    got = proj.project_admin_event_predicates(TODAY)
    assert [p["user_id"] for p in got] == [b], "the healthy account must still project"


# --- the reschedule reset ---------------------------------------------------

def test_a_RESCHEDULE_resets_the_clock_and_discards_to_NOT_COMPARABLE(world, dbp):
    """⛔⛔ THE RULING, END TO END.

    The calendar moves the call; the snapshot disagrees; the pre-reschedule span
    is discarded into `not_comparable` with a version bump, and the two worlds
    converge — leaving the dark week to measure only genuine rule disagreement.
    """
    admin = _user("admin")
    world["mine"] = {admin: {"NVDA"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA"}}

    r1 = proj.run_projected_comparison(TODAY, db_path=dbp)
    pid = proj.projected_predicate_id(admin, "NVDA")
    assert r1["reschedules"] == 0
    assert cmp_.report(pid, db_path=dbp)["agreed"] == 1

    world["reporters"] = {TOMORROW.isoformat(): {"NVDA"}}
    r2 = proj.run_projected_comparison(TODAY, db_path=dbp)
    assert r2["reschedules"] == 1, "the calendar/snapshot disagreement must reset"

    rep = cmp_.report(pid, db_path=dbp)
    assert rep["not_comparable"] == 1, "the pre-reschedule agreement must be discarded"
    assert rep["spans"] == 2, "a fresh span must have opened at the new date"


def test_MUTATION_the_reschedule_reset_is_load_bearing(world, dbp, monkeypatch):
    """⛔ Disable the fingerprint comparison and the reschedule must go
    undetected — proving the reset is what catches it, not something else."""
    admin = _user("admin")
    world["mine"] = {admin: {"NVDA"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA"}}
    proj.run_projected_comparison(TODAY, db_path=dbp)

    monkeypatch.setattr(ep, "event_fingerprint", lambda params: "CONSTANT")
    world["reporters"] = {TOMORROW.isoformat(): {"NVDA"}}
    r = proj.run_projected_comparison(TODAY, db_path=dbp)
    assert r["reschedules"] == 0, (
        "with the fingerprint neutered the reschedule was still detected — "
        "something other than the reset is doing the work, and the test above "
        "proves nothing")


def test_the_predicate_id_is_keyed_on_user_and_ticker_NOT_the_date():
    """⛔ Keying the date in would make every reschedule look like a brand-new
    predicate and HIDE the reset this checkpoint exists to perform."""
    a = proj.projected_predicate_id("u1", "NVDA")
    assert a == proj.projected_predicate_id("u1", "NVDA")
    assert "2026" not in a


# --- still dark -------------------------------------------------------------

def test_a_projected_fire_is_recorded_and_undelivered(world, dbp):
    admin = _user("admin")
    world["mine"] = {admin: {"NVDA"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA"}}
    proj.run_projected_comparison(TODAY, db_path=dbp)
    fires = _receipts.fires_for_predicate(
        proj.projected_predicate_id(admin, "NVDA"), db_path=dbp)
    assert len(fires) == 1
    assert not fires[0].get("delivered_at")
    assert fires[0]["trigger_type"] == ep.TYPE_ID


def test_no_cp3_module_imports_delivery():
    for name in ("event_proximity.py", "event_proximity_compare.py",
                 "event_proximity_projection.py"):
        imported: set = set()
        for node in ast.walk(ast.parse((_AT / name).read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                imported |= {a.name for a in node.names}
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                imported.add(base)
                imported |= {f"{base}.{a.name}" for a in node.names}
        assert imported, f"{name}: the import scan saw nothing — broken, not green"
        for banned in ("delivery", "email_service", "deliver_alert_payload"):
            assert not any(banned in n for n in imported), f"{name} imports {banned}"


def test_the_projection_reads_the_LEGACY_calendar_function_not_a_reimplementation():
    """⛔ A second calendar reader would answer differently the day one of them
    changed provider fallbacks, and the comparison would measure the two READERS
    instead of the two rules."""
    tree = ast.parse((_AT / "event_proximity_projection.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = ast.unparse(tree)
    assert "_get_reporters_for_date" in code, (
        "the projection no longer reads the legacy calendar function")
    for reimpl in ("finnhub", "calendar_weekly", "requests.get"):
        assert reimpl not in code, f"the projection reimplements the calendar via {reimpl}"


def test_the_legacy_module_is_byte_identical():
    import subprocess
    r = subprocess.run(["git", "-C", str(_REPO), "diff", "--stat", "origin/master",
                        "--", "api/services/calendar_alerts.py"],
                       capture_output=True, text=True)
    assert r.stdout.strip() == "", f"calendar_alerts.py differs:\n{r.stdout}"


# --- the wire ---------------------------------------------------------------

def test_the_dark_sweep_is_actually_wired_to_a_tick():
    """⛔⛔ §2a ITEM 3. price-level shipped registered, built, eighteen tests
    green and on NOBODY'S TICK. This asserts the WIRE, not the parts."""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert main.count("_at_event_prox.register()") == 1
    assert main.count('id="alert_taxonomy_event_proximity_dark"') == 1, (
        "the event-proximity dark comparison has no scheduler entry — nothing "
        "would call it and the store would be empty next weekend")
    assert main.count("run_dark_sweep()") >= 2, (
        "the sweep job does not call run_dark_sweep (price-level's is the other)")
    assert ('os.environ.get("ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED", "0") == "1"'
            in main), "the sweep is not flag-gated, or its default is not OFF"


def test_the_sweep_job_body_never_reaches_a_delivery_path():
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    start = main.index("def _event_proximity_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_event_proximity_dark"', start)
    body = main[start:end]
    assert "run_dark_sweep" in body, "the slice is empty — this probe is broken"
    for banned in ("deliver", "send_email", "webhook", "add_alert("):
        assert banned not in body, f"the sweep job body mentions {banned!r}"


def test_the_heartbeat_beats_on_EVERY_tick_including_the_empty_ones(world, dbp):
    """⛔ A heartbeat that only beats on success is a success detector. Spans
    carry no per-tick timestamp, so nothing else separates a sweep that died on
    its first morning from one still running."""
    import sqlite3

    def beat():
        c = sqlite3.connect(dbp); c.row_factory = sqlite3.Row
        try:
            r = c.execute("SELECT * FROM event_proximity_sweep_heartbeat WHERE id=1").fetchone()
            return dict(r) if r else None
        finally:
            c.close()

    proj.run_projected_comparison(TODAY, db_path=dbp)      # nobody projected
    b = beat()
    assert b and b["ticks"] == 1 and b["projected"] == 0

    admin = _user("admin")
    world["mine"] = {admin: {"NVDA"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA"}}
    proj.run_projected_comparison(TODAY, db_path=dbp)
    b = beat()
    assert b["ticks"] == 2 and b["projected"] == 1


def test_a_heartbeat_failure_never_takes_the_comparison_down(world, dbp, monkeypatch):
    admin = _user("admin")
    world["mine"] = {admin: {"NVDA"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA"}}

    def boom(*a, **k):
        raise RuntimeError("store on fire")
    # ⛔ The HEARTBEAT's own seam, not the shared connector — patching the latter
    # breaks the comparison too, and the test would assert a property of a
    # system that had already failed.
    monkeypatch.setattr(proj, "_beat_conn", boom)
    out = proj.run_projected_comparison(TODAY, db_path=dbp)
    assert out["projected"] == 1


# --- CP4 prep, default OFF --------------------------------------------------

def test_CP4_unset_leaves_the_admin_gate_exactly_as_CP3_shipped_it(world, monkeypatch):
    monkeypatch.delenv(proj.CP4_ALL_MEMBERS_FLAG, raising=False)
    admin, member = _user("admin"), _user("member")
    world["mine"] = {admin: {"NVDA"}, member: {"AAPL"}}
    world["reporters"] = {TODAY.isoformat(): {"NVDA", "AAPL"}}
    for junk in ("", "0", "false", "no", "off", "maybe", "2", " "):
        monkeypatch.setenv(proj.CP4_ALL_MEMBERS_FLAG, junk)
        refs = {p["user_id"] for p in proj.project_admin_event_predicates(TODAY)}
        assert member not in refs, f"the flag value {junk!r} widened the cohort"

    monkeypatch.setenv(proj.CP4_ALL_MEMBERS_FLAG, "1")
    refs = {p["user_id"] for p in proj.project_admin_event_predicates(TODAY)}
    assert member in refs and admin in refs, "an explicit yes must widen it"
