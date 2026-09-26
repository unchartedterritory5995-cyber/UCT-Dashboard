---
id: PACKET-O
title: The unpublished screener methodology — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET O — closing the scorecard's sharpest line, which the product already fixed and never shipped

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-22
APPROVED AT SHA:  fd57fe079
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this connection.
> **Non-collision:** `PACKET-O` appears nowhere in either worktree (checked before writing this
> file — `PACKET-K` is taken by an unrelated 2026-09-14 packet).

⛔ **ZERO NEW BACKEND CODE.** The endpoint, the data, and the published caveats all already exist,
correct and tested. This packet builds one panel + one toolbar button, following an exact,
already-shipped precedent in the same file.

---

## 1 · The gap, checked directly against source

`GET /api/screener/methodology` (`api/routers/screener.py:137-153`, backed by
`api/services/screener/methodology.py`) already publishes, for all 9 screener composite columns
(`uct_composite` + 6 rating components + `rs_rank` + `accdis`), exactly how each is computed:
weights, bands, and a mandatory `caveat` field for every entry — plus a `not_claimed` list on the
composite itself ("It is not a price target... not comparable across companies whose basis
differs... not an intraday reading"). The module's own docstring frames the stakes precisely:
this is "benchmark metric 552" and the specific line a competitor scorecard used against this
product — *"the composites the benchmark already scored... are ALSO the ones we cannot check —
a member must simply trust them."*

**Verified the data cannot silently drift from the computation it describes:** every weight/band
is read live from `api.services.research.ratings` at call time, never retyped or bound at import —
confirmed by reading the module's own header comment and `_weights()`'s implementation, and backed
by an existing test (`tests/test_screener_methodology.py::test_the_published_weights_ARE_the_live_
constant`, which moves the real constant and watches the document follow).

**Checked directly: this endpoint has ZERO frontend callers anywhere in `app/src`.** Grepped every
casing of `methodology`/`screener/methodology` in `app/src/pages/screener/**` and
`app/src/components/screener/**` — no hits. The one existing `/methodology` frontend route
(`Methodology.jsx`) is a hard-coded static page about a different subject (Earnings Setup
Grade / UCT Rating) with no fetch at all — not a collision, not a false negative.

**A working precedent for exactly this shape already ships in the same shell:**
`StructureProvenance.jsx` publishes a parallel kind of previously-unreachable research (the base
structure library's provenance/refusals) via a "Structure library" toolbar button
(`ScannerShell.jsx:283-285`) that opens a `Sheet` modal. This packet is the same idiom for the
methodology data, sitting in the same toolbar.

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One new panel component + one new toolbar button on `ScannerShell.jsx`, first frontend coverage of the endpoint | none | **S** |

### MUST-BUILD, exactly

1. **`app/src/components/screener/MethodologyPanel.jsx`** (new file): fetches
   `/api/screener/methodology` on mount (same `useEffect` + loading/error-state idiom as
   `StructureProvenance.jsx` — a failed fetch reports an error, never renders an empty library).
   Renders `data.as_of_note` once at the top, then each entry from `data.methods`: `label`,
   `one_line`, `scale`, `how`, and — **never optional, never collapsed by default, matching the
   `StructureProvenance` precedent that caveats are first-class, not footnotes** — `caveat`. The
   composite entry (`uct_composite`) additionally has `components` (render as a compact weight
   breakdown) and `not_claimed` (render as its own explicit list, same "the refusals are the part
   nobody else ships" principle).
2. **`app/src/components/screener/MethodologyPanel.module.css`** (new file): its own stylesheet;
   may share visual language with `StructureProvenance.module.css` but is not required to reuse it
   verbatim.
3. **`ScannerShell.jsx`**: add a `methodologyOpen` state var and a second toolbar button
   ("Methodology", reusing the `styles.toolBtn` class already used by "Structure library") that
   opens a second `Sheet` containing `<MethodologyPanel />` — same `open={} && <Component/>`
   mount-gating pattern already used for `libOpen`/`StructureProvenance`.
4. **`app/src/components/screener/MethodologyPanel.test.jsx`** (new file): renders real and
   error-state data, asserts every entry's `caveat` is present in the DOM (never hidden/truncated),
   asserts the composite's `not_claimed` items render as their own list.

### Explicitly deferred, NOT authorized by this line

- Per-column info icons on the results-table headers (a richer, more discoverable placement) —
  a real possible follow-up, but it touches the results-table rendering itself, a larger and
  more invasive surface than a toolbar button. This packet takes the narrower, already-precedented
  path.
- Any change to `methodology.py`, its weights/bands, or the underlying `ratings` module.
- Any change to `StructureProvenance.jsx` itself — this packet adds a sibling, never edits it.

### Risk

**Low.** No backend change, one new toolbar button + panel following an exact existing pattern in
the same file. Worst case is a panel that fails to render inside a Sheet that already handles a
failed fetch gracefully (per its own precedent) — no regression to any existing screener feature.
