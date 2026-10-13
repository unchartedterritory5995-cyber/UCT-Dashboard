# PA1: TC2000 `STOC` argument order and thinkScript weekly/monthly composition

**Phase A follow-up to `03-GAP-ANALYSIS.md` P0-1 and P0-2.** Audit only. No runtime code, test or config was changed.

- **Worktree:** `C:/w/indaud`, branch `audit/indicators-competitive-2026-10-13`, on production `4a368e80ed` (the branch head adds only docs).
- **Probes:** in `app/src/__audit_scratch__/phaseA-1/` (never committed). They use synthetic bars only and need no production access.

| Probe | Output | What it shows |
|---|---|---|
| `stocCurrent.test.js` | `stocCurrent.json` | STOC trees, outcomes and save shape today; detection; rewrite; values |
| `stocFixedReader.test.js` | `stocFixedReader.json` | Simulates the corrected reader by mocking `readFormulaSource`, then reloads a definition saved under the old reader |
| `stocCase.test.js` | `stocCase.json` | Case-insensitivity; STOC inside `XUP`/`COUNTTRUE`; the hand-typed native form |
| `pa1_server_probe.py` | stdout | Server lane on the stored tree; Python predicate, rewrite and hash parity with JS |
| `mtfMatrix.test.js` | `mtfMatrix.json` | The thinkScript construct matrix through the real Import-tab entry point |
| `tfLive.test.js` | `tfLive.json` | What `tf_live` returns on past daily bars |
| `pineShape.test.js` | `pineShape.json` | Pine's MTF shapes, and linter verdicts for the candidate trees |

`detect.js` holds the proposed predicates and the tree rewrite.

---

## 0. Headline findings

1. **The STOC fix is not safe as a reader-only change.**
   - A PCF definition stores the **TC2000 text** in `compute.source` and the **wrong tree** in `compute.ast`. On every load the browser re-reads the text and compares hashes.
   - After a one-line reader fix, every saved STOC definition is **refused on every chart**. Its instances stop drawing. The only explanation the member sees is a sha256 mismatch message, and there is no way to fix it from there.
   - The **server keeps evaluating the stored wrong tree**: alerts keep firing and scans keep sweeping.
   - So the lanes **split**: the chart shows nothing while alerts and screens act on the old maths. That is worse than today, where all lanes agree on the wrong value.
2. **Alerts and scans run the stored tree and never re-read source.**
   - Python has no PCF or thinkScript reader.
   - Nothing on the server changes until a new version is appended. When one is, the existing Phase C machinery runs: rev bump, `last_value` reset, notice, first-cycle suppression.
   - Exception: **overnight screen-alert subscriptions are keyed by `def_hash` and do not follow a rev change.** This is a pre-existing gap for any edit, and a migration would make it bigger.
3. **Affected STOC definitions are deterministically detectable without production access.**
   - The signature is a `stoch` call whose first three args are the bare series `close, high, low`.
   - A Python rewrite of the stored tree gives **byte-identical hashes** to the corrected reader in JS (measured).
   - So a server-side migration needs no JS parser.
4. **The thinkScript MTF defect affects every windowed function and every `[n]` offset over a `period =` read.**
   - Of 30 probed constructs: **24 give wrong values**, 3 have the right shape (bare `close(W)`, bare `high(M)`, `close / close(W)`) but an undisclosed one-week timing difference, 2 are refused for an unrelated `displace` arity reason, and 1 is ambiguous (§2.1 lists every row).
   - **21 of the 24 wrong-value rows are labelled "Exact import".** The other 3 are "Disclosed" only because of the EMA-seed note.
5. **Saved thinkScript MTF definitions cannot be identified from the definition alone.**
   - They are stored as native text with no dialect marker. A rail (`ImportBox.thinkscript.test.jsx:255-256`) asserts that nothing in the document remembers thinkScript.
   - The **same tree** `sma(tf(close,'W'),10)` is emitted, **correctly**, by the Pine door for `ta.sma(request.security(…,"W",close),10)` (measured), and can be typed by hand.
   - The only discriminator is the server telemetry row `import_accepted` (`dialect='thinkscript'`, `def_id`, `def_hash`) in `landing_events`.
6. **The correct composition depends on one owner decision and one vendor capture.**
   - The current `tf` read is the *last closed* week.
   - thinkorswim reads the *week the bar is in*. UCT's matching node is `tf_live`, which on past daily bars returns the week's **final** value: measured 120/120 against the week's final close.
   - Faithful translation: `tf_live(sma(close,10),'W')` for an unshifted read, and `tf(x[k-1],'W')` for `[k ≥ 1]`. The second form is non-repainting and exactly equals the shifted forming read (measured 120/120).

---

## 1. Defect 1: TC2000 PCF `STOC`

### 1.1 The bug, re-confirmed

- `app/src/components/chart/engine/ast/pcf.js:196`: `STOC: { fn: 'stoch', series: ['close', 'high', 'low'], … }`.
- The engine is `stoch(h, l, c, n)`:
  - `interpret.js:2768`;
  - `api/services/ast_interpret.py:2206`;
  - manifest `argRoles: ["high","low","close","period"]` at `closedTable.json:1264-1279`.
- Same mistake, previously measured on the Pine door: `pine.js:941-942` ("`ta.stoch(source, high, low, n)` … translated verbatim" was wrong). Pine fixed it with a measured permutation (`pine.js:1074`); PCF copied Pine's surface order instead.
- Why no rail caught it:
  - `pcfCoverage` compares argument **types** (`series,series,series,int`), not roles (`pcf.js:1801-1812`).
  - `pcf.vocabulary.test.js:291-293` pins the wrong tree by hash.
  - `tests/fixtures/ast/pcf_corpus.json:337-338, 344-345` pins the wrong native text. Consumers: `pcf.test.js`, `dialect.test.js`, `doorScorecard.test.js`.
- The prose at `pcf.js:161-165` repeats the wrong tree.

Measured today (`stocCurrent.json`, 420 synthetic bars):

| | Today | Corrected |
|---|---|---|
| `STOC14.3` range | −94.4 … 89.3 | 3.5 … 96.0 |
| `STOC14.3 < 20` firings | 190 | 65 |
| Bars where the condition disagrees | 125 / 420 | |

- Every STOC form translates (`STOC14`, `STOC14.1`, `STOC14.3`, `STOC14.3.1`, inside `AND`, `XUP`, `COUNTTRUE`; any letter case). All are labelled **"Exact import"**.
- The readback says "the 14-bar stochastic %K of close, high and low". It reads as plausible.
- Server lane (`pa1_server_probe.py`): stored-tree %K range −230.3 … 87.7, with 195/420 condition bars different. The server computes the same wrong tree, so the cross-lane gate passes.

### 1.2 How a PCF definition is saved

- **What is stored.** `PineBox` does not translate PCF. The pasted text **is** the formula: `PineBox.jsx:397-411`, `formula: source`.
- The Builder saves:
  - `compute.source` = the TC2000 text (e.g. `"STOC14.3 < 20"`);
  - `compute.ast` = the reader's tree;
  - `compute.fn` = `astHash(ast)`;
  - `meta` with **no** dialect stamp. Only Pine Apply gets `meta.importedFrom`: `BuilderSheet.jsx:451-465`.
- Rail: `BuilderSheet.pcf.test.jsx:168` asserts `doc.compute.source === '(C > AVGC50) AND (C1 < AVGC50.1)'`.
- **Client reload re-derives the tree from the PCF text.**
  - `defSchema.js:98` imports `readFormulaSource` (`pcf.js:1762-1766`, dialect auto-detected).
  - `validateAstCompute` re-reads `compute.source` and refuses on hash mismatch: `defSchema.js:856-872`.
  - Multi-tree `sources[k]` get the same treatment: `defSchema.js:998-1010`.
  - This runs on every install: `validateUserDefinitions` → `registerDefinitions` → `validateDefinition` (`nativeRegistry.js:3164-3175, 3587-3646, 3890-3918`), reached through `useInstalledUserDefinitions` (`hooks/useUserDefinitions.js:335-377`).
- **The server stores the whole JSON and the hash, and never parses.**
  - Table `user_definitions(user_id, def_id, version, rev, ast_hash, definition, repaint, …)`: `api/services/user_definitions.py:205-218`. Append-only: `:44-57`.
  - `rev` bumps iff `ast_hash` or `treesHash` moves: `:61-77`.
  - No PCF translation exists anywhere under `api/`. The only `PCF` mentions are comments in `ast_interpret.py`, `definition_concierge.py` and `indicator_telemetry.py`.

### 1.3 What a reader fix does to an existing saved STOC definition

This was simulated in `stocFixedReader.test.js`: `readFormulaSource` was mocked to emit the corrected order, and a definition saved under the old reader was then loaded.

- **Refused on load:**
  - `myFormula: compute.source does not parse to compute.ast — "STOC14.3 < 20" parses to sha256:8df85… while the stored tree hashes to sha256:22a71…` (`defSchema.js:865-871`).
  - `installUserDefinitions` installs 0.
- **The instance stops drawing.** `normalizeInstances` drops it at paint with "names no registered definition" (`instances.js:604-614, 798-815`).
  - The stored layout keeps the instance: the paint-time list at `StockChart.jsx:12054-12064` is not written back.
  - Exception: the legacy `settingsVersion < 2` fold rewrites `indicatorInstances` as `kept + removed`, so dropped instances are lost there (`chartDefaults.js:784-838`). This is low-risk because user formulas post-date v2 blobs, but it is not provably zero.
- **What the member sees.**
  - A "refused" row in Chart Settings, with the hash sentence verbatim and no action to fix it (`indicatorCatalog.js:366-405`; `ChartSettingsIndicators.jsx:1102, 3526-3550`).
  - The editor and the Agent's authoring session also run `validateUserDefinitions` (`authoringSession.js:112`; `applyPatch.js:1051`).
- **Silently new values?** Not on the chart, which refuses instead.
  - If the member opens and re-saves the definition, the corrected tree is appended (new `ast_hash`), and §1.4's migration runs.
- **The server is unchanged and keeps running the old tree.** See §1.4–1.5.
- **Net effect of a reader-only fix:** the chart shows nothing, alerts and scans keep acting on the wrong maths, and the member is told something only an engineer can read.

### 1.4 Alerts

- **Binding.**
  - An alert row stores the address `u_<12hex>.<plotKey>` in `indicator_alerts.indicator`.
  - There is **no version column** (`indicator_alert_service.py:110-125` plus migrations at `:137-…`).
  - `lookback_for_alert` reads `alert.get("def_version")`, which never exists, so it falls back to the latest version (`alert_user_series.py:735-775`).
  - The binding is **def_id + plot, always the newest live version**.
- **Arm time.**
  - `arm_for_alert` → `admit_user_definition(user_id, def_id, None, …)` (`alert_user_series.py:1442-1495`, `:1067-1117`).
  - Gates: definition, lane, requirements, repaint, budget, and a **cross-lane** check that runs JS and Python on the **stored** `compute.ast` (`:960-1000`).
  - Both lanes compute the same wrong stoch, so it passes.
- **Evaluation time.**
  - The tree is **captured** in `USER_FUNCS` at admission (`_make_value_fn`, `:518-526`). It is re-admitted from the stored row only on a registry miss: a process restart, or a `forget` after a save (`:1176-1226`; `user_definitions.py:1997-2010`).
  - It is never re-read from source.
- **If only the translator is fixed:** armed alerts keep the old wrong tree indefinitely and keep firing on it. Nothing changes and nobody is notified.
- **If a new version with the corrected tree is appended** (member re-save or migration):
  - `save()` sets `rev_bumped` and calls `alert_rev_migration.migrate_bindings_to_rev` before the append (`user_definitions.py:1964-1972`).
  - That resets `last_value`, suppresses the first cycle, and sends a notice: "The maths behind u_… changed (revision 1 → 2) … will skip one evaluation" (`alert_rev_migration.py:241-273`).
  - Then `forget`, so the next cycle re-admits on the new tree.
  - New maths must also pass today's admission (`user_definitions.py:1915-1927`).
- Built-in `stoch` alert addresses use `indicator_compute.compute_stoch` (`alert_series.py:180,191`) and are unaffected.

### 1.5 Scans, screens and watchlist results

- **Sweeps run the stored tree.**
  - `scan_evaluator.py:1429-1432` reads `compute.ast` and `compute.rev`.
  - Results are keyed by `def_hash` = `astHash(compute.ast)` plus a semantics suffix (`scan_definition.py:397-440`; `user_definitions.semantic_identity:527-531`).
  - Definitions are de-duplicated by hash across members (`scan_evaluator.py:1985-2030`).
- **A translator-only fix changes nothing on the server.**
- **On migration:**
  - The new tree gets a new `def_hash`, so `scan_hits`, `scan_coverage` and the forward `definition_record` start empty under the new key. The old rows stay under the old hash.
  - Screener filter chips and receipts that reference a hash go stale (`pages/screener/ScanFilterChip.jsx:31-57`).
- **Overnight screen alerts** (`screen_alert_subs`, primary key `(user_id, def_hash)`, `screener/screen_alerts.py:62-67, 102-115`):
  - The subscription is diffed by the **old** hash (`:141-154, 222-283`).
  - Nothing in `user_definitions.py` or `alert_rev_migration.py` re-keys it.
  - After a tree change, the subscription goes stale and silent. Worse, if **another member still holds the old tree** (likely for a common spelling like `STOC14.3 < 20`), it keeps firing on the **old maths**.
  - This is pre-existing for every edit, but a migration must fix or handle it.
- **Watchlist results:** no separate formula column store was found. Screens and scans saved from `/screener` use the same `BuilderSheet` and the same store (`pages/screener/ScreensManager.jsx:26, 883`), so one predicate covers them.

### 1.6 Detection without production

**Predicate P1 (tree, exact).**
- Any node `{type:'call', name:'stoch'}` whose `args[0..2]` are `{type:'series',name:'close'}`, `{…'high'}`, `{…'low'}`.
- Check it on `compute.ast` and on every `compute.trees[k]`.
- Implementations:
  - JS: `phaseA-1/detect.js::isSwappedStoch`.
  - Python: `pa1_server_probe.py::is_swapped_stoch`.

**P1 results.**

| Case | P1 |
|---|---|
| All PCF STOC forms | true |
| Hand-typed correct `stoch(high, low, close, 14)` | false |
| Hand-typed native `stoch(close, high, low, 14)` | **true**, and wrong for the same reason (a Pine-order typo, or LLM output) |

Wider check: report every `stoch` whose role signature is not `high,low,close` (`detect.js::stochSignature`; e.g. `low,high,close`).

**Predicate P1-src (provenance).**
- `compute.source` (or any `sources[k]`) matches `(?i)\bSTOC\d`. TC2000 is case-insensitive, as measured.
- A STOC that is P1-true and P1-src-true is a **PCF import**. One that is P1-true and P1-src-false is a native or other-door tree with the same defect.

**Rewrite.**
- `rewriteSwappedStoch`: swap only that shape to `(high, low, close, …)`.
- It gives exactly `astHash(parseFormula('sma(stoch(high, low, close, 14), 3) < 20'))`, offset forms included (measured).
- Python and JS hashes match: `sha256:22a71…` → `sha256:8df85…`.

**Proposed read-only operator script.** Do not run against production without owner approval.

```python
# pa1_detect_stoc.py — READ-ONLY. Opens each SQLite file with mode=ro.
import json, re, sqlite3, sys
UD  = sys.argv[1]   # /data/user_definitions.db
AUTH = sys.argv[2]  # /data/auth.db      (indicator_alerts, landing_events)
SCR = sys.argv[3]   # /data/screener.db  (scan_hits, screen_alert_subs)
ro = lambda p: sqlite3.connect(f"file:{p}?mode=ro", uri=True)

def walk(n):
    if isinstance(n, dict):
        yield n
        for a in n.get("args") or []: yield from walk(a)
S = lambda n, k: isinstance(n, dict) and n.get("type") == "series" and n.get("name") == k
def swapped(tree):
    return any(n.get("type") == "call" and n.get("name") == "stoch" and len(n.get("args") or []) >= 3
               and S(n["args"][0], "close") and S(n["args"][1], "high") and S(n["args"][2], "low")
               for n in walk(tree))

ud = ro(UD)
rows = ud.execute("""
  SELECT u.user_id, u.def_id, u.version, u.rev, u.ast_hash, u.definition
  FROM user_definitions u
  WHERE u.version = (SELECT MAX(version) FROM user_definitions v
                     WHERE v.user_id = u.user_id AND v.def_id = u.def_id)
    AND u.deleted_at IS NULL
    AND u.definition LIKE '%stoch%'          -- coarse prefilter; the walk decides
""").fetchall()
hits = []
for user_id, def_id, version, rev, h, blob in rows:
    d = json.loads(blob); c = d.get("compute") or {}
    trees = [c.get("ast")] + list((c.get("trees") or {}).values())
    if not any(swapped(t) for t in trees): continue
    srcs = [c.get("source") or ""] + list((c.get("sources") or {}).values())
    hits.append({"user_id": user_id, "def_id": def_id, "version": version, "rev": rev, "ast_hash": h,
                 "pcf_origin": any(re.search(r"(?i)\bSTOC\d", s or "") for s in srcs),
                 "shared_hash": None})
auth, scr = ro(AUTH), ro(SCR)
for x in hits:
    x["armed_alerts"] = auth.execute(
        "SELECT COUNT(*) FROM indicator_alerts WHERE user_id=? AND indicator LIKE ? AND active=1",
        (x["user_id"], x["def_id"] + ".%")).fetchone()[0]
    x["screen_subs"] = scr.execute(
        "SELECT COUNT(*) FROM screen_alert_subs WHERE user_id=? AND def_hash LIKE ?",
        (x["user_id"], x["ast_hash"] + "%")).fetchone()[0]
    x["scan_hit_rows"] = scr.execute(
        "SELECT COUNT(*) FROM scan_hits WHERE def_hash LIKE ?", (x["ast_hash"] + "%",)).fetchone()[0]
# COUNTS ONLY to stdout (no symbols, no values):
print(json.dumps({"definitions": len(hits),
                  "pcf_origin": sum(h["pcf_origin"] for h in hits),
                  "with_armed_alerts": sum(1 for h in hits if h["armed_alerts"]),
                  "armed_alerts": sum(h["armed_alerts"] for h in hits),
                  "with_screen_subs": sum(1 for h in hits if h["screen_subs"]),
                  "distinct_hashes": len({h["ast_hash"] for h in hits})}, indent=1))
```

Script notes:
- The script uses `LIKE … '%'` on hashes because semantics-2 results are filed under `<hash>~s2`.
- Column names are from `user_definitions.py:205-218`, `indicator_alert_service.py:110-125` and `screen_alerts.py:62-67`.
- The `scan_hits.def_hash` column is confirmed at `snapshot_db.py:233-237`.
- Historic versions are not migrated. They are pinned by design: append-only.

### 1.7 Every surface STOC can enter through

| Surface | Reaches the PCF reader? | Evidence |
|---|---|---|
| Builder Formula box (typed TC2000) | yes; saves PCF text | `FormulaField.jsx:123-133`, `BuilderSheet.pcf.test.jsx:100-168` |
| Import tab (paste) | yes; PCF *is* the formula | `PineBox.jsx:397-411` |
| `/screener` new scan | yes; same `BuilderSheet` | `ScreensManager.jsx:26, 883` |
| Bulk "library" intake | **no**; PCF has no translator, so it is refused as "does not read as Pine, thinkScript or a TC2000 formula" (G11) | `libraryIntake.js:70, 81-115` |
| AI search scan object | re-reads `obj.source`; a server-emitted object would refuse as `object:round-trip` after a fix if it carried PCF. The server emits native formulas. | `pages/charts/widgets/scanObject.js:55-77` |
| Concierge / screenshot / Agent | native formulas only, no PCF; **can** emit a native `stoch(close, high, low, n)` if a model gets the order wrong. P1 catches it. | `ai_search_scan_object.py:44-46`; no PCF in `api/` |
| Starter scans / starter library | no STOC or `stoch` | `starterScans.json` (grep: 0) |
| Shares and library copies | carry the stored tree and source; each copy is a separate row, so P1 finds it | `user_definitions.py:228-…` (`definition_shares.ast_hash`) |
| Server-side PCF translation | none | — |
| Built-in `stoch` indicator and alerts | unaffected (native compute) | `alert_series.py:180,191` |

### 1.8 Migration options

> **The constraint:** existing alert behaviour must not change silently, and the chart, alerts and scans must keep agreeing.

#### (a) Fix new imports only; freeze existing definitions on their stored tree, badge them, offer a one-click corrected re-import

**Charts**
- Existing STOC definitions keep drawing the old values. That requires the validator to accept the *recorded legacy reading* (below).
- A badge reads "Imported with a known TC2000 STOC defect: review".
- One click re-reads the TC2000 text with the corrected reader and saves it as a new version.

**Alerts**
- Unchanged until the member clicks.
- The click goes through the normal edit save, so `rev` bumps and the Phase C notice, reset and first-cycle skip run.

**Scans**
- Unchanged until the click.
- After the click: a new `def_hash`, so results start empty (and the screen subscription needs re-keying; see code).

**Code**

| File | Change |
|---|---|
| `pcf.js:196` | `series: ['high','low','close']` |
| `pcf.js` | export a frozen `PCF_LEGACY_READINGS = [{ id: 'stoc-v1', since: '…', until: '<fix date>', rewrite: toLegacyStoch }]`. `toLegacyStoch` maps stoch `(high,low,close)` back to `(close,high,low)` on a tree the **PCF** reader produced |
| `defSchema.js:865` and `:1005` | on mismatch, when `readFormulaSource(...).dialect === 'pcf'`, accept iff `astHash(toLegacy(parsed.ast)) === storedHash`. Report it through a new **non-fatal** channel (e.g. `validateDefinition` returns `legacy: ['stoc-v1']`) |
| `nativeRegistry.validateUserDefinitions` and `installUserDefinitions` | carry `legacyIds` |
| `indicatorCatalog.js` and the chart legend | render the badge and the re-import button |
| BuilderSheet re-import | a dedicated "apply corrected reading" action: re-parse, then save via the existing PUT. **Not** an auto-save on open |
| `alert_rev_migration.deliver_migration_notice` | add an optional `reason` field and show the definition **name**, not `u_….out` |
| `screen_alerts` | re-key `screen_alert_subs` from the old `def_hash` to the new one inside `save()` when `rev_bumped`. The same fix closes the pre-existing edit gap |
| `pcf.js:161-165`, the manifest prose, `pcf_corpus.json:337-345`, `pcf.vocabulary.test.js:291-302` | correct the pinned wrong text |

**Tests**
- A numeric rail: `STOC14.3` against an independent %K/%D on synthetic bars, bounded to 0–100.
- An `argRoles` rail: every `PCF_FUSED.series` equals the manifest `argRoles` prefix. Same rail for thinkScript and Pine shapes.
- Legacy acceptance: a doc with the old tree and PCF source installs with `legacy:['stoc-v1']`.
- Legacy acceptance is narrow: a doc with any *other* mismatch is still refused.
- A new save of `STOC14.3` stores the corrected tree.
- The re-import click produces exactly the `rewriteSwappedStoch` hash and goes through `rev_bumped=True`, the notice and the suppression (python `test_user_definitions` / `test_alert_rev_migration` style).
- The screen subscription follows the hash.
- The native `stoch(close, high, low, n)` typed by hand is **not** accepted as legacy (P1-src false). It needs its own lint.

**Pros**
- No silent change anywhere.
- All lanes keep agreeing.
- The member decides.
- Minimal server change.

**Cons and risks**
- Members who never click keep wrong signals. The badge is the mitigation. This needs a deadline decision.
- It leaves a second reading of a source string inside the validator. That cuts against the repo's "one authority" rule, so it must be a closed, dated list, never a general fallback.

#### (b) Versioned translator: `meta.pcfReaderVersion`

**Charts, alerts and scans**
- Each definition is validated under the reader version recorded on it. When the stamp is absent, it means v1, which is all existing definitions.
- New saves stamp v2.
- On "upgrade", the member's definition is re-read under v2 and saved.
- The effect is otherwise the same as (a).

**Code**
- `readFormulaSource(source, dialect, inputs, { pcfReaderVersion })`, threaded through `defSchema` (both rails), `evaluateFormula`, `builderInputs.js:421` and `scanObject`.
- `PCF_FUSED` keeps a v1 table.
- The Builder stamps meta on save.
- The server must preserve the meta key. It is presentation, so there is no rev bump.

**Tests**
- Matrix: v1×v2 doc × reader. A missing stamp defaults to v1. A v2 stamp with an old tree is refused.

**Pros**
- General: the next PCF correction reuses it.

**Cons and risks**
- A permanent second grammar. Every reader caller (≥8 call sites) must thread the version, and one forgotten caller is a silent wrong read.
- An absent stamp means v1 forever, so new saves through any door that forgets to stamp silently get v1 maths.
- Bigger blast radius than (a), for a defect affecting one family.

#### (c) Auto-migrate, with notification and alert pause

**Charts, alerts and scans**
- An operator job finds P1 ∧ P1-src rows (§1.6).
- It appends a new version per definition through `user_definitions.save()` with the Python-rewritten tree. Its hash equals the corrected reader's, so the chart re-validates cleanly after the reader deploys.
- `save()` runs the Phase C migration: reset, notice, one suppressed cycle. Optionally, set `indicator_alerts.state` to a paused state until the member confirms.

**Code**
- An operator CLI under `tools/`.
- Notice copy with a reason and the definition name.
- Screen-subscription re-key (as in (a)).
- Deploy order: the migration must land **before or with** the reader fix. Otherwise the window in §1.3 opens.

**Tests**
- Dry-run counts.
- Idempotence (a second run finds 0).
- Hash parity JS↔Python (already measured).
- The migrated row passes admission.
- Notices are counted.
- Paused alerts do not fire.

**Pros**
- Everyone gets correct maths.

**Cons and risks**
- It changes members' alerts and screens without consent. With a notice, it is not silent, but it is not chosen either.
- Scan and forward-record history restarts under the new hash.
- Shared-hash screen subscriptions (§1.5).
- It writes to production stores.

#### Recommendation for STOC: (a) now, with (c) kept as an owner-scheduled follow-up for definitions still unreviewed after a deadline

- The fix and the legacy acceptance **must ship in one deploy**. Never deploy the reader line alone.
- This is the only option that satisfies "no silent change" and keeps the chart, alert and scan lanes agreeing at every moment.
- Its one-click path reuses the existing, tested Phase C migration instead of inventing a bulk one.

---

## 2. Defect 2: thinkScript `AggregationPeriod` composition

### 2.1 Construct matrix (real Import-tab entry `PineBox.inspectSource(src,'thinkscript')`; 120 tail bars of synthetic daily data)

- **The two references** are the same script with `period=` removed, then wrapped:
  - **C** = `tf(…)` (last closed period);
  - **F** = `tf_live(…)` (the period the bar is in).
- **Verdict key:**
  - **✗ wrong**: wrong values;
  - **✓ shape**: right shape, timing undisclosed;
  - **refused**;
  - **?**: ambiguous.

| # | thinkScript | Today's tree | Outcome label | Agreement vs C / F | Verdict |
|---|---|---|---|---|---|
| 1 | `close(period=WEEK)` | `tf(close,'W')` | Exact | 120 / 0 | ✓ shape (reads last *closed* week; thinkorswim reads the forming week; not disclosed) |
| 2 | `high(period=MONTH)` | `tf(high,'M')` | Exact | 120 / 0 | ✓ shape (same) |
| 3 | `Average(close(W),10)` | `sma(tf(close,'W'),10)` | Exact | 0 / 0 (12.2% / 9.6%) | ✗ wrong |
| 4 | `SimpleMovingAvg(close(W),10)` | — | refused (`thinkscript:arity`: `displace`) | — | refused (unrelated reason) |
| 5 | `ExpAverage(close(W),10)` | `ema(tf(close,'W'),10)` | Disclosed (seed note only) | 0 / 0 (8.9%) | ✗ wrong |
| 6 | `WildersAverage(close(W),10)` | `rma(tf(…),10)` | Exact | 0 / 0 (12.7%) | ✗ wrong |
| 7 | `Highest(high(W),10)` | `highest(tf(high,'W'),10)` | Exact | 92 / 29 (5.9%) | ✗ wrong |
| 8 | `Lowest(low(W),10)` | `lowest(tf(low,'W'),10)` | Exact | 1 / 1 (25.6%) | ✗ wrong |
| 9 | `Sum(volume(W),4)` | `sum(tf(volume,'W'),4)` | Exact | 0 / 0 (46.9%) | ✗ wrong |
| 10 | `StDev(close(W),10)` | `stdev(tf(…),10)` | Exact | 0 / 0 (99.7%) | ✗ wrong |
| 11 | `RSI(price=close(W),length=14)` | `rsi(tf(close,'W'),14)` | Exact | 0 / 0 (61%) | ✗ wrong |
| 12 | `BollingerBands(price=close(W),length=20).UpperBand` | — | refused (`displace`) | — | refused (unrelated) |
| 13 | `MovingAverage(AverageType.SIMPLE, close(W),10)` | `sma(tf(…),10)` | Exact | 0 / 0 | ✗ wrong |
| 14 | `MovingAverage(AverageType.EXPONENTIAL, …)` | `ema(tf(…),10)` | Disclosed | 0 / 0 | ✗ wrong |
| 15 | `close(W)[1]` | `tf(close,'W')[1]` | Exact | 24 / **96** | ✗ wrong (one *daily* bar back: wrong on the first day of each week) |
| 16 | `close(MONTH)[2]` | `tf(close,'M')[2]` | Exact | 0 / 12 | ✗ wrong |
| 17 | `close(W) - close(W)[1]` | `tf(close,'W') - tf(close,'W')[1]` | Exact | 24 / 0 | ✗ wrong (zero on 4 days in 5) |
| 18 | `Average(close(W) - open(W),10)` | `sma(tf(close,'W') - tf(open,'W'),10)` | Exact | 0 / 0 | ✗ wrong |
| 19 | `Average(close(W),10)[1]` | `sma(tf(…),10)[1]` | Exact | 0 / 0 | ✗ wrong |
| 20 | `Highest(close(W)[1],10)` | `highest(tf(close,'W')[1],10)` | Exact | 55 / 96 | ✗ wrong |
| 21 | `Average(Average(close(W),5),2)` | `sma(sma(tf(…),5),2)` | Exact | 0 / 0 | ✗ wrong |
| 22 | `def w = close(W); Average(w,10)` | `sma(tf(close,'W'),10)` | Exact | 0 / 0 | ✗ wrong |
| 23 | `input agg = WEEK; Average(close(period=agg),10)` | `sma(tf(close,'W'),10)` | Exact | 0 / 0 | ✗ wrong |
| 24 | `ExpAverage(close(MONTH),6)` | `ema(tf(close,'M'),6)` | Disclosed | 0 / 0 (16%) | ✗ wrong |
| 25 | `volume(W) > Average(volume(W),10)` | `tf(volume,'W') > sma(tf(volume,'W'),10)` | Exact | 93 / 67 | ✗ wrong |
| 26 | `close / close(W)` | `close / tf(close,'W')` | Exact | 120 / 0 | ✓ shape (timing only) |
| 27 | `close crosses above Average(close(W),10)` | `crossOver(close, sma(tf(close,'W'),10))` | Exact | 117 / 114 | ✗ wrong (on crossing bars) |
| 28 | `close(W) crosses above Average(close(W),10)` | `crossOver(tf(close,'W'), sma(tf(close,'W'),10))` | Exact | 111 / 109 | ✗ wrong |
| 29 | `Average(close - close(W),10)` | `sma(close - tf(close,'W'),10)` | Exact | n/a | ? (mixed daily/weekly inside a window; thinkorswim's rule is unverified) |
| 30 | `close > Average(close(W),10)` | `close > sma(tf(close,'W'),10)` | Exact | 106 / 108 | ✗ wrong |

**Independent value checks, made without the engine** (`mtfMatrix.json.checks`):

| Check | Result |
|---|---|
| `tf(sma(close,10),'W')` vs a hand-computed SMA of the last 10 **completed** weeks | 120/120 |
| `tf(sma(close,6),'M')` vs the closed-month SMA6 | 120/120 |
| Today's import vs either 10-week reference | 0/120 |
| `tf(close,'W')` vs the previous week's close | 120/120 |
| `tf_live(close[1],'W')` vs the previous week's close | 120/120 |
| Today's `tf(close,'W')[1]` vs the previous week's close | 96/120 |
| `tf(sma(close,10),'W')` ≡ `tf_live(sma(close,10)[1],'W')` | 120/120 (shifted forming read = closed read) |
| `tf_live(close,'W')` vs the week's **final** close (`tfLive.json`) | 120/120 on past bars |
| `tf_live(close,'W')` vs the current bar's close | 25/120 (the last day of each week, plus the newest bar) |

So on past bars `tf_live` is the period's **final** value. That is the Pine `lookahead_on` model; Pine's `lookahead_on` → `tf_live` is labelled Exact (`pineShape.json`). It is badged `preview-repaints`.

**Pine comparison.**
- `securityAsNode` (`pine.js:11890-11935`) resolves the inner expression in the requested period's context (`requestPeriod`), then wraps it: `{type: live ? 'tf_live' : 'tf', value: code, args:[out]}` (`pine.js:11927`).
- It records `htfStepBacks` (`:11928-11934`) → fold note `htfLookaheadOffStepBacks` (`closedTable.json:3462`, emitted at `pine.js:24553`).
- So Pine emits `tf(sma(close,10),'W')` for `request.security(…,"W",ta.sma(close,10))`. It also emits `sma(tf(close,'W'),10)` for `ta.sma(request.security(…,"W",close),10)`, which is the correct reading of *that* Pine (measured).
- **Reusable from Pine:** the wrap shape and the fold-note channel.
- **Not reusable:** the lift itself. Pine's syntax hands it the subtree, whereas thinkScript marks only the leaf (`thinkscript.js:3862-3871`, via `foreignSeriesCall` and `foreignPeriodOf` at `:3784-3808`). A small shared tree pass is needed (§2.5).

### 2.2 Saved data

- **Storage.** A thinkScript Apply saves plain native text. The thinkScript source and dialect are **not** kept:
  - `BuilderSheet.jsx:451-458` (provenance is Pine-only);
  - `ImportBox.thinkscript.test.jsx:215-258` (byte-identical to typed text; `not.toMatch(/thinkscript/i)`).
  - `compute.source` is e.g. `"sma(tf(close, 'W'), 10)"`. It re-parses to the same tree under any translator, so **a translator fix changes nothing for saved definitions**: no refusal, no new values, alerts and scans unchanged. Only a re-import fixes one.
- **Markers.**
  - None in the definition.
  - **One outside it:** `import_accepted` telemetry, written server-side after a successful save with `dialect` (from `PineBox.jsx:959`, `report.dialect`), `def_id` and `def_hash` (`api/routers/user_definitions.py:217-220`; schema `indicator_telemetry.py:102-112, 133-137`) into `auth.db.landing_events(event, props JSON)` (`auth_db.py:414-422`).
  - Limits: it is only the save straight after an Apply (`BuilderSheet.jsx:3000-3015`, reset at `:2076/2217`). It is best-effort, and only exists since Track C shipped.
  - `def_hash` tells whether the current `ast_hash` is still the imported tree.
- **Tree signature P2.** An `offset` node, or a `call` whose manifest entry declares a `lookback` (a windowed function), with a `tf` or `tf_live` node in its subtree and no other `tf` in between. That is, a window or offset applied **outside** a period read.
  - `detect.js::mtfShapes` (direct-parent form) flags 23 of the 24 wrong-value rows and none of the 3 right-shape rows. It misses #18, where an `op` sits between the window and the `tf`; the subtree form catches #18 too.
  - **It cannot separate intent.**
    - Pine `ta.sma(request.security(..., close), 10)` produces the identical tree and is correct. Stamped Pine Apply saves (`meta.importedFrom.dialect==='pine'`) can be excluded; older unstamped ones cannot.
    - A hand-typed `sma(tf(close,'W'),10)` is a legitimate 10-day mean of the last-closed weekly close.
- **Verdict on telling them apart.** Only P2 ∧ (`landing_events` `import_accepted` with `dialect='thinkscript'` and the same `def_id`) is a confirmed thinkScript-origin defect. P2 alone is "review", not "defect".

Read-only query (proposal):

```sql
-- auth.db, read-only: thinkScript-origin saves
SELECT visitor_id AS user_id,
       json_extract(props,'$.def_id')   AS def_id,
       json_extract(props,'$.def_hash') AS def_hash_at_import,
       created_at
FROM landing_events
WHERE event = 'import_accepted'
  AND json_extract(props,'$.dialect') = 'thinkscript';
-- then in Python: load the newest live user_definitions row for (user_id, def_id),
-- walk compute.ast / compute.trees for P2, and report COUNTS ONLY:
--   confirmed (P2 ∧ thinkscript ∧ ast_hash == def_hash_at_import),
--   edited-since (P2 ∧ thinkscript ∧ ast_hash != def_hash_at_import),
--   armed alerts / screen subs on each (same joins as §1.6).
```

### 2.3 Semantics: what thinkorswim computes

**Evidence available**
- WS7 §3.2 (`WS7-competitor-research.md:255, 428`): secondary aggregation is "at or above the chart period, with one secondary period per expression/variable". [DOC, summarised from the thinkorswim learning-centre chapter "Referencing Secondary Aggregation", listed at `:563`]
- Repo fixtures:
  - `tests/fixtures/thinkscript/09-above-average-price-volume.ts` applies `SimpleMovingAvg(varhigh,20)` to `high(period = DAY)` on an intraday chart. Its curator note reads it as "the 20-day SMA of daily highs" (`SOURCES.md:116`).
  - `22-average-daily-range-zones.ts` uses `dayrange[1]..[10]` over `period = DAY` reads to mean the previous 1..10 **days**.
- Both treat a function or `[n]` over a secondary-aggregation series as operating **in that aggregation**.
- **No vendor capture of thinkorswim values exists in the repo** (`tests/fixtures/vendor/` has none).

**Conclusion (medium confidence; needs one capture)**
- `Average(close(period=WEEK),10)` on a daily chart is a **10-week** SMA.
- On the current bar it includes the **forming** week.
- On past bars, thinkorswim aligns each week's value to every daily bar of that week, so it is likely the week's **final** value: lookahead on history, which is UCT's `tf_live`.
- `close(period=WEEK)[1]` is the previous **week's** close.

**Proposed UCT tree** (basis F):
- An unshifted read `X(period=P)` → `tf_live(X', P)`, where `X'` is the maximal subexpression that reads only period P.
- A read under `[k ≥ 1]` → `tf(X'[k-1], P)`.
- So:
  - `Average(close(W),10)` → `tf_live(sma(close,10),'W')`;
  - `close(W)[1]` → `tf(close,'W')`;
  - `Average(close(W),10)[1]` → `tf(sma(close,10),'W')`.
- The shifted form is **non-repainting and exact** (120/120 identity above). The unshifted form carries the honest `preview-repaints` badge: the readback is "…so far this week" (`pineShape.json`).

**Alternative basis C** (non-repainting everywhere, matching the Pine `lookahead_off` precedent):
- `tf(sma(close,10),'W')`, which is one **week** behind thinkorswim on every bar.
- Shifted reads become `tf(X'[k], P)`.
- This is a larger, persistent difference than Pine's 1-bar-per-period step-back.

**Disclosure text**, to be added as a fold note in the same channel as `htfLookaheadOffStepBacks`:
- **Basis F:** "This study reads a weekly (monthly) series. UCT computes it on weekly (monthly) bars, as thinkorswim does. On the current week the value moves until the week closes; on past bars each day shows that week's final value."
- **Basis C:** "…UCT shows a week's value only after the week has closed, so this line is one week behind thinkorswim."

### 2.4 Messaging: why it said "the values are the same"

- `importOutcome.js:243-249` prints "differences in how it is drawn only; the values are the same" when there are **only** presentation notes. Corpus 07 had presentation notes (its colour was lost) and **no** semantic note.
- **Why no semantic note:**
  - `resolveCall`'s `tf` emission (`thinkscript.js:3869-3871`) records nothing.
  - thinkScript's only semantic note codes are `note-seed` and `note-warmup` (`importOutcome.js:64-75`).
  - `TREE_SEMANTIC_RULES` is empty (`importOutcome.js:97`).
- With no presentation loss, the same import is **"Exact import"**: 21 of the 24 wrong-value rows in §2.1. The other three (#5, #14, #24) are "Disclosed" only because of the EMA seed note.
- The readback "the 10-bar average of (close on the weekly timeframe)" is literally true about *what UCT computes*, not about thinkorswim.

**Proposed copy**

| When | Copy |
|---|---|
| Fixed import, basis F | *Imported, with disclosed differences* — "Weekly/monthly reads are computed on weekly/monthly bars, like thinkorswim. The current week's value updates until it closes (marked 'may repaint'); past bars show each week's final value." |
| Fixed import, basis C | "…shown one week later than thinkorswim, never before the week has closed." |
| Remaining approximations (#29, mixed daily and weekly inside a window) | Refuse with a new guard `thinkscript:aggregation-mixed`: "this averages a mix of daily and weekly values; thinkorswim's rule for that mix is not published, so UCT will not guess. Move the weekly read outside the average, or ask for a weekly average of a weekly series." |
| Badge for existing saved definitions (telemetry-confirmed) | "Imported from thinkorswim before ⟨date⟩: a weekly/monthly value inside an average, high/low or `[n]` was computed on daily bars, so this line is not the 10-week value thinkorswim shows. Re-import the thinkScript to correct it." |
| Badge for P2-only (unconfirmed origin) | No badge. At most a Builder lint hint on edit: "This averages a weekly value over daily bars. Did you mean `tf(sma(close,10),'W')`?" |
| STOC fixed import | Stays "Exact import" (correct after the fix) |
| STOC legacy badge | "Saved with a TC2000 STOC translation error (fixed ⟨date⟩): values were not a 0–100 stochastic and the alerts and screens on it used those values. [Apply corrected STOC]" |

### 2.5 Fix design

**Code**

1. A new shared tree pass, `ast/periodLift.js` (about 60–90 lines), applied in `thinkscript.js` where a plot or def expression is finalised. It runs post-resolution, so `def` and `input` bindings (#22, #23) are already inlined. Rules:
   - Treat each `tf`/`tf_live` that `resolveCall` emits (`:3869-3871`) as a *foreign leaf*. The marker should be a private one, so that only translator-made nodes are lifted.
   - Compute each node's period: base / P / neutral (num) / mixed.
   - Replace each maximal node whose non-neutral leaves are all period P with `wrap(strip(node), P)`.
   - A windowed call or offset over a **mixed** subtree → refuse `thinkscript:aggregation-mixed`.
   - `sym` stays outermost (`pine.js:11874-11878` rule).
2. `wrap`: `tf_live` for an unshifted read, or `tf(x[k-1])` under `offset k≥1` (basis F). Basis C: always `tf`.
3. Record a fold note `thinkscriptSecondaryAggregation` in `closedTable.json` `_folds`, surfaced through `vendorNotes`, so that `importOutcome` classifies it **semantic** (`importOutcome.js:185-191`). Never "Exact".
4. `importOutcome.js:97`: optionally add a `TREE_SEMANTIC_RULES` entry for `tf_live` on thinkScript outputs as belt-and-braces.
5. The saved-definition badge: an owner-run, read-only report (§2.2) that produces an allowlist of `def_id`s. A server-side flag needs a store column or a meta key, which is an owner decision. The client renders the badge.

**Tests**
- Value-checked rails on synthetic bars against **independent** weekly references (the code in `mtfMatrix.test.js` is the template):
  - 10-week SMA, closed and final-of-week;
  - previous-week close for `[1]`;
  - `[2]` monthly;
  - `Highest`/`Lowest`/`Sum`/`StDev`/`RSI` weekly;
  - `crosses` daily-vs-weekly;
  - `def` and `input` binding.
- Replace the shape-only `thinkscript.aggregation.test.js:35-56` expectations, keeping the bare-read cases (1, 2, 26).
- Corpus 07 → semantic outcome, never "values are the same".
- A mixed refusal, with its own sentence.
- Python parity: the lifted trees through `ast_interpret` at 1e-9 (the existing cross-lane harness).
- The scan gate admits `tf_live` W/M from daily bars. The repaint gate requires an acknowledgement for alerts on basis F.

**Regression risk**
- **Low for existing saved definitions:** they are unaffected (§2.2).
- **Medium for the import door:** every thinkScript MTF row changes tree and outcome.
- **Overlap with a peer session:** `C:/w/rpw` has 165 uncommitted lines in `thinkscript.js` (UIE-1 presentation carriage: `NOTES` `note-carried`, readStatement hunks at `:292`, `:1872`, `:2130-2428`; read-only `git diff`). It does not touch `resolveCall` at `:3862-3871`, but sequencing is needed. Its new `note-carried` is a PRESENTATION code by default, so the misleading "values are the same" sentence would also appear on more imports until §2.4 lands.
- **Basis F side-effects:** the `preview-repaints` badge requires an acknowledgement to arm alerts (`alert_user_series.py:824-860`), and past values are period-final (lookahead in any backtest or forward record). Basis C has neither, but is a week late.

---

## 3. Test plan summary (implementation phase; nothing here was run beyond probes)

| Area | Test | Lane |
|---|---|---|
| STOC maths | `STOC14.3` vs an independent %K/%D, bounded 0–100; `STOC14.3 < 20` firing count | JS + Python cross-lane |
| STOC rails | `PCF_FUSED.series` == manifest `argRoles` (all families); same for thinkScript and Pine shapes | JS |
| STOC pins | correct `pcf.vocabulary.test.js:291-302`, `pcf_corpus.json:337-345`, `pcf.js:161-165` prose | JS |
| STOC legacy | old tree + PCF source installs as `legacy:['stoc-v1']`; any other mismatch is still refused; native Pine-order is not legacy | JS |
| STOC re-import | click → corrected hash == `rewriteSwappedStoch`; `rev_bumped`, notice (with reason and name), `last_value` reset, first cycle suppressed | JS + Python |
| Screen subs | `rev_bumped` re-keys `screen_alert_subs`; a shared-hash subscription does not keep firing old maths | Python |
| STOC migration (if (c)) | dry-run counts; idempotent; JS↔Python hash parity; admission passes; no production values printed | Python |
| MTF values | independent 10-week SMA (closed and final), prev-week `[1]`, monthly `[2]`, Highest/Lowest/Sum/StDev/RSI, crosses | JS + Python |
| MTF outcome | corpus 07 semantic; no "values are the same" when a `tf` was lifted; mixed → `thinkscript:aggregation-mixed` | JS |
| MTF saved | P2 predicate unit tests, including Pine `sma(tf(close))` NOT flagged when `importedFrom.dialect==='pine'` | JS + Python |

---

## 4. Decisions the owner must make

1. **STOC migration model.** (a) freeze + badge + one-click (recommended), (b) versioned reader, or (c) auto-migrate. If (a): set a deadline after which (c) runs for unreviewed rows, or decide never to run it.
2. **One-deploy rule.** Approve that the `pcf.js:196` change may only ship together with the legacy acceptance (or after the migration). A reader-only deploy breaks charts and splits the lanes (§1.3).
3. **Screen-alert re-keying on rev change.** Fix it now; it also affects ordinary edits.
4. **Migration notice copy.** Add a reason and the definition name to `deliver_migration_notice`.
5. **MTF basis.** F (`tf_live` unshifted plus `tf(x[k-1])` shifted: faithful to thinkorswim, repaint badge, period-final history) or C (`tf` everywhere: non-repainting, one week late, disclosed).
6. **Vendor confirmation.** Capture one thinkorswim value: daily chart, `Average(close(period=AggregationPeriod.WEEK),10)` on a mid-week bar and on a Friday, plus `close(period=WEEK)[1]`. This settles forming vs final vs closed before the fix ships. Counts and dates only.
7. **Mixed daily/weekly inside a window (#29).** Refuse (recommended) or keep with a disclosure.
8. **Saved thinkScript MTF definitions.** Authorise the read-only telemetry-join report, and decide whether to badge only telemetry-confirmed definitions (recommended) or also show a lint hint for P2-only shapes.
9. **Production reads.** All the queries in §1.6 and §2.2 are proposals. They need explicit owner authorisation and should print counts only.
10. **Sequencing with `C:/w/rpw`.** The thinkScript presentation work is uncommitted. Decide which lands first.
