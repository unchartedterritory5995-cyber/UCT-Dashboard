---
id: GATE-D2-F-D2-1-FUNDAMENTALS-DECLARATION
title: D2 follow-up — F-D2-1, the fundamentals declaration (named by finding, not a CP
  number, deliberately — see "Why this file is named this way" below)
role: Narrow pre-implementation review packet, closing a finding D2 CP2 recorded but did
  not fix, once this pass confirmed the fix is actually writable
phase: 3.5 (pre-implementation, not implementation)
date: 2026-09-22
status: PROPOSED — not signed.
sources: docs/terminal-research/12-decisions/gates/d2-canonical-data-model-pre-implementation-gate.md
  (§CP2.2 "F-D2-1 — RECORDED, NOT FIXED", the finding this proposal closes),
  docs/terminal-research/00-program-control/COMPLETION_AUDIT.md (F-D2-1's row, §260),
  docs/terminal-research/00-program-control/LEDGER.md:1585-1591 (the "fundamentals has
  ten names BECAUSE it has no declaration" framing), plus this pass's own direct reads
  of api/services/fundamentals_snapshot_store.py (the fund_snapshots schema),
  api/services/earnings_table.py (the _build() function, _PAYLOAD_VERSION, the
  reported/forward quarterly branches), api/services/annual_financials.py (the annual
  row shape, both actuals and estimates), api/routers/fundamentals.py (the fund_snapshot_v3
  kind, read as a second data point corroborating no cross-kind shape leakage),
  tools/build_canonical_address_book.py (bars_store(), the pattern this proposal ports),
  api/services/canonical/address_book.py, api/data/canonical_address_book.json,
  tests/test_canonical_address_book.py. No application code was modified to produce
  this packet.
---

# D2 follow-up — the fundamentals declaration (closes F-D2-1)

## Why this file is named this way

D2's own checkpoint numbering has two tracks that have already drifted once (F-D2-2's own
closure was about exactly this: a "§9.5 CP1" name that turned out to be "GATE-D2 CP4").
Rather than guess whether this is "top-level CP4" or "§4-CP5" or something else, this
proposal is named after the finding it closes, `F-D2-1`, which is unambiguous and already
exists in the audit. If the owner wants it renumbered into one of the sequences at signing
time, that is a one-line edit to the `SCOPE APPROVED:` text, not a re-derivation.

## APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-22
APPROVED AT SHA:  454e11421
SCOPE APPROVED:   D2 follow-up (closes F-D2-1) -- the fundamentals declaration, per docs/terminal-research/12-decisions/gates/d2-f-d2-1-fundamentals-declaration-scoped-proposal.md section 2. MUST BUILD: one new declaration function, earnings_table_store(), in tools/build_canonical_address_book.py alongside the existing bars_store() -- AST-derived from earnings_table.py's _build() dict-literal assembly plus annual_financials.py's actual/estimate row builders and the two quarterly branches, never hand-typed key names; new table-qualified entries in api/data/canonical_address_book.json for the earnings_table kind only (cannot collide with the 137 screener names or the 5 existing ohlcv.* names); tests/test_canonical_address_book.py extended with a derivation-matches-checked-in-book test and a mutation test proving the new declaration can fail. SHOULD BUILD: none. EXPLICITLY DEFERRED, NOT AUTHORIZED BY THIS LINE: migrating any fundamentals reader onto the declared shape; declaring any of the other four fund_snapshots kinds (fund_snapshot_v3, earnings_intel_v10, fin_stmts_v2, research_snapshot); resolving CP2.1's cross-module vocabulary divergence (the "ten metric spellings" finding). No schema change on any live store. No new computation.
```

No field above is filled in. This packet proposes exactly one checkpoint (section 2);
nothing in it authorizes writing product code beyond that scope.

---

## 1. Why now

D2 CP2 declared `bars_sqlite`'s `ohlcv` table into the canonical address book by reading its
`CREATE TABLE` DDL with AST — no names typed, no schema touched. It could not do the same for
fundamentals: `fund_snapshots` is `(kind, ticker, payload, ttl, updated_at)`, a JSON blob with
zero per-metric SQL columns, so there is no DDL to read. CP2's own packet recorded this as
**F-D2-1** and explicitly declined to fix it inside CP2's scope: *"the prerequisite is a
declaration in `earnings_table.py`, not a bigger builder... sized separately; it is not CP2."*

This pass answered the question CP2 left open — **is that declaration honestly writable, or
would it freeze a real inconsistency at the address layer?** — with a direct read of the code
that populates `fund_snapshots`, not an assumption:

- `fund_snapshots` is genuinely polymorphic **across** `kind` values (five different kinds
  share the table: `fund_snapshot_v3`, `earnings_intel_v10`, `earnings_table`, `fin_stmts_v2`,
  `research_snapshot`) — but that is expected and irrelevant; the address book declares one
  store's shape at a time, the same way it declares `ohlcv` without needing to know about
  `screener_rows`.
- For the `earnings_table` kind specifically — the one F-D2-1 names — the payload is built by
  exactly **one** function (`earnings_table.py::_build`, lines 538-560), which always emits a
  fixed 6-key top-level shape (`ticker, annual, quarterly, reported_through, stale_quarters,
  _v`). `annual[i]` rows are one uniform 9-key shape regardless of source (FMP/yfinance/rollup/
  estimate all funnel into the same shape before assembly, `annual_financials.py:319-350`).
  `quarterly[i]` rows are a clean two-branch discriminated union keyed on the boolean
  `reported` — 8 fixed keys per branch, never a third shape.
  There is no evidence of ticker- or source-dependent key variation **inside** one kind — the
  module already tracks a `_PAYLOAD_VERSION` (`earnings_table.py:69`) and its own comment
  instructs bumping it "whenever the payload SHAPE changes," which is the same shape-versioning
  discipline the address book already assumes for a declared store.
- What CP2.1's own "ten metric spellings" measurement found is cross-module **vocabulary**
  divergence (different files calling the same concept `revenue`/`sales`/`rev_actual`), not
  shape instability inside one persisted snapshot. Those are different facts, and only the
  second would make a declaration dishonest. It is the first.

So the prerequisite F-D2-1 named is met: the shape is stable and can be declared without
inventing a name nobody already uses, the same standard CP2 held `ohlcv` to.

## 2. Exact scope

**MUST BUILD** (the smallest change that declares `earnings_table`'s shape the way `ohlcv`'s
was declared, and nothing more):

- **One new declaration function**, `earnings_table_store()`, in
  `tools/build_canonical_address_book.py`, alongside the existing `bars_store()`. Unlike
  `bars_store()` (a regex/AST read of one `CREATE TABLE` string), this one reads the fixed key
  literals out of `earnings_table.py::_build`, `annual_financials.py`'s actual/estimate row
  builders, and the two quarterly branches — by AST over the dict-literal assembly, never by
  typing the key names into the builder by hand. The builder's existing refusal discipline
  applies unchanged: an empty scan, an unrecognized shape, or a branch the builder can't
  resolve fails rather than guesses.
- **New entries in `api/data/canonical_address_book.json`** under a `fundamentals` (or
  `earnings_table`, matching the store's own module-qualified naming convention CP2 already
  set for `ohlcv.*`) namespace — table-qualified, so they cannot collide with the 137 screener
  names or the 5 `ohlcv.*` names CP2 already added.
- **`tests/test_canonical_address_book.py` extended** with the same two rail shapes CP2 already
  proved for bars: a derivation-matches-checked-in-JSON test (`--check` re-run on every test),
  and a mutation test proving the new declaration can fail (rename a key in the fixture,
  confirm the rail reds).

**SHOULD BUILD:** none, matching the same house convention CP2 itself followed (declare the
shape; do not migrate a reader in the same breath as a SHOULD).

**DEFER (named, not silently dropped):**

- **Migrating any actual fundamentals reader onto the declared shape**, the way CP2's own
  MUST-BUILD migrated `ticker_returns.py` onto the bars declaration. Declaring the shape and
  changing what reads it are two different acts; CP2 kept them separate on purpose (a `MUST`
  can declare, a later `MUST` can migrate) and this proposal follows the same split.
- **Declaring the other four `fund_snapshots` kinds** (`fund_snapshot_v3`,
  `earnings_intel_v10`, `fin_stmts_v2`, `research_snapshot`). This proposal is scoped to the
  one kind F-D2-1 named; each of the others would need its own shape-stability check before
  being declared, not an assumption that "fundamentals" is one thing.
- **Resolving CP2.1's cross-module vocabulary divergence** (the "ten metric spellings"
  measurement). A declaration says what one store's shape IS; it does not rename anything
  anywhere else that already calls the same concept something different.

## 3. Current state → target state

**CURRENT STATE**, confirmed this pass:

| Component | State |
|---|---|
| `fund_snapshots(kind, ticker, payload, ttl, updated_at)` | Real, JSON-blob-per-row, 5 kinds share it |
| `earnings_table` kind's payload shape | Stable, single-function-built, versioned internally (`_PAYLOAD_VERSION`), never declared in the address book |
| `api/data/canonical_address_book.json` | Has `ohlcv.*` (5 metrics, from CP2) + 137 screener scalars; nothing for fundamentals |
| `tools/build_canonical_address_book.py` | Has `bars_store()`; no equivalent for any JSON-blob store |

**TARGET STATE**: `earnings_table`'s shape is declared in the address book, derived by AST
from the code that actually builds it, with the same "no schema change on any live store, not
one line of SQL edited" guarantee CP2 gave for bars — because there is no SQL to edit here
either.

**THE GAP**: exactly the MUST-BUILD list in section 2 — one declaration function, one set of
book entries, the rail extended.

## 4. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A future change to `_build`'s key set silently goes undeclared | The address book would describe a shape the store no longer has — the exact defect a declaration exists to prevent | The derivation is AST-read, not hand-typed, and the `--check` rail fails the build the day the shapes diverge, mirroring CP2's own bars rail |
| Treating cross-kind polymorphism as an argument against declaring anything | Would wrongly extend F-D2-1's "not fixed" verdict past the one kind that IS stable | Section 1 states the distinction explicitly: cross-kind variation is irrelevant, within-kind stability is what was checked, and only `earnings_table` was checked |
| Scope creep into migrating a reader | Turns a small, safe declaration checkpoint into a larger one touching a live fundamentals endpoint | Named explicitly in section 2 DEFER |

## 5. Test & acceptance plan

| Test | Proves |
|---|---|
| `test_earnings_table_store_derivation_matches_checked_in_book` | The `--check` re-derivation of `earnings_table_store()` against the committed `canonical_address_book.json` produces byte-identical output |
| `test_earnings_table_store_derivation_CAN_FAIL` | A mutation (renaming a key in a fixture copy of `_build`'s assembly) reds the derivation rail — mirrors `test_the_derivation_rail_CAN_FAIL` for bars |
| `test_earnings_table_metrics_are_table_qualified` | The new entries cannot collide with the 137 screener names or the 5 existing `ohlcv.*` names |
| `test_no_schema_change_on_fund_snapshots` | A structural check (e.g. `PRAGMA table_info` unchanged, or an AST sweep confirming no `ALTER TABLE`/new column in the diff) that this checkpoint touched no live store |

## 6. Owner-bound questions

None. This proposal answers the one question CP2 left open (is the declaration writable) with
a direct code read, not an assumption. The only remaining decision is whether to authorize the
scope in section 2, which is what signing this packet does.
