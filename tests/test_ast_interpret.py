"""The Python lane's walker — and the equality that makes a user formula alertable.

⭐ THE CONTRACT IS ON THE TABLE, NOT ON EACH FORMULA. A user AST is only a
composition of table entries, so covering EVERY manifest entry plus every
combining rule (NaN propagation, evaluation order, comparison-with-NaN) makes any
composition agree. That is why the totality rails below are DERIVED FROM THE
MANIFEST and never hand-listed: a rail that only checks what somebody remembered
to list is a LIST, not a rail, and DPC's four constants rode outside exactly such
a rail for the rule's entire life.

⚠️ WHAT THIS FILE DOES **NOT** COVER, NAMED SO NOBODY READS IT AS COVERED. The
cross-lane NUMBERS are `tools/ast_conformance.py --check` (17 asts x 579 bars at
rel-tol 1e-9) and the three `ast_*` golden fixtures, which both lanes read. This
file covers the DECISIONS — the shapes and domains a value comparison cannot see.
"""
from __future__ import annotations

import ast as pyast
import io
import json
import math
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

from api.services import ast_interpret, ast_table  # noqa: E402

CORPUS_PATH = ROOT / "tests" / "fixtures" / "ast" / "corpus.json"

#: Eight bars, hand-written, enough for a 3-bar window and a crossing.
BARS = [
    {"t": 1780000000 + i * 300, "o": o, "h": h, "l": low, "c": c, "v": v}
    for i, (o, h, low, c, v) in enumerate([
        (10.0, 11.0, 9.0, 10.0, 100),
        (10.0, 12.0, 9.5, 11.0, 200),
        (11.0, 13.0, 10.5, 12.0, 300),
        (12.0, 12.5, 11.0, 11.0, 400),
        (11.0, 11.5, 10.0, 10.0, 500),
        (10.0, 14.0, 10.0, 14.0, 600),
        (14.0, 14.5, 13.0, 13.0, 700),
        (13.0, 13.5, 12.0, 12.0, 800),
    ])
]

NUM = lambda v: {"type": "num", "value": v}                    # noqa: E731
SER = lambda n: {"type": "series", "name": n}                  # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}  # noqa: E731
CALL = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731
#: ⭐ THE BOUNDED BACKWARD OFFSET. ⚠️ NO `name` — the bar count IS the node,
#: which is the property that makes a computed offset inexpressible.
OFF = lambda v, ch: {"type": "offset", "value": v, "args": [ch]}  # noqa: E731


def run(ast, bars=None, inputs=None):
    return ast_interpret.interpret(ast, BARS if bars is None else bars, inputs)


def load_corpus():
    with io.open(CORPUS_PATH, encoding="utf-8") as fh:
        return json.load(fh)


# ═══════════════════════════════════════════════════════════════════════════ #
# 1. THE MANIFEST IS READ, NOT COPIED
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_python_lane_reads_the_SAME_manifest_file_the_js_lane_imports():
    """⛔ ONE DECLARATION, TWO READERS.

    A hand-copied table in this module would be a second grammar, and the two
    would drift the first time somebody added a function to one — silently,
    because every existing test would stay green. This repo has already paid for
    two vocabularies that looked like one: `williams_r` here is `williamsR`
    there, which is why `_CASE_COLUMNS` exists at all.

    ⚠️ The path is resolved from the MODULE, with an existence assert that NAMES
    the file — the `goldenFixtures.test.js` shape, which throws loudly rather
    than silently finding nothing.
    """
    assert ast_table.MANIFEST_PATH.name == "closedTable.json"
    assert ast_table.MANIFEST_PATH.exists(), (
        f"the closed table is missing at {ast_table.MANIFEST_PATH}. It is committed "
        "under app/, and this lane READS it rather than owning a copy."
    )
    # …and it is the file `parse.js` imports, resolved from the JS module's own
    # directory rather than named twice.
    parse_js = (ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast"
                / "parse.js")
    assert parse_js.exists()
    assert ast_table.MANIFEST_PATH.parent == parse_js.parent, (
        "the two lanes resolve `closedTable.json` in different directories, which "
        "is two files with one name"
    )


def test_load_manifest_really_READS_bytes_and_is_not_a_constant():
    """The reader is a reader: hand it different bytes, get different bytes back.

    ⛔ THE POSITIVE CONTROL FOR "IT READS THE FILE". An equality against today's
    manifest is satisfied by a hand-copy that was correct on the day it was
    typed. This one cannot be: a synthetic manifest with names that exist nowhere
    in this repo comes back exactly as written.
    """
    synthetic = {
        "series": {"zzz_probe_series": {"field": "zzz"}},
        "operators": {"@@": {"arity": 2}},
        "functions": {"zzz_probe_fn": {"args": ["series"], "lookback": 3,
                                       "sentence": "probe {0}"}},
        # ⭐ EVERY DECLARED SECTION IS PART OF THE SHAPE, so the probe carries
        # one of each: `load_manifest` refuses a manifest missing ANY section in
        # `ast_table.SECTIONS`, and a probe that skipped one would be proving the
        # reader reads a document the product could never ship. The `clock`
        # entry joined them with tableVersion 2.
        "clock": {"zzz_probe_clock": {
            "lookback": 0, "yields": "num", "sentence": "the probe clock value"}},
        "scalars": {"zzz_probe_scalar": {
            "source": {"store": "zzz_store", "column": "zzz_probe_scalar"},
            "as_of": {"column": "zzz_dated_by", "grain": "date"},
            "cadence": "hourly", "yields": "num", "sentence": "the probe"}},
    }
    tmp = ROOT / "tests" / "fixtures" / "ast" / "_probe_manifest.json"
    try:
        with io.open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(synthetic, fh)
        got = ast_table.load_manifest(tmp)
        assert set(got["functions"]) == {"zzz_probe_fn"}
        assert ast_table.declared_names(got) == {
            "zzz_probe_series", "zzz_probe_clock", "@@", "zzz_probe_fn",
            "zzz_probe_scalar"}
        # ⭐ AND THE CLOCK IS INSIDE THE BAR FLOOR, NOT BESIDE IT. A clock value
        # varies down the replay series exactly as `close` does, so a bar-corpus
        # case can measure it and the bar corpus therefore OWES it one.
        assert ast_table.bar_names(got) == {
            "zzz_probe_series", "zzz_probe_clock", "@@", "zzz_probe_fn"}
        assert ast_table.clock_names(got) == {"zzz_probe_clock"}
        assert ast_table.series_field("zzz_probe_series", got) == "zzz"
        assert ast_table.scalar_as_of("zzz_probe_scalar", got)["column"] == "zzz_dated_by"
        assert ast_table.yields_of("zzz_probe_scalar", got) == "num"
    finally:
        if tmp.exists():
            tmp.unlink()
    # …and the real table is unmoved by any of that.
    assert "zzz_probe_fn" not in ast_table.TABLE["functions"]


def test_a_missing_manifest_REFUSES_and_names_the_file():
    with pytest.raises(FileNotFoundError, match="closed table is missing"):
        ast_table.load_manifest(ROOT / "tests" / "fixtures" / "ast" / "_nope.json")


def _string_constants(path: pathlib.Path) -> set:
    """Every string that appears as a literal in a module's own source.

    ⛔ AN AST WALK, NEVER A GREP. Phase D Task 1 ran a plain substring grep for
    its own module and got ten matches, EVERY ONE prose in a comment; and this
    file's subject deliberately mentions `close` and `sma` in its docstring. Only
    a `Constant` node is a literal, and only FULL EQUALITY counts, so prose
    cannot satisfy or defeat this.
    """
    with io.open(path, encoding="utf-8") as fh:
        tree = pyast.parse(fh.read())
    return {n.value for n in pyast.walk(tree)
            if isinstance(n, pyast.Constant) and isinstance(n.value, str)}


def test_ast_table_SPELLS_NO_TABLE_NAME_so_it_cannot_be_a_hand_copy():
    """⛔ THE STRUCTURAL HALF: a copy spells the names, a reader does not.

    `test_load_manifest_really_READS_bytes` proves the loader reads. This proves
    the MODULE holds no second vocabulary of its own — not one series name, not
    one operator, not one function. It is the same shape as
    `test_compute_sar_events_DERIVES_from_compute_sar_raw`: a claim about the
    source, made through `ast` so a mention in a comment cannot satisfy it.
    """
    declared = ast_table.declared_names()
    # ⚠️ TWO NUMBERS, NOT ONE, AND BOTH ARE MEASURED. This read `== 31` before
    # the manifest grew a fourth section; a single total would have been "fixed"
    # to 85 with nobody able to see WHICH half moved. 48 is the bar vocabulary
    # (series + operators + functions) and 54 is the scalar vocabulary, which is
    # the numeric-and-boolean subset of the screener's 65 columns.
    #
    # ⭐ 31 -> 48 IS PHASE F, AND THE BAR HALF IS THE ONLY HALF THAT MOVED.
    # Seventeen indicators were declared as functions (11 -> 28), every one of
    # them bound to maths `indicators.js` and `indicator_compute.py` already
    # ship. The scalar half is untouched at 54, which is the whole reason these
    # are two assertions and not one total.
    # ⭐ 48 -> 55 IS THE RECURRENCE PLUS THE PINE PARITY SIX (`rma`, `wma`,
    # `round`, `sign`, `na`, `nz` — the entire manifest half of what 21 real
    # published scripts still refused for). Again the bar
    # half is the only half that moved — it added no node type, no argument kind
    # and no lookback form, which is why `tableVersion` is still 1.
    # `adx` took the bar half 69 -> 70 (2026-08-11): the `lookback` grammar grew
    # a whole multiple of an argument (`2*arg3`), which is the ONLY thing that
    # had been keeping it out — its window is 2 x period and the table could
    # not say so, and UNDER-declaring is the one direction a budget cannot use.
    # ⭐ 54 -> 108 IS EVERY SCALAR BUMP SINCE (Wave-5 Stage B 54->94, Wave-6 T1
    # 94->98, `hvc_52w` 98->99, the seven finviz-parity columns 99->106, and the
    # two per-pattern engine flags `pattern_engine_vcp`/`pattern_engine_flat_base`
    # 106->108 — all on 2026-08-23). 🔴 THIS PAIR SAT AT `54`/`124` THROUGH THE
    # FIRST FEW OF THEM AND WAS RED ON THE BRANCH — which meant the assertion
    # BELOW, the one this test is actually named for, never ran. A vacuity guard
    # that goes stale takes the real check down with it, so the two numbers move
    # with the manifest and the SPLIT is what makes "which half moved" answerable
    # at a glance. The bar half has not moved once across any scalar bump.
    # ⭐ 108 -> 111 (2026-08-25): the three numerics of the 8/24 candle library
    # (`candle_recent_bars_ago`, `avg_body`, `avg_range`) declared; the twelve
    # TEXT labels beside them refused in `_scalars_excluded`. Bar half unmoved.
    # ⭐ 70 -> 83 IS THE `clock` SECTION (tableVersion 2, 2026-08-26) AND IT IS
    # THE FIRST TIME THE BAR HALF MOVED FOR SOMETHING THAT IS NOT A FUNCTION.
    # Thirteen bar-clock values -- the seven ET wall-clock fields, `sessionfirst`,
    # `barindex` and the four timeframe booleans -- declared as a FIFTH section
    # that rides the existing `series` node, so no node type, no persisted key
    # and no `astHash` moved. The scalar half is untouched at 111, which is the
    # whole reason these are two assertions and not one total.
    assert len(ast_table.bar_names()) == 83, len(ast_table.bar_names())
    assert len(ast_table.scalar_names()) == 111, len(ast_table.scalar_names())
    assert len(declared) == 194, f"the table declares {len(declared)} names, not 194"
    leaked = sorted(_string_constants(pathlib.Path(ast_table.__file__)) & declared)
    assert not leaked, (
        f"api/services/ast_table.py spells {leaked} as string literals. This "
        "module must own NO vocabulary — it reads `closedTable.json` and a "
        "hand-copy is the one thing it may never become."
    )


def test_the_hand_copy_probe_can_actually_FIND_a_hand_copy():
    """The positive control. Without it the assertion above is satisfied by a
    detector that returns the empty set for everything."""
    src = (
        'TABLE = {\n'
        '    "series": {"close": {"field": "c"}},\n'
        '    "operators": {"+": {"arity": 2}},\n'
        '    "functions": {"sma": {"args": ["series", "int"]}},\n'
        '}\n'
    )
    tmp = ROOT / "tests" / "fixtures" / "ast" / "_probe_handcopy.py"
    try:
        with io.open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(src)
        found = _string_constants(tmp) & ast_table.declared_names()
    finally:
        if tmp.exists():
            tmp.unlink()
    assert found == {"close", "+", "sma"}, found


# ═══════════════════════════════════════════════════════════════════════════ #
# 2. TOTALITY — DERIVED FROM THE MANIFEST, BOTH DIRECTIONS
# ═══════════════════════════════════════════════════════════════════════════ #

def totality(manifest, implemented, section):
    """(declared-but-unimplemented, implemented-but-undeclared) for one section.

    ⛔ ONE FUNCTION, TWO CALLERS: the real rails below call it with the REAL
    manifest, and `test_a_planted_manifest_entry_lands_RED` calls it with a
    manifest carrying an entry nobody implemented. That second caller is what
    proves the rail can report at all — an equality nobody has ever seen fail is
    an equality nobody knows the meaning of.
    """
    declared = set(manifest[section])
    have = set(implemented)
    return sorted(declared - have), sorted(have - declared)


def test_every_declared_FUNCTION_has_an_implementation_and_vice_versa():
    """⛔ BOTH DIRECTIONS.

    A declared-but-unimplemented name is a formula the builder offers and this
    lane cannot evaluate — the exact bug B5 fixed, where an alert naming a
    JS-only indicator could be STORED and could never FIRE. An
    implemented-but-undeclared one is a callable outside the closed table, which
    is the one thing this phase exists to make impossible.
    """
    # ⭐ WITH EXACTLY ONE KIND OF EXCEPTION, DERIVED FROM THE MANIFEST RATHER
    # THAN LISTED HERE. An entry declaring a `recurrence` is evaluated by the
    # WALKER — its body is a per-bar expression, not a column, so there is
    # nothing for `FN` to hold. An ignore-list here would be a second roster;
    # asking the table means a SECOND recurrent entry needs no edit, and an entry
    # that stopped declaring one lands red with its own name in the message.
    by_walker = sorted(ast_table.recurrences())
    assert by_walker, "the exception must be non-empty or this rail widened for nothing"
    missing, extra = totality(ast_table.TABLE, ast_interpret.FN, "functions")
    assert missing == by_walker, f"declared but not implemented: {missing}"
    assert not extra, f"implemented but not declared: {extra}"
    assert sorted(ast_interpret.FN) == sorted(
        n for n in ast_table.TABLE["functions"] if n not in by_walker)
    # ⛔ AND THE EXCEPTION IS NOT A HOLE: every walker-evaluated entry must still
    # EVALUATE, or "no implementation" would quietly mean "no behaviour".
    for name in by_walker:
        spec = ast_table.TABLE["functions"][name]
        rec = spec["recurrence"]
        args = [
            NUM(2) if i == rec["warmup"]
            else (OP("+", SER(rec["binds"]), NUM(1)) if i == rec["body"] else NUM(0))
            for i in range(len(spec["args"]))
        ]
        col = run(CALL(name, *args))
        assert len(col) == len(BARS), (
            f"{name} is declared, walker-evaluated, and produced nothing")


def test_every_declared_OPERATOR_is_implemented_and_vice_versa():
    """The half a `functions`-only rail misses. The manifest declares fifteen
    operators including `u-` and `?:` — names, not renderings — and an operator
    the walker does not know is `interpret:operator`, not a silent NaN column."""
    missing, extra = totality(
        ast_table.TABLE, ast_interpret.operator_names(), "operators")
    assert not missing, f"declared but not implemented: {missing}"
    assert not extra, f"implemented but not declared: {extra}"


def test_every_declared_SERIES_is_seeded_and_reads_the_DECLARED_bar_field():
    """The third section, and the one where a wrong answer is plausible.

    A series bound to the wrong bar key draws a real line made of the wrong
    numbers — `high` reading `l` is a chart that looks like it works. So the
    field is read out of the manifest and checked against the bar, per name.
    """
    for name in ast_table.TABLE["series"]:
        field = ast_table.series_field(name)
        col = run(SER(name))
        assert len(col) == len(BARS)
        for i, bar in enumerate(BARS):
            assert col[i] == pytest.approx(float(bar[field]), rel=1e-12), (
                f"the series {name!r} does not read the declared field {field!r}")


def test_a_planted_manifest_entry_lands_RED():
    """⭐ THE RAIL IS DERIVED, AND HERE IS THE PROOF.

    A hand-listed rail would be UNMOVED by a manifest entry nobody implemented —
    that is exactly how DPC's four constants rode unpinned. Adding one entry to a
    copy of the real manifest must make the totality rail report it BY NAME, in
    all three sections, without a single edit to the rail.
    """
    for section, planted in (("functions", "rugpull"),
                             ("operators", "@@"),
                             ("series", "insider")):
        fake = {k: (dict(v) if k in ("functions", "operators", "series") else v)
                for k, v in ast_table.TABLE.items()}
        fake[section] = dict(fake[section])
        fake[section][planted] = {"args": [], "lookback": 0, "sentence": "x"}
        implemented = (ast_interpret.FN if section == "functions"
                       else ast_interpret.operator_names() if section == "operators"
                       else ast_table.TABLE["series"])
        missing, extra = totality(fake, implemented, section)
        # ⚠️ THE WALKER-EVALUATED ENTRIES ARE SUBTRACTED, NOT IGNORED. `accum` is
        # legitimately "declared and not in FN", so leaving it in would make this
        # rail assert a list with a permanent resident — and the next entry that
        # went missing for a BAD reason would hide inside that expectation.
        missing = [m for m in missing if m not in ast_table.recurrences()]
        assert missing == [planted], (
            f"a planted {section} entry {planted!r} did NOT land red — the "
            f"totality rail is a hand-list, not a derivation (got {missing!r})")
        assert not extra


def test_the_node_types_are_DERIVED_from_the_committed_corpus():
    """`NODE_TYPES` is four names in this module; here is where they come from.

    The union of every `type` across every committed corpus tree IS the canonical
    vocabulary, and it is non-vacuous because the corpus covers all four. A fifth
    type arriving on the wire therefore cannot be absorbed here quietly.
    """
    seen = set()
    stack = [c["ast"] for c in load_corpus()["cases"]]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        seen.add(node.get("type"))
        for value in node.values():
            if isinstance(value, (dict, list)):
                stack.append(value)
    assert seen == set(ast_interpret.NODE_TYPES)
    import ast_conformance                                    # the instrument agrees
    assert set(ast_conformance.CANONICAL_NODE_TYPES) == set(ast_interpret.NODE_TYPES)


# ═══════════════════════════════════════════════════════════════════════════ #
# 3. NAME RESOLUTION — A MEMBERSHIP TEST, NEVER `getattr`
# ═══════════════════════════════════════════════════════════════════════════ #

def test_a_name_outside_the_table_RAISES_and_says_what_is_legal():
    with pytest.raises(ast_interpret.TableRefusal, match="unknown name") as exc:
        run(SER("__import__"))
    assert exc.value.guard == "resolve:name"
    assert "close" in str(exc.value), "the refusal does not say what IS legal"


#: ⭐ LANE-NATIVE ESCAPE PROBES — the Python analogue of `escapes.json`'s JS
#: reaches, and the reason they are needed is written in
#: `tools/ast_conformance.py::LANE_NATIVE_PROBES`: `toString` and `globalThis`
#: are the WRONG LANGUAGE here, so a corpus of them proves nothing about this
#: walker. These are the equivalent reaches in the lane that actually runs.
#:
#: The first block is `dict`'s own attribute surface — what `getattr(scope, name)`
#: answers where `name in scope` answers nothing. The second is `builtins`, which
#: is Python's `globalThis`.
LANE_NATIVE_ESCAPES = [
    "keys", "items", "values", "get", "pop", "update", "setdefault", "clear",
    "__class__", "__init__", "__getitem__", "__dict__", "__doc__",
    "eval", "exec", "compile", "globals", "locals", "getattr", "__builtins__",
]


@pytest.mark.parametrize("name", LANE_NATIVE_ESCAPES)
def test_every_lane_native_reach_is_refused_by_name(name):
    """⛔ THE CASE THAT KILLS `getattr`.

    A walker resolving identifiers with `getattr(scope, name)` answers a BOUND
    METHOD for `keys`, `items` and `get`, and a TYPE for `__class__` — and
    `close.__class__.__base__.__subclasses__` is Python's
    `constructor.constructor`, the property chain that ends at arbitrary code.
    `name in scope` on a plain dict answers none of them.

    ⚠️ AND IT IS A CLOSED TABLE, NOT A DENYLIST. Nothing below is blocked BY
    NAME; they are refused because they are not in the table, which is the same
    reason `rugpull` is. A denylist would be a list of what somebody remembered.
    """
    with pytest.raises(ast_interpret.TableRefusal, match="unknown name") as exc:
        run(SER(name))
    assert exc.value.guard == "resolve:name"


def test_open_resolves_to_the_SERIES_and_never_to_the_builtin():
    """⭐ THE LOOKUP-ORDER PROPERTY A BLOCKLIST WOULD GET BACKWARDS.

    Task 2's census recorded that `open` was MISSING from the reachable-builtins
    list precisely because it is SHADOWED by the `open` series. A denylist of bad
    names gets that exactly wrong: it would block the series and let the builtin
    through the day the series was renamed. Here the table decides, so `open` is
    a column of bar opens and `open` the builtin is unreachable — not because it
    was blocked, but because it was never in the table.
    """
    col = run(SER("open"))
    assert col == [float(b["o"]) for b in BARS]
    assert ast_table.series_field("open") == "o"


def test_a_function_name_is_not_a_series_name_and_vice_versa():
    """TWO DICTIONARIES, NOT ONE UNION. A walker consulting a union would accept
    `close(3)` — calling a price series — and `sma` alone as a value."""
    with pytest.raises(ast_interpret.TableRefusal, match="unknown function") as exc:
        run(CALL("close", NUM(3)))
    assert exc.value.guard == "resolve:function"
    with pytest.raises(ast_interpret.TableRefusal, match="unknown name") as exc:
        run(SER("sma"))
    assert exc.value.guard == "resolve:name"


def test_an_input_may_not_shadow_a_table_name_and_that_is_NOT_a_table_refusal():
    """A wiring defect is not a rejected formula.

    A definition whose input is called `close` would change what every formula on
    it means. That is the developer's mistake, not the user's, so it raises a
    plain `ValueError` — a chip tooltip reading "your formula was rejected" would
    be telling the user a story about somebody else's bug.
    """
    with pytest.raises(ValueError, match="shadows a table name"):
        run(SER("close"), inputs={"close": 5})
    with pytest.raises(ValueError, match="shadows a table name"):
        run(SER("close"), inputs={"sma": 5})
    assert not isinstance(ValueError(), ast_interpret.TableRefusal)


def test_an_input_that_is_not_a_finite_number_is_NOT_SEEDED_AT_ALL():
    """…so naming it is a loud refusal rather than a column of nothing."""
    assert run(SER("mult"), inputs={"mult": 3})[0] == 3.0
    for bad in (float("nan"), float("inf"), "3", None, [1, 2], len, True):
        with pytest.raises(ast_interpret.TableRefusal, match="unknown name"):
            run(SER("mult"), inputs={"mult": bad})


# ═══════════════════════════════════════════════════════════════════════════ #
# 4. THE FOUR NODE TYPES
# ═══════════════════════════════════════════════════════════════════════════ #

@pytest.mark.parametrize("node, why", [
    ({"type": "Identifier", "name": "close"}, "a jsep Identifier"),
    ({"type": "MemberExpression", "object": {}, "property": {}}, "a jsep member read"),
    ({"type": "ThisExpression"}, "`this`"),
    ({"type": "ArrayExpression", "elements": []}, "an array literal"),
    ({"type": "bool", "value": True}, "a boolean node type that does not exist"),
    ({"type": None}, "no type at all"),
    ("close", "a bare string"),
    ([{"type": "num", "value": 1}], "a list where a node belongs"),
    (None, "None"),
])
def test_a_node_outside_the_four_canonical_types_REFUSES(node, why):
    """⛔ A FIFTH TYPE MEANS THE TWO LANES DISAGREE ABOUT THE WIRE SHAPE, and a
    walker that guessed would be running a tree nobody authored. Refused rather
    than returning NaN, because a blank line reads exactly like a warmup."""
    with pytest.raises(ast_interpret.TableRefusal, match="not a canonical node") as exc:
        run(node)
    assert exc.value.guard == "interpret:node", why


def test_an_op_or_call_node_without_an_args_LIST_refuses():
    for kind in ("op", "call"):
        with pytest.raises(ast_interpret.TableRefusal, match="not a canonical node"):
            run({"type": kind, "name": "+", "args": None})


def test_a_num_node_must_carry_a_FINITE_number_and_never_a_bool():
    for bad in (float("nan"), float("inf"), "20", None, True, False):
        with pytest.raises(ast_interpret.TableRefusal, match="not a canonical node"):
            run(NUM(bad))
    assert run(NUM(20))[0] == 20.0


def test_an_operator_outside_the_table_refuses_with_its_OWN_guard():
    with pytest.raises(ast_interpret.TableRefusal, match="unknown operator") as exc:
        run(OP("**", SER("close"), NUM(2)))
    assert exc.value.guard == "interpret:operator"


def test_the_six_refusal_sentences_are_PAIRWISE_DISJOINT():
    """Two gates sharing a phrase let a `raises(match=…)` pass with the safety
    deleted, and that has happened in this repo (Phase C Task 9's M1)."""
    sentences = list(ast_interpret.REFUSALS.values())
    assert len(set(sentences)) == len(sentences)
    for a in sentences:
        for b in sentences:
            if a is not b:
                assert a not in b, f"{a!r} is a substring of {b!r}"


def test_every_declared_guard_is_REACHABLE_and_every_reachable_guard_is_DECLARED():
    """⛔ BOTH DIRECTIONS. A guard nobody can fire is a comment; a guard that
    fires without a declared sentence is a refusal with no read-back."""
    triggers = {
        "resolve:name": lambda: run(SER("nope")),
        "resolve:function": lambda: run(CALL("rugpull", SER("close"))),
        "resolve:arity": lambda: run(CALL("sma", SER("close"))),
        "resolve:window": lambda: run(CALL("sma", SER("close"), SER("close"))),
        "interpret:node": lambda: run({"type": "Identifier", "name": "close"}),
        "interpret:operator": lambda: run(OP("**", NUM(1), NUM(2))),
        # ⭐ HAND-BUILT, BECAUSE NO PARSER CAN PRODUCE IT. A negative offset is
        # refused at the JS parse door, so the only way this guard is ever
        # reached is a STORED tree — which is exactly the input it exists for.
        "interpret:offset": lambda: run(OFF(-26, SER("close"))),
        # ⭐ THE RECURRENCE PAIR. The binding read where nothing binds it is the
        # mistake a translator makes; the step ceiling is the one a member makes
        # by asking for a long warm-up over a long chart. Both names are READ off
        # the manifest, never typed.
        "interpret:recurrence": lambda: run(
            OP("+", SER(ast_table.recurrences()["accum"]["binds"]), NUM(1))),
        "interpret:steps": lambda: ast_interpret.interpret(
            CALL("accum", NUM(0),
                 OP("+", SER(ast_table.recurrences()["accum"]["binds"]), NUM(1)),
                 NUM(500)),
            # ⛔ ITS OWN BARS, NOT `BARS`. This is the ONE guard in this table
            # whose trigger depends on how many bars the caller brought — which
            # is the whole reason it could not live with the static budgets.
            [{"o": 1.0, "h": 2.0, "l": 0.5, "c": 1.0 + (i % 7) * 0.1, "v": 1000.0}
             for i in range(ast_interpret.MAX_RECURRENCE_STEPS // 500 + 10)],
            {}),
    }
    assert sorted(triggers) == sorted(ast_interpret.REFUSALS)
    for guard, fire in triggers.items():
        with pytest.raises(ast_interpret.TableRefusal) as exc:
            fire()
        assert exc.value.guard == guard, f"{guard} is not reachable by its trigger"
        assert ast_interpret.REFUSALS[guard] in str(exc.value)


def test_the_two_lanes_refuse_with_THE_SAME_SIX_SENTENCES():
    """⭐ THE READ-BACK IS A CROSS-LANE CONTRACT, NOT A PER-LANE STRING.

    The user is told why their formula was rejected. If the two lanes phrase the
    same refusal differently, the same formula gets two different explanations
    depending on which lane happened to evaluate it — and the escape census
    recognises refusals BY GUARD, so a lane that renamed one would still look
    closed. `interpret.js`'s `REFUSALS` is read out of the shipped module through
    node, never re-typed here and never grepped.

    ⚠️ A HARD FAILURE, NOT A SKIP, IF NODE IS MISSING. `--record` and `--check`
    already require node; a skipped cross-lane rail is how a rail rots.
    """
    import ast_conformance
    driver = (
        "import { register } from 'node:module'\n"
        "import { pathToFileURL } from 'node:url'\n"
        "register('data:text/javascript,"
        "import%20%7B%20readFile%20%7D%20from%20%27node%3Afs/promises%27%3B"
        "export%20async%20function%20load(u%2Cc%2Cn)%7Bif(u.endsWith(%27.json%27))"
        "%7Bconst%20s%3Dawait%20readFile(new%20URL(u)%2C%27utf8%27)%3B"
        "return%7Bformat%3A%27module%27%2CshortCircuit%3Atrue%2C"
        "source%3A%60export%20default%20%24%7Bs%7D%60%7D%7Dreturn%20n(u%2Cc)%7D')\n"
        f"const m = await import(pathToFileURL({json.dumps(ast_conformance.JS_INTERPRET_PATH)}).href)\n"
        "process.stdout.write(JSON.stringify(m.REFUSALS))\n"
    )
    proc = subprocess.run(
        [ast_conformance._node(), "--input-type=module", "-e", driver],
        cwd=str(ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace")
    assert proc.returncode == 0, (
        "the JS lane's REFUSALS could not be read; this rail is a HARD failure "
        f"rather than a skip. stderr:\n{(proc.stderr or '')[-1500:]}")
    js = json.loads(proc.stdout)
    assert js == dict(ast_interpret.REFUSALS), (
        "the two lanes refuse the same guard with different words:\n"
        f"  js: {js}\n  py: {dict(ast_interpret.REFUSALS)}")


# ═══════════════════════════════════════════════════════════════════════════ #
# 5. THE BOOLEAN DECISION — DELIBERATELY UNLIKE BOTH LANGUAGES
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_logical_operators_yield_0_or_1_and_NEVER_a_VALUE():
    """⭐ `1 && 2` IS 1, NOT 2, AND THAT IS THE COST, STATED.

    JS's value-returning `&&`/`||` and Python's are deliberately not implemented:
    they would put a non-{0,1} number into a column the alert grammar, the
    screener and `validateEventColumns` all read as a signal. Pinned as numbers
    because the divergence is invisible in the shape.
    """
    assert run(OP("&&", NUM(1), NUM(2)))[0] == 1.0
    assert run(OP("&&", NUM(1), NUM(0)))[0] == 0.0
    assert run(OP("||", NUM(0), NUM(5)))[0] == 1.0
    assert run(OP("||", NUM(0), NUM(0)))[0] == 0.0
    assert run(OP("!", NUM(5)))[0] == 0.0
    assert run(OP("!", NUM(0)))[0] == 1.0
    assert run(OP("!", NUM(-3)))[0] == 0.0
    # …and that is NOT what either language would have done on its own.
    assert (1 and 2) == 2
    assert (0 or 5) == 5


def _nan_col_ast():
    """A column that is NaN everywhere: 200 bars of history over 8 bars of tape."""
    return CALL("sma", SER("close"), NUM(200))


def test_NaN_PROPAGATES_through_and_or_not_and_the_ternary():
    """⛔ THE OPPOSITE OF BOTH LANGUAGES' DEFAULTS, WHICH ALREADY DISAGREE.

    `!NaN` is `true` in JS and `not nan` is `False` in Python — matching either
    would have guaranteed a divergence with the other. The `{0,1,NaN}` domain
    distinguishes "it did not happen" from "it is not computable yet", and a
    warmup that collapsed to 0 would be a signal a user can arm an alert on.
    """
    nan_col = _nan_col_ast()
    for node in (OP("&&", nan_col, NUM(1)),
                 OP("&&", NUM(1), nan_col),
                 OP("||", nan_col, NUM(1)),
                 OP("||", NUM(0), nan_col),
                 OP("!", nan_col),
                 OP("?:", nan_col, NUM(1), NUM(2))):
        assert all(v is None for v in run(node)), node["name"]
    # The Python default this deliberately does NOT reproduce.
    assert (not float("nan")) is False


def test_a_comparison_against_NaN_is_ZERO_not_NaN():
    """The other half of the same decision, and the one place the two languages
    agree by luck (`NaN > x` is false in both) — so it is pinned, not assumed."""
    nan_col = _nan_col_ast()
    for op in (">", "<", ">=", "<=", "==", "!="):
        col = run(OP(op, SER("close"), nan_col))
        assert col == [0.0] * len(BARS), op
        assert all(type(v) is float for v in col)
    assert (float("nan") > 1) is False


def test_truthiness_is_x_not_equal_to_zero_and_a_negative_is_TRUE():
    assert run(OP("?:", NUM(-1), NUM(7), NUM(9)))[0] == 7.0
    assert run(OP("?:", NUM(0), NUM(7), NUM(9)))[0] == 9.0
    assert run(OP("?:", NUM(0.5), NUM(7), NUM(9)))[0] == 7.0


# ═══════════════════════════════════════════════════════════════════════════ #
# 6. THE {0, 1, NaN} DOMAIN — ASSERTED, NOT INHERITED FROM A CONTAINER
# ═══════════════════════════════════════════════════════════════════════════ #

def assert_event_domain(col, label):
    """⛔ THE DOMAIN, ASSERTED BY TYPE — because no VALUE check can catch a bool.

    `True == 1.0` is true in Python, `True in (0.0, 1.0)` is true, and
    `isinstance(True, int)` is true. So a membership test, an equality and an
    `isinstance` all pass a boolean straight through, and it would JSON-encode as
    `true` where the JS lane emits `1`.

    The JS lane is protected from the same mistake for free: a `Float64Array`
    CANNOT hold a boolean, which is why Task 4 measured its own "return
    true/false instead of 1/0" mutation as a SEMANTIC NO-OP. This lane has no
    such container, so the type is the assertion.
    """
    for i, v in enumerate(col):
        assert v is None or type(v) is float, (
            f"{label}[{i}] is a {type(v).__name__} ({v!r}), not a float or None")
        assert v is None or v in (0.0, 1.0), f"{label}[{i}] = {v!r}"


def test_crossOver_and_crossUnder_are_0_1_or_None_BY_TYPE():
    for name in ("crossOver", "crossUnder"):
        col = run(CALL(name, SER("close"), CALL("sma", SER("close"), NUM(3))))
        assert_event_domain(col, name)
        assert col[0] is None, "bar 0 has no previous bar and is not an event"
        assert 1.0 in col, f"{name} never fires on these bars — the case pins nothing"


def test_every_comparison_and_logical_column_is_in_the_domain_BY_TYPE():
    for node in (OP(">", SER("close"), SER("open")),
                 OP("<=", SER("close"), SER("high")),
                 OP("==", SER("close"), SER("open")),
                 OP("&&", OP(">", SER("close"), SER("open")),
                    OP("<", SER("low"), SER("high"))),
                 OP("||", NUM(0), OP(">", SER("close"), NUM(11))),
                 OP("!", OP(">", SER("close"), SER("open")))):
        assert_event_domain(run(node), node["name"])


def test_the_domain_assertion_CATCHES_A_PLANTED_BOOL_that_every_value_check_misses():
    """⭐ THE POSITIVE CONTROL, AND IT IS THE POINT OF THE WHOLE SECTION.

    Without it, `assert_event_domain` is satisfied by an assertion that cannot
    fail. Here a hand-planted column of Python booleans is shown to pass every
    value-level check a reviewer would reach for — and to be caught only by the
    type.
    """
    planted = [None, True, False, True]
    # Every value-level check a reviewer would write passes this column…
    assert all(v is None or v in (0.0, 1.0) for v in planted)
    assert all(v is None or v == 0.0 or v == 1.0 for v in planted)
    assert all(v is None or isinstance(v, (int, float)) for v in planted)
    # …and the type check is the one that does not.
    with pytest.raises(AssertionError, match="is a bool"):
        assert_event_domain(planted, "planted")


def test_a_bool_reaching_a_column_RAISES_rather_than_coercing_to_1():
    """The implementation's own half of the same rule. `float(True)` is `1.0`, so
    a silent coercion here would make the planted-bool control above unreachable
    from real code."""
    with pytest.raises(TypeError, match="a bool reached a numeric column"):
        ast_interpret._to_column([True, False], 2)
    with pytest.raises(TypeError, match="a bool reached a numeric column"):
        ast_interpret._number(True)
    # …and a bar field that is a bool is NOT a price of one.
    col = ast_interpret.interpret(SER("close"), [{"t": 0, "c": True}])
    assert col == [None]


# ═══════════════════════════════════════════════════════════════════════════ #
# 7. ALIGNMENT, NaN, AND THE DIVISION THAT RAISES IN ONLY ONE LANGUAGE
# ═══════════════════════════════════════════════════════════════════════════ #

def test_every_column_is_exactly_len_bars_even_for_a_SCALAR_formula():
    """⭐ `bars.length`, ALWAYS, AND NEVER THE VALUE'S OWN LENGTH. A scalar
    formula is the case that proves it, because its value has no length at all."""
    assert run(NUM(20)) == [20.0] * len(BARS)
    assert len(run(OP("*", NUM(20), NUM(2)))) == len(BARS)
    assert run(OP("*", NUM(20), NUM(2)))[0] == 40.0
    assert run(SER("close"), bars=[]) == []


def test_the_warmup_pad_is_None_and_is_NEVER_a_fabricated_zero():
    col = run(CALL("sma", SER("close"), NUM(3)))
    assert col[:2] == [None, None]
    assert col[2] == pytest.approx((10.0 + 11.0 + 12.0) / 3, rel=1e-12)
    # …and it stays None through arithmetic, which is the M4 shape: a lane that
    # read None as 0.0 would fabricate a 200-bar warmup of real-looking numbers.
    diff = run(OP("-", CALL("sma", SER("close"), NUM(3)), _nan_col_ast()))
    assert all(v is None for v in diff)


def test_a_missing_bar_field_is_a_hole_and_not_a_price_of_zero():
    bars = [{"t": 0, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1},
            {"t": 1, "o": 1.0, "h": 1.0, "l": 1.0, "v": 1},        # no `c`
            {"t": 2, "o": 1.0, "h": 1.0, "l": 1.0, "c": 3.0, "v": 1}]
    assert run(SER("close"), bars=bars) == [1.0, None, 3.0]


def test_division_by_zero_answers_the_IEEE_HOLE_and_never_raises():
    """⛔ THE SHARPEST CROSS-LANE DIVERGENCE IN THE TABLE.

    `1 / 0` is `Infinity` in JS and a `ZeroDivisionError` in Python; `0 / 0` is
    `NaN` there and the same exception here. A lane that let the exception escape
    would turn one bar of a user's formula into a 500. Both lanes answer the same
    hole, and `ast_nan_propagation.json` is the fixture that pins it on real tape.
    """
    with pytest.raises(ZeroDivisionError):
        1.0 / 0.0                                   # the control: Python's own `/`
    assert run(OP("/", NUM(1), NUM(0)))[0] is None
    assert run(OP("/", NUM(-1), NUM(0)))[0] is None
    assert run(OP("/", NUM(0), NUM(0)))[0] is None
    col = run(OP("/", SER("close"), CALL("change", SER("close"))))
    assert col[0] is None                            # `change` has no previous bar
    assert col[1] == pytest.approx(11.0 / 1.0, rel=1e-12)


def test_min_and_max_PROPAGATE_NaN_rather_than_meeting_it_first():
    """JS's `Math.max(NaN, x)` is NaN; Python's bare `max` returns whichever it
    MEETS FIRST — a real divergence, killed in both lanes by spelling the rule."""
    nan_col = _nan_col_ast()
    for name in ("min", "max"):
        assert all(v is None for v in run(CALL(name, SER("close"), nan_col)))
        assert all(v is None for v in run(CALL(name, nan_col, SER("close"))))
    # The Python behaviour this deliberately does NOT reproduce.
    assert max(float("nan"), 5.0) != max(5.0, float("nan"))


def test_stdev_is_the_POPULATION_divisor_and_the_two_are_DISTINGUISHABLE_here():
    """A population/sample disagreement has the same tree, the same column length
    and the same pad, and shows up only in the number — so the number is pinned
    against the alternative it must not be."""
    col = run(CALL("stdev", SER("close"), NUM(4)))
    closes = [10.0, 11.0, 12.0, 11.0]
    mean = sum(closes) / 4
    population = math.sqrt(sum((c - mean) ** 2 for c in closes) / 4)
    sample = math.sqrt(sum((c - mean) ** 2 for c in closes) / 3)
    assert col[3] == pytest.approx(population, rel=1e-12)
    assert abs(population - sample) > 1e-3, "the two divisors agree — this pins nothing"


def test_ema_RESTARTS_its_seed_after_a_hole_and_never_averages_bars_it_never_saw():
    bars = [dict(b) for b in BARS]
    del bars[2]["c"]                              # one hole in the middle
    col = run(CALL("ema", SER("close"), NUM(2)), bars=bars)
    assert col[2] is None, "the hole itself must stay a hole"
    assert col[3] is None, "the seed did not restart — it carried state across a hole"
    assert col[4] == pytest.approx((11.0 + 10.0) / 2, rel=1e-12)


# ═══════════════════════════════════════════════════════════════════════════ #
# 8. THE MEASUREMENTS A BUDGET WILL THRESHOLD
# ═══════════════════════════════════════════════════════════════════════════ #

@pytest.mark.parametrize("ast, expected", [
    (SER("close"), 0),
    (NUM(1), 0),
    (CALL("sma", SER("close"), NUM(20)), 20),
    (OP("-", CALL("sma", SER("close"), NUM(20)),
        CALL("sma", SER("close"), NUM(200))), 200),
    (CALL("sma", CALL("sma", SER("close"), NUM(5000)), NUM(5000)), 10000),
    (CALL("sma", SER("close"), NUM(100000)), 100000),
    (CALL("crossOver", CALL("ema", SER("close"), NUM(9)),
          CALL("ema", SER("close"), NUM(21))), 22),
])
def test_max_lookback_is_the_SUM_ALONG_THE_PATH(ast, expected):
    """⭐ THE CASE A PER-ARGUMENT CHECK MISSES. `sma(sma(close, 5000), 5000)`
    needs 10,000 bars and neither 5,000 alone exceeds anything —
    `escapes.json::nested_lookback` exists for precisely that."""
    assert ast_interpret.max_lookback(ast) == expected


def test_the_measurements_are_ITERATIVE_and_survive_a_tree_that_kills_the_walker():
    """⚠️ THE ASYMMETRY IS DELIBERATE. A budget guard runs BEFORE the walker and
    must not need the walker to be safe first, so `node_count` and `max_lookback`
    are iterative while `interpret` is a plain recursive walk. `parse.js` made its
    forbidden-node scan iterative for exactly this reason.

    🧨 TIGHTENED 2026-08-08 BY THE BUDGET TASK, AND THE OLD ASSERTION IS RECORDED
    RATHER THAN REMOVED. This used to end `with pytest.raises(RecursionError):
    run(deep)` — "the recursive walker really does die on it, and that is an
    ESCAPE". It does not die on it any more, because `interpret` now runs
    `check_budget` FIRST and 8,001 nodes is refused against a cap of 128 before a
    single frame of the walker is entered. That is the guard working; the line
    would have been a gate forbidding its own fix.

    ⛔ THE CLAIM THE OLD LINE CARRIED IS NOT DROPPED — IT MOVED, because it can no
    longer be made here. A canonical tree's DEPTH never exceeds its node count, so
    with `maxNodes` at 128 the overflow is UNREACHABLE through `interpret`: the
    relabelling defect could be introduced and never observed. `test_ast_budget.py
    ::test_a_stack_overflow_raises_RecursionError_and_NEVER_a_TableRefusal` lowers
    the recursion limit to make it observable again, and
    `::test_neither_the_budget_nor_the_interpreter_contains_a_single_try` walks
    both modules' ASTs so the catch cannot be added quietly.
    """
    deep = NUM(1)
    for _ in range(4000):
        deep = OP("+", NUM(1), deep)
    assert ast_interpret.node_count(deep) == 8001
    assert ast_interpret.max_lookback(deep) == 0
    # …and the walker is never entered: the BUDGET refuses first, by its own name.
    with pytest.raises(ast_interpret.TableRefusal,
                       match="exceeds the node budget") as exc:
        run(deep)
    assert exc.value.guard == "budget:nodes"


def test_a_window_must_be_a_WHOLE_NUMBER_LITERAL_of_at_least_one():
    """⭐ NOT A CONVENIENCE — IT IS WHAT MAKES `max_lookback` A TREE SUM. A window
    that is an input name or a computed column is not statically decidable, and
    the moment lookback stops being decidable statically the repaint linter stops
    being a tree sum and becomes a dataflow analysis.

    ⏳ COST, HANDED FORWARD: `sma(close, period)` — a window from a declared
    INPUT — is unexpressible in v1. Re-opening it belongs with the repaint-claim
    owner and the manifest owner together, per `_no_offset_reopened_by`.
    """
    for bad in (SER("close"), NUM(0), NUM(-5), NUM(2.5),
                OP("*", NUM(10), NUM(2)), CALL("abs", SER("close"))):
        with pytest.raises(ast_interpret.TableRefusal,
                           match="a window must be a whole-number literal") as exc:
            run(CALL("sma", SER("close"), bad))
        assert exc.value.guard == "resolve:window"
    # ⏳ AND HERE IS THAT COST, MEASURED RATHER THAN DESCRIBED: `period` is a
    # legitimately declared, legitimately seeded input — `sma(close, period)` is
    # still refused, because `max_lookback` takes no inputs and must answer
    # without evaluating anything.
    assert run(SER("period"), inputs={"period": 20})[0] == 20.0
    with pytest.raises(ast_interpret.TableRefusal, match="a window must be") as exc:
        run(CALL("sma", SER("close"), SER("period")), inputs={"period": 20})
    assert exc.value.guard == "resolve:window"
    with pytest.raises(ast_interpret.TableRefusal, match="a window must be"):
        ast_interpret.max_lookback(CALL("sma", SER("close"), SER("period")))
    # …while the literal form is fine and is the only form v1 offers.
    assert len(run(CALL("sma", SER("close"), NUM(3)))) == len(BARS)


def test_wrong_arity_refuses_rather_than_producing_a_silent_all_NaN_column():
    """In JS a missing argument is `undefined` and `sma(close)` returns a column
    of NaN; in Python it is a `TypeError`. That is a cross-lane divergence
    produced by the ABSENCE of a check — the shape no golden fixture can carry."""
    for node in (CALL("sma", SER("close")),
                 CALL("sma", SER("close"), NUM(3), NUM(4)),
                 CALL("abs", SER("close"), SER("open"))):
        with pytest.raises(ast_interpret.TableRefusal,
                           match="wrong number of arguments") as exc:
            run(node)
        assert exc.value.guard == "resolve:arity"


# ═══════════════════════════════════════════════════════════════════════════ #
# 9. PURITY
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_walker_is_PURE_and_mutates_neither_bars_nor_inputs_nor_its_own_output():
    """The conformance log is an equality against a lane in another language, so
    anything stateful makes the two disagree for a reason neither is wrong
    about — and that failure looks exactly like a real divergence."""
    ast = CALL("sma", SER("close"), NUM(3))
    before_bars = json.dumps(BARS, sort_keys=True)
    inputs = {"mult": 2}
    before_inputs = json.dumps(inputs, sort_keys=True)
    a = ast_interpret.interpret(ast, BARS, inputs)
    run(SER("close"), bars=[{"t": 0, "c": 999.0}])       # a different series between
    b = ast_interpret.interpret(ast, BARS, inputs)
    assert a == b
    a[3] = -1.0                                          # mutating a result…
    assert ast_interpret.interpret(ast, BARS, inputs) == b   # …changes nothing
    assert json.dumps(BARS, sort_keys=True) == before_bars
    assert json.dumps(inputs, sort_keys=True) == before_inputs


# ═══════════════════════════════════════════════════════════════════════════ #
# 10. TWO FINDINGS ABOUT THE INSTRUMENT, PINNED SO THEY CANNOT GO QUIET
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_js_driver_carries_the_WARMUP_NULL_and_never_a_fabricated_ZERO():
    """🔴 THE REGRESSION RAIL FOR A DEFECT THAT WOULD HAVE FROZEN ITSELF IN.

    `_JS_DRIVER` used to read `interpret(...).map(v => … null …)`. TWO things go
    wrong with `.map` on a `Float64Array`:

      * it builds ANOTHER `Float64Array`, so the `null` returned for a warmup bar
        is COERCED TO 0 — the pad becomes a fabricated zero, which is a number a
        user can arm an alert on; and
      * `JSON.stringify` of a TypedArray emits an OBJECT, not an array.

    Had the log been recorded through it, every warmup bar would have frozen as
    `0` against this lane's `None` — a permanent, self-consistent disagreement.
    `Array.from(col, fn)` is the fix. This asserts the OUTCOME rather than the
    spelling: bar 0 of a 3-bar mean must come back as `None`, and the column must
    be a list.
    """
    import ast_conformance
    bars = [{"t": i, "o": 1.0, "h": 1.0, "l": 1.0, "c": float(i + 1), "v": 10}
            for i in range(5)]
    case = {"id": "warmup_probe",
            "ast": CALL("sma", SER("close"), NUM(3))}
    js = ast_conformance.run_js([case], bars)["warmup_probe"]
    assert isinstance(js, list), f"the JS lane returned a {type(js).__name__}"
    assert js[0] is None and js[1] is None, f"the warmup pad came back as {js[:2]}"
    assert js[2] == pytest.approx(2.0, rel=1e-12)
    # …and the Python lane agrees, which is the whole point.
    assert ast_interpret.interpret(case["ast"], bars) == js


def test_the_escape_census_ZERO_is_ATTRIBUTABLE_and_the_reconciliation_says_so():
    """🧨 THE FUSE FIRED, AND THIS IS THE TIGHTENING IT ASKED FOR — 2026-08-08.

    WHAT IT SAID WHEN IT WAS WRITTEN (2026-08-07): `--escapes` read CLOSED, exit
    0, and the zero was REAL for the pipeline it measured but was NOT evidence
    for any individual case's claim. The census offered each case's JSEP tree
    straight to `interpret`; this lane deliberately has no parser, so all fifteen
    were refused at the ROOT by the canonical-shape check before a name, an arity,
    a window or a budget was ever consulted. The three `budget:*` cases read
    EXACTLY the same as they would with no budget in the product at all, and a
    CLOSED that did not say so would have handed the budget task a green that
    started green. Its instruction was explicit: *"when a real budget guard lands
    and starts firing on these cases, this goes red BY NAME with the numbers in
    hand, and the correct edit is to tighten it — not to delete it."*

    IT WENT RED BY NAME on the commit that landed the guard. The fix was to the
    PIPELINE, not to the report: `escape_census` now runs `canonicalise` (the one
    parser, in the one lane that has it) and then `interpret`, so every case meets
    the door its claim is about. What follows is the tightened assertion — the
    same subject, the opposite expectation, and strictly more of it.
    """
    import ast_conformance
    res = ast_conformance.escape_census(unguarded=False)
    assert res["guard"] == "both", res["guard"]
    assert res["escaped"] == [], res["escaped"]

    # ⭐ THE HEADLINE: declared == fired, for EVERY refusal, with no exceptions.
    assert res["wrong_door"] == [], res["wrong_door"]
    assert res["lane_disagreements"] == [], res["lane_disagreements"]

    # …and a FLOOR, because `wrong_door == []` is satisfied by `refused == 0` —
    # exactly the way `escaped == parsed` is satisfied by `0 == 0`. Task 3 added
    # `parsed >= 15` for that reason and this zero has the same shape.
    assert res["refused"] == res["parsed"] >= 16, res

    # …and the doors are pinned BY NAME rather than counted, so a case that
    # quietly moved from one guard to another fails here and not silently.
    fired = {r["id"]: (r["fired"], r["stage"]) for r in res["refusal_guards"]}
    assert fired["too_many_nodes"] == ("budget:nodes", "interpret")
    assert fired["lookback_too_deep"] == ("budget:lookback", "interpret")
    assert fired["nested_lookback"] == ("budget:lookback", "interpret")
    assert fired["too_many_series"] == ("budget:series", "interpret")
    assert fired["global_lookup"] == ("resolve:name", "interpret")
    assert fired["arity_wrong"] == ("resolve:arity", "interpret")
    assert fired["member_access"] == ("canonicalise:member", "canonicalise")

    # ⛔ AND THE DOORS ARE PLURAL. The whole defect was ONE door answering for
    # every case; a fix that merely re-pointed that single door at `budget:nodes`
    # would satisfy every equality above except this one.
    assert len({guard for guard, _ in fired.values()}) >= 6, sorted(fired.values())
    assert {stage for _, stage in fired.values()} == {"canonicalise", "interpret"}


def test_the_shared_TABLE_cannot_be_edited_by_a_caller():
    """A mutable module-level table is a second grammar waiting to happen: one
    caller's write would change what every formula in the process means."""
    with pytest.raises(TypeError):
        ast_table.TABLE["functions"]["rugpull"] = {}
    with pytest.raises(TypeError):
        ast_table.TABLE["series"]["close"]["field"] = "v"


# ═══════════════════════════════════════════════════════════════════════════ #
# THE BOUNDED BACKWARD OFFSET — the Python lane
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_left_edge_of_an_offset_is_NOT_COMPUTABLE_never_zero():
    """🔴 THE DEFINING RULE OF THIS ENGINE, IN THE LANE THAT MUST MATCH.

    `close[3]` on bars 0, 1 and 2 has no bar to read. ⛔ NOT `0.0` and ⛔ NOT the
    first bar's close — a clamped edge makes `close > close[3]` a confident
    answer on bar 1, which is the exact defect class `unresolved_lookback` was
    written against.
    """
    col = run(OFF(3, SER("close")))
    assert len(col) == len(BARS)
    for i in (0, 1, 2):
        # ⚠️ `is None`, WHICH IS THIS LANE'S SPELLING OF NOT-COMPUTABLE — NaN
        # inside the walker, `None` on the wire (see `interpret`'s last line).
        assert col[i] is None, f"bar {i} must be not-computable, got {col[i]!r}"
    assert col[3] == BARS[0]["c"]
    assert col[7] == BARS[4]["c"]
    # said as two assertions, because they are two different wrong answers
    assert col[0] != 0.0
    assert col[0] != BARS[0]["c"]


def test_a_zero_offset_shifts_nothing_and_pads_nothing():
    """The JS parse door FOLDS `x[0]` away, but a STORED zero-bar offset is a
    legal tree and both lanes must agree it is the identity."""
    assert run(OFF(0, SER("close"))) == run(SER("close"))


def test_max_lookback_stays_a_TREE_SUM_through_an_offset():
    """⭐ `value + max_lookback(child)`, composing under nesting.

    ⚠️ THE NUMBERS ARE THE MANIFEST'S CONVENTION, NOT ARITHMETIC THIS TEST
    CHOSE: `sma(x, 20)` declares `lookback: "arg1"`, so its own window is 20 and
    the offset ADDS to it.
    """
    ml = ast_interpret.max_lookback
    assert ml(OFF(3, SER("close"))) == 3
    assert ml(OFF(0, SER("close"))) == 0
    assert ml(CALL("sma", OFF(2, SER("close")), NUM(20))) == 22
    assert ml(OFF(2, CALL("sma", SER("close"), NUM(20)))) == 22
    # MAX along an operator, SUM along a path
    assert ml(OP(">", OFF(1, SER("close")), OFF(3, SER("close")))) == 3
    assert ml(CALL("sma", OFF(2, CALL("ema", OFF(1, SER("close")), NUM(5))), NUM(20))) == 28


def test_the_offset_ceiling_IS_the_existing_lookback_budget():
    """⛔ NO SECOND LIMIT.

    `close[100000]` is a well-formed backward offset — the parse door has no
    ceiling of its own on purpose — and what refuses it is `budget:lookback`,
    because an offset is counted by the same tree sum `sma(close, 600)` is. Two
    ways of asking for 600 bars of warm-up meet ONE cap, which is the only
    arrangement in which they cannot drift apart. And `effective_budget` clamps
    DOWNWARD ONLY, so a stored blob cannot raise it.
    """
    from api.services import ast_budget as _ab
    _cap = _ab.DEFAULT_BUDGET["maxLookback"]
    assert ast_interpret.max_lookback(OFF(100000, SER("close"))) == 100000
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        run(OFF(100000, SER("close")))
    assert exc.value.guard == "budget:lookback"
    # ⚰️ THIS WAS `OFF(400) + sma(…, 200)` — a hand-typed 600 chosen to clear a cap
    # of 550. When the cap moved to hold one ET session the pair stopped tripping
    # it and this line went GREEN while measuring nothing, which is the very
    # second-authority defect the note below already records one boundary later.
    # The offset and the window are now derived FROM the cap, and each half is
    # asserted to be UNDER it so the composition is what refuses.
    _off, _win = _cap - 100, 200
    assert _off + _win > _cap and _off <= _cap and _win <= _cap
    with pytest.raises(ast_interpret.TableRefusal) as deep:
        run(CALL("sma", OFF(_off, SER("close")), NUM(_win)))
    assert deep.value.guard == "budget:lookback"
    # ⛔ THE BOUNDARY IS DERIVED, NOT TYPED. This read `499`/`501` against a
    # hard-typed 500 until 2026-08-23, when the JS lane raised the cap to 550
    # and the Python twin followed: a typed boundary silently stops testing
    # the ceiling the moment the ceiling moves, which is the same second-
    # authority-over-one-value defect this whole file exists to refuse.
    from api.services import ast_budget
    cap = ast_budget.DEFAULT_BUDGET["maxLookback"]
    run(OFF(cap - 1, SER("close")))                   # one under the cap draws
    with pytest.raises(ast_interpret.TableRefusal) as over:
        run(OFF(cap + 1, SER("close")))               # one over refuses
    assert over.value.guard == "budget:lookback"


@pytest.mark.parametrize("bad", [-1, -26, 1.5, "3", None, True])
def test_a_STORED_offset_that_is_not_a_backward_whole_number_REFUSES(bad):
    """⛔ A REFUSAL, NOT A CLAMP.

    A stored tree is user data that never met a parser. Clamping `-26` to `0`
    would silently turn a FORWARD reference into `close` and draw a confident
    wrong column — and `True` is here because `isinstance(True, int)` is True and
    a bool would otherwise read as an offset of one bar.
    """
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        run(OFF(bad, SER("close")))
    assert exc.value.guard == "interpret:offset"


@pytest.mark.parametrize("args", [[], [SER("close"), NUM(1)]])
def test_a_STORED_offset_with_the_wrong_child_count_REFUSES(args):
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        run({"type": "offset", "value": 1, "args": args})
    assert exc.value.guard == "interpret:offset"


def test_the_child_of_an_offset_is_ANY_expression():
    """🔴 MEASURED, NOT ASSUMED. A study of 54 real Pine scripts found the
    offset thing is most often a CALL RESULT or a named intermediate
    (`ta.rsi(close,14)[1]`), not a bar field — so a series-only offset would
    cover roughly half of real usage at exactly the same `max_lookback` cost."""
    shifted = run(OFF(2, CALL("sma", SER("close"), NUM(3))))
    plain = run(CALL("sma", SER("close"), NUM(3)))
    assert shifted[0] is None
    assert shifted[6] == plain[4]

    cond = run(OFF(1, OP(">", SER("close"), SER("open"))))
    assert cond[0] is None
    assert all(v in (0.0, 1.0) for v in cond[1:])

    # a per-symbol SCALAR broadcasts and THEN shifts — ⛔ the pad is NOT the
    # scalar, because "yesterday's market cap" is a value this table does not hold
    scal = ast_interpret.interpret(OFF(1, SER("market_cap")), BARS, {}, None,
                                   {"market_cap": 1e9})
    assert scal[0] is None
    assert scal[1] == 1e9


def test_NaN_propagates_through_the_shift_rather_than_being_filled():
    """A shift that dropped NaNs would make a 3-bar mean look available 3 bars
    early, which is the same lie one door along."""
    col = run(OFF(2, CALL("sma", SER("close"), NUM(3))))
    for i in range(4):
        assert col[i] is None, f"bar {i}"
    assert col[4] is not None


def test_the_offset_counts_toward_node_count_and_series_refs():
    from api.services import ast_budget
    assert ast_interpret.node_count(OFF(1, SER("close"))) == 2
    # ⭐ THE BUDGET'S THIRD MEASUREMENT REACHES THROUGH THE OFFSET because the
    # child rides `args`, which every walker in this repo already descends.
    #
    # ⛔ THE TWO NAMES MUST DIFFER, AND THAT IS NOT COSMETIC. This read
    # `close - close[1]` and expected 2 while the measurement counted
    # OCCURRENCES. It counts DISTINCT reads now, and `close - close[1]` is ONE
    # distinct name — so the old tree would have passed at 1 for a walker that
    # descended into the offset AND for one that ignored the subtree entirely.
    # The claim is "it reaches through", so the child has to be a name that is
    # only reachable THROUGH it.
    assert ast_budget.series_refs(OP("-", SER("high"), OFF(1, SER("close")))) == 2
    # …and the control: without reaching through, this is 1.
    assert ast_budget.series_refs(OFF(1, SER("close"))) == 1
    assert ast_budget.series_refs(OP("-", SER("close"), OFF(1, SER("close")))) == 1


def test_unresolved_lookback_counts_the_offset_too():
    """The guard that stops `close > close[3]` being answered on a 2-bar series
    reads the SAME `max_lookback` the budget and the linter do."""
    assert ast_interpret.unresolved_lookback(OFF(3, SER("close")), BARS[:2]) == 1
    assert ast_interpret.unresolved_lookback(OFF(3, SER("close")), BARS) == 0
