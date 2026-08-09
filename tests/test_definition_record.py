"""The rule record — member-independent, append-only, and structurally unable to
become the notification ledger it exists to replace.

🔴 THE ONE SENTENCE THIS FILE IS ABOUT
--------------------------------------
**The signal ledger counts notifications, and a notification count is not a rule
performance number.** Eleven conditions produce a right rule and an empty ledger;
five of them are member behaviour — `active=0`, snoozed, a level condition inside
one armed episode, a user-authored `ast` fire refused first in every mode, and
the entire first cycle after a `compute.rev` migration. So ledger row count is a
LOWER BOUND BIASED BY WHO ARMED AND WHO SNOOZED, and publishing it as accuracy is
spec §1.6's *"unmeasured accuracy claims"* trap reached by ARITHMETIC rather than
by intent.

⭐ SO THE DIFFERENCE BETWEEN THE TWO STORES IS **MEASURED HERE, NOT DESCRIBED.**
Five of the sections below drive a REAL alert through a REAL `_run_one_cycle` in
one of those five states, prove the rule really was right (the fire is asserted
to exist before it is asserted to be invisible), then assert:

    the ledger is EMPTY · the record HAS the evaluation

and the two stores are the two tables of ONE database file, so nobody can
attribute the difference to a fixture.

🔴 AND THE HEADLINE GATE IS AN EQUALITY, NOT AN ABSENCE. `test_the_record_is
_IDENTICAL_across_nobody_snoozed_and_armed` drives all three member states for
real, in three separate databases, and requires the record bytes to be the same
in all three while the LEDGER differs across them. An equality nothing could
break is no gate, which is why the ledger's disagreement is asserted in the same
test: if the three worlds were secretly identical, the record's sameness would be
a measurement of nothing.
"""

from __future__ import annotations

import ast
import hashlib
import os
import pathlib
import sqlite3
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:                                   # pragma: no cover
    sys.path.insert(0, str(_ROOT))

import api.services.alerts as _alerts_mod                        # noqa: E402
from api.services import alert_fired_log as fl                   # noqa: E402
from api.services import alert_rev_migration as rev              # noqa: E402
from api.services import ast_interpret                           # noqa: E402
from api.services import definition_record as dr                 # noqa: E402
from api.services import indicator_alert_evaluator as ev         # noqa: E402
from api.services import indicator_alert_service as ias          # noqa: E402
from api.services import user_definitions as ud                  # noqa: E402
from api.services import watchlist_alert_service as wls          # noqa: E402
from api.services.signature import ledger                        # noqa: E402


# ═══════════════════════════════════════════════════════════════════════════
# fixtures + the things every section reads
# ═══════════════════════════════════════════════════════════════════════════

#: 80 rising 5m bars, every one long closed by any wall clock — the same shape
#: `test_alert_ledger_admission.py` uses, so the alert lane behaves here exactly
#: as it does there and no assertion below depends on a bar fixture of its own.
_BARS = [{"t": 1_700_000_000 + i * 300, "o": 100.0 + i, "h": 100.6 + i,
          "l": 99.4 + i, "c": 100.0 + i, "v": 100_000} for i in range(80)]

_SYM = "TEST"
_TF = "5m"          # the PRODUCT label the record keys on
_BARS_TF = "5"      # the bars-store code the alert lane carries
_REV = 1
_AT = 1_700_100_000.0   # a fixed moment of record, so two runs are comparable

#: `close > sma(close, 5)` — legal in the closed table today (CORRECTION 1's
#: worked example), and a CONDITION, so `!= 0` is the scan semantics verbatim.
_TREE = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "close"},
    {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"},
        {"type": "num", "value": 5}]}]}

#: The same rule with ONE number changed — an EDIT, and therefore a new record.
_TREE_EDITED = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "close"},
    {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"},
        {"type": "num", "value": 6}]}]}

_USER_DEF_ID = "u_1234567890ab"
_USER_ADDRESS = f"{_USER_DEF_ID}.value"


def _user_definition() -> dict:
    """A schema-v1 `ast`-kind definition — arithmetic an ACCOUNT wrote."""
    return {
        "schemaVersion": 1, "id": _USER_DEF_ID, "version": 1,
        "meta": {"name": "My Average", "shortName": "MA"},
        "compute": {"kind": "ast", "ast": {
            "type": "call", "name": "sma", "args": [
                {"type": "series", "name": "close"},
                {"type": "num", "value": 5},
            ]}},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def _def_hash() -> str:
    return ud.ast_hash(_TREE)


def _record_rows(path) -> list[tuple]:
    """Every column of every record row, ordered — read straight off the FILE.

    ⛔ Bypasses the module on purpose. A reader that went through
    `definition_record` would be measuring the module's opinion of its own store,
    which is exactly the thing under test.
    """
    if not pathlib.Path(path).exists():
        return []
    with sqlite3.connect(str(path)) as c:
        try:
            return [tuple(r) for r in c.execute(
                f"SELECT id, def_hash, rev, tf, sym, first_bar_time,"
                f" through_bar_time, bars_evaluated, bars_true, recorded_at"
                f" FROM {dr.TABLE_NAME} ORDER BY id")]
        except sqlite3.OperationalError:
            return []


def _record_digest(path) -> str:
    """A single hash of the whole record, so "identical" is one comparison."""
    return hashlib.sha256(repr(_record_rows(path)).encode("utf-8")).hexdigest()


def _ledger_rows(path) -> int:
    if not pathlib.Path(path).exists():
        return 0
    with sqlite3.connect(str(path)) as c:
        try:
            return c.execute("SELECT COUNT(*) FROM signature_signals").fetchone()[0]
        except sqlite3.OperationalError:
            return 0


@pytest.fixture
def store(tmp_path, monkeypatch):
    """One database file holding BOTH tables, isolated from everything real.

    ⚠️ `definition_record` HAS NO `_DB_PATH` OF ITS OWN — it resolves through
    `ledger._DB_PATH` at call time — so moving the ledger's attribute moves this
    store too, and there is no second setting for the two to disagree about. The
    env var is set as well because `ledger._DB_PATH` is captured at IMPORT and a
    later re-import would otherwise read `/data`.

    `dr._INITED` is a set of PATHS, so a stale entry from another test cannot
    make this database be read with no tables in it; it is cleared anyway,
    because a fixture that relies on the implementation being clever is a fixture
    that stops working when it stops being clever.
    """
    p = tmp_path / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_INITED", False)
    monkeypatch.setattr(dr, "_INITED", set())
    return p


@pytest.fixture
def cycle_env(tmp_path, monkeypatch, store):
    """A real alerts store + a real ledger + the record, and stubbed transports.

    ⛔ THE SPY SITS AT THE TRANSPORT (`wls.add_alert`), NOT AT
    `deliver_alert_payload` — the claim/release lease and the fire-once gate live
    INSIDE that function, so a spy replacing it would replace the gate and every
    count below would be measuring the stub.
    """
    auth = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(auth))
    monkeypatch.setattr(ias, "_DB_PATH", str(auth))
    ias.init_schema()
    rev.init_schema()

    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _BARS])
    delivered: list = []
    monkeypatch.setattr(wls, "add_alert", lambda *a, **k: delivered.append(k))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    monkeypatch.setattr(_alerts_mod, "_fire_discord", lambda payload: None)
    return {"ledger": store, "auth": auth, "delivered": delivered}


def _the_shipped_lane_is_closed():
    assert ev.eval_mode() == "closed", (
        "the shipped lane is {!r}, so no fire in this file is ledger-grade and "
        "every 'the ledger is empty' assertion below would be vacuous for the "
        "wrong reason".format(ev.eval_mode()))


def _would_have_fired(aid) -> tuple:
    """The control every blind-spot case needs: the rule really IS right here.

    ⛔ WITHOUT THIS, "the ledger is empty" is satisfied by an alert that simply
    never fired, and all five sections below would pass on a broken evaluator.
    """
    row = ias.get(aid)
    value, triggered, idx = ev._evaluate_for_cycle(row, [dict(b) for b in _BARS])
    assert triggered is True and value is not None and idx is not None, (
        f"the alert did not fire ({value}, {triggered}, {idx}) — there is no "
        f"blind spot to measure")
    return value, triggered, idx


def _the_record_says(store_path) -> dict:
    """Drive the member-independent pass and return the claim it supports."""
    out = dr.record_pass(_REV, _TF, _SYM, ast=_TREE,
                         bars=[dict(b) for b in _BARS], at=_AT)
    assert out["recorded"] is True, out
    claim = dr.claim_for(out["def_hash"], _REV, _TF,
                         first_bar_time=out["first_bar_time"],
                         through_bar_time=out["through_bar_time"])
    return {"pass": out, "claim": claim,
            "rows": _record_rows(store_path)}


# ═══════════════════════════════════════════════════════════════════════════
# 0. ISOLATION, PROVEN AGAINST THE ARTIFACT AND NOT AGAINST THE ENV VAR
# ═══════════════════════════════════════════════════════════════════════════

def _declared_default_ledger_path() -> str:
    """`ledger.py`'s own default, READ OUT OF THE SOURCE rather than typed.

    ⛔ `lesson_probe_names_must_be_derived_not_typed`. A typed `"/data/…"` here
    would keep passing after the default moved, and the file it was protecting
    would be the one getting written.
    """
    tree = ast.parse((_ROOT / "api" / "services" / "signature"
                      / "ledger.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "_DB_PATH"
                        for t in node.targets)
                and isinstance(node.value, ast.Call)
                and len(node.value.args) == 2
                and isinstance(node.value.args[1], ast.Constant)):
            return str(node.value.args[1].value)
    raise AssertionError("ledger._DB_PATH is no longer a two-arg os.environ.get")


def _artifact_state(path: str):
    """(size, mtime, table names) or None — the FILE, not a setting about it."""
    p = pathlib.Path(path)
    if not p.exists():
        return None
    st = p.stat()
    with sqlite3.connect(str(p)) as c:
        names = sorted(r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"))
    return (st.st_size, st.st_mtime, names)


def test_the_record_NEVER_TOUCHES_the_real_ledger_file_and_the_ARTIFACT_says_so(store):
    """🔴 `C:\\data` EXISTS ON THIS BOX AND IS NOT PRODUCTION.

    A new store on this machine is exactly how `C:\\data\\signal_ledger.db` gets
    created by a test run, and an append-only store has no rewrite path — a test
    row in it is a test row forever. So this asserts the ARTIFACT: the
    unisolated file's size, mtime and table list are unchanged across a full
    drive of every write path in the module, and the file is not created if it
    was absent.

    ⛔ NOT `assert os.environ["SIGNAL_LEDGER_DB_PATH"] == …`. That is the gate
    that cannot fail: the env var is what the fixture just set, and
    `ledger._DB_PATH` is captured at import so the env var alone reaches nothing.
    """
    unisolated = os.path.abspath(_declared_default_ledger_path())
    assert os.path.abspath(str(store)) != unisolated, "the fixture isolated nothing"
    before = _artifact_state(unisolated)

    out = dr.record_pass(_REV, _TF, _SYM, ast=_TREE,
                         bars=[dict(b) for b in _BARS], at=_AT)
    dr.claim_for(out["def_hash"], _REV, _TF, first_bar_time=out["first_bar_time"],
                 through_bar_time=out["through_bar_time"])
    dr.prune(1, now=_AT)
    dr.horizon()

    assert _record_rows(store), "nothing was written anywhere — the probe is vacuous"
    assert _artifact_state(unisolated) == before, (
        f"{unisolated} moved during this test")


def test_this_module_CAPTURES_NO_DATABASE_PATH_at_import(store):
    """⛔ THE `AUTH_DB_PATH` CLASS OF DEFECT, REFUSED BY CONSTRUCTION.

    Six product modules resolve a database path ONCE at import, so a fixture's
    `setenv` reaches nothing in them and the repo carries a session-scoped
    repair for it. This module has no such attribute at all: `db_path()` reads
    `ledger._DB_PATH` at CALL time, so there is nothing here to go stale and
    nothing for a second setting to disagree with.

    Derived by VALUE over the module's own namespace, the same way
    `tests/conftest.py::_captured_auth_db_holders` does it — a seventh way of
    spelling a path is caught for free.
    """
    holders = [name for name, val in vars(dr).items()
               if isinstance(val, str) and val.endswith(".db")]
    assert holders == [], (
        f"{holders} is a database path captured at import; move it behind a "
        f"function or this module will write to /data the moment it is imported "
        f"before a fixture runs")
    assert dr.db_path() == ledger._DB_PATH, (
        "the record and the ledger resolved to two different files — a receipt "
        "in a second file can outlive the writes it certifies")


#: Every symbol this store takes ON CONTRACT from a module it does not own, with
#: the shape it relies on. ⛔ E6 IS INDEPENDENT OF E1–E5 AND THIS TABLE IS THE
#: PROOF: there is no `scan_evaluator`, no `scan_store` and no `scan_definition`
#: here, because those are E2's and E3's deliverables and neither exists in the
#: tree. Everything below is shipped code, today.
_CONTRACT = [
    ("api.services.signature.ledger", "_DB_PATH", str),
    ("api.services.signature.ledger", "_PRODUCT_TIMEFRAMES", frozenset),
    ("api.services.signature.ledger", "_BARS_STORE_TF_KEYS", dict),
    ("api.services.signature.ledger", "_normalize_bar_time", "callable"),
    ("api.services.user_definitions", "ast_hash", "callable"),
    ("api.services.ast_interpret", "interpret", "callable"),
    ("api.services.ast_interpret", "max_lookback", "callable"),
]


@pytest.mark.parametrize("module,symbol,kind", _CONTRACT,
                         ids=[f"{m.rsplit('.', 1)[-1]}.{s}" for m, s, _ in _CONTRACT])
def test_every_symbol_taken_ON_CONTRACT_exists_with_the_shape_expected(
        module, symbol, kind):
    """⛔ AN INTEGRATION SURPRISE, TURNED INTO A RED TEST THAT NAMES THE SYMBOL.

    This module reaches into four others, two of them for PRIVATE attributes
    (`ledger._DB_PATH`, `ledger._PRODUCT_TIMEFRAMES`) that carry no compatibility
    promise. A rename would otherwise surface as an `AttributeError` deep inside
    a write path at 03:00, or — worse for `_PRODUCT_TIMEFRAMES` — as a silently
    permissive timeframe gate. Each one is asserted BY NAME here.
    """
    import importlib

    mod = importlib.import_module(module)
    assert hasattr(mod, symbol), (
        f"{module}.{symbol} no longer exists — definition_record takes it on "
        f"contract and every caller of it is now wrong")
    value = getattr(mod, symbol)
    if kind == "callable":
        assert callable(value), f"{module}.{symbol} is no longer callable"
    else:
        assert isinstance(value, kind), (
            f"{module}.{symbol} is a {type(value).__name__}, not a "
            f"{kind.__name__}")


def test_the_contracted_symbols_still_BEHAVE_as_this_store_assumes():
    """…and the shape check above is not enough for the three that carry meaning."""
    assert ud.ast_hash(_TREE).startswith("sha256:")
    assert len(ud.ast_hash(_TREE)) == len("sha256:") + 64
    assert "1D" in ledger._PRODUCT_TIMEFRAMES and "D" not in ledger._PRODUCT_TIMEFRAMES
    assert ledger._BARS_STORE_TF_KEYS.get("D") == "1D"
    assert ledger._normalize_bar_time("2026-08-08") == 20260808
    assert ast_interpret.max_lookback(_TREE) == 5, (
        "the tree's declared lookback moved — the warm-up pad this store trims "
        "is derived from it")
    assert len(ast_interpret.interpret(_TREE, [dict(b) for b in _BARS[:10]])) == 10


def test_the_sibling_table_lives_in_the_SAME_FILE_as_signature_signals(store):
    """⭐ THE DESIGN CALL, ASSERTED: a SIBLING TABLE, not a widened one.

    Both halves in one file (one schema init, one backup, and a receipt that
    cannot outlive the signals beside it) — and `signature_coverage`'s own
    columns untouched, because a `def_hash` in its `indicator` column would give
    that column two meanings and make `latest_coverage()` answer across two
    namespaces.
    """
    ledger.record_signal("fcb", "fcb-v2", _SYM, _TF, "bull", 20260101, 10.0)
    dr.record_pass(_REV, _TF, _SYM, ast=_TREE, bars=[dict(b) for b in _BARS], at=_AT)

    with sqlite3.connect(str(store)) as c:
        tables = {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        cov_cols = [r[1] for r in c.execute("PRAGMA table_info(signature_coverage)")]
    assert {"signature_signals", "signature_coverage", dr.TABLE_NAME} <= tables, tables
    assert cov_cols == ["id", "indicator", "version", "sym", "tf", "first_bar_time",
                        "through_bar_time", "swept_at"], (
        "signature_coverage was WIDENED — E6-A1 says generalised into a sibling, "
        f"not widened: {cov_cols}")


# ═══════════════════════════════════════════════════════════════════════════
# 1. MEMBER-INDEPENDENCE IS STRUCTURAL, NOT INTENDED
# ═══════════════════════════════════════════════════════════════════════════

_FORBIDDEN_COLUMNS = {"user_id", "alert_id", "member_id", "account_id",
                      "active", "snoozed", "snooze_until", "delivered",
                      "arm_epoch", "fire_key"}


def test_the_record_HAS_NO_MEMBER_COLUMN_and_the_column_set_is_READ_not_typed(store):
    """🔴 THE WHOLE STORE, IN ONE PRAGMA.

    ⛔ THE COLUMN SET COMES OUT OF `sqlite_master`, NEVER OFF A DOCSTRING. Four
    false alarms in one session on this branch came from typed table and field
    names (`lesson_probe_names_must_be_derived_not_typed`).
    """
    dr.record_pass(_REV, _TF, _SYM, ast=_TREE, bars=[dict(b) for b in _BARS], at=_AT)
    with sqlite3.connect(str(store)) as c:
        cols = {r[1] for r in c.execute(f"PRAGMA table_info({dr.TABLE_NAME})")}
    assert cols, f"{dr.TABLE_NAME} does not exist — the probe read nothing"
    assert not (cols & _FORBIDDEN_COLUMNS), (
        f"{sorted(cols & _FORBIDDEN_COLUMNS)} makes this a record of a MEMBER'S "
        f"ROW, which is what the ledger already is and what this store exists "
        f"not to be")

    # ⭐ THE CONTROL. The same probe over a synthetic member-keyed table DOES
    # find them, so a PRAGMA that silently read nothing cannot report a clean
    # schema.
    with sqlite3.connect(":memory:") as c:
        c.execute("CREATE TABLE t (id INTEGER, user_id TEXT, sym TEXT)")
        bad = {r[1] for r in c.execute("PRAGMA table_info(t)")}
    assert bad & _FORBIDDEN_COLUMNS == {"user_id"}


def test_the_record_ALSO_HAS_NO_COLUMN_that_could_hold_a_HYPOTHETICAL(store):
    """⛔ A HYPOTHETICAL MAY NEVER SHARE A SURFACE WITH A REAL RECEIPT.

    The cheapest way to guarantee that is a store that cannot represent one:
    no `simulated`, no `backfilled`, no `source`, no `kind`. There is nothing to
    filter on, so there is nothing a surface can forget to filter.
    """
    dr.record_pass(_REV, _TF, _SYM, ast=_TREE, bars=[dict(b) for b in _BARS], at=_AT)
    with sqlite3.connect(str(store)) as c:
        cols = {r[1] for r in c.execute(f"PRAGMA table_info({dr.TABLE_NAME})")}
    forbidden = {"simulated", "hypothetical", "backfilled", "backtest",
                 "source", "kind", "is_real"}
    assert not (cols & forbidden), sorted(cols & forbidden)


def _fn_defs(tree: ast.AST) -> dict:
    return {n.name: n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


def _names_used(node: ast.AST) -> set:
    """Every called name and every string constant inside one function body.

    ⛔ AN AST, NEVER A GREP. `git grep -c admit_alert_fire` has answered 2, 3 and
    5 on this branch and every one of those hits was prose in a comment — and a
    grep for `get_signals` cannot tell a call from the word in this sentence.
    String constants are collected too, because a leak into the ledger would
    arrive as SQL: `JOIN signature_signals` is a string, not a call.
    """
    out: set = set()
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            fn = n.func
            if isinstance(fn, ast.Name):
                out.add(fn.id)
            elif isinstance(fn, ast.Attribute):
                out.add(fn.attr)
        elif isinstance(n, ast.Constant) and isinstance(n.value, str):
            out.update(w for w in n.value.replace("(", " ").replace(",", " ").split())
    return out


def _call_graph_of(tree: ast.AST, entry: str) -> set:
    """Everything `entry` reaches, transitively, through functions in this tree."""
    defs = _fn_defs(tree)
    assert entry in defs, f"{entry} is not defined here"
    seen, stack, reached = {entry}, [entry], set()
    while stack:
        name = stack.pop()
        used = _names_used(defs[name])
        reached |= used
        for u in used:
            if u in defs and u not in seen:
                seen.add(u)
                stack.append(u)
    return reached


def _call_graph(path: pathlib.Path, entry: str) -> set:
    return _call_graph_of(ast.parse(path.read_text(encoding="utf-8")), entry)


_BANNED_FOR_A_CLAIM = {"record_signal", "get_signals", "signature_signals",
                       "admit_alert_fire", "list_active", "record_trigger",
                       "indicator_alert_fires", "alert_shadow_fires",
                       "list_fires", "count_fires"}


@pytest.mark.parametrize("entry", ["claim_for", "record_pass", "record_evaluation"])
def test_the_record_CANNOT_REACH_the_signal_ledger_and_a_synthetic_offender_IS_NAMED(entry):
    """🔴 THE IMPORT GRAPH, NOT A GREP — AND ALL THREE DOORS, NOT JUST THE CLAIM.

    `claim_for` answers *"what did this rule say"*. If it could read
    `signature_signals`, the eleven conditions would leak straight back in
    through a join nobody meant to write — and the leak would be INVISIBLE,
    because every row it read would be real. The two write doors are covered for
    the same reason from the other side: a record that consulted the alerts store
    before writing would be member-dependent at the moment it mattered most.
    """
    reached = _call_graph(_ROOT / "api" / "services" / "definition_record.py", entry)
    assert not (reached & _BANNED_FOR_A_CLAIM), (
        f"{entry} reaches {sorted(reached & _BANNED_FOR_A_CLAIM)}")


def test_the_import_graph_rail_REPORTS_A_SYNTHETIC_OFFENDER_BY_NAME():
    """⭐ THE CONTROL. A rail that cannot fail is a measurement of nothing, so
    the same scanner is driven over three planted offenders — a direct call, one
    reached through a helper, and one hidden in SQL — and each must be reported.
    """
    direct = ("def claim_for(h, rev, tf):\n"
              "    rows = get_signals(sym=None)\n"
              "    return {'hits': len(rows)}\n")
    assert _call_graph_of(ast.parse(direct), "claim_for") & _BANNED_FOR_A_CLAIM \
        == {"get_signals"}

    indirect = ("def _tally():\n"
                "    return ledger.record_signal('x')\n"
                "def claim_for(h, rev, tf):\n"
                "    return _tally()\n")
    assert _call_graph_of(ast.parse(indirect), "claim_for") & _BANNED_FOR_A_CLAIM \
        == {"record_signal"}

    in_sql = ("def claim_for(h, rev, tf):\n"
              "    return c.execute('SELECT 1 FROM signature_signals')\n")
    assert _call_graph_of(ast.parse(in_sql), "claim_for") & _BANNED_FOR_A_CLAIM \
        == {"signature_signals"}

    clean = ("def claim_for(h, rev, tf):\n"
             "    return c.execute('SELECT 1 FROM definition_evaluations')\n")
    assert not (_call_graph_of(ast.parse(clean), "claim_for") & _BANNED_FOR_A_CLAIM)


def test_record_pass_TAKES_NO_def_hash_and_DERIVES_it_from_the_TREE(store):
    """⭐ THE HASH IS DERIVED, NOT TYPED, AND THAT IS WHAT MAKES AN EDIT HONEST.

    A `def_hash` parameter would let a caller file one tree's verdicts under
    another tree's name — accidentally on a copy-paste, and undetectably, since
    the store has no rewrite path. Read off the SIGNATURE by AST rather than
    trusted to the docstring.
    """
    tree = ast.parse((_ROOT / "api" / "services"
                      / "definition_record.py").read_text(encoding="utf-8"))
    fn = _fn_defs(tree)["record_pass"]
    params = ([a.arg for a in fn.args.args] + [a.arg for a in fn.args.kwonlyargs])
    assert "def_hash" not in params, (
        f"record_pass accepts a def_hash ({params}) — the tree must be the only "
        f"authority on which record its verdicts belong to")
    assert dr.record_pass(_REV, _TF, _SYM, ast=_TREE,
                          bars=[dict(b) for b in _BARS], at=_AT)["def_hash"] \
        == ud.ast_hash(_TREE)


# ── the writer census: today the number is ZERO, and the zero is asserted ────

def _dotted(node) -> str | None:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return ".".join(reversed(parts))


_RECORD_MODULE = "api.services.definition_record"
_WRITE_DOORS = ("record_evaluation", "record_pass")


def _writer_sites(scan_roots, rel_to: pathlib.Path) -> set:
    """Every resolved call into THIS module's write doors, `path::function`.

    ⛔ RESOLVED, NOT GREPPED, AND THE NAME COLLISION IS REAL:
    `indicator_alert_service.record_evaluation` is a DIFFERENT function that a
    text scan would count as a writer here, and `_run_one_cycle` calls it on
    every non-triggering evaluation. So a call counts only when its callee binds
    to this module.
    """
    sites: set = set()
    for root in scan_roots:
        for path in sorted(pathlib.Path(root).rglob("*.py")):
            if "__pycache__" in path.parts or path.name == "definition_record.py":
                continue
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except (SyntaxError, UnicodeDecodeError):        # pragma: no cover
                continue
            module_names: set = set()
            direct_names: set = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for a in node.names:
                        if a.name == _RECORD_MODULE:
                            module_names.add(a.asname or a.name)
                elif isinstance(node, ast.ImportFrom):
                    mod = node.module or ""
                    if mod == "api.services" or mod.endswith(".services") or mod == "":
                        for a in node.names:
                            if a.name == "definition_record":
                                module_names.add(a.asname or a.name)
                    if mod == _RECORD_MODULE or mod.endswith(".definition_record"):
                        for a in node.names:
                            if a.name in _WRITE_DOORS:
                                direct_names.add(a.asname or a.name)
                            elif a.name == "*":
                                direct_names.update(_WRITE_DOORS)
            enclosing: dict = {}
            for f in ast.walk(tree):
                if isinstance(f, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    for n in ast.walk(f):
                        enclosing.setdefault(id(n), f.name)
            rel = path.relative_to(rel_to).as_posix()
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                fn = node.func
                hit = False
                if isinstance(fn, ast.Attribute) and fn.attr in _WRITE_DOORS:
                    dotted = _dotted(fn) or ""
                    head = dotted.rsplit(".", 1)[0] if "." in dotted else ""
                    hit = (head in module_names
                           or any(dotted.endswith(f"{_RECORD_MODULE}.{d}")
                                  for d in _WRITE_DOORS))
                elif isinstance(fn, ast.Name) and fn.id in direct_names:
                    hit = True
                if hit:
                    sites.add(f"{rel}::{enclosing.get(id(node), '<module>')}")
    return sites


def test_the_record_has_EXACTLY_ONE_PRODUCTION_WRITER_and_it_is_NAMED():
    """⭐ THE PHASE-C IDIOM, NOW AT ONE: a door with exactly one caller, named.

    E6 shipped with ZERO writers and said in this docstring that *"when the sweep
    lands, this number becomes one and this test is edited to say so — deleting it
    instead is how a second writer arrives unnoticed."* **E3 landed the sweep on
    2026-08-09 and this is that edit.** The set is still asserted by `==` on the
    DERIVED census, so a SECOND writer — a route, a warmer, a backfill script —
    fails here BY NAME rather than appending to a store with no rewrite path.

    ⭐ AND THE ONE WRITER WRITES AT **MONTHLY** GRAIN. §4's measurement is why: at
    241.9 B/row over 3,742 tickers a DAILY row per symbol per session is 114 GB/yr
    at 500 definitions, which a Railway volume will not hold past ~10. The sweep
    folds a completed month of sessions into ONE window row — lever 1 in the
    runbook, *"recommended default for E3"* — and plants a one-bar origin on the
    first sweep so nothing is ever recorded for sessions that ran before the
    definition existed.
    """
    assert _writer_sites((_ROOT / "api", _ROOT / "tools"), _ROOT) == {
        "api/services/screener/scan_evaluator.py::_write_rule_record"}


@pytest.mark.parametrize("relpath,source,expected", [
    ("api/services/x.py",
     "from api.services import definition_record as dr\n"
     "def f():\n    dr.record_evaluation(1)\n", True),
    ("api/services/x.py",
     "from api.services.definition_record import record_pass\n"
     "def f():\n    record_pass(1)\n", True),
    ("api/services/x.py",
     "import api.services.definition_record\n"
     "def f():\n    api.services.definition_record.record_pass(1)\n", True),
    # ⛔ THE COLLISION THIS SCANNER EXISTS FOR — a DIFFERENT `record_evaluation`.
    ("api/services/x.py",
     "from api.services import indicator_alert_service as ias\n"
     "def f():\n    ias.record_evaluation(7, last_value=1.0)\n", False),
    # prose and a bare call in a file that never imported it
    ("api/services/x.py", "# record_pass is the door\nX = 'record_pass'\n", False),
    ("api/services/x.py", "def f():\n    record_pass(1)\n", False),
])
def test_the_writer_census_SEES_a_planted_writer_and_IGNORES_the_namesake(
        tmp_path, relpath, source, expected):
    """⛔ A NEGATIVE FIXTURE MUST TRIP THE RAW SCAN AND A NAMESAKE MUST NOT.

    Phase C Task 1 measured the failure this prevents: a fixture written in a
    shape the scanner structurally could not match left the scan asserting
    nothing while staying green.
    """
    planted = tmp_path / relpath
    planted.parent.mkdir(parents=True, exist_ok=True)
    planted.write_text(source, encoding="utf-8")
    assert bool(_writer_sites((tmp_path,), tmp_path)) is expected


# ═══════════════════════════════════════════════════════════════════════════
# 2. 🔴 THE DELIVERABLE — THE RECORD IS THE SAME IN ALL THREE MEMBER STATES
# ═══════════════════════════════════════════════════════════════════════════

def _drive_member_state(root: pathlib.Path, state: str) -> dict:
    """Run one whole world — its own auth db, its own ledger file — and report.

    Three separate databases rather than three passes over one, so the record
    rows compared below include their `id`: identical bytes, not merely identical
    content shifted by an autoincrement.
    """
    with pytest.MonkeyPatch.context() as mp:
        auth = root / f"{state}-auth.db"
        led = root / f"{state}-ledger.db"
        mp.setenv("AUTH_DB_PATH", str(auth))
        mp.setattr(ias, "_DB_PATH", str(auth))
        mp.setenv("SIGNAL_LEDGER_DB_PATH", str(led))
        mp.setattr(ledger, "_DB_PATH", str(led))
        mp.setattr(ledger, "_INITED", False)
        mp.setattr(dr, "_INITED", set())
        ias.init_schema()
        rev.init_schema()
        mp.setattr(ev, "_fetch_bars_for_alert",
                   lambda sym, tf, count=200: [dict(b) for b in _BARS])
        delivered: list = []
        mp.setattr(wls, "add_alert", lambda *a, **k: delivered.append(k))
        mp.setattr(wls, "send_email", lambda *a, **k: None)
        mp.setattr(wls, "_get_user_email", lambda uid: None)
        mp.setattr(_alerts_mod, "_fire_discord", lambda payload: None)

        aid = None
        if state != "nobody":
            aid = ias.create(user_id="u-three", sym=_SYM, indicator="rsi",
                             condition="above", threshold=10.0, tf=_BARS_TF)
            _would_have_fired(aid)
            if state == "snoozed":
                ias.snooze(aid, 60)
                assert ias.snooze_active(ias.get(aid)) is True, "the snooze did not take"

        ev._run_one_cycle()

        # ⭐ THE MEMBER-INDEPENDENT PASS: byte-identical inputs in all three
        # worlds, and it consults nothing about who armed what.
        dr.record_pass(_REV, _TF, _SYM, ast=_TREE,
                       bars=[dict(b) for b in _BARS], at=_AT)

        return {"record": _record_digest(led), "rows": _record_rows(led),
                "ledger": _ledger_rows(led),
                "fires": 0 if aid is None else fl.count_fires(aid)}


def test_the_record_is_IDENTICAL_across_nobody_snoozed_and_armed_while_the_LEDGER_is_NOT(
        tmp_path):
    """🔴🔴 THE GATE THIS TASK EXISTS FOR, AND IT IS AN EQUALITY.

    The same definition, the same symbol, the same bars, in three worlds that
    differ only in what a MEMBER did:

      * nobody armed it at all
      * somebody armed it and snoozed it
      * somebody armed it and is being paged about it right now

    The record must be byte-identical in all three. That equality IS the
    deliverable — it is what lets a public claim be about the RULE rather than
    about the population that happened to hold it.

    ⛔ AND THE CONTROL IS IN THE SAME TEST. If the three worlds were secretly
    identical, the record's sameness would be a measurement of nothing — so the
    LEDGER is asserted to disagree across them (0 / 0 / 1), and the fire log with
    it. Two of the three states are ledger-silent, which is precisely the bias
    the record exists to remove.
    """
    _the_shipped_lane_is_closed()
    nobody = _drive_member_state(tmp_path, "nobody")
    snoozed = _drive_member_state(tmp_path, "snoozed")
    armed = _drive_member_state(tmp_path, "armed")

    assert nobody["rows"], "the record is empty — the equality below is vacuous"
    assert nobody["record"] == snoozed["record"] == armed["record"], (
        "the record moved with member state, which makes it a second ledger:\n"
        f"  nobody  {nobody['rows']}\n"
        f"  snoozed {snoozed['rows']}\n"
        f"  armed   {armed['rows']}")

    assert (nobody["ledger"], snoozed["ledger"], armed["ledger"]) == (0, 0, 1), (
        "the three worlds did not actually differ, so the equality above proves "
        "nothing: "
        f"{(nobody['ledger'], snoozed['ledger'], armed['ledger'])}")
    assert (nobody["fires"], snoozed["fires"], armed["fires"]) == (0, 0, 1), (
        "the fire log agreed across the three states — the snooze never took")


# ═══════════════════════════════════════════════════════════════════════════
# 3. THE FIVE MEMBER-BEHAVIOUR BLIND SPOTS, EACH MEASURED
# ═══════════════════════════════════════════════════════════════════════════
#
# Each case: prove the rule IS right here, drive the REAL cycle, then assert the
# ledger is empty and the record is not. `docs/decisions/2026-08-08-the-rule-
# record-is-not-the-ledger.md` carries all eleven conditions; these are the five
# that are somebody's BEHAVIOUR rather than the machinery's.


def test_BLIND_SPOT_1_active_zero_is_never_evaluated_yet_the_record_has_it(cycle_env):
    """`list_active()` is `WHERE active=1`. Total silence, and no receipt."""
    _the_shipped_lane_is_closed()
    aid = ias.create(user_id="u-off", sym=_SYM, indicator="rsi",
                     condition="above", threshold=10.0, tf=_BARS_TF)
    _would_have_fired(aid)
    ias.set_active(aid, False)
    assert ias.list_active() == [], "the alert is still active — nothing is silenced"

    ev._run_one_cycle()

    assert _ledger_rows(cycle_env["ledger"]) == 0
    assert fl.count_fires(aid) == 0
    said = _the_record_says(cycle_env["ledger"])
    assert said["claim"]["coverage"] == "proven"
    assert said["claim"]["hits"] == said["pass"]["true"] > 0, (
        "the record has no verdict for a rule that was right the whole time")


def test_BLIND_SPOT_2_a_SNOOZED_alert_accrues_nothing_yet_the_record_has_it(cycle_env):
    """⭐ THE CONFIRMED GAP. `record_trigger` returns False while snoozed,
    BEFORE the fire log is touched, so the receipt gate `if recorded:` never
    fires. The condition was true; the ledger says nothing happened."""
    _the_shipped_lane_is_closed()
    aid = ias.create(user_id="u-snooze", sym=_SYM, indicator="rsi",
                     condition="above", threshold=10.0, tf=_BARS_TF)
    _would_have_fired(aid)
    ias.snooze(aid, 60)
    assert ias.snooze_active(ias.get(aid)) is True

    ev._run_one_cycle()

    assert fl.count_fires(aid) == 0, "the snooze did not suppress the fire log"
    assert _ledger_rows(cycle_env["ledger"]) == 0
    said = _the_record_says(cycle_env["ledger"])
    assert said["claim"]["hits"] == said["pass"]["true"] > 0


def test_BLIND_SPOT_3_a_LEVEL_condition_accrues_ONE_receipt_for_MANY_TRUE_BARS(
        cycle_env, monkeypatch):
    """⭐ THE ONE WHERE BOTH STORES HAVE ROWS AND THEY DISAGREE ON THE NUMBER.

    The fire key for a level condition is `ep:<arm_epoch>`, so "RSI is still
    above 70" accrues ONE receipt for the whole armed episode — correct as a
    notification record and useless as a performance one. The bar advances
    between the two cycles, so the ledger's own key genuinely moved and the ONE
    is the episode rule rather than the store's dedup.
    """
    _the_shipped_lane_is_closed()
    window = [dict(b) for b in _BARS]
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in window])
    aid = ias.create(user_id="u-level", sym=_SYM, indicator="rsi",
                     condition="above", threshold=10.0, tf=_BARS_TF)
    ev._run_one_cycle()
    assert _ledger_rows(cycle_env["ledger"]) == 1

    nxt = dict(window[-1])
    nxt.update(t=window[-1]["t"] + 300, o=window[-1]["c"], c=window[-1]["c"] + 1,
               h=window[-1]["c"] + 1.6, l=window[-1]["c"] - 0.4)
    window.append(nxt)
    value, triggered, idx = ev._evaluate_for_cycle(ias.get(aid),
                                                   [dict(b) for b in window])
    assert triggered is True and idx == len(window) - 1, (
        f"the condition stopped being true on the new bar ({value}, {triggered})")
    assert ev._fire_bar_time(window, idx) != _BARS[-1]["t"], (
        "the judged bar did not advance, so the ledger key never moved and the "
        "ONE below would be the store's dedup rather than the episode rule")

    ev._run_one_cycle()

    assert _ledger_rows(cycle_env["ledger"]) == 1, (
        "the episode accrued a second receipt")
    out = dr.record_pass(_REV, _TF, _SYM, ast=_TREE,
                         bars=[dict(b) for b in window], at=_AT)
    assert out["true"] > 1, (
        f"the record collapsed the episode too: {out}")
    assert out["true"] > _ledger_rows(cycle_env["ledger"]), (
        "the record and the notification log agree on the count, which means one "
        "of them is not measuring what it claims to")


def test_BLIND_SPOT_4_a_USER_AUTHORED_fire_is_refused_FIRST_yet_the_record_has_it(
        cycle_env, tmp_path, monkeypatch):
    """⭐ NOTHING A MEMBER WRITES CAN EVER ACCRUE LEDGER HISTORY — which would
    make a *user-built scan's* track record permanently, structurally empty.
    That is the single most damning of the five for a screener whose entire
    premise is user-authored rules.

    ⛔ THE ZERO IS NOT VACUOUS: a builtin alert fires in the SAME cycle and lands
    its row, so "zero" is a statement about PROVENANCE, not about a quiet tape.
    """
    _the_shipped_lane_is_closed()
    defs_path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(defs_path))
    monkeypatch.setattr(ud, "_DB_PATH", str(defs_path))
    ud._init_db()
    from api.services import alert_user_series as aus
    aus.forget()
    try:
        ud.save("u-author", _USER_DEF_ID, _user_definition())
        user_aid = ias.create(user_id="u-author", sym=_SYM,
                              indicator=_USER_ADDRESS, condition="above",
                              threshold=120.0, tf=_BARS_TF)
        builtin_aid = ias.create(user_id="u-author", sym=_SYM, indicator="rsi",
                                 condition="above", threshold=10.0, tf=_BARS_TF)
        assert ias.get(user_aid)["def_source"] == ias.DEF_SOURCE_USER
        _would_have_fired(user_aid)

        ev._run_one_cycle()

        assert fl.count_fires(user_aid) == 1, "the user alert never fired"
        assert fl.count_fires(builtin_aid) == 1
        signals_sql = "SELECT indicator FROM signature_signals"
        with sqlite3.connect(str(cycle_env["ledger"])) as c:
            indicators = [r[0] for r in c.execute(signals_sql)]
        assert indicators == ["rsi"], (
            f"the ledger holds {indicators} — the builtin control is what makes "
            f"the user-authored absence a statement about provenance")
    finally:
        aus.forget()

    said = _the_record_says(cycle_env["ledger"])
    assert said["claim"]["hits"] == said["pass"]["true"] > 0, (
        "a user-authored rule has no record either, which leaves the screener's "
        "own premise unmeasurable")


def test_BLIND_SPOT_5_a_rev_MIGRATION_eats_the_whole_first_cycle_yet_the_record_has_it(
        cycle_env):
    """⭐ AN EDIT THE MEMBER MADE, PAID FOR IN SILENCE.

    `consume_if_suppressed` eats the entire first cycle after a `compute.rev`
    migration — deliberately, so a moved anchor cannot fabricate a crossing. No
    evaluation, no fire, no receipt, for every migrated binding.
    """
    _the_shipped_lane_is_closed()
    aid = ias.create(user_id="u-migrate", sym=_SYM, indicator="rsi",
                     condition="above", threshold=10.0, tf=_BARS_TF)
    _would_have_fired(aid)
    result = rev.migrate_bindings_to_rev("rsi", 2, notify=lambda payload: None)
    assert result.get("migrated"), f"nothing was migrated: {result}"
    assert rev.suppress_first_cycle(ias.get(aid)) is True, (
        "the alert is not suppressed — there is no eaten cycle to measure")

    summary = ev._run_one_cycle()

    assert summary["suppressed"] == 1, summary
    assert fl.count_fires(aid) == 0
    assert _ledger_rows(cycle_env["ledger"]) == 0
    said = _the_record_says(cycle_env["ledger"])
    assert said["claim"]["hits"] == said["pass"]["true"] > 0


# ═══════════════════════════════════════════════════════════════════════════
# 4. RETENTION IS A HORIZON THAT REFUSES, NOT A WINDOW THAT SHRINKS
# ═══════════════════════════════════════════════════════════════════════════

def _seed_two_windows(h: str):
    """A WIDE window recorded long ago, and a NARROW one recorded recently.

    The narrow one is the trap: after the prune it is the only survivor, and a
    claim that summed "whatever is left" would answer the wide question with the
    narrow window's numbers — smaller, confident, and about a different period.

    The two `recorded_at` stamps are ~1,157 days apart, so a 30-day horizon read
    at `new_at` lands strictly between them — the prune has to be able to take
    one row and leave the other, or neither test below measures anything.
    """
    old_at, new_at = 1_600_000_000.0, 1_700_000_000.0
    dr.record_evaluation(h, _REV, _TF, _SYM, 20250101, 20260808,
                         bars_evaluated=400, bars_true=200, at=old_at)
    dr.record_evaluation(h, _REV, _TF, _SYM, 20260701, 20260808,
                         bars_evaluated=28, bars_true=1, at=new_at)
    return old_at, new_at


def test_a_PRUNE_makes_the_claim_REFUSE_rather_than_SHRINK(store):
    """🔴 THE RETENTION FAILURE THIS STORE MUST NOT HAVE.

    Pruning silently converts *"proven over 400 bars"* into *"proven over 28"*
    under any design that sums survivors, and a hit rate recomputed over those
    survivors is a smaller, confident, WRONG number — §1.6's trap reached by
    arithmetic, which is exactly the ledger's own defect with a different table
    underneath.

    So beyond the horizon the answer is `unproven` and `hit_rate` is `None`, and
    the number a shrinking design WOULD have printed is named in the failure
    message so a regression is unmistakable.
    """
    h = _def_hash()
    old_at, new_at = _seed_two_windows(h)
    wide = dict(first_bar_time=20250101, through_bar_time=20260808)

    before = dr.claim_for(h, _REV, _TF, **wide)
    assert before["coverage"] == "proven"
    assert before["hit_rate"] == pytest.approx(0.5), before

    removed = dr.prune(30, now=new_at)
    assert removed["deleted"] == 1, (
        f"the prune removed {removed['deleted']} rows — with the wide row still "
        f"present there is no shrink to refuse")

    after = dr.claim_for(h, _REV, _TF, **wide)
    assert after["coverage"] == "unproven", after
    assert after["hits"] is None and after["hit_rate"] is None, (
        f"the claim SHRANK instead of refusing: it would have published "
        f"{after['hit_rate']!r} over a window nobody proved")
    assert after["refusal"] == dr.NOT_ENOUGH_RECORD
    # ⛔ AND THE SURVIVOR IS REALLY THERE — otherwise "refuses" is satisfied by
    # an empty table and the shrink was never possible in the first place.
    assert dr.latest_evaluation(h, _REV, _TF, _SYM) is not None
    assert after["horizon"]["oldest_proven"] == 20260701


def test_a_claim_INSIDE_the_horizon_still_ANSWERS_after_the_same_prune(store):
    """⭐ THE OTHER HALF: refusing is not the same as being useless.

    The narrow window survived the prune, so the question it CAN answer is still
    answered with a real number. A store that refused everything after any prune
    would pass the test above and be worthless.
    """
    h = _def_hash()
    _, new_at = _seed_two_windows(h)
    dr.prune(30, now=new_at)

    inside = dr.claim_for(h, _REV, _TF, first_bar_time=20260701,
                          through_bar_time=20260808)
    assert inside["coverage"] == "proven", inside
    assert inside["evaluated"] == 28
    assert inside["hits"] == 1
    assert inside["hit_rate"] == pytest.approx(1 / 28)
    assert inside["refusal"] is None


def test_two_shorter_rows_that_TOUCH_BOTH_ENDS_prove_NOTHING_about_the_gap(store):
    """⛔ CONTAINMENT, NOT OVERLAP — the structural reason the prune above refuses.

    Two rows that between them reach both ends of a window say nothing about the
    sessions in the middle. Summing them would be a coverage claim assembled out
    of two facts neither of which is the claim.
    """
    h = _def_hash()
    dr.record_evaluation(h, _REV, _TF, _SYM, 20260101, 20260201,
                         bars_evaluated=20, bars_true=10, at=_AT)
    dr.record_evaluation(h, _REV, _TF, _SYM, 20260701, 20260808,
                         bars_evaluated=20, bars_true=10, at=_AT)
    out = dr.claim_for(h, _REV, _TF, first_bar_time=20260101,
                       through_bar_time=20260808)
    assert out["coverage"] == "unproven"
    assert out["hits"] is None and out["hit_rate"] is None
    assert out["evaluated"] == 0, (
        "the claim counted bars from rows that do not contain its window")


def test_the_HORIZON_has_exactly_ONE_authority(store):
    """⛔ M7's SHAPE. A horizon with two authorities is not a horizon: the prune
    deletes on one number and the claim refuses on the other, and the gap between
    them is a window that reads as proven while its rows are already gone.

    Read by AST — every literal-bearing assignment of a retention number in the
    module — rather than by trusting the constant to stay alone.
    """
    tree = ast.parse((_ROOT / "api" / "services"
                      / "definition_record.py").read_text(encoding="utf-8"))
    declarations = [n for n in ast.walk(tree)
                    if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and "RETENTION" in t.id
                            for t in n.targets)]
    assert len(declarations) == 1, (
        f"{len(declarations)} retention declarations — there must be exactly one")
    assert dr.prune(None, now=_AT)["retention_days"] == dr.RETENTION_DAYS
    assert dr.horizon()["retention_days"] == dr.RETENTION_DAYS


# ═══════════════════════════════════════════════════════════════════════════
# 5. FORWARD-ONLY FROM CREATION — NO BACKTEST MAY ENTER
# ═══════════════════════════════════════════════════════════════════════════

def test_a_window_that_reaches_BEFORE_the_origin_is_REFUSED(store):
    """🔴 §1.6 FORBIDS BACKTEST INFLATION, SO THE STORE CANNOT HOLD ONE.

    *"Every number we show you accrued after you asked for it"* is only a claim
    worth making if the schema cannot be reached backwards. The record's origin
    is the earliest window start on file; once it exists, nothing may extend it.
    """
    h = _def_hash()
    dr.record_evaluation(h, _REV, _TF, _SYM, 20260601, 20260808,
                         bars_evaluated=40, bars_true=4, at=_AT)
    assert dr.origin(h, _REV) == 20260601

    with pytest.raises(ValueError, match=dr.REFUSALS["before_origin"]):
        dr.record_evaluation(h, _REV, _TF, _SYM, 20250101, 20260808,
                             bars_evaluated=400, bars_true=300, at=_AT)
    # ⭐ FORWARD IS FINE — a refusal that refused everything would be a bug.
    assert dr.record_evaluation(h, _REV, _TF, "MSFT", 20260602, 20260808,
                                bars_evaluated=39, bars_true=1, at=_AT) is True
    assert dr.origin(h, _REV) == 20260601


def test_a_definition_with_NO_record_yet_says_so_PLAINLY(store):
    """⭐ EMPTY ON DAY ONE, AND IT SAYS SO RATHER THAN HIDING THE SURFACE."""
    out = dr.claim_for(_def_hash(), _REV, _TF, first_bar_time=20260101,
                       through_bar_time=20260808)
    assert out["coverage"] == "unproven"
    assert out["hits"] is None and out["hit_rate"] is None
    assert out["refusal"] == dr.NO_RECORD_YET
    assert dr.origin(_def_hash(), _REV) is None


def test_an_EDITED_definition_starts_a_NEW_record_because_the_HASH_MOVED(store):
    """⭐ D-A3's REV SEMANTICS, FOR FREE. The old record belongs to the old maths.

    One number changed in the tree, so the hash changed, so the key changed —
    and the edited rule's claim starts at `unproven` rather than inheriting a
    history it did not earn.
    """
    dr.record_pass(_REV, _TF, _SYM, ast=_TREE, bars=[dict(b) for b in _BARS], at=_AT)
    old, new = ud.ast_hash(_TREE), ud.ast_hash(_TREE_EDITED)
    assert old != new, "the fixtures are the same tree; this test proves nothing"

    window = dict(first_bar_time=_BARS[4]["t"], through_bar_time=_BARS[-1]["t"])
    assert dr.claim_for(old, _REV, _TF, **window)["coverage"] == "proven"
    fresh = dr.claim_for(new, _REV, _TF, **window)
    assert fresh["coverage"] == "unproven"
    assert fresh["hits"] is None and fresh["refusal"] == dr.NO_RECORD_YET


def test_a_REV_BUMP_also_starts_a_new_record(store):
    """The other half of the same rule: `rev` is in the key because a migration
    means the maths moved, and a record that ignored it would certify work never
    done — the reason `signature_coverage` carries `version`."""
    h = _def_hash()
    dr.record_evaluation(h, 1, _TF, _SYM, 20260601, 20260808,
                         bars_evaluated=40, bars_true=4, at=_AT)
    assert dr.claim_for(h, 1, _TF, first_bar_time=20260601,
                        through_bar_time=20260808)["coverage"] == "proven"
    assert dr.claim_for(h, 2, _TF, first_bar_time=20260601,
                        through_bar_time=20260808)["coverage"] == "unproven"
    assert dr.origin(h, 2) is None


# ═══════════════════════════════════════════════════════════════════════════
# 6. THE CLAIM REFUSES WITH `None`, NEVER WITH A NUMBER
# ═══════════════════════════════════════════════════════════════════════════

def test_hit_rate_is_NONE_when_coverage_is_UNPROVEN_and_NEVER_ZERO(store):
    """⛔ RETURN `None`, NOT `0` (`lesson_a_derived_reference_needs_a_sanity_bound`).

    A `hit_rate` of `0.0` on an unproven window is a NUMBER, and a number gets
    formatted into a marketing sentence. `None` cannot be, by accident.
    """
    out = dr.claim_for(_def_hash(), _REV, _TF, first_bar_time=20260101,
                       through_bar_time=20260808)
    assert out["hit_rate"] is None and out["hits"] is None
    assert out["hit_rate"] is not 0 and out["hit_rate"] != 0  # noqa: F632


def test_a_DROPPED_symbol_gets_NO_RECEIPT_and_the_claim_goes_PARTIAL(store):
    """⭐ §6.3: *A SCREEN STATES ITS OWN COVERAGE.*

    The measured pattern this breaks: `bars_prewarm` counts a per-symbol failure
    into NEITHER `warmed` nor `skipped`; `scan_volume` sets `m = {}` so a failed
    reference is indistinguishable from an empty market. Here the ABSENCE of a
    receipt is what makes the gap survivable — a rerun of only the dropped set
    closes it, and until then the claim refuses and NAMES the symbol.
    """
    h = _def_hash()
    dr.record_evaluation(h, _REV, _TF, "AAPL", 20260601, 20260808,
                         bars_evaluated=40, bars_true=8, at=_AT)
    out = dr.claim_for(h, _REV, _TF, syms=["AAPL", "BROKEN"],
                       first_bar_time=20260601, through_bar_time=20260808)
    assert out["coverage"] == "partial"
    assert out["symbols"] == {"requested": 2, "proven": 1, "unproven": ["BROKEN"]}
    assert out["hits"] is None and out["hit_rate"] is None
    assert out["refusal"] == dr.PARTIAL_RECORD
    assert dr.latest_evaluation(h, _REV, _TF, "BROKEN") is None


def test_latest_evaluation_is_NONE_not_an_empty_dict_for_a_symbol_never_seen(store):
    """⛔ FALSY-BUT-PRESENT IS HOW "NEVER LOOKED" BECOMES "LOOKED AND FOUND
    NOTHING" at the first `if not result:` a caller writes."""
    out = dr.latest_evaluation(_def_hash(), _REV, _TF, "NEVER")
    assert out is None
    assert not isinstance(out, dict)


def test_a_claim_over_EVERY_KNOWN_SYMBOL_needs_no_symbol_list(store):
    """With `syms=None` the claim is over everything this record knows, so a
    caller cannot narrow the denominator by handing in a friendly subset."""
    h = _def_hash()
    dr.record_evaluation(h, _REV, _TF, "AAPL", 20260601, 20260808,
                         bars_evaluated=40, bars_true=8, at=_AT)
    dr.record_evaluation(h, _REV, _TF, "MSFT", 20260601, 20260808,
                         bars_evaluated=40, bars_true=0, at=_AT)
    assert dr.known_symbols(h, _REV, _TF) == ["AAPL", "MSFT"]
    out = dr.claim_for(h, _REV, _TF, first_bar_time=20260601,
                       through_bar_time=20260808)
    assert out["coverage"] == "proven"
    assert out["evaluated"] == 80 and out["hits"] == 8
    assert out["hit_rate"] == pytest.approx(0.1)


# ═══════════════════════════════════════════════════════════════════════════
# 7. THE STORE'S OWN SHAPE — APPEND-ONLY, IDEMPOTENT, AND LOUD
# ═══════════════════════════════════════════════════════════════════════════

def test_recording_the_same_window_twice_is_FREE_and_False_means_ONLY_that(store):
    h = _def_hash()
    assert dr.record_evaluation(h, _REV, _TF, _SYM, 20260601, 20260808,
                                bars_evaluated=40, bars_true=4, at=_AT) is True
    assert dr.record_evaluation(h, _REV, _TF, _SYM, 20260601, 20260808,
                                bars_evaluated=40, bars_true=4, at=_AT) is False
    assert len(_record_rows(store)) == 1


def _static_sql(node) -> str:
    """The literal text of a SQL argument — an f-string's constant parts joined.

    An interpolated table name contributes nothing, which is exactly right: the
    question below is which VERBS this module executes, and a verb is never
    interpolated.
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(v.value for v in node.values
                       if isinstance(v, ast.Constant) and isinstance(v.value, str))
    return ""


def _executed_sql(tree: ast.AST) -> list[tuple[str, str]]:
    """`(enclosing function, sql)` for every `execute*` call in the module.

    ⛔ READ OFF THE CALL, NOT OFF THE FILE'S STRINGS. A scan over every string
    constant counts the word "Delete" in `prune`'s own docstring — which is how
    a source-text gate ends up asserting something about prose.
    """
    out: list[tuple[str, str]] = []
    for name, fn in _fn_defs(tree).items():
        for node in ast.walk(fn):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in ("execute", "executescript", "executemany")
                    and node.args):
                out.append((name, _static_sql(node.args[0])))
    return out


def test_the_module_has_NO_UPDATE_and_NO_DELETE_outside_the_prune():
    """⛔ APPEND-ONLY IS A PROPERTY OF THE SOURCE, NOT OF AN INTENTION.

    One `DELETE` exists and it lives in `prune`; anything else — an `UPDATE`, a
    second `DELETE`, an `INSERT OR REPLACE` — is a rewrite path into a store
    whose whole value is that it has none.
    """
    path = _ROOT / "api" / "services" / "definition_record.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    executed = _executed_sql(tree)
    assert executed, "no SQL was found at all — the scanner read nothing"

    mutations: dict[str, list[str]] = {}
    for fn_name, sql in executed:
        up = " ".join(sql.upper().split())
        for verb in ("UPDATE ", "DELETE ", "INSERT OR REPLACE", "INSERT OR IGNORE",
                     "INSERT INTO", "INSERT "):
            if verb in up:
                mutations.setdefault(verb.strip(), []).append(fn_name)
                break
    assert mutations == {"DELETE": ["prune"],
                         "INSERT INTO": ["record_evaluation"]}, mutations

    # …and the module-level schema declares tables and indexes only. A TRIGGER
    # would be a rewrite path none of the SQL above can see.
    schema = _static_sql(next(
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "_SCHEMA" for t in n.targets)))
    assert "CREATE TABLE" in schema.upper(), "the schema was not read"
    assert "TRIGGER" not in schema.upper()


def test_a_WARMUP_bar_is_in_NEITHER_the_numerator_nor_the_denominator(store):
    """⚠️ `close > sma(close,5)` ANSWERS "NO" ON ITS WARM-UP BARS.

    A comparison over an incomputable operand is `0.0`, not `None` — `x > NaN` is
    `False` in both lanes by IEEE — so without the tree's own `max_lookback` pad
    every one of those noes would land in the denominator and dilute the rate by
    the length of the longest lookback in the tree.
    """
    bars = [dict(b) for b in _BARS[:12]]
    out = dr.record_pass(_REV, _TF, _SYM, ast=_TREE, bars=bars, at=_AT)
    pad = max(0, ast_interpret.max_lookback(_TREE) - 1)
    assert pad > 0, "this fixture tree has no warm-up, so the pad is untested"
    assert out["evaluated"] == len(bars) - pad, out
    assert out["first_bar_time"] == bars[pad]["t"], (
        "the recorded window starts inside the warm-up pad")
    # …and the control: a tree with no lookback evaluates every bar.
    flat = {"type": "op", "name": ">", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 0}]}
    assert ast_interpret.max_lookback(flat) == 0
    assert dr.record_pass(_REV, _TF, "FLAT", ast=flat, bars=bars,
                          at=_AT)["evaluated"] == len(bars)


def test_a_pass_with_NOTHING_COMPUTABLE_writes_no_row_and_says_which(store):
    """A receipt certifying zero bars covers everything by covering nothing."""
    short = [dict(b) for b in _BARS[:2]]
    tall = {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 50}]}
    out = dr.record_pass(_REV, _TF, _SYM, ast=tall, bars=short, at=_AT)
    assert out["recorded"] is False
    assert out["evaluated"] == 0 and out["skipped"]
    assert _record_rows(store) == []


# ── the refusals: pairwise distinct, and every one of them reachable ─────────

def test_every_refusal_says_something_NO_OTHER_refusal_says():
    """⛔ PHASE C TASK 9's M1: two gates sharing a phrase let a
    `pytest.raises(match=…)` keep passing after the OTHER one was deleted.

    Asserted pairwise rather than trusted to a careful author — and against the
    NEIGHBOURING module too, because these two tables live in one file and a
    phrase shared with `ledger.py` has exactly the same failure mode one table
    over.
    """
    phrases = dr.REFUSALS
    for a, pa in phrases.items():
        for b, pb in phrases.items():
            if a == b:
                continue
            assert pa not in pb, f"{a!r} is a substring of {b!r}: {pa!r} ⊂ {pb!r}"

    ledger_src = (_ROOT / "api" / "services" / "signature"
                  / "ledger.py").read_text(encoding="utf-8")
    for name, phrase in phrases.items():
        assert phrase not in ledger_src, (
            f"{name}'s phrase is already used by ledger.py — a `raises(match=…)` "
            f"here would keep passing after that gate was deleted")


_H = "sha256:" + "0" * 64


#: guard → a call that must reach it. ⛔ THE TABLE IS A MODULE CONSTANT so the
#: coverage census below can READ it instead of restating it; a hand-copied
#: second list is how a refusal ends up declared, undriven, and green.
_REACHABLE: list[tuple] = [
    ("key_slot", lambda: dr.record_evaluation(_H, 1, "1D", "", 1, 2,
                                              bars_evaluated=1, bars_true=0)),
    ("def_hash_shape", lambda: dr.record_evaluation("nope", 1, "1D", "A", 1, 2,
                                                    bars_evaluated=1, bars_true=0)),
    ("rev_shape", lambda: dr.record_evaluation(_H, -1, "1D", "A", 1, 2,
                                               bars_evaluated=1, bars_true=0)),
    ("timeframe", lambda: dr.record_evaluation(_H, 1, "D", "A", 1, 2,
                                               bars_evaluated=1, bars_true=0)),
    ("backwards", lambda: dr.record_evaluation(_H, 1, "1D", "A", 20260808, 20260101,
                                               bars_evaluated=1, bars_true=0)),
    ("empty_window", lambda: dr.record_evaluation(_H, 1, "1D", "A", 1, 2,
                                                  bars_evaluated=0, bars_true=0)),
    ("count_shape", lambda: dr.record_evaluation(_H, 1, "1D", "A", 1, 2,
                                                 bars_evaluated=5, bars_true=-1)),
    ("more_true", lambda: dr.record_evaluation(_H, 1, "1D", "A", 1, 2,
                                               bars_evaluated=5, bars_true=6)),
    ("stamp", lambda: dr.record_evaluation(_H, 1, "1D", "A", 1, 2,
                                           bars_evaluated=1, bars_true=0,
                                           at=float("nan"))),
    ("negative_horizon", lambda: dr.prune(-1)),
]

#: `before_origin` has its own section above — it is the only refusal that needs
#: a record to already exist, so driving it from the flat table would need a
#: fixture inside a lambda.
_REACHABLE_ELSEWHERE = {"before_origin"}


@pytest.mark.parametrize("guard,call", _REACHABLE, ids=[g for g, _ in _REACHABLE])
def test_each_declared_refusal_is_REACHABLE(store, guard, call):
    """⛔ A REFUSAL NOBODY CAN REACH IS A COMMENT."""
    with pytest.raises(ValueError, match=dr.REFUSALS[guard]):
        call()


def test_the_reachability_table_covers_EVERY_declared_refusal():
    """…and the table is READ, not restated: adding a refusal without a case
    fails here rather than going unmeasured."""
    covered = {g for g, _ in _REACHABLE} | _REACHABLE_ELSEWHERE
    declared = set(dr.REFUSALS)
    assert declared == covered, (
        f"undriven refusals: {sorted(declared - covered)}; "
        f"stale entries: {sorted(covered - declared)}")


def test_a_BOOL_is_refused_where_an_int_is_expected(store):
    """⛔ `isinstance(True, int)` IS TRUE AND `True >= 0` IS TRUE — a bool sails
    through every obvious numeric guard, the trap Phase D Task 5 measured in
    `stable_stringify`."""
    with pytest.raises(ValueError, match=dr.REFUSALS["rev_shape"]):
        dr.record_evaluation(_H, True, "1D", "A", 1, 2,
                             bars_evaluated=1, bars_true=0)
    with pytest.raises(ValueError, match=dr.REFUSALS["count_shape"]):
        dr.record_evaluation(_H, 1, "1D", "A", 1, 2,
                             bars_evaluated=True, bars_true=0)


def test_the_bars_store_TF_CODE_is_refused_and_the_refusal_NAMES_the_label(store):
    """A `tf` of `"D"` is a VALID row that keys itself away from every other row
    for the same session — nothing fails and nothing ever surfaces. The refusal
    names the product label so a caller fixes the bug instead of deleting the
    call."""
    with pytest.raises(ValueError, match="bars-store code for '1D'"):
        dr.record_evaluation(_H, 1, "D", "A", 1, 2, bars_evaluated=1, bars_true=0)


def test_a_READ_answers_an_inverted_window_instead_of_raising(store):
    """The write door raises on an inverted window because a bad row has no
    rewrite path; a read ANSWERS, because a bad question costs nothing and a
    surface that 500s on one is worse than one that says no."""
    h = _def_hash()
    assert dr.covers(h, _REV, _TF, _SYM, first_bar_time=20260808,
                     through_bar_time=20260101) is False
    out = dr.claim_for(h, _REV, _TF, first_bar_time=20260808,
                       through_bar_time=20260101)
    assert out["coverage"] == "unproven"
    assert out["refusal"] == dr.REFUSALS["backwards"]


def test_one_session_spelled_three_ways_lands_on_ONE_key(store):
    """⛔ ONE COLLAPSE, NOT TWO. The same session arrives as a YYYYMMDD int, an
    ISO string and a timestamped ISO string; `ledger._normalize_bar_time` folds
    all three, and a second normalizer here would be a second spelling in a
    database where the two tables sit side by side."""
    h = _def_hash()
    assert dr.record_evaluation(h, _REV, _TF, _SYM, 20260601, 20260808,
                                bars_evaluated=40, bars_true=4, at=_AT) is True
    for first, through in ((20260601, "2026-08-08"),
                           ("2026-06-01", 20260808),
                           ("2026-06-01T13:30:00Z", "2026-08-08 16:00:00")):
        assert dr.record_evaluation(h, _REV, _TF, _SYM, first, through,
                                    bars_evaluated=40, bars_true=4,
                                    at=_AT) is False, (first, through)
    assert len(_record_rows(store)) == 1
