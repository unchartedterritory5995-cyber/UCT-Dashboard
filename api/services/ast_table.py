"""The Python half of the closed table.

⭐ THIS MODULE OWNS NO VOCABULARY. It reads ``closedTable.json`` — the same bytes
the browser imports through ``app/src/components/chart/engine/ast/parse.js`` — and
hands it to ``ast_interpret``, which binds an implementation to each declared
name. The totality rail then asserts the binding is exhaustive in BOTH
directions, so a name added to the manifest lands RED here until somebody writes
it.

⛔ ONE DECLARATION, TWO READERS. A hand-copied table in this module would be a
second grammar, and the two would drift the first time somebody added a function
to one — silently, because every existing test would stay green. This repo has
already paid for two vocabularies that looked like one: ``williams_r`` here is
``williamsR`` in the chart registry, which is the only reason
``indicator_compute._CASE_COLUMNS`` exists at all.

⛔ AND "IT READS THE FILE" IS PROVED STRUCTURALLY, NOT PROMISED. A hand-copy that
happened to be byte-correct on the day it was written would satisfy any equality
against today's manifest. So ``test_ast_interpret.py`` walks THIS MODULE'S OWN
SOURCE with ``ast`` and asserts that no declared table name appears in it as a
string constant — a copy necessarily spells the names, and a reader necessarily
does not. That is why nothing below quotes ``close``, ``sma`` or an operator:
those literals are forbidden here by a test, deliberately.

⚠️ NO PARSER LIVES HERE, EVER (decision D-A1). The AST is the persisted artifact;
this lane walks a tree it did not build. A parser here would be a second grammar
and the drift would be silent.
"""
from __future__ import annotations

import io
import json
import pathlib
from types import MappingProxyType
from typing import Any, Mapping, Optional, Sequence

#: The manifest, resolved from THIS FILE rather than from a working directory.
#:
#: ⚠️ THE `goldenFixtures.test.js` SHAPE: resolve from the module, then assert the
#: file EXISTS with a message that names it. A path resolved from `os.getcwd()`
#: silently finds nothing when the suite is driven from a different directory,
#: and a lane that silently found no manifest would report a passing totality
#: rail over an empty table.
MANIFEST_PATH: pathlib.Path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"
)

#: The section keys of the manifest. STRUCTURE, not vocabulary — these name the
#: dictionaries, never an entry inside one.
SERIES_SECTION = "series"
CLOCK_SECTION = "clock"
OPERATORS_SECTION = "operators"
FUNCTIONS_SECTION = "functions"
SCALARS_SECTION = "scalars"

#: The key holding the columns that were CONSIDERED and REFUSED. Half of the
#: partition identity; see ``excluded_columns``.
EXCLUDED_KEY = "_scalars_excluded"

#: ⭐ THE SECTIONS A BAR-CORPUS CASE CAN EXERCISE — see ``bar_names``.
#:
#: ⭐ ``clock`` IS ONE OF THEM (tableVersion 2). A clock value is a property of
#: the BAR — the calendar moment it sits at — so it varies down the replay
#: series exactly as ``close`` does and a bar-corpus case measures it the same
#: way. That is the whole test for this tuple: a scalar is one number per SYMBOL
#: and has nothing to say about a 579-bar series, which is why it has its own
#: floor against its own fixture; a clock column has something to say about
#: every bar of it.
BAR_SECTIONS = (SERIES_SECTION, CLOCK_SECTION, OPERATORS_SECTION, FUNCTIONS_SECTION)

#: Every section that declares a NAME a formula may spell.
SECTIONS = BAR_SECTIONS + (SCALARS_SECTION,)


def _freeze(value: Any) -> Any:
    """Deep-freeze a decoded manifest so no caller can edit the shared table.

    A mutable module-level table is a second grammar waiting to happen: one
    caller's ``TABLE[...][...] = ...`` would change what every formula in the
    process means, and nothing would be red.
    """
    if isinstance(value, dict):
        return MappingProxyType({k: _freeze(v) for k, v in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(v) for v in value)
    return value


def load_manifest(path: Optional[pathlib.Path] = None) -> Mapping[str, Any]:
    """Read the closed table off disk and freeze it.

    ``io.open(..., encoding='utf-8')`` ALWAYS — a bare ``open()`` decodes as
    cp1252 on this box, and that has already killed a sibling harness mid-run.
    """
    p = pathlib.Path(path) if path is not None else MANIFEST_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"the closed table is missing at {p}. It is committed under app/, and "
            "this lane READS it rather than owning a copy."
        )
    with io.open(p, encoding="utf-8") as fh:
        doc = json.load(fh)
    for section in SECTIONS:
        if section not in doc or not isinstance(doc[section], dict):
            raise ValueError(
                f"{p} has no {section!r} object. The manifest's four sections are "
                f"{SECTIONS}; a lane that tolerated a missing one would resolve "
                "names against an empty dictionary and refuse everything."
            )
    return _freeze(doc)


#: The frozen manifest. Read once, at import, from the SAME file the browser
#: imports.
TABLE: Mapping[str, Any] = load_manifest()


def declared_names(manifest: Optional[Mapping[str, Any]] = None) -> set:
    """Every name the table declares, across all FOUR sections.

    ⛔ DERIVED FROM THE MANIFEST, NEVER HAND-LISTED. DPC's four constants rode
    unpinned for the rule's entire life because their rail was a LIST of what
    somebody remembered; a floor read out of its own subject cannot rot that way.

    ⚠️ A SECTION MISSING FROM A HAND-BUILT MANIFEST IS SKIPPED HERE AND REFUSED
    AT ``load_manifest``. The two are different questions: the loader decides
    whether the shipped file is well-formed; this answers "what does THIS mapping
    declare", and several rails hand it a synthetic three-section probe on
    purpose. Raising here would make the probe impossible to write.
    """
    m = manifest if manifest is not None else TABLE
    out: set = set()
    for section in SECTIONS:
        out |= set(m.get(section) or {})
    return out


def bar_names(manifest: Optional[Mapping[str, Any]] = None) -> set:
    """The names a BAR-CORPUS case can exercise: series | operators | functions.

    ⛔ SPLIT FROM ``declared_names`` DELIBERATELY, AND THE SPLIT IS THE WHOLE
    REASON THE CONFORMANCE LOG STAYS BYTE-IDENTICAL.
    ``tools/ast_conformance.assert_corpus_covers_the_table`` demands a corpus
    case per declared name and ABORTS the recorder otherwise. A scalar has no bar
    behaviour and no value in the replay series, so folding it into that floor
    would force one new bar-corpus case per scalar, move every per-ast digest,
    and re-freeze a cross-lane oracle for a reason that has nothing to do with
    bars. Scalars get their OWN floor, against their OWN fixture, and the
    committed digests do not move.

    ⭐ AND THE TWO FLOORS ARE A PARTITION OF ``declared_names`` — asserted in the
    conformance tool, so a ``bar_names`` that quietly widened to include scalars
    is a red recorder rather than a silently regrown corpus obligation.
    """
    m = manifest if manifest is not None else TABLE
    out: set = set()
    for section in BAR_SECTIONS:
        out |= set(m.get(section) or {})
    return out


def scalar_names(manifest: Optional[Mapping[str, Any]] = None) -> set:
    """Every per-symbol name the table declares."""
    m = manifest if manifest is not None else TABLE
    return set(m.get(SCALARS_SECTION) or {})


def clock_names(manifest: Optional[Mapping[str, Any]] = None) -> set:
    """Every bar-clock name the table declares.

    ⭐ A SUBSET OF ``bar_names``, NOT A THIRD FLOOR. The clock rides the
    ``series`` node and varies per bar, so the bar corpus already owes it a case
    and ``assert_the_two_floors_partition_the_table`` already covers it. This
    accessor exists so a reader that has to treat a clock leaf DIFFERENTLY — the
    two interpreters seeding it from ``compute_clock`` rather than from a bar
    field, the two linters resolving it to reach (0, 0) — can ask the manifest
    which names those are instead of carrying a list.
    """
    m = manifest if manifest is not None else TABLE
    return set(m.get(CLOCK_SECTION) or {})


def series_field(name: str, manifest: Optional[Mapping[str, Any]] = None) -> str:
    """The bar key a declared series reads. Raises ``KeyError`` for anything else."""
    m = manifest if manifest is not None else TABLE
    return m[SERIES_SECTION][name]["field"]


def scalar_source(name: str, manifest: Optional[Mapping[str, Any]] = None) -> Mapping[str, Any]:
    """``{"store", "column"}`` for a declared scalar. ``KeyError`` otherwise.

    ⭐ THE COLUMN IS DECLARED SEPARATELY FROM THE NAME even though the two are
    equal today, because the partition rail compares the COLUMN half against
    ``snapshot_db.COLUMNS`` — and a scalar the table chose to spell differently
    from its column would silently drop out of that identity if the rail read the
    key instead.
    """
    m = manifest if manifest is not None else TABLE
    return m[SCALARS_SECTION][name]["source"]


def scalar_as_of(name: str, manifest: Optional[Mapping[str, Any]] = None) -> Mapping[str, Any]:
    """``{"column", "grain"}`` — the column that DATES a declared scalar.

    ⛔ A COLUMN, NEVER A DATE. Freshness is per SYMBOL: one ticker's row can be a
    month older than another's, so the declaration points at the row column
    carrying the value's own date rather than at any date this process knows.
    """
    m = manifest if manifest is not None else TABLE
    return m[SCALARS_SECTION][name]["as_of"]


def scalar_cadence(name: str, manifest: Optional[Mapping[str, Any]] = None) -> str:
    """How often the declared scalar's source is rebuilt."""
    m = manifest if manifest is not None else TABLE
    return m[SCALARS_SECTION][name]["cadence"]


def excluded_columns(manifest: Optional[Mapping[str, Any]] = None) -> set:
    """The screener columns CONSIDERED and refused, each with a stated reason.

    ⭐ HALF OF A PARTITION IDENTITY, AND THE HALF THAT DOES THE WORK. A declared
    list on its own is a list of what somebody remembered. With
    ``declared | excluded == snapshot_db.COLUMNS`` and the two disjoint, a
    sixty-sixth screener column lands RED until somebody DECIDES about it — which
    is the only thing that keeps this vocabulary honest as the screener grows.
    """
    m = manifest if manifest is not None else TABLE
    return set(m.get(EXCLUDED_KEY) or {})


#: The three answers ``yields_of`` can give. ``passthrough`` is the ternary's,
#: and only the ternary's: its result kind is the join of its branches.
#:
#: ⛔ THE FAIL-CLOSED DIRECTION IS THE NUMERIC ONE. Refusing to call a tree a
#: condition costs a user an error message; admitting a real-valued tree as one
#: makes ``<tree> != 0`` true for every non-zero price on the board.
YIELDS = ("num", "bool", "passthrough")
YIELDS_DEFAULT = "num"


def yields_of(name: str, manifest: Optional[Mapping[str, Any]] = None,
              sections: Optional[Sequence[str]] = None) -> str:
    """What an operator, function or scalar's values can be. ``KeyError`` if the
    name is not declared in any of those three sections.

    ⛔ ONE DECLARATION, EVERY CONSUMER DERIVES. Without it, a picker refusing a
    row that is not a condition and a scan check refusing a tree that returns a
    number would each hand-list the same nine comparison and logical operators,
    in two languages — the two-vocabularies defect this repo has already paid for
    twice. An entry with NO declaration reads as the numeric default rather than
    raising, because a manifest that grew an entry is a vocabulary question and
    fail-closed is the answer until somebody declares it.
    """
    m = manifest if manifest is not None else TABLE
    # ⛔ THE SECTION LIST IS DERIVED, NEVER TYPED, AND THAT IS THE FIX FOR A
    # MEASURED DEFECT. It read ``(OPERATORS, FUNCTIONS, SCALARS)`` -- a hand-list
    # of four sections' worth of table with one missing -- so when ``clock``
    # landed, every one of its thirteen ``yields`` declarations was INERT: this
    # function raised ``KeyError`` on ``isintraday`` and ``is_boolean_tree`` fell
    # to False, which refused a bare ``isintraday`` as a scan while the identical
    # 0/1 shape on a scalar was accepted. Worse, a later engineer who "fixed" the
    # declaration would have changed nothing, because no consumer read the
    # section -- ``lesson_a_measured_knob_is_inert_if_the_consumer_skips_its_stage``.
    # ``SERIES_SECTION`` is deliberately absent from the derivation and that is
    # not a second hand-list: a bar field declares no ``yields`` at all (it is a
    # price, always ``num``), so including it would only ever return the default
    # by a longer route. Everything else that declares names is consulted.
    # ⚰️⚰️ `sections` EXISTS BECAUSE ONE NAME MEANS DIFFERENT THINGS IN
    # DIFFERENT NODES. Unscoped, this walked FUNCTIONS for a name a caller was
    # asking about as a LEAF — so `{"type": "series", "name": "crossOver"}` was
    # answered `bool`, borrowing the declaration of a FUNCTION that node is not
    # calling. The scan gate then stamped that tree **scannable, yields=bool**
    # while `interpret` refused the name outright at `resolve:name`: the member is
    # told the scan will run and every row of the sweep refuses.
    # ⛔ A CALLER THAT KNOWS WHICH SECTIONS ITS NODE MAY NAME MUST SAY SO. The
    # default stays every section, so no existing reader changes behaviour.
    wanted = tuple(sections) if sections is not None else SECTIONS
    for section in (sec for sec in wanted if sec != SERIES_SECTION):
        entry = (m.get(section) or {}).get(name)
        if entry is not None:
            value = entry.get("yields")
            return value if value in YIELDS else YIELDS_DEFAULT
    raise KeyError(name)


#: ⚠️ THE NAME E2's INTERFACE ASKED FOR, BOUND TO THE ONE DECLARATION ABOVE. The
#: draft called this ``domain_of`` and gave it a third spelling of the same three
#: answers (``01`` / ``real`` / ``passthrough``); the design's CORRECTION 2 named
#: the manifest field ``yields`` with ``num`` / ``bool``. Two field names for one
#: fact is the defect both were written to prevent, so the MANIFEST carries one
#: field and this is an ALIAS — the same function object, so the two can never
#: drift and no reader has to know which name its caller used.
domain_of = yields_of


# --------------------------------------------------------------------------- #
# the recurrence, READ from the manifest
# --------------------------------------------------------------------------- #
#
# ⭐ BAR-TO-BAR STATE ADDED NO NODE TYPE. ``accum`` is a ``call`` like any other,
# so ``NODE_TYPES`` is still five and this walker still has five cases. What
# makes it different is DECLARED — ``functions.accum.recurrence`` — rather than
# written into each lane: which argument is the seed, which is the per-bar body,
# which carries the warm-up, and what name the body reads its own past through.
#
# ⛔ SO NEITHER LANE TYPES THE STRING ``self`` OR THE INDEX ``1``. Both read them
# off the entry. A hand-copy would be the second-authority defect, and a silent
# one: a lane that thought the body was argument 2 would evaluate the WARM-UP as
# an expression and the body as a window, and produce a number for both.
#
# ⚠️ ``parse.js`` CARRIES THE SAME THREE, DERIVED THE SAME WAY. That is the point
# — one manifest, two readings, no third list.


def benchmarks(manifest: Optional[Mapping[str, Any]] = None) -> Mapping[str, Any]:
    """The instruments a SCAN may read with `sym`, by ticker.

    ⛔ SCAN POLICY, NOT GRAMMAR — see `closedTable.json::_benchmarks`. The chart
    lane serves any symbol it can fetch; this is the bounded set a universe sweep
    loads once and holds for every row.

    ⚠️ A MAP, NEVER A LIST, and read rather than typed: a second benchmark
    roster somewhere in `api/` would be the copy that goes stale, and the one that
    goes stale is always the one a refusal quotes to a member.
    """
    m = manifest if manifest is not None else TABLE
    section = m.get("_benchmarks_scannable")
    return dict(section) if isinstance(section, Mapping) else {}


def recurrences(manifest: Optional[Mapping[str, Any]] = None) -> Mapping[str, Any]:
    """Every function entry that declares a ``recurrence``, by name.

    A map rather than a name, so a SECOND recurrent entry needs no code change
    anywhere: the walkers ask "does this call declare one", never "is this
    call ``accum``".
    """
    m = manifest if manifest is not None else TABLE
    out = {}
    for name, spec in (m.get(FUNCTIONS_SECTION) or {}).items():
        rec = spec.get("recurrence") if isinstance(spec, Mapping) else None
        if isinstance(rec, Mapping):
            out[name] = rec
    return out


def recurrence_bindings(manifest: Optional[Mapping[str, Any]] = None) -> tuple:
    """The reserved names the bodies bind — the set a scope must refuse to let an
    input shadow. Derived from the entries above, never listed."""
    return tuple(sorted({r["binds"] for r in recurrences(manifest).values()}))


#: The declaration that says an entry is computed over the BAR ARRAY rather than
#: over the columns its arguments name. See ``closedTable.json``'s
#: ``_functions_bar_readers``.
BAR_READS = "bars"


def bar_readers(manifest: Optional[Mapping[str, Any]] = None) -> tuple:
    """Every function entry declaring ``reads: "bars"``, sorted.

    ⭐ THE ``recurrence`` IDIOM, APPLIED TO THE OTHER THING A CALL CAN NEED.
    ``_bind_shipped`` packs bars out of ARGUMENT COLUMNS and therefore fabricates
    ``t`` as a bar index — which is exactly why ``vwap`` was refused for as long
    as this table has existed. An entry declaring this is handed ``interpret``'s
    own bar array instead, so its anchor is a real instant.

    ⛔ DERIVED, NEVER LISTED, and that is not tidiness: both walkers ask *"does
    this entry read the bars"* rather than *"is this call ``vwap``"*, so a third
    such entry needs no change in either lane. ``parse.js::BAR_READERS`` is the
    same read on the same manifest — one declaration, two readings, no third
    list.
    """
    m = manifest if manifest is not None else TABLE
    return tuple(sorted(
        name for name, spec in (m.get(FUNCTIONS_SECTION) or {}).items()
        if isinstance(spec, Mapping) and spec.get("reads") == BAR_READS))


#: The declaration that says an entry's OTHER ``int`` arguments must fit inside
#: the one its ``lookback`` names. ``closedTable.json::_functions_domain`` argues
#: it; this is the key both lanes match on, and its VALUE names which of the
#: entry's own reach declarations supplies the ceiling.
ARG_DOMAIN = "domain"


def arg_domains(manifest: Optional[Mapping[str, Any]] = None) -> Mapping[str, str]:
    """Every function entry declaring an argument domain → the CEILING
    DECLARATION it points at. ``{"macd": "arg2", "ichimokuTenkan": "arg4", ...}``.

    ⭐ THE ``reads: "bars"`` IDIOM, APPLIED TO THE OTHER THING A DECLARATION CAN
    BE WRONG ABOUT. ``lookback: "arg2"`` is a promise about how many bars of
    history an entry needs, and for these six it holds only while the argument it
    names is the LARGEST period in the call — ``macd(close, 26, 12)`` reaches 26
    bars back under a declaration that promised 12, and every line of the
    Ichimoku family starts at the longest of its three periods. The entry says so
    itself; nothing here knows the name ``macd``.

    ⛔ ONE INDIRECTION, NEVER A RE-TYPED SLOT. The value of ``domain`` is the NAME
    of another key on the same entry (``"lookback"``), and what comes back is that
    key's own declaration — so moving an entry's lookback to another slot moves
    its domain with it, and no argument index is written down twice.

    ⛔ THE INDEX IS NOT RESOLVED HERE, AND THAT IS THE SPLIT. ``arg3`` is spelled
    in ONE grammar per lane (``ast_interpret._LOOKBACK_RE`` here,
    ``parse.js::LOOKBACK_RE`` there) and the walker already reads it; resolving it
    a second time in this module would be the fifth hand-written copy of a pattern
    whose fourth branded ADX as repainting in production.
    ``parse.js::argDomainsOf`` answers the same question in the same shape.
    """
    m = manifest if manifest is not None else TABLE
    out = {}
    for name, spec in (m.get(FUNCTIONS_SECTION) or {}).items():
        if not isinstance(spec, Mapping):
            continue
        key = spec.get(ARG_DOMAIN)
        if not isinstance(key, str) or not key:
            continue
        declaration = spec.get(key)
        if isinstance(declaration, str) and declaration:
            out[name] = declaration
    return out


def is_pointwise(spec: Any) -> bool:
    """Does this function read each argument at the bar it writes, and nowhere
    else?

    ⭐ DERIVED FROM THE WINDOW DECLARATION, NEVER FROM A LIST OF NAMES. A
    hand-list of "the pointwise ones" would be a third authority over
    ``lookback`` and it would rot the day a pointwise entry landed — which is
    exactly how a running value would come to read a NaN it was never told
    about. ``lookback: 0``, no ``forward`` and no ``int`` slot IS the definition:
    an entry that reads only bar ``i`` of each argument can be applied one bar at
    a time, which is the only thing a recurrence step loop can do.
    """
    if not isinstance(spec, Mapping):
        return False
    args = spec.get("args")
    return (
        spec.get("lookback") == 0
        and "forward" not in spec
        and isinstance(args, (list, tuple))
        and all(kind == "series" for kind in args)
    )
