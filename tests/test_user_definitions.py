"""Phase D Task 10 — persistence: its own store, append-only, and an edit that
CALLS Phase C's force-migration.

⭐ THE ONE INVARIANT THIS FILE EXISTS TO PROVE: when a user edits their own
formula's MATHS, the alerts bound to it are force-migrated through the mechanism
Phase C already built, and the first cycle after that edit is QUIET — quiet
BECAUSE OF THE SUPPRESSION, not because something else happened to refuse.

⚠️ THAT LAST CLAUSE IS THE WHOLE POINT OF `_ATTRIBUTION` BELOW. The defect this
branch has produced four times is "refused by a different door": a correct
NUMBER produced by the wrong MECHANISM. A migration that appears to work because
the evaluator has never heard of the address, or because the reset already ate
the crossing, would read exactly like a migration that works. So every quiet
first cycle in this file is paired with a run in which the thing claimed
responsible is DELETED and the cycle goes noisy.
"""
from __future__ import annotations

import ast
import io
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
import types
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import alert_series
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc
from api.services import watchlist_alert_service as wls

ROOT = Path(__file__).resolve().parents[1]
PARITY_BARS = ROOT / "app" / "src" / "pages" / "parityBars" / "intraday5m.json"
CHART_DEFAULTS_JS = ROOT / "app" / "src" / "components" / "chart" / "chartDefaults.js"
REGISTRY_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "nativeRegistry.js"
PARSE_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "parse.js"

# ⭐ THE REAL GAP A USER EDIT OPENS, ON REAL BARS. The stored formula averages 20
# bars; the user widens it to 50. On the chart-parity intraday fixture the old
# maths reads 112.6850 and the new one reads 111.4522 — $1.23 apart — and an
# alert armed at "below 112" fires the instant the edit lands even though no bar
# moved. That is the fabricated crossing, authored by a user instead of a deploy.
REV1_SMA = 112.6850     # sma(close, 20) — what a stored `last_value` holds
REV2_SMA = 111.4522     # sma(close, 50) — what the edited formula returns
STRADDLE = 112.0        # a threshold strictly between the two

USER = "u1"


# ─── helpers ─────────────────────────────────────────────────────────────────

def _bars() -> list[dict]:
    payload = json.loads(PARITY_BARS.read_text(encoding="utf-8"))
    return [dict(b) for b in payload["bars"]]


def _sma(bars: list[dict], period: int):
    """The average on the LAST bar — the forming lane's shape.

    ⛔ DERIVED FROM `_sma_column`, NOT A SECOND IMPLEMENTATION. The two lanes are
    fed from one arithmetic on purpose: hand-writing the scalar beside the column
    is how a LANE difference would quietly become an ARITHMETIC difference, and
    then `_unmigrated_fires`' per-lane table would be describing a rounding bug.
    """
    column = _sma_column(bars, period)
    return column[-1] if column else None


def _sma_column(bars: list[dict], period: int) -> list:
    """The SAME average as `_sma`, as a FULL COLUMN aligned to ``bars``.

    ⛔ THE CLOSED LANE DOES NOT READ A VALUE FUNCTION AT ALL. `_evaluate_one`
    resolves through `value_function()` (the three `ADDRESS_PARTITIONS`), but
    `_evaluate_one_closed` resolves through `alert_series.series_function()` and
    indexes the answer by BAR (`series[i]`, `series[i-1]`). An address registered
    only in `INDICATOR_FUNCS` is therefore INVISIBLE to the closed lane, and
    `_evaluate_one_closed` returns `(None, False, None)` for it — a quiet cycle
    that says nothing about any migration. That is the exact "refused by a
    different door" defect this file's header names, and it is why
    `_register_address` registers BOTH tables from this ONE function: two
    hand-written implementations could disagree about the number, and then a
    lane difference would be an arithmetic difference wearing a lane costume.
    """
    closes = [b["c"] for b in bars]
    return [None if i + 1 < period
            else round(sum(closes[i + 1 - period:i + 1]) / period, 4)
            for i in range(len(closes))]


def _ast_sma(period: int) -> dict:
    return {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"},
        {"type": "num", "value": period},
    ]}


def defn(period: int = 20, *, name: str = "My Average", pad: int = 0,
         def_id: str = "u_000000000001") -> dict:
    """A schema-v1, `compute.kind: 'ast'` user definition."""
    d = {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": name, "shortName": "MA", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": _ast_sma(period)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }
    if pad:
        d["meta"]["description"] = "x" * pad
    return d


# ─── the node lane ───────────────────────────────────────────────────────────
#
# ⚠️ NODE, NOT A SOURCE-TEXT GUARD. Three claims in this file are about SHIPPED
# JAVASCRIPT — what `mergeChartSettings` destroys, which ids the live registry
# holds, and what `astHash` computes. A regex over those files cannot tell a
# deleted line from a renamed one (`chartDefaults.js:395` says so in its own
# comment), so all three RUN the shipped module.
#
# The hook is two customisations and nothing else: extensionless relative
# specifiers get `.js` appended (vite resolves them, a bare node does not), and
# a `.json` URL loads as a module whose default export is the parsed document
# (`parse.js` imports `closedTable.json`, which node >= 22 refuses without an
# import attribute — the same shim `tools/ast_conformance.py` carries, and for
# the same reason). It rewrites no source, so the lane runs the shipped file.
_JS_HOOK = r"""
import { readFile } from 'node:fs/promises'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
    for (const ext of ['.js', '/index.js']) {
      try {
        const r = await nextResolve(specifier + ext, context)
        if (r) return r
      } catch { /* fall through to the next candidate */ }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${source}\n` }
  }
  return nextLoad(url, context)
}
"""

_JS_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./hook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const merge = await import(pathToFileURL(payload.chartDefaults).href)
const registry = await import(pathToFileURL(payload.registry).href)
const parse = await import(pathToFileURL(payload.parse).href)

const merged = merge.mergeChartSettings(payload.blob)
const hashes = []
for (const tree of payload.trees) {
  try {
    hashes.push({ ok: true, hash: parse.astHash(tree) })
  } catch (err) {
    hashes.push({ ok: false, error: String(err && err.message || err) })
  }
}

process.stdout.write(JSON.stringify({
  ok: true,
  mergedKeys: Object.keys(merged),
  chartType: merged.chartType,
  registryIds: registry.listDefinitions().map((d) => d.id),
  hashes,
}))
"""


class LaneUnavailable(RuntimeError):
    """The node lane could not run. NOT a skip: a lane that cannot run has not
    agreed with anything, and three of this file's claims are only checkable
    there."""


def _node_exe() -> str:
    exe = shutil.which("node")
    if not exe:
        raise LaneUnavailable("node is not on PATH")
    return exe


def _js(payload: dict) -> dict:
    """One node process, payload on STDIN.

    ⛔ STDIN, NEVER `-e`. A `-e` string carrying a formula SPLIT under cmd.exe on
    this branch and selected ten of the wrong things. And the reader is pinned
    `encoding='utf-8'`: without it Python decodes the child as cp1252 and a
    single box-drawing character raises inside the reader thread — which on this
    branch once left a mutation applied on disk.
    """
    tmpdir = tempfile.mkdtemp(prefix="user_definitions_js_")
    try:
        for name, source in (("hook.mjs", _JS_HOOK), ("driver.mjs", _JS_DRIVER)):
            with io.open(os.path.join(tmpdir, name), "w",
                         encoding="utf-8", newline="\n") as fh:
                fh.write(source)
        proc = subprocess.run(
            [_node_exe(), os.path.join(tmpdir, "driver.mjs")], cwd=str(ROOT),
            input=json.dumps(payload), capture_output=True, text=True,
            encoding="utf-8", errors="replace")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    if proc.returncode != 0:
        raise LaneUnavailable(
            f"the JS lane exited {proc.returncode}: {(proc.stderr or proc.stdout)[-1500:]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise LaneUnavailable(
            f"the JS lane printed something that is not JSON: {exc}; "
            f"stdout was {proc.stdout[:400]!r}") from exc


_JS_TREES = [
    _ast_sma(20),
    _ast_sma(50),
    {"type": "series", "name": "close"},
    {"type": "num", "value": 20.0},          # an INTEGRAL FLOAT — the divergence
    {"type": "num", "value": -1.5},
    {"type": "op", "name": "+", "args": [
        {"type": "num", "value": 1}, {"type": "call", "name": "ema", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": 9}]}]},
    {"type": "call", "name": "sma", "args": [
        {"type": "num", "value": 1}, {"type": "series", "name": "close"}]},
    {"type": "num", "value": True},          # a BOOL — both lanes must REFUSE
    {"type": "num", "value": 1, "extra": 2},  # a non-canonical node
]


@pytest.fixture(scope="module")
def js():
    return _js({
        "chartDefaults": str(CHART_DEFAULTS_JS),
        "registry": str(REGISTRY_JS),
        "parse": str(PARSE_JS),
        "blob": {"userDefinitions": [{"id": "u_abc"}], "chartType": "line"},
        "trees": _JS_TREES,
    })


# ─── the store's own fixture ─────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    """The definition store — AND the alert DB the rev-migration reads.

    ⚠️ THIS FIXTURE USED TO REPOINT ONLY `svc._DB_PATH`, AND SIX TESTS PASSED
    BECAUSE OF POLLUTION. A rev-bumping `save()` calls the force-migration, which
    reads `indicator_alerts` out of `ias._DB_PATH` — left at the default, that is
    the shared `C:\\data\\auth.db` (964 MB, ~20k users), where the alert SOAK had
    happened to leave a real `indicator_alerts` table. The tests were reading
    another suite's residue and calling it a fixture.

    They surfaced the moment `conftest.py` started isolating `AUTH_DB_PATH` for
    real — i.e. the isolation did not break them, it revealed that they had never
    been passing on their own. `env` twelve lines below already did this
    correctly; `store` now matches it.

    ⛔ `AUTH_DB_PATH` alone is NOT enough: six product modules capture that env var
    at IMPORT, so setting it after the import does nothing. The attribute is what
    has to move.
    """
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()

    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


@pytest.fixture
def env(tmp_path, monkeypatch):
    """The store, a real alert DB, real bars, and a spy on the ONE transport.

    ⭐ THE SPY IS ON THE TRANSPORT, NOT ON THE MIGRATION. `save()` has no
    injection point for either the migration or the notifier on purpose
    (`lesson_injected_dependency_hides_the_fetch`: 996 green tests shipped a
    feature that ran in 0 of 24 charts because every test handed in a fake). What
    is patched here is the same function a real delivery goes through.
    """
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()

    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()

    bars = _bars()
    state = {"period": 20}

    def _fetch(sym, tf, count=200):
        return [dict(b) for b in bars]

    monkeypatch.setattr(ev, "_fetch_bars_for_alert", _fetch)

    sent: list[dict] = []
    monkeypatch.setattr(wls, "deliver_alert_payload",
                        lambda **kwargs: sent.append(kwargs))

    # ⛔ THE LANE IS NAMED, NEVER INHERITED FROM THE PROCESS DEFAULT.
    #
    # `ALERT_EVAL_MODE` is a CUTOVER LEVER: it moved forming -> closed in
    # `0183a9b1` and the Railway variable can move it back with no deploy. A test
    # that reads whichever lane happens to be committed is a test whose meaning
    # changes under it — which is exactly what happened: the cutover landed and
    # four tests in this section went red overnight without a line of them
    # changing. So the fixture pins `"forming"` as the file's DEFAULT (it is the
    # lane `alert_rev_migration`'s reset was designed against, and the lane the
    # rollback restores) and section 4 OVERRIDES it per-lane, so both are
    # measured and neither is assumed.
    #
    # ⚠️ THE PIN IS NOT WHAT MADE THE FOUR TESTS PASS AGAIN, AND THE DIFFERENCE
    # MATTERS. Measured on this tree: with the address registered in BOTH lanes'
    # tables (see `_register_address`), the closed lane honours every guarantee
    # this section states — the first post-edit cycle is quiet, the second is
    # correct, deleting the suppression makes the first cycle noisy, and a rename
    # eats nothing. What the closed lane changes is the SHAPE of the fabricated
    # fire, not whether one exists: `prev` comes from `series[i-1]` on one
    # version's own column, so the CROSSING half is unreachable, while the LEVEL
    # half (`below` never reads `prev`) still fires on the moved anchor. The
    # suppression is what covers that half, on BOTH lanes.
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    return {"bars": bars, "sent": sent, "state": state, "db": alert_db,
            "monkeypatch": monkeypatch}


DEF_ID = "u_0123456789ab"


def _register_address(env, def_id: str = DEF_ID):
    """Make the user's definition EVALUABLE ON EITHER LANE, and say why that is
    not cheating.

    ⛔ WITHOUT THIS THE WHOLE MEASUREMENT IS A WRONG DOOR. `value_function`
    answers `None` for an address it has never heard of, `_evaluate_one` returns
    `(None, False)`, and every cycle is quiet whatever the migration did — a
    green suppression test measuring nothing. `test_the_quiet_is_NOT_the_wrong_
    door` runs the same scenario WITHOUT this registration and shows the cycle
    stays quiet even with the suppression deleted, which is what makes this
    helper load-bearing rather than convenient.

    ⛔⛔ AND IT REGISTERS TWO TABLES, BECAUSE THE TWO LANES RESOLVE AN ADDRESS
    THROUGH DIFFERENT ONES. This helper used to seed `INDICATOR_FUNCS` alone.
    That is the forming lane's table (`value_function` walks
    `ADDRESS_PARTITIONS`); `_evaluate_one_closed` never consults it — it asks
    `alert_series.series_function()` and then `_user_value_function(...).column`.
    So the moment `0183a9b1` flipped `ALERT_EVAL_MODE` to `"closed"`, this
    helper silently stopped registering anything the running lane could see, and
    four tests in section 4 went quiet FOR THE WRONG REASON — the very defect
    the paragraph above exists to prevent, arriving through the helper written
    to prevent it. MEASURED, not reasoned: under the closed lane with only
    `INDICATOR_FUNCS` seeded, `_evaluate_one_closed` returns `(None, False,
    None)` and `_run_one_cycle` reports `evaluated: 0`.

    ⚠️ IT IS NOT "THE CLOSED LANE HAS NO CLOSED BAR". On these fixture bars
    `closed_bar_index` answers index 578 — the LAST of the 579 — because the
    parity fixture is months old, so every bar is closed by the clock and the
    judged bar is `bars[-1]`, the same bar the forming lane reads. The quiet was
    address resolution, and nothing else.
    """
    def _fn(bars, params):
        return _sma(bars, env["state"]["period"])

    def _col(bars, params):
        return _sma_column(bars, env["state"]["period"])

    env["monkeypatch"].setitem(ev.INDICATOR_FUNCS, def_id, _fn)
    env["monkeypatch"].setitem(alert_series.SERIES_FUNCS, def_id, _col)


def _arm(alert_id: int, *, last_value, last_evaluated_at):
    con = sqlite3.connect(str(ias._DB_PATH))
    try:
        con.execute(
            "UPDATE indicator_alerts SET last_value=?, last_evaluated_at=? WHERE id=?",
            (last_value, last_evaluated_at, int(alert_id)))
        con.commit()
    finally:
        con.close()


def _armed_pair(*, armed_at: int, def_id: str = DEF_ID) -> tuple[int, int]:
    """One crossing binding and one LEVEL binding, both holding the old number.

    ⚠️ THE LEVEL BINDING IS THE HALF THE RESET CANNOT COVER. With `last_value`
    NULL the `cross_*` branches return False, so a test built only from crossings
    goes green with the suppression deleted.
    """
    cross = ias.create(user_id=USER, sym="PARITY", indicator=def_id,
                       condition="cross_below", threshold=STRADDLE, tf="5")
    level = ias.create(user_id=USER, sym="PARITY", indicator=def_id,
                       condition="below", threshold=STRADDLE, tf="5")
    for aid in (cross, level):
        _arm(aid, last_value=REV1_SMA, last_evaluated_at=armed_at)
    return cross, level


def _fires(sent: list[dict]) -> list[int]:
    return [s["extra_data"]["alert_id"] for s in sent
            if s.get("source") == "indicator_alert"]


def _notices(sent: list[dict]) -> list[dict]:
    return [s for s in sent if s.get("source") == "indicator_alert_migration"]


# ═══ 1. the store is not `chart_settings`, and here is the proof ═════════════

def test_a_definition_does_NOT_live_in_chart_settings_and_here_is_the_proof(js):
    """⛔ MEASURED, NOT ASSUMED. `mergeChartSettings` is a hard allow-list — the
    key set of its own return literal — and a key absent from it is DESTROYED ON
    EVERY READ. `engineEnabled` was deleted that way ON PURPOSE, at seven sites,
    precisely because the mechanism works.

    So a user definition stored under a new `chart_settings` key would survive
    exactly until the next read, and nothing would say so.
    """
    assert "userDefinitions" not in js["mergedKeys"]
    # The control: the merge RAN and it SAW the input. Without this, "the key is
    # gone" is satisfied by a merge that returned the defaults for any reason —
    # a parse failure, a wrong argument shape, an early return.
    assert js["chartType"] == "line", (
        "the merge did not read the blob at all, so its silence about "
        "`userDefinitions` says nothing")
    assert len(js["mergedKeys"]) > 20, js["mergedKeys"]


def test_the_store_is_its_OWN_sqlite_file_and_names_no_preferences_path():
    """`user_preferences` HAS NO SIZE LIMIT AND NO DELETE ROUTE — measured. This
    store is not that store, and the separation is asserted by what the module
    does not name.
    """
    assert svc._DB_PATH.endswith("user_definitions.db")
    src = Path(svc.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    # ⚠️ STRING CONSTANTS ONLY, NEVER A GREP. The docstring above discusses
    # `chart_settings` and `user_preferences` by name on purpose; a substring
    # scan would fail on the prose that explains the rule.
    literals = {n.value for n in ast.walk(tree)
                if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    forbidden = {"chart_settings", "charts_workspace_layout", "user_preferences"}
    assert not (literals & forbidden), literals & forbidden
    # The control: the scan CAN see a name, so the empty intersection is a
    # measurement rather than a broken walk.
    assert "user_definitions" in " ".join(literals)


# ═══ 2. append-only ═════════════════════════════════════════════════════════

def test_every_save_appends_a_version_and_NOTHING_is_updated_in_place(store):
    """Spec §3.1: alerts, screens and the ledger pin `defId@version` freely. A
    pin is only free if the row it points at cannot change under it.
    """
    v1 = svc.save(USER, DEF_ID, defn(20, name="My Average", def_id=DEF_ID))
    v2 = svc.save(USER, DEF_ID, defn(20, name="renamed", def_id=DEF_ID))
    assert (v1["version"], v2["version"]) == (1, 2)
    assert svc.get(USER, DEF_ID, version=1)["definition"]["meta"]["name"] \
        != svc.get(USER, DEF_ID, version=2)["definition"]["meta"]["name"]
    assert svc.get(USER, DEF_ID, version=1)["definition"]["meta"]["name"] == "My Average"


def test_N_saves_leave_N_ROWS_and_the_file_carries_NO_TRIGGER(store):
    """⭐ THE APPEND-ONLY INVARIANT, MEASURED ON THE FILE.

    Row count is the direct half. The trigger census is the other half: a
    trigger could rewrite or delete a row without any statement in this module
    doing so, which would make "no UPDATE in the source" true and the invariant
    false at the same time.
    """
    names = ["v1", "v2", "v3", "v4"]
    for i, name in enumerate(names):
        svc.save(USER, DEF_ID, defn(20 + i, name=name, def_id=DEF_ID))
    con = sqlite3.connect(svc._DB_PATH)
    try:
        rows = con.execute(
            "SELECT version, rev FROM user_definitions WHERE def_id=? ORDER BY version",
            (DEF_ID,)).fetchall()
        triggers = con.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger'").fetchall()
    finally:
        con.close()
    assert [r[0] for r in rows] == [1, 2, 3, 4]
    assert triggers == [], f"the store carries a trigger: {triggers}"


def test_the_MODULE_ISSUES_NO_UPDATE_STATEMENT_and_the_scan_can_see_one():
    """⛔ BY AST OVER THE MODULE'S OWN SOURCE, NEVER BY GREP. Its docstring says
    the word UPDATE three times on purpose, and a grep on this branch has
    counted comments in both directions.
    """
    tree = ast.parse(Path(svc.__file__).read_text(encoding="utf-8"))
    sql = [n.value.strip().upper() for n in ast.walk(tree)
           if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    offenders = [s for s in sql
                 if s.startswith("UPDATE") or s.startswith("DELETE FROM")
                 or "INSERT OR REPLACE" in s]
    assert offenders == [], offenders
    # The control: the same walk finds the INSERTs, so an empty list above is a
    # measurement and not a scan that reads nothing.
    assert any(s.startswith("INSERT INTO USER_DEFINITIONS") for s in sql)


def test_a_soft_delete_APPENDS_A_TOMBSTONE_and_a_PIN_STILL_RESOLVES(store):
    """A delete that stamped `deleted_at` on the rows already written would be
    the one UPDATE, and it would land on exactly the rows a pin points at."""
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))
    assert svc.soft_delete(USER, DEF_ID) is True

    assert svc.get(USER, DEF_ID) is None
    assert svc.list_for_user(USER) == []
    pinned = svc.get(USER, DEF_ID, version=1)
    assert pinned is not None and pinned["deleted_at"] is None
    assert pinned["definition"]["compute"]["ast"] == _ast_sma(20)
    assert [h["version"] for h in svc.history(USER, DEF_ID)] == [1, 2, 3]
    assert svc.history(USER, DEF_ID)[-1]["deleted_at"] is not None
    # Idempotent: a second delete has nothing live to tombstone.
    assert svc.soft_delete(USER, DEF_ID) is False
    assert [h["version"] for h in svc.history(USER, DEF_ID)] == [1, 2, 3]


def test_a_BYTE_IDENTICAL_resave_appends_NOTHING(store):
    """The one growth class an autosaving editor actually produces, closed by
    construction rather than by a prune that would break a pin."""
    first = svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    again = svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    assert first["appended"] is True and again["appended"] is False
    assert again["version"] == first["version"] == 1
    assert len(svc.history(USER, DEF_ID)) == 1
    # …and a REAL edit still appends, so the dedup is not an overwrite in
    # disguise.
    assert svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))["version"] == 2


# ═══ 3. rev bumps IFF the maths moved, and the bump CALLS the migration ═════

def test_the_two_formulas_really_do_disagree_on_these_bars(env):
    """⭐ THE NON-VACUITY FLOOR. Every test below is a statement about a gap
    between two revisions of one user's maths; without a gap they all pass while
    measuring nothing."""
    bars = env["bars"]
    assert _sma(bars, 20) == REV1_SMA
    assert _sma(bars, 50) == REV2_SMA
    assert REV2_SMA < STRADDLE < REV1_SMA, (
        "the threshold no longer straddles the two formulas — the fabricated "
        "crossing this file measures cannot occur")


def test_rev_bumps_WHEN_THE_MATHS_MOVED_and_the_bump_FORCE_MIGRATES(env):
    """⭐ D-A3, AND THE MECHANISM IS CALLED, NOT REBUILT.

    `version` increments on every save; `rev` increments when the MATHS moved.

    ⚰️ CORRECTED 2026-08-27. This said "IFF `astHash` changed", which was true
    until multi-plot and became FALSE with `ee81ce831`: an alert binds to ONE
    plot (`u_<12hex>.<plotKey>`), so editing a NON-scan tree has to force-migrate
    too, and `rev` now bumps when `ast_hash` moves **or** `treesHash` does.
    `compute.fn` / `def_hash` are still `ast_hash(compute.ast)` and did not move
    — 0 of 249 rows.

    ⛔ This was the THIRD copy of the old sentence, and the one that mattered
    most: it was in this test's NAME, and a test name reads as an assertion. Two
    agreeing copies read as corroboration; three read as certainty.
    That removes an entire class of "the user forgot to bump" and is one
    assertion.

    And a rev bump runs Phase C's `migrate_bindings_to_rev` — the SAME function,
    with the same `last_value` reset, the same notification and the same
    first-cycle suppression. C's record notes that path *"has no population to
    act on today"*; a user editing their own formula is its first real
    population, and it arrives with no deploy to hang it on.
    """
    _register_address(env)
    now = int(time.time())
    cross, level = _armed_pair(armed_at=now - 7200)

    created = svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    assert created["rev"] == svc.FIRST_REV == rev.DEFAULT_REV
    assert created["rev_bumped"] is False and created["migrated"] == 0

    renamed = svc.save(USER, DEF_ID, defn(20, name="renamed", def_id=DEF_ID))
    assert renamed["version"] == 2
    assert renamed["rev_bumped"] is False and renamed["migrated"] == 0
    assert renamed["rev"] == created["rev"]
    assert renamed["ast_hash"] == created["ast_hash"]
    assert rev.rev_row(level) is None, (
        "a RENAME migrated the bindings — every label change would eat a cycle")

    edited = svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))
    assert edited["version"] == 3
    assert edited["rev_bumped"] is True and edited["rev"] == created["rev"] + 1
    assert edited["ast_hash"] != created["ast_hash"]
    assert edited["migrated"] == 2, (
        "a maths change did NOT force-migrate — the user's armed alerts would "
        "compare a rev-1 prev against a rev-2 current, which fabricates a "
        "crossing no bar produced")
    for aid in (cross, level):
        row = rev.rev_row(aid)
        assert row is not None and row["def_rev"] == 2 and row["from_rev"] == 1
        assert ias.get(aid)["last_value"] is None, (
            f"alert {aid} still holds an old-formula number after the edit")


def test_the_MIGRATION_IS_CALLED_BY_NAME_from_saves_own_body():
    """⛔ A GATE WITH NO CALL SITE IS NOT A GATE, and the behavioural tests would
    all still pass if the call lived in a helper only they reached.

    ⚠️ RE-PARSED FROM THE FILE BY NAME, NOT `inspect.getsource`. That helper
    slices at the line numbers captured when the module was IMPORTED, so a
    co-worker's edit above the function hands it the wrong lines and it reports a
    missing call site that is right there — measured for real on this branch.
    """
    module = ast.parse(Path(svc.__file__).read_text(encoding="utf-8"))
    saves = [n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == "save"]
    assert len(saves) == 1, f"expected one save(), found {len(saves)}"
    src = ast.unparse(saves[0])
    assert "alert_rev_migration" in src
    assert "migrate_bindings_to_rev" in src, (
        "save() no longer calls Phase C's force-migration — a user's maths edit "
        "would leave every binding comparing two revisions' numbers")
    assert "deliver_migration_notice" in src, (
        "the migration runs with some other notifier — spec §3.1's contract is "
        "that a user is never SILENTLY switched")
    # The control: the same parse of a DIFFERENT function does not contain it, so
    # the assertions above read `save`'s own body and not the whole module.
    others = [n for n in module.body
              if isinstance(n, ast.FunctionDef) and n.name == "soft_delete"]
    assert len(others) == 1
    assert "migrate_bindings_to_rev" not in ast.unparse(others[0])


def test_the_user_is_NOTIFIED_through_the_REAL_transport(env):
    """No injected notifier anywhere: the notice arrives on the same bell +
    email + Discord hook a fire uses, with a `source` that tells them apart."""
    _register_address(env)
    now = int(time.time())
    _armed_pair(armed_at=now - 7200)
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    env["sent"].clear()

    result = svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))
    notices = _notices(env["sent"])
    assert result["notified"] == 2 and len(notices) == 2
    for n in notices:
        assert n["source"] == "indicator_alert_migration", (
            "the notice is indistinguishable from an alert firing")
        assert n["extra_data"]["from_rev"] == 1 and n["extra_data"]["def_rev"] == 2
        assert DEF_ID in n["message"] or DEF_ID in n["title"]
        assert n["user_id"] == USER


# ═══ 4. the first cycle is quiet — and the quiet is ATTRIBUTABLE ════════════
#
# ⭐ EVERY SCENARIO BELOW RUNS ON BOTH EVALUATION LANES, AND THE LIST OF LANES IS
# DERIVED FROM `ev.EVAL_MODES` RATHER THAN TYPED. Until `0183a9b1` these tests
# silently read whichever lane was committed; the cutover flipped it and four of
# them went red without a line of them changing — the tests had never said which
# arithmetic they were describing. A third lane added to `EVAL_MODES` now shows
# up here as a failing parameter instead of as an untested branch.


@pytest.fixture(params=ev.EVAL_MODES)
def lane(request, env):
    """One NAMED evaluation lane — and a proof that it is the lane that runs.

    ⛔ THE ASSERT IS THE POINT, NOT CEREMONY. `eval_mode()` resolves the
    environment override against the committed constant, so a lever that stopped
    working (or a `eval_mode()` hardcoded to one lane — Task 8's own mandated
    mutation) would leave every "closed" parameter quietly running `forming` and
    both parameters agreeing for the wrong reason. Reading it back through the
    module's ONE reader is what makes the parameter mean something.
    """
    env["monkeypatch"].setenv(ev.ALERT_EVAL_MODE_ENV, request.param)
    assert ev.eval_mode() == request.param, (
        f"asked for the {request.param!r} lane and `eval_mode()` answers "
        f"{ev.eval_mode()!r} — every assertion below would describe the wrong "
        "arithmetic")
    return request.param


def _unmigrated_fires(lane: str, cross: int, level: int) -> list[int]:
    """Which bindings an UN-MIGRATED maths edit delivers, PER LANE — sorted.

    ⛔ THIS IS A MECHANISM, NOT AN OBSERVATION. The two lanes disagree about ONE
    binding and the reason is structural:

      * the FORMING lane's `prev` is `alert["last_value"]` — the number the
        previous 60-second poll stored, computed by the OLD formula. An edit
        therefore meets rev-1's 112.68 against rev-2's 111.45 and `cross_below`
        reports a crossing NO BAR PRODUCED. That is the defect Phase C exists to
        close, and it is why the forming lane fires BOTH.
      * the CLOSED lane's `prev` is `series[i-1]` — the bar before the judged
        one, off the SAME column, i.e. one version's own arithmetic. A
        cross-version pair is not a state it can reach, so `cross_below` cannot
        be fabricated at all. `0183a9b1` priced exactly this: 405,781 forming
        fires removed, "most of the removals are above/below re-evaluating every
        60-second poll".

    ⭐ WHAT DOES NOT DIFFER, AND IT IS THE HALF THAT MATTERS HERE: `below` never
    reads `prev` on either lane, so the LEVEL binding fires on BOTH the instant
    the anchor moves. The control is therefore still a control on the closed
    lane — it goes noisy, and the suppression is still preventing something real.
    """
    assert lane in ev.EVAL_MODES, f"{lane!r} names no lane"
    expected = sorted([cross, level]) if lane == "forming" else [level]
    assert level in expected, (
        "the level binding dropped out of the expectation — the un-migrated edit "
        "would then fabricate NOTHING and every suppression test below would be "
        "preventing nothing on this lane")
    return expected


def test_WITHOUT_the_edit_the_new_maths_FABRICATES_A_CROSSING(env, lane):
    """⭐ THE POSITIVE CONTROL, AND IT IS THE WHOLE ARGUMENT FOR THE TASK.

    Swap the maths under an alert still holding the old number and run one
    ordinary cycle. A fire lands that no bar produced — the FORMULA moved.

    ⚠️ ON THE FORMING LANE THAT IS BOTH BINDINGS AND THE CROSSING IS THE LOUDER
    LIE; on the closed lane the crossing is structurally unreachable and the
    LEVEL binding carries the control on its own. `_unmigrated_fires` states
    which, and why, and refuses an empty expectation — a positive control that
    could pass while firing nothing is not a control.
    """
    _register_address(env)
    cross, level = _armed_pair(armed_at=int(time.time()) - 7200)
    env["state"]["period"] = 50                    # the edit, with NO migration
    ev._run_one_cycle()
    assert sorted(_fires(env["sent"])) == _unmigrated_fires(lane, cross, level), (
        f"on the {lane!r} lane the un-migrated edit did NOT re-fire as declared — "
        "the suppression tests below would then be preventing nothing")


def test_a_USER_EDIT_makes_the_first_cycle_QUIET_and_the_second_correct(env, lane):
    """⭐ THE HEADLINE. Phase C proved this for a DEPLOY with a positive control;
    this proves the same for a USER EDIT, which is the population C's record says
    it never had.

    ⚠️ THE MEASUREMENT IS A FIRE, NOT A FLAG. `rev_migrated_at` being set asserts
    the bookkeeping; NO NOTIFICATION LEAVING THE BUILDING asserts the thing the
    user experiences.

    ⭐ AND IT IS LANE-INDEPENDENT BY CONSTRUCTION — asserted here on both.
    `consume_if_suppressed` runs in `_run_one_cycle` BEFORE `_evaluate_for_cycle`
    picks a lane, so the quiet cycle cannot be an artefact of either arithmetic.
    The second cycle agrees too: the crossing binding stays silent on the forming
    lane because the reset NULLed its `prev`, and on the closed lane because
    `series[i-1]` never crossed — two mechanisms, one outcome.
    """
    _register_address(env)
    cross, level = _armed_pair(armed_at=int(time.time()) - 7200)
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))

    edited = svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))   # the user's edit
    env["state"]["period"] = 50                                # the engine follows
    assert edited["migrated"] == 2
    env["sent"].clear()

    summary = ev._run_one_cycle()
    assert _fires(env["sent"]) == [], (
        "a crossing was fabricated by the user's own edit — "
        f"{_fires(env['sent'])} delivered on the first post-edit cycle")
    assert summary["suppressed"] == 2 and summary["evaluated"] == 0

    env["sent"].clear()
    summary = ev._run_one_cycle()
    assert summary["suppressed"] == 0
    assert _fires(env["sent"]) == [level], (
        "the CROSSING binding fired on the second cycle. The reset exists so an "
        "old-formula number can never be a new-formula `prev`; a late crossing "
        "is the same lie, one cycle later")
    assert cross not in _fires(env["sent"])
    # ⛔ AND THE SECOND CYCLE ACTUALLY EVALUATED. Without this the whole test is
    # satisfiable by an alert nothing can compute: `evaluated: 0` would deliver
    # `[]` on cycle one and `[level]` on cycle two only if `level` never fired at
    # all, which `_fires(...) == [level]` already forbids — but a future edit
    # that drops the level binding would leave a green test measuring silence.
    assert summary["evaluated"] == 2, (
        f"the post-suppression cycle evaluated {summary['evaluated']} of 2 "
        f"alerts on the {lane!r} lane — a quiet cycle here is the wrong door, "
        "not a working suppression")


def test_the_QUIET_STOPS_when_the_SUPPRESSION_IS_DELETED(env, lane):
    """⭐⭐ THE ATTRIBUTION TEST — which mechanism produced the quiet?

    The defect this branch has produced four times is a correct answer from the
    wrong door. So the claim "`suppress_first_cycle` made the first cycle quiet"
    is checked the only way it can be: DELETE IT and watch the cycle go noisy.

    ⚠️ AND THE NOISE IS THE *LEVEL* BINDING ONLY, on BOTH lanes, which is the
    second half of the finding: the crossing is covered by the reset on the
    forming lane and is unreachable on the closed one (`cross_*` needs a `prev`),
    while the level is covered by the suppression on both (`below` never reads
    one). Two mechanisms, two disjoint halves — a file that measured only
    crossings would go green with the suppression deleted.
    """
    _register_address(env)
    cross, level = _armed_pair(armed_at=int(time.time()) - 7200)
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))
    env["state"]["period"] = 50
    env["sent"].clear()

    env["monkeypatch"].setattr(rev, "suppress_first_cycle", lambda alert: False)
    ev._run_one_cycle()
    assert _fires(env["sent"]) == [level], (
        f"on the {lane!r} lane the first cycle stayed quiet with the suppression "
        "DELETED — the quiet in the headline test is produced by some other "
        "mechanism, and that is the 'refused by a different door' defect this "
        "branch has hit four times")


def test_the_quiet_is_NOT_the_wrong_door(env, lane):
    """⛔ THE OTHER DOOR, NAMED AND MEASURED — ON BOTH LANES.

    `value_function` answers `None` for an address the evaluator has never heard
    of, and `_evaluate_one` then returns `(None, False)`; `series_function` and
    `_user_value_function` answer the same way for the closed lane's
    `_evaluate_one_closed`, which returns `(None, False, None)`. Either way: a
    quiet cycle that says nothing about any migration. This runs the ATTRIBUTION
    scenario with the address UNREGISTERED and shows the cycle is quiet even with
    the suppression deleted, which is exactly the vacuous green
    `_register_address` exists to prevent. Both runs are here so the difference
    between them is the measurement.

    ⚠️ BOTH RESOLVERS ARE ASSERTED, because seeding only ONE of them is not a
    hypothetical: it is what this file did until the closed-bar cutover made the
    omission visible.
    """
    cross, level = _armed_pair(armed_at=int(time.time()) - 7200)
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))
    env["state"]["period"] = 50
    env["sent"].clear()

    assert ev.value_function(DEF_ID) is None            # the forming lane's table
    assert alert_series.series_function(DEF_ID) is None  # the closed lane's table
    env["monkeypatch"].setattr(rev, "suppress_first_cycle", lambda alert: False)
    ev._run_one_cycle()
    assert _fires(env["sent"]) == [], (
        "an unregistered address fired — this control no longer demonstrates "
        "the wrong door")


def test_a_USER_EDIT_CANNOT_TOUCH_A_NATIVE_BINDING(env):
    """⛔ THE BLAST RADIUS — and the reason the armed soak alerts are safe.

    The soak matrix arms 31 alerts on NATIVE addresses and they must stay
    non-deliverable. That gate lives on production and cannot be run from this
    worktree (the local `auth.db` is a pre-Phase-C schema with zero rows), so the
    claim is made STRUCTURALLY instead: a user id is `u_<12 hex>` and
    `plot_base` of one can never equal a native base, so a user's edit reaches no
    native binding at all. Asserted FIELD BY FIELD, because a migration that
    resets everything is easy and wrong.
    """
    _register_address(env)
    now = int(time.time())
    native = ias.create(user_id="u2", sym="PARITY", indicator="rsi",
                        condition="above", threshold=1e9, tf="5")
    _arm(native, last_value=41.5, last_evaluated_at=now - 7200)
    before = ias.get(native)

    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))

    assert ias.get(native) == before, (
        f"a user's edit touched a native binding: {before} -> {ias.get(native)}")
    assert rev.rev_row(native) is None, "a native address gained a def_rev"
    assert _notices(env["sent"]) == [] or all(
        n["extra_data"]["alert_id"] != native for n in _notices(env["sent"]))
    assert ev.plot_base(ev.resolve_address(DEF_ID)) != "rsi"


def test_a_RENAME_does_not_eat_a_cycle(env, lane):
    """The other direction of the biconditional, as a DELIVERY rather than a
    flag: a label change must not silence a user's alerts for a cycle.

    ⚠️ "NOT EATEN" IS THE GUARANTEE; the fire SET is the lane's arithmetic.
    `_unmigrated_fires` is the same table the positive control uses, and for the
    same reason — a rename leaves the binding un-migrated, so a rename's cycle IS
    the un-migrated cycle. Asserting `evaluated == 2` alongside it is what makes
    "not eaten" mean *evaluated*, not merely *noisy*: on the closed lane the
    crossing binding is evaluated and correctly does not trigger, and a cycle
    that skipped it entirely would look identical from the delivery list alone.
    """
    _register_address(env)
    cross, level = _armed_pair(armed_at=int(time.time()) - 7200)
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    env["state"]["period"] = 50            # the maths moved WITHOUT an edit…
    svc.save(USER, DEF_ID, defn(20, name="renamed", def_id=DEF_ID))
    env["sent"].clear()

    summary = ev._run_one_cycle()
    assert summary["suppressed"] == 0 and summary["evaluated"] == 2, (
        f"a rename ate a cycle on the {lane!r} lane ({summary}) — every label "
        "change would deafen the user's alerts for one evaluation")
    assert sorted(_fires(env["sent"])) == _unmigrated_fires(lane, cross, level), (
        "a rename suppressed a delivery — every label change would deafen the "
        "user's alerts for one evaluation")
    assert _notices(env["sent"]) == []


# ═══ 4b. TRANSITION vs RECONCILIATION - the interleaving, CONSTRUCTED ══
#
# save() computes `rev` as `prev["rev"] + 1` from the row it read in phase 1 and
# then does three things in order: MIGRATE (phase 2), APPEND (phase 3), FORGET
# (phase 4). If the migration lands and the append does NOT, the stored
# predecessor never moves - so the user's NEXT edit, a completely different
# formula, computes the SAME `rev`. Keyed on that number alone the migration read
# it as "already migrated" and skipped it, and the second edit reached every
# binding with no reset and no suppression: the fabricated crossing, delivered by
# the mechanism built to prevent it.
#
# The interleaving below is CONSTRUCTED, not described. The append is failed at
# its own INSERT - narrowly, so phase 2 really does commit first - and the second
# edit is then made for real.


class _NoAppendConn:
    """A LIVE connection that refuses exactly one statement: the version append.

    The failure is narrow on purpose. Phase 3 also runs `_ensure` and the
    concurrency re-read, and a connection that refused everything would abort
    before `save()` could reach the state this section is about: the migration
    committed, nothing appended.
    """

    def __init__(self, inner):
        self._inner = inner

    def execute(self, sql, *args, **kwargs):
        if "INSERT INTO user_definitions" in sql:
            raise sqlite3.OperationalError("disk I/O error")
        return self._inner.execute(sql, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._inner, name)


def _half_land_an_edit(period: int, *, at: int) -> str:
    """One edit whose migration COMMITS at `at` and whose append RAISES.

    Returns the `ast_hash` of the tree the bindings were migrated onto - the tree
    now recorded against them, which is NOT the tree in the store.

    ⚠️ THE MIGRATION'S CLOCK IS PINNED, and only `alert_rev_migration`'s view of
    it. Seconds are integers and this whole scenario runs inside one of them, so
    an un-pinned edit A would stamp `rev_migrated_at` in the same second as
    edit B's and as the cycles between them - and then "the first cycle after
    edit B was quiet" could not be told apart from "edit A's suppression was
    never spent". That is the module's own documented trap (`_consume_cycle`
    carries a `+1` for it); pinning A into the past is what makes the measurement
    below about the migration rather than about the clock.
    """
    with pytest.MonkeyPatch.context() as mp:
        real_connect = svc._connect
        mp.setattr(svc, "_connect", lambda: _NoAppendConn(real_connect()))
        mp.setattr(rev, "time", types.SimpleNamespace(time=lambda: float(at)))
        with pytest.raises(sqlite3.OperationalError):
            svc.save(USER, DEF_ID, defn(period, def_id=DEF_ID))
    return svc.ast_hash(_ast_sma(period))


def test_a_DIFFERENT_edit_at_the_SAME_rev_REACHES_ITS_BINDINGS(env, lane):
    """⭐ THE HEADLINE OF THIS SECTION, AS A DELIVERY AND AS STATE.

    Edit A migrates and fails to store. Edit B - different maths, same revision
    NUMBER - must still reset and suppress, because the bindings are recorded on
    A's tree and are about to be evaluated on B's.

    Edit A's own suppression is SPENT before B arrives, by two ordinary cycles on
    the tree that is actually stored. Without that the quiet after B would be A's
    and this would be a gate that cannot fail.
    """
    _register_address(env)
    now = int(time.time())
    cross, level = _armed_pair(armed_at=now - 7200)
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))          # v1, rev 1
    stored_v1 = svc.get(USER, DEF_ID)

    hash_a = _half_land_an_edit(30, at=now - 7200)           # edit A: 30-period

    # The store did not move; the bindings did.
    still = svc.get(USER, DEF_ID)
    assert still["version"] == stored_v1["version"] == 1
    assert still["rev"] == 1 and still["ast_hash"] == stored_v1["ast_hash"]
    for aid in (cross, level):
        row = rev.rev_row(aid)
        assert row is not None and row["def_rev"] == 2 and row["def_hash"] == hash_a, (
            "edit A's migration did not commit - the interleaving this test is "
            "about was never constructed")
        assert row["rev_migrated_at"] == now - 7200

    # SPEND edit A's suppression on the STORED tree, so the quiet after edit B
    # can only be edit B's.
    ev._run_one_cycle()                                      # the suppressed one
    summary = ev._run_one_cycle()                            # a real evaluation
    assert summary["suppressed"] == 0 and summary["evaluated"] == 2
    for aid in (cross, level):
        assert rev.suppress_first_cycle(ias.get(aid)) is False
        assert ias.get(aid)["last_value"] is not None, (
            "the bindings never re-populated on the STORED tree - the quiet "
            "below would be an empty pipe rather than a suppression")
    env["sent"].clear()

    # ...edit B: a DIFFERENT tree that computes edit A's revision number.
    edited = svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))
    env["state"]["period"] = 50
    assert edited["rev"] == 2, (
        f"edit B computed rev {edited['rev']}, not edit A's 2 - the number "
        "collision this test is built on no longer occurs")
    assert edited["ast_hash"] != hash_a
    assert edited["migrated"] == 2, (
        "the DIFFERENT edit was skipped as already-migrated. Its maths reaches "
        "every binding with no `last_value` reset and no suppression, which is "
        "exactly the fabricated crossing this whole lane exists to prevent")

    # RECONCILED: the bindings are on the tree that is ACTUALLY STORED.
    stored = svc.get(USER, DEF_ID)
    recorded = rev.bindings_on(DEF_ID)
    assert {b["alert_id"] for b in recorded} == {cross, level}
    for b in recorded:
        assert b["def_rev"] == stored["rev"] and b["def_hash"] == stored["ast_hash"], (
            f"binding {b['alert_id']} is recorded on tree {b['def_hash']!r} at "
            f"rev {b['def_rev']} while the store holds {stored['ast_hash']!r} at "
            f"rev {stored['rev']}")
    assert edited["bindings_on_this_tree"] == 2
    for aid in (cross, level):
        assert ias.get(aid)["last_value"] is None, (
            f"alert {aid} still holds a number computed by the tree it was "
            "migrated OFF - that number becomes the next cycle's `prev`")

    # ...and the delivery agrees. `_unmigrated_fires` is the same table the
    # positive control uses, so an empty first cycle is a measurement.
    assert _unmigrated_fires(lane, cross, level), "the control fires nothing"
    summary = ev._run_one_cycle()
    assert _fires(env["sent"]) == [], (
        f"on the {lane!r} lane the first cycle after edit B fired "
        f"{_fires(env['sent'])} - the edit reached the bindings unmigrated")
    assert summary["suppressed"] == 2


def test_a_RETRY_of_the_SAME_edit_is_still_a_NO_OP(env):
    """The other direction, and the reason the skip is NARROWED rather than
    removed: retrying the edit whose append failed must not re-suppress.

    The bindings are already on this exact tree, so the retry migrates nothing -
    and `bindings_on_this_tree` is what tells the caller they are nonetheless all
    on it. `migrated` alone reports 0 and reads as "no alerts affected".
    """
    _register_address(env)
    now = int(time.time())
    cross, level = _armed_pair(armed_at=now - 7200)
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    hash_a = _half_land_an_edit(30, at=now - 7200)
    stamps = {aid: rev.rev_row(aid)["rev_migrated_at"] for aid in (cross, level)}
    env["sent"].clear()

    retried = svc.save(USER, DEF_ID, defn(30, def_id=DEF_ID))   # the SAME edit
    assert retried["appended"] is True and retried["ast_hash"] == hash_a
    assert retried["migrated"] == 0, (
        "the retry re-migrated a lane already on this tree - every failed append "
        "would cost the user a second deaf cycle")
    assert _notices(env["sent"]) == []
    assert retried["bindings_on_this_tree"] == 2, (
        "`migrated` is 0 and nothing else says the bindings ARE on this tree - a "
        "caller reporting `migrated` alone tells the member 0 alerts were "
        "updated when all of them were")
    for aid in (cross, level):
        assert rev.rev_row(aid)["rev_migrated_at"] == stamps[aid]


def test_a_binding_created_AFTER_a_migration_is_NOT_stamped_DEFAULT_REV(env):
    """⛔ THE GAP FROM THE OTHER SIDE.

    A binding armed after a migration has no `indicator_alert_rev` row, so
    `from_rev` fell back to `DEFAULT_REV` and its owner was told "revision 1 -> 3"
    about an alert that was armed on revision 2. `save()` now hands the migration
    the definition's own pre-edit revision, which IS the arm-time revision of any
    binding with no record: every bump migrates, and a migration records every
    binding that existed.

    The assertion is on the NOTICE as well as on the row, because the row is
    bookkeeping and the notice is the sentence a member reads.
    """
    _register_address(env)
    now = int(time.time())
    early, _level = _armed_pair(armed_at=now - 7200)
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))               # rev 1
    svc.save(USER, DEF_ID, defn(50, def_id=DEF_ID))               # rev 2
    assert rev.rev_row(early)["def_rev"] == 2
    assert rev.rev_row(early)["from_rev"] == 1

    # ...a binding armed NOW is armed on revision 2, and has no record saying so.
    late = ias.create(user_id=USER, sym="PARITY", indicator=DEF_ID,
                      condition="below", threshold=STRADDLE, tf="5")
    _arm(late, last_value=REV2_SMA, last_evaluated_at=now - 60)
    assert rev.rev_row(late) is None
    assert [b["migrated"] for b in rev.bindings_on(DEF_ID)
            if b["alert_id"] == late] == [False]
    env["sent"].clear()

    svc.save(USER, DEF_ID, defn(30, def_id=DEF_ID))               # rev 3
    row = rev.rev_row(late)
    assert row["def_rev"] == 3
    assert row["from_rev"] == 2, (
        f"a binding armed on revision 2 was stamped from_rev={row['from_rev']} - "
        "DEFAULT_REV is a fabricated number in the one notice whose entire job "
        "is to be honest about which maths changed")
    # ...while a binding that HAS a record still keeps its own number.
    assert rev.rev_row(early)["from_rev"] == 2

    notices = [n for n in _notices(env["sent"])
               if n["extra_data"]["alert_id"] == late]
    assert len(notices) == 1
    assert notices[0]["extra_data"]["from_rev"] == 2
    assert "revision 2" in notices[0]["message"], (
        f"the member is told {notices[0]['message']!r} about an alert that was "
        "armed on revision 2")


# ═══ 5. the caps ════════════════════════════════════════════════════════════

def test_the_store_REFUSES_an_oversized_or_too_numerous_definition(store):
    """⚠️ `user_preferences` HAS NO SIZE LIMIT AND NO DELETE ROUTE — measured.
    This store is not that store, and the caps are named rather than inherited.
    """
    with pytest.raises(ValueError, match="definition exceeds"):
        svc.save(USER, "u_00000000dead", defn(20, pad=svc.MAX_DEFINITION_BYTES + 1,
                                              def_id="u_00000000dead"))
    assert svc.get(USER, "u_00000000dead") is None, "a refused save still stored"

    for i in range(svc.MAX_DEFINITIONS_PER_USER):
        did = "u_%012x" % i
        svc.save(USER, did, defn(20, def_id=did))
    with pytest.raises(ValueError, match="definition count exceeds"):
        svc.save(USER, "u_ffffffffffff", defn(20, def_id="u_ffffffffffff"))
    # …and the cap counts LIVE definitions: a delete makes room, and an EDIT of
    # an existing one is never refused (an editor that cannot save because the
    # user is at the cap is a data-loss bug wearing a quota costume).
    assert svc.save(USER, "u_%012x" % 0, defn(50, def_id="u_%012x" % 0))["version"] == 2
    svc.soft_delete(USER, "u_%012x" % 1)
    assert svc.save(USER, "u_ffffffffffff",
                    defn(20, def_id="u_ffffffffffff"))["version"] == 1
    # …and a RESURRECT pays the cap too. Checking only "no previous row" leaves
    # it trivially bypassable: delete fifty, create fifty, re-save the fifty
    # tombstones, stand at a hundred.
    with pytest.raises(ValueError, match="definition count exceeds"):
        svc.save(USER, "u_%012x" % 1, defn(20, def_id="u_%012x" % 1))


def test_a_definition_whose_id_disagrees_with_its_address_is_refused(store):
    """`defId.plotKey` must resolve to one thing. A document that calls itself
    `u_aaa` stored at `u_bbb` makes that address answer two ways."""
    with pytest.raises(ValueError, match="disagrees with the document"):
        svc.save(USER, DEF_ID, defn(20, def_id="u_ffffffffffff"))


def test_a_definition_id_OUTSIDE_the_user_namespace_is_refused(store):
    for bad in ("rsi", "u_ABCDEF012345", "u_012", "u_0123456789ab.value",
                "", None, "vwap"):
        with pytest.raises(ValueError, match="user namespace"):
            svc.save(USER, bad, defn(20))


def test_a_non_ast_definition_is_refused(store):
    d = defn(20, def_id=DEF_ID)
    d["compute"] = {"kind": "native", "fn": "rsi"}
    with pytest.raises(ValueError, match="compute.kind must be"):
        svc.save(USER, DEF_ID, d)


def test_two_users_cannot_see_each_others_definitions(store):
    svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    assert svc.get("u2", DEF_ID) is None
    assert svc.list_for_user("u2") == []
    assert len(svc.list_for_user(USER)) == 1


# ═══ 6. `repaint` is STORED, not recomputed ═════════════════════════════════

def test_repaint_is_the_verdict_AT_SAVE_TIME_and_a_later_linter_cannot_rebadge(store, monkeypatch):
    """⛔ The badge a user was SHOWN when they saved, and the badge an alert was
    admitted under, must be the SAME FACT. Recomputing at read time means a
    linter improvement silently re-badges a definition somebody already armed.
    """
    from api.services import ast_lint
    saved = svc.save(USER, DEF_ID, defn(20, def_id=DEF_ID))
    assert saved["repaint"] == {"value": "non-repainting"}

    monkeypatch.setattr(ast_lint, "lint_definition", lambda d, opts=None: {
        "id": d.get("id"), "lane": "ast",
        "plots": [{"plotKey": "value", "mode": "repaints"}]})
    # The control: the patch really does change what a FRESH lint answers.
    assert svc.lint_verdict(defn(20, def_id=DEF_ID)) == {"value": "repaints"}
    assert svc.get(USER, DEF_ID)["repaint"] == {"value": "non-repainting"}, (
        "the badge was recomputed at read time — a linter change re-badged a "
        "definition somebody may already have armed")
    assert svc.get(USER, DEF_ID, version=1)["repaint"] == {"value": "non-repainting"}


# ═══ 7. `astHash` — one number, two lanes ══════════════════════════════════

def test_the_python_ast_hash_IS_the_js_one(js):
    """⭐ ONE VOCABULARY, TWO LANES — and this is `astHash`'s FIRST REAL CALLER.

    Phase D Task 3 shipped `astHash` with no caller: the number that decides a
    `compute.rev` bump was proven stable and never used. The store needs it
    server-side, so the algorithm is mirrored in Python and pinned to the JS lane
    by running BOTH over the same corpus — including the two cases the obvious
    Python implementation gets wrong.
    """
    assert len(js["hashes"]) == len(_JS_TREES)
    agreed = refused = 0
    for tree, js_row in zip(_JS_TREES, js["hashes"]):
        if js_row["ok"]:
            assert svc.ast_hash(tree) == js_row["hash"], tree
            agreed += 1
        else:
            with pytest.raises(ValueError):
                svc.ast_hash(tree)
            refused += 1
    assert agreed >= 7 and refused == 2, (agreed, refused)


def test_the_two_traps_the_obvious_python_implementation_falls_into(js):
    """⚠️ AN INTEGRAL FLOAT, AND A BOOL.

    `json.dumps(20.0)` is `"20.0"` while `JSON.stringify(20.0)` is `"20"` — JS
    has ONE number type, so a form field that round-tripped through a float would
    hash differently in the two lanes and migrate (or fail to migrate) a user's
    alerts. And `isinstance(True, int)` is True in Python, so a bool sails
    through every obvious numeric guard; JS falls through to its throw.
    """
    assert svc.ast_hash({"type": "num", "value": 20.0}) == \
        svc.ast_hash({"type": "num", "value": 20})
    assert svc.stable_stringify(20.0) == "20"
    with pytest.raises(ValueError, match="boolean"):
        svc.stable_stringify(True)
    with pytest.raises(ValueError, match="finite"):
        svc.stable_stringify(float("nan"))
    # Key ORDER cannot reach the hash — the reason a rename is not a rev bump.
    a = {"type": "call", "name": "sma", "args": [{"type": "num", "value": 1}]}
    b = {"args": [{"value": 1, "type": "num"}], "name": "sma", "type": "call"}
    assert svc.ast_hash(a) == svc.ast_hash(b)


def test_the_user_namespace_cannot_collide_with_a_SHIPPED_definition(js):
    """⛔ ASSERTED AGAINST THE LIVE REGISTRY, NEVER AGAINST A TYPED LIST OF IDS.

    A typed list of ids is exactly the probe-name class that produced four false
    alarms in one session, so the ids are read off `nativeRegistry.listDefinitions()`
    through node.
    """
    ids = js["registryIds"]
    assert len(ids) >= 15, ids
    assert not [i for i in ids if i.startswith(svc.DEF_ID_PREFIX)], ids
    assert svc.DEF_ID_RE.match(svc.new_def_id())
    assert "." not in svc.new_def_id(), (
        "plots are addressed `defId.plotKey`; a dot in an id makes that "
        "address ambiguous")
    assert len({svc.new_def_id() for _ in range(200)}) == 200


# ═══ 8. the paid gate, DERIVED from the route table ═════════════════════════

#: ⛔ ASSERTED, NOT INFORMATIONAL. Phase C Task 13 measured the failure: a shipped
#: test hand-listed THREE paths while the router had FIVE, so two paid endpoints
#: rode with no coverage and deleting a `Depends(require_paid)` passed every
#: test. Update this DELIBERATELY — it exists so a sixth route cannot ride in.
#:
#: 2026-08-07, Phase D Task 13: the sixth route arrived — `POST /propose`, the
#: NL→AST concierge — and this is the deliberate update. The rail worked exactly
#: as written: adding the route turned BOTH halves red (the structural count and
#: the behavioural 402 sweep's `seen`) until this line moved, so the new route
#: could not ride in uncovered. Its own gate is checked by the same two halves
#: below, plus `tests/test_definition_concierge.py`'s route cases.
#: 2026-08-27, W5b: SIX MORE — sharing and version history. `POST/GET/DELETE
#: {id}/share`, `GET {id}/history`, and `GET/POST shared/{token}[/install]`.
#: ⛔⛔ THE TWO `shared/{token}` ROUTES ARE THE ONES TO LOOK AT TWICE, because
#: they are the only endpoints in this router that read something the CALLER
#: does not own — which is the whole point of a share link. They are still
#: `require_paid`, and the token is the authorisation: 128 bits, minted only
#: by an owner, and unguessable. There is no listing of shared definitions
#: anywhere, so the only route to another member's work is a link they chose
#: to send. Both halves of this rail cover them like any other route.
EXPECTED_ROUTE_COUNT = 12


def _routes():
    return [r for r in router_mod.router.routes if getattr(r, "methods", None)]


def test_every_route_on_this_router_is_paid_gated_and_the_COUNT_is_asserted():
    routes = _routes()
    assert len(routes) == EXPECTED_ROUTE_COUNT, (
        f"the router mounts {len(routes)} routes — a route was added or removed. "
        "Update the count DELIBERATELY.")
    for r in routes:
        deps = [d.call for d in r.dependant.dependencies]
        assert router_mod.require_paid in deps, f"{r.path} declares no require_paid"
    assert router_mod.router.dependencies == [], (
        "a router-level dependency would make the per-handler rail above pass "
        "for a route that has none of its own")


@pytest.fixture
def app(store):
    a = FastAPI()
    a.include_router(router_mod.router)
    return a


def test_a_FREE_user_is_refused_on_EVERY_route_behaviourally(app):
    """The behavioural half. A 422 would be a MISS: validation runs after the
    dependency, so a missing gate shows up as a 200/422/500 instead of a 402."""
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": "u2", "role": "user", "plan": "free"}
    c = TestClient(app)
    seen = 0
    for r in _routes():
        path = r.path.replace("{def_id}", DEF_ID)
        method = sorted(r.methods - {"HEAD", "OPTIONS"})[0]
        resp = c.request(method, path, json={"definition": defn(20, def_id=DEF_ID)})
        assert resp.status_code == 402, f"{method} {path} -> {resp.status_code}"
        assert resp.json()["detail"] == "Custom indicators require a paid plan"
        seen += 1
    assert seen == EXPECTED_ROUTE_COUNT


def test_a_PAID_user_round_trips_a_definition_through_the_real_routes(app):
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    c = TestClient(app)

    created = c.post("/api/user-definitions", json={"definition": defn(20)})
    assert created.status_code == 200, created.text
    def_id = created.json()["def_id"]
    assert svc.DEF_ID_RE.match(def_id), def_id
    assert created.json()["version"] == 1 and created.json()["rev"] == 1

    edited = c.put(f"/api/user-definitions/{def_id}",
                   json={"definition": defn(50, def_id=def_id)})
    assert edited.status_code == 200 and edited.json()["version"] == 2
    assert edited.json()["rev_bumped"] is True

    assert c.get(f"/api/user-definitions/{def_id}").json()["version"] == 2
    pinned = c.get(f"/api/user-definitions/{def_id}", params={"version": 1})
    assert pinned.status_code == 200 and pinned.json()["version"] == 1
    assert len(c.get("/api/user-definitions").json()["definitions"]) == 1

    assert c.delete(f"/api/user-definitions/{def_id}").status_code == 200
    assert c.get(f"/api/user-definitions/{def_id}").status_code == 404
    assert c.delete(f"/api/user-definitions/{def_id}").status_code == 404
    # …and the pin outlives the delete.
    assert c.get(f"/api/user-definitions/{def_id}",
                 params={"version": 1}).status_code == 200


def test_a_store_refusal_reaches_the_caller_as_a_400_with_the_stores_sentence(app):
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    c = TestClient(app)
    r = c.post("/api/user-definitions",
               json={"definition": defn(20, pad=svc.MAX_DEFINITION_BYTES + 1)})
    assert r.status_code == 400
    assert "definition exceeds" in r.json()["detail"]
    assert c.get("/api/user-definitions/u_0123456789ab").status_code == 404
    assert c.get("/api/user-definitions/rsi").status_code == 400


# ═══ 9. the wiring, and the growth nobody bounds ═══════════════════════════

def test_main_mounts_the_router_and_initialises_the_schema():
    """A router that is not mounted answers 200 SPA HTML, not 404, so "the
    endpoint works" has to be checked against the SOURCE, not a request."""
    module = ast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
    src = ast.unparse(module)
    assert "user_definitions_router.router" in src, "the router is not mounted"
    assert "user_definitions._init_db()" in src, "the schema is never initialised"


def test_what_bounds_this_store_and_what_does_NOT(store):
    """⚠️ NO RETENTION EXISTS ANYWHERE IN THIS LANE and two tables already grow
    unbounded. This one has the same shape, so the arithmetic is written down.

    BOUNDED by refusal: one row (`MAX_DEFINITION_BYTES`), live definitions per
    user (`MAX_DEFINITIONS_PER_USER`), and a byte-identical re-save (appends
    nothing). NOT BOUNDED: the number of VERSIONS of one definition — nothing
    prunes, and the prune is deliberately unwritten because a version cap is not
    a retention policy, it is a way to break a `defId@version` pin.
    """
    for i in range(12):
        svc.save(USER, DEF_ID, defn(20 + i, def_id=DEF_ID))
    s = svc.stats(USER)
    assert s["versions"] == 12 and s["definitions"] == 1
    assert s["versions_are_pruned"] is False, (
        "something now prunes versions — a pinned `defId@version` can dangle, "
        "and the policy that decides WHICH versions are reachable does not exist")
    assert s["max_definition_bytes"] == svc.MAX_DEFINITION_BYTES == 64 * 1024
    assert s["max_definitions_per_user"] == svc.MAX_DEFINITIONS_PER_USER == 50
    assert s["bytes"] > 0
    # The worst case, spelled out so the number is somebody's rather than nobody's.
    assert svc.MAX_DEFINITIONS_PER_USER * svc.MAX_DEFINITION_BYTES == 3_276_800


def test_the_alert_lane_and_this_store_agree_on_the_FIRST_revision():
    """`FIRST_REV` is asserted equal to `alert_rev_migration.DEFAULT_REV` rather
    than imported from it: importing would make a divergence invisible, and the
    two numbers mean the same thing to two different files."""
    assert svc.FIRST_REV == rev.DEFAULT_REV == 1
