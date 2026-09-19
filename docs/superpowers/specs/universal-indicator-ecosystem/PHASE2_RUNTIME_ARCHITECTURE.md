# PHASE 2 — the authoritative Pine runtime: decision, architecture, and boundaries

C4 Phase 2A. Branch `worktree-indicator-ecosystem`, from `c9bfe6f80`.
Instruments: `tools/c4_phase2a_runtime_spike/`.

Read with `C4_PHASE1_ARCHITECTURE_AND_MATRIX.md` (why a runtime at all) and
`ENDZONE_GAP_REGISTER.md` PART K.

---

## 1. THE TWO-KERNEL DECISION (§73) — stated first, not buried

**DECISION: ONE authoritative Pine runtime, written in JavaScript/TypeScript.**

- **Chart lane** executes it **natively in the browser** — the same place
  `interpret.js` runs today. No transport, no serialization, no new anything.
- **Screener lane** executes it through a **long-lived Node sidecar process**
  owned by the Python backend.
- **`api/services/ast_interpret.py` is NOT retired and NOT extended.** It keeps
  serving the legacy pure/columnar lane for V1/V2 documents, unchanged. It never
  learns scopes, frames, loops or arrays — that is the whole point.

**Rejected: two implementations of the new runtime (the status-quo shape).**
Measured, not assumed — see §2. A Python dispatch loop is **33× slower** than the
same bytecode in Node, which puts a single whole-market scan at **84 seconds**.
That is disqualifying on its own; the semantic-drift risk of writing scopes,
call frames, array aliasing and `na` propagation twice is the second reason.

**Rejected: a WASM core (Rust / AssemblyScript).** It would very likely be the
fastest option and it is the *textbook* answer to "one semantic authority in two
hosts". It is rejected on **evidence and on §85**: the JS runtime already reaches
both surfaces at a cost the screener can afford (§2), so WASM would buy perhaps a
small constant factor in exchange for a new language toolchain in CI, a new pip
dependency (`wasmtime` — **not currently installed**, verified), a compile step
in the Railway build, and a codebase nobody else in this repo writes. §85 names
"a major new production/deployment architecture" as a stop condition; choosing
WASM would trigger it. **If the JS runtime ever fails a measured performance
gate, WASM is the designated escalation and this decision should be revisited
with numbers, not preference.**

**Rejected: Python-authoritative with the browser calling the backend.** A chart
indicator would round-trip per parameter change on a live chart. Not measured in
depth because the shape is disqualifying on latency and on the single-process web
pod's event loop.

### ⭐⭐ Why the sidecar is not new infrastructure

`api/services/cot_prewarm.py` **already shells out to a Node bundle in
production** — `app/dist/cot-facts.cjs`, built by `npm run build`, invoked as
`node cot-facts.cjs facts < stdin`, with `COT_NODE_BIN` / `COT_FACTS_BUNDLE`
overrides and graceful degradation when node or the bundle is missing. Its
docstring gives the reason in the same words this decision uses: **so Python never
re-implements the analytics.**

`nixpacks.toml` already installs `nodejs_20` (the SPA build needs it), so `node`
is on the production image by construction.

The runtime sidecar is therefore an **upgrade of an existing shipped idiom** —
one-shot invocation becomes a long-lived process, because a scan is thousands of
calls rather than one — not a new deployment topology. **This is what makes
Phase 2B safe to proceed under §69 without a stop.**

---

## 2. THE MEASUREMENTS THAT DECIDED IT (§6, §73.4)

`tools/c4_phase2a_runtime_spike/` — one ISA (`isa.md`), one assembler
(`program.mjs`, so nobody hand-encodes "the same program" twice), and the same
program executed by a JS dispatch loop (`vm.mjs`) and a Python one (`vm.py`).

**The program is deliberately a composite:** persistent state (`var`/`:=`), a
real loop via `JUMP_IF_FALSE`, history reads whose offset is the loop counter (so
no host can hoist them), array mutation across bars, and **`na` modelled as NaN
propagation on every arithmetic op**. Phase 1's probe skipped that and said so;
this is why these per-instruction numbers are larger and why they are the honest
ones. 37 instructions of code, **307 executed instructions per bar.**

### Agreement control — run before any timing was read

```
steps js/py     92,100 / 92,100   MATCH
values          bit-identical, max abs diff 0.0
NaN pattern     identical (first 20 bars NaN — history unavailable inside the loop)
```

### Dispatch cost

| host | bars | steps | median | ns / instruction |
|---|---|---|---|---|
| node v24 | 300 | 92,100 | 0.51 ms | **5.5** |
| python 3.14 | 300 | 92,100 | 16.91 ms | **183.7** |
| node v24 | 5,000 | 1,535,000 | 9.50 ms | 6.2 |
| python 3.14 | 5,000 | 1,535,000 | 281.13 ms | 183.1 |

**Python is 33× Node on identical bytecode.** The Python loop is not a strawman:
every hot name is bound to a local, the stack is a preallocated list with an
explicit index, and `x != x` replaces `math.isnan`.

### The sidecar, measured from the Python side

| | |
|---|---|
| spawn | **4.0 ms** |
| first ping (module load + JIT) | **32.3 ms** — once per pod, not per scan |
| round-trip floor (ping) | **34.8 µs** median, 92.5 µs p95 |
| 5,000 symbols × 300 bars, bars already Node-side | **1.50 s** wall, **0.3 ms total IPC overhead** |
| 5,000 symbols × 300 bars, bars shipped as JSON per symbol | **4.0 s** (0.80 ms/symbol, compute included) |

### The comparison that settles it

| architecture | 5,000 symbols × 300 bars, one program |
|---|---|
| Python dispatch loop (two implementations) | **84.5 s** |
| **JS runtime via Node sidecar, bars shipped as JSON** | **4.0 s** |
| JS runtime via Node sidecar, bars resident Node-side | 1.5 s |

**21× end-to-end, including serialization, with the IPC cost immeasurably small
next to the dispatch cost.** ⚠️ These are single-threaded and on a dev box; they
are a *decision-grade comparison between candidates*, not a production budget.
The production gate is §7's benchmark set, re-run on the pod.

---

## 3. THE ARCHITECTURE (§74)

```
                         PINE SOURCE (+ declared version)
                                     │
        ╔════════════════════════════▼════════════════════════════╗
        ║  ONE SEMANTIC FRONT END  (§3 — no second parser, ever)   ║
        ║  lex → parse → name/scope resolution → type & semantic   ║
        ║  analysis → CANONICAL SEMANTIC IR (typed, version-aware) ║
        ╚═══════════════╦════════════════════════════╦════════════╝
                        │                            │
             provably pure & total          anything else
                        │                            │
        ┌───────────────▼──────────┐   ┌─────────────▼───────────────────┐
        │  PURE LOWERING           │   │  PROGRAM LOWERING               │
        │  → V2 canonical graph    │   │  → bounded flat program (IR)    │
        │  (UNCHANGED, ×48 compact)│   │  scopes · frames · state ·      │
        │                          │   │  loops · arrays · object refs   │
        └───────────────┬──────────┘   └─────────────┬───────────────────┘
                        │                            │
        ┌───────────────▼──────────┐   ┌─────────────▼───────────────────┐
        │ COLUMNAR EVALUATORS      │   │ BAR-BY-BAR RUNTIME (JS)         │
        │ interpret.js (browser)   │   │ browser: native                 │
        │ ast_interpret.py (screen)│   │ screener: Node sidecar          │
        └───────────────┬──────────┘   └─────────────┬───────────────────┘
                        └──────────┬─────────────────┘
                                   │  ⇅ GRAPH-vs-RUNTIME DIFFERENTIAL RAIL (§12)
                                   ▼
        output series · presentation program · OBJECT PROGRAM (C3B, driven not rebuilt)
                                   ▼
                            CHART            SCREENER
```

**Ownership boundaries.** The front end owns *meaning*. Lowering owns *strategy*.
The graph owns pure dataflow. The runtime owns program order, state and
lifetime. The presentation and object programs own *appearance* and are driven by
both lanes identically — the runtime emits `create/update/delete` into C3B rather
than knowing what a line is.

**⛔ The lowering choice is semantic, never heuristic.** A subprogram takes the
graph lane only when the front end can *prove* it pure and total: no assignment
after use, no persistence, no loop, no array, no object mutation, no ordering
dependence. Anything else — including anything merely *unproven* — takes the
runtime. A wrong answer here is a silent wrong number, so the default is the
runtime and the graph lane is the earned exception.

---

## 4. WHAT PHASE 2B WILL BUILD, AND WHAT IT MUST ALREADY ACCOUNT FOR (§9)

Implementation is staged; **the architecture is not.** The value model, frame
model and program representation below are designed for the whole target surface
now, even where opcodes land later.

### Value model (§15)

A runtime value is a **tagged** value, never a bare host number:

```
{ NA, INT, FLOAT, BOOL, STRING, COLOR, ARRAY_REF, OBJECT_REF, TUPLE }
```

⛔ **`na` is a TAG, not NaN** (§16). NaN is how a *float* says "not computable";
`na` is how *any* Pine type says it, including a string, a colour and an object
reference — and `na(someLine)` is a question the columnar model literally cannot
ask. Float values still carry NaN internally so arithmetic stays IEEE-identical
to the columnar lane (that is what the differential rail checks), but the tag is
what branches, comparisons and `nz` read.

⭐ Numeric storage stays `Float64` in the hot path with the tag alongside, so the
common case does not pay boxing. This is a measured-later decision: if tagging
costs more than the spike's 5.5 ns/instruction budget allows, the fallback is a
NaN-boxed representation, and that choice is deferred to a benchmark rather than
a preference.

### Frames and scopes (§19)

- **global program state** — persistent slots, one set per (program, symbol)
- **bar frame** — locals, reset each bar
- **call frame** — arguments, locals, and *its own persistent slots*, because
  Pine's function-local `var` persists **per call site**, not per function
- **shadowing** is resolved statically in the front end; two same-named locals in
  different scopes get different slots and can never alias

### History (§20)

Ring buffers per history-bearing value, sized by a static `maxLookback` the front
end computes — the same measurement the columnar lane already trusts, reused
rather than reinvented. Insufficient history yields `na`, never a fabricated
number.

### Resource model (§33, §34)

Accounted per execution, with a structured failure for each:
`PROGRAM_SIZE` · `IR_SIZE` · `INSTRUCTIONS_PER_BAR` · `TOTAL_INSTRUCTIONS` ·
`LOOP_ITERATIONS` · `LOOP_NESTING` · `CALL_DEPTH` · `ARRAY_ELEMENTS` ·
`ARRAY_OPERATIONS` · `LIVE_OBJECTS` · `OBJECT_OPERATIONS` · `HISTORY` ·
`REQUEST_COUNT` · `REQUEST_FANOUT` · `MEMORY` · `WALL_TIME`.

⛔ The columnar lane's `maxLookback` tree-sum **is not carried over as the
bound** — it measured a property of an expression and means nothing about a loop.
Its *intent* (a static, provable ceiling before execution) is carried over: the
front end computes a static worst case, and the runtime counts against it at
execution. Exceeding any limit is a named failure, never a truncated series.

### Realtime (§30) and MTF (§31) — designed now, staged later

The bar loop takes an explicit **execution context** rather than a flat array, so
a forming bar can be re-executed, a confirmed bar committed, and a requested
series supplied by a resolver the runtime calls rather than assumes. Neither is
implemented in 2B; both are why the loop signature is what it is.

---

## 5. PERSISTENCE, VERSIONING, COMPATIBILITY (§40–43)

- **A saved indicator persists PROGRAM SEMANTICS, never runtime state.** Reopening
  recomputes deterministically from bars.
- **Legacy V1/V2 documents are untouched and keep their evaluator.** A document
  gains a `kind` discriminator; absent means "the graph document it has always
  been", so every existing definition loads byte-identically and no migration
  runs. Backward compatibility by construction, not by a migration script.
- **New artifacts carry an explicit runtime/compiler version** so bytecode is
  never implicitly tied to whatever the source happens to be today. Old artifact
  + new runtime is a detected, named condition with recompile-from-source as the
  remedy.
- **Hashes** (§43): the graph document hash is unchanged for unchanged documents.
  A new program hash covers *semantics*, not layout, so a compiler change that
  emits equivalent code must not re-key an indicator. Parameter trust and
  anti-tamper guarantees carry over unchanged.
- **Rollback** is stopping emission of the new kind. Nothing to undo.

---

## 6. THE GRAPH-vs-RUNTIME DIFFERENTIAL RAIL (§12) — hard prerequisite

Before the runtime is authoritative for anything, every program representable in
both lanes must agree. Coverage: arithmetic, comparisons, booleans, `na`,
history, the moving-average family and other closed-table builtins, parameters,
multiple outputs, and tuples once they exist. Tolerance is the existing 1e-9, and
**bit-identity where the columnar lane already guarantees it**.

⛔ Its purpose is not to prove the runtime works. It is to stop the runtime from
quietly becoming a **second interpretation of already-settled Pine behaviour** —
the exact defect the `%` lowering avoided in Phase 1 by refusing to mint a second
arithmetic authority.

---

## 7. THE PERFORMANCE GATES PHASE 2 MUST PASS (§76)

Not aspirations — gates, measured on the pod, per program class
(pure simple · stateful simple · UDF heavy · loop heavy · array heavy · object
heavy · composite complex) at 300 and 5,000 bars, single chart and representative
multi-symbol scan, p50/p95 where a population exists.

Provisional targets from the spike, to be confirmed or corrected by real
measurement:

| | target |
|---|---|
| single chart, composite program, 5,000 bars | < 50 ms |
| parameter change → repaint | < 50 ms |
| whole-market scan, 5,000 × 300, one program | < 10 s |
| sidecar readiness | < 100 ms, once per pod |

⚠️ **Do not optimize before semantics (§38).** No reordering that changes
floating-point results, initialization, state or object timing. Where Pine's
execution order is observable — loop accumulation especially (§39) — the runtime
matches source order rather than a mathematically equivalent reduction.

---

## 8. OPEN ITEMS CARRIED INTO 2B

- **Negative-modulo vendor pin (§14).** Phase 1 lowered `%` onto `mod`
  (truncated, sign follows the dividend) from documentation plus the table's
  existing semantics. TradingView evidence must pin it.
- **Value-tag vs NaN-boxing** — deferred to a benchmark.
- **Sidecar lifecycle** — supervision, restart, and what a screener does when the
  sidecar is unavailable. The `cot_prewarm` precedent degrades gracefully to
  "skipped"; a screener cannot, so this needs a real answer in 2B.
- **Bars transport** — 4.0 s at 5,000 symbols with JSON is acceptable; a binary
  frame would cut it further and is an optimization, not a prerequisite.

---

## 9. STATUS — 2D-1 (state and control flow execute)

`runtime/ir.js` is the artifact Phase 1 proved did not exist: **statements and
expressions as different kinds**, with slot-resolved variables (never names), and
loops / functions / tuples / arrays / object ops declared but not yet lowerable so
the shape cannot need re-cutting when they land. `runtime/lowerIr.js` lowers it;
`runtime/vm.js` executes it.

**Implemented and conformance-tested (43 cases across two files):**

| | |
|---|---|
| `var` — a value that survives the bar | ✅ |
| `:=` reassignment | ✅ |
| bar-local frame, reset each bar | ✅ |
| `if` / `else` as **statements that mutate** | ✅ (nested too) |
| `na` does not take a branch | ✅ |
| state accumulating a columnar-lane column | ✅ |
| resource stop by name | ✅ |

⭐⭐ **`var` initialises once STRUCTURALLY.** `JUMP_IF_INIT` jumps *over* the
initialiser, so it is not merely stored once — it is not **evaluated** again. C3B
paid for the other design: `var table t = table.new(…)` emitted unguarded minted a
new table every bar and blew an 8-table envelope by bar 8, with every runtime unit
test green. Initialisation is also tracked **separately from value**, because
`var float x = na` is real Pine and "is it still NaN" cannot answer "has it been
initialised".

⛔ **Named gaps, refused rather than approximated:** history over a *variable*
(`x[1]` needs a per-slot ring buffer written at end of bar — 2E), expression
statements (nothing has an effect yet), and every reserved opcode.

⚠️ **The front end is still 2D-2.** `lower.js` consumes the canonical expression
tree and `lowerIr.js` consumes hand-built IR; the path from `pine.js`'s statement
tree — `{header, body}` at every level, which it already builds — into the IR is
the next piece. Until it lands, no Pine *source* reaches the runtime, and corpus
acceptance is unchanged by design (§48).
