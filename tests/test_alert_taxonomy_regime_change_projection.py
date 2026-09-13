"""GATE-S7-REGIME-CHANGE **CP3** (approval line 2, fingerprint `9f0575340`) —
the read-only PROJECTION over the `rollout:s7-dark` cohort, still fully dark.

⛔ §4 warns that this type's projection is UNUSUAL: the predicate is global, so
"projecting member rows" means projecting the **stake test** over the cohort.

⛔⛔ THE TWO TESTS THIS FILE EXISTS FOR:
  · `test_the_projection_NEVER_writes_the_regime_ledger` — the legacy's own
    read-then-append memory. Writing it would corrupt the `prev_label` the LIVE
    R4 rule reads next cycle: a comparison turning into an intervention.
  · `test_one_ledger_row_is_observed_ONCE` — without a watermark, `agreed`
    becomes a function of the sweep's cadence rather than of the market.
"""
from __future__ import annotations

import ast
import pathlib
import sqlite3
import uuid

import pytest

from api.services import auth_db as _auth_db
from api.services import rollout as _rollout
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import regime_change as _rc
from api.services.alert_taxonomy import regime_change_compare as _cmp
from api.services.alert_taxonomy import regime_change_projection as _proj
from api.services.awareness import regime_snapshots as _snap

_REPO = pathlib.Path(__file__).resolve().parents[1]
_AT = _REPO / "api" / "services" / "alert_taxonomy"
T0 = 1_757_000_000.0


def _code_only(path: pathlib.Path) -> str:
    """The module's CODE, with comments and docstrings removed.

    ⚰️⚰️ THE NINTH INSTANCE OF `CODE, NEVER PROSE` IN THIS REPO, AND THE SECOND
    TODAY — both of them mine. `ast.unparse` drops COMMENTS but **keeps
    docstrings**, because a docstring is a string expression and not a comment.
    Two probes in this very file first asserted `"record_snapshot" not in
    unparse(...)` and `"add_insight" not in unparse(...)` and both tripped on the
    module's own explanation of why it must never call them.

    ⭐ The fix is one helper, used by every probe here, rather than the same
    blanking loop written out three times — three copies of a guard cannot all be
    mutation-proved (`lesson_a_guard_repeated_is_a_guard_unproved`).
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return ast.unparse(ast.fix_missing_locations(tree))


def test_CONTROL_the_code_only_helper_removes_prose_and_keeps_code():
    """⛔ The helper is itself an instrument, so it gets a control: a name that
    exists ONLY in prose must vanish, and one that exists in code must survive."""
    code = _code_only(_AT / "regime_change_projection.py")
    assert "record_snapshot" not in code, "prose survived the blanking"
    assert "def run_dark_sweep" in code, "the blanking ate the code as well"


@pytest.fixture(autouse=True)
def auth(tmp_path, monkeypatch):
    """A FRESH auth.db per test — the cohort, the stakes AND the regime ledger
    all live in this one file."""
    p = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(p))
    monkeypatch.setattr(_auth_db, "_DB_PATH", str(p))
    monkeypatch.setattr(_snap, "_DB_PATH", str(p))
    _auth_db.init_db()
    _snap.init_schema()
    return p


@pytest.fixture()
def dbp(tmp_path):
    p = str(tmp_path / "alert_taxonomy.db")
    _db.init_db(db_path=p)
    _rc.register(db_path=p)
    return p


def _user(role: str = "admin") -> str:
    uid = "u-" + uuid.uuid4().hex[:12]
    conn = _auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
            (uid, f"{uid}@example.test", "x", role))
        conn.commit()
    finally:
        conn.close()
    if role == "admin":
        _rollout.ensure_s7_dark_seeded()
    return uid


def _watch(user_id: str, sym: str = "AAA") -> None:
    wid = "w-" + uuid.uuid4().hex[:12]
    conn = _auth_db.get_connection()
    try:
        conn.execute("INSERT INTO watchlists (id, user_id, name) VALUES (?,?,?)",
                     (wid, user_id, "L"))
        conn.execute(
            "INSERT INTO watchlist_items (id, watchlist_id, sym) VALUES (?,?,?)",
            ("i-" + uuid.uuid4().hex[:12], wid, sym))
        conn.commit()
    finally:
        conn.close()


def _ledger(*labels: str) -> None:
    """Append cycles to the legacy ledger, oldest first — exactly what the
    awareness engine does, one row per scan cycle."""
    for lab in labels:
        _snap.record_snapshot(lab, 0.8)


# ══════════════════════════════════════════════════════════════════════════
# THE LEDGER IS THE RECORD OF WHAT R4 SAW
# ══════════════════════════════════════════════════════════════════════════

def test_the_reading_reconstructs_what_R4_compared_against():
    """⭐ The engine appends one row per cycle, so after a cycle the NEWEST row
    is what it classified and the SECOND-NEWEST is what `get_last_label()`
    returned to R4 before the append."""
    _ledger("chop", "chop", "bull_trend")
    r = _proj.ledger_reading()
    assert r["current_label"] == "bull_trend"
    assert r["prior_label"] == "chop", (
        "the prior label is not the row before the newest — the reconstruction "
        "does not match what R4 decided against")


def test_a_ledger_with_ONE_row_has_no_prior_and_that_is_not_a_flip():
    """⛔ A first-ever cycle has nothing to compare. `would_fire` treats a
    missing prev_label as 'no flip', which is the honest answer."""
    _ledger("chop")
    r = _proj.ledger_reading()
    assert r["current_label"] == "chop" and r["prior_label"] is None


def test_an_EMPTY_ledger_is_reported_as_such_and_the_sweep_records_nothing(dbp):
    _user()
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert out["skipped"] == "no_ledger_rows", out
    assert out["evaluated"] == 0


def test_the_projection_NEVER_writes_the_regime_ledger(dbp):
    """⛔⛔ THE ONE THAT MATTERS MOST. `_compute_regime_component` does a
    read-then-APPEND; a dark run calling it would corrupt the `prev_label` the
    LIVE R4 rule reads next cycle — a comparison turning into an intervention.

    Behavioural AND structural: a whole sweep, then the ledger compared row for
    row, plus a source check that the module executes no write against it.
    """
    admin = _user(); _watch(admin)
    _ledger("chop", "bull_trend")

    def snapshot():
        conn = sqlite3.connect(_snap._DB_PATH)
        try:
            return conn.execute(
                "SELECT id, label, confidence FROM awareness_regime_snapshots "
                "ORDER BY id").fetchall()
        finally:
            conn.close()

    before = snapshot()
    _proj.run_dark_sweep(now=T0, db_path=dbp)
    _proj.run_dark_sweep(now=T0 + 1200, db_path=dbp)
    assert snapshot() == before, (
        "the dark sweep appended to the regime ledger — it has corrupted the "
        "prev_label the LIVE R4 rule reads next cycle")

    # STRUCTURAL: no write statement against the ledger anywhere in the module.
    src = (_AT / "regime_change_projection.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    executed = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in ("execute", "executescript") and node.args):
            for n in ast.walk(node.args[0]):
                if isinstance(n, ast.Constant) and isinstance(n.value, str):
                    executed.append(n.value)
    touching = [s for s in executed if "awareness_regime_snapshots" in s.lower()]
    assert touching, "the SQL probe found nothing — it is broken, not the module"
    for sql in touching:
        up = sql.upper()
        assert "SELECT" in up and "INSERT" not in up and "UPDATE" not in up, sql
    # And it must not reach the writer by name either.
    assert "record_snapshot" not in _code_only(_AT / "regime_change_projection.py"), (
        "the projection can reach `record_snapshot` — that is the legacy's own "
        "append and it must never be called from a dark run")


# ══════════════════════════════════════════════════════════════════════════
# ⛔⛔ ONE LEDGER ROW, OBSERVED ONCE
# ══════════════════════════════════════════════════════════════════════════

def test_one_ledger_row_is_observed_ONCE(dbp):
    """⛔⛔ Without the watermark, a sweep ticking faster than the awareness
    engine re-observes the SAME flip every tick and `observe()` increments the
    span each time — so `agreed` becomes a function of the sweep's cadence
    rather than of the market, and a busier schedule looks like more agreement.
    """
    admin = _user(); _watch(admin)
    _ledger("chop", "bull_trend")

    first = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert first["skipped"] is None and first["evaluated"] > 0, first

    second = _proj.run_dark_sweep(now=T0 + 60, db_path=dbp)
    assert second["skipped"] == "already_observed", second
    assert second["evaluated"] == 0

    # A NEW cycle lands → observable again.
    _ledger("distribution")
    third = _proj.run_dark_sweep(now=T0 + 1200, db_path=dbp)
    assert third["skipped"] is None and third["evaluated"] > 0, third


def test_the_heartbeat_BEATS_on_a_skipped_tick_too(dbp):
    """⛔⛔ A flat market is exactly the tick a success-detector would miss, and
    for this type most ticks are flat by nature."""
    admin = _user(); _watch(admin)
    _ledger("chop", "bull_trend")
    _proj.run_dark_sweep(now=T0, db_path=dbp)
    after_first = _cmp.heartbeat(db_path=dbp)["ticks"]
    _proj.run_dark_sweep(now=T0 + 60, db_path=dbp)      # skipped: already observed
    assert _cmp.heartbeat(db_path=dbp)["ticks"] == after_first + 1, (
        "a skipped tick did not beat — liveness stops exactly when the market "
        "is quiet")


# ══════════════════════════════════════════════════════════════════════════
# THE STAKE TEST — §4's "unusual" projection
# ══════════════════════════════════════════════════════════════════════════

def test_the_stake_test_is_projected_from_the_two_bulk_queries():
    admin = _user()
    other = _user()
    _watch(admin, "AAA")
    stakes = _proj.member_stakes({admin, other})
    assert stakes[admin] == (False, True), stakes
    assert stakes[other] == (False, False), stakes


def test_the_two_legacy_emitters_DISAGREE_on_the_stake_axis_and_the_params_say_so():
    """⛔ R4 gates on position-or-watchlist; `maybe_emit_regime_shift` applies NO
    stake test at all. Flattening them to one value would invent an agreement the
    legacy does not have."""
    assert _proj._params(_rc.LEDGER)["stake"] == _rc.LEGACY_STAKE_LEDGER
    assert _proj._params(_rc.SESSION_SUMMARY)["stake"] == _rc.LEGACY_STAKE_SESSION_SUMMARY
    assert _rc.LEGACY_STAKE_LEDGER != _rc.LEGACY_STAKE_SESSION_SUMMARY, (
        "the two emitters now agree on the stake axis — this test is the record "
        "that they did not, and the projection's two-predicate shape assumes it")


def test_BOTH_prior_label_sources_get_their_own_span(dbp):
    admin = _user(); _watch(admin)
    _ledger("chop", "bull_trend")
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert out["evaluated"] == len(_rc.PRIOR_LABEL_SOURCES), out
    for source in _rc.PRIOR_LABEL_SOURCES:
        assert _proj.projected_predicate_id(admin, source) != \
            _proj.projected_predicate_id(admin, "other")


# ══════════════════════════════════════════════════════════════════════════
# THE COHORT GATE
# ══════════════════════════════════════════════════════════════════════════

def test_only_the_s7_dark_cohort_is_projected(dbp):
    admin = _user("admin")
    member = _user("member")
    _watch(admin); _watch(member)
    _ledger("chop", "bull_trend")
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert out["members"] == 1, out
    assert _proj.projected_predicate_id(member, _rc.LEDGER) not in out["outcomes"]


def test_MUTATION_dropping_the_cohort_gate_lets_a_member_row_through(monkeypatch, dbp):
    admin = _user("admin"); member = _user("member")
    _watch(admin); _watch(member)
    _ledger("chop", "bull_trend")
    everyone = _rollout.cohort_user_ids(_rollout.S7_DARK) | {member}
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: everyone)
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert out["members"] == 2, (
        "widening the cohort changed nothing — every other assertion here is "
        "passing for the wrong reason")


def test_an_EMPTY_cohort_means_NO_MEMBERS_and_never_a_fallback(monkeypatch, dbp):
    _user("admin")
    _ledger("chop", "bull_trend")
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: set())
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert out["skipped"] == "empty_cohort" and out["evaluated"] == 0, out


# ══════════════════════════════════════════════════════════════════════════
# STILL DARK
# ══════════════════════════════════════════════════════════════════════════

def test_the_projection_never_reaches_a_delivery_path():
    for name in ("regime_change.py", "regime_change_compare.py",
                 "regime_change_projection.py"):
        tree = ast.parse((_AT / name).read_text(encoding="utf-8"))
        imported = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                imported.append(node.module or "")
            elif isinstance(node, ast.Import):
                imported += [a.name for a in node.names]
        for mod in imported:
            assert "delivery" not in mod, f"{name} imports {mod}"
            assert "voice_proactive_service" not in mod, f"{name} imports {mod}"
            assert "awareness.engine" not in mod, f"{name} imports {mod}"
        assert imported, f"{name}: the import walk found nothing — the probe is broken"
    assert "add_insight" not in _code_only(_AT / "regime_change_projection.py"), (
        "the projection can reach add_insight")


def test_the_dark_sweep_is_actually_wired_to_a_tick():
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert main.count("_at_regime_change.register()") == 1, "registered exactly once"
    assert "_at_doc_arrival.register()" in main, "control: the scan can see a sibling"
    assert main.count('id="alert_taxonomy_regime_change_dark"') == 1
    start = main.index("def _regime_change_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_regime_change_dark"', start)
    body = main[start:end]
    assert "run_dark_sweep()" in body
    assert 'os.environ.get("ALERT_TAXONOMY_REGIME_CHANGE_DARK_ENABLED", "0") == "1"' in main


def test_the_cadence_SHADOWS_the_awareness_scan_rather_than_racing_it():
    """⭐ The ledger only changes when the awareness engine runs, so the sweep
    rides its cadence with an offset — observing each append after it lands
    rather than sampling a store nothing has touched."""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    start = main.index("def _regime_change_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_regime_change_dark"', start)
    body = main[start:end]
    assert 'minute="7-59/20"' in body, body
    # CONTROL: the awareness scan it shadows really is */20.
    assert 'minute="*/20"' in main, (
        "the awareness scan is no longer */20 — this sweep's offset assumed it")


def test_the_sweep_job_body_never_reaches_a_delivery_path():
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    start = main.index("def _regime_change_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_regime_change_dark"', start)
    body = main[start:end]
    assert "run_dark_sweep" in body, "the slice is empty — this probe is broken"
    for banned in ("deliver", "add_insight", "record_snapshot", "webhook"):
        assert banned not in body, f"the dark sweep job body mentions {banned!r}"


def test_NOTHING_IS_ARMED_the_flag_defaults_to_off():
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert '"ALERT_TAXONOMY_REGIME_CHANGE_DARK_ENABLED", "0"' in main
