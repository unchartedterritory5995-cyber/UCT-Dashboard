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

import contextlib
import contextvars
import json
import math
import os
import re
import sys
import threading
import time
from typing import Any, Callable, Mapping, Optional, Sequence

from api.services.bars_window import HISTORY_WINDOW_BARS

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
    "requirements",   # the script needs something an ALERT cannot give it
    "repaint",        # the badge is a GATE, not a label (spec §1.3)
    "budget",         # the tree is over the budget AT THE VERSION BEING ARMED
    "cross-lane",     # the two lanes do not agree at 1e-9 on THESE bars
    "bars",           # there are no bars to prove anything on
    "plot",           # the document declares v2 and names no tree for THIS plot
    "withheld",       # the lane answers "no number" for this plot on EVERY bar
    "scalar",         # P0 0F: reads a current-only screener scalar (no history)
    "presentation",   # UIE P6: an `hlines` guide plot — drawn at fixed levels, not a value
    "line",           # 2026-11-02: the line this alert watched was deleted; a new line reuses its key
    "server-lane",    # W5-T13: a runtime document the server lanes do not run (server_lane_refusal)
    "server-run",     # W5-T13: the runtime service gave no value for the plot on these bars
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
    # ⛔ DELIBERATELY NOT THE SENTENCE `consumer_refusal` PRODUCES. That sentence
    # is APPENDED to this one, and it is the same prose the screener and the
    # sweep show — so using it as the gate fragment would make a
    # `pytest.raises(match=…)` on the ALERT gate satisfiable by any consumer's
    # refusal. The fragment names THIS door; the appended sentence explains it.
    "requirements": "was refused by the alert lane's consumer contract",
    "repaint": "a repainting formula cannot arm an alert",
    "budget": "is over its declared budget at the version being armed",
    "cross-lane": "the two lanes disagree at bar",
    "bars": "there are no bars to prove this formula on",
    "plot": "is a multi-tree document and carries no tree for this plot",
    # ⭐ C45 (C36's decision 6). The lane would compute this plot and answer "no
    # number" on every bar, forever: the alert would arm and never fire, with
    # nothing to say why. The codes that follow the fragment are
    # `ast_interpret.CHART_CLOCK_WHOLE`'s; the SENTENCES behind them have one
    # owner (`interpret.js::CHART_CLOCK_WITHHELD`) and are not copied here.
    "withheld": "is a value the alert lane cannot answer on any bar",
    # P0 0F. A table-declared scalar (`market_cap`, `rs_rank`, ...) is TODAY'S
    # value from the nightly screener snapshot, and this lane is offered none:
    # `interpret` seeds it as a hole and the comparison collapses the hole to a
    # confident 0 (X23), so the alert armed and could never fire.
    "scalar": "reads a current-only screener value that has no bar history",
    # ⭐ UIE PHASE 6 (OPEN-FINDINGS-2026-10 §1). An `hlines` plot is the 70/30 GUIDE drawn at fixed
    # levels — presentation, not a value (save and lint already treat it as not data-bearing).
    # Refused for ITSELF only, so "RSI with level lines" can alert on its RSI line.
    "presentation": "is a level-line guide drawn at fixed values, not a value an alert can watch",
    # ⭐ 2026-11-02 -- LINE IDENTITY (owner decision: a new line never inherits a deleted
    # line's alerts). The key resolves, but to a line created after the one this alert
    # was bound to (`user_definitions.line_identity`).
    "line": "watched a line that was deleted; a newer line using the same name is not watched by this alert",
    # ⭐ W5-T13 -- design 5.2 step 4: `runtime_definitions.server_lane_refusal`'s guard and
    # sentence follow the fragment verbatim (kill list, graded allowlist, pane stage, server
    # stage, service configured), so the member reads the chart's own reason.
    "server-lane": "is a script drawn bar by bar that the server does not run for alerts right now",
    # ⭐ W5-T13 -- design 5.1: the arm-time run (`_gate_runtime_service`, which replaces
    # `_gate_cross_lane` for a runtime document) did not answer `ok` for the plot; the
    # guard and its sentence follow (a run-wide runtime guard, or a `runtime:server-*`).
    "server-run": "the runtime service gave no value for it on these bars",
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
#: refused" defect, arriving by restart. So a MISS is not a refusal: it is
#: re-admitted, through the whole chain, by `value_function_for_alert`.
#:
#: ⭐⭐ AND AN ENTRY IN `USER_FUNCS` IS A PROOF RECEIPT, WHICH IS WHY EXACTLY ONE
#: FUNCTION MAY WRITE ONE. `admit_user_definition` is that function, and it only
#: reaches the write after `_gate_cross_lane` has proved THIS tree equal at 1e-9
#: on real bars. So "the key is present" MEANS "the tree behind it was proven in
#: this process", and every other path has to earn one rather than borrow it.
#:
#: ⚰️ `user_value_function` USED TO WRITE HERE TOO, and that made the receipt
#: forgeable: `GET /api/indicator-alerts/current-value` resolves through it, so a
#: PREFILL — a read-only display — could seed the registry with a tree nothing had
#: proven, and the next evaluation cycle would read that entry as an admission and
#: never look again. The rebuild now returns a function WITHOUT registering it.
#: `tests/test_user_definition_reproof.py` walks this module's AST for the
#: subscript-assignment and fails on a second writer by name.
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

    ⭐ WHAT IT DROPS IS A PROOF RECEIPT, NOT JUST A CACHED CLOSURE. Because
    `admit_user_definition` is the only writer, dropping an entry means the next
    evaluation of an alert on that address MUST re-enter the whole admission
    chain — including the 1e-9 cross-lane equality — on the tree the store now
    holds. That is the mechanism that makes an EDIT re-prove rather than inherit:
    `user_definitions.save` calls this on every append, so the proof and the tree
    can never drift apart without a refusal in between.
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

    ⚰️ THIS READ `spec.get("name")`, AND `name` IS NOT IN THE INPUT VOCABULARY AT
    ALL — so `out` was ALWAYS `{}` and the second loop, gated on `if name in out`,
    could never let an alert row's `params_json` reach a formula either. Both
    halves of spec §8's per-instance knobs were structurally inert.
    `defSchema.validateInput` (`app/src/components/chart/engine/defSchema.js`)
    REQUIRES `input.key`; `nativeRegistry.resolveInputs` reads `input.key`; and
    the house's own server-side reader, `signature/registry_defs.resolve_inputs`,
    reads `spec["key"]`. Three components on one vocabulary and this one on
    another is what made the defect survive: every component was individually
    correct and only the SEAM was wrong, which is why the rail on it
    (`test_alert_user_inputs.py`) DERIVES the key both sides read rather than
    retyping it.

    ⛔ AND `name` IS NOT KEPT AS A FALLBACK. A reader that accepted either would
    be a second vocabulary for one field — the twin this phase retires — and it
    would make the divergence unobservable again the moment somebody re-typed the
    wrong one.
    """
    out: dict[str, float] = {}
    # ⭐⭐ A TEXT ENUM REACHES THE TREE AS ITS OPTION'S INDEX — the client's
    # `nativeRegistry.treeScalars`, the same rule. A Pine `input.string(…, options)`
    # becomes `kind == 1` in the tree (`pine.js::enumCompare`); the instance and
    # the alert row hold the TEXT the member picked. ONE RULE, the client's, pinned
    # by one fixture both suites read (`tests/fixtures/enum_input_parity.json`):
    # an option's text -> its index; anything else (unknown text, a number, null,
    # a bool) -> the DEFAULT's index; a default not among the options -> index 0
    # (Pine refuses such a script, so the door never mints one).
    enum_options: dict[str, list] = {}
    for spec in (definition.get("inputs") or []):
        if not isinstance(spec, dict):
            continue
        key, default = spec.get("key"), spec.get("default")
        if spec.get("type") == "enum" and isinstance(key, str):
            opts = [o[0] if isinstance(o, list) and o else o for o in (spec.get("options") or [])]
            if opts and all(isinstance(o, str) for o in opts):
                enum_options[key] = opts
                out[key] = float(opts.index(default) if default in opts else 0)
                continue
        if isinstance(key, str) and isinstance(default, (int, float)) \
                and not isinstance(default, bool) and math.isfinite(float(default)):
            out[key] = float(default)
    for key, value in (params or {}).items():
        if key in enum_options:
            if isinstance(value, str) and value in enum_options[key]:
                out[key] = float(enum_options[key].index(value))
            continue
        if key in out and isinstance(value, (int, float)) \
                and not isinstance(value, bool) and math.isfinite(float(value)):
            out[key] = float(value)
    return out


def _trees_summary(trees: Any) -> str:
    """What `compute.trees` actually holds, for the refusal to say out loud.

    ⭐ THREE DIFFERENT DOCUMENTS REACH ONE GATE and a member has to be able to
    tell which one they have: an EMPTY map, a map missing THIS key, and a `trees`
    that is not a map at all are three different repairs. One gate, because the
    ruling is one ruling; three sentences, because the fix is not.
    """
    if not isinstance(trees, Mapping):
        return ("is not an object (it is %s)"
                % ("null" if trees is None
                   else "an array" if isinstance(trees, (list, tuple))
                   else type(trees).__name__))
    if not trees:
        return "is an EMPTY object and names no plot at all"
    return "names %s" % sorted(str(k) for k in trees)


def _withheld_reason(codes: Sequence[str]) -> str:
    """One short sentence for a whole-series withholding, by the code's FAMILY.

    ⛔ NOT the member-facing sentence — `interpret.js::CHART_CLOCK_WITHHELD` owns
    those, per code, and a copy here would be a second authority over the wording.
    This says only which KIND of read the lane cannot answer, so the refusal is
    actionable without the chart open."""
    parts = []
    if any(c.startswith("bar-index:") for c in codes):
        parts.append("it depends on `bar_index` — the count of bars since the "
                     "symbol's first, which a window of bars cannot know")
    if any(c.startswith("time-") for c in codes):
        parts.append("it reads `time(<timeframe>)` / `time_close(<timeframe>)`, a "
                     "clock the bars this lane is handed do not carry")
    if any(c.startswith("var-origin:") for c in codes):
        parts.append("it reads a `var` that holds what it was given on the symbol's "
                     "first bar, which a window of bars cannot know")
    return ("; ".join(parts) or "the lane withholds it on every bar") + "."


#: ⭐ P0 — the codes a plot is refused under when it reads a series the alert
#: lane is never handed (``unsupplied_reads``).
UNSUPPLIED_OTHER_SYMBOL = "other-symbol:unsupplied"
UNSUPPLIED_LOWER_TF = "lower-tf:unsupplied"

#: ⭐ PHASE 5 -- the codes a ``sym`` read is refused under now that the lane DOES
#: supply another symbol (``_symbol_bars``): a spelling the store cannot hold, one
#: that also names an index / commodity, or more than ``maxOtherSymbols`` tickers.
#: Twin of ``evaluability.js::crossSymbolAlertCode``.
OTHER_SYMBOL_UNSERVABLE = "other-symbol:unservable"
OTHER_SYMBOL_AMBIGUOUS = "other-symbol:ambiguous"
OTHER_SYMBOL_FAN_OUT = "other-symbol:fan-out"


def _cross_context() -> Mapping[str, Any]:
    # the light reader (no model client, no schema validator) of ``crossContext.json``
    from api.services import conversation_preflight
    return conversation_preflight.cross_context()


def store_ticker(ticker: str) -> str:
    """``BRK.B`` -> ``BRK-B`` (the store's key; ``otherSymbols.js::storeTickerOf``)."""
    m = re.fullmatch(r"([A-Z]{1,5})\.([A-Z])", ticker)
    return f"{m.group(1)}-{m.group(2)}" if m else ticker


def cross_symbol_refusal(tickers: Sequence[str]) -> Optional[str]:
    """⭐ PHASE 5 -- why this lane cannot supply ``tickers``, or ``None`` (it can)."""
    if not tickers:
        return None
    cc = _cross_context()
    pattern = re.compile(cc["tickerPattern"])
    if any(not pattern.match(t) for t in tickers):
        return OTHER_SYMBOL_UNSERVABLE
    if any(t in set(cc["ambiguousBare"]) for t in tickers):
        return OTHER_SYMBOL_AMBIGUOUS
    if len({store_ticker(t) for t in tickers}) > int(cc["maxOtherSymbols"]):
        return OTHER_SYMBOL_FAN_OUT
    return None


#: ⭐ PHASE 5 -- a SHORT-LIVED cache of another symbol's bars, so the alerts of one
#: cycle that read the same benchmark read the store once. Keyed (ticker, tf, want);
#: an entry lives ``_SYMBOL_TTL_S`` seconds -- under one 60-second cycle, so a later
#: cycle always reads the store again (no stale bar outlives the cycle it was read in).
_SYMBOL_TTL_S = 20.0
_SYMBOL_CACHE_MAX = 64
_SYMBOL_CACHE: "dict" = {}
_SYMBOL_LOCK = threading.Lock()


def _symbol_bars(ticker: str, tf: str, want: int) -> list:
    """Another symbol's latest ``want`` bars at ``tf`` -- THE SCAN'S OWN LOCAL LOADER
    (``scan_evaluator._read_bars``: ``bars_sqlite``, no network), so ``t`` is the
    same store key the alert's own bars carry and ``sym``'s exact-``t`` alignment
    holds. A bar the benchmark lacks is NaN there (UNKNOWN), never forward-filled."""
    import time as _time
    key = (ticker, str(tf), int(want))
    now = _time.monotonic()
    with _SYMBOL_LOCK:
        hit = _SYMBOL_CACHE.get(key)
        if hit is not None and now - hit[0] < _SYMBOL_TTL_S:
            return hit[1]
    from api.services.screener.scan_evaluator import _read_bars
    try:
        series = _read_bars(store_ticker(ticker), str(tf), int(want))
    except Exception:                                    # noqa: BLE001 -- unknown, not wrong
        series = []
    with _SYMBOL_LOCK:
        if len(_SYMBOL_CACHE) >= _SYMBOL_CACHE_MAX:
            _SYMBOL_CACHE.clear()
        _SYMBOL_CACHE[key] = (now, series)
    return series


#: The most bars another symbol is read for, whatever the formula asks.
_SYMBOL_MAX_BARS = HISTORY_WINDOW_BARS


def _external_reads(tree: Any) -> tuple:
    """(tickers read through ``sym``, whether any ``ltf`` node is read) -- an
    iterative walk over every node, the shape ``ast_interpret``'s walkers take."""
    tickers: set = set()
    lower = False
    stack = [tree]
    seen: set = set()
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, Mapping) or id(node) in seen:
            continue
        seen.add(id(node))
        kind = node.get("type")
        if kind == "sym" and isinstance(node.get("value"), str):
            tickers.add(node["value"].strip().upper())
        elif kind == "ltf":
            lower = True
        for value in node.values():
            if isinstance(value, (Mapping, list)):
                stack.append(value)
    return tuple(sorted(tickers)), lower


def unsupplied_reads(tree: Any, opts: Optional[Mapping[str, Any]] = None) -> list:
    """⭐⭐ P0 — the codes by which ``tree`` reads a series ``opts`` does not
    supply: ``other-symbol:unsupplied`` for a ``sym`` read with no
    ``opts["symbols"][ticker]``, ``lower-tf:unsupplied`` for an ``ltf`` read with
    no ``opts["lowerTf"]``. ``[]`` when everything it reads is in hand.

    ⛔ THE INTERPRETER DOES NOT FETCH -- THE CALLER SUPPLIES (``ast_interpret``'s
    ``sym`` / ``ltf`` arms). A caller that supplies nothing gets "no number" on
    every bar, which is exactly the silent never-firing alert this refuses."""
    tickers, lower = _external_reads(tree)
    supplied = (opts or {}).get("symbols") or {}
    out = []
    if any(not supplied.get(t) for t in tickers):
        out.append(UNSUPPLIED_OTHER_SYMBOL)
    if lower and not (opts or {}).get("lowerTf"):
        out.append(UNSUPPLIED_LOWER_TF)
    return out


def _unsupplied_reason(tree: Any, codes: Sequence[str]) -> str:
    tickers, _lower = _external_reads(tree)
    parts = []
    if OTHER_SYMBOL_UNSERVABLE in codes:
        parts.append("it reads %s, a spelling the bar store cannot hold"
                     % ", ".join("`sym('%s', …)`" % t for t in tickers))
    if OTHER_SYMBOL_AMBIGUOUS in codes:
        parts.append("it reads %s, letters that also name a market index or commodity, "
                     "so which instrument it means cannot be settled"
                     % ", ".join("`sym('%s', …)`" % t for t in tickers))
    if OTHER_SYMBOL_FAN_OUT in codes:
        parts.append("it reads %d other symbols (%s); an alert may read at most %d"
                     % (len(tickers), ", ".join(tickers), int(_cross_context()["maxOtherSymbols"])))
    if UNSUPPLIED_OTHER_SYMBOL in codes:
        parts.append("it reads another symbol (%s), and the alert lane evaluates "
                     "each alert on its own symbol's bars only"
                     % ", ".join("`sym('%s', …)`" % t for t in tickers))
    if UNSUPPLIED_LOWER_TF in codes:
        parts.append("it reads a timeframe below the chart (`ltf`), and the alert "
                     "lane holds no intraday bars for it")
    if "request:htf-newest-unconfirmed" in codes:
        parts.append("it reads a weekly or monthly value the way TradingView's "
                     "`request.security` shows it (`tf_merge`), whose value on the newest "
                     "finished bar depends on the date of the next session")
    return "; ".join(parts) + "."


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
    from api.services import user_definitions

    # ⭐ UIE PHASE 6 — A LEVEL-LINE GUIDE IS NOT A VALUE, decided BEFORE any tree is looked up (a v2
    # document carries no tree for it, which used to raise `plot` and refuse every sibling with it).
    # The same test `user_definitions` uses for "not data-bearing": the plot's declared style.
    declared = next((p for p in (definition.get("plots") or [])
                     if isinstance(p, Mapping) and str(p.get("key")) == str(plot_key)), None)
    if declared is not None and declared.get("style") == "hlines":
        raise AdmissionRefused(
            "presentation",
            f"{def_id}.{plot_key}: {def_id!r}'s plot {plot_key!r} {REFUSAL_FRAGMENTS['presentation']} — "
            "alert on one of the definition's other plots instead (its line, not its guides).")

    compute = definition.get("compute") or {}
    # W1b — a plot evaluates ITS tree; the scan alias is a tree-less document's.
    # ⛔ `.get(key, default)` RATHER THAN `or`: a tree that is present and falsy
    # is a document defect for `user_definitions.validate_v2` to name, not
    # something to paper over with the scan tree's answer — and `ast_lint` and
    # the JS lane's `hasOwnProperty` branch say exactly the same thing. Reading
    # `compute.ast` for every plot answered an alert on the MACD line with
    # `hist > 0`: a 0/1 flag reported to a member as a price distance.
    #
    # 🔴 AND THE FALLBACK ITSELF PERFORMED THAT EXACT FAILURE UNTIL W1b.8's
    # FIX ROUND. `(compute.get("trees") or {}).get(plot_key, compute.get("ast"))`
    # papers over a falsy MAP the way `or` papers over a falsy TREE, one level up:
    # with `compute.trees == {}` — the very shape `validate_v2` refuses as
    # adversarial — an alert armed on plot `macd` answered with the SCAN tree's
    # column, measured byte-equal to the scan tree's own last value. A missing KEY
    # did the same. `save()` refuses such a document, but THIS PATH NEVER
    # RE-VALIDATES what is already stored (W1b.8 report §9.6), so every row
    # written before that door existed reaches here.
    #
    # ⛔ AND THE SCOPE IS NARROW ON PURPOSE — THE FALLBACK IS CORRECT FOR A
    # GENUINE v1 DOCUMENT. A single-tree document carries no `trees` at all and
    # every one of its plots legitimately resolves to `compute.ast`; refusing
    # those would break every definition saved before multi-plot existed. What is
    # wrong is falling back on a document that CLAIMS to be multi-tree, and
    # `user_definitions.declares_v2` is the one place that question is answered —
    # off `_V2_COMPUTE_KEYS`, the same roster `validate_v2` refuses from, so the
    # two doors cannot come to disagree about what a v2 document is.
    #
    # ⚠️ `ast_lint.lint_definition` CARRIES THE SAME LOOKUP AND IS NOT THE SAME
    # DEFECT — checked, not assumed. Its only product caller is
    # `user_definitions.lint_verdict`, which `save()` calls AFTER
    # `validate_v2(definition)` has already refused this shape by name, so the
    # fallback there is unreachable with a v2 document short a tree. This lane is
    # different precisely because it reads a row that was stored.
    trees = compute.get("trees")
    if isinstance(trees, Mapping) and plot_key in trees:
        tree = trees[plot_key]
    elif user_definitions.declares_v2(compute):
        raise AdmissionRefused(
            "plot",
            f"{def_id}.{plot_key}: {def_id!r} {REFUSAL_FRAGMENTS['plot']} — "
            f"compute.trees {_trees_summary(trees)}. compute.ast is the SCAN "
            "plot's tree, so answering with it would report another plot's "
            "number under this plot's name. Re-save the definition with a tree "
            "for every plot, or drop compute.trees/treesHash/scanPlot/sources to "
            "store it as a single-tree document.")
    else:
        tree = compute.get("ast")
    budget = compute.get("budget")
    address = f"{def_id}.{plot_key}"
    # ⭐⭐ C45 — WHAT THE LANE ADDS FOR THIS DOCUMENT, DECIDED ONCE. A Pine
    # translation's `barindex` is TradingView's `bar_index`, and this lane's bars
    # are a window whose start it cannot place — so a value that depends on the
    # count is withheld (`ast_interpret.bar_index_mask`), exactly as the member's
    # chart withholds it off the listing. Empty for every other document, so their
    # `interpret` call is the one it always was.
    from api.services import ast_interpret as _lane
    lane_opts = _lane.lane_opts_for(definition)
    # ⛔ AND A PLOT THE LANE WITHHOLDS ON EVERY BAR IS REFUSED HERE, BY NAME
    # (C36's decision 6). `time("W")` reads a clock this lane's date-keyed bars do
    # not carry; `bar_index % 3` reads a count it cannot know. Both evaluated to
    # "no number" on every bar, which every consumer files correctly — and which
    # meant an alert that armed, said nothing, and never fired. Asked of THIS
    # plot's tree with the SAME opts the column below evaluates with; no bars are
    # needed (with no `tf` the decision reads none).
    # ⭐ P0 0F -- THE SAME QUESTION THE SCREENER AND THE BACKTEST ASK BEFORE THEY
    # EVALUATE (`unresolved_scalars`), asked here with NO scalars, because this
    # lane never has any. A scalar is one number per symbol, dated to a nightly
    # snapshot: the lane cannot supply it, and supplying today's value on past
    # bars would fabricate a history. Refused by name instead of arming an alert
    # that reads a hole through a comparison as a permanent "no".
    # ⚠️ Only of a real tree: a missing/falsy one keeps ITS own refusal below.
    scalars_read = (_lane.unresolved_scalars(tree, None)
                    if isinstance(tree, Mapping) else [])
    if scalars_read:
        raise AdmissionRefused(
            "scalar",
            f"{address} {REFUSAL_FRAGMENTS['scalar']} ({', '.join(scalars_read)}): "
            "it is one number per symbol from the nightly snapshot, so an alert "
            "on it would arm and never fire. It works as a screen.")
    withheld = _lane.whole_series_withheld(tree, [], budget=budget, opts=lane_opts)
    # ⭐⭐ P0 — AND A PLOT THAT READS A SERIES THIS LANE IS NEVER SUPPLIED. A
    # `sym('SPY', …)` or `ltf(…, '60')` evaluates off `opts["symbols"]` /
    # `opts["lowerTf"]`, and `lane_opts_for` supplies neither — so before P0 the
    # plot armed, evaluated "no number" on every bar (or, in a comparison, a
    # confident 0), and never fired. Refused here, under the SAME gate and with
    # the same sibling rule as a whole-series withholding: it is one.
    # ⭐⭐ PHASE 5 -- ANOTHER SYMBOL IS SUPPLIED NOW. A servable, unambiguous ticker
    # (at most `maxOtherSymbols`) is loaded at EVALUATION from the store the scan
    # reads (`_symbol_bars`), at the alert's own timeframe; anything else keeps a
    # named refusal. The supply check below is asked with the tickers marked
    # supplied, so `ltf` keeps its own refusal unchanged.
    tickers, _lower = _external_reads(tree)
    cross_code = cross_symbol_refusal(tickers)
    supplied_syms = tuple(tickers) if tickers and cross_code is None else ()
    check_opts = (dict(lane_opts, symbols={t: (True,) for t in supplied_syms})
                  if supplied_syms else lane_opts)
    unsupplied = unsupplied_reads(tree, check_opts)
    if cross_code:
        unsupplied = [cross_code] + [c for c in unsupplied if c != UNSUPPLIED_OTHER_SYMBOL]
    # ⭐⭐ ENGINE 55 — PINE'S MERGED HIGHER-TIMEFRAME READ (`tf_merge`): the week's
    # or month's value appears on the bar that closes it, and whether the newest
    # finished bar closes its period is the next session's date — so on the bar an
    # alert reads the value is withheld (`ast_interpret.tf_merge_mask`). Refused
    # here, under the `withheld` gate and its sibling rule.
    if _lane.reads_tf_merge(tree):
        unsupplied = list(unsupplied) + [_lane.TF_MERGE_NEWEST_CODE]
    if unsupplied:
        raise AdmissionRefused(
            "withheld",
            f"{address} {REFUSAL_FRAGMENTS['withheld']} ({', '.join(unsupplied)}): "
            + _unsupplied_reason(tree, unsupplied)
            + " An alert on it would arm and never fire. It still draws on a "
            "chart that can supply it.")
    if withheld:
        raise AdmissionRefused(
            "withheld",
            f"{address} {REFUSAL_FRAGMENTS['withheld']} ({', '.join(withheld)}): "
            + _withheld_reason(withheld)
            + " An alert on it would arm and never fire. It still draws on a "
            "chart that can answer it.")
    # ⭐⭐ C48 / C45 — THE GATES THE MEMBER DOOR STAMPED ON THIS PLOT
    # (`meta.blockRuns`): a call written in an `if` block, in one arm of a `?:` or
    # on the right of a v6 `and` / `or` keeps a history of only the bars that code
    # runs, and this lane computes it on every bar. The member's chart refuses such
    # a plot, by name, wherever the code runs after a bar it skipped
    # (`engine/blockRuns.js`); this lane asks the same question of the same guards
    # on ITS bars (`block_runs.block_runs_refusal`) — at arm time
    # (`arm_for_alert`) and on every evaluation (`column`), so a verdict the newest
    # bars change is honoured the moment they arrive. Captured with the tree.
    from api.services import block_runs as _block_runs
    gates = _block_runs.block_runs_for(definition, plot_key)

    def block_runs_refusal(bars: list, params: dict, opts: Optional[Mapping] = None) -> Optional[str]:
        """Why this plot is withheld on ``bars`` (the gate's own sentence), or None."""
        if not gates:
            return None
        from api.services import ast_interpret
        return _block_runs.block_runs_refusal(
            definition, plot_key,
            lambda guard: ast_interpret.interpret(guard, bars, inputs=_inputs_for(definition, params),
                                                  budget=budget, opts=dict(opts) if opts else lane_opts))

    def run_opts_for(bars: list, tf: Optional[str]) -> Optional[dict]:
        """The opts this plot's tree evaluates with on ``bars`` -- ``None`` where it
        cannot evaluate at all: it reads another symbol and no timeframe says at which
        resolution (no number on any bar, never the alert's own symbol in its place).
        ⛔ ONE reader, for the column AND for every check of its gates, so a gate is
        never asked under opts the plot itself was not computed with."""
        if not supplied_syms:
            return lane_opts
        if not tf:
            return None
        # ⭐ L3 (review round 2) — `bars or []`: the evaluator's fetch may hand back None
        want = min(_SYMBOL_MAX_BARS, len(bars or []) + int(getattr(fn, "lookback", 0) or 0))
        return dict(lane_opts, symbols={t: _symbol_bars(t, tf, want) for t in supplied_syms})

    def withheld(bars: list, params: Optional[Mapping] = None, tf: Optional[str] = None) -> Optional[str]:
        """⭐⭐ C48 / C45 (review round 2, L1 + M2) -- why this plot is withheld on
        ``bars`` under THE ALERT'S OWN params and timeframe, or None: the gate's own
        sentence. The one check behind three callers -- ``column`` per evaluation (it
        shares the opts it computed), ``arm_for_alert`` before the row is inserted,
        and ``indicator_alert_service.diagnose`` when an armed alert has gone quiet --
        so all three answer one question the same way. ⚰️ The arm path asked with
        ``params = {}`` and the lane's bare opts, so an alert armed with a member's
        own inputs was proven on a plot it would never evaluate."""
        if not gates:
            return None
        run_opts = run_opts_for(bars, tf)
        if run_opts is None:
            return None
        return block_runs_refusal(bars, dict(params or {}), run_opts)

    def column(bars: list, params: dict, tf: Optional[str] = None) -> list:
        from api.services import ast_interpret
        # 🔴 NOT COMPUTABLE IS NOT ZERO, AND THE COMPARISON IS WHERE IT STOPS
        # BEING VISIBLE. `interpret` pads a warmup with NaN and `_cmp` answers 0
        # against a NaN, so a tree the series cannot answer — `close >
        # sma(close, 300)` on 200 bars — returns 200 finite `0.0`s and zero
        # `None`s: a confident, permanent "no" to a question this lane cannot
        # ask. The honest answer is that there is no number yet, and `None` is
        # this lane's word for that (see `_last_finite`). Asked BEFORE evaluating,
        # exactly as `unresolved_scalars` is asked before a scan evaluates.
        short = ast_interpret.unresolved_lookback(tree, bars)
        if short:
            return [None] * len(bars)
        # ⛔ NO TIMEFRAME, NO OTHER SYMBOL: its bars cannot be read at the alert's
        # resolution, so every bar is UNKNOWN -- never the alert's own symbol in its
        # place (`run_opts_for`).
        run_opts = run_opts_for(bars, tf)
        if run_opts is None:
            return [None] * len(bars)
        out = ast_interpret.interpret(tree, bars,
                                      inputs=_inputs_for(definition, params),
                                      budget=budget, opts=run_opts)
        if len(out) != len(bars):
            raise AssertionError(
                f"{address}: series is {len(out)} long for {len(bars)} bars. "
                "A shorter column shifts every bar index silently and the "
                "closed-bar lane would read the wrong bar forever.")
        # ⭐⭐ C48 / C45 — withheld on THESE bars, as the member's chart withholds
        # it: no number on any bar (`None`), never the every-bar value. Asked AFTER
        # the plot's own tree, with its own inputs and opts (the chart's order).
        if gates and block_runs_refusal(bars, params, run_opts):
            return [None] * len(bars)
        # ⚠️ NaN -> None AT THE BOUNDARY. `interpret` pads a warmup window with
        # NaN; `_evaluate_one_closed` reads `series[i] is None` as "no number
        # yet" and hands anything else to `check_condition`, where every
        # comparison against NaN is False — a formula that silently never fires
        # instead of one that reports it has no number. The two must not be
        # conflated where the lanes meet.
        return [None if (v is None or (isinstance(v, float) and math.isnan(v)))
                else v for v in out]

    def fn(bars: list, params: dict, tf: Optional[str] = None) -> Optional[float]:
        return _last_finite(column(bars, params, tf))

    column.__name__ = f"_user_column_{def_id}_{plot_key}"
    fn.__name__ = f"_user_value_{def_id}_{plot_key}"
    fn.column = column                                  # type: ignore[attr-defined]
    # ⭐ C48 / C45 — the plot's gates: `withheld` under an alert's own params and tf
    # (the arm path and the silent-alert diagnosis), `block_runs_refusal` under opts
    # a caller states
    fn.block_runs_refusal = block_runs_refusal          # type: ignore[attr-defined]
    fn.withheld = withheld                              # type: ignore[attr-defined]
    # ⭐ PHASE 5 -- the other symbols this plot reads: the evaluator passes the
    # alert's timeframe (``tf=``) to a function that names any.
    fn.reads_symbols = supplied_syms                    # type: ignore[attr-defined]
    column.reads_symbols = supplied_syms                # type: ignore[attr-defined]
    # ⭐ THE TREE'S OWN DECLARED HISTORY, CARRIED ON THE ADMITTED OBJECT. The
    # evaluator sizes its bar fetch from this BEFORE it fetches, and a second
    # resolution of the definition to answer "how much past does it need" would
    # be a second reading of a stored blob that `forget` + re-admission exists to
    # make singular. Computed once, at admission, off the SAME captured tree the
    # column evaluates.
    try:
        from api.services import ast_interpret
        fn.lookback = ast_interpret.max_lookback(tree)   # type: ignore[attr-defined]
    except Exception:                                    # noqa: BLE001
        fn.lookback = None                               # type: ignore[attr-defined]
    return fn


def _with_line(fn: Any, user_id: Any, def_id: str, plot_key: str,
               version: Any = None) -> Any:
    """⭐ 2026-11-02 -- stamp the LINE a value function computes, by identity rather
    than by key (`user_definitions.line_identities`, the row's `line_ids` column).
    The registry is keyed by ADDRESS, so two alert rows bound to two different
    lines that shared one key would share this object; `_check_line` compares each
    row's `plot_uid` with it."""
    from api.services import user_definitions as _ud
    fn.line_id = _ud.line_identities(user_id, def_id, version).get(plot_key)  # type: ignore[attr-defined]
    return fn


# ─── W5-T13: A RUNTIME DOCUMENT ON THE ALERT LANE ────────────────────────────
#
# ⭐ `docs/pine/SERVER-RUNTIME-DESIGN.md` 5.1 / 5.2 / 3.7. A stored `compute.kind ==
# "runtime"` document (a Pine script drawn bar by bar) is computed by the separate
# pine-runtime service, reached ONLY through `runtime_server_lane.runtime_column_fn`
# (W5-T11), which asks the stored verdict and `runtime_definitions.server_lane_refusal`
# on EVERY call before any network call. This block adds what the ALERT lane owns:
# the arm-time run (`_gate_runtime_service`, replacing `_gate_cross_lane`), the value
# function (`_make_runtime_value_fn`, beside `_make_value_fn`), the bar-time unit the
# wire carries (`runtime_wire_bars`), the window (`runtime_window_for_alert`) and the
# cycle's ONE request per (sym, tf) group and definition (`runtime_cycle_batch`).
#
# ⛔ v1 EVALUATES CLOSED BARS ONLY (ruling Q3): the bars sent end at the newest CLOSED
# bar (`indicator_alert_evaluator.closed_bar_index`, the closed lane's own reader) and
# the client stamps `newestBarIsForming: false`. A bar still forming is never sent, so
# no value the service returns can describe it; its slot in the column is `None`.

#: The service profile the alert lane runs under (design 3.2 / 3.4: alert priority, 15 s).
RUNTIME_LANE = "alert"

#: The timeframes whose store key is a calendar DATE (`bars_sqlite`: a ``YYYYMMDD`` int).
RUNTIME_DATE_TFS = ("D", "W", "M")

#: ⭐ The profile window a runtime document reads (design 5.1: "5,000 D / 32,768
#: intraday"), because it has no tree whose lookback could be measured. 32,768 is the
#: runtime's own `HISTORY` limit (`engine/runtime/limits.js` `DEFAULT_LIMITS`), held equal
#: by a rail, and the service's `bars.n` ceiling (design 3.2).
RUNTIME_WINDOW_DATE = HISTORY_WINDOW_BARS
RUNTIME_WINDOW_INTRADAY = 32768

#: The cycle's batch for the (sym, tf) group being evaluated, or None (see
#: `runtime_cycle_batch`). A context variable, so a batch never leaks into another
#: thread's evaluation.
_RUNTIME_BATCH: contextvars.ContextVar = contextvars.ContextVar("alert_runtime_batch", default=None)


def is_runtime_document(definition: Any) -> bool:
    """Is this a runtime-lane document? The store's own reader, never retyped."""
    from api.services import runtime_definitions
    return bool(runtime_definitions.is_runtime(definition))


def runtime_window(tf: Any) -> int:
    """How many bars a runtime alert on ``tf`` reads (design 5.1)."""
    return RUNTIME_WINDOW_DATE if str(tf or "") in RUNTIME_DATE_TFS else RUNTIME_WINDOW_INTRADAY


def runtime_output_keys(definition: Mapping[str, Any]) -> list:
    """The plot keys a runtime document computes (`compute.outputs`, in order). A plot
    with no output (drawn by the run's objects) is not a value an alert can watch."""
    outputs = (definition.get("compute") or {}).get("outputs") or {}
    return [str(k) for k in outputs]


def runtime_inputs_for(definition: Mapping[str, Any], params: Optional[Mapping]) -> dict:
    """The script's inputs for one alert: the row's ``params_json`` restricted to the
    inputs the document DECLARES (``inputs[].key``). The runtime reads the same keys and
    drops every other one itself (`runtimeInputs.js::runtimeInputValues`), so the
    restriction moves no value; it keeps an unrelated field a client wrote from being
    sent (and refused by the client as a malformed input)."""
    declared = {str(s.get("key")) for s in (definition.get("inputs") or [])
                if isinstance(s, Mapping) and s.get("key")}
    return {str(k): v for k, v in dict(params or {}).items() if str(k) in declared}


class RuntimeBarsRefused(RuntimeError):
    """A bar whose time this lane cannot state in the unit the runtime reads."""

    def __init__(self, guard: str, sentence: str):
        super().__init__(f"{guard}: {sentence}")
        self.guard = guard
        self.sentence = sentence


def _wire_time(t: Any, tf: str) -> Optional[float]:
    """One stored bar's ``t`` as the instant the runtime reads, or ``None``.

    ⭐⭐ THE UNIT DECISION (W5-T13). The store keys a date timeframe by a ``YYYYMMDD``
    INT and an intraday one by unix SECONDS (`bars_sqlite`'s docstring; the evaluator
    passes it verbatim). The chart hands the runtime a date bar as its ISO date and an
    intraday bar as unix seconds, and the runtime's clocks place an ISO date at its
    session's opening instant (`indicators.js::barOpenInstant`). The wire carries numbers
    only (design 3.2: ``t`` is Float64), so a date bar is sent as THAT instant, computed
    by the Python twin of the same rule (`indicator_compute.bar_open_instant`), never by
    a second rule written here. An intraday instant passes the twin's unit gate verbatim.
    A ``YYYYMMDD`` int sent raw would be read as seconds (August 1970)."""
    from api.services import indicator_compute
    if str(tf) in RUNTIME_DATE_TFS:
        if isinstance(t, str):
            iso = t[:10]
        elif isinstance(t, int) and not isinstance(t, bool) and 19000101 <= t <= 99991231:
            iso = "%04d-%02d-%02d" % (t // 10000, (t // 100) % 100, t % 100)
        else:
            return None
        return indicator_compute.bar_open_instant(iso, str(tf))
    if isinstance(t, (str, bool)):
        return None
    return indicator_compute.bar_open_instant(t, str(tf))


def runtime_wire_bars(bars: Sequence[Mapping[str, Any]], tf: str, now: float) -> tuple:
    """``(wire_bars, k)``: the CLOSED bars ``bars[:k + 1]`` with ``t`` stated as the
    instant the runtime reads (`_wire_time`), and ``k`` the newest closed bar (``-1``:
    none). RAISES `RuntimeBarsRefused` (``runtime:server-integrity``) when a bar's time
    cannot be stated, or two bars state one instant: a hole is never sent as a guess."""
    from api.services import indicator_alert_evaluator as ev
    from api.services import pine_runtime_client as prc
    rows = list(bars or [])
    k = ev.closed_bar_index(rows, str(tf or ""), now)
    out = []
    prev = None
    for i, b in enumerate(rows[:k + 1]):
        t = _wire_time(b.get("t"), str(tf or ""))
        if t is None or (prev is not None and not t > prev):
            raise RuntimeBarsRefused(
                prc.INTEGRITY, f"bar {i} has a time ({b.get('t')!r}) this lane cannot state as "
                f"an instant on the {tf!r} timeframe, so nothing is sent")
        prev = t
        out.append({"t": t, "o": b.get("o"), "h": b.get("h"), "l": b.get("l"),
                    "c": b.get("c"), "v": b.get("v")})
    return out, k


class RuntimeBatch:
    """The answers one (sym, tf) group's requests returned, one per definition version.

    `runtime_cycle_batch` fills it; every runtime value function evaluated inside the
    group asks it first (`_BatchedClient`), so the group costs ONE request per stored
    definition version (design 3.2: a request carries one definition) instead of one per
    alert. A lookup that misses goes to the service on its own: a miss costs a request,
    never a value."""

    def __init__(self, sym: str, tf: str, now: float):
        self.sym, self.tf, self.now = sym, tf, now
        self.results: dict = {}
        self.requests = 0
        self.misses = 0

    @staticmethod
    def key(def_id: Any, version: Any, job: Any) -> Optional[tuple]:
        from api.services import pine_runtime_client as prc
        try:
            _n, _cols, bars_sha = prc.encode_bars(job.bars)
            inputs = json.dumps(dict(job.runtime_inputs or {}), sort_keys=True,
                                separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        except Exception:  # noqa: BLE001 -- an unencodable job is the client's to refuse
            return None
        return (str(def_id), version, job.ticker, job.exchange, job.tf, inputs, bars_sha)

    def lookup(self, def_id: Any, version: Any, job: Any) -> Any:
        k = self.key(def_id, version, job)
        hit = self.results.get(k) if k is not None else None
        if hit is None:
            return None
        wanted, result = hit
        return result if set(job.want) <= wanted else None


class _BatchedClient:
    """A `PineRuntimeClient`-shaped door that answers from the group's batch and sends
    only what the batch does not hold."""

    def __init__(self, batch: RuntimeBatch):
        self.batch = batch

    def run(self, *, def_id, version, doc, owner_id, profile, jobs, cache=None):
        if profile == RUNTIME_LANE and len(jobs) == 1:
            hit = self.batch.lookup(def_id, version, jobs[0])
            if hit is not None:
                return [hit]
        self.batch.misses += 1
        return _runtime_client().run(def_id=def_id, version=version, doc=doc, owner_id=owner_id,
                                     profile=profile, jobs=jobs, cache=cache)


def _runtime_client():
    """The one door (`pine_runtime_client.client_from_env`), read per call."""
    from api.services import pine_runtime_client as prc
    return prc.client_from_env()


def _client_factory() -> Callable[[], Any]:
    batch = _RUNTIME_BATCH.get()
    if batch is None:
        return _runtime_client
    return lambda: _BatchedClient(batch)


def _make_runtime_value_fn(row: Mapping[str, Any], def_id: str, plot_key: str,
                           definition: Mapping[str, Any]) -> Callable[..., Optional[float]]:
    """One admitted (runtime document, plot) -> "what number is this script at now".

    The `_make_value_fn` shape (``fn`` + ``fn.column``), with the symbol the run reads:
    ``fn(bars, params, tf=None, sym=None)``. Callers reach it through `call_series`, the
    one place that knows which arguments a value function takes.

    The column is ``len(bars)`` long, ``None`` for na and for every bar after the newest
    closed one. A refusal (the stored verdict, the server-lane admission, the run, the
    transport) RAISES `runtime_server_lane.ServerLaneWithheld` by name -- never an
    all-``None`` column -- so the cycle records nothing and `diagnose` names the guard.
    `_last_finite` reads the value, exactly as for a formula."""
    from api.services import pine_runtime_client as prc
    from api.services import runtime_server_lane as rsl

    address = f"{def_id}.{plot_key}"

    def column(bars: list, params: Optional[Mapping] = None, tf: Optional[str] = None,
               sym: Optional[str] = None) -> list:
        if not sym or not tf:
            raise rsl.ServerLaneWithheld(
                prc.INTEGRITY, f"{address}: a script drawn bar by bar runs on one symbol and "
                "timeframe, and this call named none")
        batch = _RUNTIME_BATCH.get()
        now = batch.now if batch is not None and (batch.sym, batch.tf) == (sym, tf) else time.time()
        try:
            wire, k = runtime_wire_bars(bars, tf, now)
        except RuntimeBarsRefused as exc:
            raise rsl.ServerLaneWithheld(exc.guard, exc.sentence) from exc
        out: list = [None] * len(bars or [])
        if k < 0:
            return out
        run = rsl.runtime_column_fn(row, plot_key, RUNTIME_LANE, client_factory=_client_factory())
        col = run(wire, runtime_inputs_for(definition, params), tf=str(tf), ticker=str(sym))
        if len(col) != len(wire):
            raise AssertionError(
                f"{address}: the runtime column is {len(col)} long for {len(wire)} closed bars")
        for i, v in enumerate(col):
            out[i] = v if isinstance(v, (int, float)) and math.isfinite(v) else None
        return out

    def fn(bars: list, params: Optional[Mapping] = None, tf: Optional[str] = None,
           sym: Optional[str] = None) -> Optional[float]:
        return _last_finite(column(bars, params, tf, sym))

    def withheld(bars: list, params: Optional[Mapping] = None, tf: Optional[str] = None) -> Optional[str]:
        """No block-run gates: `meta.blockRuns` is an `ast` stamp (design 5.2 step 5); the
        runtime decides its own analogue inside the run and answers with a guard."""
        return None

    column.__name__ = f"_runtime_column_{def_id}_{plot_key}"
    fn.__name__ = f"_runtime_value_{def_id}_{plot_key}"
    for f in (fn, column):
        f.runtime_plot = plot_key                       # type: ignore[attr-defined]
        f.runtime_row = row                             # type: ignore[attr-defined]
        f.reads_symbols = ()                            # type: ignore[attr-defined]
    fn.column = column                                  # type: ignore[attr-defined]
    fn.withheld = withheld                              # type: ignore[attr-defined]
    fn.block_runs_refusal = lambda *a, **k: None        # type: ignore[attr-defined]
    fn.lookback = None                                  # type: ignore[attr-defined]
    return fn


def call_series(f: Any, bars: list, params: Mapping, *, tf: Optional[str] = None,
                sym: Optional[str] = None) -> Any:
    """⭐ THE ONE CALL SHAPE for an alert value function or column: a runtime plot takes
    the timeframe and the symbol (the run reads both), a builtin column that reads a
    BENCHMARK (`alert_rs_series`, `fn.reads_benchmark`) the timeframe and the symbol too
    (the benchmark is resolved per symbol, at the alert's own timeframe), a plot reading
    another symbol the timeframe (`_symbol_bars`), every other the bars and params alone.
    The two evaluator lanes and `diagnose` call through here, and the prefill does for a
    runtime plot, so none can hand a runtime plot a call without the symbol it runs on."""
    if getattr(f, "runtime_plot", None) is not None:
        return f(bars, params, tf=tf, sym=sym)
    # ⭐ 2026-11-06 (RS 2b-04) -- the two-symbol lane. Without tf and sym the column
    # answers no value (closed lane only), so this branch is what lets it fire at all.
    if getattr(f, "reads_benchmark", False):
        return f(bars, params, tf=tf, sym=sym)
    if getattr(f, "reads_symbols", None):
        return f(bars, params, tf=tf)
    return f(bars, params)


def _stored_row(user_id: Any, def_id: str, version: Any = None) -> Optional[dict]:
    from api.services import user_definitions
    try:
        return user_definitions.get(user_id, def_id, version)
    except Exception:  # noqa: BLE001
        return None


def runtime_window_for_alert(alert: Mapping[str, Any]) -> Optional[int]:
    """The window a RUNTIME alert reads (`runtime_window`), or ``None`` for any other
    alert. No admission, no bars, no service call: the registered function says it is a
    runtime plot, or the stored row's lane does."""
    address = str(alert.get("indicator") or "")
    if not is_user_address(address):
        return None
    fn = USER_FUNCS.get(scoped_key(alert.get("user_id"), address))
    if fn is not None:
        return runtime_window(alert.get("tf")) if getattr(fn, "runtime_plot", None) else None
    def_id, _plot = str(address).partition(".")[::2]
    row = _stored_row(alert.get("user_id"), def_id, alert.get("def_version"))
    if row and is_runtime_document(row.get("definition")):
        return runtime_window(alert.get("tf"))
    return None


def _runtime_fn_is_current(fn: Any, user_id: Any, def_id: str) -> bool:
    """Is the registered runtime function still the stored definition's newest version?

    ⛔ A runtime save does not `forget` (`user_definitions._save_runtime` appends and
    returns; the formula `save` forgets on every append), so a function captured at arm
    would run the OLD script for ever after an edit. Asked on every registry hit: a new
    version, a changed source or a tombstone drops the entry and re-enters the arm path."""
    held = getattr(fn, "runtime_row", None) or {}
    row = _stored_row(user_id, def_id, None)
    return (bool(row) and row.get("deleted_at") is None
            and row.get("version") == held.get("version")
            and row.get("ast_hash") == held.get("ast_hash"))


def _gate_server_lane(row: Mapping[str, Any]) -> None:
    """5.2 step 4 -- `runtime_definitions.server_lane_refusal(row, lane="alert")`, the ONLY
    admission question a server lane asks of a runtime document, asked before any network
    call. A refusal is the gate `server-lane` carrying the guard and its own sentence."""
    from api.services import runtime_definitions
    try:
        refused = runtime_definitions.server_lane_refusal(row, lane=RUNTIME_LANE)
    except Exception as exc:  # noqa: BLE001 -- an admission that cannot answer admits nothing
        refused = ("runtime:server-unavailable",
                   f"the server-lane admission could not answer ({type(exc).__name__})")
    if refused is None:
        return
    if not (isinstance(refused, tuple) and len(refused) == 2):
        refused = ("runtime:server-unavailable", "the server-lane admission gave no reason")
    guard, sentence = refused
    exc = AdmissionRefused(
        "server-lane",
        f"{row.get('def_id')!r} {REFUSAL_FRAGMENTS['server-lane']} ({guard}: {sentence})")
    exc.runtime_guard = guard                           # type: ignore[attr-defined]
    exc.runtime_sentence = sentence                     # type: ignore[attr-defined]
    raise exc


def _server_run_refusal(def_id: str, plot: str, guard: str, sentence: str) -> AdmissionRefused:
    exc = AdmissionRefused(
        "server-run", f"{def_id}{'.' + plot if plot else ''}: {REFUSAL_FRAGMENTS['server-run']} "
        f"({guard}: {sentence})")
    exc.runtime_guard = guard                           # type: ignore[attr-defined]
    exc.runtime_sentence = sentence                     # type: ignore[attr-defined]
    return exc


def _gate_runtime_service(row: Mapping[str, Any], definition: Mapping[str, Any], def_id: str,
                          bars: list, *, sym: Optional[str], tf: Optional[str],
                          params: Optional[Mapping]) -> dict:
    """⭐ REPLACES `_gate_cross_lane` FOR A RUNTIME DOCUMENT (design 5.1). ONE service run
    on the alert's own bars, symbol, timeframe and inputs must answer ``ok``; its answer
    per plot is returned (``{"plots": {key: None | Refusal}, ...}``). The host parity the
    formula lane proves here at 1e-9 is proved for the runtime by HP-3 at build time, not
    per arm. A run-wide refusal (or a transport failure) RAISES `server-run` with the
    guard's sentence; a per-output refusal withholds that plot only (`admit_user_definition`)."""
    from api.services import pine_runtime_client as prc
    if not bars:
        raise AdmissionRefused("bars", f"{REFUSAL_FRAGMENTS['bars']}: {def_id}")
    if not sym or not tf:
        raise _server_run_refusal(def_id, "", prc.INTEGRITY,
                                  "a script drawn bar by bar is armed on one symbol and timeframe, "
                                  "and this arm named none")
    try:
        wire, k = runtime_wire_bars(bars, tf, time.time())
    except RuntimeBarsRefused as exc:
        raise _server_run_refusal(def_id, "", exc.guard, exc.sentence) from exc
    if k < 0 or not wire:
        raise AdmissionRefused("bars", f"{REFUSAL_FRAGMENTS['bars']}: {def_id} (no bar has closed)")
    keys = runtime_output_keys(definition)
    job = prc.Job(job=f"{sym}|{tf}|arm", ticker=str(sym), tf=str(tf), bars=wire, want=tuple(keys),
                  runtime_inputs=runtime_inputs_for(definition, params))
    [res] = _runtime_client().run(def_id=def_id, version=row.get("version"), doc=definition,
                                  owner_id=row.get("user_id"), profile=RUNTIME_LANE, jobs=[job])
    run = res.run_refusal()
    if run is None and res.status != "ok":
        run = prc.Refusal("*", prc.INTEGRITY, "the job is withheld with no run-wide reason")
    if run is not None:
        raise _server_run_refusal(def_id, "", run.guard, run.sentence)
    return {"plots": {key: res.refusal_for(key) for key in keys}, "compared": len(wire),
            "rel_tol": None, "digest": res.digest}


@contextlib.contextmanager
def runtime_cycle_batch(alerts: Sequence[Mapping[str, Any]], bars: list, sym: str, tf: str):
    """⭐ THE CYCLE'S ONE REQUEST PER (sym, tf) GROUP (design 5.1, `indicator_alert_service`
    row): every ARMED runtime alert of the group on one stored definition version is sent
    in ONE request over the group's own closed bars -- one job per distinct input set,
    wanting every plot those alerts watch -- before any of them is evaluated; each alert's
    value function then reads its answer from the batch (`_BatchedClient`). A request
    carries one definition (design 3.2), so a group with alerts on two definitions costs
    two requests; it never costs one per alert.

    ⛔ THE ADMISSION IS ASKED BEFORE THE REQUEST (5.2 steps 2 and 4, the same two
    authorities `runtime_column_fn` asks per call): a killed, staged-off or engine-refused
    definition is not sent at all, and each of its alerts is then refused by name, with no
    network, when it is evaluated. Only a registered (armed) function is batched; a
    registry miss re-arms on its own path. Nothing here raises into the cycle."""
    batch = RuntimeBatch(str(sym), str(tf), time.time())
    try:
        _prime_runtime_batch(batch, alerts, bars)
    except Exception:  # noqa: BLE001 -- a failed prime costs requests, never a value
        import logging
        logging.getLogger(_logger_name).exception("[alert-user-series] runtime batch prime failed")
    token = _RUNTIME_BATCH.set(batch)
    try:
        yield batch
    finally:
        _RUNTIME_BATCH.reset(token)


def _prime_runtime_batch(batch: RuntimeBatch, alerts: Sequence[Mapping[str, Any]], bars: list) -> None:
    from api.services import indicator_alert_evaluator as ev
    from api.services import pine_runtime_client as prc
    per_def: dict = {}
    for alert in alerts:
        address = str(alert.get("indicator") or "")
        if not is_user_address(address):
            continue
        fn = USER_FUNCS.get(scoped_key(alert.get("user_id"), address))
        row = getattr(fn, "runtime_row", None) if fn is not None else None
        if not row:
            continue
        # a function captured before an edit is not batched: its alert re-arms on the
        # new version (`value_function_for_alert`), and a stale run would be wasted
        if not _runtime_fn_is_current(fn, alert.get("user_id"), str(row.get("def_id"))):
            continue
        per_def.setdefault((str(row.get("user_id")), str(row.get("def_id")), row.get("version")),
                           (row, []))[1].append((alert, fn.runtime_plot))
    if not per_def:
        return
    try:
        wire, k = runtime_wire_bars(bars, batch.tf, batch.now)
    except RuntimeBarsRefused:
        return
    if k < 0 or not wire:
        return
    from api.services import runtime_server_lane as rsl
    for (_owner, def_id, version), (row, members) in per_def.items():
        # ⭐ FIX r1 -- 5.2 steps 2 and 4 through THE one public question
        # (`runtime_server_lane.admission`, the chain `runtime_column_fn` asks per call),
        # per plot; a refused plot is not sent, and an all-refused definition sends nothing.
        members = [(alert, plot) for alert, plot in members
                   if rsl.admission(row, plot, RUNTIME_LANE) is None]
        if not members:
            continue
        definition = row.get("definition") or {}
        jobs: dict = {}
        for alert, plot in members:
            inputs = runtime_inputs_for(definition, ev._parse_params(dict(alert)))
            ikey = json.dumps(inputs, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                              default=str)
            jobs.setdefault(ikey, (inputs, set()))[1].add(plot)
        batch_jobs = [prc.Job(job=f"{batch.sym}|{batch.tf}|{i}", ticker=batch.sym, tf=batch.tf,
                              bars=wire, want=tuple(sorted(plots)), runtime_inputs=inputs)
                      for i, (inputs, plots) in enumerate(jobs.values())]
        batch.requests += 1
        results = _runtime_client().run(def_id=def_id, version=version, doc=definition,
                                        owner_id=row.get("user_id"), profile=RUNTIME_LANE,
                                        jobs=batch_jobs)
        for job, res in zip(batch_jobs, results):
            key = RuntimeBatch.key(def_id, version, job)
            if key is not None:
                batch.results[key] = (set(job.want), res)


def lookback_for_alert(alert: Mapping[str, Any]) -> Optional[int]:
    """A USER alert's declared lookback, or ``None`` for a builtin address.

    ⛔ NO ADMISSION, NO BARS, NO SUBPROCESS. This is asked BEFORE the cycle
    fetches bars, so it must not be able to reach `value_function_for_alert` —
    whose registry-miss branch calls `arm_for_alert`, which fetches bars. A
    reader that could re-enter the fetch it is sizing is a cycle, not a helper.

    Registered instance → the number `_make_value_fn` computed at admission.
    Registry miss (a fresh process, or right after a save) → the STORED
    definition, read plainly with no gate applied, because this answers "how much
    past does the formula name" and not "may this alert run" — those are
    different questions and only the second one is allowed to refuse.

    ``None`` on anything unreadable: the caller falls back to the floor, which is
    strictly more history than this lane used to read, and
    `ast_interpret.unresolved_lookback` still refuses to invent a number if even
    that is short.
    """
    address = str(alert.get("indicator") or "")
    if not is_user_address(address):
        return None
    # ⭐ W5-T13 -- a RUNTIME document has no tree to measure: the profile's window
    # (design 5.1: 5,000 D / 32,768 intraday).
    window = runtime_window_for_alert(alert)
    if window is not None:
        return window
    fn = USER_FUNCS.get(scoped_key(alert.get("user_id"), address))
    known = getattr(fn, "lookback", None)
    if isinstance(known, int) and not isinstance(known, bool):
        return known
    try:
        from api.services import ast_interpret, user_definitions
        def_id, _plot_key = split_user_address(address)
        row = user_definitions.get(alert.get("user_id"), def_id,
                                   alert.get("def_version"))
        if not row:
            return None
        tree = ((row.get("definition") or {}).get("compute") or {}).get("ast")
        if tree is None:
            return None
        return ast_interpret.max_lookback(tree)
    except Exception:                                    # noqa: BLE001
        return None


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


def _gate_engine(row: Mapping[str, Any], def_id: str) -> None:
    """⭐ SAVED-SCRIPT AUTO-UPGRADE — a stored version today's script engine refuses
    (recorded by the member's browser, `user_definitions.record_engine_status`) is
    WITHHELD here by name, so the alert lane never evaluates maths the member's own
    chart has stopped drawing. Gate `withheld`: the alert surfaces through the same
    `refusal_for_alert` → needs-attention path every other withheld value uses.
    ⚠️ fix/prod-ternary-history adds `block_runs_withheld` on the same gate name;
    the two are independent conditions and merge side by side."""
    from api.services import user_definitions
    why = user_definitions.engine_withheld_reason(row)
    if why:
        raise AdmissionRefused(
            "withheld", f"{def_id!r} {REFUSAL_FRAGMENTS['withheld']} ({why})")


def _gate_lane(row: Mapping[str, Any]) -> dict:
    """It is a FORMULA. `compute.kind` is the lane, and only `ast` is one.

    ⭐ W5-T13 -- OR A RUNTIME DOCUMENT THE SERVER LANES RUN. `compute.kind == "runtime"`
    is admitted when `runtime_definitions.server_lane_refusal(row, lane="alert")` is
    None (design 5.1); otherwise it is refused at `server-lane` with the guard's own
    sentence (`_gate_server_lane`). A runtime row stores no requirements (`"[]"`), so
    asking this before `_gate_requirements` cannot change which door a member reads."""
    definition = row.get("definition") or {}
    compute = definition.get("compute") or {}
    if is_runtime_document(definition):
        _gate_server_lane(row)
        return definition
    if compute.get("kind") != "ast":
        raise AdmissionRefused(
            "lane",
            f"{row.get('def_id')!r} declares compute.kind "
            f"{compute.get('kind')!r} — it {REFUSAL_FRAGMENTS['lane']}")
    return definition


def _gate_requirements(row: Mapping[str, Any], def_id: str) -> None:
    """⭐ WHAT THE SCRIPT NEEDS, ASKED OF THE ALERT LANE — the STORED answer.

    Read off the row exactly as `_gate_repaint` reads the stored linter verdict,
    and for the identical reason: the contract a member saved under and the
    contract an alert was armed under must be ONE fact. `consumer_refusal` is the
    single authority all five consumers share, so this door cannot drift from the
    sweep's or the screener's.

    ⛔ IT RUNS BEFORE `_gate_repaint` AND THAT ORDER IS DELIBERATE. Both are
    cheap and deterministic, but a `window_dependent` script is refused for
    EVERY member on EVERY plot, while a repaint refusal is per-plot and can be
    acknowledged away. Asking the unconditional question first means the refusal
    a member reads is the one they can actually act on.
    """
    from api.services import user_definitions                       # noqa: PLC0415
    why = user_definitions.consumer_refusal("alert", row.get("requirements"))
    if why:
        raise AdmissionRefused(
            "requirements", f"{def_id} {REFUSAL_FRAGMENTS['requirements']}: {why}")


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
    # ⭐ W5-T13 -- a runtime document's class is RE-DERIVED from its source by the one
    # reader the store and the client door use (`runtime_definitions.repaint_stamp`,
    # design 5.1), never read off the stored column or the document.
    if is_runtime_document(definition):
        from api.services import runtime_definitions
        verdicts = runtime_definitions.repaint_stamp(definition)
    else:
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
    # ⭐ W5-T13 -- does not apply to a runtime document (design 5.1): its budgets are
    # the runtime's own instruction limits, enforced inside the service run.
    if is_runtime_document(definition):
        return
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


def cross_lane_report(tree: Any, bars: list, inputs: Optional[Mapping] = None,
                      opts: Optional[Mapping] = None) -> dict:
    """Run BOTH lanes over `tree` on `bars`, WITH `inputs`, and return `compare_lanes`' verdict.

    Separated from the gate so a test can read the numbers (`compared`,
    `differences`) rather than only observe a raise — a gate whose measurement
    cannot be printed is a gate nobody can audit.

    ⚰️ THIS TOOK NO `inputs` AND THE HARNESS BEHIND IT HAD NO CONCEPT OF ONE, so
    the 1e-9 equality was established for an EMPTY input map while
    `_make_value_fn` evaluates the same tree with `_inputs_for(definition,
    params)` — the audit's own finding: *"the arm-time 'lanes agree at 1e-9'
    proof runs on an input map neither production lane uses."* And a formula that
    REFERENCED a declared input never got as far as a row: `run_py` raised
    `TableRefusal('resolve:name')`, `_gate_cross_lane` turned it into a
    `cross-lane` refusal, and no member could arm a formula naming their own
    knob. ONE case object carries the map into both lanes (`ast_conformance
    .case_inputs`), so the two can never be handed different ones.
    """
    conf = _conformance()
    # ⭐ P0G -- AND THE DEFINITION'S SEMANTICS, carried in the SAME case object
    # (`ast_conformance.case_opts`), so a document stamped `meta.semantics: 2` is
    # proven equal under the evaluation production runs, never under the legacy one.
    cases = [{"id": ARM_CASE_ID, "ast": tree, "inputs": dict(inputs or {}),
              **({"opts": dict(opts)} if opts else {})}]
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
        # ⭐ THE DEFINITION'S OWN DECLARED DEFAULTS, WHICH IS WHAT PRODUCTION
        # EVALUATES. `_inputs_for` is the ONE reader of `inputs[].key` on this
        # lane and `_make_value_fn` calls it on every evaluation; proving the
        # lanes equal with `{}` would be proving it about a formula nobody runs.
        #
        # ⚠️ DEFAULTS, NOT AN ALERT ROW'S `params_json`, AND THAT IS A STATED
        # BOUND rather than an oversight: admission is per (definition, version)
        # and there is no row yet, so a proof taken on one row's knobs would be
        # cited for every other row's. What the knobs move is the VALUE, not
        # which names resolve — but a lane divergence that only appears at some
        # other knob setting is outside what this measurement covers.
        from api.services import ast_interpret as _lane
        report = cross_lane_report(compute.get("ast"), bars,
                                   _inputs_for(definition, None),
                                   _lane.semantics_opts_for(definition))
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

#: ⭐ P2 OWNER POLICY 7 — the gates that refuse ONE PLOT and leave its siblings
#: admissible. `withheld` since C45; `scalar` since P2 (evaluability is per
#: output: a scalar-reading plot stays refused, a valid SERIES/CONDITION sibling
#: of it is not taken down). Mirrored by `evaluability.js` ALERT_PER_PLOT_GATES.
#: ⭐ UIE P6: `presentation` (an `hlines` guide) too — the guide is refused for itself only.
PER_PLOT_GATES = frozenset({"withheld", "scalar", "presentation"})


def plot_admissions(def_id: str, definition: Mapping[str, Any]) -> tuple:
    """The per-plot half of admission: ``([(address, fn)], {address: refusal})``,
    or RAISE the first non-``withheld`` refusal (which refuses the whole
    definition). It registers nothing (``admit_user_definition`` does).

    ⭐ C45 — ONE WITHHELD PLOT DOES NOT TAKE ITS SIBLINGS DOWN. A Pine indicator
    commonly carries a `plot(bar_index)` debugging row beside the signal a member
    actually alerts on; refusing the whole document for it would end alerts that
    are perfectly answerable. The withheld plot is NOT registered, its refusal is
    kept under its address, and `arm_for_alert` raises it when THAT plot is the
    one being armed. ⭐ P2: a `scalar` refusal is per plot too (`PER_PLOT_GATES`).
    Every other gate still refuses the whole admission.

    ⭐⭐ P1 — THE SERVER HALF OF THE SHARED EVALUABILITY GATE. The browser's
    ``evaluability.js`` (lane ``alert``) is a PREFLIGHT of exactly this, held
    equal to it case by case by ``tests/fixtures/ast/p1_evaluability_alert.json``
    (``tests/test_p1_truth_core.py`` and ``p1.core.truth.test.js``)."""
    plots = definition.get("plots") or []
    keys = [p.get("key") if isinstance(p, dict) else p for p in plots]
    keys = [str(k) for k in keys if k]
    admissible: list = []
    withheld: dict = {}
    for plot_key in keys:
        address = f"{def_id}.{plot_key}"
        try:
            fn = _make_value_fn(def_id, plot_key, definition)
        except AdmissionRefused as exc:
            if exc.gate not in PER_PLOT_GATES:
                raise
            withheld[address] = exc
            continue
        admissible.append((address, fn))
    return admissible, withheld


def admit_user_definition(user_id: Any, def_id: str,
                          version: Optional[int] = None, *,
                          bars: list, sym: Optional[str] = None, tf: Optional[str] = None,
                          params: Optional[Mapping] = None) -> dict:
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
    _gate_engine(row, def_id)
    definition = _gate_lane(row)
    _gate_requirements(row, def_id)
    _gate_repaint(row, definition)
    if is_runtime_document(definition):
        # ⭐ W5-T13 -- `sym`, `tf` and `params` are the alert's own: the arm-time run
        # (`_gate_runtime_service`) is taken on what the alert will evaluate.
        admitted, fns = _admit_runtime_definition(user_id, row, def_id, definition, bars,
                                                  sym=sym, tf=tf, params=params)
        with _REGISTRY_LOCK:
            for address, fn in fns:
                USER_FUNCS[scoped_key(user_id, address)] = fn
        return admitted
    _gate_budget(definition, def_id)
    report = _gate_cross_lane(definition, def_id, bars)

    addresses = []
    with _REGISTRY_LOCK:
        admissible, withheld = plot_admissions(def_id, definition)
        for address, fn in admissible:
            _with_line(fn, user_id, def_id, split_user_address(address)[1], row.get("version"))
            USER_FUNCS[scoped_key(user_id, address)] = fn
            addresses.append(address)
    admitted = {
        "def_id": def_id,
        "version": row.get("version"),
        "rev": row.get("rev"),
        "ast_hash": row.get("ast_hash"),
        "addresses": addresses,
        "compared": report.get("compared"),
        "rel_tol": report.get("rel_tol"),
    }
    if withheld:
        admitted["withheld"] = withheld
    return admitted


def _admit_runtime_definition(user_id: Any, row: Mapping[str, Any], def_id: str,
                              definition: Mapping[str, Any], bars: list, *,
                              sym: Optional[str], tf: Optional[str],
                              params: Optional[Mapping]) -> tuple:
    """`admit_user_definition`'s runtime half: the one arm-time run, then one function per
    plot the run answered, returned as ``(admitted, [(address, fn)])`` for
    `admit_user_definition` -- the ONE writer of `USER_FUNCS` -- to register. A plot the
    run refused (a per-output guard) is kept under its address as a `server-run` refusal
    and not registered, so its siblings still arm -- the C45 rule, by the run's own answer."""
    report = _gate_runtime_service(row, definition, def_id, bars, sym=sym, tf=tf, params=params)
    addresses: list = []
    fns: list = []
    withheld: dict = {}
    for plot_key, refusal in report["plots"].items():
        address = f"{def_id}.{plot_key}"
        if refusal is not None:
            withheld[address] = _server_run_refusal(def_id, plot_key, refusal.guard, refusal.sentence)
            continue
        fn = _make_runtime_value_fn(row, def_id, plot_key, definition)
        _with_line(fn, user_id, def_id, plot_key, row.get("version"))
        fns.append((address, fn))
        addresses.append(address)
    admitted = {"def_id": def_id, "version": row.get("version"), "rev": row.get("rev"),
                "ast_hash": row.get("ast_hash"), "addresses": addresses,
                "compared": report.get("compared"), "rel_tol": None, "digest": report.get("digest")}
    if withheld:
        admitted["withheld"] = withheld
    return admitted, fns


def user_value_function(user_id: Any, address: str
                        ) -> Optional[Callable[[list, dict], Optional[float]]]:
    """The value function for ONE account's address, or `None` if not one.

    ⛔ A USER ID IS REQUIRED AND IT IS NOT DECORATIVE. There is no bare-address
    path into `USER_FUNCS` — the keys are scoped — so an address alone cannot
    reach anybody's column, and account B's id cannot reach account A's.

    ⚠️ A REGISTRY MISS REBUILDS FROM THE STORE THROUGH THE FOUR DETERMINISTIC
    GATES AND **DOES NOT REGISTER WHAT IT BUILDS**. All four are pure functions of
    the stored blob and need no subprocess, so this is the right answer for a
    caller that wants a NUMBER — `GET /api/indicator-alerts/current-value`'s
    prefill is the one in the product. It is the wrong answer for the alert lane,
    which needs the 1e-9 cross-lane equality as well, so the alert lane goes
    through `value_function_for_alert` and that function re-admits.

    ⚰️ THIS USED TO CACHE ITS REBUILD INTO `USER_FUNCS`, AND THE PARAGRAPH THAT
    JUSTIFIED IT WAS FALSIFIED BY THE EDIT PATH. It said: *"the cross-lane proof
    is a property of (tree, bars) established at ARM time … A stored definition
    whose maths CHANGES gets a new `ast_hash`, a `compute.rev` bump and a
    `forget`, so the tree this rebuilds is the tree that was proven."* The first
    two clauses are still true and the CONCLUSION was never true: a `forget`
    drops the entry, and what this rebuilt afterwards was the NEW tree — served
    under a proof taken against the OLD one, and then cached so nothing would
    ever look again. Worse, the prefill route reaches this function, so a
    read-only display could mint that receipt for an alert that had never been
    armed at all. The rebuild is now unregistered and the alert seam re-proves.

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
    _gate_requirements(row, def_id)
    _gate_repaint(row, definition)
    _gate_budget(definition, def_id)
    if is_runtime_document(definition):
        # ⭐ W5-T13 -- the prefill's (and `create`'s line read's) runtime plot. No service
        # call here: the function asks the verdict and the admission on every call.
        keys = set(runtime_output_keys(definition))
        if plot_key not in keys:
            raise AdmissionRefused(
                "definition",
                f"{address!r} {REFUSAL_FRAGMENTS['definition']} — "
                f"{def_id} computes plots {sorted(keys)}")
        return _with_line(_make_runtime_value_fn(row, def_id, plot_key, definition), user_id,
                          def_id, plot_key, row.get("version"))
    keys = {str(p.get("key")) if isinstance(p, dict) else str(p)
            for p in (definition.get("plots") or [])}
    if plot_key not in keys:
        raise AdmissionRefused(
            "definition",
            f"{address!r} {REFUSAL_FRAGMENTS['definition']} — "
            f"{def_id} declares plots {sorted(keys)}")
    return _with_line(_make_value_fn(def_id, plot_key, definition), user_id, def_id,
                      plot_key, row.get("version") if isinstance(row, Mapping) else None)


def value_function_for_alert(alert: Mapping[str, Any], bars: Optional[list] = None
                             ) -> Optional[Callable[[list, dict], Optional[float]]]:
    """The alert row's user value function, or `None` if it names a builtin.

    The evaluator's seam. It reads `user_id` off the ROW, which is the only place
    a background cycle can learn whose formula this is — and, because it holds the
    row, the only place that knows which SYMBOL and TIMEFRAME the formula is about
    to be judged on. That is what makes it the layer that can re-prove.

    🔴 A REGISTRY MISS RE-ENTERS THE ARM PATH. Not a rebuild — `arm_for_alert`,
    the same function `indicator_alert_service.create` calls, which fetches this
    alert's own bars and runs all five gates including the 1e-9 cross-lane
    equality. The audit's finding, in one sentence: *with `forget()` now firing on
    every edit, the rebuilt tree is the NEW tree, admitted on a cross-lane proof
    taken against the OLD one.* An armed alert is now re-proven on the tree it
    will actually evaluate, or it is refused.

    ⛔ REFUSED, NEVER ADMITTED-BY-DEFAULT. `_gate_cross_lane` turns a lane that
    cannot RUN (`LaneUnavailable` — no node, no interpreter) into a `cross-lane`
    refusal rather than a pass, and an empty bar set into a `bars` refusal. A box
    that cannot prove the equality admits nothing; the alternative is a formula
    computing one number on the server and another on the author's chart with
    nothing to say so. `refusal_for_alert` is the read-out either way.

    ⚠️ WHAT IT COSTS, STATED: one node subprocess PER MISS — not per cycle. A
    miss happens exactly twice: after a process restart, and after the author
    saves (`user_definitions.save` forgets on every append). Everything in
    between is a dict lookup, byte-for-byte what it was before.

    ⭐ `bars` IS THE CYCLE'S OWN FETCH, PASSED DOWN — and passing it is not just a
    saved request. `_evaluate_one` is handed a (sym, tf) group's bars so one fetch
    serves every alert on it; re-fetching here would prove the equality on a
    SECOND read of the tape, which is a different series from the one the value is
    then computed on. Same tree AND same bars is what "proven on what it will
    actually evaluate" means. `None` (or an empty list, which is the same
    absence wearing a different type) falls back to the evaluator's own fetcher,
    which is what `arm_for_alert` does at genuine arm time.
    """
    address = str(alert.get("indicator") or "")
    if not is_user_address(address):
        return None
    user_id = alert.get("user_id")
    fn = USER_FUNCS.get(scoped_key(user_id, address))
    if fn is not None and getattr(fn, "runtime_plot", None) is not None \
            and not _runtime_fn_is_current(fn, user_id, split_user_address(address)[0]):
        forget(user_id)                 # ⭐ W5-T13: an edited runtime script re-arms
        fn = None
    if fn is not None:
        return _check_line(alert, address, fn)
    # ⭐ L1 — the re-arm is asked with the row's own params, as the arm was
    from api.services import indicator_alert_evaluator as ev
    arm_for_alert(user_id, address, str(alert.get("sym") or ""),
                  str(alert.get("tf") or ""), bars=bars or None,
                  params=ev._parse_params(dict(alert)))
    # Re-read rather than trusting the admission's own list: a definition that
    # no longer declares THIS plot admits its other plots fine, and the refusal
    # that names the missing plot is `user_value_function`'s to raise.
    return _check_line(alert, address, user_value_function(user_id, address))


#: The `plot_uid` a pre-identity alert row is stamped with when its line was
#: deleted and re-added before the row was ever bound: it equals no identity, so
#: the row stays refused at the `line` gate instead of adopting the new line.
RETIRED_LINE = "retired"


def _check_line(alert: Mapping[str, Any], address: str, fn: Any) -> Any:
    """⭐ 2026-11-02 -- THE ROW IS BOUND TO A LINE, NOT TO A KEY.

    A row carrying `plot_uid` is admitted only while the plot under its key is that
    same line. A row stored before line identity (NULL) is bound on first sight:
    to the current line when the key has existed WITHOUT A BREAK since the row was
    created (`user_definitions.line_continuous_since`), else to `RETIRED_LINE`,
    because a key absent from any version in between was deleted and re-added."""
    current = getattr(fn, "line_id", None)
    if current is None:
        return fn
    bound = alert.get("plot_uid")
    if not bound:
        from api.services import user_definitions as _ud
        def_id, plot_key = split_user_address(address)
        continuous = _ud.line_continuous_since(alert.get("user_id"), def_id, plot_key,
                                               alert.get("created_at"))
        bound = current if continuous == current else RETIRED_LINE
        if alert.get("id") is not None:
            from api.services import indicator_alert_service as _ias
            try:
                if not _ias.bind_plot_uid(int(alert["id"]), bound):
                    # another cycle bound it first: ITS answer is the binding
                    stored = (_ias.get(int(alert["id"])) or {}).get("plot_uid")
                    bound = stored or bound
            except Exception as exc:                     # noqa: BLE001
                # The decision below stands either way; an unrecorded binding is
                # simply decided again from the history on the next cycle.
                import logging
                logging.getLogger(_logger_name).warning(
                    "[alert-user-series] could not record the line of alert %s: %s",
                    alert.get("id"), type(exc).__name__)
    if bound != current:
        raise AdmissionRefused(
            "line",
            f"{address!r} {REFUSAL_FRAGMENTS['line']}")
    return fn


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


# ─── THE PER-USER CATALOG — SCOPED RESOLUTION, NOT A FOURTH GLOBAL ENTRY ─────
#
# ⭐ WHY THIS IS A SECOND FUNCTION AND NOT A FOURTH PARTITION. Everything above
# says it: `ADDRESS_PARTITIONS` is GLOBAL, `build_alert_grid` iterates
# `INDICATOR_FUNCS`, and 685,193 recorded fires plus a 31/31 `--diff` hang off
# those enumerations staying exactly the size they are. So the user namespace is
# reached the only way a per-user namespace CAN be reached — with a user id in
# hand — and the dropdown is assembled from `alert_catalog()` (global, unmoved)
# PLUS this (scoped), at the one layer that holds a signed-in account: the router.
#
# ⛔ AND IT OFFERS ONLY WHAT THE DETERMINISTIC GATES ADMIT. `alert_catalog`'s own
# contract is that the dropdown *"cannot offer an alert that cannot fire"*; a
# definition the repaint or budget gate refuses is exactly such an alert. The
# cross-lane gate is deliberately NOT run here — it spawns a node process per
# definition and this is a dropdown fetch — so this list is a SUPERSET of what
# will arm, and the arm path stays the authority: a POST that gets refused there
# returns the gate's own sentence rather than a silence.


def _definition_label(definition: Mapping[str, Any], def_id: str) -> str:
    """What a user called their formula, or its id when they called it nothing."""
    meta = definition.get("meta") or {}
    for key in ("name", "shortName"):
        value = meta.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return str(def_id)


#: Public name for other modules (Task 10.12: no cross-module private imports), the same object.
definition_label = _definition_label


def _plot_label(definition: Mapping[str, Any], plot: Any, plot_key: str,
                def_id: str) -> str:
    """One plot's label. Qualified by the plot only when there is more than one.

    A single-plot definition is the overwhelming case and "My Average · value"
    reads as a bug next to "RSI"; a two-plot one has to say which line, or the
    dropdown offers the same words twice.
    """
    base = _definition_label(definition, def_id)
    if isinstance(plot, dict):
        for key in ("name", "label", "title"):
            value = plot.get(key)
            if isinstance(value, str) and value.strip():
                return f"{base} · {value.strip()}"
    if len((definition.get("plots") or [])) <= 1:
        return base
    return f"{base} · {plot_key}"


def _instance_label(definition: Mapping[str, Any], def_id: str,
                    params: Optional[Mapping] = None) -> str:
    """`"My Average(20)"` — spec §8's instance naming, for a user formula.

    ⛔ THE KNOBS COME FROM `_inputs_for`, WHICH IS THE FUNCTION THE EVALUATION
    USES. `indicator_alert_evaluator.instance_label` states the same rule for the
    builtins (*"the knobs are DERIVED, never listed"*), and it matters more here:
    a label built from a second reader of `inputs` could name a parameter the
    formula never receives, which is the divergence `_inputs_for`'s own tombstone
    is about.
    """
    base = _definition_label(definition, def_id)
    inputs = _inputs_for(definition, params)
    if not inputs:
        return base
    parts = [str(int(v)) if float(v).is_integer() else str(v)
             for v in inputs.values()]
    return f"{base}({', '.join(parts)})"


def _plots_of(definition: Mapping[str, Any]) -> list[tuple]:
    """`[(plot, key), …]` for every plot that HAS a key.

    ⛔ THE PAIR IS BUILT ONCE, NOT ZIPPED FROM TWO LISTS. A definition carrying a
    keyless plot makes the two lists different lengths, and `zip` would then pair
    every later plot with the PREVIOUS one's key — labelling one line with
    another's name while every address stayed valid, which is a defect nothing
    downstream can detect.
    """
    out = []
    for plot in (definition.get("plots") or []):
        key = plot.get("key") if isinstance(plot, dict) else plot
        if key:
            out.append((plot, str(key)))
    return out


def _plot_keys(definition: Mapping[str, Any]) -> list[str]:
    return [key for _plot, key in _plots_of(definition)]


def instance_label_for(user_id: Any, address: str,
                       params: Optional[Mapping] = None) -> Optional[str]:
    """The INSTANCE label for one account's user address, or `None` if not one.

    The user-lane counterpart of `indicator_alert_evaluator.instance_label`, and
    the reason it takes a user id: a bare address names nobody's formula.
    """
    if not is_user_address(address):
        return None
    from api.services import user_definitions
    def_id, plot_key = split_user_address(address)
    row = user_definitions.get(user_id, def_id, None)
    if row is None:
        return None
    definition = row.get("definition") or {}
    label = _instance_label(definition, def_id, params)
    if len(_plot_keys(definition)) <= 1:
        return label
    return f"{label} · {plot_key}"


def user_catalog(user_id: Any) -> list[dict]:
    """This ACCOUNT's own formulas, in `alert_catalog()`'s entry shape.

    `[]` for an account with none, and `[]` for no account at all — the second is
    what makes `alert_catalog()` with no user id byte-identical to what it always
    returned, and it reaches no store, so the frozen instruments cannot move.

    Every entry carries `source: "user"` so a surface can tell one apart; the
    GLOBAL entries are deliberately left alone rather than gaining a matching
    `"builtin"`, because that would edit the shape 31 addresses and a 685,193-fire
    log are enumerated with, to say something a client can already infer.
    """
    if not user_id:
        return []
    from api.services import alert_trigger_policy as _trigger
    from api.services import indicator_alert_evaluator as ev
    from api.services import user_definitions

    # ⛔ DERIVED FROM THE PRICE ADDRESS'S OWN ROW, NEVER RETYPED. A user formula
    # is a LEVEL — one number per bar, no declared `THRESHOLD_OPERAND` — and
    # `close` is the one address in the table with exactly that shape, so its
    # condition list IS the answer to "what can you ask of a bare level".
    # Retyping the four here is the twin `IndicatorAlertPopover` already had.
    conditions = [dict(c) for c in ev.ALERT_CONDITIONS["close"]]

    entries: list[dict] = []
    for row in user_definitions.list_for_user(user_id):
        def_id = str(row.get("def_id"))
        try:
            definition = _gate_lane(row)
            _gate_repaint(row, definition)
            _gate_budget(definition, def_id)
        except AdmissionRefused:
            continue
        except Exception:  # noqa: BLE001 — a refusal, OR a crash; see below
            # The TABLE refusing a tree is not this function's to relabel (see
            # `_gate_budget`), and a formula the table refuses cannot fire, so it
            # is not offered. It stays visible where a user manages it —
            # `GET /api/user-definitions` — and `refusal_for_alert` is the
            # attribution read-out for anything already armed on it.
            #
            # ⚰️ THIS COMMENT SAID "a TableRefusal out of `check_budget`" AS IF
            # THAT WERE THE ONLY THING IT CATCHES. It is not: `except Exception`
            # also swallows a genuine CRASH, and skipping is then indistinguishable
            # from the table declining. ⭐ Skipping is still right — one broken
            # definition must not empty a member's whole catalog — but the
            # DISTINCTION is kept where it is read: `_refusal_of` attributes with
            # `getattr(exc, "guard", None)`, so a crash names NO door rather than
            # borrowing one. Railed by `tests/test_refusal_not_laundered.py`
            # (RULING K), because an unrailed correct behaviour is one refactor
            # away from being a wrong one.
            continue
        pairs = _plots_of(definition)
        if is_runtime_document(definition):
            # ⭐ W5-T13 -- a runtime document lists the plots its run computes.
            outputs = set(runtime_output_keys(definition))
            pairs = [(p, k) for p, k in pairs if k in outputs]
        if not pairs:
            continue
        plots = [
            {
                "value": f"{def_id}.{plot_key}",
                "label": _plot_label(definition, plot, plot_key, def_id),
                "conditions": [dict(c) for c in conditions],
                # ⛔ NO DEFAULT THRESHOLD, EVER. `_DEFAULT_THRESHOLDS` only ever
                # holds the bounded oscillators; a user formula's scale is
                # unknowable from here and a guessed number in the box is wrong
                # for every formula but the one it was guessed from.
                "default_threshold": None,
                "inputs": _inputs_for(definition, None),
                "instance_label": _instance_label(definition, def_id),
                # ⭐ P1 SIGNAL — WHAT KIND OF OUTPUT THIS PLOT IS, DERIVED HERE
                # from its own tree (`alert_trigger_policy.output_type_of`: the
                # manifest `yields` resolver + the scalar walk), never stored and
                # never read from the client. A `condition` is offered as a
                # trigger policy (is true / becomes true / becomes false) instead
                # of a numeric threshold, which on a 0/1 column could be set to a
                # level that never fires. Additive: the GLOBAL catalog is untouched.
                "output_type": _trigger.output_type_of(definition, plot_key),
            }
            for plot, plot_key in pairs
        ]
        entries.append({
            "indicator": def_id,
            "label": _definition_label(definition, def_id),
            "source": "user",
            "conditions": [dict(c) for c in plots[0]["conditions"]],
            "default_threshold": None,
            "plots": plots,
        })
    return entries


def block_runs_withheld(address: str, sym: str, why: str) -> AdmissionRefused:
    """⭐ C48 / C45 — THE ARM-TIME refusal for a plot the member's chart withholds on
    this symbol's bars (``meta.blockRuns``): the gate's own sentence, wrapped once,
    raised by ``arm_for_alert`` before a row is inserted. The gate's sentence rides on
    the refusal (``block_runs_why``) so a quiet ARMED alert is told in its own words
    (``withheld_alert_detail``), never this arm-time phrasing."""
    from api.services import block_runs as _block_runs
    exc = AdmissionRefused(
        "withheld",
        f"{address} {REFUSAL_FRAGMENTS['withheld']} ({_block_runs.BLOCK_RUNS_GUARD}): {why}. "
        f"An alert on it would fire off the every-bar value on {sym}, which is not the "
        "script's. It still draws on a chart where that code runs on every bar.")
    exc.block_runs_why = why
    return exc


#: ⭐ The most an alert's `state_detail` holds (`indicator_alert_service.mark_needs_attention`
#: caps it at 500); the armed sentence below is built to fit WHOLE under it.
ALERT_DETAIL_MAX = 499
_RESUMES = " This alert resumes when the value is computable."


def withheld_alert_detail(why: str) -> str:
    """⭐⭐ C48 / C45 (review round 2, L1) — what an ARMED alert says while the gates
    withhold its plot: ``Withheld: <the gate> — <where it skipped>. This alert resumes
    when the value is computable.`` — one whole sentence under ``ALERT_DETAIL_MAX``.

    ⚰️ It carried the arm-time refusal (551-583 characters on the parity fixtures), and
    ``mark_needs_attention`` cut it at 500, mid-sentence. The gate's sentence is kept to
    its head (the call, the shape and the line — the clause before its ``: `` explanation)
    and its tail (where on this chart the code skipped, or why that could not be read);
    a tail still too long is shortened at a word, so the sentence always ends whole."""
    head, sep, tail = str(why).partition(" — ")
    gate = head.split(": ", 1)[0]
    body = f"{gate} — {tail}" if sep else gate
    room = ALERT_DETAIL_MAX - len("Withheld: ") - len(".") - len(_RESUMES)
    if len(body) > room:
        cut = body[:room - 1]
        body = (cut.rsplit(" ", 1)[0] if " " in cut else cut).rstrip(" ,;:(") + "…"
    return f"Withheld: {body}{'' if body.endswith('…') else '.'}{_RESUMES}"


def arm_for_alert(user_id: Any, indicator: str, sym: str, tf: str,
                  *, bars: Optional[list] = None,
                  params: Optional[Mapping] = None) -> Optional[dict]:
    """⭐ THE ARM-TIME CALL SITE. Returns `None` for a builtin address.

    ⛔ THIS IS WHY THE EQUALITY IS NOT A FUNCTION NOBODY CALLS. It is invoked from
    `indicator_alert_service.create`, which is the real arm path — and as of this
    commit it is also the path the router posts to.

    ⚰️ THAT SECOND CLAUSE SAID *"the real arm path, the one the router posts to"*
    AND THE SECOND HALF WAS FALSE FOR THE WHOLE OF ITS LIFE. `ias.create` really
    was the invoker; what nothing checked was whether anything could REACH it.
    `api/routers/indicator_alerts.py::create_alert` refused every address that
    `indicator_alert_evaluator.value_function()` misses, two statements before it
    could call `create` — and `value_function` walks the three GLOBAL partitions,
    from which `USER_FUNCS` is deliberately absent. So `POST /api/indicator-alerts
    {"indicator": "u_….value"}` was a 400 *"not an indicator this chart can
    evaluate"*, this entire admission chain sat BELOW that refusal, and both sides
    were individually correct and individually tested: the seam was dead. The
    router now resolves a user address in the account's own scope and lets the
    refusal come from the gate that means it — and the rail on that is a POST
    through the router (`test_alert_user_router.py`), not a call to this function,
    because a call to this function is exactly what stayed green while the door
    was shut.

    Fetches the alert's own bars through the evaluator's own fetcher, so the
    formula is proven equal on the series it will actually be evaluated against
    rather than on a fixture.

    ⭐ AND IT IS NOW ALSO THE RE-ARM PATH. `value_function_for_alert` calls this
    on a registry miss, so "armed once" and "re-proven after an edit" are the
    SAME code — a second re-proof routine would be a second definition of what
    admission means, on the one number this phase's contract rests on.
    """
    if not is_user_address(indicator):
        return None
    def_id, _plot = split_user_address(indicator)
    if bars is None:
        from api.services import indicator_alert_evaluator as ev
        # ⛔ THE ADMISSION MUST SEE THE WINDOW THE EVALUATION WILL SEE. The
        # cross-lane 1e-9 proof is taken on these bars; proving equality over 200
        # while the cycle then computes over 700 proves it for a series the alert
        # never evaluates. The tree's own `max_lookback` sizes both.
        probe = {"indicator": indicator, "user_id": user_id, "tf": tf}
        window = runtime_window_for_alert(probe)
        bars = ev._fetch_bars_for_alert(
            sym, tf, window if window is not None
            else ev.bars_wanted(lookback_for_alert(probe) or 0))
    admitted = admit_user_definition(user_id, def_id, None, bars=bars, sym=sym, tf=tf,
                                     params=params)
    # ⭐ C45 — THE PLOT BEING ARMED IS THE ONE THAT MUST BE ANSWERABLE. The
    # admission registered every plot the lane can answer and kept the refusal of
    # any it cannot; an alert on one of those is refused here, BEFORE the row is
    # inserted (`indicator_alert_service.create`) — there is nothing to go quiet.
    refused = (admitted.get("withheld") or {}).get(f"{def_id}.{_plot}")
    if refused is not None:
        raise refused
    # ⭐⭐ C48 / C45 — AND ONE THE MEMBER'S CHART WITHHOLDS ON THESE BARS. The plot
    # reads a call whose code runs only on some bars (`meta.blockRuns`), and on
    # this symbol's bars that code runs after a bar it skipped: the chart draws
    # nothing for it, so an alert on it would fire off a number that is not
    # TradingView's. Refused here, BEFORE the row is inserted, with the chart's
    # own sentence (`block_runs.block_runs_refusal`). The per-evaluation check in
    # `column` covers bars that arrive later.
    # ⭐ L1 (review round 2) — ASKED AS THE ALERT WILL EVALUATE: its own `params`
    # (the snapshot `params_json` the row stores) and its timeframe, through the one
    # check `column` makes (`withheld`). ⚰️ It asked with `{}` and the lane's bare
    # opts — a guard reading a member's input was proven at the author's default.
    fn = USER_FUNCS.get(scoped_key(user_id, f"{def_id}.{_plot}"))
    check = getattr(fn, "withheld", None) if fn is not None else None
    why = check(bars, params or {}, tf) if check is not None else None
    if why:
        raise block_runs_withheld(f"{def_id}.{_plot}", sym, why)
    return admitted
