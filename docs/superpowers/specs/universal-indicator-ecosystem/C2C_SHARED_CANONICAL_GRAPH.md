# WAVE C2C — SHARED CANONICAL COMPUTATION GRAPH

Status: IN PROGRESS. C2C.1 complete (below). Implementation follows.

Governing objective unchanged: *a sophisticated TradingView Pine indicator should
be able to move into UCT with its calculations, multiple outputs, parameters,
visual presentation, state, persistence, and useful screener values intact.*

C2B established the fact this wave acts on: the two DOCUMENT_SIZE_BLOCKED scripts
are **~98.5% repetition**, not 362 KB of indicator. The cap is not the defect; the
representation is.

---

## C2C.1 — THE CURRENT TRACK F PARAMETER CONTRACT, RECOVERED

Traced end to end against the code, 2026-09-07. Nothing below is inferred from
the ADRs; every claim names the file that enforces it.

### The chain

| # | Stage | Owner |
|---|---|---|
| 1 | Pine `input.int(14, "Length", minval=1)` | `pine.js::Resolver.resolveInput` |
| 2 | **logical parameter minted** — `__uct_param_N` + immutable metadata | `pine.js` ~6414–6480 |
| 3 | the surviving literal node is tagged `__uctParamId` (non-enumerable) | same |
| 4 | tag → `{treeIndex, astPath}` locators over the trees the caller KEPT | `builder/pineParamManifest.js::buildParamManifest` |
| 5 | `compute.paramManifest` rides the save | `BuilderSheet.jsx` → `PUT/POST /api/definitions` |
| 6 | trusted-manifest canonicalization + reconcile + bounds | `api/services/param_manifest.py::apply` |
| 7 | member edits a slider | `builder/paramEdit.js::applyParamEdit` |
| 8 | tree mutated at astPath → `printFormula` → `parseFormula` → `astHash` compare | `paramEdit.js::printAndVerify` |
| 9 | `compute.source`/`sources`/`treesHash` re-derived, then saved | `paramEdit.js` tail |
| 10 | `astHash` / `treesHash` decide `compute.rev`, key the shared results table, share tokens, the ledger | `parse.js::astHash`, `trees.js::treesHash` |

### Which component DEFINES parameter identity

**`pine.js::resolveInput`, and only it.** The id is minted against
`this.paramMint.byNode.get(node)` — **the identity of the original Pine
`input.*` CALL NODE**, carried on `env` so it is shared across every output's
fresh `Resolver`.

⭐ **Identity is therefore ALREADY logical, not positional, and already correct
on both halves of the owner's decision:**

- one Pine input used in nine places → **one** id, nine locators (same call
  node object every time);
- two distinct `input.int(14)` declarations that happen to share the value 14 →
  **two** ids (two distinct call node objects), because the key is object
  identity, never `boundName` and never the value.

The comment at the mint site states this explicitly: *"KEYED ON THE ORIGINAL
CALL NODE'S IDENTITY, NEVER ON `boundName`."*

⛔ **This is the invariant C2C.3 must not break.** Node-sharing keyed on
structural equality of expanded subtrees would collapse `sma(close, 14)`
belonging to `__uct_param_1` into `sma(close, 14)` belonging to
`__uct_param_2` — and then moving one slider would silently move the other
plot. The sharing key must carry parameter provenance.

### Which components merely LOCATE occurrences

- `pineParamManifest.js::collectParamLocators` — an untargeted recursive walk
  for the tag; produces `astPath`.
- `param_manifest.py::_walk` — pure JSON traversal, explicitly *"never a
  parser."*
- `paramEdit.js::readAt` / `replaceLiteralAt` — the client mirrors of the same
  walk, written to agree "key for key" by construction.

None of these decide *what a parameter is*. They answer *where it currently
sits*. That is the seam C2C.5 replaces: an `astPath` is a **path through a
particular inlined tree**, so it is invalidated by any change to the
representation — which is exactly what this wave changes.

### Where `astPath` is SECURITY-critical

`param_manifest.py::apply` → `reconcile` → `_validate_bounds`. The declared
`min`/`max`/`type` are enforced **against the value read at the locator**. If a
locator could be made to point somewhere else, the bounds would be checked
against one literal while a different one shipped. Two rails hold that shut and
both must survive C2C:

1. `_canonicalize_manifest` — an id already present in the previous save is
   taken **verbatim from the prior record**, whatever the client submitted
   (closes "widen my own bounds").
2. Owner condition 15 — an **edit may never mint a new parameter id**; new
   identities exist only at fresh creation, where client-side Pine translation
   is already the authority for the whole document.

`treeIndex` is part of that surface: `_tree_for(None)` means `compute.ast`, a
string means a key of `compute.trees`. A locator naming a tree that does not
exist reconciles to `detached`, never to a silent pass.

### Where `astPath` is PERSISTENCE-critical

`paramEdit.js` writes through it. Step 8 is the guard that makes it safe: the
mutated tree is printed, re-parsed and compared by `astHash` **before** anything
is accepted, and every locator must verify before *any* tree is updated
(atomicity). `compute.source` is re-derived from the tree, never edited as text
— *"MUTATE THE TREE FIRST, RE-DERIVE TEXT SECOND, NEVER THE REVERSE."*

### Where `astPath` is only an implementation detail

The `astPath` **shape itself** (a list of `args`/index steps) is incidental. It
exists because the tree is inlined and a node has no name. Nothing in the trust
model depends on paths being paths; it depends on *"the manifest names exactly
the literals this parameter owns, and the server can find them without
parsing."* A node-id locator satisfies that contract strictly better — it is
shorter, it survives re-serialization, and for a shared node it collapses N
occurrences into one.

### The two facts that bound the blast radius

- **There is exactly one parser and it is in JS (D-A1).** The server must not
  gain a second one. Anything C2C asks the server to understand must be pure
  structural traversal.
- **`astHash` is already semantic, not layout.** `stableStringify` sorts keys;
  `assertCanonical` refuses any node whose key set is not byte-equal to
  `CANONICAL_KEYS[type]`. Key order, whitespace and argument spacing cannot
  reach the digest. ⛔ **A naive graph hash would undo that** — hashing a node
  table would make the digest depend on node numbering and table order, which
  is precisely "incidental serialization layout." C2C.7 must hash the
  **expanded** program.

### Known V1 limitation, carried forward unchanged

An `input.int` used only as a bar displacement (`close[n]`) produces no locator:
`foldDisplacement` cannot hang a non-enumerable tag on a bare JS number. The
server already reconciles that locator *shape* correctly. V2's `{node, path}`
locator makes the shape uniform (`['value']` reaches both `num.value` and
`offset.value`) — but the translator-side gap is **not** in scope for C2C and is
not being opened here.

---

## C2C.2 — CANONICAL GRAPH V2, AS BUILT

`app/src/components/chart/engine/ast/graph.js` (JS) ·
`api/services/compute_graph.py` (server mirror).

```json
"compute": {
  "kind": "ast",
  "graph": {
    "graphVersion": 2,
    "nodes": [ {"type":"series","name":"close"},
               {"type":"num","value":20},
               {"type":"call","name":"sma","args":[0,1]} ],
    "outputRoots": {"value": 2, "up": 4, "dn": 5},
    "parameters": {"__uct_param_1": { …metadata…,
                    "locators": [{"node": 1, "path": ["value"]}]}}
  },
  "scanPlot": "value",
  "treesHash": "sha256:…",   // UNCHANGED value
  "fn": "sha256:…"           // UNCHANGED value
}
```

A V2 node's **key set is byte-identical to `CANONICAL_KEYS[type]`** — the same
roster `parse.js` already owns, now exported rather than copied. The only
difference from V1 is what an `args` ENTRY means: an integer index into
`nodes[]` instead of an inlined child. That is why nothing downstream learns a
new node type.

**`presentation` is a REFERENCE relation, not a fourth field — a deliberate
departure from the authorization's field list, flagged for review.** Putting a
copy of the plot metadata inside the graph would be a second authority over
`plots[]`, which is this repo's most-repeated defect. C2C.13 is instead
satisfied structurally: `outputRoots` maps a plot key to a node id, so
presentation already references shared calculations by the key it always used —
and V2 can express something V1 could not, two plots whose `outputRoots` value
is the **same node** (pinned by `graph.test.js`).

### Node identity (C2C.3)

- The sharing key of a node is `type | name | value | #paramId | (childDigests)`.
- `#paramId` is the **owning `__uct_param_N`**, read by name off the
  non-enumerable tag. **This is the owner's decision made structural**: two
  `sma(close, 14)` subtrees owned by different Pine inputs have different keys
  and are never merged; a tagged `14` and an untagged `14` are also different.
- Digests are 128-bit; a collision is **refused**, never trusted.
- Ids are assigned by sorting distinct nodes on `(height, digest)` — derived
  only from content, so traversal order cannot move one, and children always
  precede parents.

### Acyclicity and the expansion bomb

- Canonical numbering is topological, so a legal graph's references run
  **strictly backwards**. One integer comparison per edge makes a cycle
  *unrepresentable* rather than *detected*.
- A DAG can describe a tree far larger than itself: forty doubling nodes is a
  2 KB document that inlines to 2^40. `expandedSizes` computes every node's
  inlined size **bottom-up in integers** — O(N), materialising nothing — and
  refuses past `MAX_EXPANDED_NODES` (2048/plot) / `MAX_EXPANDED_TOTAL` (32768).
  The refusal is free because the work never starts. Same shape as
  `MAX_RECURRENCE_STEPS`.

### C2C.4 — stateful / recurrent nodes

Storage sharing and runtime memoisation are kept **separate**, deliberately:

- **Storage:** a recurrence (`accum`, `self`) is an ordinary node and shares
  like any other. Nothing about its state reaches the stored form.
- **Runtime:** `interpret`'s memo — old and new — is gated on
  `freeOf.get(n)`, i.e. **self-free subtrees only**. A subtree that reads a
  recurrence bind is re-evaluated per step and is never cached, because caching
  it would freeze the recurrence at step one: a silent wrong number on a chart
  that still draws. `graphRuntime.test.js` carries the fixture that proves the
  gate is live rather than dead.

### C2C.7 — the hash

There is **no graph hash**. `graphTreesHash(graph) === treesHash(expandGraph(graph))`,
and `compute.fn` stays `astHash(expanded[scanPlot])`. A hash over the node table
would depend on numbering and table order — the definition of incidental
layout. Two graphs that expand to one program hash identically (pinned both
lanes), so **adopting V2 migrates nobody's alerts and re-keys nothing in the
shared results table.**

### C2C.5/.6 — parameters and compatibility

- A V2 locator is `{node, path}`; a V1 locator is `{treeIndex, astPath}`. A
  locator carrying both is refused by name.
- A V2 document's roster lives at `compute.graph.parameters`; a V1 document's at
  `compute.paramManifest`. **Carrying both is refused** — two rosters over one
  tree is a security defect, not a style one, because the bounds actually
  enforced would depend on which copy the reader consulted.
- The trust model does not change by one rule: prior record wins verbatim,
  owner condition 15 (an edit may never mint an identity), state derived fresh,
  bounds enforced against the value AT the locator. `_manifest_slot` reads the
  PREVIOUS document's roster from wherever that document kept it, so migrating a
  V1 definition to V2 keeps every identity the member already had.
- **Migration re-attaches provenance first.** `__uctParamId` is non-enumerable
  and does not survive `JSON.stringify`, so a stored V1 document has trees with
  no provenance at all. `graphDocument.toGraphDocument` tags from the V1
  manifest BEFORE building — without that step the migration itself would commit
  the owner's named defect.
- A parameter that cannot be placed **refuses the whole conversion** rather than
  being dropped.

---

## C2C.9 / C2C.10 — THE MEASUREMENT, WITH THE 64 KB CAP UNTOUCHED

`app/src/components/chart/builder/graphSize.measure.test.js`. Raw canonical
JSON, the same bytes `MAX_DEFINITION_BYTES` counts. **No gzip anywhere** — C2B
used it as a lower bound on information content, which is what it is good for;
using it to make a document fit would be manipulating the benchmark.

```
=== C2C.9 DOCUMENT SIZE, V1 vs V2, 21 buildable, cap 65536 UNCHANGED ===
  V1  P50=3309  P90=28767  MAX=331977  over cap 2/21
  V2  P50=2220  P90=5167   MAX=10485   over cap 0/21

   331977B ->   6882B  x48.2  10 trees,  76 distinct nodes  FITS  …03-supertrend-kivancozbilgic
   181315B ->  10485B  x17.3  12 trees, 146 distinct nodes  FITS  …22-rsi-levels-regime-map
    28767B ->   4641B   x6.2   7 trees,  42 distinct nodes  FITS  …14-master-line-lite
    23039B ->   4916B   x4.7   6 trees,  37 distinct nodes  FITS  …24-coppock-curve-multi-filter
    20112B ->   4565B   x4.4   6 trees,  37 distinct nodes  FITS  …12-cm-ultimate-rsi-mtf
     9225B ->   3541B   x2.6   5 trees,  23 distinct nodes  FITS  …13-spma-trend
```

- `…03-supertrend`: **8,119 inlined nodes across 10 trees → 76 distinct.
  99.1% was repetition.** 332 KB → 6.9 KB, **11% of the cap.**
- `…22-rsi-levels`: 4,719 → 146 distinct, **96.9% repetition.** 181 KB → 10.5 KB,
  **16% of the cap.**
- **Both DOCUMENT_SIZE_BLOCKED scripts now fit, and the cap did not move.**
  `treesHash` is asserted unchanged in the same test — the documents are the same
  indicators, not smaller ones.

⚠️ **A correction to C2B's own artifact.** `documentSize.measure.test.js`'s
header says these documents are "362 KB and 370 KB". The measurement it prints
says **331,977 B and 181,315 B**. The prose was a hand-typed recollection beside
the number the file itself computes — the repo's most-repeated defect, in a file
written to avoid it. The finding (the cap is not the defect) is unchanged.

## C2C.11 / C2C.12 / C2C.19 — RUNTIME SHARING, AND THE HONEST NUMBER

`interpret` already memoised self-free subtrees WITHIN one tree (keyed on a
structural id). C2C adds `opts.crossMemo`, a Map keyed on the NODE OBJECT, so
the columns of one document share work — which only pays because a shared
graph's expansion hands the same object to every parent.
`nativeRegistry.astColumnsFor` creates one per call and drops it.

Correctness first (`graphRuntime.test.js`): every column is compared **bar for
bar, NaN included**, against the same column computed with the memo off, on four
real scripts. Identical.

```
=== C2C.19 COMPUTE COST, 400 bars ===
   4957ms ->  4559ms  ( 8% saved)  10/10 columns  …03-supertrend-kivancozbilgic
     19ms ->     7ms  (63% saved)  12/12 columns  …22-rsi-levels-regime-map
    276ms ->   255ms  ( 8% saved)   7/7  columns  …14-master-line-lite
      2ms ->     2ms  ( 0% saved)   6/6  columns  …12-cm-ultimate-rsi-mtf
  expandGraph 0.15ms vs a JSON clone of the same forest 5.05ms
```

⛔ **REPORTED AS MEASURED, NOT AS HOPED. Storage sharing is a ×48 win; runtime
sharing is 0–63%, and only 8% on the two documents that are actually
expensive.** The reason is C2C.12's own warning: the expensive work in those
documents is `accum` RECURRENCE, and a subtree that reads a recurrence bind can
never be cached (caching it freezes the recurrence at step one — a silent wrong
number). The 77–84% repetition C2A measured is of counted NODES, not of TIME.
This is the same shape as the hypothesis already disproved in C2A (hoisting
non-`self` subtrees: 304ms vs 285ms, ~7%).

`crossMemo` is kept because it is free and proven correct, **not because it made
these documents fast.** Recurrence optimisation remains explicitly out of scope.

## C2C.14 — OBJECT-MODEL PREPARATION (no lifecycle implemented)

Nothing here implements `line.new` / `label.new` / `box.new` / tables, and
nothing here is authorised to. What the graph provides for that future work is
the missing *place*: a canonical, content-addressed, acyclic node table with a
per-node identity that survives persistence, plus `outputRoots` as an extension
point for roots that are not price columns. A drawing object would be a new
`type` in `CANONICAL_KEYS` with its own `outputRoots`-style roster — additive,
and provably unable to create a cycle. **That is a note about where such work
would fit, not a claim that any of it exists.**


---

## C2C.18 — WHAT THE LIVE RUN FOUND, INCLUDING THE HOUR IT COST

### The green suite that lied

The offline measurement said ×48 and 0/21 over the cap. The **first live journey
run said `SAVE_FAILED — definition exceeds 65536 bytes (362735)` for both
blocked scripts.**

The cause: `graphSize.measure.test.js` builds its fixtures the way
`documentSize.measure.test.js` does, and that recipe passes **no
`paramManifest`**. The real import path builds one — `PineBox` translates a
SECOND time with `paramManifest: true` — and with the manifest present the
conversion refused. The refusal returned a bare `null`, so
`reduceIfOversized` fell through and the member saw **the very refusal the fix
existed to remove**.

⛔ **Two lessons, both already in this repo's ledger, both re-earned here:**

1. **A fixture that omits a field the product always sets is not a fixture of
   the product.** The permanent rail is now
   `app/src/components/chart/builder/graphSaveDoor.test.js`, which builds the
   document `BuilderSheet.save()` would actually hand `saveUserDefinition` —
   manifest included — and asserts it is reduced, keeps its identity, keeps
   every control, and reads back.
2. **A silent refusal reads exactly like the feature not existing**
   (`lesson_an_over_refusal_is_invisible`). `toGraphDocument` now returns
   `{ok, reason}` and `reduceIfOversized` surfaces the reason. It cost a full
   harness run to notice, which is precisely what that lesson predicts.

### ⚰️ THE DEFECT THE REFUSAL UNCOVERED — PRE-EXISTING, IN TRACK F

Chasing the refusal produced a finding that outlives this wave.

On `…03-supertrend-kivancozbilgic`, the saved document's `paramManifest` has two
entries. `__uct_param_1` ("Multiplier") has 17 locators and **every one resolves
to `{"type":"num","value":3}`**. `__uct_param_3` ("Periods") has locators whose
`astPath` ends `… "args", 3` — **a fourth argument the saved node does not
have** — so every one of them resolves to `undefined`. Same shape on
`…22-rsi-levels-regime-map`.

**Why:** `PineBox` builds the manifest from its own `translatePine(text,
{paramManifest: true})` pass, while the document saves the
`memberInputTranslation` pass. Those two translations differ (the second runs
`declareInputs`), so the astPath positions do not line up for every parameter.
`BuilderSheet`'s own comment argues they line up "by construction" via
`verifyRoundTrip` — that argument holds only when the two passes produce the
same tree, and here they do not.

**Consequence, today, with no graph anywhere:** those controls are already
non-functional. The server reconciles them as `partially_detached` / `detached`
and disables them with a reason, so nothing computes a wrong number — but the
member is being offered a control that cannot work.

⛔ **C2C REPORTS THIS AND PRESERVES IT EXACTLY. It does not fix it** — the fix is
a Track F change (build the manifest from the translation that is actually
stored) and is not in this authorization. What C2C does is refuse to make it
worse: a parameter whose locators do not **all** resolve is placed **nowhere**
in the graph and carried with an empty locator list, which both lanes already
reconcile as `detached` with a reason. Tagging only the locators that resolve
would have silently promoted a disabled control to `attached` and handed the
member a slider that edits some of its occurrences and not others — the exact
state `reconcile`'s own sentence refuses ("disabled rather than shown partially
working").

Rails: `graphDocument.test.js` (carried-not-dropped, and half-placeable →
nowhere) · `test_compute_graph.py`
(`test_a_parameter_with_no_locators_is_legal_and_reports_detached`,
`test_an_unplaceable_parameter_still_cannot_be_edited`).

### The live journey, after the fix

`tools/c0_visual_journey.py` against an isolated sandbox backend, the same 18
accepted scripts, the same harness as C0R/C1. Report preserved verbatim as
`C2C_OOS_JOURNEY.json`.

| outcome | C0R/C1 baseline | after C2C |
|---|---|---|
| FULL_JOURNEY_PASS | 13 | **14** |
| **SAVE_FAILED (document size)** | **2** | **0** |
| CHART_PARTIAL | 2 | 3 |
| IMPORT_BLOCKED | 1 | 1 |

- **`…22-rsi-levels-regime-map`: SAVE_FAILED → FULL_JOURNEY_PASS.** All twelve
  plots stored, reopened and drew — `12 trees`, `12 chips`, none reporting
  `data-computed="false"`.
- **`…03-supertrend-kivancozbilgic`: SAVE_FAILED → CHART_PARTIAL.** The document
  now stores and reopens with all ten trees and ten chips; nine of the ten
  columns compute nothing. ⛔ **That is the RECURRENCE ceiling (E2.2), not the
  size one** — the same `interpret:steps` refusal C2A measured and deliberately
  did not raise. The size blocker is gone; the compute one was never C2C's.
- The other two CHART_PARTIALs (`…13-spma-trend`, `…14-master-line-lite`) are
  the pre-existing COMPUTE_PARTIAL pair, unchanged.

⭐ **AND THE STORAGE IS THE GRAPH, VERIFIED OVER THE LIVE API** rather than
inferred from the outcome. `GET /api/user-definitions` on the sandbox after the
run:

```
u_4aa68e05b054 | graph: True  | trees: 10 (materialised) | ast: True | sources: False
u_70aa268857d9 | graph: False | trees: 5                 | ast: True | sources: True
```

The first row is supertrend: stored as a graph, materialised into the forest
every reader expects, its source text absent from storage and re-derived on the
client. **It saved at all, which is the proof** — `MAX_DEFINITION_BYTES` is
enforced on the stored blob and was not touched.

⚠️ **AND THE COST THAT CAME WITH IT, MEASURED:** because the server materialises
on read, the API answers with the 362 KB forest for an 8 KB stored document. The
bytes at rest are what the cap governs and what this wave was authorised to fix,
and the document could not be stored at all before — but the wire payload is a
real cost, and the fix is cheap (the client already reconstructs everything from
the graph). **Named, not taken** — see the gap register, F3.4.
