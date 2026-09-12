"""GATE-S7-PRICE-LEVEL Checkpoint 3 — the read-only PROJECTION of real member
`watchlist_alerts` rows, ADMIN-ROLE COHORT ONLY, still fully dark.

⛔ Nothing here delivers, and the rails assert that as a property of the FILES
rather than as a promise in a docstring. This is the checkpoint where the dark
evaluator first reads real member data, so the guards are the point.
"""
from __future__ import annotations

import ast
import pathlib
import time as _time
import uuid

import pytest

from api.services import auth_db as _auth_db
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import price_level as _pl
from api.services.alert_taxonomy import price_level_compare as _cmp
from api.services.alert_taxonomy import price_level_projection as _proj
from api.services.alert_taxonomy import receipts as _receipts

_REPO = pathlib.Path(__file__).resolve().parents[1]
_AT = _REPO / "api" / "services" / "alert_taxonomy"
DAY = 86_400.0
T0 = 1_757_000_000.0


@pytest.fixture(autouse=True)
def auth(tmp_path, monkeypatch):
    """A FRESH auth.db per test.

    ⛔ Per-test, not per-session: `project_admin_alerts()` returns EVERY active
    admin row, so a row left behind by an earlier test is a row this one silently
    compares against. ⛔ And never the real store — `/data` is a real directory on
    this box. The pinning idiom (`AUTH_DB_PATH` *and* the module global, together)
    is the repo's, because `_DB_PATH` is captured at import.
    """
    p = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(p))
    monkeypatch.setattr(_auth_db, "_DB_PATH", str(p))
    _auth_db.init_db()
    return p


@pytest.fixture()
def dbp(tmp_path):
    """The alert-taxonomy store — a DIFFERENT database from auth.db, and that
    separation is the ruling: the new store holds only harness-armed predicates
    and the comparison bookkeeping, keyed by the legacy row id."""
    p = str(tmp_path / "alert_taxonomy.db")
    _db.init_db(db_path=p)
    _pl.register(db_path=p)
    return p


def _user(role: str) -> str:
    uid = "u-" + uuid.uuid4().hex[:12]
    conn = _auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
            (uid, f"{uid}@example.test", "x", role))
        conn.commit()
    finally:
        conn.close()
    return uid


def _alert(user_id: str, *, sym="AAPL", target=100.0, direction="above",
           alert_type="price", anchors=None, drawing_id=None) -> str:
    aid = "a-" + uuid.uuid4().hex[:12]
    a = anchors or {}
    conn = _auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO watchlist_alerts (id, user_id, sym, target_price, direction, "
            "is_active, alert_type, anchor_t1, anchor_p1, anchor_t2, anchor_p2, drawing_id) "
            "VALUES (?,?,?,?,?,1,?,?,?,?,?,?)",
            (aid, user_id, sym, target, direction, alert_type,
             a.get("anchor_t1"), a.get("anchor_p1"), a.get("anchor_t2"), a.get("anchor_p2"),
             drawing_id))
        conn.commit()
    finally:
        conn.close()
    return aid


def _ids():
    return {p["legacy_id"] for p in _proj.project_admin_alerts()}


# --- THE ROLE GATE ----------------------------------------------------------

def test_only_admin_role_rows_are_projected():
    """⛔ THE COHORT GATE. CP3 is approved for admin accounts only."""
    admin, member = _user("admin"), _user("member")
    a_id = _alert(admin, sym="ADMN")
    m_id = _alert(member, sym="MEMB")

    ids = _ids()
    # NON-VACUITY: if the projection returned nothing at all, "the member row is
    # absent" would pass for the wrong reason -- an empty set satisfies almost
    # every check anyone writes.
    assert a_id in ids, "the admin row must be projected, or this test proves nothing"
    assert m_id not in ids, "a member-role row must NEVER be projected"


def test_CONTROL_the_member_row_differs_from_the_admin_row_ONLY_by_role():
    """CONTROL for the gate above. If the member row were malformed — inactive,
    missing, a broken join — the gate test would pass for a reason that has
    nothing to do with the role check."""
    admin, member = _user("admin"), _user("member")
    a_id = _alert(admin, sym="SAME")
    m_id = _alert(member, sym="SAME")
    conn = _auth_db.get_connection()
    try:
        rows = {r["id"]: dict(r) for r in conn.execute(
            "SELECT wa.*, u.role FROM watchlist_alerts wa JOIN users u ON u.id = wa.user_id "
            "WHERE wa.id IN (?,?)", (a_id, m_id)).fetchall()}
    finally:
        conn.close()
    assert set(rows) == {a_id, m_id}, "both rows must exist and join to a user"
    differing = {k for k in rows[a_id]
                 if k not in ("id", "user_id", "created_at")
                 and rows[a_id][k] != rows[m_id][k]}
    assert differing == {"role"}, (
        f"the two rows must differ ONLY by role, but they differ in {sorted(differing)}")


def test_MUTATION_the_role_gate_is_load_bearing():
    """⛔ MUTATION PROOF, and the reason it is written this way.

    A test asserting "the member row is absent" passes against a projection that
    returns nothing, against one whose JOIN is broken, and against one with no
    gate at all if the fixture happens to be empty. So this drops the role
    predicate FROM THE REAL SQL — by rewriting the module's own query string,
    never by re-typing a query here — and asserts the member row LEAKS.

    ⭐ If the mutant still excludes the member, the gate is not what is doing the
    excluding, and the green above means nothing.
    ⛔ Restored by rebinding, never by `git checkout` — a mutation proof that
    restores from git can silently discard uncommitted work.
    """
    admin, member = _user("admin"), _user("member")
    a_id = _alert(admin, sym="ADMN")
    m_id = _alert(member, sym="MEMB")

    src = (_AT / "price_level_projection.py").read_text(encoding="utf-8")
    gate = '"WHERE wa.is_active = 1 AND u.role = ?",'
    assert src.count(gate) == 1, (
        "the role gate is not where this mutation expects it — fix the probe, "
        "not the product")

    ns: dict = {}
    exec(compile(src.replace(gate, '"WHERE wa.is_active = 1 AND ? IS NOT NULL",'),
                 "<mutated price_level_projection>", "exec"), ns)
    leaked = {p["legacy_id"] for p in ns["project_admin_alerts"]()}

    assert a_id in leaked, "the mutant must still see the admin row (control)"
    assert m_id in leaked, (
        "DROPPING `u.role = ?` DID NOT LEAK THE MEMBER ROW — the gate test above "
        "is passing for some other reason and proves nothing about the cohort")
    # ...and the real module, unmutated, still holds the line.
    assert m_id not in _ids()


def test_a_role_change_moves_the_row_next_tick_with_no_sync_job():
    """⭐ PROJECTION, NOT MIRROR. Promote the account and its alerts appear on the
    very next read. No sync job ran, because there is nothing to sync."""
    uid = _user("member")
    aid = _alert(uid, sym="ROLE")
    assert aid not in _ids()

    conn = _auth_db.get_connection()
    try:
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (uid,))
        conn.commit()
    finally:
        conn.close()
    assert aid in _ids(), "a promoted account's alerts must be visible immediately"


# --- THE PROJECTION IS LIVE, AND READ-ONLY ----------------------------------

def test_the_projection_reflects_a_live_edit_next_tick():
    """⛔ The ruling's centre: no second table, no sync job. Editing the legacy
    row changes what the next tick sees, with nothing in between."""
    uid = _user("admin")
    aid = _alert(uid, sym="LIVE", target=100.0)
    first = [p for p in _proj.project_admin_alerts() if p["legacy_id"] == aid][0]
    assert first["target_price"] == 100.0
    assert first["direction"] == "above"

    conn = _auth_db.get_connection()
    try:
        conn.execute("UPDATE watchlist_alerts SET target_price=250.0, direction='below' "
                     "WHERE id=?", (aid,))
        conn.commit()
    finally:
        conn.close()

    second = [p for p in _proj.project_admin_alerts() if p["legacy_id"] == aid][0]
    assert second["target_price"] == 250.0, "the projection must re-read, not cache"
    assert second["direction"] == "below"


def test_a_disarmed_row_leaves_the_projection():
    """`_trigger_alert` sets `is_active = 0`. The projection filters on it, so a
    span goes quiet on its own rather than accumulating one-sided noise forever."""
    uid = _user("admin")
    aid = _alert(uid, sym="DISARM")
    assert aid in _ids()
    conn = _auth_db.get_connection()
    try:
        conn.execute("UPDATE watchlist_alerts SET is_active=0 WHERE id=?", (aid,))
        conn.commit()
    finally:
        conn.close()
    assert aid not in _ids()


def test_the_projection_only_ever_reads():
    """⛔ READ-ONLY as a property of the SOURCE. A projection that could write to
    `watchlist_alerts` is a mirror with extra steps.

    ⛔ CODE, NEVER PROSE — this file discusses writes at length, so docstrings are
    stripped before matching, and a control asserts the scan can still see a real
    statement.
    """
    tree = ast.parse((_AT / "price_level_projection.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = ast.unparse(tree).upper()
    assert "SELECT WA.*" in code, "the scan saw no SELECT — broken, not green"
    for verb in ("INSERT INTO WATCHLIST_ALERTS", "UPDATE WATCHLIST_ALERTS",
                 "DELETE FROM WATCHLIST_ALERTS"):
        assert verb not in code, f"the projection writes to the legacy table: {verb}"


# --- THE MIRROR, RAILED AGAINST THE REAL LEGACY FUNCTION --------------------

def test_legacy_would_fire_matches_the_real_legacy_function(monkeypatch):
    """⭐ RAIL THE MIRROR, NOT JUST THE LANE.

    `legacy_would_fire` RESTATES `check_alerts_against_prices`'s condition,
    because calling the real one would MUTATE (`_trigger_alert` disarms the row)
    and DELIVER (a member would be told about a dark comparison). A restatement is
    only honest with the real thing beside it — so here the real function runs,
    against the sandboxed auth.db with delivery patched out, and the two must
    agree row for row INCLUDING at the boundary, which is where they could
    plausibly differ.
    """
    import api.services.watchlist_alert_service as wal

    delivered: list = []
    monkeypatch.setattr(wal, "_deliver_alert", lambda a, p: delivered.append(a) or {})

    uid = _user("admin")
    cases = [
        (100.0, "above", 101.0, True),
        (100.0, "above", 99.0, False),
        (100.0, "above", 100.0, True),    # legacy is >=, the boundary FIRES
        (100.0, "below", 99.0, True),
        (100.0, "below", 101.0, False),
        (100.0, "below", 100.0, True),    # legacy is <=, the boundary FIRES
    ]
    for i, (target, direction, price, expected) in enumerate(cases):
        sym = "S%d" % i
        aid = _alert(uid, sym=sym, target=target, direction=direction)
        projected = [p for p in _proj.project_admin_alerts() if p["legacy_id"] == aid][0]

        mine = _proj.legacy_would_fire(projected, price, T0)
        real = [a for a in wal.check_alerts_against_prices({sym: price}) if a["id"] == aid]

        assert mine is expected, f"the mirror disagreed with the expectation at {sym}"
        assert bool(real) is mine, (
            f"MIRROR DIVERGED FROM THE REAL LEGACY FUNCTION at {sym}: "
            f"mirror={mine} real={bool(real)}")
    assert len(delivered) == 4, (
        "the real path must have fired four times — if it fired none, this rail "
        "compared the mirror against a function that never ran")


def test_legacy_would_fire_matches_the_real_function_on_a_MOVING_trendline(monkeypatch):
    """The same rail where it is hardest. A trendline's level is a function of
    `now`, so the two sides must agree about the LEVEL as well as the comparison:
    `_alert_level_now` and `level_at` are separate implementations of one line."""
    import api.services.watchlist_alert_service as wal
    monkeypatch.setattr(wal, "_deliver_alert", lambda a, p: {})

    uid = _user("admin")
    # A line rising 100 -> 200 across the day that CONTAINS "now", so its level is
    # genuinely interpolated (~150) rather than clamped at an endpoint.
    now = _time.time()
    anchors = {"anchor_t1": now - DAY / 2, "anchor_p1": 100.0,
               "anchor_t2": now + DAY / 2, "anchor_p2": 200.0}
    fired = 0
    for i, price in enumerate((120.0, 180.0)):
        sym = "TL%d" % i
        aid = _alert(uid, sym=sym, target=100.0, direction="above",
                     alert_type="trendline", anchors=anchors, drawing_id=f"d{i}")
        projected = [p for p in _proj.project_admin_alerts() if p["legacy_id"] == aid][0]
        mine = _proj.legacy_would_fire(projected, price, _time.time())
        real = [a for a in wal.check_alerts_against_prices({sym: price}) if a["id"] == aid]
        assert bool(real) is mine, (
            f"trendline mirror diverged at {sym}: mirror={mine} real={bool(real)}")
        fired += int(bool(real))
    assert fired == 1, (
        "the two prices must straddle the interpolated line — one fires, one does "
        f"not; got {fired} fires, so this comparison was vacuous")


# --- THE ANCHOR MOVE, DETECTED BY OBSERVATION -------------------------------

def test_an_anchor_rewrite_via_resync_bound_alerts_triggers_the_reset(dbp):
    """⛔ THE RULING'S CENTRE, against the REAL legacy rewrite path.

    `resync_bound_alerts` is CALLED, not simulated, and the projection detects the
    move BY OBSERVATION: the geometry it reads now no longer matches what the span
    recorded. ⭐ So the legacy path needs no hook — which matters because we are
    not allowed to touch it — and a hand-edited row is caught too, which an
    instrumented function never would be.
    """
    import api.services.watchlist_alert_service as wal

    uid = _user("admin")
    anchors = {"anchor_t1": T0, "anchor_p1": 100.0, "anchor_t2": T0 + DAY, "anchor_p2": 100.0}
    aid = _alert(uid, sym="MOVED", target=100.0, alert_type="trendline",
                 anchors=anchors, drawing_id="draw-1")
    pid = _proj.projected_predicate_id(aid)

    _proj.run_projected_comparison({"MOVED": 99.0}, now=T0, db_path=dbp)
    got = _proj.run_projected_comparison({"MOVED": 101.0}, now=T0 + 1, db_path=dbp)
    assert got["outcomes"] == {pid: _cmp.AGREED}, got
    assert _cmp.report(pid, db_path=dbp)["agreed"] == 1

    # THE REAL legacy rewrite path -- the line moves down, under the price.
    n = wal.resync_bound_alerts(uid, "draw-1", target_price=50.0, alert_type="trendline",
                                anchors=(T0, 50.0, T0 + DAY, 50.0))
    assert n == 1, "the legacy resync must have re-pointed exactly one row"

    after = _proj.run_projected_comparison({"MOVED": 99.0}, now=T0 + 2, db_path=dbp)
    assert after["anchor_moves"] == 1, "the projection must have OBSERVED the rewrite"

    rep = _cmp.report(pid, db_path=dbp)
    assert rep["agreed"] == 0, "the pre-move agreement must NOT survive the rewrite"
    assert rep["not_comparable"] == 1, "it must be discarded into not_comparable"
    assert rep["spans"] == 2, "a fresh span must have opened at the new geometry"
    assert rep["verdict_ready"] is False


def test_a_hand_edited_row_resets_the_clock_too(dbp):
    """⭐ WHY THE DETECTION IS BY OBSERVATION AND NOT BY A HOOK. This rewrite never
    goes through `resync_bound_alerts` — an instrumented legacy function would
    miss it entirely, and the comparison would keep counting against a line the
    member has already moved."""
    uid = _user("admin")
    aid = _alert(uid, sym="HAND", target=100.0)
    pid = _proj.projected_predicate_id(aid)
    _proj.run_projected_comparison({"HAND": 99.0}, now=T0, db_path=dbp)

    conn = _auth_db.get_connection()
    try:
        conn.execute("UPDATE watchlist_alerts SET target_price=42.0 WHERE id=?", (aid,))
        conn.commit()
    finally:
        conn.close()

    out = _proj.run_projected_comparison({"HAND": 99.0}, now=T0 + 1, db_path=dbp)
    assert out["anchor_moves"] == 1, "a hand-edited level must reset the clock"
    assert _cmp.report(pid, db_path=dbp)["spans"] == 2


def test_the_first_tick_after_a_move_is_never_a_cross(dbp):
    """⛔ THE PRICE DID NOT MOVE THROUGH THE NEW LINE — THE LINE MOVED UNDER THE
    PRICE. A reset that kept the old baseline would report a crossing that never
    happened, now on a member's real row."""
    import api.services.watchlist_alert_service as wal

    uid = _user("admin")
    _alert(uid, sym="UNDER", target=100.0, alert_type="trendline", drawing_id="d",
           anchors={"anchor_t1": T0, "anchor_p1": 100.0,
                    "anchor_t2": T0 + DAY, "anchor_p2": 100.0})
    _proj.run_projected_comparison({"UNDER": 99.0}, now=T0, db_path=dbp)    # baseline 99
    wal.resync_bound_alerts(uid, "d", target_price=50.0, alert_type="trendline",
                            anchors=(T0, 50.0, T0 + DAY, 50.0))
    out = _proj.run_projected_comparison({"UNDER": 99.0}, now=T0 + 1, db_path=dbp)
    assert out["anchor_moves"] == 1
    assert _cmp.NEW_ONLY not in out["outcomes"].values(), (
        "the dark side reported a crossing the price never made")


# --- THE TWO SEMANTIC DIVERGENCES THE DARK PERIOD EXISTS TO MEASURE ---------

def test_DIVERGENCE_arming_beneath_the_level_is_legacy_only(dbp):
    """⛔ A REAL FINDING, not a harness bug. Legacy fires on a LEVEL TEST, so an
    alert armed while price is already through its level fires immediately. The
    dark rule needs a TRANSITION, so it does not fire at all.

    On flip, that member would lose this alert. Which way it should be settled is
    a product call — the flip is a separate approval line precisely so the call
    can be made on evidence rather than by whoever writes the migration.
    """
    uid = _user("admin")
    aid = _alert(uid, sym="BENEATH", target=100.0, direction="above")
    out = _proj.run_projected_comparison({"BENEATH": 150.0}, now=T0, db_path=dbp)
    assert out["outcomes"] == {_proj.projected_predicate_id(aid): _cmp.LEGACY_ONLY}, out


def test_KNOWN_LIMIT_the_one_shot_divergence_is_invisible_to_a_projection(dbp):
    """⚠️ RECORDED AS A LIMIT, NOT ASSERTED AS A PASS.

    Divergence 2 — legacy is ONE-SHOT (`_trigger_alert` sets `is_active = 0`)
    while the dark predicate stays armed — can be reasoned about from source but
    CANNOT be counted by this projection: the moment the legacy path fires, the
    row stops matching `is_active = 1` and the projection stops seeing it. The
    dark period therefore reports the FIRST divergence per predicate and then
    goes quiet.

    ⛔ Written down as a test so next weekend's report cannot be read as "we
    looked for `new_only` and found none". We are structurally unable to see it,
    which is a different sentence — and measuring CP4 against a `new_only` of zero
    would be measuring our own blind spot.
    """
    uid = _user("admin")
    aid = _alert(uid, sym="ONCE", target=100.0, direction="above")
    pid = _proj.projected_predicate_id(aid)

    _proj.run_projected_comparison({"ONCE": 99.0}, now=T0, db_path=dbp)
    first = _proj.run_projected_comparison({"ONCE": 101.0}, now=T0 + 1, db_path=dbp)
    assert first["outcomes"] == {pid: _cmp.AGREED}

    # The legacy path fires on its own cycle and disarms the row.
    conn = _auth_db.get_connection()
    try:
        conn.execute("UPDATE watchlist_alerts SET is_active=0 WHERE id=?", (aid,))
        conn.commit()
    finally:
        conn.close()

    _proj.run_projected_comparison({"ONCE": 98.0}, now=T0 + 2, db_path=dbp)
    _proj.run_projected_comparison({"ONCE": 102.0}, now=T0 + 3, db_path=dbp)
    assert _cmp.report(pid, db_path=dbp)["new_only"] == 0, (
        "a new_only here would mean the projection CAN see the second crossing — "
        "rewrite this note, do not delete the test")


# --- STILL DARK -------------------------------------------------------------

def test_no_cp3_module_imports_delivery():
    """The dark rail, extended to the projection. This assertion is what stands
    between a dark run over REAL member rows and a real member's inbox."""
    for name in ("price_level.py", "price_level_compare.py", "price_level_projection.py"):
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


def test_a_projected_fire_is_recorded_and_undelivered(dbp):
    uid = _user("admin")
    aid = _alert(uid, sym="DARKF", target=100.0)
    _proj.run_projected_comparison({"DARKF": 99.0}, now=T0, db_path=dbp)
    _proj.run_projected_comparison({"DARKF": 101.0}, now=T0 + 1, db_path=dbp)
    fires = _receipts.fires_for_predicate(_proj.projected_predicate_id(aid), db_path=dbp)
    assert len(fires) == 1, "the dark side must have recorded its fire"
    assert not fires[0].get("delivered_at"), "and must carry no delivery stamp"
    assert fires[0]["trigger_type"] == _pl.TYPE_ID


def test_the_comparison_writes_nothing_to_the_legacy_table(dbp):
    """⛔ A whole tick over a firing predicate, then a field-by-field comparison
    of the member's own row."""
    uid = _user("admin")
    aid = _alert(uid, sym="UNTOUCHED", target=100.0)

    def snapshot():
        conn = _auth_db.get_connection()
        try:
            return dict(conn.execute(
                "SELECT * FROM watchlist_alerts WHERE id=?", (aid,)).fetchone())
        finally:
            conn.close()

    before = snapshot()
    _proj.run_projected_comparison({"UNTOUCHED": 99.0}, now=T0, db_path=dbp)
    _proj.run_projected_comparison({"UNTOUCHED": 101.0}, now=T0 + 1, db_path=dbp)
    assert snapshot() == before, "the comparison edited the member's alert row"


def test_the_dark_sweep_is_actually_wired_to_a_tick():
    """⛔⛔ THE TEST THAT WOULD HAVE CAUGHT THE ONE REAL DEFECT IN THIS
    CHECKPOINT.

    CP3 shipped for one commit with `register()` wired and `run_projected_comparison`
    called by NOTHING — built, tested, green and unreachable, the repo's
    most-repeated defect. Every other test in this file passed, because every
    other test calls the evaluator itself. A dark run that never runs produces
    five sessions of nothing and reads, next weekend, exactly like five sessions
    of agreement.

    ⭐ So this asserts the WIRE, not the parts: registration once, a scheduler
    entry once, the job body calling the sweep, and the flag gating it.
    """
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert main.count("_at_price_level.register()") == 1, "registered exactly once"
    assert "_at_doc_arrival.register()" in main, "control: the scan can see a sibling"

    assert main.count('id="alert_taxonomy_price_level_dark"') == 1, (
        "the dark comparison has no scheduler entry — nothing will call it on "
        "Monday, and the store will be empty next weekend")
    assert main.count("run_dark_sweep()") == 1, (
        "the scheduler entry exists but does not call the sweep")
    assert 'os.environ.get("ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED", "0") == "1"' in main, (
        "the sweep is not flag-gated, or its default is not OFF — this reads real "
        "member rows, so an unset variable must mean nothing runs")


def test_the_sweep_job_body_never_reaches_a_delivery_path():
    """⛔ The scheduler entry is the one place a dark sweep could grow a delivery
    call without touching any of the three audited modules. Scoped to the job
    body, with a control proving the slice is not empty."""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    start = main.index("def _price_level_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_price_level_dark"', start)
    body = main[start:end]
    assert "run_dark_sweep" in body, "the slice is empty — this probe is broken"
    for banned in ("deliver", "send_email", "webhook", "add_alert("):
        assert banned not in body, f"the dark sweep job body mentions {banned!r}"


def test_run_dark_sweep_evaluates_the_admin_cohort_from_a_price_source(monkeypatch, dbp):
    """The sweep end to end with the price source stubbed: it must project the
    admin cohort, price it, and record an outcome."""
    uid = _user("admin")
    _alert(uid, sym="SWEEP", target=100.0, direction="above")
    member = _user("member")
    _alert(member, sym="NOPE", target=100.0, direction="above")

    asked: list = []

    def fake_prices(symbols):
        asked.append(list(symbols))
        return {s: 99.0 for s in symbols}, []

    monkeypatch.setattr(_proj, "_prices_for", fake_prices)
    first = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert asked[-1] == ["SWEEP"], (
        f"the sweep priced {asked[-1]} — a member symbol here is a cohort leak")
    assert first["projected"] == 1 and first["priced"] == 1

    monkeypatch.setattr(_proj, "_prices_for", lambda syms: ({s: 101.0 for s in syms}, []))
    second = _proj.run_dark_sweep(now=T0 + 1, db_path=dbp)
    assert list(second["outcomes"].values()) == [_cmp.AGREED], second


def test_the_sweep_REPORTS_symbols_it_could_not_price(monkeypatch, dbp):
    """⛔ A price it never saw is not a tick where nothing happened. If the sweep
    swallowed the misses, a cohort the provider went quiet on would accumulate
    'agreement' about ticks that never occurred."""
    uid = _user("admin")
    _alert(uid, sym="DARKSYM", target=100.0)
    monkeypatch.setattr(_proj, "_prices_for", lambda syms: ({}, list(syms)))
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert out["no_price"] == ["DARKSYM"], "the unpriced symbol must be reported"
    assert out["priced"] == 0
    assert out["outcomes"] == {}, "nothing may be recorded for a symbol with no price"


def test_the_sweep_is_a_no_op_with_an_empty_cohort(dbp):
    """No admin alerts at all is a normal answer, not an error — and it must not
    reach the price source."""
    _user("member") and _alert(_user("member"), sym="X")
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert out["projected"] == 0 and out["no_price"] == []


# --- THE HEARTBEAT, AND THE MONDAY QUESTION ---------------------------------

def test_the_sweep_beats_on_every_tick_including_the_empty_ones(monkeypatch, dbp):
    """⛔ A HEARTBEAT THAT ONLY BEATS ON SUCCESS IS A SUCCESS DETECTOR.

    The tick that found no admin alert and the tick that could not price one are
    exactly the ticks whose silence would be misread as a dead sweep, so both
    must stamp.
    """
    import sqlite3

    def beat():
        c = sqlite3.connect(dbp); c.row_factory = sqlite3.Row
        try:
            r = c.execute("SELECT * FROM price_level_sweep_heartbeat "
                          "WHERE id=1").fetchone()
            return dict(r) if r else None
        finally:
            c.close()

    # 1. no cohort at all
    _proj.run_dark_sweep(now=T0, db_path=dbp)
    b = beat()
    assert b is not None and b["ticks"] == 1, "the empty-cohort tick must still beat"
    assert b["projected"] == 0

    # 2. a cohort that cannot be priced
    uid = _user("admin")
    _alert(uid, sym="BEAT", target=100.0)
    monkeypatch.setattr(_proj, "_prices_for", lambda syms: ({}, list(syms)))
    _proj.run_dark_sweep(now=T0 + 60, db_path=dbp)
    b = beat()
    assert b["ticks"] == 2, "the unpriced tick must still beat"
    assert b["projected"] == 1 and b["priced"] == 0
    assert "BEAT" in b["no_price"]

    # 3. a normal tick
    monkeypatch.setattr(_proj, "_prices_for", lambda syms: ({s: 99.0 for s in syms}, []))
    _proj.run_dark_sweep(now=T0 + 120, db_path=dbp)
    b = beat()
    assert b["ticks"] == 3 and b["priced"] == 1
    assert b["last_tick"] == T0 + 120, "the stamp must be the tick's own time"


def test_a_heartbeat_failure_never_takes_the_comparison_down(monkeypatch, dbp):
    """Best-effort by construction. A heartbeat that raised would invert its own
    purpose — the liveness stamp killing the thing whose liveness it reports."""
    uid = _user("admin")
    _alert(uid, sym="SAFE", target=100.0)
    monkeypatch.setattr(_proj, "_prices_for", lambda syms: ({s: 99.0 for s in syms}, []))

    def boom(*a, **k):
        raise RuntimeError("store on fire")

    # ⛔ The HEARTBEAT's own seam, not the shared connector: patching
    # `_db.connect` breaks the comparison too, and the test would then be
    # asserting a property of a system that had already failed.
    monkeypatch.setattr(_proj, "_beat_conn", boom)
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)   # must not raise
    assert out["projected"] == 1


def test_the_monday_command_tells_STALLED_apart_from_HEALTHY(monkeypatch, dbp):
    """⛔⛔ THE WHOLE REASON THE HEARTBEAT EXISTS.

    A sweep that died at 09:01 leaves a store that looks, at 15:00, IDENTICAL to
    one that never stopped — same spans, same counts. Only the stamp's age
    separates them, so this is the assertion that makes Monday's answer worth
    reading.
    """
    import importlib.util, time as _t
    spec = importlib.util.spec_from_file_location(
        "s7rep", str(_REPO / "tools" / "s7_price_level_report.py"))
    rep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rep)

    uid = _user("admin")
    _alert(uid, sym="LIVE", target=100.0)
    monkeypatch.setattr(_proj, "_prices_for", lambda syms: ({s: 99.0 for s in syms}, []))

    # A tick stamped NOW: healthy.
    _proj.run_dark_sweep(now=_t.time(), db_path=dbp)
    text, code = rep.ticking(dbp)
    assert "TICKING: YES" in text, text
    assert code == 0
    assert "0 outcome rows is NORMAL early" in text, (
        "an early quiet store must not read as a fault")

    # The SAME store, with the stamp aged past two missed ticks: stalled.
    _proj.run_dark_sweep(now=_t.time() - 3600, db_path=dbp)
    text, code = rep.ticking(dbp)
    assert "TICKING: NO" in text, text
    assert code == 1, "a stall must exit non-zero"
    assert "STALLED" in text


def test_the_monday_command_flags_an_empty_cohort_separately(monkeypatch, dbp):
    """'Ticking but projecting nobody' is its own answer — the sweep is fine and
    there is simply no admin alert armed. Reporting that as healthy silence is
    how a week of nothing gets mistaken for a week of agreement."""
    import importlib.util, time as _t
    spec = importlib.util.spec_from_file_location(
        "s7rep2", str(_REPO / "tools" / "s7_price_level_report.py"))
    rep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rep)

    _proj.run_dark_sweep(now=_t.time(), db_path=dbp)      # no admin rows at all
    text, code = rep.ticking(dbp)
    assert "TICKING: YES" in text
    assert "projected=0" in text and "Arm one" in text, text


def test_the_report_tool_prints_only_ascii():
    """⚰️ cp1252 KILLED A TOOL IN THIS REPO ONCE ALREADY. `flag_ledger_audit.py`
    reported 'could not enumerate the project's services' for two days because a
    box-drawing byte killed a reader thread — which reads as an auth problem, not
    an encoding one, which is why it went unfixed rather than unnoticed.

    ⛔ So the RENDERED output is ASCII by construction. Docstrings and comments
    keep their marks; this asserts on what is printed, by actually rendering.
    """
    import importlib.util, sqlite3, tempfile, os
    spec = importlib.util.spec_from_file_location(
        "s7rep3", str(_REPO / "tools" / "s7_price_level_report.py"))
    rep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rep)

    d = tempfile.mkdtemp()
    p = os.path.join(d, "x.db")
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE price_level_comparison_spans (id INTEGER PRIMARY KEY, "
              "predicate_id TEXT, anchor_version INTEGER, opened_at REAL, "
              "closed_at REAL, close_reason TEXT, twin TEXT, prev_legacy REAL, "
              "sessions TEXT, agreed INTEGER DEFAULT 0, new_only INTEGER DEFAULT 0, "
              "legacy_only INTEGER DEFAULT 0, not_comparable INTEGER DEFAULT 0)")
    c.execute("INSERT INTO price_level_comparison_spans (predicate_id, anchor_version, "
              "opened_at, twin, sessions, agreed, new_only, legacy_only, not_comparable) "
              "VALUES ('legacy:z',2,0,'{\"level_kind\":\"trendline\"}','[\"d1\"]',1,0,1,2)")
    c.commit(); c.close()

    for text in (rep.render(rep.build(p), p), rep.ticking(p)[0]):
        assert text, "nothing rendered — this probe is broken, not green"
        text.encode("cp1252")          # raises UnicodeEncodeError if it regresses


def test_the_report_tool_is_read_only_about_the_store():
    """It is handed to the owner to run against PRODUCTION. It opens the store
    `mode=ro` and must contain no write verb at all."""
    import ast as _ast
    src = (_REPO / "tools" / "s7_price_level_report.py").read_text(encoding="utf-8")
    tree = _ast.parse(src)
    for node in _ast.walk(tree):
        if (isinstance(node, _ast.Expr) and isinstance(node.value, _ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = _ast.unparse(tree)
    assert "mode=ro" in code, "the read-only open is gone — broken, not green"
    # The self-check builds throwaway fixtures, so writes are legitimate THERE
    # and nowhere else. Scope to everything above it.
    main_part = code.split("def _self_check")[0]
    for verb in ("INSERT INTO", "UPDATE ", "DELETE FROM", "DROP "):
        assert verb not in main_part.upper(), f"the report writes: {verb}"


def test_the_weekend_case_never_swallows_a_real_stall():
    """⛔ THE WEEKEND EXCUSE MUST NOT BECOME A MUTE BUTTON.

    "Outside the sweep window" and "armed but broken" leave an IDENTICAL store
    and call for opposite actions, so `--ticking` distinguishes them. ⛔ But a
    window check is exactly the kind of guard that quietly widens: the moment it
    can answer "outside" while INSIDE the window, a real stall reports exit 0 and
    nobody looks again.

    So this pins both directions, and pins that an UNRESOLVABLE clock fails
    LOUD — never quiet. An instrument that cannot tell the time must not be the
    thing that decides nothing is wrong.
    """
    import importlib.util, sqlite3, tempfile, os
    spec = importlib.util.spec_from_file_location(
        "s7rep4", str(_REPO / "tools" / "s7_price_level_report.py"))
    rep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rep)

    d = tempfile.mkdtemp()
    p = os.path.join(d, "never.db")
    sqlite3.connect(p).close()          # a store the sweep has never touched

    import datetime as _dt

    class _FakeNow:
        def __init__(self, wd, hour):
            self._wd, self._hour = wd, hour
        @property
        def hour(self):
            return self._hour
        def weekday(self):
            return self._wd
        def strftime(self, _f):
            return "FAKE"

    real = rep._in_window

    # INSIDE the window with no heartbeat -> loud, exit 1.
    monkey = {"wd": 2, "hour": 10}
    rep._in_window = lambda: (True, "Wed 10:00 ET")
    text, code = rep.ticking(p)
    assert code == 1 and "TICKING: NO" in text, text
    assert "IS inside the window" in text

    # OUTSIDE the window with no heartbeat -> expected, exit 0.
    rep._in_window = lambda: (False, "Sat 11:00 ET")
    text, code = rep.ticking(p)
    assert code == 0 and "TICKING: n/a" in text, text
    assert "EXPECTED here, not a fault" in text

    rep._in_window = real

    # And the real clock helper agrees with datetime about which case today is.
    now = _dt.datetime.now()
    inside, why = rep._in_window()
    assert isinstance(inside, bool) and why, "the helper must always give a reason"

    # ⛔ An unresolvable clock must NOT report "outside" -- that would silence a
    # stall. Proved by breaking the import the helper depends on.
    import builtins
    real_import = builtins.__import__

    def boom(name, *a, **k):
        if name == "zoneinfo":
            raise ImportError("no tz database")
        return real_import(name, *a, **k)

    builtins.__import__ = boom
    try:
        inside, why = rep._in_window()
    finally:
        builtins.__import__ = real_import
    assert inside is True, (
        "a clock it cannot resolve must fail LOUD (inside the window), or the "
        "weekend excuse becomes a way to never report a stall")
    assert "could not resolve" in why


def test_a_stalled_sweep_INSIDE_the_window_still_exits_nonzero(monkeypatch, dbp):
    """The other half: a store that HAS a heartbeat, aged out, must stay exit 1
    regardless of the window — the window check only ever excuses the
    never-started case, never a sweep that stopped."""
    import importlib.util, time as _t
    spec = importlib.util.spec_from_file_location(
        "s7rep5", str(_REPO / "tools" / "s7_price_level_report.py"))
    rep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rep)

    uid = _user("admin")
    _alert(uid, sym="STALL", target=100.0)
    monkeypatch.setattr(_proj, "_prices_for", lambda syms: ({s: 99.0 for s in syms}, []))
    _proj.run_dark_sweep(now=_t.time() - 7200, db_path=dbp)      # two hours stale

    rep._in_window = lambda: (False, "Sat 11:00 ET")             # weekend, even so
    text, code = rep.ticking(dbp)
    assert code == 1, "a stale heartbeat is a stall whatever the day"
    assert "STALLED" in text


# --- THE DRY-RUN TOOL: it must not be able to reach the live store ----------

def _dryrun_mod():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "s7dry", str(_REPO / "tools" / "s7_price_level_dryrun.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_the_dry_run_refuses_to_write_inside_the_shared_data_root(tmp_path):
    """⛔ `/data` IS A REAL DIRECTORY ON THIS BOX, and the 2026-09-08 sandbox
    incident reached `C:\data\auth.db` while reporting a clean start. A tool
    that replays past bars into a store MUST NOT be able to reach the live
    comparison tables — a replay landing there would poison the forward-only
    run with exactly the data the F-S7-3 ruling forbids.
    """
    import os
    m = _dryrun_mod()

    # A scratch path is allowed (control -- otherwise the guard could pass by
    # refusing everything).
    m._assert_scratch(str(tmp_path / "ok.db"))

    existing = [r for r in m._FORBIDDEN_ROOTS if os.path.exists(os.path.realpath(r))]
    if not existing:
        pytest.skip("no live data root on this box to test the refusal against")
    with pytest.raises(SystemExit) as e:
        m._assert_scratch(os.path.join(existing[0], "alert_taxonomy.db"))
    assert "REFUSING TO WRITE" in str(e.value)


def test_the_dry_run_never_stamps_the_heartbeat():
    """⛔ A REPLAY MUST NOT BE ABLE TO MAKE A DEAD SWEEP LOOK ALIVE.

    The dry run calls `run_projected_comparison` directly, never `run_dark_sweep`
    — and that distinction is the whole safety property, so it is asserted from
    the SOURCE rather than trusted. ⛔ CODE, NEVER PROSE: the docstring discusses
    the heartbeat at length.
    """
    src = (_REPO / "tools" / "s7_price_level_dryrun.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = ast.unparse(tree)
    assert "run_projected_comparison" in code, "the scan sees no evaluator call — broken"
    assert "run_dark_sweep" not in code, (
        "the dry run calls run_dark_sweep, which stamps the heartbeat — a replay "
        "would then be indistinguishable from a live tick")
    assert "_beat" not in code


def test_the_dry_run_reports_a_missing_bar_instead_of_substituting_one():
    """⛔ `get_bars_before` returns the newest bar AT OR BEFORE the date, so a
    symbol with no bar on the requested session silently yields a DIFFERENT
    day's bar. Substituting it would answer a different question and nobody
    would know. It must land in `no_price` instead."""
    m = _dryrun_mod()
    import api.services.bars_sqlite as bs

    calls = {}

    def fake(sym, tf, n, to_key):
        calls[sym] = True
        if sym == "GOOD":
            return [(20260911, 10.0, 11.0, 9.0, 10.5, 1)]
        if sym == "STALE":
            return [(20260910, 10.0, 11.0, 9.0, 10.5, 1)]   # the day BEFORE
        return []

    real = bs.get_bars_before
    bs.get_bars_before = fake
    try:
        prices, missing = m._session_prices(["GOOD", "STALE", "NONE"], 20260911, "D")
    finally:
        bs.get_bars_before = real

    assert prices == {"GOOD": (10.0, 10.5)}
    assert any("STALE" in x for x in missing), (
        "a bar from a different session was substituted instead of reported")
    assert "NONE" in missing


# --- CP4 PREP: the all-members cohort, behind its own flag, DEFAULT OFF -----

def test_CP4_unset_leaves_the_admin_gate_EXACTLY_as_CP3_shipped_it(monkeypatch):
    """⛔ THE WHOLE SAFETY PROPERTY OF CP4 PREP.

    CP4 is UNAPPROVED. This code may sit on master only because an unset flag
    changes nothing — so the test is not "admin-only works", it is "admin-only
    is byte-for-byte the CP3 behaviour, for every value the flag can hold that
    is not an explicit yes".
    """
    monkeypatch.delenv(_proj.CP4_ALL_MEMBERS_FLAG, raising=False)
    admin, member = _user("admin"), _user("member")
    a_id = _alert(admin, sym="ADMN")
    m_id = _alert(member, sym="MEMB")

    ids = _ids()
    assert a_id in ids, "control: the admin row must still project"
    assert m_id not in ids, "unset must NOT widen the cohort"

    # ⛔ The failure direction is NARROW for everything that is not a clear yes.
    for junk in ("", "0", "false", "no", "off", "maybe", "TRUE-ish", "2", " "):
        monkeypatch.setenv(_proj.CP4_ALL_MEMBERS_FLAG, junk)
        assert m_id not in _ids(), (
            f"the flag value {junk!r} widened the cohort — only an explicit "
            "truthy value may do that")


def test_CP4_set_projects_member_rows(monkeypatch):
    """The other direction, so the flag is not inert — an unprovable widening is
    as bad as an accidental one."""
    admin, member = _user("admin"), _user("member")
    a_id = _alert(admin, sym="ADMN")
    m_id = _alert(member, sym="MEMB")

    for truthy in ("1", "true", "YES", "On"):
        monkeypatch.setenv(_proj.CP4_ALL_MEMBERS_FLAG, truthy)
        ids = _ids()
        assert m_id in ids, f"{truthy!r} should have widened the cohort"
        assert a_id in ids, "and must never DROP the admin rows"


def test_CP4_is_read_at_CALL_TIME_not_captured_at_import(monkeypatch):
    """⛔ A module-level capture would make this a DEPLOY-time decision and turn
    'unset it to narrow the cohort' into a fiction. Same defect
    `test_the_flag_is_read_per_request` exists to prevent on HUB_PREVIEW_ENABLED
    — and the rollback story is the reason it matters."""
    member = _user("member")
    m_id = _alert(member, sym="MEMB")

    monkeypatch.setenv(_proj.CP4_ALL_MEMBERS_FLAG, "1")
    assert m_id in _ids()
    monkeypatch.delenv(_proj.CP4_ALL_MEMBERS_FLAG, raising=False)
    assert m_id not in _ids(), (
        "narrowing the cohort required a restart — the flag was captured at "
        "import")


def test_CP4_never_projects_an_ORPHANED_row(monkeypatch):
    """⛔ THE WIDE PATH KEEPS THE JOIN, and this is why.

    The obvious CP4 implementation drops the `users` join entirely. That would
    also project rows whose user no longer exists — an alert with no owner, fed
    into a comparison keyed by user_id. The join is what makes 'every projected
    row belongs to a real account' true in BOTH cohorts.
    """
    member = _user("member")
    kept = _alert(member, sym="KEPT")
    orphan = _alert(member, sym="ORPH")
    conn = _auth_db.get_connection()
    try:
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("UPDATE watchlist_alerts SET user_id='ghost-user' WHERE id=?",
                     (orphan,))
        conn.commit()
    finally:
        conn.close()

    monkeypatch.setenv(_proj.CP4_ALL_MEMBERS_FLAG, "1")
    ids = _ids()
    assert kept in ids, "control: the intact member row must project"
    assert orphan not in ids, "an alert whose user is gone must never project"


def test_CP4_is_NOT_wired_to_any_scheduler_or_main(monkeypatch):
    """⛔ CP4 PREP IS CODE ONLY. The flag must appear nowhere in `api/main.py` —
    not in a scheduler block, not in a boot log line. Its only mention outside
    the projection module should be this test file."""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert _proj.CP4_ALL_MEMBERS_FLAG not in main, (
        "CP4's flag is referenced in api/main.py — this checkpoint is "
        "UNAPPROVED and must not be reachable from boot")
    # control: the CP3 flag IS there, so the probe can see a sibling.
    assert "ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED" in main
