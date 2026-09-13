"""GATE-S7-SCAN-MEMBERSHIP-CHANGE Checkpoint 1 — registration + schema, and the
two findings the gate names, shipped as RAILS.

⛔ The type must be DARK BY CONSTRUCTION, not by intention: no delivery import,
no read of `scan_hits`, no call into `screen_alerts`, and nothing calling
`register()` yet. Each is asserted FROM THE SOURCE rather than promised.

⛔⛔ THE TWO FINDINGS, AND THEY ARE THE REASON THIS CHECKPOINT EXISTS:

  A. TWO CONSECUTIVE CYCLES ARE RETAINED BY THE ABSENCE OF A CALLER, NOT BY A
     POLICY. `scan_store.prune` has zero callers — measured here, every run,
     with a control proving the same search finds a real `.prune(` call
     elsewhere. Plus the behavioural half: two swept sessions give two entries,
     ONE swept session gives one and must read as `not_comparable`, and a prune
     that reaches the previous session is caught taking the diff's input away.

  B. THE PREVIOUS SESSION COMES FROM `scan_coverage`, NEVER `scan_hits`. A quiet
     night writes a coverage row and ZERO hits rows, so a hits-derived previous
     session reports every long-standing member as newly ENTERED. Demonstrated
     against the real store with a quiet session IN THE MIDDLE, including the
     counterfactual — the mass false alert is produced, not described.
"""
from __future__ import annotations

import ast
import contextlib
import pathlib
import re
import sqlite3

import pytest

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import registry as _registry
from api.services.alert_taxonomy import scan_membership_change as smc
from api.services.screener import scan_store
from api.services.screener import screen_alerts
from api.services.screener import snapshot_db

_REPO = pathlib.Path(__file__).resolve().parents[1]
_API = _REPO / "api"
_MODULE = _API / "services" / "alert_taxonomy" / "scan_membership_change.py"
_COMPARE = _API / "services" / "alert_taxonomy" / "scan_membership_change_compare.py"
_LEGACY = _API / "services" / "screener" / "screen_alerts.py"
_STORE = _API / "services" / "screener" / "scan_store.py"

H = "sha256:" + "a" * 64
TF = "D"


#: ⛔⛔ DOCUMENTATION IS NOT ALWAYS A DOCSTRING IN THIS PACKAGE. `PARAMS_SCHEMA`
#: and `BLIND_SPOTS` are prose that happens to be stored in string LITERALS, so a
#: docstring-only stripper leaves every word of them in the "code" it hands back
#: — and this module's schema DESCRIBES the legacy tables it must never touch.
#: Blanking these by name is the fix; `test_the_stripper_sees_code_and_not_prose`
#: proves it still sees real code.
#:
#: ⛔ `FORBIDDEN_SESSION_SOURCE` is on the list for the same reason and it is the
#: sharpest example: its whole job is to NAME `scan_hits` as the thing this type
#: must not read. A substring search that saw it would be answering a question
#: about the documentation, and would report the warning as the violation.
_PROSE_CONSTANTS = ("PARAMS_SCHEMA", "BLIND_SPOTS", "FORBIDDEN_SESSION_SOURCE",
                    "OUTCOME_GRAIN", "DRIFT_GRAIN", "CLOCK")


def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE. These modules discuss delivery, `scan_hits` and the
    legacy functions at length — a naive substring search matches their own
    explanation and every assertion below would be red on the documentation."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in _PROSE_CONSTANTS for t in node.targets):
            node.value = ast.Constant(value="<prose>")
    return ast.unparse(ast.fix_missing_locations(tree))


def _module_constants(path: pathlib.Path) -> dict:
    """Every module-level `NAME = <literal>` in the file, from the AST."""
    out = {}
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    with contextlib.suppress(ValueError, TypeError, SyntaxError):
                        out[t.id] = ast.literal_eval(node.value)
    return out


def _ddl_table(ddl: str, table: str) -> str:
    m = re.search(r"CREATE TABLE IF NOT EXISTS\s+%s\s*\((.*?)\n\)\s*;" % re.escape(table),
                  ddl, re.S)
    assert m is not None, f"no CREATE TABLE for {table} in the DDL the module owns"
    return m.group(1)


def _ddl_columns(block: str) -> tuple:
    """`([(name, type), ...], (pk cols,))` for one CREATE TABLE body."""
    cols, pk = [], None
    for raw in block.split("\n"):
        line = raw.split("--", 1)[0].strip().rstrip(",")
        if not line:
            continue
        if line.upper().startswith("PRIMARY KEY"):
            pk = tuple(c.strip() for c in line[line.index("(") + 1:line.rindex(")")].split(","))
            continue
        if line.upper().startswith(("CREATE ", "FOREIGN KEY", "UNIQUE(")):
            continue
        parts = line.split()
        cols.append((parts[0], " ".join(parts[1:])))
    return cols, pk


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, PROVED to be the one in use.

    ⛔ `C:\\data` exists on this box and the screener's default path resolves into
    it. `snapshot_db.get_db_path()` reads `SCREENER_DB_PATH` on every call, but
    that is a property of the module and not a promise, so it is asserted here
    before anything writes. `_INITED` is cleared because it is keyed by path and
    a previous test's entry must not answer for this one.
    """
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    monkeypatch.setattr(screen_alerts, "_done", set())
    assert snapshot_db.get_db_path() == str(path), (
        "SCREENER_DB_PATH did not reach snapshot_db — a module-level capture has "
        "appeared and this whole file is writing somewhere else")
    scan_store.init_db()
    assert path.exists()
    return path


def _sweep(as_of: int, tickers, *, universe: int = 100, def_hash: str = H) -> None:
    """One swept session: a coverage receipt ALWAYS, hits only if it matched.

    ⭐ That asymmetry IS finding B. A quiet session writes the receipt and zero
    hits rows, which is exactly what a hits-derived reader cannot see.
    """
    scan_store.record_hits(def_hash, TF, as_of, tickers)
    scan_store.record_coverage(def_hash, TF, as_of, evaluated=universe,
                               answered=universe, dropped=0, not_computable=0,
                               dropped_symbols=[])


# ═══ the control ════════════════════════════════════════════════════════════

def test_the_stripper_sees_code_and_not_prose():
    """⛔ THE CONTROL FOR EVERY ABSENCE ASSERTION BELOW. Without it, a stripper
    that returned '' would make all of them pass over nothing."""
    code = _code_only(_MODULE)
    raw = _MODULE.read_text(encoding="utf-8")
    # (a) the needles ARE in the prose
    assert "deliver_alert_payload" in raw
    assert "scan_hits" in raw
    assert "screen_alerts" in raw
    # (b) and NONE of them is in the code
    assert "deliver_alert_payload" not in code
    assert "scan_hits" not in code
    assert "screen_alerts" not in code
    # (c) and the stripper still sees real code. ⛔ Named against what CP1
    # SHIPS — `register` and the type id — never against a later checkpoint's
    # symbol: a control that asserts something this checkpoint does not have is
    # a control that cannot run.
    assert "def register" in code
    assert ("TYPE_ID = 'scan-membership-change'" in code
            or 'TYPE_ID = "scan-membership-change"' in code)
    assert "register_trigger_type" in code
    assert len(code) > 500


# ═══ the type ═══════════════════════════════════════════════════════════════

def test_the_type_id_is_the_spec_s_id():
    assert smc.TYPE_ID == "scan-membership-change"


def test_registration_round_trips_the_schema(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    smc.register(db_path=p)
    types = {t["type_id"]: t for t in _registry.list_trigger_types(db_path=p)}
    assert "scan-membership-change" in types
    assert types["scan-membership-change"]["module"] == \
        "api.services.alert_taxonomy.scan_membership_change"
    assert types["scan-membership-change"]["params_schema"] == smc.PARAMS_SCHEMA


def test_register_is_idempotent(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    smc.register(db_path=p)
    smc.register(db_path=p)
    rows = [t for t in _registry.list_trigger_types(db_path=p)
            if t["type_id"] == "scan-membership-change"]
    assert len(rows) == 1, "a second boot must upsert, never duplicate"


# ═══ the legacy shapes — DERIVED, never typed ═══════════════════════════════

def test_the_legacy_shapes_are_DERIVED_BY_AST_from_the_DDL_that_owns_them():
    """⛔ THE GATE PACKET'S PROSE IS NOT THE AUTHORITY — the DDL is.

    Read out of `screen_alerts._SCHEMA` by parsing the module. If a column moves,
    this goes red and the module docstring's record must move with it, rather
    than the two quietly diverging (the 54-vs-137 scalar drift).
    """
    ddl = _module_constants(_LEGACY)["_SCHEMA"]

    subs_cols, subs_pk = _ddl_columns(_ddl_table(ddl, "screen_alert_subs"))
    assert [c for c, _t in subs_cols] == [
        "user_id", "def_hash", "def_id", "name", "mode", "created_at"]
    assert subs_pk == ("user_id", "def_hash")

    fired_cols, fired_pk = _ddl_columns(_ddl_table(ddl, "screen_alerts_fired"))
    assert [c for c, _t in fired_cols] == [
        "user_id", "def_hash", "as_of", "fired_at", "entered", "exited"]
    assert fired_pk == ("user_id", "def_hash", "as_of")

    # NON-VACUITY CONTROL — the derivation really read a DDL, not an empty string.
    assert "CREATE TABLE" in ddl and len(subs_cols) == 6 and len(fired_cols) == 6


def test_the_module_docstring_RECORDS_those_shapes_and_the_narrowing():
    """⛔ REPORTED BEFORE THE SCHEMA IS PINNED — the packet's own instruction.
    The record lives in the docstring; this asserts it is actually there, because
    a finding nobody wrote down is a finding that has to be made again."""
    doc = smc.__doc__ or ""
    for column in ("user_id", "def_hash", "def_id", "mode", "created_at",
                   "as_of", "fired_at", "entered", "exited"):
        assert column in doc, f"the legacy column {column} is not recorded"
    assert "PRIMARY KEY (user_id, def_hash)" in doc
    assert "PRIMARY KEY (user_id, def_hash, as_of)" in doc
    assert "INSERT OR REPLACE" in doc, (
        "the (user_id, def_hash) narrowing is recorded without saying WHY it is "
        "silent — `subscribe` is INSERT OR REPLACE and that is the whole point")


def test_the_direction_vocabulary_maps_onto_the_legacy_MODES_derived_from_source():
    """⛔ NOT A SECOND COPY OF A GUESS. `LEGACY_MODES` is compared against
    `screen_alerts.MODES` as the module actually declares it."""
    assert set(smc.DIRECTIONS) == {"entered", "left", "either"}
    assert smc.LEGACY_MODES == _module_constants(_LEGACY)["MODES"]
    assert smc.LEGACY_MODES == screen_alerts.MODES
    assert set(smc.MODE_BY_DIRECTION) == set(smc.DIRECTIONS)
    assert set(smc.MODE_BY_DIRECTION.values()) == set(smc.LEGACY_MODES)
    # and the mapping round-trips both ways — a one-way table is how a flip
    # loses a member's `exit`-only subscription.
    for d in smc.DIRECTIONS:
        assert smc.DIRECTION_BY_MODE[smc.MODE_BY_DIRECTION[d]] == d


def test_the_delivery_shaping_constants_are_pinned_as_FACTS_not_as_parameters():
    """⛔ A per-run cap is a DELIVERY policy and belongs to `delivery.py`'s own
    approval line. They are recorded so the flip cannot lose them, and are
    deliberately ABSENT from PARAMS_SCHEMA."""
    consts = _module_constants(_LEGACY)
    assert smc.LEGACY_MAX_NAMED == consts["MAX_NAMED"] == screen_alerts.MAX_NAMED
    assert smc.LEGACY_MAX_PER_USER == consts["MAX_PER_USER"] == screen_alerts.MAX_PER_USER
    assert "max_named" not in smc.PARAMS_SCHEMA
    assert "max_per_user" not in smc.PARAMS_SCHEMA


def test_the_timeframe_is_a_FIELD_even_though_the_legacy_takes_one_value():
    """Pinned as a field because it is the shape a later type will want to
    change, and a value that is only ever one thing is the one nobody notices
    becoming two."""
    assert smc.LEGACY_TIMEFRAME == scan_store.SCAN_JOIN_TF == "D"
    assert "timeframe" in smc.PARAMS_SCHEMA


def test_the_params_schema_is_exactly_the_four_CP1_fields():
    assert set(smc.PARAMS_SCHEMA) == {
        "definition_id", "direction", "timeframe", "dedup_grain"}


def test_the_dedup_grain_is_the_legacy_tables_primary_key():
    """One alert per member per definition per SESSION, however many names
    moved. Pinned as a field because changing it silently multiplies — or
    silences — what a member receives."""
    assert smc.DEDUP_GRAIN == "user_definition_session"
    ddl = _module_constants(_LEGACY)["_SCHEMA"]
    _cols, pk = _ddl_columns(_ddl_table(ddl, "screen_alerts_fired"))
    assert pk == ("user_id", "def_hash", "as_of"), (
        "the grain name claims a (member, definition, session) key and the DDL "
        "no longer has one")


def test_the_definition_id_schema_NAMES_the_narrowing_it_inherits():
    text = smc.PARAMS_SCHEMA["definition_id"]
    assert "def_hash" in text
    assert "(user_id, def_hash)" in text
    assert "INSERT OR REPLACE" in text


# ═══ FINDING B — coverage, never hits ═══════════════════════════════════════

def test_the_previous_session_source_is_a_CONSTANT_and_not_a_parameter():
    """⛔ Making it configurable would invite exactly the value that is wrong."""
    assert smc.PREVIOUS_SESSION_SOURCE == "scan_coverage"
    assert smc.FORBIDDEN_SESSION_SOURCE == "scan_hits"
    assert "previous_session_source" not in smc.PARAMS_SCHEMA


def test_recent_covered_as_ofs_reads_scan_coverage_and_the_store_says_so():
    """The accessor this type depends on names its own contract in code, not
    only in prose: its SQL selects FROM scan_coverage."""
    code = _code_only(_STORE)
    block = code.split("def recent_covered_as_ofs", 1)[1].split("\ndef ", 1)[0]
    assert "FROM scan_coverage" in block
    assert "scan_hits" not in block


def test_a_QUIET_SESSION_IN_THE_MIDDLE_is_the_previous_session(store):
    """⛔⛔ FINDING B, DEMONSTRATED AGAINST THE REAL STORE.

    Three swept sessions. The middle one matched NOTHING — a coverage row and
    zero hits rows, which is an ordinary quiet night. The screen's membership has
    not changed at all across the three.

    The coverage-derived previous session is the quiet one, and the diff is
    empty. A hits-derived previous session skips it, lands on the busy night two
    sessions back, and — here, measured — would report the whole screen as newly
    ENTERED. That is the mass false alert.
    """
    members = ["AAPL", "MSFT", "NVDA"]
    _sweep(20260908, members)            # busy
    _sweep(20260909, [])                 # ⛔ QUIET: coverage row, zero hits rows
    _sweep(20260910, members)            # busy again, SAME membership

    covered = scan_store.recent_covered_as_ofs(H, TF, limit=2)
    assert covered == [20260910, 20260909], (
        "the quiet session must be the previous one — it was SWEPT")

    hits_map = {s: scan_store.hits(H, TF, s) for s in covered}
    d = smc.diff(covered, hits_map)
    assert d["prev_as_of"] == 20260909
    assert d["entered"] == ["AAPL", "MSFT", "NVDA"], (
        "against the quiet night these three genuinely did re-enter — the point "
        "of the next assertion is that the LEGACY says so too, and that a "
        "hits-derived previous session would say it against the WRONG night")

    # ⛔ THE COUNTERFACTUAL, BUILT HERE SO THE FAILURE IS PRODUCED AND NOT
    # DESCRIBED: a "previous session that has hits" skips 09-09 entirely.
    with contextlib.closing(sqlite3.connect(str(store))) as c:
        hits_derived = [r[0] for r in c.execute(
            "SELECT DISTINCT as_of FROM scan_hits WHERE def_hash=? AND tf=? "
            "ORDER BY as_of DESC LIMIT 2", (H, TF))]
    assert hits_derived == [20260910, 20260908], (
        "control: a hits-derived reader really does skip the quiet session")
    assert hits_derived != covered, (
        "the two derivations must DISAGREE here or this fixture proves nothing")


def test_a_TRULY_UNCHANGED_screen_across_a_quiet_night_alerts_NOTHING(store):
    """⛔ THE OTHER HALF, AND IT IS THE ONE A MEMBER FEELS. When the quiet night
    is the one being diffed AGAINST and nothing actually moved, the answer is
    silence — and the hits-derived counterfactual is a three-name false alert.
    """
    members = ["AAPL", "MSFT", "NVDA"]
    _sweep(20260908, members)
    _sweep(20260909, members)            # swept, same membership
    _sweep(20260910, members)

    covered = scan_store.recent_covered_as_ofs(H, TF, limit=2)
    hits_map = {s: scan_store.hits(H, TF, s) for s in covered}
    got = smc.would_fire({"definition_id": H, "direction": "either", "timeframe": TF},
                         covered_sessions=covered, hits_by_as_of=hits_map)
    assert got["fires"] is False
    assert got["reason"] == smc.REASON_QUIET
    assert got["named"] == []


def test_the_evaluator_REFUSES_a_session_declared_swept_but_absent_from_the_hit_map():
    """⛔ FINDING B's STRUCTURAL HALF. A caller who assembled the hit map out of
    `scan_hits` alone drops the quiet session's key. Treating a missing key as
    "no hits" would give that caller the right answer by accident and let the
    habit survive; refusing it makes the omission LOUD."""
    got = smc.would_fire(
        {"definition_id": H, "direction": "either", "timeframe": TF},
        covered_sessions=[20260910, 20260909],
        hits_by_as_of={20260910: ["AAPL"]})       # 09-09 not declared at all
    assert got["fires"] is False
    assert got["reason"] == smc.REASON_UNDECLARED_SESSION
    assert got["undeclared"] == [20260909]

    # ...and a DECLARED empty session is a real, comparable answer.
    ok = smc.would_fire(
        {"definition_id": H, "direction": "either", "timeframe": TF},
        covered_sessions=[20260910, 20260909],
        hits_by_as_of={20260910: ["AAPL"], 20260909: []})
    assert ok["fires"] is True and ok["entered"] == ["AAPL"]


# ═══ FINDING A — the retention rail, and its one-session control ════════════

def test_scan_store_prune_has_ZERO_CALLERS_and_the_search_CAN_SEE_ONE():
    """⛔⛔ FINDING A, RE-MEASURED EVERY RUN.

    Two consecutive cycles are retained by the ABSENCE of a caller, not by a
    policy. The day `prune` acquires one whose horizon can reach the previous
    session, `diff_for` returns `(None, [], [])` silently and members stop being
    told. This rail goes red the moment that caller appears, so somebody has to
    reason about the horizon rather than discover it from a support ticket.

    ⛔ CODE, NEVER PROSE, and the absence claim CARRIES ITS CONTROL: the same
    search finds real `.prune(` call sites elsewhere, so it could have seen one
    here.
    """
    parsed, unparsable = 0, []
    scan_store_prune, dot_prune = [], []
    for p in sorted(_API.rglob("*.py")):
        try:
            code = _code_only(p)
        except SyntaxError as exc:  # noqa: PERF203
            unparsable.append((str(p), str(exc)))
            continue
        parsed += 1
        rel = str(p.relative_to(_REPO)).replace("\\", "/")
        for i, line in enumerate(code.splitlines(), 1):
            if "scan_store.prune" in line:
                scan_store_prune.append((rel, i, line.strip()))
            if ".prune(" in line:
                dot_prune.append((rel, i, line.strip()))

    # NON-VACUITY: the walk really reached the tree and really parsed it.
    assert parsed > 1000, f"the module walk found almost nothing ({parsed} files)"
    assert not unparsable, f"unparsable modules make the absence claim hollow: {unparsable}"

    # ⛔ THE CONTROL — the searcher can see a `.prune(` call.
    assert len(dot_prune) >= 3, (
        "the search found fewer than the three known `.prune(` call sites — it "
        f"is broken, not green. Saw: {dot_prune}")
    assert all("scan_store" not in rel for rel, _i, _l in dot_prune)

    # ...and it sees NONE for this one.
    assert scan_store_prune == [], (
        "`scan_store.prune` has acquired a caller. That is not automatically "
        "wrong — but the diff's previous session can now VANISH, and "
        "`diff_for` reports that as `no_previous` with no error. Establish that "
        "the horizon cannot reach session N-1 before updating this rail: "
        f"{scan_store_prune}")


def test_two_swept_sessions_give_TWO_and_one_gives_ONE(store):
    """⛔ FINDING A's BEHAVIOURAL HALF, with the control that makes it mean
    something: `no_previous` must stay DISTINGUISHABLE from `quiet`."""
    _sweep(20260909, ["AAPL"])
    assert scan_store.recent_covered_as_ofs(H, TF, limit=2) == [20260909]

    only_one = smc.would_fire(
        {"definition_id": H, "direction": "either", "timeframe": TF},
        covered_sessions=scan_store.recent_covered_as_ofs(H, TF, limit=2),
        hits_by_as_of={20260909: ["AAPL"]})
    assert only_one["fires"] is False
    assert only_one["reason"] == smc.REASON_NO_PREVIOUS, (
        "a store holding ONE session must report not_comparable, never a silent "
        "empty that reads like a quiet market")
    assert only_one["reason"] in smc.NOT_COMPARABLE_REASONS
    assert smc.REASON_NO_PREVIOUS != smc.REASON_QUIET

    _sweep(20260910, ["AAPL", "MSFT"])
    assert scan_store.recent_covered_as_ofs(H, TF, limit=2) == [20260910, 20260909]


def test_a_PRUNE_that_reaches_the_previous_session_takes_the_diff_away(store):
    """⛔⛔ THE HAZARD, EXECUTED. Not "a prune could remove it" — a prune DOES,
    here, and both the legacy `diff_for` and this type's evaluator are watched
    losing the comparison.

    ⭐ And the direction matters: the legacy answers `(None, [], [])`, which
    `run_nightly` counts as `no_previous` and NOTHING is sent. A member simply
    stops being told, with no error anywhere.
    """
    _sweep(20260909, ["AAPL"])
    _sweep(20260910, ["AAPL", "MSFT"])

    before = screen_alerts.diff_for(H, TF)
    assert before[0] == 20260910 and before[1] == ["MSFT"], (
        "control: before the prune there IS a comparison, and it finds MSFT")

    removed = scan_store.prune(20260910)          # strictly before 09-10
    assert removed["coverage"] >= 1 and removed["hits"] >= 1, (
        "control: the prune actually removed something")

    after = screen_alerts.diff_for(H, TF)
    assert after == (None, [], []), (
        "the legacy's silent-in-the-flattering-direction answer, reproduced")

    covered = scan_store.recent_covered_as_ofs(H, TF, limit=2)
    assert covered == [20260910]
    got = smc.would_fire({"definition_id": H, "direction": "either", "timeframe": TF},
                         covered_sessions=covered,
                         hits_by_as_of={20260910: ["AAPL", "MSFT"]})
    assert got["reason"] == smc.REASON_NO_PREVIOUS, (
        "this type must call the vanished window what it is — not quiet")


def test_the_module_records_the_prune_measurement_and_its_control():
    """A finding nobody wrote down is a finding that has to be made again.

    ⚠️ THE COUNT ITSELF IS NOT PINNED HERE, deliberately. A file added to `api/`
    tomorrow moves it, and a hand-typed count asserted beside the thing it
    describes is the drift this repo keeps re-committing. What is pinned is that
    the docstring reports a SIZED census with a CONTROL — the test above
    re-measures the census itself every run.
    """
    doc = smc.__doc__ or ""
    assert "ZERO callers" in doc
    assert "CONTROL" in doc
    assert "files parsed" in doc and "unparsable" in doc, (
        "the docstring reports an absence without its census size — an unsized "
        "absence claim cannot be re-checked")


# ═══ dark by construction ═══════════════════════════════════════════════════

def test_the_type_module_imports_NO_delivery():
    code = _code_only(_MODULE)
    for forbidden in ("deliver_alert_payload", "watchlist_alert_service",
                      "send_email", "discord"):
        assert forbidden not in code, f"{forbidden} reached the type module's CODE"


def test_the_type_module_never_reads_the_screener_store():
    """⛔ CP1's explicit boundary: no read of `scan_hits`, no scheduler entry,
    and no import of the module that owns the legacy tables."""
    code = _code_only(_MODULE)
    for forbidden in ("scan_hits", "scan_store", "snapshot_db", "screen_alerts",
                      "screen_alert_subs", "screen_alerts_fired"):
        assert forbidden not in code, f"{forbidden} reached the type module's CODE"


def test_CP1_does_not_edit_scan_store_because_flow_worker_runs_it():
    """⛔ GATE §6 — `scan_store.py` is an INERT STRAND: flow-worker RUNS it and
    will not redeploy for a change to it, so an edit there leaves flow-worker on
    the old copy with every test green. The retention guarantee is asserted from
    `tests/`, which flow-worker does not run.

    Read from git rather than from `git status`: provenance is
    `git show <sha>:<file>`, never the working tree.
    """
    import subprocess
    top = subprocess.run(["git", "-C", str(_REPO), "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True, check=True).stdout.strip()
    legacy_paths = ["api/services/screener/scan_store.py",
                    "api/services/screener/screen_alerts.py"]

    # ⛔ NON-VACUITY, AND IT MUST NOT DEPEND ON THIS BRANCH HAVING CHANGES —
    # after a merge the diff is legitimately empty and a "the diff is empty ⇒
    # broken" control would go red on master forever. Instead: prove git answers
    # and that the two paths are things it can actually name.
    tracked = subprocess.run(["git", "-C", top, "ls-files", *legacy_paths],
                             capture_output=True, text=True, check=True).stdout.split()
    assert sorted(tracked) == sorted(legacy_paths), (
        f"git did not resolve the legacy paths — the check is broken, not green: {tracked}")

    base = subprocess.run(["git", "-C", top, "merge-base", "HEAD", "origin/master"],
                          capture_output=True, text=True, check=True).stdout.strip()
    assert base, "could not resolve the merge-base — the check is broken, not green"
    changed = subprocess.run(
        ["git", "-C", top, "diff", "--name-only", f"{base}..HEAD"],
        capture_output=True, text=True, check=True).stdout.split()
    for path in legacy_paths:
        assert path not in changed, (
            f"this branch edited {path}. `scan_store.py` is an INERT STRAND "
            "(flow-worker runs it and will not redeploy) and `screen_alerts.py` "
            "is the incumbent the absorption default leaves untouched.")


def test_there_is_no_replay_fn_and_the_module_says_why():
    code = _code_only(_MODULE)
    assert "replay_fn" not in code
    raw = _MODULE.read_text(encoding="utf-8")
    assert "FORWARD-ONLY" in raw


def test_nothing_calls_register_yet_and_that_is_the_checkpoint_boundary():
    """⛔ REGISTRATION IS NOT ACTIVATION. §2a item 3's warning, applied: CP1-CP2
    add no scheduler entry and no flag."""
    main = _code_only(_REPO / "api" / "main.py")
    assert "scan_membership_change" not in main, (
        "api/main.py wires scan-membership-change — that is CP3 and needs a new "
        "approval line")


def test_neither_module_reads_an_env_var_or_registers_a_job():
    """⛔ Read env at CALL TIME, never bind a flag to a module constant — and at
    CP1-CP2 this type reads NO env var at all, because it has no gate of its own
    and the legacy rule it mirrors is not configured by one."""
    for path in (_MODULE, _COMPARE):
        code = _code_only(path)
        assert "add_job" not in code
        assert "CronTrigger" not in code
        assert "os.environ" not in code and "getenv" not in code, (
            f"{path.name} reads an env var — this type has none of its own, and "
            "a module-level capture is how a mirror rots")
        assert "ENABLED" not in code, (
            f"{path.name} reads an _ENABLED flag — CP1-CP2 have no gate")
