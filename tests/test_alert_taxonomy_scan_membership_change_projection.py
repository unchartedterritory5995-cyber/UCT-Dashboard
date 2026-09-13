"""GATE-S7-SCAN-MEMBERSHIP-CHANGE **CP3** (approval line 2, fingerprint
`d0415f251`) — the read-only PROJECTION of real member `screen_alert_subs` rows,
`rollout:s7-dark` cohort ONLY, still fully dark.

⛔ Nothing here delivers and nothing writes `screen_alerts_fired`, and the rails
assert both as properties of the FILES rather than as promises in a docstring.

⛔⛔ THE TEST THIS FILE EXISTS FOR IS `test_the_dedup_state_is_reconstructed…`.
The legacy sweep WRITES `screen_alerts_fired`; a dark run reading that table
after it would see tonight's row, both rules would answer `deduped`, and every
night would record a tally of ZEROS — indistinguishable from a week of quiet
markets.
"""
from __future__ import annotations

import ast
import pathlib
import uuid

import pytest

from api.services import auth_db as _auth_db
from api.services import rollout as _rollout
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import scan_membership_change as _smc
from api.services.alert_taxonomy import scan_membership_change_compare as _cmp
from api.services.alert_taxonomy import scan_membership_change_projection as _proj
from api.services.screener import scan_store, screen_alerts, snapshot_db

_REPO = pathlib.Path(__file__).resolve().parents[1]
_AT = _REPO / "api" / "services" / "alert_taxonomy"

TF = _smc.LEGACY_TIMEFRAME
H = "def-hash-aaa"
T0 = 1_757_000_000.0


@pytest.fixture(autouse=True)
def auth(tmp_path, monkeypatch):
    """A FRESH auth.db per test — the cohort lives here."""
    p = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(p))
    monkeypatch.setattr(_auth_db, "_DB_PATH", str(p))
    _auth_db.init_db()
    return p


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, PROVED to be the one in use.

    ⛔ `C:\\data` exists on this box and the screener's default path resolves
    into it, so "we set the env var" is a claim about intent — this asserts the
    module actually reads it."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    monkeypatch.setattr(screen_alerts, "_done", set())
    assert snapshot_db.get_db_path() == str(path), (
        "SCREENER_DB_PATH did not reach snapshot_db — a module-level capture has "
        "appeared and this whole file is writing somewhere else")
    scan_store.init_db()
    screen_alerts._ensure()
    return path


@pytest.fixture()
def dbp(tmp_path):
    p = str(tmp_path / "alert_taxonomy.db")
    _db.init_db(db_path=p)
    _smc.register(db_path=p)
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
    # ⭐ S12: the COHORT is the gate, never the role — mirroring what main.py
    # does at boot rather than inventing a shortcut.
    if role == "admin":
        _rollout.ensure_s7_dark_seeded()
    return uid


def _sweep(as_of: int, tickers, *, def_hash: str = H, universe: int = 100) -> None:
    """One swept session: a coverage receipt ALWAYS, hits only if it matched."""
    scan_store.record_hits(def_hash, TF, as_of, tickers)
    scan_store.record_coverage(def_hash, TF, as_of, evaluated=universe,
                               answered=universe, dropped=0, not_computable=0,
                               dropped_symbols=[])


def _fired(user_id: str, def_hash: str, as_of: int) -> None:
    """What the LEGACY job writes when it alerts."""
    with snapshot_db.connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO screen_alerts_fired "
            "(user_id, def_hash, as_of, fired_at, entered, exited) "
            "VALUES (?,?,?,?,?,?)",
            (str(user_id), str(def_hash), int(as_of), int(T0), 1, 0))


# ══════════════════════════════════════════════════════════════════════════
# THE COHORT GATE
# ══════════════════════════════════════════════════════════════════════════

def test_only_the_s7_dark_cohort_is_projected():
    admin, member = _user("admin"), _user("member")
    screen_alerts.subscribe(admin, H, "d1", "Mine", mode="both")
    screen_alerts.subscribe(member, "def-hash-bbb", "d2", "Theirs", mode="both")

    subs = _proj.project_cohort_subscriptions()
    assert [s["user_id"] for s in subs] == [admin], (
        f"projected {[s['user_id'] for s in subs]} — a non-cohort member is a leak")
    assert subs[0]["def_hash"] == H


def test_MUTATION_dropping_the_cohort_gate_lets_a_member_row_through(monkeypatch):
    """⛔ The gate is proved by REMOVING it. A filter nobody has watched fail is
    not a gate (`lesson_gate_that_cannot_fail`)."""
    admin, member = _user("admin"), _user("member")
    screen_alerts.subscribe(admin, H, "d1", "Mine", mode="both")
    screen_alerts.subscribe(member, "def-hash-bbb", "d2", "Theirs", mode="both")

    everyone = _rollout.cohort_user_ids(_rollout.S7_DARK) | {member}
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: everyone)
    leaked = {s["user_id"] for s in _proj.project_cohort_subscriptions()}
    assert leaked == {admin, member}, (
        "widening the cohort changed nothing — every other assertion in this "
        "file is passing for the wrong reason")


def test_an_EMPTY_cohort_means_NO_MEMBERS_and_never_a_fallback(monkeypatch):
    """⛔⛔ `rollout.py:29-38`. The dangerous direction is a silent fallback to
    admins — the opposite of a kill switch."""
    admin = _user("admin")
    screen_alerts.subscribe(admin, H, "d1", "Mine", mode="both")
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: set())
    assert _proj.project_cohort_subscriptions() == []


# ══════════════════════════════════════════════════════════════════════════
# ⛔⛔ THE ORDERING HAZARD
# ══════════════════════════════════════════════════════════════════════════

def test_the_dedup_state_is_reconstructed_as_the_legacy_rule_SAW_it(dbp):
    """⛔⛔ THE DEFECT THIS CHECKPOINT WOULD OTHERWISE HAVE SHIPPED.

    The legacy job fires at 05:10 and writes `screen_alerts_fired`. This sweep
    runs at 05:20. Reading that table naively means BOTH rules see tonight's row,
    BOTH answer `deduped`, neither fires — and the tick records a tally of ZEROS.
    Every night. Which reads, next weekend, exactly like a quiet market.

    ⭐ `already_fired_before` returns only sessions strictly OLDER than tonight —
    the state the legacy rule actually decided against.
    """
    admin = _user("admin")
    screen_alerts.subscribe(admin, H, "d1", "Mine", mode="both")
    _sweep(20_260_911, ["AAA"])
    _sweep(20_260_912, ["AAA", "BBB"])        # BBB entered tonight

    tonight = scan_store.recent_covered_as_ofs(H, TF, limit=2)[0]
    _fired(admin, H, tonight)                 # the legacy job already alerted

    # The naive read would include tonight and answer `deduped`.
    naive = sorted(_proj.already_fired_before(admin, H, None))
    assert tonight in naive, "the fixture did not model the legacy write"

    reconstructed = _proj.already_fired_before(admin, H, tonight)
    assert tonight not in reconstructed, (
        "tonight's own row leaked into the dedup state — both rules will answer "
        "'deduped' and every night will record a tally of zeros")

    out = _proj.run_projected_comparison(now=T0, db_path=dbp)
    pid = _proj.projected_predicate_id(admin, H)
    assert out["outcomes"].get(pid, {}).get(_cmp.AGREED) == 1, (
        f"expected the two rules to agree that tonight alerts; got {out['outcomes']}")


def test_a_GENUINELY_older_fired_session_still_dedups(dbp):
    """⛔ The reconstruction must not throw away real history. A member alerted
    about an OLDER session keeps that fact — only tonight's own row is excluded."""
    admin = _user("admin")
    screen_alerts.subscribe(admin, H, "d1", "Mine", mode="both")
    _sweep(20_260_911, ["AAA"])
    _sweep(20_260_912, ["AAA", "BBB"])
    older = scan_store.recent_covered_as_ofs(H, TF, limit=2)[1]
    _fired(admin, H, older)

    tonight = scan_store.recent_covered_as_ofs(H, TF, limit=2)[0]
    kept = _proj.already_fired_before(admin, H, tonight)
    assert older in kept, "an older fired session was discarded — history is lost"


# ══════════════════════════════════════════════════════════════════════════
# FINDING B — a quiet swept session must DECLARE itself
# ══════════════════════════════════════════════════════════════════════════

def test_a_QUIET_swept_session_is_declared_with_an_empty_list():
    """⛔⛔ FINDING B. A session that matched nothing writes a coverage row and
    ZERO hit rows. Keying the map from `scan_hits` would drop it, and `diff()`
    would refuse with `undeclared_session`."""
    _sweep(20_260_911, ["AAA"])
    _sweep(20_260_912, [])                    # swept, matched nothing
    sessions, hits = _proj.sessions_and_hits(H)
    assert len(sessions) == 2
    for s in sessions:
        assert s in hits, f"session {s} is covered but undeclared in the hit map"
    assert hits[sessions[0]] == [], "the quiet session should declare an empty list"


def test_ONE_covered_session_is_not_comparable_and_never_quiet(dbp):
    """⛔ FINDING A. Fewer than two covered sessions means the window that would
    let us compare is gone — not that nothing moved."""
    admin = _user("admin")
    screen_alerts.subscribe(admin, H, "d1", "Mine", mode="both")
    _sweep(20_260_912, ["AAA"])
    out = _proj.run_projected_comparison(now=T0, db_path=dbp)
    pid = _proj.projected_predicate_id(admin, H)
    tally = out["outcomes"].get(pid, {})
    assert tally.get(_cmp.NOT_COMPARABLE) == 1, tally
    assert tally.get(_cmp.AGREED, 0) == 0, "a vanished window was banked as agreement"


# ══════════════════════════════════════════════════════════════════════════
# THE MAPPING AND THE RECEIPT GRAIN
# ══════════════════════════════════════════════════════════════════════════

def test_the_legacy_mode_maps_through_the_pinned_table():
    for mode, direction in _smc.DIRECTION_BY_MODE.items():
        got = _proj.params_for({"def_hash": H, "mode": mode})
        assert got["direction"] == direction, (mode, got)
    # ⛔ An unrecognised mode is SILENT, never silently 'both'.
    assert _proj.params_for({"def_hash": H, "mode": "nonsense"})["direction"] is None


def test_ONE_receipt_per_alert_however_many_names_moved(dbp):
    """⛔ The legacy dedup grain is (user, definition, SESSION). A night in which
    three names moved is ONE alert naming three. A receipt per name would
    multiply this member's dark record threefold against a legacy record of one,
    and the flip would be read against a number that never existed."""
    admin = _user("admin")
    screen_alerts.subscribe(admin, H, "d1", "Mine", mode="both")
    _sweep(20_260_911, ["AAA"])
    _sweep(20_260_912, ["AAA", "BBB", "CCC", "DDD"])   # three entered

    out = _proj.run_projected_comparison(now=T0, db_path=dbp)
    assert out["fires"] == 1, (
        f"expected ONE alert for three names, got {out['fires']}")


# ══════════════════════════════════════════════════════════════════════════
# READ-ONLY, AND STILL DARK
# ══════════════════════════════════════════════════════════════════════════

def _executed_sql(path: pathlib.Path) -> list[str]:
    """Every SQL string this module hands to `.execute(...)`.

    ⚰️ Scoped to the call, NOT to every string constant in the file — the
    position-risk version of this probe failed on the module's own docstring,
    which is the seventh instance of `CODE, NEVER PROSE` in this repo. Prose
    cannot reach an `execute()` argument by construction.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in ("execute", "executescript", "executemany")
                and node.args):
            for n in ast.walk(node.args[0]):
                if isinstance(n, ast.Constant) and isinstance(n.value, str):
                    out.append(n.value)
    return out


def test_the_projection_only_ever_SELECTs_from_the_legacy_tables():
    statements = _executed_sql(_AT / "scan_membership_change_projection.py")
    touching = [s for s in statements
                if "screen_alert_subs" in s.lower() or "screen_alerts_fired" in s.lower()]
    # CONTROL: without this the assertions below pass over an empty list.
    assert touching, (
        f"the probe found no executed SQL naming the legacy tables; it read "
        f"{len(statements)} statement(s) — it is broken, not the module")
    for sql in touching:
        up = sql.upper()
        assert "SELECT" in up, f"non-SELECT against a legacy table: {sql!r}"
        for verb in ("INSERT", "UPDATE", "DELETE", "DROP", "ALTER"):
            assert verb not in up, f"{verb} against a legacy table: {sql!r}"


def test_the_projection_NEVER_writes_screen_alerts_fired(dbp):
    """⛔ Behavioural, not only structural: a whole tick, then the legacy table
    compared row for row. Writing it would silence the member's REAL alert
    tomorrow — a dark run changing live behaviour."""
    admin = _user("admin")
    screen_alerts.subscribe(admin, H, "d1", "Mine", mode="both")
    _sweep(20_260_911, ["AAA"])
    _sweep(20_260_912, ["AAA", "BBB"])

    def snapshot():
        with snapshot_db.connect() as conn:
            return [dict(r) for r in conn.execute(
                "SELECT * FROM screen_alerts_fired ORDER BY user_id, as_of")]

    before = snapshot()
    _proj.run_projected_comparison(now=T0, db_path=dbp)
    _proj.run_projected_comparison(now=T0 + 86_400, db_path=dbp)
    assert snapshot() == before, (
        "the dark comparison wrote screen_alerts_fired — it would dedup the "
        "member's REAL alert and silence it")


def test_the_projection_never_reaches_a_delivery_path():
    for name in ("scan_membership_change.py", "scan_membership_change_compare.py",
                 "scan_membership_change_projection.py"):
        tree = ast.parse((_AT / name).read_text(encoding="utf-8"))
        imported = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                imported.append(node.module or "")
            elif isinstance(node, ast.Import):
                imported += [a.name for a in node.names]
        for mod in imported:
            assert "delivery" not in mod, f"{name} imports {mod}"
        assert imported, f"{name}: the import walk found nothing — the probe is broken"


def test_the_heartbeat_BEATS_even_when_the_cohort_is_empty(monkeypatch, dbp):
    """⛔⛔ On a NIGHTLY clock most nights are quiet, so a heartbeat that only
    beats on success is a success detector."""
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: set())
    assert _cmp.heartbeat(db_path=dbp) is None
    _proj.run_dark_sweep(now=T0, db_path=dbp)
    beat = _cmp.heartbeat(db_path=dbp)
    assert beat is not None and beat["ticks"] == 1, beat


def test_the_dark_sweep_is_actually_wired_to_a_tick():
    """⛔⛔ THE CALLER RAIL THE APPROVAL LINE ASKS FOR: *a caller-rail proving the
    evaluator is reachable from the sweep and from nothing else.*"""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert main.count("_at_scan_membership.register()") == 1, "registered exactly once"
    assert "_at_doc_arrival.register()" in main, "control: the scan can see a sibling"

    assert main.count('id="alert_taxonomy_scan_membership_dark"') == 1, (
        "the dark comparison has no scheduler entry — nothing will call it, and "
        "the store will be empty next weekend")
    start = main.index("def _scan_membership_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_scan_membership_dark"', start)
    body = main[start:end]
    assert "run_dark_sweep()" in body, (
        "the scheduler entry exists but its job body does not call the sweep")
    assert 'os.environ.get("ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED", "0") == "1"' in main


def test_the_cadence_is_DERIVED_from_the_legacy_sweeps_own_constants():
    """⭐ The offset is load-bearing (the ordering hazard) and must move if the
    scan sweep moves. A typed `hour=5, minute=20` would silently detach."""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    start = main.index('def _scan_membership_dark_sweep_job():')
    end = main.index('id="alert_taxonomy_scan_membership_dark"', start)
    body = main[start:end]
    assert "_scan_eval.SWEEP_HOUR_ET" in body and "_scan_eval.SWEEP_MINUTE_ET" in body, (
        "the dark sweep's time is hand-typed; it must derive from the scan "
        "sweep's own constants or the +20 offset detaches when the sweep moves")


def test_NOTHING_IS_ARMED_the_flag_defaults_to_off():
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert '"ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED", "0"' in main, (
        "the default is not '0' — an unset variable would arm a dark run over "
        "real member subscriptions")
