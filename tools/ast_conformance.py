#!/usr/bin/env python3
"""AST conformance -- the instrument Phase D measures itself with.

STOP: `--record` IS ONE-SHOT. Its output is COMMITTED and it is the oracle.
Re-running it after a change re-records whatever the code now does and converts a
real regression into a green build -- the same trap
`tests/fixtures/indicators/_generate.py`, `tests/fixtures/_gen_alert_baseline.py`
and `tools/alert_replay.py` are all written under.

    python tools/ast_conformance.py --record                 # once, when BOTH lanes exist (Task 5)
    python tools/ast_conformance.py --check                  # the gate
    python tools/ast_conformance.py --escapes                # the reachability census
    python tools/ast_conformance.py --escapes --unguarded    # THE POSITIVE CONTROL
    python tools/ast_conformance.py --coverage               # the manifest totality rail

NOTE: stdout is reconfigured to UTF-8 before anything prints. The box default is
cp1252 and it killed a sibling harness's own `--help`. This file is additionally
written ASCII-only so the class cannot fire at all -- two belts, because the
failure mode is "the harness dies mid-run and leaves a mutation applied".

WHAT THIS FILE IS FOR
---------------------
Phase D's output is a formula the user wrote. Neither B's pixel gate nor C's fire
log covers it: `tools/chart_parity.py` renders COMMITTED cases, and a
user-authored definition exists in no committed base at all. So D names two
measurables this file owns.

  PART 1 -- THE CONFORMANCE LOG. Two lanes, one number, an equality at rel-tol
  1e-9 per (ast_id x bar_index) over the frozen `intraday5m` series, recorded as
  a per-ast sha256 with the VALUES INSIDE THE HASHED TEXT. C Task 2 wrote a 42 MB
  raw log and replaced it with digests for size; the note it wrote is the
  load-bearing one -- a digest over (ast_id, bar_index) alone would report a
  CHANGED NUMBER as no change at all.

  PART 2 -- THE REACHABILITY CENSUS. Arbitrary user input reaches a compute path
  for the first time in this phase. "The table is closed" is exactly the shape of
  claim that has been vacuous twenty distinct ways on this branch, so it is
  measured, not asserted, and the measurement REFUSES A ZERO THAT HAS NO CONTROL.

WHAT THIS HARNESS DERIVES FROM THE THING IT JUDGES -- AND WHAT THAT BLINDS IT TO
--------------------------------------------------------------------------------
A replay that derives its clock from the thing under test is blind to that thing:
`tools/alert_replay.py --repaint` cannot see `bar_close_epoch` being wrong by 30
minutes because `make_closed_evaluate` derives `now_epoch` from `bar_close_epoch`
itself -- 1.38 million passing fires all agreeing with a clock they inherited from
the subject. So this file states its own inheritances up front:

  1. `run_js` / `run_py` IMPORT the interpreters they compare. The cross-lane
     equality therefore cannot see a shared misconception both lanes read out of
     `closedTable.json` -- two lanes agreeing on a WRONG table agree perfectly.
     What covers that is the golden fixtures (Task 5's three), not this file.
  2. The guarded census recognises a refusal by the interpreter's OWN exception
     type. It is blind to a guard that raises the right type for the wrong reason;
     what narrows that is the GUARD RECONCILIATION -- every refusal's `.guard` is
     compared to the guard the case DECLARES, and a mismatch is a hard finding
     rather than a footnote. It caught a real one: for a whole day every case was
     refused by `interpret:node` and the census read a perfectly clean zero.
  2b. THE GUARDED CENSUS NEEDS THE JS LANE, AND THAT IS A DEPENDENCY WORTH NAMING.
     `canonicalise` is the first door a formula meets and there is exactly one
     parser (decision D-A1), in JS. A census that skipped it would be measuring
     half the pipeline -- which is precisely the defect above. So the guarded run
     shells out to node, and REFUSES (`LaneUnavailable`) rather than falling back
     when it cannot. The UNGUARDED control needs nothing but this file, so the
     positive control stays alive when the subject is broken.
  3. The UNGUARDED walker in this file is written HERE. It is not the interpreter
     Tasks 4/5 will write. So today's non-zero proves that THE CORPUS CAN REPORT
     NON-ZERO -- it proves nothing about the future interpreter's internals. That
     is precisely the claim required (a corpus where nothing can escape measures
     nothing) and it is bounded to exactly that.
  4. The corpus's `ast` is HAND-WRITTEN, not parsed. This file therefore cannot
     see a `parse(source) != ast` fork. Task 3 owes that rail.
  5. Bars come from `alert_replay.load_fixture`, which re-checks the recorded
     sha256 of the SHARED parity series. That is an independent digest over a file
     three lanes read, so it is a strength -- but if that digest is wrong, every
     number here is wrong with it.

Produces: `load_corpus()`, `load_escapes()`, `load_manifest()`, `names_in(ast)`,
`assert_corpus_covers_the_table(manifest, corpus)`, `ast_digest(ast_id, rows)`,
`run_js(cases, bars)`, `run_py(cases, bars)`, `run_js_escapes(cases, bars)`,
`compare_lanes(js, py)`, `escape_census(*, unguarded)`.
"""
from __future__ import annotations

import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import argparse  # noqa: E402
import builtins  # noqa: E402
import hashlib  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
from typing import Any, Callable, Iterable, Optional  # noqa: E402

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

FIXTURE_DIR = os.path.join(ROOT, "tests", "fixtures", "ast")
CORPUS_PATH = os.path.join(FIXTURE_DIR, "corpus.json")
ESCAPES_PATH = os.path.join(FIXTURE_DIR, "escapes.json")
LOG_PATH = os.path.join(FIXTURE_DIR, "conformance_log.json")

MANIFEST_PATH = os.path.join(
    ROOT, "app", "src", "components", "chart", "engine", "ast", "closedTable.json")
JS_INTERPRET_PATH = os.path.join(
    ROOT, "app", "src", "components", "chart", "engine", "ast", "interpret.js")
#: The ONLY parser. `canonicalise` is the first door a user's formula meets, and
#: the Python lane deliberately has none (decision D-A1) -- so the census cannot
#: measure the parse->canonical door without running this file.
JS_PARSE_PATH = os.path.join(
    ROOT, "app", "src", "components", "chart", "engine", "ast", "parse.js")
PY_INTERPRET_MODULE = "api.services.ast_interpret"

REL_TOL = 1e-9

#: The canonical persisted node vocabulary. Task 3's `canonicalise` produces
#: exactly these four and no others; the corpus is written in them.
CANONICAL_NODE_TYPES = ("num", "series", "op", "call")

#: LANE-NATIVE ESCAPE PROBES -- the control that keeps "it errored" from reading
#: as "it was safe". The must-refuse corpus names JS reaches (`toString`,
#: `globalThis`). A naive PYTHON walker does not resolve those, and an
#: AttributeError is not a table saying no -- it is the wrong language. These are
#: the equivalent reaches in the lane this census actually runs in, and every one
#: of them is a callable that ends the process's integrity.
LANE_NATIVE_PROBES = ("eval", "exec", "__import__", "open", "compile")


class TableRefusal(Exception):
    """The closed table saying no.

    THE ONLY THING THAT COUNTS AS A REFUSAL. An `AttributeError`, a `TypeError`,
    a `KeyError` or a `RecursionError` is the LANGUAGE declining, incidentally,
    for this input -- a different input reaches a value where that one did not.
    Counting an incidental error as a refusal is how a census reports a closed
    table over a walker that has no table at all.

    Both interpreters (Tasks 4 and 5) must raise this type, or a type this file
    can recognise, for every refusal. That is the contract; see the runbook.
    """


class LaneUnavailable(Exception):
    """A lane that cannot be measured REFUSES; it never reports zero.

    `rs_line_spy_only` raises `PaneLayoutAlertError` rather than reporting a
    vacuous 0 px, and that is the shape. A `run_js` that returned `{}` because
    `interpret.js` does not exist would make every downstream equality a
    statement about nothing, and it would keep making it after the file appeared
    and got renamed.
    """


class CensusVacuous(Exception):
    """A zero with no positive control behind it.

    C's repaint oracle had to read NON-ZERO on the unmodified tree. This one has
    to read ZERO on the guarded interpreter -- so a zero here proves NOTHING on
    its own, and the run aborts unless the SAME corpus through the UNGUARDED
    interpreter reads non-zero.
    """


# --------------------------------------------------------------------------- #
# fixtures
# --------------------------------------------------------------------------- #

def _read_json(path: str) -> dict:
    # io.open(..., encoding='utf-8') ALWAYS. A bare `open()` decodes as cp1252 on
    # this box and it killed a `json.load` while the plan was being written.
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_corpus(path: str = CORPUS_PATH) -> dict:
    """The committed AST corpus, with every generated tree materialised."""
    doc = _read_json(path)
    for case in doc["cases"]:
        if "ast" not in case and case.get("astFrom"):
            case["ast"] = generate_ast(case["astFrom"])
    return doc


def load_escapes(path: str = ESCAPES_PATH) -> dict:
    """The must-refuse corpus, with every generated tree materialised."""
    doc = _read_json(path)
    for case in doc["cases"]:
        if "ast" not in case and case.get("astFrom"):
            case["ast"] = generate_ast(case["astFrom"])
    return doc


def load_manifest(path: str = MANIFEST_PATH) -> Optional[dict]:
    """`closedTable.json`, or None while Task 3 has not written it yet.

    Returning None rather than raising is deliberate: the coverage rail is ARMED
    AND SKIPPED until the manifest exists (Task 1 armed the ledger anchor the
    same way), and a rail that raises here would make every other gate in this
    file unreachable for the whole of Tasks 2 and 3.
    """
    if not os.path.exists(path):
        return None
    return _read_json(path)


def generate_ast(spec: str) -> dict:
    """Materialise a tree too large to hand-write.

    A generated SHAPE is not a generated ORACLE. `gen:nest(4000)` builds a chain
    of 4,000 `+` nodes; what that tree must DO is still hand-declared in
    `escapes.json` ("exceeds the node budget"), so nothing here derives an
    expectation from an implementation.
    """
    if spec.startswith("gen:nest(") and spec.endswith(")"):
        n = int(spec[len("gen:nest("):-1])
        node: dict = {"type": "Literal", "value": 1, "raw": "1"}
        for _ in range(n):
            node = {"type": "BinaryExpression", "operator": "+",
                    "left": {"type": "Literal", "value": 1, "raw": "1"},
                    "right": node}
        return node
    if spec.startswith("gen:seriesChain(") and spec.endswith(")"):
        # ⭐ THE NAMES COME OUT OF THE MANIFEST, NOT OUT OF THIS FILE. A corpus
        # case that hand-typed `close` would keep generating a tree of UNKNOWN
        # names on the day a series is renamed -- and an unknown name is refused
        # by `resolve:name`, at a different door, which would silently convert
        # this case's claim into somebody else's.
        n = int(spec[len("gen:seriesChain("):-1])
        manifest = load_manifest()
        if manifest is None:
            raise ValueError(
                "gen:seriesChain needs the manifest to name its series, and "
                f"{os.path.relpath(MANIFEST_PATH, ROOT)} does not exist.")
        names = sorted(manifest["series"])
        assert names, "the manifest declares no series"
        ident = lambda i: {"type": "Identifier", "name": names[i % len(names)]}  # noqa: E731
        node = ident(0)
        for i in range(1, n):
            node = {"type": "BinaryExpression", "operator": "+",
                    "left": node, "right": ident(i)}
        return node
    raise ValueError(f"unknown AST generator spec: {spec!r}")


def corpus_bars(doc: Optional[dict] = None) -> list[dict]:
    """The frozen bars the corpus is measured against.

    The corpus DECLARES its series as `<file>#<fixture>` and this resolves that
    declaration through `alert_replay.load_fixture`, which re-checks the recorded
    sha256 of `app/src/pages/parityBars/intraday5m.json`. So the compute oracle,
    the pixel gate, the alert replay and the AST conformance log are provably ONE
    series -- not four copies that agreed on the day somebody made them. The
    fixture NAME is derived from the corpus string, never typed here.
    """
    doc = doc or load_corpus()
    ref = doc["bars"]
    if "#" not in ref:
        raise ValueError(f"corpus `bars` must be '<path>#<fixture>', got {ref!r}")
    rel, name = ref.split("#", 1)
    import alert_replay as ar  # local: keeps `--help` free of any other module

    expected = os.path.normpath(os.path.join(ROOT, rel.replace("/", os.sep)))
    if os.path.normpath(ar.BARS_PATH) != expected:
        raise AssertionError(
            f"the corpus names {rel} but alert_replay reads {ar.BARS_PATH}. "
            "Two paths here means two series, and the whole point of naming the "
            "file in the corpus is that there is exactly one.")
    return ar.load_fixture(name)["bars"]


# --------------------------------------------------------------------------- #
# the coverage rail -- derived from the manifest, NEVER hand-listed
# --------------------------------------------------------------------------- #

def names_in(ast: Any) -> set:
    """Every table name a canonical tree references.

    Iterative on purpose: `gen:nest(4000)` is 8,001 nodes deep and a recursive
    walk over it dies inside the rail rather than inside the subject.
    """
    found: set = set()
    stack = [ast]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        name = node.get("name")
        if isinstance(name, str):
            found.add(name)
        for value in node.values():
            if isinstance(value, (dict, list)):
                stack.append(value)
    return found


def assert_corpus_covers_the_table(manifest: dict, corpus: dict) -> set:
    """THE FLOOR IS DERIVED FROM THE MANIFEST, NEVER HAND-LISTED.

    DPC's four constants rode outside `test_all_constants_match_owner_spec` for
    the rule's entire life because that rail was a LIST of what somebody
    remembered: `DPC_LOOKBACK 10 -> 999` left the file `5 passed rc=0`. A coverage
    claim derived from its own subject cannot rot that way.

    Returns the covered set so a caller can print it; raises AssertionError
    naming every uncovered entry.
    """
    declared = (set(manifest["functions"])
                | set(manifest["operators"])
                | set(manifest["series"]))
    used: set = set()
    for case in corpus["cases"]:
        used |= names_in(case["ast"])
    missing = sorted(declared - used)
    assert not missing, (
        f"{len(missing)} table entries have NO corpus coverage: {missing}. The "
        "conformance log pins nothing about them, so the two lanes may already "
        "disagree on them and every gate would stay green."
    )
    stray = sorted(used - declared)
    assert not stray, (
        f"{len(stray)} corpus names are NOT in the table: {stray}. A corpus case "
        "calling something the manifest does not declare is measuring an "
        "interpreter feature nobody declared, which is the opposite of a closed "
        "table."
    )
    return declared


# --------------------------------------------------------------------------- #
# the digest
# --------------------------------------------------------------------------- #

_FIELD_SEP = "\x1f"
_ROW_SEP = "\x1e"


def ast_digest(ast_id: str, rows: Iterable[Iterable[Any]]) -> str:
    """THE VALUE IS INSIDE THE HASHED TEXT, ON PURPOSE.

    C Task 2 wrote a 42 MB raw log and replaced it with per-alert digests for
    size -- and the note it wrote is the load-bearing one: a digest that hashed
    only (bar_index, triggered) would report a CHANGED NUMBER as no change at all.

    `repr` rather than `str` so 1.0 and 1 do not collide, and so NaN and None are
    distinguishable. Separators are unit/record separators, NEVER NUL: a sibling
    harness held two literal NUL bytes where a space belonged and its first
    comparison disagreed for a reason internal to the test.
    """
    h = hashlib.sha256()
    h.update(ast_id.encode("utf-8"))
    h.update(_ROW_SEP.encode("utf-8"))
    for row in rows:
        h.update(_FIELD_SEP.join(repr(x) for x in row).encode("utf-8"))
        h.update(_ROW_SEP.encode("utf-8"))
    return h.hexdigest()


# --------------------------------------------------------------------------- #
# the two lanes
# --------------------------------------------------------------------------- #

#: ⭐ THE JSON-IMPORT SHIM, AND IT EXISTS SO NO OTHER TASK'S FILE HAS TO CHANGE.
#:
#: `interpret.js` imports `parse.js`, which does
#: `import TABLE_JSON from './closedTable.json'`. Under Node >= 22 that is a hard
#: `TypeError: needs an import attribute of "type: json"` — vite resolves it, a
#: bare `node` does not, and this driver is a bare `node`. The fix everybody
#: reaches for first is `with { type: 'json' }` in `parse.js`; that file is owned
#: by the parser task and the manifest is owned by nobody in this phase, so the
#: shim lives HERE instead, where it is the harness's own problem.
#:
#: It is a module customisation hook: a `.json` URL is loaded as an ES module
#: whose default export is the parsed document, which is byte-for-byte what the
#: attribute form would have produced. `shortCircuit: true` skips Node's default
#: loader, which is where the attribute check lives.
#:
#: ⚠️ IT IS SCOPED TO `.json` AND NOTHING ELSE. A hook that rewrote arbitrary
#: sources would make this lane run something other than the shipped file, and the
#: whole point of the lane is that it runs the shipped file.
_JS_JSON_HOOK = r"""
import { readFile } from 'node:fs/promises'

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${source}\n` }
  }
  return nextLoad(url, context)
}
"""

_JS_DRIVER = r"""
// ONE process for the whole corpus. Seven cases would be seven node boots for
// no reason, and each boot is ~40 ms of nothing.
//
// The payload arrives on STDIN. It is NEVER a `-e` string: a `-t` containing a
// double quote SPLIT under cmd.exe and selected TEN tests on this branch, and a
// single-quoted one selected NOTHING and reported passed=None. Every case in
// this corpus is a formula, so every case is exactly the input that trap eats.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

// The JSON shim, registered BEFORE the interpreter is imported. See
// `_JS_JSON_HOOK` for why it is here rather than in `parse.js`.
register('./jsonhook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const mod = await import(pathToFileURL(payload.interpreter).href)
const interpret = mod.interpret || mod.default
if (typeof interpret !== 'function') {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: 'interpret.js exports no `interpret` function',
  }))
  process.exit(3)
}

// ⛔ `Array.from`, NEVER `col.map`. `interpret` returns a `Float64Array`, and
// TWO separate things go wrong with `.map` on one:
//   1. `Float64Array.prototype.map` builds ANOTHER Float64Array, so the `null`
//      this callback returns for a warmup bar is COERCED TO 0 — the pad becomes
//      a fabricated zero, which is a number a user can arm an alert on, and the
//      Python lane's `None` would then read as a real disagreement;
//   2. `JSON.stringify` of a TypedArray emits an OBJECT (`{"0":…,"1":…}`), not an
//      array, so `compare_lanes` would be handed a shape it cannot compare.
// `Array.from(col, fn)` produces a plain Array and keeps the null.
const out = {}
for (const c of payload.cases) {
  out[c.id] = Array.from(
    interpret(c.ast, payload.bars),
    (v) => (v === null || v === undefined || Number.isNaN(v) ? null : v))
}
process.stdout.write(JSON.stringify({ ok: true, columns: out }))
"""


#: ⭐ THE ESCAPE DRIVER, AND IT RUNS THE WHOLE SHIPPED PIPELINE RATHER THAN HALF
#: OF IT. This is the fix for the defect Task 5 measured and refused to ship a
#: green over: the census used to hand each case's JSEP tree straight to
#: `interpret`, and the Python lane has no parser, so EVERY case was refused at
#: the root by `interpret:node` -- including the three `budget:*` ones, which read
#: identically with no budget in the product at all.
#:
#: A user's formula travels `jsep` -> `canonicalise` -> `interpret`. The corpus
#: holds the jsep tree, so this driver picks it up at the SECOND door and carries
#: it through the third. Each case then meets the door its claim is about:
#: `canonicalise:*` cases die in `parse.js`, `resolve:*` and `budget:*` cases
#: reach `interpret.js` and die there.
#:
#: ⚠️ IT REPORTS THE CANONICAL TREE BACK, AS A FLAT POST-ORDER ARRAY. That tree
#: is what the Python lane interprets, so BOTH lanes walk the same artifact and
#: their refusals can be required to agree -- the refusal-side twin of the 1e-9
#: value equality.
#:
#: ⛔ FLAT, AND THAT IS MEASURED RATHER THAN TIDY. The first draft shipped the
#: NESTED tree and node died: `RangeError: Maximum call stack size exceeded`
#: inside `JSON.stringify`, which is recursive, on the corpus's 4,000-deep
#: `too_many_nodes` case. Python cannot receive it nested either -- `json.loads`
#: recurses in C and CPython's C-recursion limit is not raisable from
#: `setrecursionlimit`. So the wire form is an array of `{t, n|v, a:[indices]}`
#: in post-order (root LAST), built iteratively at both ends. `_rebuild_canonical`
#: cross-checks `node_count(rebuilt) == len(flat)`, so a decoder that dropped or
#: duplicated a node cannot pass silently.
_JS_ESCAPE_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./jsonhook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const parse = await import(pathToFileURL(payload.parser).href)
const interp = await import(pathToFileURL(payload.interpreter).href)
for (const [mod, name] of [[parse, 'canonicalise'], [interp, 'interpret']]) {
  if (typeof mod[name] !== 'function') {
    process.stdout.write(JSON.stringify({ ok: false, error: `no \`${name}\` export` }))
    process.exit(3)
  }
}

const describe = (e) => `${e && e.name ? e.name : 'Error'}: ${e && e.message ? e.message : String(e)}`.slice(0, 200)

// ⛔ ITERATIVE POST-ORDER. `JSON.stringify` is recursive and dies on the 4,000-
// deep corpus case; so would any recursive flattener written to replace it.
function flatten(root) {
  const nodes = []
  const index = new Map()
  const stack = [[root, false]]
  while (stack.length) {
    const [n, done] = stack.pop()
    if (n.type === 'num' || n.type === 'series') {
      index.set(n, nodes.length)
      nodes.push(n.type === 'num' ? { t: 'num', v: n.value } : { t: 'series', n: n.name })
      continue
    }
    if (!done) {
      stack.push([n, true])
      const args = n.args || []
      for (let i = args.length - 1; i >= 0; i--) stack.push([args[i], false])
      continue
    }
    index.set(n, nodes.length)
    nodes.push({ t: n.type, n: n.name, a: (n.args || []).map((x) => index.get(x)) })
  }
  return nodes
}

const out = {}
for (const c of payload.cases) {
  let ast
  try {
    ast = parse.canonicalise(c.jsep)
  } catch (e) {
    // ⛔ `instanceof` ON THE MODULE'S OWN CLASS, never a name check. The census
    // recognises a refusal BY TYPE, and a look-alike carrying `name =
    // 'TableRefusal'` is precisely the "right type for the wrong reason"
    // blindness this instrument declared about itself.
    out[c.id] = (e instanceof parse.TableRefusal)
      ? { stage: 'canonicalise', outcome: 'refused', guard: e.guard, message: String(e.message) }
      : { stage: 'canonicalise', outcome: 'error', error: describe(e) }
    continue
  }
  const flat = flatten(ast)
  try {
    interp.interpret(ast, payload.bars, {})
    out[c.id] = { stage: 'interpret', outcome: 'value', flat }
  } catch (e) {
    out[c.id] = (e instanceof interp.TableRefusal)
      ? { stage: 'interpret', outcome: 'refused', guard: e.guard, message: String(e.message), flat }
      : { stage: 'interpret', outcome: 'error', error: describe(e), flat }
  }
}
process.stdout.write(JSON.stringify({ ok: true, results: out }))
"""


def _rebuild_canonical(flat: list) -> Any:
    """A flat post-order array back into the canonical tree. ITERATIVE.

    The root is the LAST entry, and every `a` index points strictly backwards, so
    one forward pass builds the whole tree with no recursion at either end.
    """
    built: list = []
    for row in flat:
        kind = row["t"]
        if kind == "num":
            built.append({"type": "num", "value": row["v"]})
        elif kind == "series":
            built.append({"type": "series", "name": row["n"]})
        else:
            built.append({"type": kind, "name": row["n"],
                          "args": [built[i] for i in row["a"]]})
    if not built:
        raise LaneUnavailable("the JS lane sent an EMPTY canonical tree")
    root = built[-1]
    # ⭐ THE DECODER'S OWN NON-VACUITY CHECK, against the SUBJECT's counter rather
    # than against itself. A decoder that dropped a subtree would hand this lane a
    # SMALLER tree -- which for the budget cases is the difference between a
    # refusal and a value, in the direction that reads as safety.
    mod = __import__(PY_INTERPRET_MODULE, fromlist=["node_count"])
    counted = getattr(mod, "node_count")(root)
    if counted != len(flat):
        raise LaneUnavailable(
            f"the canonical tree lost nodes crossing the lane boundary: the JS "
            f"lane sent {len(flat)} and this lane counts {counted}.")
    return root


def _node_run(driver_source: str, payload: dict) -> dict:
    """Run ONE node process over `driver_source` with `payload` on STDIN.

    ARGV AS A LIST, shell=False, and the payload goes in on STDIN -- never in a
    `-e` string: a `-t` containing a double quote SPLIT under cmd.exe and
    selected TEN tests on this branch.

    The reader is pinned `encoding='utf-8', errors='replace'`: without it Python
    decodes the child as cp1252 and one box-drawing character raises
    UnicodeDecodeError inside the reader thread, stdout comes back None, and the
    verdict is a TypeError rather than a result.
    """
    tmpdir = tempfile.mkdtemp(prefix="ast_conformance_")
    driver = os.path.join(tmpdir, "driver.mjs")
    hook = os.path.join(tmpdir, "jsonhook.mjs")
    try:
        # BYTES, and newline='' -- a python patch script on this repo that writes
        # text silently converts a whole file CRLF->LF.
        with io.open(hook, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(_JS_JSON_HOOK)
        with io.open(driver, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(driver_source)
        proc = subprocess.run(
            [_node(), driver], cwd=ROOT, input=json.dumps(payload),
            capture_output=True, text=True, encoding="utf-8", errors="replace")
    finally:
        for path in (driver, hook):
            try:
                os.remove(path)
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass

    if proc.returncode != 0:
        raise LaneUnavailable(
            f"the JS lane exited {proc.returncode}: "
            f"{(proc.stderr or proc.stdout)[-2000:]}")
    try:
        doc = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise LaneUnavailable(
            f"the JS lane printed something that is not JSON: {exc}; "
            f"stdout was {proc.stdout[:500]!r}") from exc
    if not doc.get("ok"):
        raise LaneUnavailable(f"the JS lane refused: {doc.get('error')}")
    return doc


def js_lane_available() -> bool:
    return os.path.exists(JS_INTERPRET_PATH) and os.path.exists(JS_PARSE_PATH)


def py_lane_available() -> bool:
    try:
        __import__(PY_INTERPRET_MODULE)
    except Exception:
        return False
    return True


def run_js(cases: list[dict], bars: list[dict]) -> dict:
    """Evaluate every case in ONE node process and read JSON off stdout.

    ARGV AS A LIST, shell=False, and the payload goes in on STDIN -- never in a
    `-e` string.

    The reader is pinned `encoding='utf-8', errors='replace'`: without it Python
    decodes the child as cp1252 and one box-drawing character raises
    UnicodeDecodeError inside the reader thread, stdout comes back None, and the
    verdict is a TypeError rather than a result.

    REFUSES rather than returning `{}` when the lane does not exist.
    """
    if not js_lane_available():
        raise LaneUnavailable(
            f"the JS lane has no interpreter: {os.path.relpath(JS_INTERPRET_PATH, ROOT)} "
            "does not exist. Task 4 writes it. Returning an empty result here "
            "would make every cross-lane equality below a claim about nothing.")

    payload = {"interpreter": JS_INTERPRET_PATH, "bars": bars,
               "cases": [{"id": c["id"], "ast": c["ast"]} for c in cases]}
    return _node_run(_JS_DRIVER, payload)["columns"]


def run_js_escapes(cases: list[dict], bars: list[dict]) -> dict:
    """Offer every escape case to the SHIPPED PIPELINE: canonicalise, then interpret.

    Returns `{id: {"stage", "outcome", "guard"?, "message"?, "error"?, "ast"?}}`.

    ⭐ THIS IS THE DOOR FIX. `interpret` alone is HALF the pipeline, and offering
    a jsep tree to it refuses everything at the root for a reason that has nothing
    to do with what any case claims. `canonicalise` is the first door; it lives in
    JS because there is exactly one parser (D-A1); so the census runs it.

    REFUSES rather than returning `{}` when the lane does not exist -- a census
    that quietly stopped measuring the parse door would report the same zero.
    """
    if not js_lane_available():
        missing = [os.path.relpath(p, ROOT) for p in (JS_PARSE_PATH, JS_INTERPRET_PATH)
                   if not os.path.exists(p)]
        raise LaneUnavailable(
            f"the JS lane is incomplete: {missing} missing. The census cannot "
            "measure the parse->canonical door without the only parser, and "
            "falling back to offering jsep trees straight to `interpret` is the "
            "exact wrong-door defect this pipeline exists to fix.")
    payload = {"parser": JS_PARSE_PATH, "interpreter": JS_INTERPRET_PATH,
               "bars": bars,
               "cases": [{"id": c["id"], "jsep": c["ast"]} for c in cases]}
    results = _node_run(_JS_ESCAPE_DRIVER, payload)["results"]
    missing_ids = sorted({c["id"] for c in cases} - set(results))
    if missing_ids:
        raise LaneUnavailable(
            f"the JS lane returned no verdict for {missing_ids}. A case with no "
            "verdict would silently leave the census.")
    return results


def run_py(cases: list[dict], bars: list[dict]) -> dict:
    """Evaluate every case through the Python tree walker.

    REFUSES rather than returning `{}` when the lane does not exist.
    """
    if not py_lane_available():
        raise LaneUnavailable(
            f"the Python lane has no interpreter: {PY_INTERPRET_MODULE} does not "
            "import. Task 5 writes it. Returning an empty result here would make "
            "every cross-lane equality below a claim about nothing.")
    mod = __import__(PY_INTERPRET_MODULE, fromlist=["interpret"])
    interpret: Callable = getattr(mod, "interpret")
    out = {}
    for case in cases:
        col = interpret(case["ast"], bars)
        out[case["id"]] = [None if (v is None or (isinstance(v, float) and math.isnan(v)))
                           else v for v in col]
    return out


def _node() -> str:
    return os.environ.get("NODE_BIN", "node")


def compare_lanes(js: dict, py: dict, rel_tol: float = REL_TOL) -> dict:
    """The cross-lane equality. REFUSES a comparison that cannot report anything.

    Three refusals, all of them the shape "a zero that means nothing":
      * either lane empty -- there is nothing to compare;
      * the two lanes carry different case ids -- a comparison over the
        intersection would silently stop covering whatever one lane dropped;
      * a case whose columns are different lengths -- a shorter column compared
        pairwise agrees on every element it has.

    NaN AGREES WITH NaN and None agrees with None. That is a semantic decision,
    not a convenience: a warmup window is NaN in both lanes and every corpus case
    with a 200-bar reduction is NaN for 199 bars, so treating NaN as a difference
    would make 199 of 579 rows disagree on a correct implementation.
    """
    if not js or not py:
        raise LaneUnavailable(
            f"compare_lanes was handed an empty lane (js={len(js)} cases, "
            f"py={len(py)} cases). Zero differences over zero rows is not "
            "agreement, and reporting it as agreement is the exact shape this "
            "phase refuses.")
    if set(js) != set(py):
        raise LaneUnavailable(
            f"the lanes carry different case ids: js-only={sorted(set(js) - set(py))} "
            f"py-only={sorted(set(py) - set(js))}")

    differences: list[dict] = []
    compared = 0
    for ast_id in sorted(js):
        a, b = js[ast_id], py[ast_id]
        if len(a) != len(b):
            raise LaneUnavailable(
                f"{ast_id}: the lanes produced different column lengths "
                f"({len(a)} vs {len(b)}). A pairwise comparison would agree on "
                "every element the shorter column happens to have.")
        for i, (x, y) in enumerate(zip(a, b)):
            compared += 1
            if not _agree(x, y, rel_tol):
                differences.append({"ast_id": ast_id, "bar_index": i,
                                    "js": x, "py": y, "rel": _rel(x, y)})
    return {"compared": compared, "cases": len(js), "rel_tol": rel_tol,
            "differences": differences}


def _is_nullish(v: Any) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v))


def _agree(x: Any, y: Any, rel_tol: float) -> bool:
    if _is_nullish(x) or _is_nullish(y):
        return _is_nullish(x) and _is_nullish(y)
    if isinstance(x, bool) or isinstance(y, bool):
        return bool(x) == bool(y)
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return x == y
    if x == y:
        return True
    scale = max(abs(x), abs(y))
    if scale == 0:
        return True
    return abs(x - y) <= rel_tol * scale


def _rel(x: Any, y: Any) -> Optional[float]:
    if _is_nullish(x) or _is_nullish(y):
        return None
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    scale = max(abs(x), abs(y))
    return None if scale == 0 else abs(x - y) / scale


# --------------------------------------------------------------------------- #
# the escape census
# --------------------------------------------------------------------------- #

def guard_state() -> str:
    """Which guarded interpreters exist RIGHT NOW."""
    js, py = js_lane_available(), py_lane_available()
    if js and py:
        return "both"
    if js:
        return "js"
    if py:
        return "python"
    return "absent"


def _nan_col(n: int) -> list:
    return [float("nan")] * n


def _naive_reduction(fn: Callable) -> Callable:
    """A rolling reduction with NO arity check and NO lookback budget.

    Deliberately JS-faithful in the one way that matters: a MISSING argument is
    `undefined`, not an error, so `sma(close)` produces a column of NaN rather
    than raising. That silent all-NaN column is the actual escape `arity_wrong`
    names -- in Python the same call is a TypeError, so the ABSENCE of an arity
    check is itself a cross-lane divergence, and it is the shape no golden
    fixture can carry.

    An out-of-range window is likewise not an error: `sma(close, 100000)` walks
    every bar doing nothing and returns NaN, which is exactly the unbounded work
    the lookback budget exists to refuse.
    """
    def f(*args):
        series = args[0] if len(args) > 0 else None
        n = args[1] if len(args) > 1 else None
        if not isinstance(series, list):
            return None
        if not isinstance(n, int) or isinstance(n, bool) or n <= 0:
            return _nan_col(len(series))
        out = []
        for i in range(len(series)):
            window = series[i + 1 - n:i + 1] if i + 1 >= n else None
            out.append(fn(window) if window else float("nan"))
        return out
    return f


#: Naive implementations, keyed by table name. Only the names the escape corpus
#: actually CALLS are bound (derived by `_naive_table`, never typed) -- eleven
#: implementations nobody exercises would be dead code inside the instrument.
_NAIVE_IMPLS = {
    "sma": _naive_reduction(lambda w: sum(w) / len(w)),
    "ema": _naive_reduction(lambda w: sum(w) / len(w)),
    "highest": _naive_reduction(max),
    "lowest": _naive_reduction(min),
}


def _naive_table(doc: dict) -> dict:
    """Which table functions the UNGUARDED walker knows.

    Derived from the escape corpus, not typed: every callee name it calls, minus
    the names whose case declares the guard `resolve:function` -- those are
    precisely the ones that MUST be unbound for the case to mean anything. An
    unguarded interpreter is one with no GUARD, not one with no TABLE, and a
    walker missing `sma` would report `arity_wrong` as "unknown name", which is
    the wrong finding by the right accident.
    """
    must_be_unbound: set = set()
    called: set = set()
    for case in doc["cases"]:
        ast = case.get("ast")
        if ast is None and case.get("astFrom"):
            ast = generate_ast(case["astFrom"])
        names = _callee_names(ast)
        called |= names
        if case.get("guard") == "resolve:function":
            must_be_unbound |= names
    return {n: _NAIVE_IMPLS[n] for n in (called - must_be_unbound)
            if n in _NAIVE_IMPLS}


def _callee_names(ast: Any) -> set:
    """Identifier names in CALLEE position anywhere in a jsep tree."""
    found: set = set()
    stack = [ast]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        if node.get("type") == "CallExpression":
            callee = node.get("callee") or {}
            if callee.get("type") == "Identifier":
                found.add(callee["name"])
        for value in node.values():
            if isinstance(value, (dict, list)):
                stack.append(value)
    return found


def _unguarded_scope(bars: list[dict], doc: Optional[dict] = None) -> dict:
    """The scope a walker with no guard hands to an identifier lookup.

    A PLAIN dict, on purpose. The shipped interpreter must use
    `Object.prototype.hasOwnProperty.call(scope, name)` on an `Object.create(null)`
    scope; this is what that replaces.
    """
    scope = {
        "open": [b["o"] for b in bars],
        "high": [b["h"] for b in bars],
        "low": [b["l"] for b in bars],
        "close": [b["c"] for b in bars],
        "volume": [b["v"] for b in bars],
    }
    if doc is not None:
        scope.update(_naive_table(doc))
    return scope


def _unguarded_lookup(scope: dict, name: str) -> Any:
    """Identifier resolution with NO guard -- the thing the closed table replaces.

    Three steps, and every one of them is what a naive walker does:
      1. `scope[name]` -- note the plain subscript, NOT
         `Object.prototype.hasOwnProperty.call(scope, name)` on an
         `Object.create(null)` scope, which is what the shipped interpreter must
         use;
      2. the AMBIENT NAMESPACE. In the browser that is `globalThis`; in this lane
         it is `builtins`, which holds `eval`, `exec`, `__import__`, `open` and
         `compile`;
      3. attribute reach on the scope object itself.
    """
    if name in scope:
        return scope[name]
    if hasattr(builtins, name):
        return getattr(builtins, name)
    return getattr(scope, name)


def _unguarded_reach(obj: Any, key: Any) -> Any:
    """Property access with NO guard. `getattr` first, then subscript."""
    if isinstance(key, str):
        try:
            return getattr(obj, key)
        except AttributeError:
            pass
    return obj[key]


def _unguarded_eval(node: Any, scope: dict) -> Any:
    """A deliberately naive jsep-tree walker. It REFUSES NOTHING.

    This is the positive control, and its only job is to make the census's zero
    mean something. It is NOT the interpreter Tasks 4/5 will write, and nothing
    here should ever be copied into one.
    """
    t = node.get("type")
    if t == "Literal":
        return node.get("value")
    if t == "Identifier":
        return _unguarded_lookup(scope, node["name"])
    if t == "ThisExpression":
        return scope
    if t == "MemberExpression":
        obj = _unguarded_eval(node["object"], scope)
        prop = node["property"]
        key = (_unguarded_eval(prop, scope) if node.get("computed")
               else prop.get("name"))
        return _unguarded_reach(obj, key)
    if t == "ArrayExpression":
        return [_unguarded_eval(e, scope) for e in node.get("elements", [])]
    if t == "AssignmentExpression":
        value = _unguarded_eval(node["right"], scope)
        scope[node["left"]["name"]] = value
        return value
    if t == "CallExpression":
        fn = _unguarded_eval(node["callee"], scope)
        args = [_unguarded_eval(a, scope) for a in node.get("arguments", [])]
        return fn(*args)
    if t in ("BinaryExpression", "LogicalExpression"):
        left = _unguarded_eval(node["left"], scope)
        right = _unguarded_eval(node["right"], scope)
        return _BINOPS[node["operator"]](left, right)
    if t == "UnaryExpression":
        arg = _unguarded_eval(node["argument"], scope)
        return _UNOPS[node["operator"]](arg)
    if t == "ConditionalExpression":
        return (_unguarded_eval(node["consequent"], scope)
                if _unguarded_eval(node["test"], scope)
                else _unguarded_eval(node["alternate"], scope))
    raise NotImplementedError(f"the unguarded walker has no case for {t!r}")


_BINOPS = {
    "+": lambda a, b: a + b, "-": lambda a, b: a - b,
    "*": lambda a, b: a * b, "/": lambda a, b: a / b,
    ">": lambda a, b: a > b, "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b, "!=": lambda a, b: a != b,
    "&&": lambda a, b: a and b, "||": lambda a, b: a or b,
}
_UNOPS = {"-": lambda a: -a, "!": lambda a: not a}


def _lane_native_reached(scope: dict) -> dict:
    """Which LANE-NATIVE reaches the unguarded walker resolves.

    THIS IS WHAT KEEPS "IT ERRORED" FROM READING AS "IT WAS SAFE".

    The must-refuse corpus names JS reaches -- `constructor`, `__proto__`,
    `toString`, `globalThis`. A naive PYTHON walker does not resolve those, and
    an AttributeError is the WRONG LANGUAGE declining, not a table refusing. So
    the control probes the equivalent reaches in the lane this census actually
    runs in:

      * `names`   -- the ambient namespace, `builtins`, which is Python's
        `globalThis`. Note what does NOT appear: `open` is SHADOWED by the
        `open` series, which is a real property of the lookup order and exactly
        the kind of thing a blocklist would have got wrong.
      * `gadget`  -- `close.__class__.__base__.__subclasses__`, reached through
        the same `_unguarded_reach` the corpus's `member_access` cases use. It is
        Python's `constructor.constructor`: the property-access chain that ends
        at arbitrary code.
    """
    names = []
    for name in LANE_NATIVE_PROBES:
        try:
            value = _unguarded_lookup(scope, name)
        except Exception:
            continue
        if callable(value):
            names.append(name)

    gadget = None
    try:
        node = _unguarded_lookup(scope, "close")
        for step in ("__class__", "__base__", "__subclasses__"):
            node = _unguarded_reach(node, step)
        if callable(node):
            gadget = "close.__class__.__base__.__subclasses__"
    except Exception:
        gadget = None
    return {"names": names, "gadget": gadget}


def _py_outcome(ast: Any, bars: list[dict]) -> dict:
    """Interpret ONE canonical tree in the Python lane and describe what happened.

    ⛔ IT IS HANDED THE CANONICAL TREE THE JS LANE PRODUCED, never the jsep one.
    That is the whole door fix: this lane has no parser by design, so a jsep tree
    offered here is refused at the root by `interpret:node` before a name, an
    arity, a window or a budget is ever consulted -- which is how the census read
    a zero that would have read the same with no budget in the product.
    """
    mod = __import__(PY_INTERPRET_MODULE, fromlist=["interpret"])
    refusal = getattr(mod, "TableRefusal", None)
    if refusal is None:
        raise LaneUnavailable(
            f"{PY_INTERPRET_MODULE} exists but exports no `TableRefusal`. The "
            "census recognises a refusal by TYPE; without one it cannot tell a "
            "closed table from a walker that happened to crash.")
    try:
        getattr(mod, "interpret")(ast, bars)
    except refusal as exc:
        # ⭐ THE GUARD THAT FIRED RIDES ALONG, and `escape_census` reconciles it
        # against the guard the CASE DECLARES. Without it a refusal is a boolean
        # and the census cannot tell "refused by the door this case is about" from
        # "refused by some other door first".
        return {"outcome": "refused", "guard": getattr(exc, "guard", None),
                "message": str(exc)}
    except Exception as exc:  # noqa: BLE001 -- see TableRefusal's docstring
        return {"outcome": "error", "error": f"{type(exc).__name__}: {exc}"[:200]}
    return {"outcome": "value"}


def _guarded_outcomes(doc: dict, bars: list[dict]) -> tuple:
    """Every parsed case through the SHIPPED pipeline, in BOTH lanes.

    Returns `(outcomes_by_id, lane_disagreements)`.

    ⭐ A REFUSAL IS A CROSS-LANE CLAIM, exactly as a value is. The conformance log
    pins the two lanes to one NUMBER at 1e-9; this pins them to one REFUSAL, by
    GUARD, over the same canonical tree. A table that is closed in one lane and
    open in the other is not a closed table -- and the failure would be invisible
    to a census that only ever asked one of them, which is what this file did.
    So a case counts as REFUSED only when BOTH lanes refuse it AND name the same
    guard; anything else is an escape, and the disagreement is reported by name.

    ⚠️ THE CANONICALISE DOOR IS SINGLE-LANE, DECLARED RATHER THAN FORGOTTEN. There
    is exactly one parser (decision D-A1) and it is `parse.js`; the Python lane
    never parses. A case refused at that door therefore has no second opinion to
    agree with, and demanding one would be demanding the second grammar the whole
    design refuses.
    """
    cases = [c for c in doc["cases"] if c.get("parses", True)]
    for case in cases:
        if case.get("ast") is None and case.get("astFrom"):
            case["ast"] = generate_ast(case["astFrom"])
    js = run_js_escapes(cases, bars)

    outcomes: dict = {}
    disagreements: list = []
    for case in cases:
        cid = case["id"]
        row = dict(js[cid])
        if row["stage"] == "canonicalise" or "flat" not in row:
            row["lanes"] = "js-only (there is one parser, and it is parse.js)"
            outcomes[cid] = row
            continue
        py = _py_outcome(_rebuild_canonical(row.pop("flat")), bars)
        row["python"] = py
        row["lanes"] = "both"
        if (py["outcome"], py.get("guard")) != (row["outcome"], row.get("guard")):
            disagreements.append({
                "id": cid,
                "js": {"outcome": row["outcome"], "guard": row.get("guard")},
                "py": {"outcome": py["outcome"], "guard": py.get("guard")},
            })
            # ⛔ A DISAGREEMENT IS NOT A REFUSAL. Crediting the lane that happened
            # to say no would let the other lane leak forever behind a green.
            row["outcome"] = "lane-disagreement"
        outcomes[cid] = row
    return outcomes, disagreements


def escape_census(*, unguarded: bool, corpus: Optional[dict] = None,
                  bars: Optional[list[dict]] = None) -> dict:
    """How many escape-corpus cases reach an evaluation they should not.

    Returns {"parsed": n, "refused": n, "escaped": [ids], "parser_refused": [ids]}
    plus the detail a reader needs to believe it.

    THE VACUITY REFUSAL, AND IT POINTS THE OTHER WAY FROM PHASE C'S.
    C's repaint oracle had to read NON-ZERO on the unmodified tree. This one has
    to read ZERO on the guarded interpreter -- so a zero here proves NOTHING on
    its own, and the run ABORTS unless the SAME corpus through the UNGUARDED
    interpreter reads non-zero (see `escape_verdict`). A census reporting
    "nothing escapes" against an interpreter with no guard is a gate that cannot
    fail, and that shape has been vacuous twenty distinct ways on this branch.

    AND `parsed` IS PART OF THE VERDICT. A case that never parsed was never
    offered to the interpreter, so counting it as "refused" would let a parser
    change silently empty this census while every number stayed the same.
    """
    doc = corpus or load_escapes()
    if bars is None:
        try:
            bars = corpus_bars()
        except Exception:
            bars = [{"t": i, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1}
                    for i in range(8)]
    scope = _unguarded_scope(bars, doc)

    cases = doc["cases"]
    if not cases:
        raise CensusVacuous(
            "the escape corpus is EMPTY. A census over no cases reports zero "
            "escapes and would be cited as safety forever.")

    parsed = 0
    refused = 0
    escaped: list = []
    parser_refused: list = []
    reached_a_value: list = []
    errored_incidentally: list = []
    refusal_guards: list = []
    lane_disagreements: list = []
    guarded_rows: dict = {}

    if not unguarded:
        guarded_rows, lane_disagreements = _guarded_outcomes(doc, bars)

    for case in cases:
        cid = case["id"]
        if not case.get("parses", True):
            # NOT OFFERED, so NOT REFUSED. A case the parser rejects says nothing
            # about what the tree walker would have done.
            parser_refused.append(cid)
            continue
        parsed += 1
        if not unguarded:
            row = guarded_rows[cid]
            if row["outcome"] == "refused":
                refused += 1
                refusal_guards.append({"id": cid, "declared": case.get("guard"),
                                       "fired": row.get("guard"),
                                       "stage": row.get("stage")})
                continue
            escaped.append(cid)
            if row["outcome"] == "value":
                reached_a_value.append(cid)
            else:
                errored_incidentally.append(
                    {"id": cid,
                     "error": row.get("error") or f"lane disagreement {row.get('guard')}"})
            continue

        ast = case.get("ast")
        if ast is None and case.get("astFrom"):
            ast = generate_ast(case["astFrom"])
        try:
            value = _unguarded_eval(ast, dict(scope))
        except TableRefusal as exc:
            refused += 1
            refusal_guards.append({"id": cid, "declared": case.get("guard"),
                                   "fired": getattr(exc, "guard", None)})
            continue
        except RecursionError as exc:
            escaped.append(cid)
            errored_incidentally.append({"id": cid, "error": type(exc).__name__})
            continue
        except Exception as exc:  # noqa: BLE001 -- see TableRefusal's docstring
            escaped.append(cid)
            errored_incidentally.append(
                {"id": cid, "error": f"{type(exc).__name__}: {exc}"[:160]})
            continue
        escaped.append(cid)
        reached_a_value.append(cid)
        del value

    assert parsed == refused + len(escaped), (
        f"census arithmetic broke: parsed={parsed} refused={refused} "
        f"escaped={len(escaped)}")
    assert parsed + len(parser_refused) == len(cases), (
        f"census arithmetic broke: parsed={parsed} "
        f"parser_refused={len(parser_refused)} total={len(cases)}")

    return {
        "mode": "unguarded" if unguarded else "guarded",
        "guard": guard_state(),
        "total": len(cases),
        "parsed": parsed,
        "refused": refused,
        "escaped": escaped,
        "parser_refused": parser_refused,
        "reached_a_value": reached_a_value,
        "errored_incidentally": errored_incidentally,
        "refusal_guards": refusal_guards,
        "wrong_door": _reconcile_guards(refusal_guards),
        "lane_disagreements": lane_disagreements,
        "lane_native_reached": (_lane_native_reached(dict(scope)) if unguarded
                                else {"names": [], "gadget": None}),
    }


def _family(guard: Optional[str]) -> Optional[str]:
    """`budget:nodes` -> `budget`. The DOOR, not the individual latch."""
    if not guard:
        return None
    return guard.split(":", 1)[0]


def _reconcile_guards(rows: list) -> list:
    """Cases refused by a DIFFERENT DOOR from the one they are about.

    🔴 WHY THIS EXISTS, MEASURED 2026-08-07, AND WHAT CHANGED 2026-08-08.
    `escape_census` USED TO offer each case's JSEP tree straight to `interpret`,
    skipping the parse->canonical door entirely. The Python lane deliberately has
    NO parser, so EVERY jsep-shaped tree was refused by its canonical-shape check
    (`interpret:node`) at the ROOT -- before any name, arity, window or budget was
    ever consulted. All fifteen cases read `refused`; the census read `0 escaped`;
    and the three `budget:*` cases read EXACTLY THE SAME as they would have with
    no budget in the product at all.

    Task 5 measured that, refused to claim the zero, and wrote this function so
    the discrepancy printed. The budget task then fixed the PIPELINE rather than
    the report: `_guarded_outcomes` now runs `canonicalise` (the only parser) and
    then `interpret`, so every case meets the door its claim is about.

    ⛔ AND THE RECONCILIATION IS NOW PART OF THE VERDICT, NOT A FOOTNOTE. Task 5
    deliberately left the four exit codes alone because the budget task read its
    baseline from them; that baseline has been read, so a CLOSED whose refusals
    came from the wrong doors is no longer allowed to exit 0. A zero that is not
    ATTRIBUTABLE is not a zero anybody may cite.
    """
    return [r for r in rows
            if r.get("declared") and _family(r["declared"]) != _family(r["fired"])]


#: `escape_verdict` exit codes. Distinct on purpose: "there is no guard yet" and
#: "the guard leaks" are opposite findings and a single exit 1 for both would let
#: Task 6 read its own baseline as a defect and vice versa.
EXIT_CLOSED = 0
EXIT_ESCAPES = 1
EXIT_VACUOUS = 2
EXIT_NO_GUARD = 3


def escape_verdict(guarded: dict, control: dict) -> tuple:
    """Price the guarded census AGAINST ITS CONTROL. Returns (exit_code, lines).

    The control consult is the whole point of this function. A guarded census
    that reported zero without one would be a gate that cannot fail, and Task 6
    would inherit a green number that started green.
    """
    if control["mode"] != "unguarded":
        raise CensusVacuous(
            f"the control passed to escape_verdict is a {control['mode']!r} "
            "census. The control MUST be the unguarded run of the SAME corpus.")
    if len(control["escaped"]) == 0:
        raise CensusVacuous(
            "THE UNGUARDED CONTROL READ ZERO. The same corpus run through an "
            "interpreter with no guard escaped nothing, so this corpus cannot "
            "report a leak and the guarded zero below means nothing. Fix the "
            "corpus or the control; do not record the zero.")

    lines = [
        f"  control (unguarded): {len(control['escaped'])} escaped "
        f"of {control['parsed']} parsed  <- the positive control",
        f"  guarded            : {len(guarded['escaped'])} escaped "
        f"of {guarded['parsed']} parsed",
    ]
    if guarded["guard"] == "absent":
        lines.append(
            "  VERDICT: NO GUARD EXISTS YET. This number is the BASELINE, not a "
            "defect. Task 6 owes the first zero, and it can only mean something "
            "because this reads non-zero today.")
        return EXIT_NO_GUARD, lines
    if guarded["escaped"]:
        lines.append(f"  VERDICT: ESCAPES -- {guarded['escaped']}")
        return EXIT_ESCAPES, lines

    # ─── THE ZERO MUST BE ATTRIBUTABLE, AND THAT IS PART OF THE VERDICT ──────
    #
    # Two ways a zero can be worthless even with a live control behind it, and
    # both have actually happened here:
    #   * every case refused by a door that has nothing to do with its claim
    #     (measured 2026-08-07: 15 of 15, all `interpret:node`);
    #   * one lane refusing while the other reaches a value -- a table that is
    #     closed in JS and open in Python is not a closed table.
    # Neither is an "escape", so neither can be folded into the count above; both
    # make the count meaningless, so neither may exit 0.
    wrong = guarded.get("wrong_door") or []
    split = guarded.get("lane_disagreements") or []
    if wrong or split:
        lines.append("  VERDICT: NOT ATTRIBUTABLE -- the count is zero and the "
                     "zero does not belong to the guards that are supposed to "
                     "have earned it.")
    if wrong:
        lines.append(
            f"  ⚠ {len(wrong)} of the {guarded['refused']} refusals came from a "
            "DIFFERENT DOOR than the case declares")
        lines.append(
            f"    {[r['id'] for r in wrong]} -- each declares "
            f"{sorted({r['declared'] for r in wrong})} and each was refused by "
            f"{sorted({str(r['fired']) for r in wrong})}.")
        lines.append(
            "    Those claims are NOT tested by this run, and would read the same "
            "with no guard of their own in the product at all.")
    if split:
        lines.append(f"  ⚠ {len(split)} case(s) where THE TWO LANES DISAGREE about "
                     "the refusal:")
        for row in split:
            lines.append(f"    {row['id']}: js={row['js']} py={row['py']}")
    if wrong or split:
        return EXIT_ESCAPES, lines

    lines.append("  VERDICT: CLOSED -- zero escapes; the control proves the "
                 "corpus could have reported one; and every refusal came from "
                 "the door the case declares, in both lanes.")
    lines.append(
        f"  guard reconciliation: declared == fired for all {guarded['refused']} "
        f"refusals ({len(guarded.get('lane_disagreements') or [])} lane "
        "disagreements)")
    return EXIT_CLOSED, lines


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _cmd_coverage() -> int:
    corpus = load_corpus()
    manifest = load_manifest()
    print(f"corpus cases : {len(corpus['cases'])}")
    used = set()
    for case in corpus["cases"]:
        used |= names_in(case["ast"])
    print(f"names used   : {len(used)} -> {sorted(used)}")
    if manifest is None:
        print(f"manifest     : ABSENT ({os.path.relpath(MANIFEST_PATH, ROOT)})")
        print("  the coverage rail is ARMED AND SKIPPED. Task 3 writes the "
              "manifest and owes its first pass.")
        return EXIT_NO_GUARD
    declared = assert_corpus_covers_the_table(manifest, corpus)
    print(f"manifest     : {len(declared)} declared entries, ALL COVERED")
    return 0


def _cmd_escapes(unguarded: bool) -> int:
    control = escape_census(unguarded=True)
    if unguarded:
        print("=== ESCAPE CENSUS (UNGUARDED -- the positive control) ===")
        _print_census(control)
        if not control["escaped"]:
            print("  REFUSED: the unguarded control read ZERO. A corpus nothing "
                  "can escape measures nothing.")
            return EXIT_VACUOUS
        return 0

    guarded = escape_census(unguarded=False) if guard_state() != "absent" else control
    print("=== ESCAPE CENSUS ===")
    _print_census(guarded)
    code, lines = escape_verdict(guarded, control)
    for line in lines:
        print(line)
    return code


def _print_census(res: dict) -> None:
    print(f"  guard              : {res['guard']}")
    print(f"  corpus cases       : {res['total']}")
    print(f"  parsed (offered)   : {res['parsed']}")
    print(f"  parser_refused     : {len(res['parser_refused'])} {res['parser_refused']}")
    print(f"  refused by a table : {res['refused']}")
    print(f"  ESCAPED            : {len(res['escaped'])} {res['escaped']}")
    print(f"    reached a value  : {len(res['reached_a_value'])} {res['reached_a_value']}")
    print(f"    incidental error : {len(res['errored_incidentally'])}")
    for row in res["errored_incidentally"]:
        print(f"      {row['id']}: {row['error']}")
    if res["mode"] == "guarded" and res["refusal_guards"]:
        print("  DECLARED vs FIRED (the guard reconciliation):")
        for row in res["refusal_guards"]:
            mark = "  " if _family(row["declared"]) == _family(row["fired"]) else "!!"
            print(f"    {mark} {row['id']:<20} declares {str(row['declared']):<24} "
                  f"fired {str(row['fired']):<24} at {row.get('stage')}")
    wrong = res.get("wrong_door") or []
    if wrong:
        print(f"  ⚠ REFUSED BY A DIFFERENT DOOR : {len(wrong)}")
        print("    (refused, yes -- but NOT by the guard the case is about, so the")
        print("     case's own claim is UNTESTED by this run. See _reconcile_guards.)")
        for row in wrong:
            print(f"      {row['id']}: declares {row['declared']}, "
                  f"fired {row['fired']}")
    split = res.get("lane_disagreements") or []
    if split:
        print(f"  ⚠ THE TWO LANES DISAGREE ON A REFUSAL : {len(split)}")
        for row in split:
            print(f"      {row['id']}: js={row['js']} py={row['py']}")
    native = res.get("lane_native_reached") or {}
    if native.get("names") or native.get("gadget"):
        print("  LANE-NATIVE CONTROL (an incidental error above is the WRONG")
        print("  LANGUAGE declining, not a table refusing):")
        print(f"    ambient namespace : {native.get('names')}")
        print(f"    property gadget   : {native.get('gadget')}")


def _cmd_record(force: bool) -> int:
    if os.path.exists(LOG_PATH) and not force:
        print(f"REFUSED: {os.path.relpath(LOG_PATH, ROOT)} already exists. "
              "--record IS ONE-SHOT: re-running it re-records whatever the code "
              "now does and converts a real regression into a green build.")
        return 1
    missing = []
    if not js_lane_available():
        missing.append(os.path.relpath(JS_INTERPRET_PATH, ROOT))
    if not py_lane_available():
        missing.append(PY_INTERPRET_MODULE)
    if missing:
        print("REFUSED: there is no second lane yet. Missing: "
              + ", ".join(missing))
        print("  The conformance log is written by Task 5, not Task 2. Recording "
              "one lane against itself would freeze an agreement nobody measured.")
        return EXIT_NO_GUARD
    corpus = load_corpus()
    bars = corpus_bars(corpus)
    js = run_js(corpus["cases"], bars)
    py = run_py(corpus["cases"], bars)
    cmp_ = compare_lanes(js, py)
    if cmp_["differences"]:
        print(f"REFUSED: the lanes disagree on {len(cmp_['differences'])} rows. "
              "A conformance log recorded over a disagreement freezes the "
              "disagreement.")
        return 1
    # ─── the recorder asserts its own NON-VACUITY, BEFORE it writes ──────────
    #
    # The `_gen_alert_baseline.py` shape. A log recorded over a corpus that
    # produced nothing is a digest of nothing, and it would be cited as an
    # agreement forever -- `--check` would keep matching it, exactly, at zero
    # cost, for the whole life of the product.
    per_case_finite = {c["id"]: sum(1 for v in py[c["id"]] if v is not None)
                       for c in corpus["cases"]}
    total_rows = len(corpus["cases"]) * len(bars)
    finite_rows = sum(per_case_finite.values())
    assert finite_rows, "no case produced a finite value -- the log pins nothing"
    assert finite_rows < total_rows, (
        "every row is finite -- no case exercises a warmup pad, so the NaN "
        "convention (the two lanes' most likely silent disagreement, `None` here "
        "and `NaN` there) is untested by this log")
    blind = [c for c, n in per_case_finite.items() if not n]
    assert not blind, (
        f"a case produced ZERO finite values across the whole series: {blind} -- "
        "its digest is a digest of nothing")
    # ARMED AT TASK 2, FIRST ENFORCED AT THE RECORD. Every manifest entry must be
    # exercised by the corpus, DERIVED from the manifest and never hand-listed.
    manifest = load_manifest()
    assert manifest is not None, "the manifest must exist before a log is frozen"
    covered = assert_corpus_covers_the_table(manifest, corpus)
    print(f"non-vacuity : {finite_rows} finite of {total_rows} rows, "
          f"every case non-empty, {len(covered)} table entries covered")

    digests = {c["id"]: ast_digest(
        c["id"], [(i, repr(js[c["id"]][i]), repr(py[c["id"]][i]))
                  for i in range(len(bars))]) for c in corpus["cases"]}
    with io.open(LOG_PATH, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"bars": corpus["bars"], "bar_count": len(bars),
                   "rel_tol": REL_TOL, "digests": digests}, fh,
                  indent=2, sort_keys=True)
        fh.write("\n")
    print(f"recorded {len(digests)} per-ast digests over {len(bars)} bars")
    return 0


def _cmd_check() -> int:
    if not os.path.exists(LOG_PATH):
        print(f"REFUSED: {os.path.relpath(LOG_PATH, ROOT)} does not exist. Task 5 "
              "records it once BOTH lanes exist; there is no second lane yet, so "
              "there is nothing to check and reporting a pass would be a claim "
              "about nothing.")
        return EXIT_NO_GUARD
    frozen = _read_json(LOG_PATH)
    corpus = load_corpus()
    bars = corpus_bars(corpus)
    js = run_js(corpus["cases"], bars)
    py = run_py(corpus["cases"], bars)
    cmp_ = compare_lanes(js, py)
    bad = 0
    for case in corpus["cases"]:
        cid = case["id"]
        got = ast_digest(cid, [(i, repr(js[cid][i]), repr(py[cid][i]))
                               for i in range(len(bars))])
        want = frozen["digests"].get(cid)
        if want is None:
            print(f"  {cid}: NOT IN THE FROZEN LOG")
            bad += 1
        elif got != want:
            print(f"  {cid}: DIGEST MOVED {want[:12]} -> {got[:12]}")
            bad += 1
    for cid in frozen["digests"]:
        if cid not in {c["id"] for c in corpus["cases"]}:
            print(f"  {cid}: IN THE FROZEN LOG BUT NOT IN THE CORPUS")
            bad += 1
    if cmp_["differences"]:
        print(f"  LANES DISAGREE on {len(cmp_['differences'])} rows "
              f"(rel_tol {REL_TOL})")
        bad += len(cmp_["differences"])
    if bad:
        print(f"CONFORMANCE LOG DOES NOT MATCH ({bad} findings)")
        return 1
    print(f"CONFORMANCE LOG MATCHES, {len(frozen['digests'])} asts x "
          f"{len(bars)} bars")
    return 0


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(
        prog="ast_conformance",
        description="The Phase D instrument: a cross-lane conformance log and "
                    "an escape census that refuses a zero without its control.")
    ap.add_argument("--record", action="store_true",
                    help="ONE-SHOT. Freeze the per-ast digests (Task 5).")
    ap.add_argument("--force", action="store_true",
                    help="overwrite an existing conformance log (do not)")
    ap.add_argument("--check", action="store_true", help="the gate")
    ap.add_argument("--escapes", action="store_true", help="the census")
    ap.add_argument("--unguarded", action="store_true",
                    help="run the census through the UNGUARDED walker")
    ap.add_argument("--coverage", action="store_true",
                    help="the manifest totality rail")
    args = ap.parse_args(argv)

    if args.coverage:
        return _cmd_coverage()
    if args.escapes:
        return _cmd_escapes(args.unguarded)
    if args.record:
        return _cmd_record(args.force)
    if args.check:
        return _cmd_check()
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
