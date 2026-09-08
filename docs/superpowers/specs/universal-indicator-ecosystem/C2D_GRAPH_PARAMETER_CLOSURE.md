# WAVE C2D — GRAPH / PARAMETER OPERATIONAL CLOSURE

Two operational findings C2C surfaced, closed. No safety constant changed; the
64 KB document cap and the interpreter budget are both untouched.

---

## C2D.1 — THE TRACK F MISMATCH, ROOT-CAUSED

### What was wrong

`PineBox` built the parameter manifest from its **own second translation** —
`translatePine(text, {paramManifest: true})`, deliberately uncoupled from
`declareInputs` — while `BuilderSheet` saved the trees from
`memberInputTranslation`. The component's own comment argued this was necessary:
a name `declareInputs` declares *"takes an early return in `resolveInput` before
Track F's tagging runs, so sharing one call would silently split one script's
parameters across two mechanisms."*

**The early return is real. The conclusion was backwards.** Splitting is what
*should* happen — a declared input already has a member-input control, and
giving it a Track F slider too is two authorities over one Pine input. What the
second call actually bought was a manifest measured against a tree nobody saves.

### Measured, not argued

```
                                    saved tree      manifest-pass tree
…03-supertrend-kivancozbilgic       3711a943663c    0087b364c04b   DIFFERENT
…22-rsi-levels-regime-map           dce8efd7442a    52e3309a4163   DIFFERENT
…12-cm-ultimate-rsi-mtf-chrismoody  6 outputs       7 outputs      DIFFERENT COUNT
…14-master-line-lite                1ed6a73ac815    1ed6a73ac815   (same, by luck)
```

- On supertrend, `__uct_param_1` ("Multiplier") resolved on all 17 of its
  locators; `__uct_param_3` ("Periods") walked to `["args", …, "args", 3]` — **a
  fourth argument the saved node does not have** — and every locator resolved to
  `undefined`. Same shape on rsi-levels.
- The third line is the worse one: `PineBox`'s comment asserted the two passes
  *"share the same statement-order-derived indexing"*, and `chosen` indexed
  both. Measured false on `…12-cm-ultimate-rsi`.
- The two scripts where the trees happened to match are why this never surfaced:
  **the defect is invisible on any script with no window-bound declared input in
  the chosen output.**

### The fix

**One translation.** `inspectPine`/`inspectSource` carry `paramManifest: true`
on the translation whose trees are saved; the second call is deleted.

⭐ **Enabling the option is structurally inert, and that is checked rather than
assumed** — the parameter mint runs *after* the fold and tags the literal it
already produced, non-enumerably.
`paramSingleTranslation.test.js` asserts byte-identical `astHash` for every
output of all four complex scripts, with and without the option.

⛔ **No astPath is guessed after the fact and no script is special-cased.**

---

## C2D.2 — LOGICAL ID IS AUTHORITATIVE; THE ADDRESS IS SPLIT

A locator now has two halves decided in two places, because they *are* decided
in two places:

| half | who owns it | why |
|---|---|---|
| `{id, astPath}` — the PLACEMENT | `PineBox` | it has the translated ASTs |
| `treeIndex` — the ADDRESS | `BuilderSheet` | it assigns every plot key, from the author's title, deduplicated against its own `taken` set |

Neither can guess the other's half. Having one try is exactly how the pre-C2D
manifest came to name a tree nobody saved.

**And the manifest now spans every carried tree.** Pre-C2D it located a
parameter in the *chosen output only*, so moving a slider would have rewritten
one tree and left the others holding the old literal — one Pine input, ten
plots, two different values.

⭐ **The graph-native locator is the C2D.2 argument, measured:**

```
…03-supertrend    V1 manifest: 666 astPath locators   →  graph: 2 locators
…22-rsi-levels    V1 manifest: 400 astPath locators   →  graph: 2 locators
```

The correct V1 manifest is ~100 KB of paths for the same two controls. In the
graph the parameter names the shared node once, and `CONFLICTED` becomes
unrepresentable rather than merely unlikely.

---

## C2D.4 — THE ATTACK SET, RE-RUN. TWO PRODUCT ANSWERS WERE STRONGER THAN THE TEST.

All nine named cases pass against V2 locators. Two are worth stating because the
first version of each test asserted a *weaker* guarantee than the product gives:

1. **A forged locator is not bounds-checked — it is DISCARDED.** `locators` is in
   `_IMMUTABLE_FIELDS`, so for an established id the prior record's address is
   used verbatim and the submitted one is never read. The bounds check is the
   *second* line, guarding the value at a trusted address. Asserting only the
   second would have gone green if `locators` ever left the immutable set.
2. **A raw JSON `true` never reaches reconciliation.** `ast_hash`'s canonical
   serialiser refuses a boolean outright — *"a canonical tree carries strings,
   finite numbers, arrays and objects only"* — so the whole document is rejected
   before any parameter is reconciled.

---

## C2D.6 — A DEFECT FOUND BY WRITING THE ATTACK SET, NOT BY A FAILING RUN

⚰️ **`locators` being immutable had an untraced consequence: a definition saved
as V1 and re-saved as a shared graph kept its `{treeIndex, astPath}` locators,
which mean nothing in a graph.** Every control on every migrated document would
have reconciled `detached`, silently, on the save that was supposed to be a pure
storage improvement. It did not bite the C2C journey because those were fresh
creations, where the client's submission is the trusted authority.

**The fix is not to start trusting the client's new locators.** It is for the
server to RE-EXPRESS the position it already trusts:
`compute_graph.locator_for_ast_path` walks the trusted astPath through the graph
(each `("args", i)` step is one index lookup) and rewrites the canonical entry.
Same position, derived, never asserted — and it runs on `canonical`, *after*
`_canonicalize_manifest` has replaced the submission with the prior record.

- All-or-nothing per parameter: a partially re-expressed control is the
  "partially working" state the whole design refuses.
- A locator that cannot be walked loses its locators entirely and reconciles
  `detached` with a sentence — the same carried-but-disabled state C2C
  established, and a shape `assert_graph` accepts.

Rails: `test_v1_then_v2_keeps_the_parameter_attached`,
`test_v1_then_v2_then_edit_then_reopen`,
`test_the_migration_cannot_be_used_to_widen_a_bound`,
`test_a_v1_locator_that_cannot_be_re_expressed_reports_detached`, plus a V1-only
control proving that lane is untouched.

---

## C2D.7 / C2D.8 — THE GRAPH-NATIVE READ CONTRACT

Two consumers were being served one shape:

- **Server-side readers** (`ast_lint`, `alert_user_series`, the sweep,
  `trees_hash`) are written against `compute.ast` / `compute.trees`.
  `_row_to_dict` materialises for them, and that stays.
- **The wire** was getting the same expansion, so an 8 KB stored document left
  as 362 KB.

`user_definitions.compact()` is the compatibility boundary, stated once. It is
**opt-in** (`?graph=1`) and the reason is a cached bundle: a member holding
yesterday's JavaScript cannot hydrate, and answering them compactly would blank
their chart with nothing red anywhere. An old bundle never asks.

Wired on `GET /api/user-definitions`, `GET /{def_id}` and `GET /{def_id}/history`
— history being where it pays most, since every version would otherwise arrive
as its own expanded forest.

**Client:** `useUserDefinitions` declares the capability in ONE place and its
list fetcher sends it; `hydrateGraphDocument` is the rebuild. The SWR key stays
`USER_DEFINITIONS_KEY` while the request carries the flag — folding it into the
key would orphan five revalidation call sites.

---

## C2D.9 — WIRE BYTES, THROUGH THE REAL ROUTES

Five bands, from the fixture the JS lane emits (`tests/fixtures/graph_wire/`)
and the Python lane measures.

```
  band           stored  response   graph=1   ratio
  small            3853      3853      3853   x1.0   (forest — unchanged)
  median          12582     12582     12582   x1.0   (forest — unchanged)
  p95             41465     41465     41465   x1.0   (forest — unchanged)
  rsi-levels      10983    167738     10983   x15.3
  supertrend       7382    298163      7382   x40.4
```

**Compact at rest AND compact over the wire.** A forest document is untouched,
byte for byte — asserted, so a future change that started rewriting V1 documents
goes red.

⭐ Live confirmation from the C2D journey's own sandbox, over the real HTTP
route: `361,519 B → 21,125 B` and `341,594 B → 41,058 B`. (Higher than the
fixture's numbers because a live import also carries member inputs, per-plot
presentation and hidden colour-condition rows — the honest number for a real
member's document.)

⛔ **No gzip.** Transport compression may exist independently; it is not the
architectural result.

## C2D.11 — READ COST

```
=== ms per document ===
  band                   serialise               parse
                    forest   graph=1     forest   graph=1
  small               0.06      0.05       0.05      0.05
  median              0.21      0.17       0.36      0.15
  p95                 0.94      0.98       0.80      0.81
  rsi-levels          6.02      0.17       9.47      0.22
  supertrend          8.32      0.16      10.81      0.13
```

C3 will hang visual payloads off this read path. It is no longer one that
rebuilds a 300 KB forest first.

---

## C2D.5 / C2D.18 — THE LIVE PROOF

`tools/c0_visual_journey.py`, isolated sandbox, same harness as C0R/C1/C2C.
Report preserved as `C2D_OOS_JOURNEY.json`.

| outcome | after C2C | after C2D |
|---|---|---|
| FULL_JOURNEY_PASS | 14 | **14** |
| SAVE_FAILED | 0 | **0** |
| CHART_PARTIAL | 3 | 3 |
| IMPORT_BLOCKED | 1 | 1 |

⭐⭐ **AND THE PARAMETERS ARE LIVE.** Read off the sandbox API after the run:

```
17 saved definitions · 37 declared parameters · 37 ATTACHED · 0 detached
```

Before C2D, each of the two complex scripts had **one of its two controls
permanently detached**. The journey outcome did not move — which is the point:
C2D fixed a control that was broken while everything else stayed exactly where
C2C left it.
