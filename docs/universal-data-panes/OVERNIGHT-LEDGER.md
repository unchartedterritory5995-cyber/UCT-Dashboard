# Universal Data Panes — overnight engineering ledger

Engineering state only. No secrets, no credentials, no member data, no database
contents. Dev-only document; nothing here is loaded at runtime.

**Recovery drill:** `git status` → read this file → `git show <LAST KNOWN GOOD>` →
continue at NEXT AUTHORIZED ACTION. Never reconstruct from chat history.

Worktree: `C:\w\p2`. Run tests and builds from `C:\w\p2\app`.

### Procedures a fresh session needs

**Tests / build** (from `C:\w\p2\app`): `npx vitest run <path>` for focused,
`npx vitest run` for the full suite, `npx vite build`.

**Safe browser proof.** Start `npx vite --port 5173 --strictPort` from
`C:\w\p2\app`, open `http://localhost:5173/pane-harness.html`. It mounts the real
`StockChart`, the real `IndicatorLibraryDialog` and real bars off `:8000`, and it
severs `/api/auth/preferences` both ways so it cannot reach a stored preference.
⛔ Never use Main Trading, and never open `/charts` for this — opening it RESTORES
and rewrites the preference.

**Main Trading fingerprint — READ-ONLY, never via the browser:**

```bash
python3 - <<'PY'
import sqlite3, hashlib
con = sqlite3.connect('file:C:/data/auth.db?mode=ro', uri=True, timeout=3)
for uid, v in con.execute(
        "select user_id, pref_value from user_preferences where pref_key='chart_settings'"):
    b = v.encode('utf-8') if isinstance(v, str) else v
    if str(uid).startswith('40d361fa'):
        print(str(uid)[:8], len(b), hashlib.sha256(b).hexdigest()[:12])
con.close()
PY
```

Expected, unchanged: `40d361fa 5354 ea9ebaeee302`.

**Baseline comparison.** To prove a failure pre-exists, add a throwaway detached
worktree at the base commit and junction `node_modules` into it rather than
reinstalling:

```bash
git worktree add --detach C:/w/p2b 735704fd7
cmd /c mklink /J "C:\w\p2b\app\node_modules" "C:\w\p2\app\node_modules"
# …run the suspect files there, then:
git worktree remove --force C:/w/p2b
```

---

## OVERNIGHT SESSION — 2026-09-12 / 13

### CURRENT PHASE
Overnight slice 2 — Universal Data Panes completion pass (the trader workflow,
end to end, in the browser).

### CURRENT STATUS
Slice 2 (completion pass) substantially complete and checkpointed. Three defects
found by walking the workflow, all fixed and railed.

### BRANCH
`feat/universal-data-series`

### HEAD
`152042d5f`

### LAST KNOWN GOOD COMMIT
`152042d5f` — fix(chart): a pane move invalidates the heights applied after it.
(Base of the whole branch: `735704fd7`.)

Checkpoints, newest first:
- `152042d5f` pane order/height convergence after a single move
- `4e1680780` direct series reads as itself; duplicate rows told apart
- `76d98c035` ledger
- `7fa4d70f9` slice 1 — Rulings A and B, plus direct-series naming and the
  source-control fix
- `ca8c7a80f` / `692ed9c83` this ledger
- `d1d66c7a8` P2.0c → P2.3 and the multi-pane scale fix

### WORKING TREE STATUS
Clean at the time of writing.

---

### COMPLETED (this checkpoint)
- P2.0c instance-hosted pane identity — a pane is keyed by its HOST INSTANCE, so
  two RSIs on Own Pane are two panes. Pane keys derived every paint, never
  persisted; no migration.
- P2.1 catalogue facade (`discoveryCatalog.js`) + generic `dataSeries` definition
  whose compute is the identity and whose source family is invisible to it.
- P2.2 Add to Chart — symbols and breadth as rows in the existing
  `IndicatorLibraryDialog`. One shell, one search, one persistence path.
- Multi-pane price-scale fix — `MAIN_TOP` headroom is a fraction of pane 0's own
  height, not of the whole chart budget. Fixed a −400…2,400 price axis at four
  panes.
- P2.3 multi-series pane composition — the existing Display In control offers the
  panes other instances host.
- P2.3 defect: `validateInstance` rejected a stored `@<hostInstanceId>` target,
  which DROPPED the instance and let legacy derivation recreate a different
  indicator against the wrong instrument. Validator widened; renderer-level rail
  added.

**Slice 1 (`7fa4d70f9`) — Rulings A and B**
- Ruling A: a guest whose host was deleted keeps its placement, draws nothing,
  and the settings control STATES it — a disabled "Pane unavailable" entry plus
  one line of explanation. Nothing is written during render.
- Ruling B: ordinals are scoped to the colliding LABEL, so `QQQ #1` / `QQQ #2` /
  `SPY` — never `SPY #3`.
- `disambiguateLabels` extracted in `readout.js`; the legend, the Display In menu
  and the settings rows all call it over the same population, so the three
  surfaces cannot word an instance differently.
- A direct series' settings row is named after its instrument, not "Data Series",
  and its category badge is suppressed. Gated on `meta.labelFrom`, not on an id.
- The Source control passed three arguments to `sourceOptions` and so could not
  represent its own value: every direct series read "Source unavailable" over a
  valid `sym:…` source. Fixed; a severed source still reads unavailable.

**Slice 2 — completion pass (`4e1680780`, `152042d5f`)**
- Walked the member workflow end to end in the harness: add QQQ/SPY/UCTA50/RSI
  through the real Add-to-Chart dialog, compose, separate, duplicate, hide/show,
  restyle, move above/below, delete, re-add, reconstruct.
- Defect 1 — the Source picker read `QQQ → Series`. The passthrough's plot label
  is now `Value`; `meta.shortName` stays `Series` for a series over an instance
  source.
- Defect 2 — two RSIs produced two settings rows both reading "Relative Strength
  Index" while their chips read `#1` / `#2`. Row labels now run through
  `disambiguateLabels` too.
- Defect 3 (the significant one) — sending a pane ABOVE Price and back BELOW left
  the oscillator in the tall pane and the candles crushed to ~30 px.
  `reconcilePaneOrder` reported "more moves owed" rather than "a move happened",
  so the pass that issued the LAST move sized the stack in the same frame, before
  `moveTo` had landed. Now `owed > 0`.
- Verified: request dedup (two QQQ instances → exactly one `/api/bars/QQQ`),
  pane order after hide/show, delete leaves no zombie pane, re-add mints a NEW
  instance rather than resurrecting a tombstone, round-trip through the migrator
  is identical, six panes plus price all on independent correct scales.

### IMPORTANT DECISIONS
- Pane sharing persists as `placement.target = "@<hostInstanceId>"` on the GUEST.
  No pane ids are minted or persisted, ever.
- SOURCE ("what data is this?") and PRESENTATION ("where do I draw it?") stay
  absolutely separate. Deleting a visual host never touches a canonical symbol
  source.
- Definitions remain restricted to the three static placement targets
  (`price|pane|volume`); only INSTANCES may carry `@host`.
- A missing pane target is shown WITHOUT a name, because the tombstone carries
  none. Naming it would require widening `instanceTombstone`, which is a
  persistence decision and contradicts that helper's stated design. STOPPED —
  see PRODUCT QUESTIONS.
- P2.0c→P2.3 committed as ONE checkpoint: the phases share files and only the
  combined state was ever tested end to end. A per-phase split would have been
  history that was never verified.

### TEST EVIDENCE (at `152042d5f`)
- Focused: `paneComposition.test.js` 22 pass; `readout.test.js` 34 pass;
  `ChartSettingsModal.indicators.test.jsx` 39 pass; `stockChartWiring.test.jsx`
  218 pass (includes the 3 renderer-level P2.3 rails).
- Bite-checks: reverting Ruling B's grouping → 7 red; removing the missing-target
  entry → 2 red; removing the self-target guard → 1 red; narrowing the instance
  validator → 2 red.
- Broader: full frontend suite **19,559 pass / 16 fail / 9 skipped**.
- Build: `vite build` clean; dev harness absent from `dist`.
- Browser: harness at `/pane-harness.html` — QQQ+MA(QQQ) one pane (715.44 /
  714.88), QQQ+SPY one pane, SPY back to Own Pane, UCTA50+MA(UCTA50), duplicate
  QQQ independently targetable (`QQQ #1` / `QQQ #2`), RSI hosting QQQ, host
  deletion, save→unmount→reconstruct round-trip.

### KNOWN PRE-EXISTING FAILURES (16 — proven identical at base `735704fd7` in a
throwaway detached worktree)
- `ast/pine.blindCorpus` accepted-floor ratchet
- `ast/manifestProse` `_session` key
- `ChartToolbar.flipB` generated dialog (7)
- `pollingSites.rail` census (floor2, useFilingWatch, useWatchlistIntelligence,
  useBoundDrawingAlerts)
- `styles/tapFloor` (journal-2.0 CaptureDialog CSS)
- `utils/modalOpen` (`ConditionAlertPopover.jsx`)
- `ChartDrawingOverlay.surfaces` source-proximity rail
- `ThemeTrackerPage.chartmount` (2)
- `__tests__/sourcesAreText` — 8 control bytes in `binder.js`, byte-identical to
  base, merely shifted

Also pre-existing: one eslint `no-unused-vars` on `legendTextOf` in
`stockChartWiring.test.jsx` (reproduces at base).

### NEW REGRESSIONS
None.

### MAIN TRADING
Never opened. Verified READ-ONLY from `C:/data/auth.db` (`mode=ro`), preference
`chart_settings` for user `40d361fa…`: **5,354 bytes, sha256 `ea9ebaeee302`** —
the frozen fingerprint, unchanged.

### BACKEND
`:8000` is the main repo's `uvicorn api.main:app --reload` (APScheduler). Healthy,
untouched, must not be closed or restarted. `:5188` belongs to worktree `C:\w\wm`
— foreign, untouched. `:5173` is mine; started and stopped as needed.

### DEFERRED / BLOCKED
- Secondary-symbol OHLC/candles — NOT tonight. The binding model is one plot → one
  column; candles need coordinated OHLC fields. Next-architecture work.
- Historical fundamentals — blocked on PIT-safe history.
- `/api/bars` entitlement question — RELEASE BLOCKER, recorded, not solved. No new
  exposure created by this work.
- Legend chip for a stale breadth symbol shows no value when its last canonical
  bar predates the chart's last bar (UCTA50 to 2026-08-24 vs AAPL to 09-11). This
  is exact-`t` alignment with no forward fill, working as designed.

### PRODUCT QUESTIONS FOR BLAKE
1. **Naming a missing pane host.** Ruling A asked for `QQQ (missing)`. The host's
   name is genuinely unrecoverable: `instanceTombstone` is `{instanceId,
   deleted: true}` and its own comment says a delete must not keep the user's old
   settings in the blob. Shipped the truthful nameless form, "Pane unavailable".
   To get the name back, the tombstone would have to carry a display label — a
   persistence change, deliberately not taken.

### OBSERVATIONS, NOT FIXED (deliberate)
- `/api/ticker-search` returns `type: "stock"` for QQQ and SPY, so the library row
  badge reads STOCK for an ETF. That is the backend's own answer; inventing a
  security-type source would be fabricating. Recorded, not patched.
- Adding a second overlay moving average yields two settings rows both reading
  "SMA 50". Overlays are positional fixtures, not engine instances, so tonight's
  disambiguator does not reach them; the collision self-resolves the moment the
  member changes either period. Left alone.
- The engine MA's catalogue name is "Moving Average (Source)". Renaming a shipped
  indicator is a product decision, not an implementation one.

### NEXT AUTHORIZED ACTION
Optional continued LOW/NORMAL-RISK polish of already-built chart systems
(indicators UX, conditions UX, formula-builder UX presentation), or stop. The
Universal Data Panes workflow itself is verified end to end.

### STOP CONDITIONS
None active.

---

## CHART UX CONSOLIDATION PASS — 2026-09-13

### CURRENT PHASE
Indicators / Conditions / Formula Builder UX consolidation.

### CURRENT STATUS
Complete and checkpointed.

### BRANCH / HEAD / LAST KNOWN GOOD
`feat/universal-data-series` @ `3f870e51a` — polish(chart): one naming language
across indicators, conditions and the builder. Previous good: `74387148e`.

### WORKING TREE STATUS
Clean at the time of writing.

### COMPLETED
- **Indicators.** An ACTIVE row is now named the way the chart names it, so the
  list reads `EMA 9`, `SMA 50`, `RSI (14)`, `RSI (7)`, `MA (5)`, `QQQ` — one
  language with the legend, the Display In menu and the source picker. Gated on
  the definition already parameterising itself (`legendParams` / `labelFrom`), so
  `Session VWAP` keeps the name that distinguishes it from the anchored one, and
  the BROWSE catalogue is untouched.
- **Conditions.** A collapsed row names what it draws (`Candle colour · Marker`)
  instead of counting actions; zero actions reads `No action yet`. The starter
  "＋ Add" chips no longer wrap — measured before at 25/37/25 px tall, now
  identical.
- **Formula Builder.** The Name example follows the consumer: `20-bar average`
  for an indicator, `Trend up` for a condition, `Distance to 20-day` for an info
  value.
- Two test files added where there were none: the Conditions tab had no component
  test at all, and the builder had no case holding its copy to its consumer.

### DELIBERATELY NOT CHANGED
- Validation messages are already member-readable ("Expected expression after >
  at character 7", with Copy diagnostic). §11 needed nothing.
- Display In is exactly as P2.3 left it.
- No parser, AST, evaluator, truth, first-match, action meaning, alert durability
  or persistence was touched.

### TEST EVIDENCE (at `3f870e51a`)
- Focused: `ChartSettingsModal.conditions.test.jsx` 6 pass (new);
  `BuilderSheet.consumerCopy.test.jsx` 4 pass (new);
  `ChartSettingsModal.indicators.test.jsx` 41 pass; `builder/` 1,613 pass.
- Bite-checks: reverting the action summary → 5 red; reverting the Name example →
  2 red.
- Broader: full frontend suite **19,569 pass / 16 fail / 9 skipped** — the same
  16 baseline failures, unchanged in name and count.
- Build: `vite build` clean.
- Browser: the harness now also mounts the real `BuilderSheet` for all three
  consumer kinds (dev-only; the product's single `/charts` mount in
  `ChartToolbar` is what `BuilderSheet.test.jsx` parses, and is untouched).

### MAIN TRADING
Never opened. `40d361fa…` → 5,354 bytes, sha256 `ea9ebaeee302`, unchanged.

### BACKEND
`:8000` untouched and healthy. `:5188` is worktree `C:\w\wm` — foreign, untouched.
A `stash@{0}` from `feat/app-themes` exists and belongs to another session — not
mine, not touched.

### PRODUCT QUESTIONS FOR BLAKE
1. **The plain-English box asks the wrong question for a condition.** The sheet
   titled "New condition" is headed *"Describe the indicator in plain English"*,
   because `ConciergeBox`'s `kind` is chosen by BUILD MODE
   (`buildMode === 'picker' ? 'scan' : 'indicator'`), not by `consumerKind`. The
   copy and the server request are one decision: fixing the words alone would
   make them disagree, and changing the request changes what the server is asked
   for. Left as-is and reported rather than guessed.
2. Carried forward, unchanged: naming a missing pane host would need tombstone
   metadata; `/api/ticker-search` reports `type: "stock"` for ETFs; two overlay
   moving averages can both read `SMA 50` (positional fixtures, outside the
   instance disambiguator, self-resolving on any period edit).

### NEXT AUTHORIZED ACTION
Blake's call. Not started: OHLC/candles for secondary symbols (deliberately —
one plot → one column vs coordinated OHLC fields is an architecture review).

### STOP CONDITIONS
None active.

---

## CONCIERGE CONSUMER CONTRACT — 2026-09-13

### STATUS
Complete and checkpointed. `feat/universal-data-series` @ `719b94d22`
(previous good `dbf762445`). Tree clean.

### WHAT `indicator` AND `scan` ACTUALLY MEAN
Traced through `ConciergeBox` → `POST /api/user-definitions/propose` →
`api/routers/user_definitions.py` → `api/services/definition_concierge.py`:

- `KINDS = ("indicator", "scan")`. An unrecognised kind refuses at `kind:unknown`.
- `_KIND_BRIEF[INDICATOR_KIND]`: "an INDICATOR: a column of numbers drawn on a
  chart" — the numeric/series contract.
- `_KIND_BRIEF[SCAN_KIND]`: "the tree must be a yes-or-no CONDITION… An
  expression that produces a price or an average is an indicator, not a screen".
  ⭐ This is GATED, not hinted: `_validate` raises `scan:not-a-condition` unless
  `scan_definition.is_boolean_tree(tree)` agrees.
- The success payload is byte-identical in shape for both kinds
  (`ok/ast/source/sentence/repaint/freshness/cadence/kind/concepts/terms/…`).
  Nothing in it is screener-specific; `freshness` and `cadence` are derived facts
  about the tree.
- `_validate` runs `interpret(tree, bars)` for BOTH kinds and refuses
  `compute:empty`, so every proposal is already computed over the chart's bars.

### MAPPING (proven, then implemented)
| consumer | request kind | why |
|---|---|---|
| `indicator` | `indicator` | numeric column; unchanged |
| `condition` | `scan` | the boolean contract, gated by `is_boolean_tree` |
| `infoValue` | `indicator` | wants a number; a boolean is refused downstream |

No third server kind was invented. The criteria picker still sends `scan`
regardless of consumer, which is what the screener's own mount relies on.

### CHART-EVALUABILITY
Already protected, in two places, both pre-existing:
1. Server — `_validate` interprets every proposal over the bars it was sent.
2. Client — `consumerAdapters.validateFor` runs `chartEvaluability(ast)` for
   `condition` and `infoValue`. Its own comment names this case: a screener
   scalar is NaN on every bar, "the picker hides those columns; this is the gate
   that means a formula arriving by any OTHER door cannot slip past". The
   concierge is one of those doors. No second validator was added.

### IMPLEMENTATION
`ConciergeBox` gains `copyKind` — vocabulary only, never sent — and `KIND_COPY`
gains `condition` and `infoValue` entries. `BuilderSheet` derives both from one
place: `conciergeRequest` (contract) and `conciergeCopy` (words). The screener
path is byte-unchanged: default consumer + picker mode still asks for `scan` and
still reads "Describe the screen in plain English".

### EVIDENCE
- Focused: `BuilderSheet.consumerCopy.test.jsx` 12 pass — copy AND request for
  all three consumers, plus the downstream `validateFor` refusals including a
  screener scalar. Bite-checked: reverting the request mapping → 1 red.
- `src/components/chart/builder` 1,617 pass.
- Full frontend suite **19,577 pass / 16 fail / 9 skipped** — the same 16.
  ⚠️ One run showed 17: `journal-2-0/.../CaptureHost.test.jsx` "closing returns
  the dialog to nothing" (an Escape-key race). It passes alone and did not recur;
  unrelated to this work. Worth knowing it is flaky under load.
- Build clean.
- Browser: all three consumers checked in the harness — title, concierge label,
  placeholder, Name example, `data-kind` vs `data-copy-kind`, and the OUTGOING
  REQUEST BODY captured via a local fetch intercept (no model call, no spend):
  `indicator`, `scan`, `indicator`. No "screen" wording anywhere on a chart
  consumer. Console clean.

### MAIN TRADING
Never opened; `40d361fa…` → 5,354 bytes, `ea9ebaeee302`, unchanged.

### REMAINING ARCHITECTURAL QUESTION
None from this investigation. The existing contracts already expressed the
correct semantics, which is why nothing new was created.

### NEXT AUTHORIZED ACTION
Blake's call. Still not started, deliberately: OHLC/candles for secondary
symbols.
