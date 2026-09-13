"""GATE-S7-POSITION-RISK **CP3** (approval line 2, fingerprint `ec2b197f8`) —
the read-only PROJECTION of real member `j2_positions` rows, `rollout:s7-dark`
cohort ONLY, still fully dark.

⛔ Nothing here delivers, and the rails assert that as a property of the FILES
rather than as a promise in a docstring. This is the checkpoint where this
type's dark evaluator first reads real member data, so the guards are the point.

⛔⛔ `legacy_only` MEANS AN EMAIL AND A DISCORD PUSH A MEMBER STOPS RECEIVING.
`awareness/engine.py`'s `_DELIVER_IMPORTANCE_FLOOR = 8` and `stop_hit` always
scores 10 with a symbol, so every stop breach already away-delivers today. That
is why the four outcomes are never collapsed into a rate.
"""
from __future__ import annotations

import ast
import pathlib
import uuid

import pytest

from api.services import auth_db as _auth_db
from api.services import rollout as _rollout
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import position_risk as _pr
from api.services.alert_taxonomy import position_risk_compare as _cmp
from api.services.alert_taxonomy import position_risk_projection as _proj

_REPO = pathlib.Path(__file__).resolve().parents[1]
_AT = _REPO / "api" / "services" / "alert_taxonomy"
T0 = 1_757_000_000.0


@pytest.fixture(autouse=True)
def auth(tmp_path, monkeypatch):
    """A FRESH auth.db per test.

    ⛔ Per-test, not per-session: `project_cohort_positions()` returns EVERY open
    position in the cohort, so a row left behind by an earlier test is a row this
    one silently compares against. ⛔ And never the real store — `/data` is a real
    directory on this box. Pinning `AUTH_DB_PATH` *and* the module global together
    is the repo's idiom, because `_DB_PATH` is captured at import.
    """
    p = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(p))
    monkeypatch.setattr(_auth_db, "_DB_PATH", str(p))
    _auth_db.init_db()
    return p


@pytest.fixture()
def dbp(tmp_path):
    p = str(tmp_path / "alert_taxonomy.db")
    _db.init_db(db_path=p)
    _pr.register(db_path=p)
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
    # ⭐ S12: the COHORT is the gate, never the role. This mirrors what
    # `api/main.py` does at boot — seed `rollout:s7-dark` FROM the role,
    # idempotently — so the fixture reproduces production rather than inventing a
    # shortcut. An admin created without this is invisible to the projection,
    # which is the correct new behaviour and would make the tests below pass for
    # the wrong reason.
    if role == "admin":
        _rollout.ensure_s7_dark_seeded()
    return uid


def _position(user_id: str, *, symbol="AAPL", side="Long", entry=100.0,
              stop=90.0, source="manual", closed=False) -> str:
    pid = "p-" + uuid.uuid4().hex[:12]
    conn = _auth_db.get_connection()
    try:
        cols = {c[1] for c in conn.execute("PRAGMA table_info(j2_positions)")}
        row = {"id": pid, "user_id": user_id, "symbol": symbol, "side": side,
               "entry_price": entry, "stop_price": stop, "source": source,
               "closed_at": 1_700_000_000 if closed else None}
        row = {k: v for k, v in row.items() if k in cols}
        # Required NOT NULL columns this fixture does not care about get a
        # harmless value, so the insert is about the fields the rule reads.
        for c in conn.execute("PRAGMA table_info(j2_positions)"):
            name, notnull, default = c[1], c[3], c[4]
            if name in row or not notnull or default is not None or name == "id":
                continue
            row[name] = 1 if c[2].upper() in ("REAL", "INTEGER") else "x"
        keys = ",".join(row)
        marks = ",".join("?" * len(row))
        conn.execute(f"INSERT INTO j2_positions ({keys}) VALUES ({marks})",
                     tuple(row.values()))
        conn.commit()
    finally:
        conn.close()
    return pid


# ══════════════════════════════════════════════════════════════════════════
# THE COHORT GATE
# ══════════════════════════════════════════════════════════════════════════

def test_only_the_s7_dark_cohort_is_projected():
    """⛔ CP3 is approved for the `rollout:s7-dark` cohort only."""
    admin, member = _user("admin"), _user("member")
    _position(admin, symbol="ADMN")
    _position(member, symbol="MEMB")

    by_user = _proj.project_cohort_positions()
    assert set(by_user) == {admin}, (
        f"projected {sorted(by_user)} — a non-cohort user here is a member leak")
    assert [p["symbol"] for p in by_user[admin]] == ["ADMN"]


def test_MUTATION_dropping_the_cohort_gate_lets_a_member_row_through(monkeypatch):
    """⛔ The gate is proved by REMOVING it. A cohort filter nobody has watched
    fail is not a gate (`lesson_gate_that_cannot_fail`)."""
    admin, member = _user("admin"), _user("member")
    _position(admin, symbol="ADMN")
    _position(member, symbol="MEMB")

    everyone = _rollout.cohort_user_ids(_rollout.S7_DARK) | {member}
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: everyone)
    leaked = _proj.project_cohort_positions()
    assert set(leaked) == {admin, member}, (
        "widening the cohort changed nothing — the gate is not the thing being "
        "tested and every other assertion here is passing for the wrong reason")


def test_an_EMPTY_cohort_means_NO_MEMBERS_and_never_a_fallback(monkeypatch):
    """⛔⛔ `rollout.py:29-38`. The dangerous failure direction is a cohort that
    silently falls back to admins — the opposite of a kill switch."""
    admin = _user("admin")
    _position(admin, symbol="ADMN")
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: set())
    assert _proj.project_cohort_positions() == {}
    assert _proj.projected_symbols() == []


def test_a_CLOSED_position_is_not_projected():
    """`closed_at IS NULL` is the legacy population's own predicate, not an
    afterthought: a closed position has no stop to breach and the legacy rule
    never sees it."""
    admin = _user("admin")
    _position(admin, symbol="OPEN")
    _position(admin, symbol="SHUT", closed=True)
    syms = _proj.projected_symbols()
    assert syms == ["OPEN"], syms


# ══════════════════════════════════════════════════════════════════════════
# READ-ONLY
# ══════════════════════════════════════════════════════════════════════════

def test_the_projection_writes_nothing_to_the_legacy_table(dbp):
    """⛔ A whole tick over a breaching position, then a field-by-field
    comparison of the member's own row."""
    admin = _user("admin")
    _position(admin, symbol="BRCH", entry=100.0, stop=90.0)

    def snapshot():
        conn = _auth_db.get_connection()
        try:
            return [dict(r) for r in conn.execute(
                "SELECT * FROM j2_positions ORDER BY id")]
        finally:
            conn.close()

    before = snapshot()
    _proj.run_projected_comparison({"BRCH": 89.0}, now=T0, db_path=dbp)
    _proj.run_projected_comparison({"BRCH": 95.0}, now=T0 + 60, db_path=dbp)
    assert snapshot() == before, "the comparison edited the member's position row"


def _executed_sql(path: pathlib.Path) -> list[str]:
    """Every SQL string this module actually hands to `.execute(...)`.

    ⚰️⚰️ THE FIRST VERSION OF THIS PROBE SCANNED **EVERY STRING CONSTANT** IN THE
    FILE AND FAILED ON THE MODULE'S OWN DOCSTRING — which says "j2_positions"
    several times and contains no SELECT. That is the seventh instance of `CODE,
    NEVER PROSE` in this repo: an instrument reporting a property of ITSELF as a
    property of what it measures.

    ⭐ The fix is not to delete the word from the docstring — that would make the
    probe pass and leave the next reader without the explanation. It is to ask a
    narrower and more honest question: **what SQL does this module RUN?** Scoped
    to `.execute()`'s first argument, prose cannot reach it by construction.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in ("execute", "executescript", "executemany")
                and node.args):
            a = node.args[0]
            # A query built by concatenation (`"..." f"...({ph})"`) arrives as a
            # JoinedStr or a BinOp; flatten every string piece inside it.
            for n in ast.walk(a):
                if isinstance(n, ast.Constant) and isinstance(n.value, str):
                    out.append(n.value)
    return out


def test_the_projection_only_ever_SELECTs_from_the_legacy_table():
    """⛔ Every statement this module RUNS against `j2_positions` is a SELECT,
    asserted from the SOURCE. A mutation would put a second authority on a
    member's open book."""
    statements = _executed_sql(_AT / "position_risk_projection.py")
    # CONTROL: the probe really found the query it is judging. Without this the
    # assertions below pass over an empty list.
    touching = [s for s in statements if "j2_positions" in s.lower()]
    assert touching, (
        f"the probe found no executed SQL naming j2_positions; it read "
        f"{len(statements)} statement(s) — it is broken, not the module")
    for sql in touching:
        up = sql.upper()
        assert "SELECT" in up, f"non-SELECT touching j2_positions: {sql!r}"
        for verb in ("INSERT", "UPDATE", "DELETE", "DROP", "ALTER"):
            assert verb not in up, f"{verb} against j2_positions: {sql!r}"


def test_CONTROL_the_sql_probe_ignores_prose_and_still_sees_a_real_query():
    """⛔ The control for the defect above: a docstring naming the table is not a
    statement, and a real `execute` is."""
    fake = pathlib.Path(_AT / "position_risk_projection.py")
    assert not any("GATE-S7" in s for s in _executed_sql(fake)), (
        "the probe is reading the module docstring again")


# ══════════════════════════════════════════════════════════════════════════
# THE COMPARISON
# ══════════════════════════════════════════════════════════════════════════

def test_both_rules_agree_on_a_plain_breach(dbp):
    """A Long at 100 stopped at 90, priced 89: both rules fire `stop_hit`."""
    admin = _user("admin")
    _position(admin, symbol="BRCH", side="Long", entry=100.0, stop=90.0)
    out = _proj.run_projected_comparison({"BRCH": 89.0}, now=T0, db_path=dbp)

    pid = _proj.projected_predicate_id(admin, _pr.SEV_STOP_HIT)
    assert out["outcomes"][pid][_cmp.AGREED] == 1, out["outcomes"]
    assert out["fires"] >= 1


def test_an_UNPRICED_symbol_is_not_comparable_and_is_never_agreement(dbp):
    """⛔⛔ §5 item 7. The legacy rule skips a symbol the cache did not hold with
    NO record, so to a naive harness both sides 'agree' — when in fact neither
    side evaluated anything. NO DATA is not QUIET."""
    admin = _user("admin")
    _position(admin, symbol="DARK", side="Long", entry=100.0, stop=90.0)
    out = _proj.run_projected_comparison({}, now=T0, db_path=dbp)

    pid = _proj.projected_predicate_id(admin, _pr.SEV_STOP_HIT)
    tally = out["outcomes"].get(pid, {})
    assert tally.get(_cmp.NOT_COMPARABLE) == 1, tally
    assert tally.get(_cmp.AGREED, 0) == 0, "an unpriced symbol was banked as agreement"


def test_a_BROKER_PLACEHOLDER_stop_is_skipped_by_both_sides(dbp):
    """⛔ SAFETY-CRITICAL, inherited verbatim. A broker import stores
    `stop_price == entry_price` as the "no stop set" placeholder; counting it as
    a real stop reads as an instant breach on every broker position."""
    admin = _user("admin")
    _position(admin, symbol="PLAC", side="Long", entry=100.0, stop=100.0,
              source="broker")
    out = _proj.run_projected_comparison({"PLAC": 50.0}, now=T0, db_path=dbp)
    assert out["fires"] == 0, "a placeholder stop fired — every broker row breaches"
    pid = _proj.projected_predicate_id(admin, _pr.SEV_STOP_HIT)
    assert out["outcomes"].get(pid, {}).get(_cmp.AGREED, 0) == 0


def test_a_MANUAL_position_with_stop_equal_to_entry_is_NOT_skipped(dbp):
    """⛔ THE OTHER HALF OF THE SAME POLICY, and it is easy to get wrong. The
    legacy skip is gated on `source == "broker"`. A member who TYPED a stop equal
    to entry gets the alert — arguably correct, and inherited rather than
    silently 'fixed' while migrating."""
    admin = _user("admin")
    _position(admin, symbol="MANU", side="Long", entry=100.0, stop=100.0,
              source="manual")
    out = _proj.run_projected_comparison({"MANU": 99.0}, now=T0, db_path=dbp)
    pid = _proj.projected_predicate_id(admin, _pr.SEV_STOP_HIT)
    assert out["outcomes"][pid][_cmp.AGREED] == 1, out["outcomes"]


def test_the_two_severities_are_separate_predicates_and_separate_fire_keys(dbp):
    """⛔ The legacy dedup grain is `(symbol, kind)` — `stop_hit` and
    `stop_proximity` are namespaced apart there precisely so a proximity warning
    cannot suppress the breach that follows it. Collapsing them here would
    re-create that bug in the dark store."""
    admin = _user("admin")
    _position(admin, symbol="NEAR", side="Long", entry=100.0, stop=90.0)
    # 92 is within 3% of the 90 stop: proximity, not a breach.
    out = _proj.run_projected_comparison({"NEAR": 92.0}, now=T0, db_path=dbp)

    hit = _proj.projected_predicate_id(admin, _pr.SEV_STOP_HIT)
    near = _proj.projected_predicate_id(admin, _pr.SEV_STOP_PROXIMITY)
    assert hit != near
    assert out["outcomes"].get(near, {}).get(_cmp.AGREED) == 1, out["outcomes"]
    assert out["outcomes"].get(hit, {}).get(_cmp.AGREED, 0) == 0


def test_aggregate_heat_is_NOT_projected(dbp):
    """⛔ It has no incumbent — no schedule, no delivery, nothing to be
    `legacy_only` against. Projecting it would manufacture a per-member stream of
    `no_incumbent` once a minute: noise wearing the shape of evidence."""
    admin = _user("admin")
    _position(admin, symbol="HEAT")
    out = _proj.run_projected_comparison({"HEAT": 95.0}, now=T0, db_path=dbp)
    heat = _proj.projected_predicate_id(admin, _pr.SEV_AGGREGATE_HEAT)
    assert heat not in out["outcomes"]
    assert out["evaluated"] == len(_pr.ABSORBED_SEVERITIES)


# ══════════════════════════════════════════════════════════════════════════
# THE SWEEP — the part that makes CP3 more than a library
# ══════════════════════════════════════════════════════════════════════════

def test_run_dark_sweep_prices_only_cohort_symbols(monkeypatch, dbp):
    admin, member = _user("admin"), _user("member")
    _position(admin, symbol="MINE", entry=100.0, stop=90.0)
    _position(member, symbol="THEIRS", entry=100.0, stop=90.0)

    asked = []

    def fake_prices(symbols):
        asked.append(list(symbols))
        return {s: 89.0 for s in symbols}, []

    monkeypatch.setattr(_proj, "_prices_for", fake_prices)
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert asked[-1] == ["MINE"], (
        f"the sweep priced {asked[-1]} — a non-cohort symbol here is a leak")
    assert out["members"] == 1 and out["priced"] == 1


def test_the_sweep_REPORTS_symbols_it_could_not_price(monkeypatch, dbp):
    """⛔ A price it never saw is not a tick where nothing happened. Swallowing
    the misses would let a cohort the provider went quiet on accumulate
    'agreement' about ticks that never occurred."""
    admin = _user("admin")
    _position(admin, symbol="GHOST", entry=100.0, stop=90.0)
    monkeypatch.setattr(_proj, "_prices_for", lambda syms: ({}, list(syms)))
    out = _proj.run_dark_sweep(now=T0, db_path=dbp)
    assert out["no_price"] == ["GHOST"], out


def test_the_heartbeat_BEATS_even_when_the_cohort_is_empty(monkeypatch, dbp):
    """⛔⛔ A HEARTBEAT THAT ONLY BEATS ON SUCCESS IS A SUCCESS DETECTOR.

    `observe()` carries the beat, and `observe()` is never reached when there is
    nothing to project — so without an explicit beat the liveness signal would
    stop exactly when the sweep had nothing to say, which is indistinguishable
    from the sweep being dead.
    """
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: set())
    assert _cmp.heartbeat(db_path=dbp) is None
    _proj.run_dark_sweep(now=T0, db_path=dbp)
    beat = _cmp.heartbeat(db_path=dbp)
    assert beat is not None and beat["ticks"] == 1, beat
    _proj.run_dark_sweep(now=T0 + 60, db_path=dbp)
    assert _cmp.heartbeat(db_path=dbp)["ticks"] == 2


def test_the_market_date_is_ET_and_not_the_boxs_clock():
    """⭐ Sessions are counted by this string. The box runs in Chicago and the
    pod in UTC; either would drift from the market day being measured."""
    # ⚰️ This first hand-typed a Unix timestamp and asserted the wrong YEAR
    # (2025 for a value I called 2026). ⛔ A magic epoch number in a test about
    # dates is the same class of error the thing under test exists to avoid —
    # derive it.
    from datetime import datetime, timezone
    utc_early_hours = datetime(2026, 9, 14, 0, 30, tzinfo=timezone.utc).timestamp()
    assert _proj.market_date(utc_early_hours) == "2026-09-13", (
        "00:30 UTC on the 14th is still the 13th in ET; this stamped the UTC day")
    utc_afternoon = datetime(2026, 9, 14, 18, 0, tzinfo=timezone.utc).timestamp()
    assert _proj.market_date(utc_afternoon) == "2026-09-14", (
        "control: the two sides of the boundary must differ, or the assertion "
        "above passes for any implementation that returns a constant")


# ══════════════════════════════════════════════════════════════════════════
# STILL DARK
# ══════════════════════════════════════════════════════════════════════════

def test_the_projection_never_reaches_a_delivery_path():
    """⛔ Asserted from the SOURCE of all three modules, not promised in prose."""
    for name in ("position_risk.py", "position_risk_compare.py",
                 "position_risk_projection.py"):
        tree = ast.parse((_AT / name).read_text(encoding="utf-8"))
        imported = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                imported.append(node.module or "")
            elif isinstance(node, ast.Import):
                imported += [a.name for a in node.names]
        for mod in imported:
            assert "delivery" not in mod, f"{name} imports {mod}"
            assert "awareness.engine" not in mod, f"{name} imports {mod}"
        # CONTROL: the walk really read imports.
        assert imported, f"{name}: the import walk found nothing — the probe is broken"


def test_the_dark_sweep_is_actually_wired_to_a_tick():
    """⛔⛔ THE CALLER RAIL THE APPROVAL LINE ASKS FOR, IN THOSE WORDS: *a
    caller-rail proving the evaluator is reachable from the sweep and from
    nothing else.*

    `price-level` CP3 shipped for one commit with its evaluator called by
    NOTHING — built, tested, green and unreachable. Every other test in this file
    would have passed, because every other test calls the evaluator itself.
    """
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert main.count("_at_position_risk.register()") == 1, "registered exactly once"
    assert "_at_doc_arrival.register()" in main, "control: the scan can see a sibling"

    assert main.count('id="alert_taxonomy_position_risk_dark"') == 1, (
        "the dark comparison has no scheduler entry — nothing will call it on "
        "Monday, and the store will be empty next weekend")
    # ⛔ Scoped to THIS job's body. A repo-wide `count("run_dark_sweep()") == 1`
    # went red for the right reason and the wrong cause when event-proximity CP3
    # added a second sweep: a count is the wrong instrument when the population
    # is meant to grow.
    start = main.index("def _position_risk_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_position_risk_dark"', start)
    body = main[start:end]
    assert "run_dark_sweep()" in body, (
        "the position-risk scheduler entry exists but its job body does not call "
        "the sweep")
    assert 'os.environ.get("ALERT_TAXONOMY_POSITION_RISK_DARK_ENABLED", "0") == "1"' in main, (
        "the sweep is not flag-gated, or its default is not OFF — this reads real "
        "member positions, so an unset variable must mean nothing runs")


def test_the_sweep_job_body_never_reaches_a_delivery_path():
    """⛔ The scheduler entry is the one place a dark sweep could grow a delivery
    call without touching any audited module. Scoped to the job body, with a
    control proving the slice is not empty."""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    start = main.index("def _position_risk_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_position_risk_dark"', start)
    body = main[start:end]
    assert "run_dark_sweep" in body, "the slice is empty — this probe is broken"
    for banned in ("deliver", "send_email", "webhook", "add_insight("):
        assert banned not in body, f"the dark sweep job body mentions {banned!r}"


def test_NOTHING_IS_ARMED_the_flag_defaults_to_off():
    """⛔ Arming is the owner's flip. The default must be OFF in the source, so a
    pod that has never heard of this variable runs nothing."""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert '"ALERT_TAXONOMY_POSITION_RISK_DARK_ENABLED", "0"' in main, (
        "the default is not '0' — an unset variable would arm a dark run over "
        "real member positions")
