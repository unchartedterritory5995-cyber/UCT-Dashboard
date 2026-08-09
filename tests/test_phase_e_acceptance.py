"""E-9 — the Pine-screener parity path, proven end to end.

🔴 AMENDMENT 2 §A2.5, STATED AS AN ACCEPTANCE CRITERION.

    *"Take any shipped indicator definition, add a comparison, run it as a scan,
    chart a hit, and arm an alert on it — WITHOUT the definition being re-authored
    at any step. If that path requires a second object anywhere, §1.1 has been
    violated."*

⛔ THE ASSERTION IS THE HASH, AT EVERY STEP. Four surfaces agreeing about a
symbol proves nothing; four surfaces holding ONE ``def_hash`` is the claim.
``def_hash`` IS ``astHash`` IS ``compute.fn`` — the tree is the implementation —
so "the same definition" is a value that can be compared rather than a
resemblance somebody eyeballs.

⛔ AND EVERY HASH IS READ BACK OUT OF THE ARTIFACT THAT SURFACE ACTUALLY
CONSUMES, NEVER COPIED OFF THE ARGUMENT. The scan's is the evaluator's own
envelope; the chart's is the document ``/api/user-definitions`` answers with for
the id the click carried; the alert's is the document its stored ADDRESS resolves
to. A test that carried one variable through four asserts would be true of a path
that re-authored at every step.

⚠️ EVERY TREE IN THIS FILE COMES FROM THE SHIPPED PARSER (design CORRECTION 5:
*"an example formula is a CLAIM about the table and must be PARSED, not read"*),
through the same node lane ``tests/test_scan_definition.py`` opened. ⛔ NOT A
SKIP if node is missing: a lane that never ran has agreed with nothing.

⚠️ THE PATH IS BARS-ONLY ON PURPOSE, AND THE REASON IS MEASURED. E-3 found the
local ``screener_rows`` snapshot a month stale (median row 2026-07-11), so every
scalar-bearing definition legitimately REFUSES at ``[gate:snapshot-stale]``. The
comparison here is ``close > sma(close, 50)`` — bars only, no snapshot columns —
so the acceptance path proves the round trip rather than working around a stale
artifact. The scalar spelling is covered by its own refusal case below.
"""
from __future__ import annotations

import contextlib
import datetime
import io
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile

import pytest

from api.services import alert_user_series
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import scan_definition
from api.services import user_definitions
from api.services.screener import scan_evaluator
from api.services.screener import scan_store
from api.services.screener import snapshot_db
from api.services.signature import ledger

# ⛔ THE PARSER'S LOCATION AND THE LOADER HOOK ARE IMPORTED, NOT RESTATED.
# `tests/test_scan_definition.py` already owns "where parse.js lives" and "how to
# make node import a `.json` manifest"; a second copy here would be a second
# authority over both, and the day the engine moves one of them this file would
# go on parsing a stale tree with every assertion green.
from tests.test_scan_definition import _JS_HOOK, LaneUnavailable, PARSE_JS, ROOT

#: ⛔ DERIVED FROM `PARSE_JS`, NOT SPELLED AGAIN. `budget.js` is `parse.js`'s
#: sibling; writing the whole path out a second time is a second authority over
#: where the engine's `ast` modules live.
BUDGET_JS = PARSE_JS.with_name("budget.js")

USER_ID = "e9-acceptance"
TF = scan_evaluator.DEFAULT_TF
SESSION_DATE = datetime.date(2026, 8, 7)
SESSION = SESSION_DATE.year * 10_000 + SESSION_DATE.month * 100 + SESSION_DATE.day

#: The three symbols the screen looks at. ⛔ SMALL AND DELIBERATELY MIXED: a hit
#: list equal to the universe would satisfy every assertion below while proving
#: nothing about `<ast> != 0` actually selecting.
UNIVERSE = ("NVDA", "AMD", "INTC")

#: ⭐ THE SHIPPED INDICATOR, AND THE COMPARISON ADDED TO IT. Two sources, one
#: definition row: `add_comparison` EDITS the first into the second through the
#: store's own write door, which is what "without the definition being
#: re-authored" means in the only place the phrase can be checked.
INDICATOR_SOURCE = "sma(close, 50)"
SCAN_SOURCE = "close > sma(close, 50)"

#: The scalar spelling of the same idea, and the one the closed table REFUSES.
#: design CORRECTION 1: `rsi` is not a table function; `rsi14` is the scalar.
REFUSED_SOURCE = "rsi(close, 14) > 70"
SCALAR_SOURCE = "rsi14 > 70"

DEF_ID = "u_0123456789ab"

# ─── the node lane ───────────────────────────────────────────────────────────
#
# ⚠️ ITS OWN DRIVER, AND THE DIFFERENCE IS THE POINT: this one returns the
# REFUSAL GUARD as well as the tree, because one of the cases below is a source
# the table must refuse BY NAME. `test_scan_definition`'s driver returns hashes
# for a corpus every member of which must parse.

_JS_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./hook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const parse = await import(pathToFileURL(payload.parse).href)

const budget = await import(pathToFileURL(payload.budget).href)

const rows = {}
for (const source of payload.sources) {
  const parsed = parse.parseFormula(source)
  if (!parsed.ok) {
    rows[source] = { ok: false, error: parsed.error, guard: parsed.guard, stage: 'parse' }
    continue
  }
  // ⛔ THE SECOND DOOR, AND IT IS THE ONE THAT REFUSES AN UNDECLARED FUNCTION.
  // `parseFormula` only CANONICALISES; `checkBudget` is what RESOLVES a call
  // against the closed table, which is why `evaluateFormula` runs both and why a
  // refusal test that stopped at the parser would report the wrong door.
  let resolved
  try {
    resolved = budget.checkBudget(parsed.ast, undefined)
  } catch (err) {
    resolved = { ok: false, guard: err && err.guard ? err.guard : 'resolve:node',
                 error: String(err && err.message ? err.message : err) }
  }
  rows[source] = resolved.ok
    ? { ok: true, ast: parsed.ast, hash: parse.astHash(parsed.ast) }
    : { ok: false, error: resolved.error, guard: resolved.guard, stage: 'resolve',
        ast: parsed.ast }
}
process.stdout.write(JSON.stringify({ ok: true, rows }))
"""

_SOURCES = (INDICATOR_SOURCE, SCAN_SOURCE, REFUSED_SOURCE, SCALAR_SOURCE)


@pytest.fixture(scope="module")
def parsed():
    """``{source: {ok, ast?, hash?, guard?}}`` from the SHIPPED parser, one boot."""
    exe = shutil.which("node")
    if not exe:
        raise LaneUnavailable("node is not on PATH")
    tmpdir = tempfile.mkdtemp(prefix="e9_acceptance_js_")
    try:
        for name, source in (("hook.mjs", _JS_HOOK), ("driver.mjs", _JS_DRIVER)):
            with io.open(os.path.join(tmpdir, name), "w",
                         encoding="utf-8", newline="\n") as fh:
                fh.write(source)
        proc = subprocess.run(
            [exe, os.path.join(tmpdir, "driver.mjs")], cwd=str(ROOT),
            input=json.dumps({"parse": str(PARSE_JS), "budget": str(BUDGET_JS),
                              "sources": list(_SOURCES)}),
            capture_output=True, text=True, encoding="utf-8", errors="replace")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    if proc.returncode != 0:
        raise LaneUnavailable(
            f"the JS lane exited {proc.returncode}: "
            f"{(proc.stderr or proc.stdout)[-1500:]}")
    return json.loads(proc.stdout)["rows"]


def _tree(parsed_rows, source):
    """The parsed tree for a source the table MUST accept."""
    row = parsed_rows[source]
    assert row["ok"], (
        f"{source!r} does not parse against the closed table — {row.get('error')!r}. "
        "An example formula is a CLAIM about the table (design CORRECTION 5); fix "
        "the corpus, not the assertion.")
    return row["ast"]


# ─── bars ────────────────────────────────────────────────────────────────────

def _daily_bars(n=80, end=SESSION_DATE, start_close=10.0, step=1.0):
    """`n` consecutive daily bars ending on `end`, as the bars store's tuples."""
    out = []
    for i in range(n):
        d = end - datetime.timedelta(days=n - 1 - i)
        key = d.year * 10_000 + d.month * 100 + d.day
        close = start_close + step * i
        out.append((key, close, close + 1, close - 1, close, 1_000_000))
    return out


@pytest.fixture
def wired(tmp_path, monkeypatch):
    """Every store this path writes to, pointed somewhere of this test's own.

    ⛔ PROVED, NOT ASSUMED. `SCREENER_DB_PATH` is asserted to have REACHED
    `snapshot_db`, because a module-level capture anywhere in that chain would
    send this whole file at the box's real `C:\\data` copies — which is the class
    of accident `tests/test_shared_data_root_guard.py` exists for.
    """
    screener = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(screener))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(screener), (
        "SCREENER_DB_PATH did not reach snapshot_db — a module-level capture has "
        "appeared and this file is writing somewhere else")
    scan_store.init_db()

    monkeypatch.setattr(user_definitions, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    monkeypatch.setattr(ias, "_DB_PATH", str(tmp_path / "alerts.db"))
    # `definition_record.db_path()` RESOLVES THROUGH `ledger._DB_PATH` at call
    # time rather than reading `SIGNAL_LEDGER_DB_PATH` a second time — that is
    # its own documented reason, and it is why this one patch covers the rule
    # record the sweep writes.
    monkeypatch.setattr(ledger, "_DB_PATH", str(tmp_path / "signal_ledger.db"))
    ias.init_schema()

    # ⭐ TWO RISING SYMBOLS AND ONE FALLING ONE. `close > sma(close, 50)` is true
    # for a series climbing away from its own average and false for one below it,
    # so the hit list is a PROPER SUBSET of the universe and the screen is
    # demonstrably selecting rather than answering 1 everywhere.
    table = {
        "NVDA": _daily_bars(start_close=10.0, step=1.0),
        "AMD": _daily_bars(start_close=20.0, step=0.5),
        "INTC": _daily_bars(start_close=200.0, step=-1.0),
    }
    from api.services import bars_sqlite

    def _get(ticker, tf, max_bars):
        return list(table.get(str(ticker).upper()) or [])[-max_bars:]

    monkeypatch.setattr(bars_sqlite, "get_bars", _get)

    # The alert lane registers value functions in a MODULE-LEVEL registry keyed
    # by (user, address). Leaving one behind would let a later test resolve this
    # file's formula, so it is cleared on both sides.
    alert_user_series.USER_FUNCS.clear()
    yield table
    alert_user_series.USER_FUNCS.clear()


# ─── the document, and the four doors ────────────────────────────────────────

def _document(tree, *, def_id=DEF_ID, name="Above the 50"):
    """A schema-v1 `ast` document around a parsed tree.

    ⛔ `compute.fn` IS THE TREE'S OWN HASH, taken here rather than typed: it is
    the same number `defSchema.validateAstCompute` requires on the client and
    `scan_definition.def_hash` re-checks on the server.
    """
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": name, "shortName": "A50", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree, "fn": user_definitions.ast_hash(tree),
                    "rev": 1},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def a_shipped_ast_definition(parsed_rows, source=INDICATOR_SOURCE, *, def_id=DEF_ID):
    """Save an indicator as an `ast` definition, through the ONE write door.

    ⚠️ "SHIPPED" MEANS THE MATHS THIS REPO SHIPS, NOT A ROW IN `AST_DEFS`.
    `nativeRegistry.AST_DEFS` is DELIBERATELY EMPTY — a repo-authored `ast`
    definition would be "a native wearing a formula", the same maths the native
    lane already computes with an interpreter between it and the screen. So the
    honest reading of §A2.5's "any shipped indicator definition" is: the shipped
    `sma`, expressed on the lane a member can extend, parsed by the shipped
    parser and stored by the shipped store.
    """
    doc = _document(_tree(parsed_rows, source), def_id=def_id)
    user_definitions.save(USER_ID, def_id, doc)
    return user_definitions.get(USER_ID, def_id)["definition"]


def add_comparison(parsed_rows, indicator, source=SCAN_SOURCE):
    """Turn an indicator into a condition — SAME row, next version, no new object.

    ⛔ THIS IS THE STEP §A2.5 IS ABOUT. `user_definitions.save` with the SAME
    `def_id` APPENDS A VERSION and bumps `compute.rev` iff the maths moved; it
    does not mint a second definition. A path that created one here would still
    scan, chart and alert correctly — and `_definition_rows_for` is the only
    assertion in this file that could tell.
    """
    def_id = indicator["id"]
    doc = _document(_tree(parsed_rows, source), def_id=def_id)
    user_definitions.save(USER_ID, def_id, doc)
    return user_definitions.get(USER_ID, def_id)["definition"]


def astHash_of(definition):
    """The hash of a definition's own TREE — the server-side mirror of `astHash`."""
    return user_definitions.ast_hash(definition["compute"]["ast"])


def chart_payload_for(symbol, *, definition):
    """What the chart is handed when a member clicks a scan hit.

    ⛔ THE HASH IS READ BACK OUT OF THE STORE, NEVER COPIED OFF THE ARGUMENT.
    The click carries a symbol and a definition id; the chart draws whatever
    `/api/user-definitions` answers with for that id — `useUserDefinitions` →
    `installUserDefinitions`, the door Phase D Task 16 opened. A step that
    re-authored between the scan and the chart would answer with a different
    tree, and only a read-back can see it.
    """
    row = user_definitions.get(USER_ID, definition["id"])
    assert row is not None, (
        f"the store has no live definition at {definition['id']!r} — the chart "
        "would have nothing to install")
    doc = row["definition"]
    return {
        "symbol": symbol,
        "def_id": definition["id"],
        # `scan_definition.def_hash` re-checks `compute.fn` against the tree, so
        # a document whose stored handle drifted is refused here rather than
        # charted under the previous formula's name.
        "def_hash": scan_definition.def_hash(doc),
        "definition": doc,
    }


def arm_alert_on(definition, *, symbol):
    """Arm an alert through the SHIPPED create path (Phase D Task 12).

    `indicator_alert_service.create` calls `alert_user_series.arm_for_alert`
    BEFORE the insert, which runs the stored-repaint gate, the budget-at-this-
    version gate and the 1e-9 cross-lane equality on this symbol's real bars. So
    an alert that exists is one the two lanes agreed about.

    ⛔ AND THE HASH COMES BACK THROUGH THE ALERT'S OWN STORED ADDRESS. The row
    holds `u_<id>.<plotKey>`; this resolves that address the way the evaluator
    does and hashes the document it lands on. An alert armed on some other
    object would answer with some other hash.
    """
    plot_key = definition["plots"][0]["key"]
    address = f"{definition['id']}.{plot_key}"
    # ⛔ THE CONDITION IS DERIVED FROM THE ADDRESS THE USER LANE ITSELF COPIES.
    # `alert_user_series.user_catalog` offers a user formula the condition list of
    # `close` — "the one address in the table with exactly that shape" — so
    # retyping "above" here would be the twin that module deleted.
    condition = ev.ALERT_CONDITIONS["close"][0]["value"]
    alert_id = ias.create(USER_ID, symbol, address, condition, 0.5, TF)
    row = ias.get(alert_id)
    assert row is not None, "the alert lane returned an id it cannot read back"
    def_id, _plot = alert_user_series.split_user_address(row["indicator"])
    doc = user_definitions.get(USER_ID, def_id)["definition"]
    return {
        "alert_id": alert_id,
        "address": address,
        "def_source": row.get("def_source"),
        "def_hash": scan_definition.def_hash(doc),
    }


def _definition_rows_for(ast_hash_value):
    """How many rows the definition store holds under this hash.

    ⛔ DERIVED FROM THE STORE, NOT A COUNT KEPT IN THE TEST. `user_definitions`
    stores `ast_hash` as its own column, so "how many objects carry this maths"
    is a question the table can answer — and a test that incremented a counter
    each time it called `save` would agree with itself no matter what the store
    did.
    """
    with contextlib.closing(sqlite3.connect(user_definitions._DB_PATH)) as c:
        return c.execute(
            "SELECT COUNT(*) FROM user_definitions WHERE ast_hash=?",
            (ast_hash_value,)).fetchone()[0]


# ═══ the acceptance path ════════════════════════════════════════════════════

def test_the_PINE_SCREENER_PARITY_PATH__one_definition_at_every_step(wired, parsed, capsys):
    """🔴 AMENDMENT 2 §A2.5, STATED AS AN ACCEPTANCE CRITERION.

    Indicator → comparison → scan → chart → alert, and ONE `def_hash` the whole
    way. ⛔ The four reads are printed side by side because a report that says
    "they matched" and a report that shows four identical 71-character strings
    are different documents to whoever reads this next.
    """
    indicator = a_shipped_ast_definition(parsed)
    scan = add_comparison(parsed, indicator)
    h = scan["compute"]["fn"]
    assert h == astHash_of(scan)

    # ⛔ AND THE COMPARISON REALLY IS A DIFFERENT FORMULA. Without this the whole
    # path could be running the indicator and every hash would still agree.
    assert h != indicator["compute"]["fn"]

    result = scan_evaluator.evaluate_one(scan, TF, universe=UNIVERSE, as_of=SESSION)
    assert result["def_hash"] == h
    assert result["hits"], "the acceptance path needs at least one hit to chart"
    # The screen SELECTS. A hit list equal to the universe would make every
    # assertion below true of a formula that answers 1 for everything.
    assert set(result["hits"]) < set(UNIVERSE)
    # And it answered every symbol it looked at — so "INTC is not a hit" is a
    # NEGATIVE ANSWER rather than a symbol that fell out of the sweep.
    assert result["answered"] == len(UNIVERSE)
    assert result["evaluated"] == (result["answered"] + result["dropped"]
                                   + result["not_computable"])

    charted = chart_payload_for(result["hits"][0], definition=scan)
    assert charted["def_hash"] == h
    assert charted["symbol"] == result["hits"][0]

    armed = arm_alert_on(scan, symbol=result["hits"][0])
    assert armed["def_hash"] == h
    # The alert lane recognised it as a USER definition rather than a builtin —
    # i.e. `arm_for_alert` really ran the admission gates on this document.
    assert armed["def_source"] == ias.DEF_SOURCE_USER
    # ⭐ AND THE ADMISSION CHAIN COMPLETED, not merely "did not raise".
    # `admit_user_definition` registers ONE value function per plot, and it does
    # that only AFTER `_gate_cross_lane` has proved the JS and Python lanes agree
    # at 1e-9 on THESE bars. The registry entry is the artifact of that proof.
    assert alert_user_series.scoped_key(USER_ID, armed["address"]) in \
        alert_user_series.USER_FUNCS

    # ⛔ AND NOTHING WAS RE-AUTHORED. One row in the definition store for the
    # whole path — derived from the store, not from a count kept in the test.
    assert _definition_rows_for(h) == 1

    # ⚠️ ASCII ONLY. This console is cp1252 and a box-drawing character in a
    # `capsys.disabled()` print raises `UnicodeEncodeError` — which fails the
    # test for a reason that has nothing to do with what it measures.
    with capsys.disabled():
        print("\n  -- A2.5: one definition, four surfaces --------------------")
        print(f"  builder / store : {h}")
        print(f"  screener        : {result['def_hash']}")
        print(f"  chart           : {charted['def_hash']}")
        print(f"  alert           : {armed['def_hash']}")
        print(f"  store rows @ h  : {_definition_rows_for(h)}"
              f"   (indicator's own hash: {_definition_rows_for(indicator['compute']['fn'])})")
        print(f"  hits            : {result['hits']} of {list(UNIVERSE)}")


def test_the_EDIT_APPENDS_A_VERSION_rather_than_minting_a_second_definition(wired, parsed):
    """⭐ WHY `_definition_rows_for(h) == 1` IS THE ASSERTION THAT MATTERS.

    The store is APPEND-ONLY: the indicator and the scan are two VERSIONS of one
    `def_id`, so the table holds two rows — one per hash — and the definition the
    chart and the alert resolve is the newest live one. A path that "added a
    comparison" by saving a second definition would leave the same four hashes
    agreeing and TWO rows under `h`.
    """
    indicator = a_shipped_ast_definition(parsed)
    scan = add_comparison(parsed, indicator)

    assert scan["id"] == indicator["id"], "the edit moved to a different address"
    history = user_definitions.history(USER_ID, indicator["id"])
    assert [row["version"] for row in history] == [1, 2]
    assert [row["ast_hash"] for row in history] == [
        indicator["compute"]["fn"], scan["compute"]["fn"]]
    # ⚠️ `rev` MOVED BECAUSE THE MATHS MOVED, and E-3 reads it off the definition
    # to key the rule record. A rev that had not bumped would file the new
    # formula's tallies under the old revision.
    assert user_definitions.get(USER_ID, indicator["id"])["rev"] == 2

    assert len(user_definitions.list_for_user(USER_ID)) == 1, (
        "the member ended the path holding more than one formula")


def test_the_SCAN_SURFACE_and_the_CHART_read_the_SAME_ROW(wired, parsed):
    """The hop the frontend wire-cut test cannot reach: the store's own answer.

    `ScanToChart.wire.test.jsx` proves the browser hands the chart the definition
    the scan ran. This proves the thing on the other side of that hop: the id the
    click carries resolves, in the store, to the document whose hash the sweep
    filed its receipt under.
    """
    scan = add_comparison(parsed, a_shipped_ast_definition(parsed))
    h = scan["compute"]["fn"]
    result = scan_evaluator.evaluate_one(scan, TF, universe=UNIVERSE, as_of=SESSION)

    receipt = scan_store.coverage(h, TF, SESSION)
    assert receipt is not None, "the sweep wrote no receipt to join against"
    # ⚠️ SETS, AND THE DIFFERENCE IS REAL RATHER THAN COSMETIC. The envelope
    # returns hits in UNIVERSE order (the order the sweep walked); the store
    # returns them in its own index order. Asserting list equality would pin an
    # ordering neither side declares, and the claim here is membership.
    assert set(scan_store.hits(h, TF, SESSION)) == set(result["hits"])

    charted = chart_payload_for(result["hits"][0], definition=scan)
    assert charted["def_hash"] == h
    assert charted["definition"]["compute"]["ast"] == scan["compute"]["ast"]


def test_a_symbol_the_screen_could_not_ANSWER_is_not_a_hit(wired, parsed):
    """⛔ A CHART OPENED FROM A NOT-COMPUTABLE HIT MUST NOT IMPLY WE HAD DATA.

    E-3's envelope has FOUR outcomes. A symbol with no bars is DROPPED — it is
    named in `dropped_symbols` with its reason and it is NOT in `hits`, so the
    surface has nothing to offer a chart button for. Asserted here rather than
    assumed because the scan → chart loop's whole honesty rests on `hits` meaning
    "answered true", not "did not obviously fail".
    """
    scan = add_comparison(parsed, a_shipped_ast_definition(parsed))
    universe = tuple(UNIVERSE) + ("NOBARS",)
    result = scan_evaluator.evaluate_one(scan, TF, universe=universe, as_of=SESSION)

    assert "NOBARS" not in result["hits"]
    assert result["dropped"] == 1
    reasons = {row["ticker"]: row["reason"] for row in result["dropped_symbols"]}
    assert reasons["NOBARS"] == "no-bars"
    assert result["evaluated"] == (result["answered"] + result["dropped"]
                                   + result["not_computable"])


# ═══ the refusals the path must keep ════════════════════════════════════════

def test_the_comparison_uses_a_function_THE_TABLE_DECLARES__rsi_REFUSES(
        wired, parsed):
    """🔴 DESIGN CORRECTION 1, AND MUTATION M5's REASON.

    `rsi(close, 14)` is not a table function and refuses at `resolve:function`;
    `rsi14` is the SCALAR, which is a different and equally legal way to write
    the same idea. A per-bar `rsi()` is not, and E-A9 — new FUNCTIONS in the
    closed table — is out of scope for this task precisely because adding one
    touches the repaint linter's central guarantee.

    ⛔ SO A "FIX" THAT MADE THE ACCEPTANCE PATH USE `rsi(close, 14)` WOULD BUNDLE
    E-A9, and this case is what says so out loud rather than leaving the next
    agent to discover it from a green suite.

    ⚠️ AND IT REFUSES AT THE **RESOLVE** DOOR, NOT AT THE PARSER — measured, and
    the correction is worth carrying: `parseFormula` CANONICALISES and happily
    returns a `call` node named `rsi`; `checkBudget` is what resolves that name
    against the closed table. A refusal test that stopped at `parseFormula` would
    have reported "it parses" and concluded the table had grown a function.
    """
    refused = parsed[REFUSED_SOURCE]
    assert refused["ok"] is False, (
        f"{REFUSED_SOURCE!r} RESOLVED — the closed table has grown a per-bar `rsi` "
        "and E-A9 shipped without its own phase")
    assert refused["stage"] == "resolve", refused
    assert refused["guard"] == "resolve:function", refused
    assert "rsi" in str(refused["error"])

    # ⭐ AND THE PYTHON LANE REFUSES THE SAME TREE AT THE SAME GATE. One of the
    # two lanes accepting a function the other does not is the cross-lane
    # divergence the 1e-9 conformance rail exists to make impossible, and a
    # refusal is as much a result as a number (E-2's closed-table doctrine).
    with pytest.raises(scan_evaluator.ast_interpret.TableRefusal) as low:
        scan_evaluator.ast_interpret.max_lookback(refused["ast"])
    assert low.value.guard == "resolve:function"

    # …and the sweep therefore refuses the whole run rather than dropping 3,742
    # symbols one at a time.
    doc = _document(refused["ast"])
    with pytest.raises(scan_evaluator.ScanRunRefused) as run:
        scan_evaluator.evaluate_one(doc, TF, universe=UNIVERSE, as_of=SESSION)
    assert run.value.gate == "not-scannable"

    # …and the scalar spelling is legal, so the refusal is about the FUNCTION
    # rather than about the idea.
    assert parsed[SCALAR_SOURCE]["ok"] is True


def test_a_SCALAR_bearing_scan_REFUSES_ON_A_STALE_SNAPSHOT_rather_than_answering(
        wired, parsed):
    """⚠️ WHY THIS FILE'S HAPPY PATH IS BARS-ONLY, ASSERTED RATHER THAN ASSUMED.

    E-3's `_assert_snapshot_is_current` reads the MEDIAN `screener_rows` date and
    refuses a sweep whose snapshot does not describe the session being screened.
    With no snapshot at all — which is this fixture, and which is also what a
    fresh pod looks like — a scalar-bearing definition refuses BY GATE.

    ⛔ AND THAT IS THE HONEST OUTCOME, NOT A GAP IN THE ACCEPTANCE PATH. A screen
    that answered `rsi14 > 70` off July's fundamentals for an August session
    would return a confident, wrong list. The gate firing here is the reason the
    §A2.5 path above uses a bars-only comparison instead of quietly making the
    demo green.
    """
    scan = _document(_tree(parsed, SCALAR_SOURCE))
    user_definitions.save(USER_ID, DEF_ID, scan)
    stored = user_definitions.get(USER_ID, DEF_ID)["definition"]

    with pytest.raises(scan_evaluator.ScanRunRefused) as excinfo:
        scan_evaluator.evaluate_one(stored, TF, universe=UNIVERSE, as_of=SESSION)
    assert excinfo.value.gate == "snapshot-stale", excinfo.value.gate

    # Nothing was written — a half-run that left a receipt would be
    # indistinguishable from a quiet market.
    assert scan_store.coverage(stored["compute"]["fn"], TF, SESSION) is None
