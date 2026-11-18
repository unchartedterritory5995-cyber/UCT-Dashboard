"""The Signature indicators AS REGISTRY DEFINITIONS, on ONE generic server lane.

⭐ THE LANE IS THE DELIVERABLE, NOT THREE DEFINITIONS WEARING A NEW COAT.
Spec §10 called the three hardcoded endpoints *"acceptable at launch, genericize
in C"*. Three definitions that each know their own endpoint is not a lane; it is
the same hardcoding with more ceremony. **A lane is generic when a fourth tenant
needs no code in it** — and this file has a fourth (`rsLine`, Task 14's) precisely
so that claim is measured rather than asserted.

Everything the lane needs to serve a definition is a ROW here:

  * `id` — the definition id the chart addresses it by.
  * `compute` — `{"kind": "server", "fn": ..., "rev": ...}`, mirroring the JS
    registry's shape so the two lanes are diffable.
  * `inputs` — the declared, validated input vocabulary (`enum` options and all).
  * `columns` — the per-bar column keys this definition produces. **May be
    empty**: dark-pool levels and GEX walls draw horizontal LEVELS, which v1's
    plot vocabulary cannot express as a column (`hlines` requires a STATIC
    `levels` array and `zones` is schema-RESERVED). An empty list is the honest
    declaration, and `wire_columns` enforces it in both directions.
  * `payload_keys` — the non-column keys the tenant's envelope carries
    (`levels`, `signals`), so the wire shape is declared rather than discovered.
  * `ledger` — see below.

⛔ THE ONE THING THIS FILE MAY NOT DO: RE-KEY THE LEDGER.
`api/services/signature/ledger.py` is INSERT-only — there is no rewrite path — and
it is accruing real history keyed `(indicator='fcb', version='fcb-v2', tf='1D')`.
Renaming the CHART-FACING id to `uct-flow-breakout` must not touch a byte of what
gets WRITTEN. `LEDGER_INDICATOR_FOR` and `LEDGER_TF_FOR` are that translation,
written down as data so the separation is a lookup and not a convention somebody
remembers. A re-key orphans history that cannot be reconstructed.

⚠️ WIRE FORMAT (spec §4): a column is a JSON **array of numbers and `null`**,
`null` ⇄ NaN mapped at the client boundary (`engine/serverCompute.js`). Compute
NEVER emits point objects — `[{"time":…, "value":…}]` is the shape the binder
already converts FROM, and emitting it here would put that conversion in two
places with nothing keeping them equal. `wire_columns` refuses it by name.

⚠️ PREMIUM STAYS GATED BY HANDLER IDENTITY. This module holds no auth. Every
Signature route declares `Depends(require_paid)` INDIVIDUALLY (there is no
router-level dependency, and `test_a_free_user_is_refused_on_every_route` exists
because a gate applied to two of three routes passes any single-route test). A
registry definition must not become a way to reach the data without the handler,
so the lane's provider registry is populated BY the router — the module that owns
the gate — and this file cannot reach a provider that has not been plugged in.
"""
from __future__ import annotations

import functools
import logging
import math
import re
from collections.abc import Sequence
from typing import Any, Callable, Iterable

# ⚠️ TWO SCHEMA-VERSION CONSTANTS EXIST, AND THEY CAN DISAGREE. This one is what
# `/api/signature/definitions` PUBLISHES; `defSchema.SCHEMA_VERSION` in the chart
# engine is what the client VALIDATES against, and `validateDefinition` refuses
# any definition whose `schemaVersion` is not EXACTLY its own ("this client
# cannot safely interpret another schema major"). So a one-sided bump does not
# produce an error — it takes the entire server lane off every chart while the
# server keeps serving and the client keeps starting.
#
# ⛔ THE TWO MOVE TOGETHER, IN ONE COMMIT.
# `tests/test_signature_rules.py::test_the_server_lane_publishes_the_SAME_schema_version_the_client_validates`
# reads the JS constant OUT OF ITS SOURCE (never re-typed — a Python copy would
# be a third authority) and fails if they differ. Added Phase D Task 8.
SCHEMA_VERSION = 1

# ── The ledger vocabulary, frozen ───────────────────────────────────────────
#
# Ten rows of real history are keyed `(indicator='fcb', version='fcb-v2',
# tf='1D', …)`. The definition may be called `uct-flow-breakout` on the chart;
# what it WRITES stays 'fcb'/'1D'.
LEDGER_INDICATOR_FOR: dict[str, str] = {
    "uct-darkpool-levels": "dpl",
    "uct-gex-walls": "gxw",
    "uct-flow-breakout": "fcb",
}

# The product timeframe label → the ledger's `tf`. Identity for "1D" on purpose:
# the ledger stores the PRODUCT label, and the value of writing it down is that
# the identity is a ROW somebody has to change on purpose, not an absence.
# "D" is the BARS-STORE key (`bars_sqlite`) and maps to the same ledger label —
# the two encodings drifting apart silently is this module's whole history.
LEDGER_TF_FOR: dict[str, str] = {"1D": "1D", "D": "1D"}

# Chart timeframe code → the key `bars_sqlite` actually stores rows under.
# `_fetch_bars`'s docstring is the cautionary tale: passing the PRODUCT label
# "1D" matches no rows at all and the indicator ships permanently, silently dead.
STORE_TF_FOR: dict[str, str] = {
    "1": "1", "5": "5", "15": "15", "30": "30", "60": "60",
    "D": "D", "1D": "D", "W": "W", "1W": "W", "M": "M", "1M": "M",
}

# The benchmark vocabulary — ONE list, shared with the JS definition's `enum`
# options (`nativeRegistry.RS_LINE_RAW`). `test_the_rs_line_benchmarks_are_ONE_
# list_across_BOTH_LANES` diffs them, so a benchmark added on one side alone is
# a red test rather than an option that resolves to nothing.
#
# ⭐ DERIVED FROM THE RESOLVER, NEVER RE-TYPED (review finding B10). The names
# are `rs_benchmarks.LITERAL_BENCHMARKS + AUTO_BENCHMARKS` — the only values
# `resolve_benchmark` accepts — arranged in the Simple menu's order below. A
# name typed in the order but absent from the resolver is DROPPED, and a name
# the resolver grew but the order does not mention is APPENDED, so this tuple
# can never offer the chart a benchmark the server would then refuse (or
# silently swap for SPY), and the JS diff above is what flags the menu drift.
from api.services import rs_benchmarks as _rs_benchmarks  # noqa: E402 — imports only logging/typing


def rs_benchmark_menu(order: Sequence[str], vocab: Sequence[str]) -> tuple[str, ...]:
    """`vocab` arranged by `order`: ordered names the vocabulary knows, then the
    vocabulary's remaining names in their own order. Pure, so it is railed."""
    known = tuple(dict.fromkeys(vocab))
    return tuple(b for b in order if b in known) + tuple(b for b in known if b not in order)


_RS_MENU_ORDER: tuple[str, ...] = ("SPY", "RSP", "SECTOR", "QQQ", "IWM", "INDUSTRY")
RS_LINE_BENCHMARKS: tuple[str, ...] = rs_benchmark_menu(
    _RS_MENU_ORDER, _rs_benchmarks.LITERAL_BENCHMARKS + _rs_benchmarks.AUTO_BENCHMARKS)

# ⭐ THE v4 MENU (Phase 3 unit 3-05, decision D4): the v3 menu plus CUSTOM, a
# member's own ticker, NAMED here and nowhere upstream. CUSTOM stays out of
# `rs_benchmarks.LITERAL_BENCHMARKS + AUTO_BENCHMARKS` on purpose, so
# `RS_LINE_BENCHMARKS` above, the alert lane's `alert_rs_series.RS_ALERT_BENCHMARKS`,
# the prewarm set and the screener's ETF set (all derived from those two tuples)
# never grow it. Only the v4 row offers it; the ticker itself is the
# `customBenchmark` string input, validated by `rs_benchmarks.CUSTOM_SYMBOL_RE`.
#
# ⭐ 2026-11-12 (owner: "benchmark to sector, theme etc"): the v4 menu also names
# `rs_benchmarks.CHOICE_BENCHMARKS` (Pick a sector, Theme (auto), Pick a theme,
# with CUSTOM), still OUT of the v3 tuple and every set derived from it, and is
# arranged in its own order (`_RS_MENU_ORDER_V4`): the indexes, then the groups
# from widest to narrowest, then the member's own ticker. The option KEYS are
# unchanged (saved charts and bound alerts carry them); only the order moved.
_RS_MENU_ORDER_V4: tuple[str, ...] = ("SPY", "RSP", "QQQ", "IWM", "SECTOR", "SECTOR_PICK", "INDUSTRY",
                                      "THEME", "THEME_PICK", "CUSTOM")
RS_LINE_BENCHMARKS_V4: tuple[str, ...] = rs_benchmark_menu(
    _RS_MENU_ORDER_V4, _rs_benchmarks.LITERAL_BENCHMARKS + _rs_benchmarks.AUTO_BENCHMARKS
    + _rs_benchmarks.CHOICE_BENCHMARKS)


def rs_benchmark_choice_inputs() -> list[dict]:
    """The second values the v4 benchmark menu's choices read, declared ONCE for
    the rsLine v4 row and the split rows: the member's own ticker (CUSTOM), the
    picked sector ETF (SECTOR_PICK) and the picked theme's ID (THEME_PICK). Each
    pattern / option list is `rs_benchmarks`' own, never re-typed."""
    return [
        {"key": "customBenchmark", "type": "string", "default": "",
         "pattern": _rs_benchmarks.CUSTOM_SYMBOL_RE.pattern, "maxLength": 10, "case": "upper"},
        {"key": "sectorBenchmark", "type": "enum", "default": _rs_benchmarks.DEFAULT_SECTOR_PICK,
         "options": list(_rs_benchmarks.SECTOR_PICKS)},
        {"key": "themeBenchmark", "type": "string", "default": "",
         "pattern": _rs_benchmarks.THEME_ID_RE.pattern, "maxLength": 64},
    ]

# ⭐ UCT RELATIVE STRENGTH v2 (plan docs/superpowers/specs/2026-11-05-uct-relative-
# strength-indicator-design.md §8.1, §13). `wire_columns` requires the provider's
# keys to EQUAL the declared `columns`, so a rollout flag cannot live in the
# provider alone: the ROW declares one shape per flag state, read once at import.
# Flag off ⇒ the v1 row (one column, rev 1); flag on ⇒ the Phase 1 column set,
# rev 2, a `payload` envelope key. Rollback is the flag plus a redeploy.
import os as _os  # noqa: E402 — beside the one constant it serves

RS_V2_ENABLED: bool = _os.environ.get("RS_V2_ENABLED", "0") == "1"

# ⭐ UCT RELATIVE STRENGTH PHASE 3 (engineering map docs/superpowers/plans/
# 2026-11-08-uct-rs-phase3-4-engineering-map.md, unit 3-05; decisions D19, D20).
# ONE flag for the whole Phase 3 contract (the row shape, the columns and the
# `requiresServer` controls the client reads off `/api/signature/definitions`),
# read once at import beside the flag it builds on. It only means something ON
# TOP of `RS_V2_ENABLED`: with V2 off the row is v1, which has no Phase 1
# columns to extend, so V3 alone is IGNORED and logged (`_rs_line_row`), never a
# half shape. Both on => the v4 row (rev 4). Unset => the v3 row, byte for byte
# (`tests/fixtures/rs_line_rows_pre_phase3.json` is the control). Import time,
# so arming and rollback are the variable plus `railway redeploy --service web --yes`.
RS_V3_ENABLED: bool = _os.environ.get("RS_V3_ENABLED", "0") == "1"

# ⭐ THE RS SPLIT (engineering map projects/rs-split-handoff-2026-11-09/
# engineering-map.md, unit U4; flags §(e) step 1). One import-time flag adds
# FOUR server rows and their providers beside `rsLine`: `rsRating`, `rsPhases`,
# `rsVsEma` and (2026-11-12) `rsExit`. It never touches the rsLine row (rev 5 stays
# byte-identical with the flag off AND on; `tests/test_rs_split_rows.py` is the
# control), so arming it only makes `/api/signature/definitions` list eight ids
# where it listed four, and the client's definition-level gate (unit U1,
# `meta.requiresServer`) shows the four new indicators once it does. Import
# time, so arming and rollback are the variable plus
# `railway redeploy --service web --yes`.
RS_SPLIT_ENABLED: bool = _os.environ.get("RS_SPLIT_ENABLED", "0") == "1"

_log = logging.getLogger(__name__)


# ── Refusals. DELIBERATELY DISJOINT PHRASES ─────────────────────────────────
#
# 🔑 Task 9 measured the cost of sharing one: two gates carrying the same words
# made `pytest.raises(match=…)` still match with the safety DELETED, so the test
# passed on a tree with the guard gone. No two messages below share a phrase.

class DefinitionNotOffered(LookupError):
    """No row in this file carries that id."""


class DefinitionHasNoProvider(LookupError):
    """The row exists; nothing is plugged into the lane for it."""


class InputRejected(ValueError):
    """A declared input was given a value its vocabulary does not contain."""


class ColumnContractViolation(ValueError):
    """The tenant returned something that is not a wire column."""


# ── The definitions ─────────────────────────────────────────────────────────

_DPL = {
    "schemaVersion": SCHEMA_VERSION,
    "id": "uct-darkpool-levels",
    "version": 1,
    "compute": {"kind": "server", "fn": "darkPoolLevels", "rev": 1},
    "meta": {
        "name": "Dark Pool Levels", "shortName": "DP", "category": "UCT Signature",
        "description": "Confirmed off-exchange print clusters, as price levels.",
        "tier": "premium", "repaint": "non-repainting",
    },
    "placement": {"target": "price"},
    "inputs": [],
    # No per-bar column: a dark-pool level is a horizontal LINE at a price, and
    # v1's `hlines` style takes a STATIC levels array. Declared empty rather than
    # faked — see the module docstring.
    "columns": [],
    "payload_keys": ["levels"],
    "rules_key": "dpl",
}

_GXW = {
    "schemaVersion": SCHEMA_VERSION,
    "id": "uct-gex-walls",
    "version": 1,
    "compute": {"kind": "server", "fn": "gexWalls", "rev": 1},
    "meta": {
        "name": "GEX Walls", "shortName": "GEX", "category": "UCT Signature",
        "description": "Call wall, put wall and zero-gamma, from the live chain.",
        "tier": "premium", "repaint": "repaints",
    },
    "placement": {"target": "price"},
    "inputs": [],
    "columns": [],
    "payload_keys": ["levels", "spot", "regime"],
    "rules_key": "gxw",
}

_FCB = {
    "schemaVersion": SCHEMA_VERSION,
    "id": "uct-flow-breakout",
    "version": 1,
    "compute": {"kind": "server", "fn": "flowBreakout", "rev": 1},
    "meta": {
        "name": "Flow-Confirmed Breakout", "shortName": "FCB", "category": "UCT Signature",
        "description": "A closed-bar range break with dominant same-side options premium.",
        "tier": "premium", "repaint": "non-repainting",
    },
    "placement": {"target": "price"},
    "inputs": [],
    # ⭐ THE ONE SIGNATURE DEFINITION THAT IS A REAL COLUMN TENANT. A breakout is
    # an EVENT — a {0, 1, NaN} column per direction, index-aligned to bars — which
    # is exactly the shape Phase C's alert grammar addresses (Task 4). The markers
    # the chart draws today are one rendering of it, not the thing itself.
    "columns": ["bull", "bear"],
    "payload_keys": ["signals"],
    "rules_key": "fcb",
}

# ⭐ THE v3 SHAPE BEHIND THE SAME FLAG (Phase 2a, unit 2a-14). `RS_V2_ENABLED`
# still names the rollout; what it turns on is now the v3 row: the Phase 1
# columns PLUS the Mansfield line, its two zero-cross events and the cross dot
# (`RS_PHASE2A_WIRE_COLUMNS`), at `compute.rev` 3. The JS definition carries the
# same `version` / `compute.rev` and `alert_rev_migration.ADDRESS_REVS` the same
# rev; `tests/test_rs_columns_provider.py` and `test_alert_rev_migration.py`
# hold the three equal. `mansfieldState` and `mansfieldCrossBarsAgo` stay off
# the wire: the chart draws neither, the screener reads them from
# `relative_strength` directly.
RS_V3_VERSION = 3
RS_V3_REV = 3
RS_PHASE2A_WIRE_COLUMNS: tuple[str, ...] = (
    "mansfield", "mansfieldCrossUp", "mansfieldCrossDown", "dotMansfieldCross",
)

# ⭐ THE v4 SHAPE BEHIND `RS_V3_ENABLED` (Phase 3 unit 3-05). The v3 row plus
# the wire subset of `relative_strength.PHASE3_COLUMNS` (unit 3-03) and the
# Phase 3 inputs, at version 4 / `compute.rev` 4.
#
# The wire subset is what the chart DRAWS: the two rotation lines, the Clenow
# score and its gap dot, the VARS line and its average. `quadrant`,
# `clenowAnnual`, `clenowR2`, `clenowGap` and `varsState` stay off the wire
# (readout and screener material, read from `relative_strength` directly),
# exactly as `mansfieldState` did in 2a. `dotClenowGap` is NOT a
# `PHASE3_COLUMNS` name: it is a wire-only dot the provider derives from
# `clenowGap` (unit 3-06), the `dotMansfieldCross` precedent.
# `tests/test_registry_string_inputs.py` holds every name here to that rule.
#
# ⭐ REV 5 (Deepvue round 2, 2026-11-08). The same row, one Reading more: the
# `rating` view ("RS Rating", the stock's nightly IBD-style rating over time) and
# its two wire columns (`RS_RATING_WIRE_COLUMNS`). The row's wire columns and its
# `view` enum both change, so version and rev move together, 4 to 5, in all three
# lanes (this row, `nativeRegistry.js`'s `compute.rev`, and
# `alert_rev_migration.ADDRESS_REVS`). The names keep `V4` because they name the
# Phase 3 shape behind `RS_V3_ENABLED`, which this extends; the number is what
# moved. RS alerts are untouched: they compute from `compute_phase1_columns` /
# `compute_mansfield_columns`, which this rev does not change (the no-move rail
# in `tests/test_rs_rating_view.py`).
RS_V4_VERSION = 5
RS_V4_REV = 5
RS_PHASE3_WIRE_COLUMNS: tuple[str, ...] = (
    "rsRatio", "rsMomentum", "clenowScore", "dotClenowGap", "vars", "varsMa",
)
#: The RS Rating reading's wire columns (rev 5): the stored daily IBD-style
#: rating at each bar's session and its 21-session average, null where the
#: history holds no row. Wire-only, like `dotClenowGap`: the provider reads them
#: from `rs_history.rating_series`, never from `relative_strength`.
RS_RATING_WIRE_COLUMNS: tuple[str, ...] = ("ratingLine", "ratingMa")

# The v4 "Reading" enum (decision D2): one choice, one pane. `showMansfield`
# stays declared, which is what keeps saved Trend instances valid, and on the v4
# row it declares `mapsTo` the Mansfield Reading (unit 3-08b): a request that
# sends `showMansfield: true` and NO `view` resolves to `view: "mansfield"`; a
# request that sends a `view` gets that view (`resolve_inputs`).
RS_VIEWS: tuple[str, ...] = ("ratio", "mansfield", "rotation", "quality", "vars", "rating")
RS_DEFAULT_VIEW = "ratio"
#: The legacy switch's successor, the same declaration the JS definition makes
#: on its `showMansfield` input (`nativeRegistry.js`, `legacyInputs.js`).
RS_MANSFIELD_LEGACY_MAP: dict = {"when": True, "key": "view", "value": "mansfield"}

# The anchor date (map section 0 point 4): a `YYYY-MM-DD` string; blank means the
# benchmark's 20-session low. The SHAPE only; the provider parses the date.
RS_ANCHOR_DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"

# The Phase 3 method ranges. `relative_strength` owns the DEFAULTS (it computes
# with them); its Phase 3 functions take any length and answer `None` on a
# degenerate one rather than clamping, so the clamp lives here, once, and the
# JS definition (unit 3-08) declares the same ranges for the dialog's steppers.
_RS_PHASE3_RANGES: dict[str, tuple] = {
    "rrgRatioLength": (3, 60),
    "rrgMomentumLength": (2, 30),
    "clenowWindow": (20, 252),
    "clenowGapPct": (1.0, 50.0),
    "atrLength": (5, 100),
    "varsLookback": (10, 252),
}


def _rs_phase3_inputs() -> list[dict]:
    """The inputs the v4 row adds, after the v3 ones."""
    from api.services import relative_strength as rsm

    def number(key: str, kind: str, default) -> dict:
        lo, hi = _RS_PHASE3_RANGES[key]
        return {"key": key, "type": kind, "default": default, "min": lo, "max": hi}

    return [
        {"key": "view", "type": "enum", "default": RS_DEFAULT_VIEW, "options": list(RS_VIEWS)},
        # ⭐ ONE AUTHORITY FOR WHAT A CUSTOM BENCHMARK MAY BE: the pattern is
        # `rs_benchmarks.CUSTOM_SYMBOL_RE`'s own source, never re-typed, and
        # `maxLength` is the longest ticker it accepts (a rail checks both).
        # 2026-11-12: the picked sector and theme ride beside it.
        *rs_benchmark_choice_inputs(),
        number("rrgRatioLength", "int", rsm.DEFAULT_RRG_RATIO_LEN),
        number("rrgMomentumLength", "int", rsm.DEFAULT_RRG_MOM_LEN),
        number("clenowWindow", "int", rsm.DEFAULT_CLENOW_WINDOW),
        number("clenowGapPct", "float", rsm.DEFAULT_CLENOW_GAP_PCT),
        number("atrLength", "int", rsm.DEFAULT_ATR_LENGTH),
        number("varsLookback", "int", rsm.DEFAULT_VARS_LOOKBACK),
        {"key": "anchorDate", "type": "string", "default": "", "pattern": RS_ANCHOR_DATE_PATTERN},
    ]


def _rs_line_row(v2: bool, v3: bool = False) -> dict:
    """The `rsLine` row, in its v1, v3 or v4 shape.

    * v1: both flags off (master's first shape).
    * v3: `RS_V2_ENABLED` only. Byte-identical to the row served before Phase 3.
    * v4: `RS_V2_ENABLED` and `RS_V3_ENABLED`. `v3` without `v2` is ignored and
      logged: the v1 row has nothing for Phase 3 to extend.

    Only COMPUTE-affecting inputs are declared here: `resolve_inputs` drops any
    key the row does not declare, which is exactly what keeps a member's colour
    pick out of the server's cache key (plan §8.1, §8.3). Numeric inputs carry
    `min`/`max` so the resolver can clamp; the JS definition declares the same
    ranges for the dialog's steppers.
    """
    if v3 and not v2:
        _log.warning("RS_V3_ENABLED is set without RS_V2_ENABLED; ignored, the "
                     "rsLine row stays v1 (Phase 3 extends the v3 row only)")
        v3 = False
    inputs: list[dict] = [
        {"key": "benchmark", "type": "enum", "default": "SPY",
         "options": list(RS_LINE_BENCHMARKS_V4 if v3 else RS_LINE_BENCHMARKS)},
    ]
    if v2:
        # ⭐ ONE SOURCE FOR THE RANGES. `relative_strength` owns the defaults and
        # the clamp ranges (it is the module that computes with them); this row
        # READS them, so the resolver's clamp and the compute's clamp cannot drift
        # (review finding: the two were typed twice).
        from api.services import relative_strength as rsm
        inputs += [
            {"key": "maLength", "type": "int", "default": rsm.DEFAULT_MA_LENGTH,
             "min": rsm.MA_LENGTH_RANGE[0], "max": rsm.MA_LENGTH_RANGE[1]},
            {"key": "maType", "type": "enum", "default": rsm.DEFAULT_MA_TYPE, "options": ["EMA", "SMA"]},
            {"key": "lookback", "type": "int", "default": rsm.DEFAULT_LOOKBACK,
             "min": rsm.LOOKBACK_RANGE[0], "max": rsm.LOOKBACK_RANGE[1]},
            {"key": "priceTolerance", "type": "float", "default": rsm.DEFAULT_PRICE_TOLERANCE_PCT,
             "min": rsm.PRICE_TOLERANCE_RANGE[0], "max": rsm.PRICE_TOLERANCE_RANGE[1]},
            {"key": "redDayThreshold", "type": "float", "default": rsm.DEFAULT_RED_DAY_PCT,
             "min": rsm.RED_DAY_RANGE[0], "max": rsm.RED_DAY_RANGE[1]},
            {"key": "showNewHigh", "type": "bool", "default": True},
            {"key": "showNewHighBeforePrice", "type": "bool", "default": True},
            {"key": "shortHistoryDots", "type": "bool", "default": True},
            # ⭐ PHASE 2a (unit 2a-14, rev 3): the Mansfield line and two more dot
            # toggles. `showMansfield` is a compute input for the same reason the
            # dot toggles are — the engine has no per-plot visibility an input can
            # drive, so OFF blanks the `mansfield` column and its cross dot.
            {"key": "mansfieldLength", "type": "int", "default": rsm.DEFAULT_MANSFIELD_LENGTH,
             "min": rsm.MANSFIELD_LENGTH_RANGE[0], "max": rsm.MANSFIELD_LENGTH_RANGE[1]},
            {"key": "showMansfield", "type": "bool", "default": False,
             # v4 only: the v3 row has no `view`, and stays byte-identical
             **({"mapsTo": dict(RS_MANSFIELD_LEGACY_MAP)} if v3 else {})},
            {"key": "showRedDay", "type": "bool", "default": False},
            {"key": "showNewLow", "type": "bool", "default": False},
        ]
    if v3:
        inputs += _rs_phase3_inputs()
    if v2:
        from api.services.relative_strength import PHASE1_COLUMNS
        columns = list(PHASE1_COLUMNS) + list(RS_PHASE2A_WIRE_COLUMNS)
        if v3:
            columns += list(RS_PHASE3_WIRE_COLUMNS) + list(RS_RATING_WIRE_COLUMNS)
    else:
        columns = ["rsLine"]
    if v3:
        version, rev = RS_V4_VERSION, RS_V4_REV
    elif v2:
        version, rev = RS_V3_VERSION, RS_V3_REV
    else:
        version, rev = 1, 1
    return _checked_legacy_maps({
        "schemaVersion": SCHEMA_VERSION,
        "id": "rsLine",
        "version": version,
        "compute": {"kind": "server", "fn": "rsLine", "rev": rev},
        "meta": {
            "name": "UCT Relative Strength" if v2 else "Relative Strength Line",
            "shortName": "UCT RS" if v2 else "RS", "category": "Momentum",
            "description": ("Is this stock beating the market, or just riding it? The RS line "
                            "against a benchmark, with new-high dots.") if v2
                           else "This symbol's close divided by a benchmark's.",
            "tier": "premium", "repaint": "non-repainting",
        },
        "placement": {"target": "pane"},
        "inputs": inputs,
        "columns": columns,
        "payload_keys": ["payload"] if v2 else [],
        # ⛔ NO LEDGER ROW, ON PURPOSE. `LEDGER_INDICATOR_FOR` has no entry for
        # `rsLine`: it is a chart indicator, not a Signature RULE, and nothing about
        # it is written to the append-only signal ledger. `ledger_indicator()`
        # returning None for it is the assertion that the two are different things.
        "rules_key": None,
    })


# ── A legacy input read as its successor (unit 3-08b) ───────────────────────
#
# ⭐ ONE RULE, the JS lane's (`app/src/components/chart/engine/legacyInputs.js`):
# an input that declares ``mapsTo: {when, key, value}`` maps onto its successor
# ONLY when the successor is genuinely absent from what the caller sent. A
# supplied successor always wins, so a member who picked the RS line by hand on
# a saved Trend instance (``showMansfield: true, view: "ratio"``) gets the RS
# line. ``resolve_inputs`` is where the raw request and the defaults meet, so it
# is the one place on this lane that can tell "sent" from "defaulted"; the
# provider reads the result.
#
# ⛔ Checked when the row is built (fail closed, like the JS `defSchema`): the
# exact three fields; a declared successor other than itself; ``when`` a legal,
# non-default value of the legacy input; ``value`` a legal, non-default value of
# the successor; one mapping per successor.

_LEGACY_MAP_FIELDS = ("when", "key", "value")


def _legal_value(spec: dict, value: Any) -> bool:
    kind = spec.get("type")
    if kind == "bool":
        return isinstance(value, bool)
    if kind == "enum":
        return value in (spec.get("options") or [])
    if kind in ("int", "float"):
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if kind == "string":
        return isinstance(value, str)
    return False


def _checked_legacy_maps(row: dict) -> dict:
    by_key = {s["key"]: s for s in row["inputs"]}
    targets: dict[str, str] = {}
    for spec in row["inputs"]:
        m = spec.get("mapsTo")
        if m is None:
            continue
        where = f"{row['id']}.inputs.{spec['key']}.mapsTo"
        if not isinstance(m, dict) or set(m) != set(_LEGACY_MAP_FIELDS):
            raise ValueError(f"{where}: expected exactly {{when, key, value}}, got {m!r}")
        target = by_key.get(m["key"])
        if target is None or m["key"] == spec["key"]:
            raise ValueError(f"{where}.key: {m['key']!r} is not another declared input")
        if not _legal_value(spec, m["when"]) or m["when"] == spec.get("default"):
            raise ValueError(f"{where}.when: {m['when']!r} is not a legal non-default value of {spec['key']!r}")
        if not _legal_value(target, m["value"]) or m["value"] == target.get("default"):
            raise ValueError(f"{where}.value: {m['value']!r} is not a legal non-default value of {m['key']!r}")
        if m["key"] in targets:
            raise ValueError(f"{where}.key: {m['key']!r} is already the successor of {targets[m['key']]!r}")
        targets[m["key"]] = spec["key"]
    return row


def _as_bool(val: Any) -> bool:
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "on")
    return bool(val)


def apply_legacy_maps(specs: Sequence[dict], supplied: dict | None, values: dict) -> dict:
    """``values`` with each declared ``mapsTo`` applied where the caller
    SUPPLIED the legacy key with the ``when`` value and did not supply the
    successor (absent or ``None``, the resolver's own "not sent"). Returns a new
    dict, and is idempotent: run over its own output it finds the successor
    supplied and changes nothing."""
    src = supplied if isinstance(supplied, dict) else {}
    out = dict(values)
    for spec in specs:
        m = spec.get("mapsTo")
        if not m or spec["key"] not in src or src.get(m["key"]) is not None:
            continue
        got = src[spec["key"]]
        if spec.get("type") == "bool":
            got = _as_bool(got)
        if got == m["when"]:
            out[m["key"]] = m["value"]
    return out


def legacy_mapped(def_id: str, inputs: dict | None) -> dict:
    """``inputs`` read through the installed row's legacy mappings: a no-op on
    ``resolve_inputs`` output (every declared key is present), the mapping
    itself for a caller that hands a provider its raw inputs."""
    src = inputs if isinstance(inputs, dict) else {}
    return apply_legacy_maps(definition(def_id)["inputs"], src, src)


_RS_LINE = _rs_line_row(RS_V2_ENABLED, RS_V3_ENABLED)


# ── The RS split rows (unit U4) ──────────────────────────────────────────────
#
# Three definitions cut out of the rsLine indicator (map §(a) U6 names the JS
# side). Each is `version` 1 / `compute.rev` 1 and declares only the inputs
# that change what the server computes, the rsLine rule: a colour pick never
# reaches a cache key. The provider for each is `rs_provider.rs_*_envelope`,
# plugged in by the router under the same flag.

#: UCT RS Phases' wire columns: the hidden phase column (1 blue / 0 red / null
#: unpainted) that drives the `bgcolor` paint, and the divergence z-score
#: histogram. `rsTrend` / `benchTrend` stay off the wire (readout material).
RS_PHASES_WIRE_COLUMNS: tuple[str, ...] = ("phase", "divergence")
#: UCT RS vs 21 EMA's wire columns: the percent distance histogram and the
#: EMA 3 / EMA 13 lines of it.
RS_VS_EMA_WIRE_COLUMNS: tuple[str, ...] = ("dist", "fast", "slow")
#: UCT RS Exit Warnings' wire columns (2026-11-12): the RS line, the two simple
#: averages of it, and the three dots (the RS value on the bar a warning fired,
#: null elsewhere, so a glyph sits exactly on the line). The three 0/1 event
#: columns stay off the wire: the legend, the alerts and the tests read them from
#: `relative_strength` directly (the `rsPhases` flip precedent).
RS_EXIT_WIRE_COLUMNS: tuple[str, ...] = ("rsLine", "fast", "slow", "dotQuick", "dotQuicksand", "dotDead")


def _rs_split_benchmark_inputs() -> list[dict]:
    """The benchmark pair the two ratio-based rows share: the rsLine v4 menu
    (CUSTOM included) and the member's own ticker, declared exactly as the
    rsLine row declares them so one saved benchmark choice is legal on all
    three ratio indicators."""
    return [
        {"key": "benchmark", "type": "enum", "default": "SPY", "options": list(RS_LINE_BENCHMARKS_V4)},
        *rs_benchmark_choice_inputs(),
    ]


def _rs_split_row(def_id: str, fn: str, name: str, short_name: str, description: str,
                  inputs: list[dict], columns: Sequence[str]) -> dict:
    return _checked_legacy_maps({
        "schemaVersion": SCHEMA_VERSION,
        "id": def_id,
        "version": 1,
        "compute": {"kind": "server", "fn": fn, "rev": 1},
        "meta": {
            "name": name, "shortName": short_name, "category": "Momentum",
            "description": description, "tier": "premium", "repaint": "non-repainting",
        },
        "placement": {"target": "pane"},
        "inputs": inputs,
        "columns": list(columns),
        "payload_keys": ["payload"],
        # Chart indicators, not Signature rules: nothing is written to the
        # signal ledger (the rsLine rule, stated above).
        "rules_key": None,
    })


def _rs_rating_row() -> dict:
    """`rsRating`: the stock's stored nightly rating over time. Daily charts
    only (the rating is stored once a session; the provider says so on any
    other timeframe) and no benchmark: it reads `rs_history`, not a ratio.
    The two columns are the rsLine rev 5 Rating Reading's, so the JS
    definition moves its `ratingLine` / `ratingMa` plots across unchanged."""
    return _rs_split_row(
        "rsRating", "rsRating", "UCT RS Rating", "RS Rating",
        "The stock's RS Rating, 1 to 99, over time, with its 21-session average.",
        [], RS_RATING_WIRE_COLUMNS)


def _rs_phases_row() -> dict:
    from api.services import relative_strength as rsm
    return _rs_split_row(
        "rsPhases", "rsPhases", "UCT RS Phases", "RS Phases",
        "Shades the bars where the RS line and the market pull apart: RS rising while "
        "the market falls, or the reverse.",
        _rs_split_benchmark_inputs() + [
            {"key": "shortEma", "type": "int", "default": rsm.DEFAULT_PHASES_SHORT,
             "min": rsm.PHASES_SHORT_RANGE[0], "max": rsm.PHASES_SHORT_RANGE[1]},
            {"key": "longEma", "type": "int", "default": rsm.DEFAULT_PHASES_LONG,
             "min": rsm.PHASES_LONG_RANGE[0], "max": rsm.PHASES_LONG_RANGE[1]},
        ],
        RS_PHASES_WIRE_COLUMNS)


def _rs_vs_ema_row() -> dict:
    return _rs_split_row(
        "rsVsEma", "rsVsEma", "UCT RS vs 21 EMA", "RS vs 21 EMA",
        "How far the RS line sits above or below its 21 EMA, in percent, with a 3 and "
        "a 13 EMA of that distance.",
        _rs_split_benchmark_inputs(), RS_VS_EMA_WIRE_COLUMNS)


def _rs_exit_row() -> dict:
    """`rsExit` (2026-11-12): Mike Webster's Quick Break / Quicksand / Grateful Dead
    Break on the RS line. Two LENGTH inputs, 0 meaning AUTO (daily 21 / 50, weekly
    8 / 21, `relative_strength.EXIT_AUTO_LENGTHS`): the provider resolves them for
    the timeframe, so the row can only declare 0 .. the range's top. Daily and
    weekly charts; the provider blanks every other timeframe and says so."""
    from api.services import relative_strength as rsm
    return _rs_split_row(
        "rsExit", "rsExit", "UCT RS Exit Warnings", "RS Exit Warnings",
        "Three warnings on the RS line: it drops below its fast average (Quick Break), falls "
        "lower than at that break (Quicksand), or drops below its slow average (Grateful Dead Break).",
        _rs_split_benchmark_inputs() + [
            {"key": "fastLength", "type": "int", "default": 0, "min": 0, "max": rsm.EXIT_LENGTH_RANGE[1]},
            {"key": "slowLength", "type": "int", "default": 0, "min": 0, "max": rsm.EXIT_LENGTH_RANGE[1]},
        ],
        RS_EXIT_WIRE_COLUMNS)


#: The four rows, always built (tests install them by hand), served only
#: when `RS_SPLIT_ENABLED`.
RS_SPLIT_DEFS: tuple[dict, ...] = (_rs_rating_row(), _rs_phases_row(), _rs_vs_ema_row(), _rs_exit_row())
RS_SPLIT_DEF_IDS: tuple[str, ...] = tuple(d["id"] for d in RS_SPLIT_DEFS)

SERVER_DEFS: tuple[dict, ...] = (_DPL, _GXW, _FCB, _RS_LINE) + (RS_SPLIT_DEFS if RS_SPLIT_ENABLED else ())

_BY_ID: dict[str, dict] = {d["id"]: d for d in SERVER_DEFS}

# ⭐ THE PROOF THE LANE IS GENERIC, STATED AS AN INVARIANT RATHER THAN A CLAIM.
# `rsLine` is not a Signature indicator, shares no code with one, has its own
# category and its own input, and needed no branch in `serve()` to be served.
SIGNATURE_DEF_IDS: tuple[str, ...] = tuple(d["id"] for d in (_DPL, _GXW, _FCB))


# ── The provider registry ───────────────────────────────────────────────────
#
# `(sym, tf, inputs) -> dict` where the dict carries a `columns` mapping and
# whatever `payload_keys` the row declares. Populated by the ROUTER, which owns
# the paid gate — see the module docstring.
_PROVIDERS: dict[str, Callable[[str, str, dict], dict]] = {}


def register_provider(def_id: str, fn: Callable[[str, str, dict], dict]) -> None:
    """Plug a tenant into the lane. Idempotent (a module re-import re-registers)."""
    if def_id not in _BY_ID:
        raise DefinitionNotOffered(
            f"cannot plug a provider into the lane for {def_id!r}: "
            f"no row in registry_defs declares it")
    _PROVIDERS[def_id] = fn


def provider_for(def_id: str) -> Callable[[str, str, dict], dict]:
    definition(def_id)                      # raises DefinitionNotOffered first
    fn = _PROVIDERS.get(def_id)
    if fn is None:
        raise DefinitionHasNoProvider(
            f"{def_id!r} is declared but the lane has nothing plugged in for it — "
            "the router registers every tenant at import, so this means the router "
            "was never imported or a row was added without one")
    return fn


def definition(def_id: str) -> dict:
    d = _BY_ID.get(def_id)
    if d is None:
        raise DefinitionNotOffered(
            f"no server-lane definition is registered under {def_id!r}; "
            f"offered: {sorted(_BY_ID)}")
    return d


def list_definitions() -> list[dict]:
    return [dict(d) for d in SERVER_DEFS]


def ledger_indicator(def_id: str) -> str | None:
    """The ledger's `indicator` key for a chart-facing definition id, or None.

    None means "this definition writes nothing to the signal ledger", which is
    the correct answer for `rsLine` and is NOT the same as "unknown id" — that
    raises.
    """
    definition(def_id)
    return LEDGER_INDICATOR_FOR.get(def_id)


def ledger_tf(tf: str) -> str:
    """The ledger's `tf` for a chart/store timeframe. Unknown ⇒ the input, verbatim.

    Deliberately NOT a raise: the ledger's uniqueness key includes `tf`, and
    `record_signal` already refuses a tf it cannot key. Guessing here would put
    a second, weaker opinion in front of the one that actually protects history.
    """
    return LEDGER_TF_FOR.get(tf, tf)


def store_tf(tf: str) -> str:
    """The bars-store key for a chart timeframe. Unknown ⇒ 'D'."""
    return STORE_TF_FOR.get(str(tf or "D"), "D")


# ── Inputs ──────────────────────────────────────────────────────────────────

def resolve_inputs(def_id: str, raw: dict | None) -> dict:
    """Declared inputs only, defaults filled, vocabulary enforced.

    An undeclared key is DROPPED rather than refused: the client sends the whole
    instance's input map (colour, line width) and only some of it is the server's
    business. A DECLARED key with an out-of-vocabulary value is refused — that is
    a request for data this definition cannot produce, and answering it with the
    default would draw a benchmark the user did not ask for.
    """
    d = definition(def_id)
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    for spec in d["inputs"]:
        key = spec["key"]
        val = src.get(key, spec.get("default"))
        if val is None:
            val = spec.get("default")
        kind = spec["type"]
        if kind == "enum":
            options = spec.get("options") or []
            if val not in options:
                raise InputRejected(
                    f"input {key!r} was given {val!r}, which is outside the enum "
                    f"vocabulary {options} declared by {def_id!r}")
        elif kind in ("int", "float"):
            # ⭐ CLAMPED, NOT REFUSED (plan §8.1). A number outside the declared
            # range is a stepper that ran past its stop, not a request for data the
            # definition cannot produce; the dialog clamps visibly on its side and
            # the server clamps identically here, so the two never disagree.
            val = _clamp_number(val, spec, kind)
        elif kind == "bool":
            if isinstance(val, str):
                val = val.strip().lower() in ("1", "true", "yes", "on")
            else:
                val = bool(val)
        elif kind == "string":
            val = _resolve_string(def_id, key, val, spec)
        else:
            # ⛔ NEVER STORED RAW (engineering map F4): before Phase 3 an unknown
            # kind passed through unchanged, so a row that declared one would
            # have forwarded whatever the client sent straight into a provider
            # and its cache key. No current row reaches this branch.
            raise InputRejected(
                f"input {key!r} of {def_id!r} declares the input kind {kind!r}, "
                "which the resolver has no branch for")
        out[key] = val
    # ⭐ unit 3-08b: a supplied legacy input maps onto a successor the caller did
    # NOT send (`apply_legacy_maps`); a sent successor always wins.
    return apply_legacy_maps(d["inputs"], src, out)


@functools.lru_cache(maxsize=32)
def _declared_pattern(pattern: str) -> re.Pattern:
    """A row's `pattern`, compiled ASCII-only: Python's `\\d` would otherwise
    accept other scripts' digits that the browser's `RegExp` refuses."""
    return re.compile(pattern, re.ASCII)


def _resolve_string(def_id: str, key: str, val: Any, spec: dict) -> str:
    """The `string` branch (Phase 3 unit 3-05): strip, apply the declared `case`,
    then refuse a NON-EMPTY value that exceeds `maxLength` or misses `pattern`
    (matched whole). Empty is always allowed: it means "not set" (a blank custom
    benchmark, the default anchor), and the provider owns that meaning.

    A declared `case` also refuses non-ASCII text: `"ı".upper()` is `"I"`, so
    folding first would accept a ticker the router's ASCII `_SYM_RE` never
    would (`rs_benchmarks.normalize_custom_symbol` refuses it the same way).
    """
    if not isinstance(val, str):
        raise InputRejected(
            f"input {key!r} of {def_id!r} expects text but was given {type(val).__name__}")
    s = val.strip()
    case = spec.get("case")
    if case is not None:
        if not s.isascii():
            raise InputRejected(
                f"input {key!r} of {def_id!r} holds characters outside ASCII; a "
                "case-folded input accepts ASCII only")
        if case == "upper":
            s = s.upper()
        elif case == "lower":
            s = s.lower()
        else:
            raise InputRejected(
                f"input {key!r} of {def_id!r} declares the case rule {case!r}; "
                "only 'upper' and 'lower' exist")
    if not s:
        return s
    max_len = spec.get("maxLength")
    if max_len is not None and len(s) > int(max_len):
        raise InputRejected(
            f"input {key!r} of {def_id!r} is {len(s)} characters long, past its "
            f"declared maxLength of {int(max_len)}")
    pattern = spec.get("pattern")
    if pattern is not None and _declared_pattern(pattern).fullmatch(s) is None:
        raise InputRejected(
            f"input {key!r} of {def_id!r} was given {s!r}, which does not match "
            f"the declared pattern {pattern}")
    return s


def _clamp_number(val: Any, spec: dict, kind: str) -> float | int:
    default = spec.get("default")
    try:
        f = float(val)
    except (TypeError, ValueError):
        f = float(default) if default is not None else 0.0
    if not math.isfinite(f):
        f = float(default) if default is not None else 0.0
    lo, hi = spec.get("min"), spec.get("max")
    if lo is not None:
        f = max(float(lo), f)
    if hi is not None:
        f = min(float(hi), f)
    return int(round(f)) if kind == "int" else float(f)


# ── The wire contract ───────────────────────────────────────────────────────

def _wire_number(v) -> float | None:
    """One cell. NaN/inf ⇒ `null` — FastAPI serializes with `allow_nan=False`
    and a browser's `r.json()` throws on a bare NaN, which would take the WHOLE
    overlay down rather than one bar."""
    if v is None:
        return None
    if isinstance(v, bool):
        raise ColumnContractViolation(
            "a wire column cell was a bool; columns carry numbers and nulls only")
    if not isinstance(v, (int, float)):
        raise ColumnContractViolation(
            f"a wire column cell was {type(v).__name__}; columns carry numbers and nulls only")
    f = float(v)
    return f if math.isfinite(f) else None


def wire_columns(def_id: str, columns: Any) -> dict[str, list]:
    """Validate + serialize a tenant's columns into the wire shape.

    ⛔ THE REFUSAL THAT MATTERS: a column is an ARRAY OF NUMBERS, never a list of
    `{time, value}` points. The binder already converts a NaN-padded column into
    LWC whitespace items at ITS boundary; a tenant emitting points would put that
    conversion in a second place with nothing keeping the two equal, and the
    first divergence would be a line that draws on the wrong bars.
    """
    d = definition(def_id)
    declared = list(d["columns"])
    if not isinstance(columns, dict):
        raise ColumnContractViolation(
            f"{def_id!r} returned {type(columns).__name__} where the lane expects a "
            "mapping of column key to array")
    got = sorted(columns)
    if got != sorted(declared):
        raise ColumnContractViolation(
            f"{def_id!r} returned column keys {got} but declares {sorted(declared)} — "
            "a definition and its provider drifting apart is a failure here, not a "
            "silently empty overlay")
    out: dict[str, list] = {}
    length = None
    for key in declared:
        col = columns[key]
        if isinstance(col, (str, bytes)) or not isinstance(col, Sequence):
            raise ColumnContractViolation(
                f"column {key!r} of {def_id!r} is {type(col).__name__}; the lane carries arrays")
        cells = list(col)
        if cells and isinstance(cells[0], dict):
            raise ColumnContractViolation(
                f"column {key!r} of {def_id!r} was emitted as point objects "
                "({time, value}); compute never emits points — the wire carries a "
                "bare array positionally aligned to `times`, and the binder is the "
                "ONE place a column becomes chart points")
        if length is None:
            length = len(cells)
        elif len(cells) != length:
            raise ColumnContractViolation(
                f"{def_id!r} returned ragged columns: {key!r} has {len(cells)} cells "
                f"where an earlier column has {length}; every column is index-aligned "
                "to the same `times`")
        out[key] = [_wire_number(v) for v in cells]
    return out


def event_columns(bar_keys: Iterable, hits: Iterable[tuple], keys: Sequence[str]) -> dict[str, list]:
    """`{0, 1, None}` columns from (bar_key, column_key) hits — the event shape, generically.

    `bar_keys` supplies the index order ALREADY NORMALIZED to whatever key the
    caller joins on (an ISO date, a unix second — this function does not care and
    deliberately does not decode). `hits` is `(bar_key, column_key)` pairs.
    Nothing here knows what a breakout is: a second event-bearing tenant reuses
    it unchanged.

    ⚠️ JOINED BY KEY, NEVER BY INDEX — the same rule `compute_rs_line_raw` states
    for its benchmark. One missing bar under an index join shifts every
    subsequent signal, and the result is plausible and wrong for the whole
    history rather than absent for one bar.

    0 is "computed, did not happen" and is the whole point — an all-`None` column
    and a quiet tape look identical, and only one of them is an answer.
    """
    index: dict[Any, int] = {}
    n = 0
    for i, k in enumerate(bar_keys):
        index.setdefault(k, i)
        n = i + 1
    cols = {k: [0.0] * n for k in keys}
    for bar_key, col_key in hits:
        i = index.get(bar_key)
        if i is None or col_key not in cols:
            continue
        cols[col_key][i] = 1.0
    return cols


# ── The lane ────────────────────────────────────────────────────────────────

def serve(def_id: str, sym: str, tf: str, inputs: dict | None) -> dict:
    """THE GENERIC DISPATCH. Nothing below this line knows a tenant's name.

    A fourth tenant is a row in `SERVER_DEFS` plus a `register_provider` call.
    There is no `if def_id ==` anywhere in this function, and
    `test_the_lane_names_no_tenant` reads this module's own AST to keep it that
    way — a branch here would be the hardcoding spec §10 said to retire.
    """
    d = definition(def_id)
    fn = provider_for(def_id)
    resolved = resolve_inputs(def_id, inputs)
    raw = fn(sym, tf, resolved) or {}
    columns = wire_columns(def_id, raw.get("columns") or {})
    times = [int(t) for t in (raw.get("times") or [])]
    for key, col in columns.items():
        if times and len(col) != len(times):
            raise ColumnContractViolation(
                f"column {key!r} of {def_id!r} has {len(col)} cells against {len(times)} "
                "times; the wire is positional and a length mismatch would draw the "
                "whole series shifted rather than absent")
    envelope: dict[str, Any] = {
        "defId": def_id,
        "sym": sym,
        "tf": tf,
        "rev": d["compute"]["rev"],
        "inputs": resolved,
        "columns": columns,
        "times": times,
    }
    for key in d["payload_keys"]:
        if key in raw:
            envelope[key] = raw[key]
    for key in ("version", "asOf", "error", "source"):
        if key in raw:
            envelope[key] = raw[key]
    return envelope
