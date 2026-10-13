# A2 — Import value correctness: implementation plan

- **Date:** 2026-10-13
- **Status:** PLAN ONLY. The owner approved preparing this strategy, not implementing it. No runtime code, test, flag or configuration was changed, nothing was committed or pushed, and no production system was read.
- **Code read at:** `C:/w/ia0` (`fix/indicators-a0-safety` = master `1eba7c105c`, read-only). None of the files this plan touches has changed since the audit baseline `4a368e80ed`, so the line numbers in PA1 still hold.
- **Inputs:** `PHASE-A-DECISION.md` (§2.1, §2.2, §3 A2, D9–D14, D25, D27, D28) and `PA1-stoc-and-thinkscript-mtf.md`. The PA1 probes in `app/src/__audit_scratch__/phaseA-1/` (`detect.js`, `mtfMatrix.test.js`, `stocFixedReader.test.js`, `pa1_server_probe.py`) are the templates for the tests below.
- **Peers read without touching anything:** `C:/w/uie7` through `git diff origin/master...feat/uie-alert-coverage`, and `C:/w/rpw` through `git --no-optional-locks -C C:/w/rpw diff`.

## 0. Summary and new facts found while planning

A2 has two parts, and each can ship on its own:

- **A2a: TC2000 `STOC` + migration notice + screen re-key.** Nothing blocks it except owner approval.
- **A2b: thinkScript weekly/monthly.** Blocked on D12 (which basis) and D13 (the owner's thinkorswim capture).

Neither part changes any member's saved formula, armed alert or screen subscription unless the member clicks to correct it.

Planning turned up four facts the decision document does not have. All four come from reading the code; none was executed.

| # | Fact | Evidence | Consequence for A2 |
|---|---|---|---|
| F1 | **Nothing in the app writes `meta.repaintAck`**, the per-plot acknowledgement the alert lane needs before it will arm a `preview-repaints` plot | `grep repaintAck app/src` finds no writer. Gate: `alert_user_series.py:862-873` (`_ack_for`). uie7's own comment says the same: "the ALERT-arm acknowledgement (`meta.repaintAck`) has no surface that writes it" | With D12 **basis F** (`tf_live`), no member could arm an alert on any corrected thinkScript weekly/monthly import. Today they can (on wrong values). This is the decisive argument for **basis C** in A2 (§2.3) |
| F2 | **N11 (suspected): screen subscriptions on semantics-2 definitions never fire.** The client subscribes with bare `row.ast_hash` (`ScreensManager.jsx:705-720`). Since 2026-10-05 every new native save or maths edit is stored as semantics 2 (`user_definitions.py` P0G, `decide_semantics`), and the sweep files its results under `<hash>~s2` (`scan_evaluator.py:2568-2576`, `scan_definition.py:431-439`). `run_nightly` diffs the subscription's bare key (`screen_alerts.py:96-115, 217-247`) | No test covers semantics-2 screen alerts. A STOC correction is a maths edit, so it produces a semantics-2 version. If A2 only re-keyed the subscription, the alert would still go silent. A2 therefore derives the diff key from the live definition (§1.6). This needs an owner decision (O6) |
| F3 | The `_folds` disclosure channel already reaches thinkScript imports: `PineBox.jsx:330-338` calls `foldNotesForOutput(out)` on the thinkScript branch. `importOutcome` classifies every fold note as SEMANTIC (`importOutcome.js:93, 182-184`). Adding a `_folds` entry does **not** bump `tableVersion`; that only moves on interface changes (`closedTable.json:2, 36`) | The weekly/monthly disclosure needs no change to importOutcome's classifier, and existing share links are not invalidated (`resolve_share` refuses on a `tableVersion` change) |
| F4 | Reopening a formula in the Builder re-reads its source with the **current** reader, and Save stores that tree (`BuilderSheet.jsx:1364-1415`, `:1952-1990`) | After the STOC fix, *any* Builder save of an old STOC definition (a rename, a colour change) would apply the corrected maths. The Builder therefore has to say so before saving (§1.4) |

---

## 1. TC2000 `STOC` (A2a)

### 1.1 The fix and the legacy reading, in one commit

**The reader fix** (`app/src/components/chart/engine/ast/pcf.js:196`). Change `STOC.series` from `['close','high','low']` to `['high','low','close']`. Also correct the prose at `pcf.js:161-165`, which quotes the wrong tree.

**How the legacy reading is accepted.** It lives in a new module, `engine/ast/importAdvisories.js`, kept out of `pcf.js` so that `pcf.js` (also touched by A3) gets a one-line diff.

```js
// importAdvisories.js — a closed, dated list. Adding an entry needs owner sign-off (rail-pinned length 1).
export const PCF_LEGACY_READINGS = Object.freeze([Object.freeze({
  id: 'pcf-stoc-v1', dialect: 'pcf', family: 'STOC', fixedOn: '<A2a release date>',
  // An involution: swaps stoch(close,high,low,…) <-> stoch(high,low,close,…). In a PCF tree
  // every `stoch` node comes from STOC (PCF cannot name `stoch` directly).
  swap: swapStochRoles,                 // returns { ast, changed }
  isLegacyShape: isSwappedStoch,        // P1: args[0..2] = series close, high, low
})])

/** The single authority: is this (source, stored tree) pair an accepted alternate reading? */
export function acceptedAlternateReading({ dialect, parsedAst, storedAst, storedHash }) {
  if (dialect !== 'pcf') return null
  for (const r of PCF_LEGACY_READINGS) {
    const alt = r.swap(parsedAst)
    if (!alt.changed || astHash(alt.ast) !== storedHash) continue
    return { id: r.id, legacy: r.isLegacyShape(storedAst) }  // legacy=false only in a reverted build
  }
  return null
}
```

**Where it is wired** (`defSchema.js`):
- `validateAstCompute` (`:856-877`). On `astHash(parsed.ast) !== storedHash`, call `acceptedAlternateReading` with the dialect `readFormulaSource` returned (`:856`).
  - Accepted: push nothing to `errors`. If `legacy` is true, push `'pcf-stoc-v1'` to a new `legacy` collector.
  - Not accepted: the existing sentence, unchanged.
- `validateTrees` `sources[k]` loop (`:1000-1010`): the same rule per tree, using `trees[k]`.
- `validateCompute` (`:668`) and `validateDefinition` (`:2347`) thread the collector through. `validateDefinition` returns `{ ok: true, def, legacy: ['pcf-stoc-v1'] }` only when the collector is non-empty. The key is absent otherwise, so every existing `toEqual({ok, def})` test is unchanged.
- `nativeRegistry.registerDefinitions` (`:3164-3176`) passes `r.legacy` to `importAdvisories.noteLegacy(def, ids)`. That function records it in a module `WeakMap` keyed by the installed definition object. Nothing is added to the document, so `installKey` (`id@version#fn`) and the stored bytes are untouched.

**Restricting it to STOC.** Four conditions must all hold:
1. the source reads as PCF (`readFormulaSource(...).dialect === 'pcf'`);
2. the swap changed at least one node, so a definition with no `stoch` can never pass through this path;
3. the stored tree's hash equals the swapped reading exactly;
4. the list holds exactly one entry.

Any other mismatch, including a PCF definition that also differs in some other way, is still refused with today's sentence. A native `stoch(close, high, low, 14)` typed by hand is dialect `native` and is never accepted as legacy. It needs its own lint, which is out of A2's scope (O8).

**How "saved before the fix" is known: by construction, not by a date.**
- A definition carries no reader-version stamp. `meta` has no PCF dialect stamp (`BuilderSheet.jsx:451-465` stamps Pine only), and `created_at` is not in the document.
- What proves it is the hash. After the fix, no client door can produce the swapped tree from PCF text. So a stored swapped tree beside PCF source was produced by the pre-fix reader: either before the deploy, or by a tab still running the pre-fix bundle.
- The only remaining way to create one is a stale tab after the deploy, and the server closes it (§1.2). Copies of pre-fix trees (share installs, forks, library installs) are genuine legacy and stay accepted.

**Rollback safety comes from the symmetry.** If the reader line is ever reverted on its own, `swap` maps the legacy parse back onto stored *corrected* trees, which are then accepted with `legacy: false` (no badge). Reverting that one line is therefore safe. Rolling Railway back to a pre-A2 image is not (§7).

### 1.2 Server: refuse new legacy STOC maths, detect the correction, carry name and reason

New module `api/services/legacy_readings.py` (pure; mirrors the JS predicate):
- `is_swapped_stoch(tree)`: P1.
- `has_pcf_stoc_source(compute)`: `(?i)\bSTOC\d` on `compute.source` and every `compute.sources[k]` (P1-src).
- `is_legacy_pcf_stoc(definition)`: P1 on `compute.ast` or any `compute.trees[k]`, and P1-src.
- `swap_stoch(tree)`: the involution. Its hash matches the JS rewrite byte for byte (PA1 measured `sha256:22a71bc4…b90d3 → sha256:8df85016…5bd563` for `STOC14.3 < 20`).

`api/services/user_definitions.py::save()` (`:1584`) gets three edits. All are in later phases than A0's depth check, which sits before `new_hash = ast_hash(...)` at about `:1720`.

1. **Gate, phase 1** (inside the lock, after `maths_moved` at about `:1865`). Refuse when all three hold:
   - `not _copy_of_stored`;
   - `legacy_readings.is_legacy_pcf_stoc(definition)`;
   - `prev is None` or the maths moved.

   The refusal is `SaveRefused("pcf", <sentence>, guard="pcf:stoc-legacy-reading")`, which the router already turns into a 422 (`routers/user_definitions.py:205-213`).
   - Result: a presentation-only re-save of a legacy definition (Agent edit, rename through any door that keeps `compute`) still passes, because its maths did not move. A stale tab's *new* STOC import, or its re-save of an already-corrected definition, is refused.
   - Sentence: *"This TC2000 STOC formula was read by an out-of-date copy of the app open in this tab, which had a known STOC error. Reload the page and save again. Nothing was saved."*
2. **Reason and name, phase 2** (`:1964-1972`). Compute the reason:
   - `reason = "pcf-stoc-v1"` when `prev_doc` is legacy, the new document is not, and swapping every previous tree gives exactly the new trees;
   - `reason = "pcf-stoc-v1+edit"` when `prev_doc` is legacy and the new document is not, but other maths changed too;
   - `reason = "edit"` otherwise.

   Then call `migrate_bindings_to_rev(..., name=meta.name, reason=reason)`.
3. **Screen re-key, a new phase 4b** after `alert_user_series.forget(user_id)` (`:2037`). If `prev["ast_hash"] != new_hash`, call `screen_alerts.rekey(user_id, def_id, prev["ast_hash"], new_hash)`.
   - Wrap it in `try/except`, log, and never raise: the append has already landed, and the nightly guard (§1.6) heals a failure.

`api/services/alert_rev_migration.py`:
- `migrate_bindings_to_rev(..., name=None, reason=None)` (`:276`): two new keyword-only arguments, copied into each payload (`:377-382`).
- `deliver_migration_notice` (`:241-273`) renders them using the copy in §1.5. `extra_data` keeps `address`, `indicator`, `from_rev` and `def_rev` unchanged, and adds `reason` and `name`.
- Ops and deploy callers pass neither argument and get today's wording, so nothing changes for natives.

### 1.3 The badge

The advisory lives in `importAdvisories.js`: `advisoriesFor(def)` returns codes, and `ADVISORY_COPY[code]` holds the strings. It is shown on three surfaces:

| Surface | File and function | What is shown |
|---|---|---|
| Chart Settings, "My formulas" row | `indicatorCatalog.js::rowFor(d, true)` adds `advisories`; `ChartSettingsIndicators.jsx` (short-badge helper near `:195` and the user-formula row) renders a short badge plus a **Review correction** button | Short badge: **"STOC fix available"** |
| Chart disclosure strip, for drawn instances only | `pane/AttachedPineDisclosures.jsx::attachedDisclosures` (`:150-170`) also pushes `ADVISORY_COPY[code].long` for each drawn definition | Long sentence |
| Builder, when the definition is opened | `BuilderSheet.jsx::openForEdit` (`:1373`) | Banner (§1.4) |

### 1.4 The one-click correction, through the existing revision path

No new write door. The Builder header rule is "ONE WRITE DOOR, NOT TWO".

1. **Review correction** (Chart Settings) calls `openForEdit(row, { intent: 'legacy-correction' })`.
2. `openForEdit` restores the rows exactly as today. Because the reader is fixed, `result.ast` is already the corrected tree, so the live preview draws the corrected line before anything is saved.
3. The banner shows the copy in §1.5 with a primary button, **Apply corrected STOC**. The button calls the existing `save()` (`:1952`) with no other change. That sends the existing PUT with `expectedVersion`, so a concurrent edit is a 409.
4. While the open definition carries `pcf-stoc-v1`, the ordinary Save button is relabelled **"Save with corrected STOC"** and shows the same consequence line. No Builder save of a legacy formula can happen without the member seeing it (F4).
5. Server: `maths_moved`, then `rev_bumped`, then `migrate_bindings_to_rev` (reset `last_value`, record the rev, suppress the first cycle, send a notice carrying the name and reason), then the append, `forget`, and the screen re-key.
6. The next client install validates the new version normally (corrected hash, no legacy entry), so the badge goes away.

**Self-check (fail-closed).** Before calling `save()`, the Builder checks that `astHash(result.ast) === astHash(swap(stored.compute.ast).ast)` for every tree. If they differ (the source also changed under another reader rule), the one-click button is replaced by: "This formula needs reviewing in the editor; the automatic correction cannot be applied." The definition is left untouched.

### 1.5 Copy (final strings)

| Where | String |
|---|---|
| Settings short badge | `STOC fix available` |
| Long advisory (chart strip and Settings detail) | `“{name}” was imported before {fixedOn} with a TC2000 STOC translation error: its stochastic was not the 0–100 %K TC2000 shows, and any alerts and screens on it use the same values. Open it and choose Apply corrected STOC to fix it.` |
| Builder banner title | `This formula uses the old STOC reading` |
| Builder banner body | `Before {fixedOn}, TC2000’s STOC was read with its price inputs in the wrong order, so this line was not a 0–100 stochastic. Applying the correction saves a new version: the line will change, alerts on it switch to the corrected values, clear their previous value and skip one check (you’ll get a notice for each), and screen results start fresh for the new version.` |
| Builder buttons | `Apply corrected STOC` · `Not now` · (Save, while legacy) `Save with corrected STOC` |
| Notice title (all reasons) | `{sym} alert on “{name}” updated`. Falls back to today's `{sym} {address} alert updated` when there is no name |
| Notice body, `pcf-stoc-v1` | `You applied the corrected TC2000 STOC reading to “{name}”. Its stochastic is now the standard 0–100 %K (before, its price inputs were in the wrong order). Your {sym} alert now runs the corrected calculation; its stored previous value was cleared and it will skip one evaluation so the change itself cannot look like a signal.` |
| Notice body, `pcf-stoc-v1+edit` | `You saved “{name}” with the corrected TC2000 STOC reading and other formula changes (revision {from} → {to}). Your {sym} alert now runs the new calculation; its stored previous value was cleared and it will skip one evaluation so the change itself cannot look like a signal.` |
| Notice body, `edit` (replaces today's address-only text) | `The formula behind “{name}” changed (revision {from} → {to}). Your {sym} alert now runs the new calculation, its stored previous value was cleared, and it will skip one evaluation so the change itself cannot look like a signal.` |
| 422, stale tab | §1.2 |

### 1.6 Screen subscriptions (N7, and F2/N11)

`api/services/screener/screen_alerts.py`:

- **`rekey(user_id, def_id, old_hash, new_hash)`**, new, and idempotent:
  ```sql
  INSERT OR IGNORE INTO screen_alert_subs (user_id, def_hash, def_id, name, mode, created_at)
    SELECT user_id, :new, def_id, name, mode, created_at FROM screen_alert_subs
     WHERE user_id = :u AND def_id = :d AND def_hash = :old;
  DELETE FROM screen_alert_subs WHERE user_id = :u AND def_id = :d AND def_hash = :old;
  ```
  - It is scoped by `def_id`, so another of the member's definitions that shares the old tree keeps its subscription.
  - The row key stays the **bare** `ast_hash`, because that is the client contract (`ScreensManager.jsx:708-720` subscribes, unsubscribes and shows state by `row.ast_hash`).
- **`run_nightly` guard** (after the existence check and live name, `:247-262`, before the S7/legacy branch):
  - `live_hash = doc["ast_hash"]`; `diff_key = user_definitions.result_identity(doc["definition"])`, the same identity `scan_evaluator.py:2574` files results under.
  - If `def_hash != live_hash`, re-key to `live_hash`, count it as `receipt["rekeyed"]`, and skip this subscription tonight: the old key's diff is the old maths, possibly another member's.
  - Otherwise diff `diff_key` instead of the stored key. This is what fixes F2 for semantics-2 definitions. Pass `diff_key` to `deliver_one` and to the dedup rows as well.
- **Shared hashes.** Results are de-duplicated across members by identity (`scan_evaluator.py:1985-2030`). After re-keying, a subscription never reads another member's old tree, which closes PA1 §1.5's "keeps firing on the old maths".
- **A0 coordination.** A0 is adding a read-only stale-subscription detector. A2 must use the same predicate: stale means `sub.def_hash != newest live ast_hash`, plus, for F2, `result_identity != sub.def_hash` when semantics is 2. A0 lands first, so A2 imports A0's predicate rather than restating it. If A0's detector is a `tools/` script with no importable function, A2 adds `screen_alerts.is_stale(sub, doc)` and A0's tool calls it at rebase.

### 1.7 What happens to each kind of stored object

| Object | On the A2a deploy | After the member clicks Apply |
|---|---|---|
| Saved PCF STOC definition | Still draws the legacy values (legacy reading accepted) and is badged. Stored bytes unchanged | New version with the corrected tree; badge gone. The old version stays in history (append-only) |
| Armed alerts | Unchanged: same captured tree, no notice, no reset. Chart and alert lanes keep agreeing | One `rev` migration: reset, one skipped cycle, notice with name and reason. `forget` forces re-admission on the new tree, including the cross-lane proof |
| Scan results, `scan_hits`, coverage, forward record | Unchanged (old identity) | New identity (`<new>~s2` for a semantics-2 version), so they start empty. Old rows stay under the old key. A screener chip holding the old hash goes stale, as it does after any edit today |
| Overnight screen subscription | Unchanged | Re-keyed in `save()`. The nightly guard heals any it missed |
| Share links (`definition_shares`) | The link keeps serving its pinned (legacy) version. Recipients install a legacy copy, which is badged | Unchanged until the author re-shares (today's rule: a link pins a version). The Builder success line adds "Shared? Share it again so the link carries the correction." when the definition has a live share |
| Library installs, forks | Copies of a legacy tree (`_copy_of_stored=True`) pass the gate and are badged | Each copy is corrected by its own owner |
| Chart templates, indicator templates, layouts | Reference `defId` only (`indicatorTemplates.js:14`; instances hold inputs only), so they are unaffected | They draw the newest version, so the corrected line |
| Agent edits | `applyPatch` validation accepts legacy. A presentation patch keeps the legacy tree, which passes the gate (maths did not move) | — |
| Hand-typed native `stoch(close, high, low, n)` | Not affected, not badged (dialect `native`) | — |

### 1.8 Version compatibility

| Situation | Behaviour | Severity |
|---|---|---|
| Old tab (pre-A2 bundle) with the new server: loading | Legacy definitions validate as before. A definition the member already corrected from a new tab is **refused in the old tab** (its old reader re-reads the source to the legacy tree) until reload. Alerts are unaffected | Low: only the same member's other open tabs. No reload-prompt mechanism exists in the app |
| Old tab with the new server: new STOC import or edit | 422 `pcf:stoc-legacy-reading` with the reload sentence. Nothing saved | Intended |
| New tab with the old server (deploy overlap or rollback) | Corrected saves are stored (the server never parses source). The migration notice uses the old wording. No re-key, so subscriptions go stale (the pre-existing gap) | Low |
| Web service deploy | Bundle and API ship in one image (`Dockerfile.web:147, 228`), so the client/server mismatch only comes from long-lived tabs | — |
| Flow worker | Runs `api/**` (screen alerts, alert evaluation). A2a changes `screen_alerts.run_nightly`, so a **flow-worker marker bump** is required (standing rule) | Required |

### 1.9 The one-deploy rule, enforced by a test

`app/src/components/chart/engine/ast/pcf.stocOneDeploy.test.js`:
- **Fixture** `tests/fixtures/ast/pcf_legacy_stoc_v1.json`, generated once from the pre-fix reader and committed with the hashes. It covers:
  - `STOC14`, `STOC14.1`, `STOC14.3`, `STOC14.3.1`;
  - STOC inside `AND`, `XUP` and `COUNTTRUE`;
  - lower case;
  - a multi-tree document with `sources`;
  - the PA1 pair `22a71bc4…b90d3` / `8df85016…5bd563`.
- **Rail 1.** If `PCF_FUSED.STOC.series` equals the manifest `argRoles` prefix (the fixed order), then:
  - every fixture document validates `ok` with `legacy: ['pcf-stoc-v1']`;
  - `installUserDefinitions` installs all of them;
  - `PCF_LEGACY_READINGS.length === 1`.

  This turns red on a reader-only fix and on any later removal of the acceptance.
- **Rail 2.** The same fixture through `legacy_readings.py` (`tests/test_legacy_readings.py`): the hashes after swapping match the JS hashes, and the save gate refuses each document as *new* maths while accepting it as `_copy_of_stored`.

Both rails must run in the deploy gate. A0 fixes the 0-vitest CI count (N10). A2's acceptance includes showing this test in the CI vitest count, and adding both files to the indicator rails `pre_push_guard` runs.

---

## 2. thinkScript weekly/monthly (A2b)

### 2.1 Period-lift pass: `app/src/components/chart/engine/ast/periodLift.js` (new, about 90 lines)

```js
export const PERIOD_LEAVES = new WeakSet()   // only translator-made period reads are lifted
export function markPeriodLeaf(node) { PERIOD_LEAVES.add(node); return node }
/** @returns {{ ast, lifted: Array<{tf}>, mixed: null | {tf: string[]} }} — never throws */
export function liftPeriods(ast, { basis, table })
```

- **Leaves.** `thinkscript.js::resolveCall` (`:3869-3871`) returns `markPeriodLeaf({type:'tf', value, args:[cSeries(field)]})`. A `WeakSet` adds nothing to the tree, so hashes are unaffected. thinkScript has no way to write `tf` directly, so only these nodes are ever lifted.
- **Period of a node:**
  - `P` for a marked leaf;
  - `base` for a `series` read;
  - `neutral` for `num` and folded inputs;
  - otherwise the join over its children: neutral ∪ X = X, and P ∪ Q (with P ≠ Q) = `mixed`.
- **Period-closed operators**, which may be lifted:
  - arithmetic `op` (`+ - * /`, unary minus);
  - pointwise math calls (manifest `lookback` 0);
  - windowed calls (manifest `lookback` > 0: `sma`, `ema`, `rma`, `highest`, `lowest`, `sum`, `stdev`, `rsi`, …);
  - `offset`.
- **Base-only operators**, never lifted and evaluated on chart bars: comparisons, `and`/`or`/`not`, `crossOver`/`crossUnder`, `if`/conditional, and the output root.
- **Lift rule.** Replace each maximal subtree made only of period-closed operators, whose non-neutral leaves are all period `P`, with `wrap(strip(subtree), P)`. `strip` replaces marked leaves `tf(f,P)` with `series f`.
- **`wrap`:**
  - **Basis C** (recommended): always `{type:'tf', value:P, args:[x]}`. When the subtree root is an `offset k`, the offset stays inside: `tf(x[k], P)`.
  - **Basis F:** an unshifted root becomes `tf_live(x, P)`; a root `offset k ≥ 1` becomes `tf(x[k-1], P)` (`[k-1]` dropped when k = 1). That form is non-repainting and equals the shifted forming read (PA1: 120/120).
- **Mixed refusal.** A windowed call or `offset` whose argument subtree is `mixed` sets `mixed`. The caller throws `thinkscript:aggregation-mixed`. Pointwise operators and base-only operators over mixed operands are allowed.
- **`sym`** cannot combine with `period =`: `foreignSeriesCall` returns one or the other, and that is unchanged.

**Wiring in `thinkscript.js::translateThinkScript`** (row map, `:4643-4668`):

```js
const raw = resolver.asNode(value, o.nameTok)
const lift = liftPeriods(raw, { basis: TS_PERIOD_BASIS, table })
if (lift.mixed) throw refuse('thinkscript:aggregation-mixed', o.nameTok)
const ast = lift.ast            // printOrRefuse / verifyRoundTrip / readsTheBar unchanged, on the lifted tree
… return { …, ast, thinkscriptSecondaryAggregation: lift.lifted.length ? lift.lifted : undefined, … }
```

`TS_PERIOD_BASIS` is a frozen constant in `periodLift.js`, set by D12. It is not a flag.

**The note travels through the existing `_folds` channel** (F3):
- `closedTable.json::_folds.thinkscriptSecondaryAggregation` holds `{kind:'fold', name, memberLabel, memberNote, _ruling, _row}`.
- A matching `accepted` row goes in `tests/fixtures/vendor/divergences.json` with `member_hook.kind: 'fold'`. `vendorTruth.test.js` and `test_vendor_truth.py` require that pairing.
- `foldNotesForOutput` (`parse.js:628-636`) and `ast_table.fold_notes` pick the entry up automatically.
- No `tableVersion` bump.

**`REFUSALS`** (`thinkscript.js:96-272`) gains `'thinkscript:aggregation-mixed'`, appended as the last entry.

### 2.2 Construct matrix after the fix (the PA1 30)

The "Basis C" and "Basis F" columns show the tree each basis emits. "Status" is the import outcome: "Disclosed" means DISCLOSED with the semantic fold note, and "Exact" is never shown for a period read.

| # | thinkScript | Basis C tree | Basis F tree | Status |
|---|---|---|---|---|
| 1 | `close(W)` | `tf(close,'W')` (unchanged) | `tf_live(close,'W')` | Disclosed |
| 2 | `high(M)` | `tf(high,'M')` | `tf_live(high,'M')` | Disclosed |
| 3 | `Average(close(W),10)` | `tf(sma(close,10),'W')` | `tf_live(sma(close,10),'W')` | Disclosed |
| 4 | `SimpleMovingAvg(close(W),10)` | refused `thinkscript:arity` (`displace`), unchanged | same | Refused (unrelated) |
| 5 | `ExpAverage(close(W),10)` | `tf(ema(close,10),'W')` | `tf_live(ema(…),'W')` | Disclosed (+ seed note) |
| 6 | `WildersAverage(close(W),10)` | `tf(rma(close,10),'W')` | `tf_live(…)` | Disclosed |
| 7 | `Highest(high(W),10)` | `tf(highest(high,10),'W')` | `tf_live(…)` | Disclosed |
| 8 | `Lowest(low(W),10)` | `tf(lowest(low,10),'W')` | `tf_live(…)` | Disclosed |
| 9 | `Sum(volume(W),4)` | `tf(sum(volume,4),'W')` | `tf_live(…)` | Disclosed |
| 10 | `StDev(close(W),10)` | `tf(stdev(close,10),'W')` | `tf_live(…)` | Disclosed |
| 11 | `RSI(price=close(W),length=14)` | `tf(rsi(close,14),'W')` | `tf_live(…)` | Disclosed |
| 12 | `BollingerBands(price=close(W),…)` | refused (`displace`), unchanged | same | Refused (unrelated) |
| 13 | `MovingAverage(SIMPLE, close(W),10)` | `tf(sma(close,10),'W')` | `tf_live(…)` | Disclosed |
| 14 | `MovingAverage(EXPONENTIAL, …)` | `tf(ema(close,10),'W')` | `tf_live(…)` | Disclosed (+ seed) |
| 15 | `close(W)[1]` | `tf(close[1],'W')` | `tf(close,'W')` | Disclosed |
| 16 | `close(MONTH)[2]` | `tf(close[2],'M')` | `tf(close[1],'M')` | Disclosed |
| 17 | `close(W) - close(W)[1]` | `tf(close - close[1],'W')` | `tf_live(close - close[1],'W')` | Disclosed |
| 18 | `Average(close(W) - open(W),10)` | `tf(sma(close - open,10),'W')` | `tf_live(…)` | Disclosed |
| 19 | `Average(close(W),10)[1]` | `tf(sma(close,10)[1],'W')` | `tf(sma(close,10),'W')` | Disclosed |
| 20 | `Highest(close(W)[1],10)` | `tf(highest(close[1],10),'W')` | `tf_live(highest(close[1],10),'W')` | Disclosed |
| 21 | `Average(Average(close(W),5),2)` | `tf(sma(sma(close,5),2),'W')` | `tf_live(…)` | Disclosed |
| 22 | `def w = close(W); Average(w,10)` | same as #3 | same as #3 | Disclosed |
| 23 | `input agg = WEEK; Average(close(period=agg),10)` | same as #3 | same as #3 | Disclosed |
| 24 | `ExpAverage(close(MONTH),6)` | `tf(ema(close,6),'M')` | `tf_live(…,'M')` | Disclosed (+ seed) |
| 25 | `volume(W) > Average(volume(W),10)` | `tf(volume,'W') > tf(sma(volume,10),'W')` | `tf_live` ×2 | Disclosed. The comparison stays outside, so it is still detected as a condition (`treeYieldsBool`) |
| 26 | `close / close(W)` | `close / tf(close,'W')` | `close / tf_live(close,'W')` | Disclosed |
| 27 | `close crosses above Average(close(W),10)` | `crossOver(close, tf(sma(close,10),'W'))` | `…tf_live…` | Disclosed. The cross is counted on daily bars (the note says so; vendor rule optional in D13) |
| 28 | `close(W) crosses above Average(close(W),10)` | `crossOver(tf(close,'W'), tf(sma(close,10),'W'))` | `…tf_live…` | Disclosed, same caveat |
| 29 | `Average(close - close(W),10)` | **refused** `thinkscript:aggregation-mixed` | same | Refused (D14) |
| 30 | `close > Average(close(W),10)` | `close > tf(sma(close,10),'W')` | `close > tf_live(…)` | Disclosed |

Basis C is uniformly one closed period behind thinkorswim's forming read (assuming D13 confirms "final value on history"), so relationships between terms are preserved. Basis F matches thinkorswim on every bar but carries `preview-repaints` wherever `tf_live` appears.

### 2.3 D12: both options

| | **Basis C, `tf` (recommended for A2)** | Basis F, `tf_live` |
|---|---|---|
| Values vs thinkorswim | One week (month) late on every bar, if D13 = FINAL. Exact on past bars if D13 = CLOSED | Matches on every bar (history = the week's final value) |
| Repaint | None | `preview-repaints` on each unshifted read. The save needs the existing preview acknowledgement (Builder `previewAcked`, `_admit_new_maths`) |
| Alerts | Armable, as today | **Not armable by any member** (F1: nothing writes `meta.repaintAck`). That needs an acknowledgement surface for arming, which interacts with uie7's per-plot repaint gate (`_repaint_refusals`) and is out of A2 |
| Backtest / forward record | Causal | Look-ahead on history |
| Existing tests | Bare-read rails (`thinkscript.aggregation.test.js:35-56`) stay valid | Bare reads change to `tf_live`, so those rails are rewritten |
| Note code | `_folds.thinkscriptSecondaryAggregation` (one channel; `memberNote` per basis below) | same channel, F note |

`memberLabel`: `Weekly/monthly reads (thinkScript)`.

`memberNote`, basis C, if D13 = FINAL (the expected result):
> This study reads a weekly or monthly series (`period =`). UCT computes the whole expression on weekly (monthly) bars, as thinkorswim does, but shows each week's value only after that week has closed — so this line is one week (one month) later than thinkorswim, and never shows a value before its week has closed. Crossings and comparisons with daily values are checked on each daily bar.

`memberNote`, basis C, if D13 = CLOSED:
> This study reads a weekly or monthly series (`period =`). UCT computes the whole expression on weekly (monthly) bars and shows the last closed week's value on each bar, as thinkorswim does on past bars. On the current, unfinished week thinkorswim shows the forming week and UCT shows the last closed one. Crossings and comparisons with daily values are checked on each daily bar.

`memberNote`, basis F:
> This study reads a weekly or monthly series (`period =`). UCT computes the whole expression on weekly (monthly) bars, as thinkorswim does. On the current week the value moves until the week closes (marked "may repaint"); on past bars each day shows that week's final value. Crossings and comparisons with daily values are checked on each daily bar. Alerts cannot be armed on this line yet.

If D13 = FORMING on history (week-to-date values on past bars), no UCT node reproduces it. Basis F is then unavailable, and basis C ships with: *"…thinkorswim shows the week so far on each day; UCT shows the last closed week."*

### 2.4 Mixed-period refusal (D14)

- `REFUSALS['thinkscript:aggregation-mixed']`: `this averages (or looks back over) a mix of daily and weekly or monthly values. thinkorswim does not publish how it combines the two inside one calculation, so UCT will not guess`.
- Suggestion, through the existing `personalisedSuggest` channel: `Move the weekly read outside the calculation — for example compare close with Average(close(period = AggregationPeriod.WEEK), 10) — or make every value inside it weekly.`
- A weekly-and-monthly mix inside one window is refused the same way.
- Only the row refuses; the other rows of the script still translate. It is not a hard guard.

### 2.5 Saved definitions: badge only where telemetry confirms, never rewritten

- **A translator fix changes nothing stored.** The saved text is native (`sma(tf(close,'W'),10)`) and re-parses to the same tree in every build (PA1 §2.2).
- **Server-derived advisory, using the `repaint_notice` precedent** (`routers/user_definitions.py:270-275`: "a derived field of the served row; the stored label is never touched"):
  - `legacy_readings.thinkscript_import_keys(user_id)` runs one indexed read-only query on `auth.db.landing_events` (`idx_landing_events_visitor`): `event = 'import_accepted' AND json_extract(props,'$.dialect') = 'thinkscript'`. It returns the set of `(def_id, def_hash)` pairs and is cached for each list call.
  - `list_definitions` (`:323-326`) passes the set to `_stamped(row, ts_keys)`. That adds `import_advisories: ['ts-mtf-v1']` when `(row.def_id, row.ast_hash)` is in the set **and** P2 holds on any tree. P2 is the subtree form: a windowed call or `offset` with a `tf`/`tf_live` in its argument subtree and no other `tf` between them.
  - The badge is fail-open: any error means no badge, which is today's state, and never a refused row.
- **Clears itself.** An edit or a re-import changes `ast_hash`, so the pair no longer matches.
- **Excluded by construction:**
  - Pine `ta.sma(request.security(…))` (telemetry dialect `pine`);
  - hand-typed `sma(tf(close,'W'),10)` (no telemetry);
  - stale-tab imports made after the deploy *are* included, which is correct: they carry the old tree.
- **Client.** `hooks/useUserDefinitions.js::useInstalledUserDefinitions` (`:335-377`) calls `importAdvisories.setServerAdvisories(rows)`. `advisoriesFor(def)` merges the server codes with the client's `pcf-stoc-v1`. Each surface in §1.3 renders it.
- **Re-import is not one click.** The thinkScript source is not stored (`ImportBox.thinkscript.test.jsx:215-258`), so the badge points to Import.
- **P2-only definitions (origin unconfirmed)** get no badge (O8).

### 2.6 Messaging (final strings)

| Case | Headline (existing `OUTCOME_LABEL`) | Reason / detail |
|---|---|---|
| Exact | `Exact import` is **never** shown for an output with a period read: the fold note is SEMANTIC | — |
| Approximate | `Imported, with disclosed differences` | `1 difference can change a value or when it appears` (existing generator), with the heading `Weekly/monthly reads (thinkScript)` and the basis `memberNote` (§2.3) |
| Refused (mixed) | `Not supported`, or `Partial import` when other rows translate | §2.4 refusal and suggestion |
| Saved definition, short badge | — | `thinkorswim weekly read — re-import` |
| Saved definition, long badge | — | `Imported from thinkorswim before {fixedOn}: a weekly or monthly value inside an average, high/low, sum or [n] was computed on daily bars, so this line is not the value thinkorswim shows. Alerts and screens on it use the same values. To correct it, paste the original thinkScript again in Import — the saved formula is not changed until you do.` |
| importOutcome fallback (§3) | — | `This study reads a weekly or monthly series; its values can differ from thinkorswim.` |

### 2.7 D13: the owner's capture in thinkorswim

This needs about 15 minutes, desktop thinkorswim, and no account trading permissions. **Report categories only** (the words the bubbles print, and yes/no answers), never prices, in line with the standing rule against printing market values.

1. **Charts** tab. Symbol `SPY`. Gear (Chart Settings) → **Time axis**: aggregation **Day**, time interval **1 Y**. **Equities**: *Show extended-hours trading session* **off**. Apply.
2. **Studies → Edit studies… → Create…** Name it `UCT_D13`, replace the template text with the script below, then **OK → Apply**.
   ```
   declare upper;
   input wed = 20260930;
   input fri = 20261002;
   def W  = close(period = AggregationPeriod.WEEK);
   def W1 = close(period = AggregationPeriod.WEEK)[1];
   def d  = GetYYYYMMDD();
   AddChartBubble(d == wed, high, if W == close[-2] then "W-Wed FINAL" else if W == close then "W-Wed FORMING" else if W == close[3] then "W-Wed CLOSED" else "W-Wed OTHER", Color.WHITE);
   AddChartBubble(d == wed, low, if W1 == close[3] then "W1-Wed PREV_WEEK" else if W1 == close[1] then "W1-Wed PREV_DAY" else if W1 == close[8] then "W1-Wed TWO_WEEKS" else "W1-Wed OTHER", Color.WHITE, no);
   AddChartBubble(d == fri, high, if W == close then "W-Fri THIS_WEEK" else if W == close[5] then "W-Fri CLOSED" else "W-Fri OTHER", Color.WHITE);
   AddLabel(yes, if W == close then "LIVE W = today" else "LIVE W != today", Color.WHITE);
   plot A10 = Average(close(period = AggregationPeriod.WEEK), 10);
   ```
   The dates are a normal five-day week (Mon 2026-09-28 to Fri 10-02) preceded by another normal week, so the `close[-2]`, `close[3]` and `close[8]` arithmetic holds. Negative offsets read later bars on history.
3. Scroll to 2026-09-28 to 10-02. Write down the three bubble words.
4. Read the top-left label during market hours, and again after the close. Write down both words.
5. **10-week average.** Open a second chart: `SPY`, aggregation **Week**, add the built-in study **SimpleMovingAvg** (price close, length 10).
   - Hover the weeks of **09-28** and **09-21** and note the two values privately.
   - On the daily chart, hover `A10` on **Wed 09-30** and **Fri 10-02**.
   - Report only, for each of the two days: "equals the 09-28 week / equals the 09-21 week / neither".
6. **During the session, on the live bar:** does `A10` change between two looks a few minutes apart? Report yes or no.
7. *(Optional, settles rows #27/#28.)* Add `plot X = close crosses above Average(close(period = AggregationPeriod.WEEK), 10);` and pick any week where it fires. Report whether it fires on **one** daily bar or on **every day of that week**.

**Expected result** (the medium-confidence hypothesis in PA1 §2.3): `W-Wed FINAL`, `W1-Wed PREV_WEEK`, `W-Fri THIS_WEEK`, `LIVE W = today`, Wed and Fri = "the 09-28 week", live moves = yes.

**The captured categories become the fixture** `tests/fixtures/vendor/thinkorswim/d13-secondary-aggregation.json`. The fixture holds `{captured_on, platform_build, symbol, outcomes:{…}}`, with **no prices**.

---

## 3. Accurate conversion messaging: the minimal A2 change in `importOutcome.js`

**A2 changes exactly one thing.** It adds a dialect-scoped fail-closed rule inside the per-output loop (`:166-189`), modelled on the PCF `XUP` rule already there (`:185-188`):

```js
if (report.dialect === 'thinkscript' && out.ast
  && treeHas(out.ast, (n) => n.type === 'tf' || n.type === 'tf_live')
  && !(out.vendorNotes || []).some((v) => v.name === 'thinkscriptSecondaryAggregation')) {
  add('semantic', 'Weekly/monthly reads (thinkScript)', TS_PERIOD_FALLBACK_NOTE, out.line)
}
```

**Why it is needed.**
- In normal operation the `_folds` note arrives through `vendorNotes`, and this rule never fires.
- It exists so that a period read can never yield `Exact import` or the "values are the same" sentence, even if a future translator path forgets to stamp the row.
- The `_folds` route is preferred because it is what persists a disclosure to `meta.disclosures` on the member pane.

**STOC needs no importOutcome change.** A corrected `STOC14.3` import is `Exact import`. That is now true, and evidenced by the reference test in §6. A PCF import carries no presentation notes, so it can never reach the "values are the same" sentence.

**The boundary with A3.**

| A2 does | A2 does not (A3 owns it) |
|---|---|
| Adds one fold channel, one refusal code, and one dialect-scoped fail-closed rule | `compatibilityVerdict`, the closed code registry (`NOTE_CODES`), evidence-backed "Exact", `ImportVerdict.jsx`, `meta.importVerdict`, migrate-on-read, Agent receipts |
| Keeps `OUTCOME_LABEL`, the reason sentences and `NOTE_SEVERITY` unchanged | Rewording "differences in how it is drawn only; the values are the same" (D16: the 77 headlines) |
| Shows advisories for two named defects | A general "derived verdict" badge on old saves |

**A3 inherits:**
- `thinkscriptSecondaryAggregation` (SEMANTIC) and `thinkscript:aggregation-mixed` (refusal) as pre-registered registry codes;
- the advisory codes `pcf-stoc-v1` and `ts-mtf-v1`;
- and it deletes A2's fallback rule once "unknown code means values may differ" covers it.

A2 never writes `meta.importVerdict`. Persisting the thinkScript disclosure on save is A3's job (D19 and `meta.importVerdict`). Until then it shows in the import box only.

---

## 4. File ownership and integration boundaries

### 4.1 Every file A2 modifies

**A2a (STOC, notice, re-key, N11):**

| File | Functions or regions touched |
|---|---|
| `app/src/components/chart/engine/ast/pcf.js` | `PCF_FUSED.STOC.series` (`:196`); prose `:161-165` |
| `app/src/components/chart/engine/ast/importAdvisories.js` **(new)** | `PCF_LEGACY_READINGS`, `swapStochRoles`, `isSwappedStoch`, `acceptedAlternateReading`, `noteLegacy`/`legacyOf` (WeakMap), `setServerAdvisories`, `advisoriesFor`, `ADVISORY_COPY` |
| `app/src/components/chart/engine/defSchema.js` | `validateCompute` (`:668`, parameter), `validateAstCompute` (`:856-877`), `validateTrees` sources loop (`:1000-1010`), `validateDefinition` return (`:2347`) |
| `app/src/components/chart/engine/nativeRegistry.js` | `registerDefinitions` (`:3168-3175`, one call) |
| `app/src/components/chart/indicatorCatalog.js` | `rowFor` (adds `advisories`) |
| `app/src/components/chart/ChartSettingsIndicators.jsx` | short-badge helper (near `:195`); "My formulas" row action **Review correction** |
| `app/src/components/chart/pane/AttachedPineDisclosures.jsx` | `attachedDisclosures` (`:150-170`) |
| `app/src/components/chart/builder/BuilderSheet.jsx` | `openForEdit` (`:1373`, intent and banner state); banner render; Save label; self-check before `save()` |
| `app/src/hooks/useUserDefinitions.js` | `useInstalledUserDefinitions` (`:335-377`, `setServerAdvisories`). Used by A2b only; a no-op in A2a |
| `api/services/legacy_readings.py` **(new)** | `is_swapped_stoch`, `has_pcf_stoc_source`, `is_legacy_pcf_stoc`, `swap_stoch`, plus (A2b) `is_mtf_p2` and `thinkscript_import_keys` |
| `api/services/user_definitions.py` | `save()`: phase-1 gate, phase-2 `reason`/`name`, phase-4b re-key |
| `api/services/alert_rev_migration.py` | `migrate_bindings_to_rev` keyword arguments; `deliver_migration_notice` copy |
| `api/services/screener/screen_alerts.py` | `rekey` (new); `run_nightly` guard and `diff_key` |
| Tests and fixtures | §6; `pcf.vocabulary.test.js:284-302` and `tests/fixtures/ast/pcf_corpus.json:337-345` corrected (consumers `pcf.test.js`, `dialect.test.js`, `doorScorecard.test.js`) |

**A2b (thinkScript):**

| File | Functions or regions touched |
|---|---|
| `app/src/components/chart/engine/ast/periodLift.js` **(new)** | `PERIOD_LEAVES`, `markPeriodLeaf`, `liftPeriods`, `TS_PERIOD_BASIS` |
| `app/src/components/chart/engine/ast/thinkscript.js` | `REFUSALS` (append at `:~270`); `Resolver.resolveCall` (`:3869-3871`); `translateThinkScript` row map (`:4643-4668`) |
| `app/src/components/chart/engine/ast/closedTable.json` | `_folds.thinkscriptSecondaryAggregation` only |
| `tests/fixtures/vendor/divergences.json` | one `accepted` row |
| `app/src/components/chart/engine/ast/importOutcome.js` | per-output loop: the §3 rule plus the `TS_PERIOD_FALLBACK_NOTE` constant |
| `api/routers/user_definitions.py` | `_stamped(row, ts_keys=None)`; `list_definitions` |
| `api/services/legacy_readings.py` | `is_mtf_p2`, `thinkscript_import_keys` |
| `thinkscript.aggregation.test.js` | only if D12 = F (bare-read rails) |

**A2 does not touch:**
- `alert_user_series.py` (uie7);
- `interpret.js` and `ast_interpret.py` (no evaluator change: `tf`/`tf_live` over windowed subtrees already run in both lanes, since Pine emits them);
- `tools/ast_conformance.py` and `.github/workflows/*` (A0);
- `StockChart.jsx`, `instanceControls.js`, `chartDefaults.js` (A1).

### 4.2 Overlap

| Peer | Shared surface | Nature | Resolution |
|---|---|---|---|
| **A0** | `user_definitions.py` | A0: depth check before `ast_hash` (about `:1720`). A2: phase 1 (about `:1865-1930`), phase 2 (`:1964`), after `:2037` | Different hunks. A2 rebases on A0 |
| **A0** | Stale-subscription detector | Same predicate as A2's nightly guard | A2 imports A0's predicate (§1.6) |
| **A0** | CI vitest count (N10) | The one-deploy rail must actually run | A0 first |
| **A1** | `ChartSettingsIndicators.jsx` | A1: "Remove all of X", the unavailable notice. A2: badge and **Review correction** on a user-formula row | Textual merge only. Legacy STOC definitions are **not** "unavailable" after A2 (they install), so A1's notice never lists them |
| **A1** | `nativeRegistry.js`, `useUserDefinitions.js` | A1: "uninstall deleted definitions in open tabs". A2: one call in `registerDefinitions`, one setter in the hook | Small, separable hunks. A2a and A1 can merge in either order |
| **A3** | `importOutcome.js`, `closedTable.json`, `BuilderSheet.jsx`, `AttachedPineDisclosures.jsx`, `pcf.js`, `thinkscript.js`, `user_definitions.py` | §3 boundary. A3 rewrites `NOTE_SEVERITY` into a registry and touches `_requirement_tags` | A2 lands first. A3 absorbs A2's codes and deletes the fallback rule |
| **uie7** (`feat/uie-alert-coverage`) | **No file overlap.** Its diff touches `alert_user_series.py`, `alertCoverage.measure.test.js`, `docs/indicators/ALERT-COVERAGE-2026-10-11.md`, two `tests/fixtures/alert_coverage/*.json` and three `tests/test_alert_*.py`; A2 touches none of them | Behavioural only: admission now refuses per plot. STOC (non-repainting, no tags) is unaffected. Basis C is unaffected; basis F would interact (F1) | Release or hold uie7 independently (D28). If uie7 merges first, re-run A2's Python alert tests on top |
| **rpw** (uncommitted) | `thinkscript.js` | §4.3 | §4.3 |

### 4.3 rpw: coordination proposal

**Hunks in the read-only diff** (all apply to master unchanged; rpw's base `59e1520106` is an ancestor of `1eba7c105c`, with no change to `thinkscript.js` between them):

1. `@@ -291,8 +291,13 @@ export const NOTES`. It adds a code at the end of `NOTES`:
   ```
   +  'thinkscript:note-carried':
   +    'this line sets how the study is drawn, and the chart draws it that way; a screen reads no drawing, so it does not change a screened value',
   ```
   A2 appends to `REFUSALS`, which ends about 20 lines above. That is outside git's 3-line context, so no textual conflict. It is the closest pair, though, and both are frozen tables that the guard sweeps read.
2. `@@ -1871,8 +1876,140 @@`: `TS_COLORS`, `TS_PAINTING`, `carriedPresentationOf`, `TS_DECLARE_OVERLAY`, after `TS_CHROME_CALLS`. No A2 overlap. A2's aggregation tables (`:1758-1830`) sit just above, and A2 does not edit them.
3. `@@ -2129,8 +2266,16 @@ function readStatement` (`declare lower/upper` carried) and `@@ -2249,8 +2394,25 @@` (chrome carry, `ctx.carriedNotes.push(...)`). No A2 overlap.
4. `@@ -2265,8 +2427,11 @@ function readProgram`: new `ctx` fields:
   ```
   +    presentation: new Map(), overlay: null, carriedNotes: [],
   ```
   A2 adds no `ctx` field (the lift runs after resolution), so there is no conflict.
5. **The real conflict surface is code rpw has not written yet.** Its own comment says `ctx.carriedNotes` is kept "so `translateThinkScript` can turn it back into the skipped-line note". That consumption has to land in `translateThinkScript`'s row map and return (`:4643-4760`), which is exactly where A2 inserts `liftPeriods` and stamps `thinkscriptSecondaryAggregation`.

**Proposal:**
- **A2b lands first.** rpw rebases onto it, as D27 recommends.
- The rpw hunks 1–4 rebase cleanly. Only rpw's future `translateThinkScript` hunk needs a hand merge. The rule: rpw spreads its presentation into the row *after* A2's `ast` and fold stamp, and never rebuilds the row object from scratch, so the fold channel survives.
- **Honest note channel.** `thinkscript:note-carried` must be registered explicitly in importOutcome's severity table rather than falling to the PRESENTATION default:
  - as INFO, only if a test shows the carried presentation renders as the vendor states;
  - otherwise as PRESENTATION.

  Either way it must not be the only evidence behind "the values are the same": a period read always adds the SEMANTIC fold note (A2b), and A3 replaces the sentence itself.
  - If rpw lands *before* A2b, the audit corpus file `07-mtf-weekly-average.ts` (`WeeklyMA.SetDefaultColor(Color.WHITE)` beside a weekly average) would switch from a skipped chrome line to a carried one and keep printing the false sentence. That is why A2b goes first.
- rpw's registration line in `importOutcome.js` must be rebased onto A3's registry when A3 lands.

### 4.4 Merge order

**A0 → A2a ∥ A1 → (D12 + D13 resolved) A2b → rpw rebases onto A2b → A3 → A4.**

uie7 is independent of A2 (D28). A2a does not wait for D13. A2b does not wait for A1.

---

## 5. Production-read proposals (D25): NEEDS OWNER AUTHORISATION, NOT RUN

Proposed as `tools/a2_readonly_counts.py`, run by the owner on the web service shell. It opens every database `mode=ro`, uses the service modules' own path functions (`user_definitions._connect` path, `alert_rev_migration.db_path()`, `snapshot_db.get_db_path()`, the `auth_db` path), and **prints counts only**: no ids, symbols, formulas or values.

```python
# READ-ONLY. COUNTS ONLY. Requires owner authorisation (D25).
import json, re, sqlite3
from api.services import legacy_readings as L
ro = lambda p: sqlite3.connect(f"file:{p}?mode=ro", uri=True)
NEWEST = """SELECT u.user_id, u.def_id, u.ast_hash, u.definition FROM user_definitions u
  WHERE u.version = (SELECT MAX(version) FROM user_definitions v WHERE v.user_id=u.user_id AND v.def_id=u.def_id)
    AND u.deleted_at IS NULL"""
def trees(d): c = d.get("compute") or {}; return [c.get("ast")] + list((c.get("trees") or {}).values())

ud, auth, scr, rev = ro(UD_PATH), ro(AUTH_PATH), ro(SNAPSHOT_PATH), ro(ALERT_REV_PATH)
rows = [(u, d, h, json.loads(b)) for u, d, h, b in ud.execute(NEWEST)]
out = {}
# --- STOC (A2a) ---
legacy = [(u, d, h) for u, d, h, doc in rows if L.is_legacy_pcf_stoc(doc)]
native_swapped = sum(1 for _, _, _, doc in rows
                     if any(L.is_swapped_stoch(t) for t in trees(doc)) and not L.has_pcf_stoc_source(doc.get("compute") or {}))
alerts = lambda u, d: auth.execute("SELECT COUNT(*) FROM indicator_alerts WHERE user_id=? AND indicator LIKE ? AND active=1",
                                   (u, d + ".%")).fetchone()[0]
subs = lambda u, h: scr.execute("SELECT COUNT(*) FROM screen_alert_subs WHERE user_id=? AND def_hash=?", (u, h)).fetchone()[0]
out["stoc"] = {
  "legacy_definitions": len(legacy),
  "members": len({u for u, _, _ in legacy}),
  "distinct_trees": len({h for _, _, h in legacy}),
  "with_armed_alerts": sum(1 for u, d, _ in legacy if alerts(u, d)),
  "armed_alerts": sum(alerts(u, d) for u, d, _ in legacy),
  "with_screen_subs": sum(1 for u, _, h in legacy if subs(u, h)),
  "live_share_links_on_legacy_versions": sum(
      1 for (h,) in ud.execute("SELECT ast_hash FROM definition_shares s WHERE revoked=0 AND id = "
                               "(SELECT MAX(id) FROM definition_shares t WHERE t.token=s.token)")
      if h in {lh for *_, lh in legacy}),
  "native_swapped_stoch_not_pcf": native_swapped,
}
# --- thinkScript weekly/monthly (A2b) ---
ts = set(auth.execute("""SELECT visitor_id, json_extract(props,'$.def_id'), json_extract(props,'$.def_hash')
  FROM landing_events WHERE event='import_accepted' AND json_extract(props,'$.dialect')='thinkscript'""").fetchall())
by_def = {(u, d): (h, doc) for u, d, h, doc in rows}
conf = [(u, d, h) for (u, d, ih) in ts if (u, d) in by_def and by_def[(u, d)][0] == ih
        and any(L.is_mtf_p2(t) for t in trees(by_def[(u, d)][1]))]
out["thinkscript_mtf"] = {
  "thinkscript_import_events": len(ts),
  "confirmed_defective_live": len(conf),
  "edited_since_import_still_p2": sum(1 for (u, d, ih) in ts if (u, d) in by_def and by_def[(u, d)][0] != ih
                                      and any(L.is_mtf_p2(t) for t in trees(by_def[(u, d)][1]))),
  "p2_shape_any_origin": sum(1 for *_, doc in rows if any(L.is_mtf_p2(t) for t in trees(doc))),
  "confirmed_with_armed_alerts": sum(1 for u, d, _ in conf if alerts(u, d)),
  "confirmed_with_screen_subs": sum(1 for u, _, h in conf if subs(u, h)),
}
# --- F2 / N11 ---
out["screen_subs"] = {"total": scr.execute("SELECT COUNT(*) FROM screen_alert_subs").fetchone()[0],
  "on_semantics_2_definitions": "<join subs(user_id, def_id) to newest row; count meta.semantics == 2>",
  "stale_hash": "<count sub.def_hash != newest ast_hash>"}
print(json.dumps(out, indent=1))
```

- The two `screen_subs` placeholders are completed with the same join, in the same counts-only form. They overlap A0's detector: if A0's tool is authorised and run, it supplies these two counts.
- The script depends on `legacy_readings.py`, so it can only run after A2a is merged (not deployed).
- **Alternative:** run PA1 §1.6 and §2.2 as written today, which need no A2 code.

---

## 6. Tests and acceptance

Every test fails on today's code unless it is marked *(guard)*.

| ID | Test | Lane | Reference |
|---|---|---|---|
| T1 | `pcf.stoc.values.test.js`: `STOC14`, `STOC14.3`, `STOC14.3.1` and `STOC14.3 < 20` on 420 synthetic bars, against a **hand-written** %K = 100·(C−LL14)/(HH14−LL14), then SMA3. Every value within [0,100]; firing count equals the reference's | JS + Python (`ast_interpret`, 1e-9) | Independent loop, no engine call |
| T2 | `argRoles` rail: every `PCF_FUSED.series` equals the manifest `argRoles` prefix for its `fn` (catches STOC; ATR stays green) | JS | `closedTable.json` |
| T3 | Pins corrected: `pcf.vocabulary.test.js:284-302` (identity with `sma(stoch(high, low, close, 14), 3)`). The "STOC14.1 keeps hashing" intent moves to T4, which cites it | JS | — |
| T4 | One-deploy rule (§1.9, both rails) | JS + Python | Committed pre-fix fixture |
| T5 | Narrowness: a PCF document with a non-STOC mismatch is refused with today's sentence; a native swapped `stoch` with a mismatch is refused; a PCF document without `stoch` never takes the legacy path; `legacy` is absent on ordinary documents *(guard)* | JS | — |
| T6 | Install and chart: a legacy document installs, its instance draws, its values equal the stored tree's, and they equal the Python alert lane on the same bars | JS + Python | Cross-lane |
| T7 | `BuilderSheet.legacyStoc.test.jsx`: the banner shows. **Apply corrected STOC** sends one PUT with `expectedVersion` and the hash equals `swap(stored)`. Save is relabelled. The self-check refuses when the source changed under another rule. Opening alone never saves | JS (RTL) | — |
| T8 | `test_user_definitions_stoc.py`: the gate gives 422 `pcf:stoc-legacy-reading` for a new legacy document and for corrected→legacy; a presentation-only re-save of a legacy document passes; `install_share`/`fork` of a legacy document pass; the re-import gives `rev_bumped=True`, `last_value` NULL, first cycle suppressed, `forget` called, `reason="pcf-stoc-v1"` | Python | — |
| T9 | Notice copy: spy the transport (`watchlist_alert_service.deliver_alert_payload`) and assert the exact title and body for `pcf-stoc-v1`, `pcf-stoc-v1+edit` and `edit`; fall back to the address when there is no name; no formula text or values in the payload; `extra_data` keys are a superset of today's | Python | §1.5 |
| T10 | Re-key: a save re-keys `(user, def_id, old) → new`; another of the member's definitions sharing the old hash keeps its subscription; idempotent; a failed re-key does not fail the save | Python | — |
| T11 | Shared hash: member B still holds the old tree; A's re-keyed subscription never delivers B's diff | Python | — |
| T12 | N11: a semantics-2 definition with two covered sessions under `<hash>~s2` **delivers** through `run_nightly` (fails today); a stale subscription is re-keyed and skipped for one night | Python | — |
| T13 | `periodLift.test.js`: unit tests for the period join, maximal lift, base-only boundaries, offset handling for C and F, the mixed refusal, unmarked `tf` never lifted *(guard)* | JS | — |
| T14 | `thinkscript.mtfValues.test.js` (template `mtfMatrix.test.js`): all 30 rows through `PineBox.inspectSource(src,'thinkscript')` against **independent** weekly and monthly references built by resampling the synthetic daily bars by hand (10-week SMA closed and final, previous-week close for `[1]`, monthly `[2]`, Highest/Lowest/Sum/StDev/RSI weekly, crosses on daily bars, `def`/`input` binding). Rows 4, 12 and 29 refused with the named guards | JS + Python 1e-9 | Independent |
| T15 | Outcome: every translated row in §2.2 is DISCLOSED with the fold note and never EXACT; `07-mtf-weekly-average.ts` (audit corpus, inlined in the test) never yields the "values are the same" reason; the fallback rule fires when the stamp is removed; Pine `request.security` outcomes are unchanged *(guard)* | JS | — |
| T16 | Vendor truth: the `_folds` channel and the divergence row are paired (`vendorTruth.test.js`, `test_vendor_truth.py`); `tableVersion` unchanged *(guard)* | JS + Python | — |
| T17 | Saved thinkScript advisory: `_stamped` adds `ts-mtf-v1` only for telemetry `thinkscript` ∧ same `ast_hash` ∧ P2; not for a Pine `ta.sma(request.security…)` tree with `pine` telemetry; not after an edit; fail-open on a database error | Python | — |
| T18 | Scan and alert gates: a corrected weekly tree is scannable from daily bars; under C an alert arms; under F the save requires the preview acknowledgement and an alert is refused with the `preview-repaints` sentence (documents F1) | Python | — |
| T19 | **Vendor capture** (once D13 exists): the fixture categories select the `memberNote` variant shipped (C-FINAL, C-CLOSED or F); under the captured semantics the engine's tree reproduces the category on synthetic data (FINAL = `tf_live` equals the week's final close; PREV_WEEK = shifted form); optional item 7 decides whether rows #27/#28 keep the daily-cross caveat | JS | `d13-secondary-aggregation.json` |

**Acceptance (A2 row of decision §5, made concrete):**
- T1–T19 green.
- The backend indicator rails and the Linux security-suite job (A0) green.
- The one-deploy rail visible in the CI vitest count.
- A local run of: import `STOC14.3 < 20` → Exact, values 0–100; load a legacy fixture document → draws and is badged; Apply → notice rendered in a dev bell; corpus 07 → DISCLOSED.

---

## 7. Rollout and rollback

**Rollout:**
1. Owner decisions (§8). D25 counts, if authorised, are run before the release to size the badge population. Counts only.
2. **A2a** on its own branch from master after A0. Verified locally. `pre_push_guard`. The **next flow-worker marker number** (uie7 already reserves #16; take whatever is next at push time). Owner release gate.
3. Post-deploy checks, counts and pass/fail only:
   - the number of badged definitions matches the D25 count;
   - zero `compute.source does not parse` refusals for PCF STOC;
   - migration notices sent = 0 until members act;
   - `run_nightly` receipt shows `rekeyed` and `errors` = 0.
4. **A2b** after D12 and D13, on its own branch, the same gates. Then tell the rpw owner to rebase.
5. No feature flag. A correctness fix behind a flag would recreate the split the one-deploy rule exists to prevent.

**Rollback:**

| What | Lever | Effect |
|---|---|---|
| STOC reader | Roll forward with a revert of the **`pcf.js:196` hunk only** (and the server gate) | Corrected stored trees are still accepted (the symmetric swap) with no badge; legacy ones match directly. Members' corrections and notices stand |
| Whole image (Railway rollback to pre-A2) | **Not recommended** (also, rollbacks have not held on this project) | Every definition a member already corrected is refused on charts until roll-forward (its alerts keep running the corrected tree). D25's post-release count of corrected definitions sizes this |
| Notice copy, screen re-key, N11 guard | Revert | Re-keyed subscriptions stay on their member's current tree (correct). Notices already sent stand |
| thinkScript lift | Revert A2b | Saved lifted definitions are plain native text and re-parse identically in any build, so they are safe. New imports go back to the old trees |
| Saved thinkScript advisory | Revert `_stamped` | No badge (today's state) |

---

## 8. Remaining owner decisions (open only)

| # | Decision | Recommendation |
|---|---|---|
| D9 | STOC model (a) freeze + badge + one-click; deadline for an auto-migration of definitions nobody corrects | (a), no deadline yet; revisit with the D25 counts |
| D10 | One-deploy rule (§1.9) | Approve |
| D11 | Screen re-key on save (N7) | Approve |
| D12 | Basis C (`tf`, one period late, alerts armable) or F (`tf_live`, faithful, repaints, **alerts un-armable today**, F1) | **C** for A2; F only after an alert-acknowledgement surface exists (with uie7) |
| D13 | The owner's thinkorswim capture (§2.7) | Needed before A2b, not before A2a |
| D14 | Refuse mixed periods inside a window | Refuse |
| D25 | Authorise §5 (counts only) | Authorise |
| D27 | rpw sequencing | A2b first; rpw rebases and registers `note-carried` explicitly (§4.3) |
| O1 (new) | Server refuses new legacy STOC maths from stale tabs (422, reload) | Approve |
| O2 (new) | Saved thinkScript badge derived at read time from the member's own `import_accepted` telemetry | Approve; the alternative is an operator-written allowlist (a production write) |
| O3 (new) | Split A2 into two releases, A2a and A2b | Approve |
| O4 (new) | Notice wording now uses the definition name for **all** maths edits (§1.5 `edit`), not only STOC | Approve |
| O5 (new) | The nightly guard heals already-stale subscriptions by re-keying to the member's current formula, with no separate notice | Approve without a notice; the first night after a re-key is skipped |
| O6 (new) | F2/N11: diff semantics-2 subscriptions under `result_identity`, so subscriptions silent since 10-05 start delivering. Quota and dedup apply | Approve. Confirm with T12 and the D25 count first |
| O7 (new) | Builder success line suggests re-sharing a corrected shared definition (no automatic re-pin of links) | Approve |
| O8 (new) | Lint hints for the hand-typed native `stoch(close, high, low, n)` and for P2-only shapes (unconfirmed origin) | Defer to A3/A4 |
