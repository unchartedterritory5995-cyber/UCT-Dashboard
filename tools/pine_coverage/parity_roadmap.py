# -*- coding: utf-8 -*-
"""parity_roadmap.py - THE MEASURED ROADMAP TO PINE PARITY: which walls stop which members' scripts.

    # 1. LOCAL (the census caches and the licence-held sources stay on this PC; writes identifiers only)
    python tools/pine_coverage/parity_roadmap.py facts --map docs/pine/coverage-map.json \\
        --cache <production census dir> --runtime-cache <runtime-on census dir> \\
        --verdicts <production verdicts.json> --runtime-verdicts <runtime-on verdicts.json> \\
        [--local-runs <uct-vendor-batch/runs>] --out <facts.json>
    # 2. the roadmap (committed inputs only)
    python tools/pine_coverage/parity_roadmap.py build --map docs/pine/coverage-map.json \\
        --facts <facts.json | docs/pine/parity-roadmap.json> --out docs/pine/parity-roadmap.json
    # 3. the rail (CI): every count in the roadmap equals what `build` derives from the committed map
    python tools/pine_coverage/parity_roadmap.py check

WHAT A MEMBER IS SERVED (the 11-17 map's member-facing rule, applied whole): a sample script is SERVED when
  * it transfers fully on the host lane (`scripts[].clean`, the census's `isClean` with the host
    known-divergence list applied), or
  * the runtime-on lane draws it (`runtimeOn.added`: `runtime_on_transfers`, the runtime kill list applied)
    AND the server ADMITS it (`runtime_definitions.graded_allow_list`, else every capability
    `pine_capabilities.capabilities_of` names is admitted by the committed registry,
    `admitted_capabilities()`); the census grants every script, so this is the static admission check.
An order-placing strategy is never served (no lane simulates its broker for members).

THE WALLS OF A SCRIPT THAT IS NOT SERVED (`member_walls`), each a label the census already prints:
  * the runtime lane's own walls over every peel step (`runtimeOn.walls.byScript`), when it has any;
  * else the HOST object program's walls (`runtimeOn.walls.attachedDirtyWalls`: attached on the host lane,
    dirty, so the runtime lane was never offered it);
  * `[strategy]` for an order-placing strategy; `runtime:kill-list` for a script the kill list takes off the
    runtime lane; `[known-divergence]` for one the host list refuses;
  * `admission:<capability>` for each capability the server does not admit, on every script whose route is the
    runtime lane (a script with runtime walls, or one the runtime lane draws). Admission is evidence work, not
    engine work, and it is still a wall: a script freed of its last runtime wall is not served until then.
SOLE = the only wall; ANY = one of its walls; PAIR = exactly two walls. A script whose peel did not reach a build
(`reachedAfterPeel` false and not attached) may hide further walls: `fullyEnumerated` counts the firm part.

⛔ Nothing here is a second authority: the predicates are `coverage_map.py`'s, the admission is the server's own
registry read through `capability_admission.admission_row`, the kill list is `runtime_definitions`'. `check`
re-derives every number from `docs/pine/coverage-map.json` plus the `facts` block the roadmap carries (identifiers
only: capability ids, guard names, tokens read as identifiers, capture ids, counts; no source, no message text).
"""
import argparse
import collections
import hashlib
import itertools
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

SCHEMA = "uct.pine-parity-roadmap/v1"
FACTS_SCHEMA = "uct.pine-parity-facts/v1"
MAP = os.path.join(ROOT, "docs", "pine", "coverage-map.json")
ROADMAP = os.path.join(ROOT, "docs", "pine", "parity-roadmap.json")

WALL_STRATEGY = "[strategy]"
WALL_KILLED = "runtime:kill-list"
WALL_HOST_LISTED = "[known-divergence]"
ADMISSION = "admission:"

# a token is kept only when it reads as an identifier / dotted name (wall_detail.py's rule)
_IDENT = re.compile(r"^[A-Za-z_][\w.]*$")
_OTHER_SYMBOL = re.compile(r"other-symbol:[a-z-]+")
USER_TOKEN = "(a script's own identifier)"
_KEYWORDS = frozenset({"if", "for", "while", "switch", "var", "varip", "import", "method", "type", "enum", "and",
                       "or", "not", "security", "study", "tostring", "color", "string", "int", "float", "bool"})
_VENUE = re.compile(r"^([A-Z][A-Z0-9_]{0,15}):")


def _tok(t):
    return t if isinstance(t, str) and _IDENT.match(t) else None


# ── THE ENGINEERING UNITS. A unit is the work that removes a set of walls; every wall the census can print maps
# to exactly one unit (a wall no rule names is filed under `unmapped`, and `build` reports it). The `kind` says
# whose work it is: `engine` (an engine change and its captures), `evidence` (captures only: capability
# admission), `data` (a data source we do not hold), `owner` (an owner decision first).
UNITS = [
    # (id, title, kind, rule) - rule: a wall label -> bool. First match wins, so order matters.
    ("libraries", "Pine library imports (link a published library version)", "engine",
     lambda w: w in ("runtime:library", "[imports-libraries]", "admission:import", "admission:library-decl")
     or w.startswith("pine:library") or w.startswith("admission:library:")),
    ("strategy", "strategy() order simulation served to members", "owner",
     lambda w: w in (WALL_STRATEGY, "pine:strategy-call", "admission:strategy-decl", "pine:declaration-strategy",
                     "runtime:declaration")
     or w.startswith("runtime:strategy")),
    ("detector", "the capability detector cannot read the source (admission: unreadable)", "engine",
     lambda w: w == "admission:unreadable"),
    ("request-with-state", "request.security whose argument is a mutable value", "engine",
     lambda w: w == "runtime:request-with-state"),
    ("request", "request.* for another symbol or timeframe", "engine",
     lambda w: w in ("pine:request", "runtime:request", "[request-security]")),
    ("lower-tf", "lower-timeframe requests (request.security_lower_tf, a lower `timeframe`)", "engine",
     lambda w: w.startswith("lower-tf:")),
    ("builtins", "built-in names the closed table does not declare", "engine",
     lambda w: w in ("pine:builtin", "pine:function", "runtime:call-undeclared-builtin-state",
                     "[builtin-missing]", "[user-functions]", "runtime:clock-zone", "runtime:chart-clock")),
    ("conditional-history", "history of a value computed only on some bars (per-call-site history)", "engine",
     lambda w: w == "runtime:conditional-history"),
    ("dynamic-history", "history offsets and windows known only while the bar runs", "engine",
     lambda w: w in ("runtime:history-dynamic-offset", "runtime:history-expression", "[history-offsets]")
     or w in ("pine:history-ref", "pine:offset-literal", "pine:offset-negative", "pine:window",
              "pine:window-dependent", "pine:plot-offset")),
    ("statements", "statement shapes the runtime front end does not read", "engine",
     lambda w: w in ("runtime:statement", "runtime:expression-statement", "runtime:directive", "runtime:unbound",
                     "runtime:declaration", "pine:statement", "runtime:switch", "runtime:operator")),
    ("function-global-state", "a function body reading a mutable global", "engine",
     lambda w: w == "runtime:function-global-state"),
    ("functions", "user-defined function shapes and methods", "engine",
     lambda w: w in ("runtime:function", "runtime:udt-method", "runtime:recursion", "pine:function-def")),
    ("block-value", "if / switch blocks used as values", "engine",
     lambda w: w in ("runtime:block-value", "runtime:tuple", "pine:tuple", "[tuples]")),
    ("loops", "loop forms the runtime lane does not iterate", "engine",
     lambda w: w == "runtime:loop"),
    ("state-calls", "built-ins fed by a mutable value (windowed, text, conversion, inputs)", "engine",
     lambda w: w in ("runtime:call-windowed-state", "runtime:call-text-state", "runtime:call-conversion-state",
                     "runtime:call-pointwise-state", "runtime:input-state", "runtime:builtin-args")),
    ("colour", "colour and text as computed values", "engine",
     lambda w: w in ("runtime:colour", "pine:colour-value", "pine:text-value", "runtime:fill-target",
                     "runtime:fill-gradient", "runtime:plot-id", "[text-colour-values]")),
    ("collections", "matrix / map / array operations", "engine",
     lambda w: w in ("runtime:array", "pine:collection", "[collections]") or w.startswith(("array.", "matrix.", "map."))),
    ("types", "user-defined types and enums", "engine",
     lambda w: w in ("runtime:enum", "runtime:udt", "runtime:udt-field", "pine:type", "pine:member",
                     "[udt-methods]")),
    ("objects", "drawing objects the object program cannot carry", "engine",
     lambda w: w.startswith("object op dropped:") or w in (
         "runtime:object-op", "runtime:object-position", "runtime:object-door", "runtime:nothing-drawn",
         "pine:drawing", "pine:object-condition", "[drawing-objects]", "[drawing-never-attempted]",
         "[drawing-no-output-other]", "[paint-withheld]",
         "host:pine:object-removal-lost", "host:pine:objects-only")
     or w.startswith(("line.", "label.", "box.", "table.", "polyline.", "linefill.", "chart."))),
    ("output-contract", "scripts whose output the pane does not carry", "engine",
     lambda w: w in ("runtime:no-output", "runtime:withheld-all", "runtime:output-map", "runtime:presentation",
                     "[output-contract]") or w.startswith("host:pine:constant-only")
     or w.startswith("host:pine:presentation-only") or w.startswith("host:pine:hidden-only")
     or w.startswith("host:pine:no-output")),
    ("realtime", "tick-to-tick state (varip, realtime barstate)", "engine",
     lambda w: w in ("runtime:varip", "runtime:realtime-untold", "pine:live-bar-state", "[realtime-bar-state]")),
    ("compute-budget", "host-lane compute caps (look-back, series, nodes)", "engine",
     lambda w: w.startswith("budget:") or w == "[compute-budget]"),
    ("call-mapping", "a known name whose call shape is not mapped", "engine",
     lambda w: w in ("pine:arity", "pine:named-argument", "pine:role-order", "pine:input-kind", "pine:operator",
                     "[call-mapping]")),
    ("imperative-host", "host-lane imperative refusals the runtime lane names nothing for", "engine",
     lambda w: w in ("pine:state", "pine:reassign", "pine:block", "pine:cycle", "pine:undefined", "[imperative]",
                     "pine:na", "[na-semantics]")),
    ("robustness", "translator / lowering failures", "engine",
     lambda w: w in ("runtime:lower", "threw", "[translator-robustness]", "host:unnamed", "unnamed", "facts:missing",
                     "runtime:lost-on-runtime-on") or w.startswith("host:")),
    ("known-lists", "scripts refused by name on a known-divergence or kill list", "engine",
     lambda w: w in (WALL_KILLED, WALL_HOST_LISTED)),
]
UNIT_OF = {u[0]: u for u in UNITS}

# ⚠️ AN ESTIMATE, STATED AS ONE: the work a unit costs, S=1 / M=2 / L=4 (engine change, rails and the captures that
# admit it). The COUNTS are measured; this weight only orders units of equal reach. Evidence units (`admit:*`,
# captures only) are S. The roadmap doc gives each unit's reasoning.
UNIT_SIZE = {
    "libraries": 4, "strategy": 4, "objects": 4, "builtins": 4, "statements": 2, "request": 2,
    "request-with-state": 2, "lower-tf": 2, "conditional-history": 2, "dynamic-history": 2,
    "function-global-state": 2, "functions": 2, "block-value": 2, "state-calls": 2, "collections": 2, "types": 2,
    "output-contract": 2, "realtime": 2, "compute-budget": 2, "known-lists": 2,
    "loops": 1, "colour": 1, "call-mapping": 1, "imperative-host": 1, "robustness": 1, "detector": 1,
}
# A unit is built only after the units it stands on (a library is user functions and types, exported).
DEPENDS = {"libraries": ("functions", "function-global-state", "types")}


def unit_size(uid):
    return UNIT_SIZE.get(uid, 1 if uid.startswith("admit:") else 2)


def unit_of(wall):
    """The unit that removes a wall. A capability the server does not admit (`admission:<cap>`) that no engine
    unit claims is its own EVIDENCE unit, `admit:<cap>`: captures grading MATCH, no engine change."""
    for uid, _title, _kind, rule in UNITS:
        if rule(wall):
            return uid
    if wall.startswith(ADMISSION):
        return "admit:" + wall[len(ADMISSION):]
    return "unmapped"


def unit_meta(uid):
    if uid in UNIT_OF:
        return UNIT_OF[uid][1], UNIT_OF[uid][2]
    if uid.startswith("admit:"):
        return ("capability admission of `%s` (registry evidence: runtime-on MATCH captures)" % uid[6:], "evidence")
    return ("walls no unit rule names", "engine")


# ── NEVER SERVE: what no engine work can serve, because the data is not ours to hold. Each class names the
# refusal the engine gives today (host / runtime) so "everything" is measured against what is possible.
# `match` reads a script's facts: the reference items it uses that `coverage_map.DATA_LIMITED` names, the
# other-symbol codes its census rows carry, and the exchanges its request literals name.
def _us_equity_venues():
    """`otherSymbols.js::US_EQUITY_VENUES`, read from the engine (one list: the host and the runtime lane read it)."""
    js = open(os.path.join(ROOT, "app", "src", "components", "chart", "engine", "otherSymbols.js"),
              encoding="utf-8").read()
    m = re.search(r"US_EQUITY_VENUES\s*=\s*Object\.freeze\(new Set\(\[([^\]]*)\]", js)
    if not m:
        raise SystemExit("otherSymbols.js no longer declares US_EQUITY_VENUES where this reads it")
    return frozenset(re.findall(r"'([A-Z0-9_]+)'", m.group(1)))


US_VENUES = _us_equity_venues()
FUNDAMENTAL_VENUES = frozenset({"ECONOMICS", "QUANDL", "FRED", "ESD", "FINANCIAL", "FUNDAMENTAL"})
INDEX_VENUES = frozenset({"SP", "TVC", "INDEX", "DJ", "CBOE_INDEX", "NASDAQ_INDEX", "CBOT_MINI"})
BREADTH_VENUES = frozenset({"USI"})


def _names(f):
    """Every name a script's facts carry: the reference items it uses that are data-limited, and the tokens the
    runtime lane's walls name."""
    return set(f.get("dataLimited", ())) | {t for ts in (f.get("tokens") or {}).values() for t in ts}


def _starts(names, prefixes):
    return any(n.startswith(prefixes) for n in names)


NEVER_SERVE = [
    ("fundamentals", "Company fundamentals and economic series: request.financial, request.economic, "
     "request.quandl, an unregistered request.seed, and syminfo fundamentals (employees, shareholders, "
     "analyst recommendations and price targets); an ECONOMICS: / QUANDL: / ESD: spelling",
     "host `pine:request` (`request` namespace guard) or `pine:builtin` (syminfo.*); runtime "
     "`runtime:request-with-state` / `runtime:request`; `other-symbol:seed-unregistered` / "
     "`other-symbol:venue-foreign`",
     lambda f: _starts(_names(f), ("request.financial", "request.economic", "request.quandl", "syminfo.employees",
                                    "syminfo.shareholders", "syminfo.recommendations", "syminfo.target_price"))
     or "other-symbol:seed-unregistered" in f.get("otherSymbol", ())
     or bool(set(f.get("venues", ())) & FUNDAMENTAL_VENUES)),
    ("footprint-ticks", "Tick-by-tick data: footprint rows (request.footprint, footprint.*, volume_row.*), "
     "bid / ask (defined on the 1T timeframe only), tick and seconds timeframes, per-symbol volume type",
     "host `pine:request` / `pine:builtin` / `pine:type` (footprint); runtime `runtime:request`; "
     "`lower-tf:unwitnessed` for a seconds timeframe",
     lambda f: _starts(_names(f), ("request.footprint", "footprint.", "volume_row.", "timeframe.isticks",
                                    "timeframe.isseconds", "syminfo.volumetype"))
     or bool(_names(f) & {"bid", "ask"}) or "footprint" in f.get("wallTags", ())),
    ("other-feeds", "Other feeds: a non-US exchange, a currency pair or FX rate, a commodity, futures or a "
     "crypto pair / perpetual (BINANCE:, COINBASE:, OANDA:, FX:, CME:, a bare XAUUSD / EURUSD)",
     "host `pine:request` with `other-symbol:venue-foreign` or `other-symbol:bare`; runtime "
     "`runtime:request-with-state` / `runtime:request`",
     lambda f: bool(set(f.get("venues", ())) - US_VENUES - FUNDAMENTAL_VENUES - INDEX_VENUES - BREADTH_VENUES)
     or _starts(_names(f), ("request.currency_rate",))
     or ("other-symbol:bare" in f.get("otherSymbol", ()) and not set(f.get("venues", ())) & BREADTH_VENUES)),
    # ⭐ libraries chain L1 (2026-11-19): a script that imports a library version under a NON-COMMERCIAL licence
    # (CC-BY-NC-SA) can never be served on this paid product (U15 ruling 2026-11-15): the store answers it 409
    # `library:licence` and both lanes refuse the import line by name. The versions are the committed allowlist's
    # `neverPromoted` (`nc_library_versions`, one reader); the facts name each imported version the server does
    # not admit (`admission.missing`, `library:<Author>/<Lib>/<N>`). Until this class, such a script was counted
    # as an unlock of the last unit it needed (admit:collections:matrix, admit:collections:map, admit:enum).
    ("licence", "A library imported under a non-commercial licence (CC-BY-NC-SA): never served on this paid "
     "product unless its author relicenses (tools/pine_library/promotion_allowlist.json `neverPromoted`)",
     "`pine:library-licence` at the import line in both lanes (`pine_library_store.licence_problem`, store answer "
     "409 `library:licence`); with an empty store `runtime:library` / `pine:module`",
     lambda f: bool(_imported_versions(f) & nc_library_versions())),
    ("broker", "A live broker: an order alert whose message drives a connected brokerage "
     "({{strategy.order.*}} placeholders). We simulate orders (the strategy unit); we never route them",
     "none at the door: the alert text is a string; the order it would place is the broker's",
     lambda f: bool(f.get("orderAlerts"))),
]
FEATURE_ONLY = frozenset({"broker"})

PROMOTION_ALLOWLIST = os.path.join(ROOT, "tools", "pine_library", "promotion_allowlist.json")


def _allowlist():
    try:
        doc = json.load(open(PROMOTION_ALLOWLIST, encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise SystemExit("tools/pine_library/promotion_allowlist.json cannot be read: %s" % err)
    if not isinstance(doc, dict):
        raise SystemExit("tools/pine_library/promotion_allowlist.json is not an object")
    return doc


def nc_library_versions():
    """The library versions held under a NON-COMMERCIAL licence: the allowlist's `neverPromoted` paths, read only
    while its reason says so. ⛔ Fails closed (SystemExit) on any other shape: a never-serve class must not be
    computed from a list nobody can read."""
    row = _allowlist().get("neverPromoted")
    paths = row.get("paths") if isinstance(row, dict) else None
    if (not isinstance(row, dict) or "non-commercial" not in str(row.get("reason", ""))
            or not isinstance(paths, list) or not all(isinstance(x, str) and x.count("/") == 2 for x in paths)):
        raise SystemExit("promotion_allowlist.json `neverPromoted` is not {reason: <non-commercial ...>, paths: [...]}")
    return frozenset(paths)


def promoted_store():
    """[{path, sha256}] of the allowlist's `promote` rows: the store production serves (since 2026-11-17 the store
    serves ONLY these, `pine_library_store.entry_status`). The official census is measured with exactly this store
    (run_census.py --library-store), and the rail holds the committed map to it."""
    rows = _allowlist().get("promote")
    if not isinstance(rows, list) or not all(isinstance(r, dict) and isinstance(r.get("path"), str)
                                             and isinstance(r.get("sha256"), str) for r in rows):
        raise SystemExit("promotion_allowlist.json `promote` is not a list of {path, sha256, ...}")
    return sorted(({"path": r["path"], "sha256": r["sha256"].lower()} for r in rows), key=lambda r: r["path"])


def _imported_versions(f):
    """The library versions a script imports that the server does not admit, from its facts (identifiers)."""
    adm = (f or {}).get("admission") or {}
    return {m[len("library:"):] for m in adm.get("missing") or [] if isinstance(m, str) and m.startswith("library:")}
# ── RULED BY NAME (coordinator, 2026-11-18): a never-serve script whose class no detector above reads off its
# source, with the witness that settled it. ⛔ A ruling, never a guess: each names the run that witnessed it.
# These three read crypto pairs as SYMBOL INPUT DEFAULTS the facts do not hold as venues (a v4 `input('BINANCE:
# ...', title=input.symbol)`; bare `XRPUSDT`-style pairs with no prefix): we hold no crypto data, and TradingView
# itself refuses every one at its defaults ("Invalid symbol"), so no capture of them can be taken either
# (capture run objunit-2026-11-18, packet 582f2cf1e50b7fbb1939bf9d4fd38017981ac9d4c5aeb290f3add37703ccf596,
# 0 of 6 capturable; the 2026-11-15 attempt the same).
RULED_NEVER_SERVE = {
    "committed:supertrend-explorer__V4MsmtCeKs": (
        "other-feeds", "nine BINANCE: crypto pairs (BINANCE:EOSBTC ...) as symbol input defaults; TradingView "
        "refuses it at its defaults (\"Invalid symbol\"), run objunit-2026-11-18"),
    "reference:custom-screener-with-alerts__dd1bf69eb8": (
        "other-feeds", "40 crypto pairs (XRPUSDT, BTCUSDT ...) as symbol input defaults; TradingView refuses it "
        "at its defaults (\"Invalid symbol\"), run objunit-2026-11-18"),
    "reference:screener-for-40-instruments__a009097811": (
        "other-feeds", "40 crypto pairs (XRPUSDT, BTCUSDT ...) as symbol input defaults; TradingView refuses it "
        "at its defaults (\"Invalid symbol\"), run objunit-2026-11-18"),
}
# In scope as their own DATA units (owner scope), so NOT never-serve: the decision is the data, not the engine.
DATA_DECISIONS = [
    ("breadth", "US market breadth series (USI:ADVN.NY family, ADD, TICK, TRIN): our own breadth data",
     "host `pine:request` with `other-symbol:venue-foreign` / `other-symbol:class-share` on a USI: spelling",
     lambda f: bool(set(f.get("venues", ())) & BREADTH_VENUES)),
    ("indices", "Index series (SP:SPX, TVC:VIX, INDEX:*): served one spelling at a time behind a capture witness "
     "(requestWitnesses.json; SP:SPX is the first)",
     "`other-symbol:witness-pending` / `other-symbol:venue-foreign`",
     lambda f: bool(set(f.get("venues", ())) & INDEX_VENUES)),
    ("corporate-events", "Earnings, dividends and splits as TradingView serves them (request.earnings / "
     "request.dividends / request.splits, earnings.* / dividends.* / splits.*)",
     "host `pine:request` / `pine:builtin`; runtime `runtime:request-with-state`",
     lambda f: _starts(_names(f), ("request.earnings", "request.dividends", "request.splits", "earnings.",
                                    "dividends.", "splits."))),
]

# ── WALLS THE 1D CENSUS CANNOT SEE, measured elsewhere (coordinator, 2026-11-18). The census runs every script on
# one daily chart (NYSE:RDDT 1D, listed 2024), so a wall that needs an intraday chart, or a history longer than
# RDDT's, never shows in its rows. Each is recorded with its witness and the unit it belongs to; it carries no
# script count, because nothing here measured one.
EXTERNAL_WALLS = [
    {"wall": "first-bar-anchor", "unit": "first-bar-anchor", "kind": "engine",
     "title": "A running value anchored at the first bar (an all-time ratchet, an all-time high, an anchored VWAP "
              "reaching past the look-back cap)",
     "census": "host `budget:lookback` (cap 960 bars, ruled not raised 2026-11-17); the runtime lane runs from the "
               "first bar the chart hands it, so it is a wall there only when that bar is not TradingView's",
     "witness": "measured 2026-11-18 by another session (local): SPY 1D from the 1993 listing, a level rising since "
                "the listing is 82% bar-equal to a windowed value at W=900 and 20% off at worst; McGinley 14 (a "
                "decaying recurrence) is bit-equal at W=300. A decaying recurrence converges inside a window; a "
                "running extreme or sum does not, at any W the cap allows"},
    {"wall": "daily-on-intraday", "unit": "request", "kind": "engine",
     "title": "A DAILY read on an intraday chart (previous day's high / low / close, daily pivots): a "
              "request.security to a higher timeframe",
     "census": "host `tf` reads weekly and monthly only (`pine:request`: \"another timeframe as `tf` (weekly and "
               "monthly ...)\"); the session-reader spelling exceeds `budget:lookback` (1361 vs 960). On the 1D "
               "census a \"D\" request is the chart's own timeframe, so it never shows",
     "witness": "measured 2026-11-18 by the Create Indicator capability census (local REPORT.md): 2 of 177 ideas "
                "(previous day H/L/C, daily pivots) blocked by exactly this"},
    # U-CONFIRM (coordinator ruling 2026-11-18): an open QUESTION, not an engine gap. Until a capture pins it the
    # engine does not guess: it runs every closed bar, and the harness grades a strategy capture on the bars its
    # strategy RAN (an ABSENT newest value row is cut, `strategyLane.js::strategyRanView`).
    {"wall": "strategy-bar-confirm", "unit": "strategy", "kind": "evidence",
     "title": "U-CONFIRM: when TradingView confirms a closed daily bar for a strategy. A default strategy "
              "(calc_on_every_tick false) runs a bar once TradingView confirms it, and a capture taken after the "
              "session close can still hold a newest bar its strategy has not run",
     "census": "the census runs every script on closed bars it treats as confirmed; the grade cuts only an ABSENT "
               "newest value row of a strategy capture (an `na` row, or a row missing anywhere else, is compared)",
     "witness": "r1-strategy-draws-rddt-1d-2026-10-02: 636 bars and 635 value rows, bar 635's session closed at "
                "20:00Z and the capture was taken at 22:57Z (newestBarIsForming false); its indicator twin (no "
                "broker) holds all 636. The 2026-11-16 report captures (22:09-23:18Z) hold the same shape. Pinned "
                "by one strategy captured just before and just after TradingView confirms the bar"},
]

# ── THE CREATE INDICATOR CAPABILITY CENSUS (2026-11-18, local: reports/indicator-ecosystem/capability-census/
# 2026-11-18/REPORT.md): what our FORMULA language cannot write, by reason, classified against Pine parity. That
# census measures the authoring lane, not Pine imports; each class is mapped to the Pine construct that does it,
# and to this roadmap's unit (a wall), to never-serve, or to a data decision.
AUTHORING_CLASSES = [
    ("drawn objects", 9, "line / box / label / polyline objects", "wall", "objects",
     "Pine imports already draw line / label / box / table (admitted); the authoring vocabulary does not ask for them"),
    ("pattern search of no fixed length", 6, "loops, arrays and `var` state over swings (runtime lane)", "wall",
     "loops / collections / conditional-history",
     "the host lane decides a formula's history before it runs, by design; the runtime lane is the route"),
    ("many symbols at once (breadth, ranks)", 5, "published breadth symbols (USI:, INDEX:), <= 40 request.* calls, "
     "a registered seed (RS rating)", "data decision", "breadth / indices; request (a 20-symbol table)",
     "a market-wide rank through time is not a Pine built-in: TradingView serves it only as a symbol or a seed"),
    ("history of a non-price series", 5, "request.earnings (earnings), request.financial (EPS, sales)", "never-serve / data decision",
     "corporate-events (earnings); never-serve fundamentals (EPS, sales)",
     "short interest, implied volatility rank and news have no Pine construct: outside Pine parity"),
    ("time of day across sessions, non-regular sessions", 4, "arrays / maps keyed by time; an extended-session "
     "ticker (ticker.new with session.extended)", "wall", "collections; request (extended session); first-bar-anchor (seasonality)",
     "Globex / Asia / London ranges of a futures or foreign feed are never-serve (other feeds)"),
    ("plot styles", 3, "plot.style_circles with a series colour, plotcandle, a positive plot offset", "wall",
     "output-contract / colour", "presentation the pane does not carry yet"),
    ("bars smaller than the chart's, ticks", 3, "request.security_lower_tf; request.footprint, bid / ask", "wall / never-serve",
     "lower-tf; never-serve footprint-ticks", "intrabar bars from our intraday store are a wall; trades and quotes are not ours"),
    ("volume or time by price level", 2, "no built-in; community scripts bin lower-timeframe bars into arrays and boxes "
     "(request.footprint for the real one)", "wall / never-serve", "lower-tf + collections + objects; never-serve footprint-ticks",
     "a profile from lower-timeframe bars is buildable; a tick-exact one is not"),
    ("bars not built on time (Renko, Kagi, P&F)", 1, "ticker.renko / ticker.kagi / ticker.pointfigure inside request.security",
     "wall", "request (synthetic tickers, as Q-REQ3's Heikin Ashi)", "needs TradingView's brick / box rule witnessed per form"),
]


# ─────────────────────────────────────────────────────────────────────────────────────────────── facts (local)
def _admission(src, admitted, allow, history_only):
    """The server's static admission answer for one source: allowlisted / capability / not-admitted / killed,
    and whether it uses a capability admitted for closed-bar history only (drawn only on a closed newest bar)."""
    import capability_admission as ca
    from api.services import runtime_definitions as rt
    h = rt.source_hash(src)
    row = ca.admission_row(src, admitted)
    hist = bool(set(row["caps"]) & history_only)
    if row["killed"]:
        return {"status": "killed", "missing": row["missing"], "historyOnly": hist}
    if any(h.startswith(e) for e in allow):
        return {"status": "allowlisted", "missing": [], "historyOnly": hist}
    return {"status": "capability" if row["admitted"] else "not-admitted", "missing": row["missing"],
            "historyOnly": hist}


def _local_runs(runs_dir):
    """{source sha256: sorted run ids} over every local capture run whose manifest names the source and holds a
    capture of its slug (licence-held: only the run id and the count leave this PC)."""
    out = collections.defaultdict(set)
    if not runs_dir or not os.path.isdir(runs_dir):
        return out
    for run in sorted(os.listdir(runs_dir)):
        man = os.path.join(runs_dir, run, "manifest.json")
        caps = os.path.join(runs_dir, run, "captures")
        if not os.path.isfile(man) or not os.path.isdir(caps):
            continue
        try:
            doc = json.load(open(man, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        files = os.listdir(caps)
        for s in doc.get("scripts") or [] if isinstance(doc, dict) else []:
            sha, slug = s.get("sha256"), s.get("slug")
            if isinstance(sha, str) and slug and any(f.startswith(slug) for f in files):
                out[sha].add(run)
    return out


def cmd_facts(a):
    import coverage_map as cm
    sys.path.insert(0, os.path.join(ROOT, "tools", "vendor_harness"))
    import evidence_ledger as el
    import licence_held
    from api.services import pine_capabilities as pc
    from api.services import runtime_definitions as rt
    m = json.load(open(a.map, encoding="utf-8"))
    ref = json.load(open(a.ref, encoding="utf-8"))
    inv = cm.Inventory(ref)
    # the names a token may be kept as: the WHOLE v6 reference when given (the census's `--ref` holds only the
    # items TradingView's examples use)
    names = cm.Inventory(json.load(open(a.names_ref, encoding="utf-8"))) if a.names_ref else inv
    inputs = {i["key"]: i for i in json.load(open(os.path.join(a.cache, "census_input.json"), encoding="utf-8"))}
    prod = cm.read_census(a.cache, cm.LANE_PRODUCTION, "--cache")
    rtrows = cm.read_census(a.runtime_cache, cm.LANE_RUNTIME_ON, "--runtime-cache")
    reg = rt.admitted_capabilities()
    admitted = set(reg["admitted"])
    # (libraries chain, 2026-11-19) a library version is admitted: `admission_row` applies the server's import rule
    # (`runtime_definitions.missing_capabilities`), so `_admission` answers as the server does
    allow = rt.graded_allow_list()
    history_only = set(reg.get("historyOnly") or [])

    def src_of(k):
        return open(inputs[k]["path"], encoding="utf-8", newline="").read()

    # committed captures, joined to the sample by source (coverage_map.norm_src: one rule)
    by_norm = {}
    for k in inputs:
        if not k.startswith("example:"):
            by_norm.setdefault(cm.norm_src(open(inputs[k]["path"], encoding="utf-8").read()), k)
    caps = collections.defaultdict(dict)
    for lane, path in (("production", a.verdicts), ("runtimeOn", a.runtime_verdicts)):
        for r in json.load(open(path, encoding="utf-8")).get("results", []):
            try:
                src = (json.load(open(licence_held.resolve(r["file"]), encoding="utf-8")).get("source") or {}).get("text")
            except Exception:  # noqa: BLE001 - a capture not on this machine joins nothing
                src = None
            k = by_norm.get(cm.norm_src(src)) if src else None
            if k:
                caps[k].setdefault(r["id"], {})[lane] = r.get("verdict")
    ledger = collections.defaultdict(list)
    for row in el.read_rows(el.LEDGER) if os.path.exists(el.LEDGER) else []:
        ledger[row.get("sourceSha256")].append(row)
    local = _local_runs(a.local_runs)

    served_host = {s["key"] for s in m["scripts"] if s["clean"]}
    facts = {}
    for s in m["scripts"]:
        k = s["key"]
        if k in served_host:
            continue
        src = src_of(k)
        full = hashlib.sha256(src.encode("utf-8")).hexdigest()
        full_lf = hashlib.sha256(src.replace("\r\n", "\n").encode("utf-8")).hexdigest()
        u = cm.usage_of(src, inv)
        f = {"admission": None if s["placesOrders"] else _admission(src, admitted, allow, history_only)}
        r0 = rtrows.get(k) or {}
        st0 = (r0.get("steps") or [{}])[0]
        # the runtime lane drew it at step 0 (a kill-listed script, or an order-placing strategy, is still not served)
        f["rtAttached"] = bool(r0.get("attached")) and st0.get("lane") == "runtime"
        # the runtime-on peel reached a build: its wall list is the whole list, not an upper bound's head
        f["rtEnumerated"] = bool(r0.get("reachedAfterPeel")) or bool(r0.get("attached"))
        f["dataLimited"] = sorted(i for i in u["items"] if cm.data_limited(i))
        f["venues"] = sorted({mm.group(1) for sy in u["symbols"] for mm in [_VENUE.match(sy.strip().upper())] if mm})
        codes = set()
        for row in (prod.get(k) or {}, rtrows.get(k) or {}):
            for st in row.get("steps") or []:
                for r in st.get("refusals") or []:
                    codes.update(_OTHER_SYMBOL.findall(r.get("message") or ""))
                rd = (st.get("runtimeDeclined") or {}).get("why") or ""
                codes.update(_OTHER_SYMBOL.findall(rd))
        f["otherSymbol"] = sorted(codes)
        toks = collections.defaultdict(set)
        for st in (rtrows.get(k) or {}).get("steps") or []:
            if st.get("attached"):
                break
            pr, rd = st.get("rtProbe") or {}, st.get("runtimeDeclined") or {}
            g = (pr.get("guard") if pr.get("agrees") is not False else None) or rd.get("code") or pr.get("guard")
            t = _tok(pr.get("token"))
            if g and t:
                # a Pine name (the reference inventory, or a keyword) is kept; a script's own identifier is not:
                # the roadmap needs which BUILT-IN to build, never what an author named a variable
                toks[g].add(t if (names.normalise(t, u["version"]) or t in cm.KEYWORD_FEATURE or t in _KEYWORDS) else USER_TOKEN)
        f["tokens"] = {g: sorted(v) for g, v in sorted(toks.items())}
        f["captures"] = [{"id": cid, **v} for cid, v in sorted(caps.get(k, {}).items())]
        led = []
        for row in ledger.get(full, []) + (ledger.get(full_lf, []) if full_lf != full else []):
            vs = row.get("verdicts") or {}
            led.append({"id": row.get("captureId"), "engine": row.get("scriptEngineVersion"),
                        "production": (vs.get("production") or {}).get("verdict"),
                        "runtimeOn": (vs.get("runtime-on") or {}).get("verdict")})
        f["ledger"] = sorted(led, key=lambda x: (str(x["id"]), x["engine"] or 0))
        f["localRuns"] = sorted(local.get(full, set()) | local.get(full_lf, set()))
        # an alert message carrying order placeholders exists to drive a connected broker (never-serve: broker)
        f["orderAlerts"] = "{{strategy.order" in src
        tags = (m["runtimeOn"]["walls"].get("tags") or {}).get(k) or {}
        f["wallTags"] = sorted({t for ts in tags.values() for t in ts})
        facts[k] = f
    out = {"schema": FACTS_SCHEMA, "generatedBy": "tools/pine_coverage/parity_roadmap.py facts",
           "engine": el.engine_version(), "admittedCapabilities": sorted(admitted),
           "historyOnly": sorted(reg.get("historyOnly") or []), "gradedAllowList": len(allow),
           "note": "identifiers only: capability ids, guard names, identifier tokens, exchange prefixes, capture "
                   "and run ids; no source, no message text",
           "scripts": facts}
    _write(a.out, out)
    print("facts: %d scripts not served on the host lane -> %s" % (len(facts), a.out))


# ─────────────────────────────────────────────────────────────────────────────────────────────── build
def member_model(m, facts):
    """(served, walls, enumerated, missing): the served set, {key: sorted walls} for every script not served,
    the keys whose wall list is fully enumerated, and the keys `facts` holds nothing for (their admission is
    unknown, so a runtime-lane script among them is NOT counted served)."""
    ro = m["runtimeOn"]
    by_script = ro["walls"]["byScript"]
    dirty = ro["walls"].get("attachedDirtyWalls") or {}
    added, lost = set(ro["added"]), set(ro["lost"])
    served, walls, enumerated, missing_facts = set(), {}, set(), []
    for s in m["scripts"]:
        k = s["key"]
        if s["clean"] and k not in lost:
            served.add(k)          # the host lane serves it; route-by-cost moves it only when the runtime lane admits it
            continue
        f = facts.get(k)
        if f is None:
            missing_facts.append(k)
            f = {}
        rt_walls = set(by_script.get(k) or [])
        rt_attached = bool(f.get("rtAttached"))
        if k in added:
            ws = set()             # the runtime lane draws it: only admission can stop it
        elif rt_walls:
            ws = set(rt_walls)
        elif rt_attached:
            ws = set()             # the runtime lane drew it; a list or the broker is what stops it (below)
        else:
            ws = set(dirty.get(k) or [])   # attached dirty on the HOST lane: its object program's walls
        route_runtime = k in added or bool(rt_walls) or rt_attached
        if s["placesOrders"]:
            # a strategy's output is its trades: "nothing to plot" is the strategy wall, as the census relabels it
            ws = {w for w in ws if unit_of(w) != "output-contract"}
            ws.add(WALL_STRATEGY)
        if WALL_HOST_LISTED in s["walls"] and not route_runtime:
            ws.add(WALL_HOST_LISTED)
        if s["clean"] and k in lost:
            ws.add("runtime:lost-on-runtime-on")
        adm = f.get("admission")
        if route_runtime and adm and not s["placesOrders"]:
            if adm["status"] == "killed":
                ws.add(WALL_KILLED)
            elif adm["status"] == "not-admitted":
                ws |= {ADMISSION + c for c in adm["missing"]}
        if k in added and not ws and "admission" in f:
            served.add(k)
            continue
        if not ws:
            ws.add("unnamed" if "admission" in f else "facts:missing")
        walls[k] = sorted(ws)
        if k in added or rt_attached or (f.get("rtEnumerated") if rt_walls else True):
            enumerated.add(k)
    return served, walls, enumerated, sorted(missing_facts)


def wall_table(walls, enumerated, unit_fn=None):
    unit_fn = unit_fn or unit_of
    any_c, sole_c, sole_enum = collections.Counter(), collections.Counter(), collections.Counter()
    sole_keys = collections.defaultdict(list)
    for k, ws in walls.items():
        for w in ws:
            any_c[w] += 1
        if len(ws) == 1:
            sole_c[ws[0]] += 1
            sole_keys[ws[0]].append(k)
            if k in enumerated:
                sole_enum[ws[0]] += 1
    rows = []
    for w in sorted(any_c, key=lambda w: (-sole_c[w], -any_c[w], w)):
        rows.append({"wall": w, "unit": unit_fn(w), "sole": sole_c[w], "soleFullyEnumerated": sole_enum[w],
                     "any": any_c[w], "soleScripts": sorted(sole_keys[w])})
    return rows


# ── THE SERVED SET, BY WHAT THE MEMBER'S CHART DRAWS (census tools, 2026-11-19). The map's `renderGaps` (the
# runtime-on render sweep, `render_gaps.py`, folded by `coverage_map.py --render-gaps`) says, per sample script,
# how many captures were measured and which drawings their charts leave off, by class. A served script is
#   servedFully             measured on at least one capture, and no measured capture leaves a drawing off;
#   servedWithDisclosedGap  a measured capture leaves drawings off: placed nowhere, or withheld by name, and
#                           disclosed to the member by the drawing note (`objectRenderNotice.js`);
#   servedUnmeasured        no capture of it was measured (no capture, or none our side ran);
#   servedDiverging         a capture of it grades DIVERGE on the sweep's lane (coordinator ruling 2026-11-19: never
#                           "fully", whatever its drawings; the REACH rules kill it or withhold it by name, so a
#                           script here is a finding, named in `renderGaps.diverging`).
# The four are a partition of the served set (diverging first, then a gap, then fully, else unmeasured).
# Each gap class is a ranked wall over the served scripts it touches (`renderWalls`, unit `render`).
RENDER_UNIT = "render"


def render_split(served, rg):
    """(fully, {key: sorted gap classes}, unmeasured, diverging) over the served set; None without a sweep."""
    if not rg:
        return None
    sc = rg.get("scripts") or {}
    fully, gap, unmeasured, diverging = [], {}, [], []
    for k in sorted(served):
        r = sc.get(k) or {}
        if r.get("diverge"):
            diverging.append(k)
        elif not r.get("measured"):
            unmeasured.append(k)
        elif r.get("gaps"):
            gap[k] = sorted(r["gaps"])
        else:
            fully.append(k)
    return fully, gap, unmeasured, diverging


def pair_table(walls, keyfn=lambda w: w):
    pairs = collections.defaultdict(list)
    for k, ws in walls.items():
        ks = sorted({keyfn(w) for w in ws})
        if len(ks) == 2:
            pairs[tuple(ks)].append(k)
    return [{"walls": list(p), "scripts": sorted(v), "count": len(v)}
            for p, v in sorted(pairs.items(), key=lambda kv: (-len(kv[1]), kv[0]))]


def host_tables(m):
    """The host-only lane's blockers, as every map has ranked them (comparable with 11-17)."""
    notclean = [s for s in m["scripts"] if not s["clean"]]
    sole_of = collections.defaultdict(list)
    for s in notclean:
        if len(s["walls"]) == 1:
            sole_of[s["walls"][0]].append(s["key"])
    keyrows = [{"blocker": b["blocker"], "capability": b["capability"], "sole": b["soleBlockerOf"],
                "any": b["scriptsBlocked"], "soleScripts": sorted(sole_of.get(b["blocker"], []))}
               for b in m["blockers"]]
    caps = m["capabilities"]
    buckets = [{"capability": c, "sole": caps["sole"].get(c, 0), "any": n}
               for c, n in sorted(caps["touched"].items(), key=lambda kv: (-caps["sole"].get(kv[0], 0), -kv[1], kv[0]))]
    hp = collections.Counter()
    for s in notclean:
        if len(s["walls"]) == 2:
            hp[tuple(sorted(s["walls"]))] += 1
    pairs = [{"walls": list(p), "count": n} for p, n in sorted(hp.items(), key=lambda kv: (-kv[1], kv[0]))]
    return {"notTransferring": len(notclean), "blockers": keyrows, "capabilities": buckets, "pairs": pairs}


def classify(f, classes):
    return [cid for cid, _t, _code, rule in classes if f is not None and rule(f)]


def build(m, facts_doc, map_sha=None):
    facts = facts_doc["scripts"]
    served, walls, enumerated, missing_facts = member_model(m, facts)
    rg = m.get("renderGaps")
    split = render_split(served, rg)
    N = len(m["scripts"])
    ro = m["runtimeOn"]
    host = {s["key"] for s in m["scripts"] if s["clean"]}
    added = set(ro["added"])
    adm_counter = collections.Counter()
    for k in sorted(added):
        f = facts.get(k) or {}
        adm = (f.get("admission") or {})
        adm_counter[adm.get("status", "no-facts")] += 1
    declined_caps = collections.Counter(c for k in added for c in ((facts.get(k) or {}).get("admission") or {}).get("missing", [])
                                        if ((facts.get(k) or {}).get("admission") or {}).get("status") == "not-admitted")
    history_only_served = sorted(k for k in added & served
                                 if ((facts.get(k) or {}).get("admission") or {}).get("historyOnly"))

    # never-serve / data-decision classification of every script not served
    never, data_dec = collections.defaultdict(list), collections.defaultdict(list)
    for k in sorted(walls):
        f = facts.get(k)
        for c in classify(f, NEVER_SERVE):
            never[c].append(k)
        ruled = RULED_NEVER_SERVE.get(k)
        if ruled and k not in never[ruled[0]]:
            never[ruled[0]].append(k)   # a ruling by name (`RULED_NEVER_SERVE`), its witness beside it below
        for c in classify(f, DATA_DECISIONS):
            data_dec[c].append(k)
    # a script that needs data we cannot hold can never transfer fully; the broker class is a FEATURE (the order
    # an alert would route), not the script's chart output, so its scripts stay in the ranking
    never_keys = set(itertools.chain.from_iterable(v for c, v in never.items() if c not in FEATURE_ONLY))

    # units: each script's walls grouped by unit
    unit_walls = {k: sorted({unit_of(w) for w in ws}) for k, ws in walls.items()}
    unit_rows = []
    seen_units = {u for us in unit_walls.values() for u in us}
    dynamic = sorted(u for u in seen_units if u not in UNIT_OF)
    for uid in [u[0] for u in UNITS] + dynamic:
        title, kind = unit_meta(uid)
        members = [k for k, us in unit_walls.items() if uid in us]
        sole = sorted(k for k in members if unit_walls[k] == [uid])
        sole_ok = sorted(k for k in sole if k not in never_keys)
        row = {
            "unit": uid, "title": title, "kind": kind, "size": unit_size(uid),
            "walls": sorted({w for k in members for w in walls[k] if unit_of(w) == uid}),
            "sole": len(sole), "soleFullyEnumerated": sum(1 for k in sole if k in enumerated),
            "soleServable": len(sole_ok), "any": len(members), "soleScripts": sole,
            # the evidence of the sole scripts no data wall stops (a never-serve script needs no capture)
            "evidence": evidence_status(sole_ok, facts),
        }
        if uid.startswith("admit:"):
            # ready evidence: scripts the runtime lane already draws that use it, with a committed runtime-on MATCH
            row["runtimeDrawnWithMatch"] = sorted(
                k for k in members if k in added
                and any(x.get("runtimeOn") == "MATCH" for x in (facts.get(k) or {}).get("captures") or []))
        unit_rows.append(row)
    unit_pairs = pair_table(walls, unit_of)
    # RANKED: scripts unlocked per unit of work. Greedy: each step builds the unit whose completion frees the most
    # scripts per its size (sole first; later steps count the pairs it closes with units already built), never
    # before the units it stands on (DEPENDS). Never-serve scripts are left out: no unit can free them.
    # An OWNER-gated unit (strategy) is not engine work to schedule: its scripts are counted under it (`units`),
    # not in this order, which is what engine and evidence work can serve without an owner decision.
    owner_units = {u[0] for u in UNITS if u[2] == "owner"}
    order, done, cumulative = [], set(), len(served)
    # A data-decision script (breadth, an index, corporate events) is freed by the DATA unit, not engine work:
    # held apart too, so no engine unit is credited with it.
    data_keys = set(itertools.chain.from_iterable(data_dec.values())) - never_keys
    remaining = {k: set(us) for k, us in unit_walls.items()
                 if k not in never_keys and k not in data_keys and not (set(us) & owner_units)}
    while True:
        gain = collections.Counter()
        for k, us in remaining.items():
            left = us - done
            if len(left) == 1:
                gain[next(iter(left))] += 1
        touch = collections.Counter(u for us in remaining.values() for u in us - done)
        if not touch:
            break
        def score(u):
            return (gain[u] / unit_size(u), gain[u], touch[u], u)
        best = max(touch, key=score)
        # the best unit stands on units not built yet: build those first (the one that frees most on its own)
        unmet = [d for d in DEPENDS.get(best, ()) if d not in done and touch.get(d)]
        needed_by = best if unmet else None
        if unmet:
            best = max(unmet, key=score)
        done.add(best)
        freed = sorted(k for k, us in remaining.items() if not (us - done))
        for k in freed:
            del remaining[k]
        cumulative += len(freed)
        order.append({"unit": best, "neededBy": needed_by, "size": unit_size(best), "unlocks": len(freed),
                      "touches": touch[best],
                      "unlocksPerSize": round(len(freed) / unit_size(best), 2),
                      "unlocksFullyEnumerated": sum(1 for k in freed if k in enumerated),
                      "cumulativeServed": cumulative, "cumulativePct": round(100.0 * cumulative / N, 1)})

    # the runtime lane's own tokens per wall (identifiers), over the scripts not served: which names to build
    tok_c = collections.defaultdict(collections.Counter)
    for k in walls:
        for g, ts in ((facts.get(k) or {}).get("tokens") or {}).items():
            for t in ts:
                tok_c[g][t] += 1
    wall_tokens = {g: [[t, n] for t, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:25]]
                   for g, c in sorted(tok_c.items())}

    host_walls_by_bucket = {}
    for s in m["scripts"]:
        if s["clean"] or len(s["walls"]) != 1:
            continue
        b = s["walls"][0]
        host_walls_by_bucket.setdefault(b, collections.Counter())
        k = s["key"]
        if k in served:
            host_walls_by_bucket[b]["(served on the runtime lane)"] += 1
        else:
            for w in walls.get(k, ["unnamed"]):
                host_walls_by_bucket[b][w] += 1
    host_sole_runtime = {b: dict(sorted(c.items(), key=lambda kv: (-kv[1], kv[0])))
                         for b, c in sorted(host_walls_by_bucket.items()) if b.startswith("[")}

    out = {
        "schema": SCHEMA, "generatedBy": "tools/pine_coverage/parity_roadmap.py build",
        "map": {"measuredOn": m.get("measuredOn"), "masterSha": m.get("masterSha"), "sha256": map_sha,
                # the library store the census linked from ([{path, sha256}]; null: a census older than the record,
                # which measured an EMPTY store). The rail holds it to `promoted_store()`: production's truth.
                "libraryStore": m.get("libraryStore")},
        "engine": facts_doc.get("engine"),
        "headline": {
            "sample": N,
            "memberServed": len(served), "memberServedPct": round(100.0 * len(served) / N, 1),
            "runtimeOn": ro["transfer"], "runtimeOnPct": ro["transferPct"],
            "hostOnly": len(host), "hostOnlyPct": round(100.0 * len(host) / N, 1),
            "runtimeAdded": len(added), "runtimeLost": len(ro["lost"]),
            "admission": dict(sorted(adm_counter.items())),
            "declinedCapabilities": dict(sorted(declined_caps.items(), key=lambda kv: (-kv[1], kv[0]))),
            "servedOnHistoryOnly": len(history_only_served),
            "notServed": len(walls), "notServedFullyEnumerated": sum(1 for k in walls if k in enumerated),
            "neverServe": len(never_keys),
            "dataDecision": len(set(itertools.chain.from_iterable(data_dec.values())) - never_keys),
            "missingFacts": missing_facts,
            # ⭐ census tools: the served set by what the member's chart draws (None: the map holds no render sweep)
            "servedFully": len(split[0]) if split else None,
            "servedWithDisclosedGap": len(split[1]) if split else None,
            "servedUnmeasured": len(split[2]) if split else None,
            "servedDiverging": len(split[3]) if split else None,
        },
        "hostLane": host_tables(m),
        "hostSoleRuntimeWalls": host_sole_runtime,
        "memberWalls": wall_table(walls, enumerated),
        "renderGaps": {"engine": rg.get("engine"), "lane": rg.get("lane"), "fully": split[0],
                       "withDisclosedGap": split[1], "unmeasured": split[2], "diverging": split[3]} if split else None,
        "renderWalls": wall_table(split[1], set(split[1]), lambda w: RENDER_UNIT) if split else [],
        "memberPairs": pair_table(walls)[:60],
        "wallTokens": wall_tokens,
        "units": unit_rows,
        "unitPairs": unit_pairs[:40],
        "buildOrder": order,
        "neverServe": [{"class": cid, "title": t, "refusal": code, "scripts": sorted(never.get(cid, [])),
                        "count": len(never.get(cid, [])),
                        **({"ruledByName": {k: why for k, (c2, why) in sorted(RULED_NEVER_SERVE.items())
                                            if c2 == cid and k in never.get(cid, [])}}
                           if any(c2 == cid and k in never.get(cid, []) for k, (c2, _w) in RULED_NEVER_SERVE.items())
                           else {})} for cid, t, code, _r in NEVER_SERVE],
        "externalWalls": EXTERNAL_WALLS,
        "authoringClasses": [{"reason": r_, "ideas": n_, "pine": p_, "classification": c_, "unit": u_, "note": x_}
                             for r_, n_, p_, c_, u_, x_ in AUTHORING_CLASSES],
        "dataDecisions": [{"class": cid, "title": t, "refusal": code, "scripts": data_dec.get(cid, []),
                           "count": len(data_dec.get(cid, []))} for cid, t, code, _r in DATA_DECISIONS],
        "scripts": {k: walls[k] for k in sorted(walls)},
        "facts": facts_doc,
    }
    return out


def evidence_status(keys, facts):
    """For a unit's sole scripts: what TradingView evidence exists today. `committedMatch` = a committed capture
    grading runtime-on MATCH; `committedOther` = committed captures, none MATCH runtime-on; `ledgerOnly` = only
    licence-held ledger rows; `localOnly` = only local capture runs not graded into the ledger; `none` = no capture:
    each of those is a capture-queue row (RDDT 1D + SPY 1D, the coordinator's convention)."""
    c = collections.Counter()
    rows = []
    for k in keys:
        f = facts.get(k) or {}
        caps = f.get("captures") or []
        if any(x.get("runtimeOn") == "MATCH" for x in caps):
            st = "committedMatch"
        elif caps:
            st = "committedOther"
        elif f.get("ledger"):
            st = "ledgerOnly"
        elif f.get("localRuns"):
            st = "localOnly"
        else:
            st = "none"
        c[st] += 1
        if st in ("none", "localOnly", "ledgerOnly", "committedOther"):
            rows.append({"script": k, "status": st})
    return {"counts": dict(sorted(c.items())), "queue": rows}


# ─────────────────────────────────────────────────────────────────────────────────────────────── io / check
def _write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False, sort_keys=False)
        f.write("\n")
    os.replace(tmp, path)


def _sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read().replace(b"\r\n", b"\n")).hexdigest()


def cmd_build(a):
    m = json.load(open(a.map, encoding="utf-8"))
    fd = json.load(open(a.facts, encoding="utf-8"))
    fd = fd.get("facts", fd) if fd.get("schema") == SCHEMA else fd
    out = build(m, fd, _sha(a.map))
    _write(a.out, out)
    h = out["headline"]
    print("SERVED %d/%d = %s%% (runtime-on %d, host-only %d; admission %s)" % (
        h["memberServed"], h["sample"], h["memberServedPct"], h["runtimeOn"], h["hostOnly"], h["admission"]))
    if h["servedFully"] is not None:
        print("  served fully %d + with a disclosed gap %d + unmeasured %d + diverging %d" % (
            h["servedFully"], h["servedWithDisclosedGap"], h["servedUnmeasured"], h["servedDiverging"]))
        for r in out["renderWalls"]:
            print("  %-48s any=%3d sole=%3d" % (r["wall"], r["any"], r["sole"]))
    for r in out["units"]:
        print("  %-22s sole=%3d (servable %3d, enumerated %3d) any=%3d" % (
            r["unit"], r["sole"], r["soleServable"], r["soleFullyEnumerated"], r["any"]))


DERIVED = ("headline", "hostLane", "hostSoleRuntimeWalls", "memberWalls", "renderGaps", "renderWalls",
           "memberPairs", "wallTokens", "units",
           "externalWalls", "authoringClasses",
           "unitPairs",
           "buildOrder", "neverServe", "dataDecisions", "scripts")


def check(map_path=MAP, roadmap_path=ROADMAP):
    """[] when every derived section of the committed roadmap equals what `build` derives from the committed
    map and the roadmap's own facts; else the names of the sections that differ."""
    m = json.load(open(map_path, encoding="utf-8"))
    rd = json.load(open(roadmap_path, encoding="utf-8"))
    again = build(m, rd["facts"], _sha(map_path))
    bad = [s for s in DERIVED if again[s] != rd.get(s)]
    if rd.get("map", {}).get("sha256") != again["map"]["sha256"]:
        bad.append("map.sha256")
    return bad


def cmd_check(a):
    bad = check(a.map, a.roadmap)
    if bad:
        sys.exit("parity-roadmap.json is not what the census map gives (%s). Rebuild it:\n  python "
                 "tools/pine_coverage/parity_roadmap.py build --map %s --facts %s --out %s" % (
                     ", ".join(bad), a.map, a.roadmap, a.roadmap))
    print("parity roadmap: every count equals the census map's (%s)" % a.map)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("facts")
    f.add_argument("--map", default=MAP)
    f.add_argument("--ref", required=True)
    f.add_argument("--names-ref", default=None, help="the whole Pine v6 reference extract (token names)")
    f.add_argument("--cache", required=True)
    f.add_argument("--runtime-cache", required=True)
    f.add_argument("--verdicts", required=True)
    f.add_argument("--runtime-verdicts", required=True)
    f.add_argument("--local-runs", default=None)
    f.add_argument("--out", required=True)
    b = sub.add_parser("build")
    b.add_argument("--map", default=MAP)
    b.add_argument("--facts", required=True)
    b.add_argument("--out", default=ROADMAP)
    c = sub.add_parser("check")
    c.add_argument("--map", default=MAP)
    c.add_argument("--roadmap", default=ROADMAP)
    a = ap.parse_args()
    {"facts": cmd_facts, "build": cmd_build, "check": cmd_check}[a.cmd](a)


if __name__ == "__main__":
    main()
