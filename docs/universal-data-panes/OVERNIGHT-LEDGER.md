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
