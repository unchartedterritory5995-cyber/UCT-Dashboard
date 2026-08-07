"""USER_FUNCS — the fourth address partition, and the arm-time equality.

⭐ FOURTH, NOT WIDER. `INDICATOR_FUNCS` (28) is the frozen replay grid's
generator: `tools/alert_replay.py::build_alert_grid` iterates it, in order, and
685,193 recorded fires hang off that iteration. `EVENT_FUNCS` (2, Phase C Task 3)
and `PRICE_FUNCS` (1, Phase C Task 10) were each split off rather than folded in,
BOTH times for that same measured reason — *growing that dict destroys the
instrument*. A user address is `u_<12 hex>.<plotKey>` and `build_alert_grid`
never sees one, which is why `--check` and `--diff 31/31` hold through this task,
and why that invariance is this task's headline gate rather than a footnote.

⛔ AND AN ADDRESS HERE IS PER-USER — THE ONE PROPERTY NO OTHER PARTITION HAS.
`rsi` means the same thing for everybody. `u_abc.out` means something only to one
account, so this partition is keyed by a SCOPED key (`<user_id>\\x1f<address>`)
and never by the bare address. Two consequences, both asserted in both
directions:

  * `indicator_alert_evaluator.resolve_address` / `value_function` /
    `all_addresses` / `alert_catalog` cannot reach a user address AT ALL — they
    walk `ADDRESS_PARTITIONS`, which is the three GLOBAL tables and does not
    include this one. A bare `u_abc.out` handed to `value_function` answers
    `None`, exactly as a typo does.
  * a user id is REQUIRED to get a value function, and account B's id cannot
    produce account A's column, because `\\x1f` is a byte no address grammar can
    hold so the keyspaces cannot alias.

⭐ WHAT ADMISSION MEASURES, AND WHY IT IS AT ARM TIME.
A user formula has no committed golden fixture and one cannot be added per user
(`test_every_fixture_file_is_covered_by_a_test` globs the fixture directory and
demands the stem set equal the explicit CASES lists — a per-user fixture is
structurally impossible). So Phase D's 1e-9 contract is carried by the TABLE
(`closedTable.json`, proven 17 asts x 579 bars, 9,843 rows, zero differences),
and this module confirms it ONCE, on THIS user's real bars, for THIS tree, before
the definition may ever produce a notification. Per keystroke it would be a node
process on every character; per cycle it would be a node process every 60
seconds. At arm time it is one process, once, on the thing being armed.

⛔ EVERY REFUSAL IS A RAISE AND NAMES ITS OWN GATE. The defect this branch has
hit FIVE times — twice inside harnesses built to catch it — is *"refused by a
different door"*: a correct answer produced by the wrong mechanism. An admission
path is exactly that shape, because a user alert that never fires because
something upstream refused it is indistinguishable from one correctly admitted
and quiet. So `AdmissionRefused` carries `.gate`, the gates are a closed tuple,
the refusal messages are DISJOINT BY CONSTRUCTION, and the tests assert the gate
NAME rather than the fact of a refusal — which is what makes deleting one gate
fail loudly instead of being covered by the next one down.
"""
from __future__ import annotations

import math
import os
import re
import sys
import threading
from typing import Any, Callable, Mapping, Optional

_logger_name = __name__

#: One user address: `u_` + 12 hex + `.` + a plot key. The id grammar is
#: `user_definitions.DEF_ID_RE`'s, spelled here as a whole-address pattern
#: because this module answers "is this string a user address" for the ledger
#: door, which holds an alert row and not a definition.
USER_ADDRESS_RE = re.compile(r"^u_[0-9a-f]{12}\.[A-Za-z0-9_][A-Za-z0-9_-]*$")

#: ⛔ THE SEPARATOR IS A BYTE NO ADDRESS CAN HOLD. `USER_ADDRESS_RE` admits
#: `[A-Za-z0-9_.-]` and a user id is an opaque account key; a `|` or a `:` could
#: in principle appear in one and make two different (user, address) pairs
#: collapse to one scoped key — which is one account's formula answering for
#: another. `\x1f` (ASCII UNIT SEPARATOR) exists for exactly this and appears in
#: neither grammar.
SCOPE_SEP = "\x1f"

#: The closed set of doors this module may refuse at. A refusal whose gate is not
#: in here is a bug in this file, and `AdmissionRefused` asserts membership so it
#: cannot be introduced quietly.
GATES: tuple[str, ...] = (
    "definition",     # no such definition for this user, or it is a tombstone
    "lane",           # the definition is not a formula (compute.kind != "ast")
    "repaint",        # the badge is a GATE, not a label (spec §1.3)
    "budget",         # the tree is over the budget AT THE VERSION BEING ARMED
    "cross-lane",     # the two lanes do not agree at 1e-9 on THESE bars
    "bars",           # there are no bars to prove anything on
)


class AdmissionRefused(RuntimeError):
    """A user definition was refused, and the refusal NAMES THE DOOR.

    ⛔ IT RAISES; it never returns a falsey value. A boolean refusal is a value a
    caller can ignore, and the caller here is the arm path: a refusal read as
    "no" would arm the alert anyway. Phase C Task 9 wrote the same sentence about
    the ledger door and the reasoning is identical.

    ⚠️ `.gate` IS THE ATTRIBUTION AND THE TESTS ASSERT IT. `pytest.raises` alone
    proves *a* refusal; this branch has now measured five separate occasions
    where the refusal came from a door other than the one under test, twice
    inside a harness written to detect exactly that. Asserting the gate name is
    what makes "delete this gate" fail rather than fall through to the next.
    """

    def __init__(self, gate: str, detail: str):
        if gate not in GATES:
            raise AssertionError(
                f"{gate!r} is not one of this module's declared gates {GATES} — "
                "a refusal that cannot be attributed is the defect, not the fix")
        self.gate = gate
        super().__init__(f"{detail} [gate:{gate}]")


# ─── the refusal vocabulary, DISJOINT BY CONSTRUCTION ────────────────────────
#
# ⛔ WHY THIS IS A TABLE AND NOT SIX STRING LITERALS AT SIX RAISE SITES.
# Phase C Task 9's M1 found TWO gates sharing the phrase "forming-bar fires are
# not ledger-grade", so `pytest.raises(match=…)` STILL MATCHED with the mode lock
# DELETED — the test would have passed on a tree with the safety removed.
# Nineteenth vacuous gate on this branch, and only the mutation found it. Three
# authors being careful is not a mechanism; a table whose pairwise disjointness
# is ASSERTED is. `test_every_admission_refusal_fragment_names_exactly_one_gate`
# drives every gate for real and requires each fragment to appear in exactly one
# of the six messages produced.
REFUSAL_FRAGMENTS: Mapping[str, str] = {
    "definition": "names no stored definition on this account",
    "lane": "is not a formula and cannot be admitted as one",
    "repaint": "a repainting formula cannot arm an alert",
    "budget": "is over its declared budget at the version being armed",
    "cross-lane": "the two lanes disagree at bar",
    "bars": "there are no bars to prove this formula on",
}

#: The SECOND repaint refusal — the acknowledgement half — kept deliberately
#: disjoint from `REFUSAL_FRAGMENTS["repaint"]` even though both are the repaint
#: gate. "a repainting formula cannot arm an alert" is a SUBSTRING of nothing
#: here, and a test that matched on it must not be satisfiable by the
#: preview-repaint path: they refuse different definitions for different reasons
#: and a shared phrase would let one test pass with the other branch deleted.
PREVIEW_ACK_FRAGMENT = "the preview-repaint badge has not been acknowledged"

#: Where an acknowledgement is recorded. It lives in the definition DOCUMENT
#: (which is append-only and versioned in `user_definitions`) rather than in a
#: column, so the acknowledgement is pinned to the exact revision it was given
#: for: edit the formula, and the new version carries no ack until the author
#: gives one again. A mutable per-definition flag would survive a rewrite of the
#: maths it was granted against.
REPAINT_ACK_KEY = "repaintAck"

#: The verdicts `ast_lint` can emit, and what each means to this door.
REPAINT_CLEAN = "non-repainting"
REPAINT_PREVIEW = "preview-repaints"


# ─── THE FOURTH PARTITION ────────────────────────────────────────────────────
#
# ⚠️ IT IS A `dict[str, ValueFn]` LIKE THE OTHER THREE, so every "walk the
# partitions" rail can iterate it the same way — but its KEYS ARE SCOPED, so it
# is not interchangeable with them and the type does not pretend otherwise.
#
# ⛔ IT IS NOT IN `ADDRESS_PARTITIONS`, AND THAT ABSENCE IS THE HEADLINE GATE.
# `indicator_alert_evaluator.ADDRESS_PARTITIONS` is what `all_addresses()`,
# `alert_catalog()`, `value_function()` and `_CANONICAL_ADDRESS` all walk, and
# `build_alert_grid` reads `INDICATOR_FUNCS` directly. Adding this table to
# either is the mutation this whole task is built around: it changes the shape of
# a 685,193-fire frozen log and destroys the instrument every other gate in the
# phase is measured with.
USER_FUNCS: dict[str, Callable[[list, dict], Optional[float]]] = {}

#: ⚠️ THE REGISTRY IS PER-PROCESS AND THAT IS DECLARED, NOT HIDDEN. The web pod
#: is one uvicorn process today (`CLAUDE.md`'s single-process invariant), but a
#: registry that were the AUTHORITY on admission would mean a redeploy silently
#: un-admits every armed user alert — the "quiet is indistinguishable from
#: refused" defect, arriving by restart. So it is a CACHE and never an authority:
#: `user_value_function` rebuilds a missing entry from the store through the same
#: deterministic gates, and only the cross-lane equality (which needs a node
#: process) is not re-run. What that costs is stated on `user_value_function`.
_REGISTRY_LOCK = threading.Lock()


def is_user_address(address: Optional[str]) -> bool:
    """Is this string an address in the user namespace?

    Used by the LEDGER DOOR as well as by this module, which is why it takes a
    plain string and not a definition: `admit_alert_fire` holds an alert row.
    """
    return bool(address) and bool(USER_ADDRESS_RE.match(str(address)))


def split_user_address(address: str) -> tuple[str, str]:
    """`u_abc….out` -> `("u_abc…", "out")`. RAISES on anything else."""
    if not is_user_address(address):
        raise AdmissionRefused(
            "definition",
            f"{address!r} {REFUSAL_FRAGMENTS['definition']} — a user address is "
            "`u_<12 hex>.<plotKey>`")
    def_id, _, plot_key = str(address).partition(".")
    return def_id, plot_key


def scoped_key(user_id: Any, address: str) -> str:
    """The key `USER_FUNCS` is read by. NEVER the bare address."""
    return f"{user_id}{SCOPE_SEP}{address}"


def forget(user_id: Any = None) -> int:
    """Drop registered user series — all of them, or one account's.

    Called when a definition is edited (its maths moved, so its admission was
    granted against a tree that no longer exists) and by tests, which must not
    inherit each other's admissions. Returns how many entries were dropped.
    """
    with _REGISTRY_LOCK:
        if user_id is None:
            n = len(USER_FUNCS)
            USER_FUNCS.clear()
            return n
        prefix = f"{user_id}{SCOPE_SEP}"
        doomed = [k for k in USER_FUNCS if k.startswith(prefix)]
        for k in doomed:
            del USER_FUNCS[k]
        return len(doomed)


# ─── the value function ──────────────────────────────────────────────────────

def _last_finite(column: list) -> Optional[float]:
    """The newest computable number in an aligned column.

    ⛔ NaN IS NOT A VALUE HERE. `ast_interpret` pads a warmup window with NaN and
    propagates NaN through a comparison against a missing bar; the alert lane's
    `_last_non_none` would hand that NaN straight to `check_condition`, where
    every comparison against it is False — a formula that silently never fires
    rather than one that reports it has no number yet. `None` is the alert lane's
    "no number", and the two must not be conflated at the boundary.
    """
    for v in reversed(column or []):
        if v is None:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(f):
            return f
    return None


def _inputs_for(definition: Mapping[str, Any], params: Optional[Mapping]) -> dict:
    """The instance's inputs: the definition's declared defaults, overridden by
    whatever the alert row stored, filtered to finite numbers.

    ⚠️ FILTERED HERE RATHER THAN TRUSTED. `interpret` raises `ValueError` for an
    input whose name shadows a table name and silently skips a non-number; the
    alert's `params_json` is whatever a client sent and the create path does not
    type it. Passing it through raw would turn a client typo into an exception
    inside the evaluator's per-alert handler — logged, counted as an error, and
    invisible to the person who armed it.
    """
    out: dict[str, float] = {}
    for spec in (definition.get("inputs") or []):
        if not isinstance(spec, dict):
            continue
        name, default = spec.get("name"), spec.get("default")
        if isinstance(name, str) and isinstance(default, (int, float)) \
                and not isinstance(default, bool) and math.isfinite(float(default)):
            out[name] = float(default)
    for name, value in (params or {}).items():
        if name in out and isinstance(value, (int, float)) \
                and not isinstance(value, bool) and math.isfinite(float(value)):
            out[name] = float(value)
    return out


def _make_value_fn(def_id: str, plot_key: str,
                   definition: Mapping[str, Any]) -> Callable[[list, dict], Optional[float]]:
    """One admitted (definition, plot) -> "what number is this formula at now".

    The same shape `indicator_alert_evaluator._value_of` produces for a builtin
    address: `(bars, params) -> Optional[float]`. The tree is CAPTURED, so an
    edit to the stored definition cannot change what an already-admitted alert
    computes without going through `forget` + a fresh admission — which is the
    whole point of `compute.rev` and Phase C's force-migration.

    ⭐ AND IT CARRIES ITS OWN COLUMN AS `fn.column`, WHICH IS WHAT SERVES THE
    CLOSED LANE. `_evaluate_one_closed` indexes a FULL column by bar position
    (`series[i]`, `series[i-1]`), while the forming lane reads only its newest
    computable value. The builtin partitions solve that with two parallel tables
    (`alert_series.SERIES_FUNCS` and `INDICATOR_FUNCS` composed onto it); doing
    the same here would mean two resolutions of one definition, i.e. two places
    that could disagree about which tree was admitted. One admission registers
    one object and both lanes read it.

    ⛔ THE LENGTH IS ASSERTED, NOT TRUSTED — verbatim the reasoning
    `alert_series.series_for` states, and it applies harder here because the
    column comes from a formula a USER wrote. A column one element short does not
    raise anywhere downstream: it shifts every bar index by one, so every alert
    reads the previous bar's number forever while every value it reports is a
    real number from a real bar.
    """
    compute = definition.get("compute") or {}
    tree = compute.get("ast")
    budget = compute.get("budget")
    address = f"{def_id}.{plot_key}"

    def column(bars: list, params: dict) -> list:
        from api.services import ast_interpret
        out = ast_interpret.interpret(tree, bars,
                                      inputs=_inputs_for(definition, params),
                                      budget=budget)
        if len(out) != len(bars):
            raise AssertionError(
                f"{address}: series is {len(out)} long for {len(bars)} bars. "
                "A shorter column shifts every bar index silently and the "
                "closed-bar lane would read the wrong bar forever.")
        # ⚠️ NaN -> None AT THE BOUNDARY. `interpret` pads a warmup window with
        # NaN; `_evaluate_one_closed` reads `series[i] is None` as "no number
        # yet" and hands anything else to `check_condition`, where every
        # comparison against NaN is False — a formula that silently never fires
        # instead of one that reports it has no number. The two must not be
        # conflated where the lanes meet.
        return [None if (v is None or (isinstance(v, float) and math.isnan(v)))
                else v for v in out]

    def fn(bars: list, params: dict) -> Optional[float]:
        return _last_finite(column(bars, params))

    column.__name__ = f"_user_column_{def_id}_{plot_key}"
    fn.__name__ = f"_user_value_{def_id}_{plot_key}"
    fn.column = column                                  # type: ignore[attr-defined]
    return fn


# ─── THE THREE GATES ─────────────────────────────────────────────────────────

def _gate_definition(user_id: Any, def_id: str, version: Optional[int]) -> dict:
    """The definition exists, on THIS account, at the version being armed."""
    from api.services import user_definitions
    row = user_definitions.get(user_id, def_id, version)
    if row is None or row.get("deleted_at") is not None:
        raise AdmissionRefused(
            "definition",
            f"{def_id!r} {REFUSAL_FRAGMENTS['definition']}"
            + (f" at version {version}" if version is not None else ""))
    return row


def _gate_lane(row: Mapping[str, Any]) -> dict:
    """It is a FORMULA. `compute.kind` is the lane, and only `ast` is one."""
    definition = row.get("definition") or {}
    compute = definition.get("compute") or {}
    if compute.get("kind") != "ast":
        raise AdmissionRefused(
            "lane",
            f"{row.get('def_id')!r} declares compute.kind "
            f"{compute.get('kind')!r} — it {REFUSAL_FRAGMENTS['lane']}")
    return definition


def _gate_repaint(row: Mapping[str, Any], definition: Mapping[str, Any]) -> None:
    """⭐ THE BADGE IS A GATE, NOT A LABEL (spec §1.3).

    The verdict READ HERE is the one `user_definitions.save` STORED at save time
    from `ast_lint.lint_definition` — the shipped linter's own measurement, per
    PLOT, which is the granularity the owner ruled on. It is not recomputed:
    Phase D Task 10's store pinned that deliberately so a linter change cannot
    re-badge a definition that was already admitted without anybody noticing.

    Three outcomes, and the middle one is the whole reason this is a gate:

      * `non-repainting`      -> admitted.
      * `preview-repaints`    -> admitted ONLY with a recorded acknowledgement.
        The chikou case is the live example: a value that is FINAL the moment bar
        i+k closes but moves until then. An alert on it is defensible if the
        author has been told; it is a support ticket if they have not.
      * `repaints`            -> refused outright. An alert whose own fire may
        stop having happened is not an alert.
    """
    verdicts = row.get("repaint") or {}
    for plot_key in sorted(verdicts):
        mode = verdicts[plot_key]
        if mode == REPAINT_CLEAN:
            continue
        if mode == REPAINT_PREVIEW:
            if _ack_for(definition, plot_key):
                continue
            raise AdmissionRefused(
                "repaint",
                f"{row.get('def_id')}.{plot_key} measures {mode!r} and "
                f"{PREVIEW_ACK_FRAGMENT} — record one in "
                f"meta.{REPAINT_ACK_KEY} for this version to arm it anyway")
        raise AdmissionRefused(
            "repaint",
            f"{REFUSAL_FRAGMENTS['repaint']}: {row.get('def_id')}.{plot_key} "
            f"measures {mode!r}")


def _ack_for(definition: Mapping[str, Any], plot_key: str) -> bool:
    """Has the author acknowledged the preview-repaint badge for this plot?

    Accepts a truthy scalar (the whole definition acknowledged) or a mapping
    keyed by plot — because the verdict is per plot and an acknowledgement that
    could only be given wholesale would be an acknowledgement of things the
    author never read.
    """
    ack = ((definition.get("meta") or {}).get(REPAINT_ACK_KEY))
    if isinstance(ack, Mapping):
        return bool(ack.get(plot_key))
    return bool(ack)


def _gate_budget(definition: Mapping[str, Any], def_id: str) -> None:
    """⭐ AT THE VERSION BEING ARMED, WHICH IS THE ENTIRE POINT.

    `ast_budget` states it in its own docstring: *a definition registered under
    one budget and run under a later, smaller one computes forever at the old
    cost*. Registration happened whenever the author last saved; arming is now.
    Checking here is what makes a budget that TIGHTENED reach the alerts that
    were already armed under the looser one, at the next arm rather than never.

    ⛔ `BudgetExceeded` IS CAUGHT AND RE-RAISED, EVERY OTHER `TableRefusal` IS
    NOT. `check_budget` calls `node_count` and `max_lookback`, which can refuse
    `interpret:node` / `resolve:function` / `resolve:arity` / `resolve:window` —
    those are the TABLE saying no, not the budget, and relabelling one as a
    budget refusal is the wrong-door defect this module's header is about. They
    propagate as themselves.
    """
    from api.services import ast_budget
    compute = definition.get("compute") or {}
    try:
        ast_budget.check_budget(compute.get("ast"), compute.get("budget"))
    except ast_budget.BudgetExceeded as exc:
        raise AdmissionRefused(
            "budget",
            f"{def_id} {REFUSAL_FRAGMENTS['budget']}: {exc}") from exc


# ─── the arm-time cross-lane equality ────────────────────────────────────────

def _conformance():
    """`tools/ast_conformance` — the ONE cross-lane comparator, imported by path.

    ⛔ CALLED, NOT REIMPLEMENTED, AND THE LAYERING VIOLATION IS THE LESSER EVIL.
    That module already owns `run_js` (one node process, argv as a list, payload
    on stdin, `Array.from` so a warmup `null` is not coerced to 0), `run_py`, and
    `compare_lanes` — whose three refusals are precisely the "a zero that means
    nothing" shapes this gate must not produce: an empty lane, mismatched case
    ids, and columns of different lengths. A second comparator here would be a
    second definition of what agreement means, on the one number this phase's
    whole contract rests on.
    """
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    tools = os.path.join(root, "tools")
    if tools not in sys.path:
        sys.path.insert(0, tools)
    import ast_conformance                                    # noqa: PLC0415
    return ast_conformance


#: The case id the arm-time comparison uses. One case, because one definition is
#: being armed; named rather than anonymous so a difference report says what it
#: is about.
ARM_CASE_ID = "arm"


def cross_lane_report(tree: Any, bars: list) -> dict:
    """Run BOTH lanes over `tree` on `bars` and return `compare_lanes`' verdict.

    Separated from the gate so a test can read the numbers (`compared`,
    `differences`) rather than only observe a raise — a gate whose measurement
    cannot be printed is a gate nobody can audit.
    """
    conf = _conformance()
    cases = [{"id": ARM_CASE_ID, "ast": tree}]
    js = conf.run_js(cases, bars)
    py = conf.run_py(cases, bars)
    return conf.compare_lanes(js, py)


def _gate_cross_lane(definition: Mapping[str, Any], def_id: str,
                     bars: list) -> dict:
    """⭐ D-A2's RUNTIME HALF: THIS tree, THESE bars, BOTH lanes, 1e-9.

    ⚠️ THE MEASUREMENT IS A REFUSAL, NOT A FLAG. Recording a null `admitted_at`
    asserts the bookkeeping; raising asserts the thing the user experiences —
    that no notification left the building. The alert is never created, so there
    is nothing to go quiet.

    ⛔ AND A LANE THAT CANNOT RUN IS A REFUSAL TOO. `run_js` raises
    `LaneUnavailable` rather than returning `{}` when node or the interpreter is
    missing; catching that and admitting would mean a box without node admits
    everything, which is the failure direction that ships a formula that computes
    one number on the server and another on the author's chart, forever, with
    nothing to say so.
    """
    if not bars:
        raise AdmissionRefused(
            "bars", f"{REFUSAL_FRAGMENTS['bars']}: {def_id}")
    compute = definition.get("compute") or {}
    try:
        report = cross_lane_report(compute.get("ast"), bars)
    except AdmissionRefused:
        raise
    except Exception as exc:
        raise AdmissionRefused(
            "cross-lane",
            f"{def_id}: the lanes could not be compared ({type(exc).__name__}: "
            f"{exc}) — a formula this lane cannot prove equal is not admitted"
        ) from exc

    differences = report.get("differences") or []
    if differences:
        first = differences[0]
        raise AdmissionRefused(
            "cross-lane",
            f"{def_id}: {REFUSAL_FRAGMENTS['cross-lane']} "
            f"{first['bar_index']} (js={first['js']!r} py={first['py']!r}, "
            f"rel={first['rel']!r}); {len(differences)} of {report['compared']} "
            f"rows differ at rel-tol {report['rel_tol']}")
    if not report.get("compared"):
        raise AdmissionRefused(
            "cross-lane",
            f"{def_id}: the comparison covered ZERO rows — agreement over "
            "nothing is not agreement")
    return report


# ─── admission ───────────────────────────────────────────────────────────────

def admit_user_definition(user_id: Any, def_id: str,
                          version: Optional[int] = None, *,
                          bars: list) -> dict:
    """Admit a user formula to the alert lane, or RAISE naming the gate.

    Three conditions, all MEASURED, none assumed, in a declared order:

      1. the stored linter verdict is `non-repainting`, or `preview-repaints`
         WITH a recorded acknowledgement — the badge is a gate, not a label;
      2. the JS and Python lanes agree at 1e-9 on THESE bars — D-A2;
      3. the budget holds at the version being armed — a definition admitted
         under an older, larger budget is one running at the old cost forever.

    Two structural doors run first (the definition exists on this account; it is
    a formula at all), because the other three cannot be asked about a document
    that is not there.

    ⚠️ THE ORDER IS PART OF THE ATTRIBUTION. The cheap deterministic gates run
    before the one that spawns a node process, so a definition refused for
    repainting is refused for repainting rather than timing out first — and each
    test drives its gate with an input that passes every OTHER gate, so a kill is
    attributable to the door it names.

    Returns `{def_id, version, rev, ast_hash, addresses, compared, rel_tol}` and
    registers one entry in `USER_FUNCS` per plot.
    """
    row = _gate_definition(user_id, def_id, version)
    definition = _gate_lane(row)
    _gate_repaint(row, definition)
    _gate_budget(definition, def_id)
    report = _gate_cross_lane(definition, def_id, bars)

    plots = definition.get("plots") or []
    keys = [p.get("key") if isinstance(p, dict) else p for p in plots]
    keys = [str(k) for k in keys if k]
    addresses = []
    with _REGISTRY_LOCK:
        for plot_key in keys:
            address = f"{def_id}.{plot_key}"
            USER_FUNCS[scoped_key(user_id, address)] = _make_value_fn(
                def_id, plot_key, definition)
            addresses.append(address)
    return {
        "def_id": def_id,
        "version": row.get("version"),
        "rev": row.get("rev"),
        "ast_hash": row.get("ast_hash"),
        "addresses": addresses,
        "compared": report.get("compared"),
        "rel_tol": report.get("rel_tol"),
    }


def user_value_function(user_id: Any, address: str
                        ) -> Optional[Callable[[list, dict], Optional[float]]]:
    """The value function for ONE account's address, or `None` if not one.

    ⛔ A USER ID IS REQUIRED AND IT IS NOT DECORATIVE. There is no bare-address
    path into `USER_FUNCS` — the keys are scoped — so an address alone cannot
    reach anybody's column, and account B's id cannot reach account A's.

    ⚠️ A REGISTRY MISS REBUILDS FROM THE STORE THROUGH THE DETERMINISTIC GATES,
    AND THAT COSTS ONE THING WHICH IS STATED HERE. The registry is per-process:
    after a redeploy it is empty, and an alert armed yesterday must not silently
    stop firing (that is exactly the "quiet is indistinguishable from refused"
    defect). So the definition/lane/repaint/budget gates re-run — all four are
    pure functions of the stored blob and need no subprocess — and the CROSS-LANE
    equality does NOT: it needs a node process, and re-running it inside a
    60-second cycle would put a subprocess spawn on the evaluator thread. What
    that means precisely: the cross-lane proof is a property of (tree, bars) that
    was established at ARM time and is not re-established per cycle. A stored
    definition whose maths CHANGES gets a new `ast_hash`, a `compute.rev` bump
    and a `forget`, so the tree this rebuilds is the tree that was proven.

    RAISES `AdmissionRefused` on a definition that no longer passes — it does not
    return `None`. `None` here means "this is not a user address", which the
    builtin path must be able to read as "keep looking"; a refusal read the same
    way would be an alert that quietly stops.
    """
    if not is_user_address(address):
        return None
    key = scoped_key(user_id, address)
    fn = USER_FUNCS.get(key)
    if fn is not None:
        return fn

    def_id, plot_key = split_user_address(address)
    row = _gate_definition(user_id, def_id, None)
    definition = _gate_lane(row)
    _gate_repaint(row, definition)
    _gate_budget(definition, def_id)
    keys = {str(p.get("key")) if isinstance(p, dict) else str(p)
            for p in (definition.get("plots") or [])}
    if plot_key not in keys:
        raise AdmissionRefused(
            "definition",
            f"{address!r} {REFUSAL_FRAGMENTS['definition']} — "
            f"{def_id} declares plots {sorted(keys)}")
    rebuilt = _make_value_fn(def_id, plot_key, definition)
    with _REGISTRY_LOCK:
        USER_FUNCS[key] = rebuilt
    return rebuilt


def value_function_for_alert(alert: Mapping[str, Any]
                             ) -> Optional[Callable[[list, dict], Optional[float]]]:
    """The alert row's user value function, or `None` if it names a builtin.

    The evaluator's seam. It reads `user_id` off the ROW, which is the only place
    a background cycle can learn whose formula this is.
    """
    address = str(alert.get("indicator") or "")
    if not is_user_address(address):
        return None
    return user_value_function(alert.get("user_id"), address)


def refusal_for_alert(alert: Mapping[str, Any]) -> Optional[AdmissionRefused]:
    """⭐ THE ATTRIBUTION READ-OUT: which gate refuses this alert, if any.

    Returns the refusal instead of raising it, so a surface can say *why* an
    alert is silent instead of showing a user a row that simply never fires.
    `None` means "nothing refuses it" — either it is a builtin, or it is admitted.
    """
    try:
        value_function_for_alert(alert)
    except AdmissionRefused as exc:
        return exc
    return None


def arm_for_alert(user_id: Any, indicator: str, sym: str, tf: str,
                  *, bars: Optional[list] = None) -> Optional[dict]:
    """⭐ THE ARM-TIME CALL SITE. Returns `None` for a builtin address.

    ⛔ THIS IS WHY THE EQUALITY IS NOT A FUNCTION NOBODY CALLS. It is invoked from
    `indicator_alert_service.create` — the real arm path, the one the router
    posts to — so the mandated mutation "drop the arm-time cross-lane check" is a
    mutation to shipped behaviour and not to a test's private helper.

    Fetches the alert's own bars through the evaluator's own fetcher, so the
    formula is proven equal on the series it will actually be evaluated against
    rather than on a fixture.
    """
    if not is_user_address(indicator):
        return None
    def_id, _plot = split_user_address(indicator)
    if bars is None:
        from api.services import indicator_alert_evaluator as ev
        bars = ev._fetch_bars_for_alert(sym, tf, 200)
    return admit_user_definition(user_id, def_id, None, bars=bars)
