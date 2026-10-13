# UCT Indicators — Phase A Decision Document

- **Date:** 2026-10-13
- **Baseline:** master = production `4a368e80ed`. No indicator-engine file changed since the audit baseline `84164aee3d`.
- **Status:** investigation only. No runtime code, test or configuration was changed, nothing was pushed, and no production system was read.
- **Supporting investigations** (in this folder):

| File | Covers |
|---|---|
| `PA1-stoc-and-thinkscript-mtf.md` | TC2000 `STOC`, thinkScript weekly/monthly reads |
| `PA2-import-verdict-system.md` | `ta.cum`, the shared compatibility verdict |
| `PA3-visibility-and-undo.md` | Destructive paths, hide/show model, undo |
| `PA4-ichimoku-and-library-classification.md` | Ichimoku, the 13/41/1 breakdown |
| `PA5-pine-runtime-and-linux-security-suite.md` | Stateful Pine runtime, Linux security suite |

Item 9 (feature flags) is answered in §8 of this document.

---

## 1. The seven critical findings, by kind of harm

| # | Finding | Wrong values | Silently alters behaviour | Destroys settings | Misleads about import | Status after follow-up |
|---|---|---|---|---|---|---|
| P0-1 | TC2000 `STOC` argument order | ✅ (chart, scan, alert all wrong; −94…89 instead of 0–100) | — | — | ✅ "Exact import" | **Confirmed**. A naive fix would *also* silently alter behaviour (§2.1) |
| P0-2 | thinkScript weekly/monthly reads | ✅ 24 of 30 constructs wrong | — | — | ✅ 21 of 24 labelled "Exact import" | **Confirmed, wider than reported**. Every function, offset or cross over a weekly/monthly read is affected |
| P0-3 | Pine `ta.cum` | ✅ value depends on loaded history | — | — | ✅ box "Not supported" above an attach button | **Corrected**: a chart badge exists, but it is weak and missing in colour/drawing cases. Folded into the verdict work |
| P0-4 | Ichimoku spans not displaced, no cloud | ✅ price-vs-cloud differs on 33.8% of bars | — | — | — (library text "projected cloud" is false) | **Confirmed**. The span maths is right; the *placement* is wrong. An original gap, frozen for pixel parity on 2026-08-01, never revisited |
| P0-5 | "Last value horizontal" draws a normal line | — | — | — | misleading UI | Confirmed, low impact |
| P0-6 | Turning an indicator off deletes every instance | — | ✅ severs dependent MA-on-RSI and info values | ✅ **inputs unrecoverable** (tombstones keep only the id) | — | **Confirmed, wider than reported** (§2.5) |
| P0-7 | Contradictory Pine import verdicts | — | ✅ 129 history-dependent attachments, 9 badged | — | ✅ 67 "Not supported" that attach; 89 "Partial" that are refused; 77 false "values are the same"; 8 "Exact" that differ | **Confirmed and quantified** over 336 TradingView captures |

**New defects found in this follow-up** (all verified in code):

| ID | Defect | Harm | Source |
|---|---|---|---|
| N1 | Right-click pane menu "**Hide** RSI" calls the delete-all writer (`StockChart.jsx:5927`, confirmed by the lead) | Destroys settings; the label says Hide | PA3 |
| N2 | Right-click ▸ Indicators ▸ MA: unticking deletes **every** moving average, including the defaults (4 → 0) | Destroys settings | PA3 |
| N3 | Opening a `?state=` share link replaces the recipient's own instances, with no confirm or undo (`StockChart.jsx:6220-6249`) | Destroys settings | PA3 |
| N4 | Restore Defaults, settings presets and template/layout apply write `indicatorInstances: []` with no tombstones and no undo. A stale writer can bring the instances back | Destroys settings or resurrects them | PA3 |
| N5 | Grid cell + Ctrl+I writes the first widget's instances into the global blob as tombstones | Destroys settings | PA3 |
| N6 | Alert orphan sweep counts a tombstone as live (`indicator_alert_service.py:1433-1459`), so deleting an alerted indicator never flags its alert | Silently alters behaviour | PA3 |
| N7 | Screen-alert subscriptions are keyed by tree hash and not re-keyed on edit (`screen_alerts.py:62-67, 141-154, 249-283`). After any maths change they go silent or follow another member's old tree | Silently alters behaviour | PA1 |
| N8 | Formula `kcUpper` uses an EMA of true range; the chart's Keltner uses Wilder ATR(10) | Wrong values (formula vs chart) | PA4 |
| N9 | Saving a deeply nested tree (depth ≥ 300) raises an **unhandled 500** from a recursive hash that runs before the budget check (`user_definitions.py:1720` vs `:1792`). Nothing is stored. Happens on Linux too | Robustness (P3–P2) | PA5 |
| N10 | `full-suite-report.yml` has recorded **0 vitest tests in its last 99 runs** (since 10-03), and the deploy gate runs none of the security rails | Hidden test blindness | PA5 |

---

## 2. Findings by owner question

### 2.1 TC2000 `STOC` (P0-1) — saved formulas and armed alerts *are* affected

- **What is stored:** the TC2000 text in `compute.source` and the wrong tree in `compute.ast` (`PineBox.jsx:397-411`).
  - On every load the browser re-reads the text and refuses the definition if the hash differs (`defSchema.js:856-872`, confirmed by the lead).
  - The server stores the tree and hash and never re-reads the text.
- **A one-line reader fix on its own is unsafe.**
  - Every saved STOC definition would fail its hash on load and stop drawing (`instances.js:604-614`).
  - Alerts (tree snapshotted at arm time, `alert_user_series.py:518-526`) and scans (stored tree, keyed by hash) would keep firing on the old maths.
  - The chart would go blank while alerts kept acting. That is worse than today.
- **Detection is possible without reading production.**
  - Signature: a `stoch` call whose first three arguments are `close, high, low`, plus a source matching `(?i)\bSTOC\d`.
  - A Python rewrite produces the corrected hash, so no JS parser is needed server-side.
  - A read-only, counts-only operator script is in PA1. It has **not been run**.
- **Recommended: option (a), freeze + badge + one click.**
  1. In **one deploy**, fix the reader *and* have the loader accept the recorded legacy reading of `STOC` only.
  2. Existing definitions keep drawing exactly what their alerts and scans compute, with a badge: "Imported with a known TC2000 Stochastic defect — review".
  3. One click re-reads the text and saves a new version through the **existing** revision migration (reset, notice, one skipped cycle).
  4. Add the definition name and a reason to that notice.
  5. Fix N7, re-keying screen subscriptions on a maths change, in the same batch.
- **Nothing changes behaviour without the member's click.**

### 2.2 thinkScript weekly/monthly (P0-2)

- **Affected constructs:** any function, offset `[n]`, cross, or nested expression over `X(period = WEEK|MONTH)`.
  - All of these are wrong: `Average`, `ExpAverage`, `WildersAverage`, `Highest`, `Lowest`, `Sum`, `StDev`, `RSI(price=…)`, `BollingerBands(price=…)`, `MovingAverage`, crosses, offsets, and `def`/`input` forms.
  - Bare reads are right, but their forming-week vs closed-week timing is not disclosed.
  - Full matrix: 30 constructs in PA1.
- **Saved indicators:** existing imports *are* wrong and are **not** fixed by a translator change.
  - They are stored as plain native formula text with no thinkScript marker.
  - The same tree is produced legitimately by Pine `ta.sma(request.security(…),10)`, or can be typed by hand.
  - The only reliable marker is the `import_accepted` telemetry row (`dialect='thinkscript'`, `def_id`, `def_hash`).
- **Messaging cause:** no note code is emitted for the period read, so the fallback sentence "the values are the same" prints (`importOutcome.js:64-75, 97, 243-249`).
- **Proposed fix:**
  1. A shared tree pass `ast/periodLift.js` lifts the whole subexpression into the period, as the Pine door already does (`pine.js:11890-11935`).
  2. It emits a **semantic** disclosure note.
  3. Daily and weekly mixed inside one window is refused.
  4. Value-checked tests against independent weekly references (the corrected trees are verified 120/120 in PA1).
  5. Saved definitions get a badge, but **only where telemetry confirms** a thinkScript origin.
- **Prerequisite:** one owner-captured thinkorswim reading.

### 2.3 Pine `ta.cum` and one shared verdict (P0-3, P0-7)

**How the divergence happened.** Each lane was right on its own; the defect is that only one lane's verdict is shown.
- 09-01 (`b0bb44b5c1`): the scan lane got its refusal sentence.
- 09-08 (`01f2390598`): the strict chart lane was added.
- 09-09 (`0a96689ef0`, owner ruling D): `ta.cum` was allowed on the pane only.
- 09-15 (ruling R14): differing lanes declared deliberate.
- 10-05 (`a0e068ef6a`): `importOutcome` was built on the **scan** lane's report only.

The chart lane computes no verdict of its own and drops the translator's notes (`memberPaneDefinition.js:716-760`). The note list is open: 4 codes are classified, and everything else counts as "presentation only".

**Proposed single system** (extends `importOutcome.js`, with no parallel infrastructure):
- **One function.** `compatibilityVerdict(input, {lane})` is computed from the lane that will act: the chart lane for attach, the scan lane for scans.
- **Typed outcome** in four classes: values, visuals, inputs, behaviour (alerts, orders, repaint, history). It is saved as `meta.importVerdict`.
- **Closed note-code registry** of about 96 codes. An unknown code means "values may differ", and a rail checks that every emitted code is registered.
- **"Exact" only with evidence:** a TradingView capture or a reference test per construct, generated from the vendor harness.
- **One renderer** (`ImportVerdict.jsx` plus a text form), used by the paste box, the pane, the chart, bulk intake and Agent receipts.
- **History-dependent constructs** need an acknowledgement modelled on the existing repaint acknowledgement (server returns 422 without it). A new `listing_dependent` tag.
- **Old saves are migrated on read:**
  - the verdict is derived when read and never shown as "Exact";
  - the chart badge also reads the server's `row.requirements`, which fills the missing badges with no data migration.

**`ta.cum` recommendation: Option B.** Attach with an acknowledged, saved disclosure naming the first bar's date and stating that it differs from TradingView.
- Refusing everywhere would reverse owner ruling D, and would lose `atr-trailing-stoploss`, which matches TradingView today.
- Anchoring at the listing date can't match TradingView intraday and often isn't possible on daily history.

**Visible consequence:** 77 import headlines would honestly downgrade from "the values are the same".

### 2.4 Indicator visibility (P0-6, N1–N6)

- **Every destructive path is traced** (full table in PA3).
  - **Delete-all writer:** every path that ends in `setIndicatorEnabled(false)`:
    - Library row;
    - right-click submenu;
    - Ctrl+I/O/B and Alt+U;
    - the phone ƒx switch and "Remove from chart";
    - the pane "Hide";
    - the MA submenu.
  - **Whole-blob wipes:** Restore Defaults, presets, template/layout apply, share links.
  - **Not destructive:** chip Delete, Settings ✕, the per-instance eye, Alt+Shift+I, symbol and timeframe changes.
- **History:** the delete-all behaviour was written on 2026-08-03 (`7d5c37e447`), when one instance per definition was the rule. It was never revisited when multiple instances shipped on 08-07 (`a72a0d8483`).
- **Proposed model:**
  - **"Off" hides.** It hides the visible instances and marks them `hiddenVia:'definition'`. "Show" restores exactly those; individually hidden instances stay hidden.
  - **Dependents are kept.** The engine already computes a hidden source for a visible reader.
  - **Removal is explicit, per instance.** "Remove all of X" exists only in Settings, with an undo toast.
  - **Doors read three states:** absent, shown, hidden.
  - **Old tabs are safe:** verified with a version-skew probe. One deploy cycle remains in which an old tab's Library click still runs the old delete-all.
  - **Tested:** a prototype passes a 200-sequence property test. Today's code fails 199 of 200.
- **Undo:**
  - per chart surface, 50 steps, with redo;
  - kept in sessionStorage, so it survives a reload of the same tab;
  - byte-exact, recording whole instance elements;
  - shared record format with the Agent's undo;
  - toast plus panel buttons;
  - Ctrl+Z only while the toast is visible, until the drawing session agrees a shared arbiter.
- **Unavailable-indicator notice:** "⚠ N indicators can't be shown", with Repair / Remove / Restore formula / Keep. The dropped records are still in the blob, so they are recoverable.
- **Already-deleted instances:** not recoverable from chart data, because tombstones keep only the id. Partial sources:
  - Version History, if the workspace document store is armed (not verified);
  - alert parameter snapshots;
  - saved templates.
  
  **No automatic restore is recommended.**

### 2.5 Ichimoku (P0-4)

- **Why it was deferred:**
  - The first implementation (`4faa2b9bc9`, 2026-05-04) never displaced the spans.
  - 2026-08-01 (`2a61e0ce08`, B1 plan): frozen deliberately "for pixel parity, correction in B3 with owner sign-off".
  - B3 never scheduled it.
  - The only Ichimoku owner input on record concerns the Chikou repaint badge.
- **Constraints found:**
  - No native can output values past the last bar yet. `plots[].displace` accepts negative values only.
  - The future-axis slots exist but are under 25 on 30m, 60m, W and M.
  - Bollinger and Donchian draw **no** fill; the usable fill primitive (`plots[].fill.with`) is unused by natives.
  - Chikou is shifted 26 bars back; TradingView uses 25.
- **Compatibility:**
  - Instances store inputs only, with no maths version.
  - Alerts snapshot parameters, and a maths-revision bump force-migrates every alert.
  - Key fact: **today's undisplaced `spanA` is exactly the conventional *leading* Span A**. Existing alerts can therefore keep their exact numbers and simply be relabelled "Leading Span".
- **Recommended: option (b).** One definition with a `displacement` input:
  - a missing key means 0, which is legacy, byte-identical, with no revision bump;
  - new instances get 26;
  - a one-click upgrade in Settings;
  - armed alerts pinned to `displacement=0` and relabelled; nothing changes without consent.
  
  This follows the precedent of the Stochastic `smoothK` input (`nativeRegistry.js:550-557`).
- **Prerequisites:**
  - Fix alert parameter seeding from the chart instance first (WS1 D-5); otherwise new alerts would silently stay legacy.
  - Binder support for a 25-bar projected tail.
  - At least 25 future slots on every timeframe.

### 2.6 The stateful Pine engine (runtime VM) — do not enable; not ready

- **Decisions on record:**
  - 2026-09-18 architecture: one JS runtime; a Python port rejected as 33× slower.
  - 2026-09-28 (`bb72f13054`): built dark, under the owner principle "what the columnar lane can't represent routes to the runtime".
  - 2026-10-02 owner rulings D1–D6: admins first, a 128 KiB cap, a 1,000 ms budget, an allowlist of one script.
  - 2026-10-12: "advanced Pine stays off". The exact sentence "Keep advanced Pine disabled in production" isn't in the repo verbatim; only these paraphrases are.
- **Rationale:** per-bar `var` state, data-dependent loops, arrays and records can't be expressed as one finite tree.
- **Security:**
  - Purely interpreted IR in a module Worker, with no DOM and no network.
  - 24 named limits, a 1 s pane budget and a 20 s watchdog.
  - A five-step server save gate.
  - Gap: strings are not charged to memory.
- **Performance** (shared CPU, so ratios only):
  - about 2.1 µs/bar;
  - append-resume 1.9–2.0× faster than a cold run;
  - one worker per tab queues many panes.
- **The server never executes runtime documents.** For members it would be **chart-only**: no alerts, no scans.
- **Status:** 118 test files. A representative subset passes (278/278 frontend, 97 Python). 16 of 266 census scripts route to it; 7 fully match captures; 1 is allowlisted.
- **Enablement checklist, E1–E9 (PA5): none fully met.**
  - Partial: E3 grading, E6 staged rollout (no cohort stage), E8 performance budget, E9 rollback (never exercised).
  - Unmet: E1 Linux security suite, E2 string accounting, E4 one shared verdict, E5 alerts/scans story, E7 kill-switch drill.

### 2.7 The 13 / 41 / 1 classification

The 41 "limited" built-ins carry **78 limitations**:

| Category | Count |
|---|---|
| Surface reach (chart-only: no alerts, screener or formula) | 39 |
| Convention difference (documented) | 15 |
| Incomplete configuration | 5 |
| Timeframe gating | 4 |
| Calculation defect | 4 |
| Chart vs alert/formula mismatch | 4 |
| Other | 7 |

**By severity:** 3 user-visible wrong values, 8 misleading, 46 missing capability, 21 cosmetic.

**Only 7 of the 41 have a value-level problem:**
- AVWAP calendar anchors;
- VWAP blanking after one missing volume;
- RS Line rounding;
- Volume Profile approximation;
- VWAP alert anchor;
- Stochastic slow vs fast;
- Keltner formula vs chart (N8).

**The other 34 compute correctly.** 16 of them are purely chart-only.

**Correction to the audit:** TradingView's Historical Volatility reads about 17% higher at period 20, not 23% (medium confidence; not re-fetched).

---

## 3. Proposed fix order and implementation batches

The order follows harm: protect the safety net first, then stop ongoing data loss, then correct values, then make reporting honest, then fix conventions.

| Batch | Scope | Why here | Effort |
|---|---|---|---|
| **A0 — Safety net** (no member-visible change, except N9's message) | Add `version` to the fixtures behind the 68 red security rails. Re-ground the concierge/starter fixtures and the phase-E `~s2` lookup. Flatten the census payload. Bound the recursive hash so deep trees get a named 400 (N9). Fix the alert orphan sweep (N6, one line). Fix the CI full-suite vitest count (N10). **Add a Linux `workflow_dispatch` security-suite job** (needs approval, §5) | Every later batch changes behaviour that these rails are meant to guard | S–M |
| **A1 — Protect configured studies** | The hide/show model on every "off" door, including N1, N2 and N5. The phone sheet removes one instance. Restore Defaults/presets keep indicators, or warn with undo (N4). Share-link apply asks first, with undo (N3). Indicator undo stack. Unavailable-indicator notice. Uninstall deleted definitions in open tabs | Ongoing, unrecoverable loss of member work | M–L |
| **A2 — Import value correctness** (can run in parallel with A1; different files) | STOC: reader fix + legacy acceptance + badge + one-click re-import, in one deploy, plus the migration-notice copy and N7 screen-subscription re-keying. thinkScript period lift + semantic note + mixed-period refusal, after the owner's thinkorswim capture. Badge telemetry-confirmed saved imports | Wrong numbers drive members' scans and alerts | M–L |
| **A3 — One honest verdict** | `compatibilityVerdict`, closed registry, evidence-backed "Exact", one renderer across all doors and Agent receipts, `ta.cum` Option B acknowledgement, migrate-on-read, badges from server requirements | Trust contract for migration; prerequisite for any runtime enablement | M–L |
| **A4 — Calculation truth and renderer honesty** | Seed alert parameters from the chart instance (D-5; prerequisite for Ichimoku). VWAP alert RTH/ETH anchor. AVWAP calendar anchors refuse partial history. Keltner formula parity (N8). Ichimoku option (b). Remove or implement "Last value horizontal". Marker dots and autoscale. Own-pane object coordinates | Correct, conventional values with no silent change to existing studies | L |

**Recommended sequence:** A0 → (A1 ∥ A2) → A3 → A4.

Each batch ships on its own branch, with local verification and an owner release gate, per the standing release practice.

---

## 4. Compatibility and data-migration risks

| Risk | Where | Mitigation in the proposals |
|---|---|---|
| Saved STOC definitions disappear if only the reader is fixed | A2 | Legacy acceptance in the same deploy; one-deploy rule enforced by a test |
| Armed alerts silently change meaning | A2 (STOC), A4 (Ichimoku, VWAP, D-5) | Nothing auto-migrates. Existing alerts keep their tree or parameters. Changes go through the existing revision migration only on the member's click, with a named notice |
| Screen subscriptions orphaned after a maths change | A2 (N7) | Re-key on revision |
| Old browser tabs during deploy | A1 | Verified safe except one deploy cycle of old delete-all from a stale tab. Optionally force a reload prompt |
| Tests pinning current behaviour | A1 (about 12 files), A3 (wording) | Updated deliberately, each with the reason, never weakened |
| 77 headlines downgrade visibly | A3 | Intended honesty change; owner sign-off |
| Ichimoku legacy vs conventional on one chart | A4 | Explicit legacy badge plus one-click upgrade; templates and presets may re-create legacy instances (noted) |
| Already-lost instances | A1 | Not recoverable from chart data; no auto-restore |
| Production counts unknown | A2, A3 | Read-only, counts-only queries prepared (PA1, PA2), **not run**; need authorisation |

---

## 5. Test and acceptance requirements

**Universal (every batch):**
- Every fix comes with a test that **fails on today's code**.
- Value fixes are checked against an independent reference on synthetic bars.
- Python and JS lanes agree.
- Backend indicator rails pass at head.
- The **Linux security suite passes** before merge: 26 pytest + 18 vitest files (listed in PA5). The current Linux baseline is 69 red; the target is 0.

**Per batch:**

| Batch | Acceptance criteria |
|---|---|
| A0 | The 68 security rails reach their own guard and pass. The escape census passes on Linux. A depth-300 save returns a named 400. The orphan sweep flags a tombstoned alert source. CI reports a non-zero vitest count |
| A1 | A 200-sequence property test passes: no inputs lost except by explicit remove, and undo is byte-identical. Every path in the PA3 table is covered by a test. Version-skew probe green |
| A2 | Every STOC form is 0–100 and matches a reference. Legacy STOC definitions still draw and agree with their alerts. Re-import goes through the revision migration. All 30 thinkScript constructs are either correct against weekly/monthly references or refused. No "Exact" on a period read without a test |
| A3 | Re-running all 336 captures gives **zero contradictions** between the shown verdict and the drawing lane, and zero unregistered note codes. "Exact" appears only where evidence exists. Every history-dependent attach is acknowledged |
| A4 | Ichimoku d=0 is byte-identical to the golden fixture. d=26 matches a closed-form reference including displacement. VWAP alert equals the chart value in RTH and ETH views. AVWAP partial anchors refused |

---

## 6. Dependencies on other active UCT projects

| Project / session | Interaction | Needed |
|---|---|---|
| **UIE alert-coverage RC** (`C:/w/uie7`, awaiting your push) | Touches `alert_user_series.py`; A2/A4 alert work touches the same area | Release or hold the RC before A2/A4 alert changes |
| **thinkScript presentation work** (`C:/w/rpw`, uncommitted) | Same file as the A2 period lift. Its new note would spread the misleading sentence | Decide which lands first; coordinate with its owner |
| **Agent sessions** (`C:/w/apr` hotfix now live; `C:/w/simp` simple conversations) | Agent receipts must use the A3 verdict. A1 undo shares a record format with `agentMutations` | Agree on interfaces before A1/A3 |
| **Drawing tools** (`StockChart.jsx`, `ChartDrawingOverlay`, `drawingsStore`) | Ctrl+Z arbitration; four small `StockChart.jsx` edits in A1 | Sign-off from the drawing owner |
| **Alerts owners** | Revision-migration notice copy, N6 sweep, N7 screen re-key | Review |
| **Workspace doc store** | Version History, cross-tab conflicts (409 vs last-write-wins) | Confirm the flag's live state |
| **Release practice** | `pre_push_guard`, flow-worker marker bumps for `api/**` changes | Normal |

---

## 7. Stateful Pine runtime — requirements before any enablement

The full list is E1–E9 in PA5. The minimum before even an admin stage:
1. The Linux security suite passes.
2. String and heap accounting is added to runtime memory.
3. The A3 shared verdict is shipped.
4. Every promoted script has a capture-graded MATCH.
5. A kill-switch drill and a rollback rehearsal have been run.
6. A defined member experience, given that alerts and scans can't run runtime documents.
7. A performance budget for multi-pane layouts.

**Recommendation: keep it dark through Phase A.**

---

## 8. Feature-flag ledger (item 9)

These conclusions come from repo-only evidence: code, the Dockerfile, ledger rules and git. **Fetching the public production JavaScript bundle to confirm was denied as a production read, so I stopped.**

| Flag | Code default | Ledger says | Effective state | Why |
|---|---|---|---|---|
| `VITE_INDICATOR_TEMPLATES_ENABLED` | OFF (only `'1'` is on; `indicatorTemplates.js:66`) | `status: armed`, but `railway_value: UNSET on every service` | **OFF**, high confidence | The ledger defines "armed" as "set on at least one Railway service", so the status contradicts the entry's own Railway value. The status field is wrong; it should be *pending*. Built dark on 10-11 (`9a8ef34ff7`) |
| `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` | OFF (only `'1'`; `objectsOnlyPaneGate.js:50`) | `status: armed`, `railway_value: 1 on web (read 2026-09-30)`, `baked_value: undefined` (measured 09-23) | **ON**, medium-high confidence | `baked_value` was measured on 09-23, before the build ARG existed. The ARG was added the same day (`3a56c9aaa1`, `Dockerfile.web:113`), and Railway web was read at `1` a week later. Any web build since then bakes `1`. The field is stale, not contradictory |

**To confirm without secrets or configuration changes**, any one of these works:
1. **You approve a one-off fetch of the public production JS bundle.** It's the same file every visitor downloads, and the check is a search for the two flag values.
2. **A signed-in admin does a 30-second visual check:**
   - Chart Settings → Indicators: no "Indicator templates" bar means templates are OFF;
   - a Pine script whose only output is a table attaches and draws: objects-only is ON.
3. **Run `tools/flag_ledger_audit.py`.** It needs Railway CLI access, so you would run it.

Whichever confirms, correct the two ledger fields (a docs-only change).

---

## 9. Windows-only sandbox limitation (item 10)

- **Cause:**
  - `tools/ast_conformance.py:868` calls `json.dumps` on a 4,000-deep tree.
  - CPython 3.12's encoder hits a compiled-in C recursion limit, which is lower on Windows (fails at depth 3,000).
  - `setrecursionlimit` and a larger thread stack don't help.
- **The tests already pass on Linux CI** (run `38334654786`, master `caf67367b5`). The *security* claims are fine; the harness is platform-fragile.
- **The real Linux problem is different.** 69 suite tests are red on Linux too: 68 from the `definition.version` fixture drift, 1 from a duplicate paywall sentence. The protections hold (80 of 81 pass with a scratch version shim), but the rails don't exercise them.
- **Production runtime:** `python:3.12-slim-bookworm` with a floating patch (3.12.7 last recorded) and Node 20.18.0. Docker and WSL are not installed here, and you've ruled against installing them (per the `ocr-linux-cert.yml` header).
- **Recommendation:**
  1. In A0, repair the fixtures, flatten the census payload and bound the hash recursion.
  2. Add a **`workflow_dispatch`-only GitHub Actions job**, modelled on `ocr-linux-cert.yml`. It runs the 26 + 18 security-suite files inside `python:3.12-slim-bookworm` with Node 20.18.0 and **no secrets**.
  3. Require that job to pass before merging any batch that touches execution, budgets, the save door or the runtime.
  
  The exact command and file list are in PA5.

---

## 10. Explicit decisions requiring your approval

**Batches and order**

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve batch plan A0 → (A1 ∥ A2) → A3 → A4 | Approve |
| D2 | Authorise the Linux `workflow_dispatch` security-suite job (no secrets; manual trigger only) | Approve |

**Protecting configured studies (A1)**

| # | Decision | Recommendation |
|---|---|---|
| D3 | "Off" means **hide**, restored exactly via the `hiddenVia` marker | Approve |
| D4 | "Remove all of X" exists only in Settings, with an undo toast | Approve |
| D5 | Restore Defaults and presets keep indicators (they reset chart appearance only) | Approve |
| D6 | Share-link apply asks before replacing your indicators, with undo | Approve |
| D7 | Indicator undo: per chart, 50 steps, survives a same-tab reload; Ctrl+Z only while the toast shows until the drawing owner agrees | Approve |
| D8 | No automatic restore of already-deleted instances | Approve |

**Import corrections (A2)**

| # | Decision | Recommendation |
|---|---|---|
| D9 | STOC option (a): freeze + badge + one-click re-import. Optionally a later deadline before auto-migration | (a), no deadline yet |
| D10 | One-deploy rule: the STOC reader fix ships only with legacy acceptance | Approve |
| D11 | Fix screen-subscription re-keying (N7) now; it also affects ordinary edits | Approve |
| D12 | thinkScript weekly/monthly basis: faithful `tf_live` (matches thinkorswim, shows a repaint badge, alert arming needs an acknowledgement) or `tf` (no repaint, one period late) | Your call. I lean `tf` plus a disclosure, for alert safety |
| D13 | Provide one thinkorswim reading of `Average(close(period=WEEK),10)` (mid-week and Friday) and `close(period=WEEK)[1]` before the MTF fix | Needed |
| D14 | Refuse daily and weekly mixed inside one average | Refuse |

**Import verdicts (A3)**

| # | Decision | Recommendation |
|---|---|---|
| D15 | `ta.cum` option B: attach with an acknowledged, dated disclosure that it differs from TradingView | Approve |
| D16 | Accept the visible honesty downgrade of 77 import headlines | Approve |
| D17 | "Exact" requires a TradingView capture or reference test | Approve |
| D18 | Show the chart verdict first, with the scan verdict as a labelled second line | Approve |
| D19 | Store the original Pine/thinkScript source with imports (enables re-translation later) | Approve, size-capped |
| D20 | Agent receipts carry the verdict | Approve; coordinate with the Agent sessions |

**Calculations and Ichimoku (A4)**

| # | Decision | Recommendation |
|---|---|---|
| D21 | Ichimoku option (b): `displacement` input, legacy 0 for existing, 26 for new, one-click upgrade, armed alerts relabelled and unchanged | Approve |
| D22 | Ichimoku convention: TradingView (Chikou 25) or classic (26) | TradingView (25) |
| D23 | Legacy Ichimoku mode permanent, or sunset with notice | Sunset with notice after 90 days |
| D24 | Fix alert parameter seeding from the chart instance before Ichimoku | Approve |

**Production reads, coordination and the runtime**

| # | Decision | Recommendation |
|---|---|---|
| D25 | Authorise the read-only, counts-only production queries in PA1/PA2: affected STOC definitions, telemetry-confirmed thinkScript MTF imports, Pine `window_dependent` rows | Authorise, counts only |
| D26 | Confirm the two flags via one of the §8 options, then correct the ledger | Option 2 (admin visual check) or 1 |
| D27 | Sequencing with `C:/w/rpw` thinkScript presentation work | Its owner rebases onto A2's period lift; its note uses the A3 verdict |
| D28 | Hold the UIE alert-coverage RC decision before A2/A4 alert changes | Decide its release first |
| D29 | Keep the stateful Pine runtime dark through Phase A | Approve |

---

## 11. What is not changed by this document

- No runtime code, test, flag or configuration.
- No push, merge or deploy.
- No production query was run.
- No change to the Agent hotfix, `C:/w/rpw` or `C:/w/uie7`.
- **Corrections to the audit made in this follow-up:**
  - P0-3 is reworded (a chart badge exists), in `03-GAP-ANALYSIS.md` and `05-EXECUTIVE-SUMMARY.md`.
  - The Historical Volatility gap is about 17%, not 23%.
  - N9 amends the WS8 claim that no product depth issue exists.
