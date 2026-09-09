# Session state — `feat/indicator-r0r1`

**Written 2026-09-09 before a machine restart, so this wave can be picked up cold.**
Delete or rewrite it when the wave closes; it describes work in flight, not a ruling.

- Branch `feat/indicator-r0r1`, worktree `C:\Users\Patrick\uct-worktrees\indicator-r0r1`
- Tip **`cc1171d23`**, pushed to `origin/feat/indicator-r0r1` (backup only — not a deploy)
- Working tree clean. The `tests/fixtures/compat_harness/**` rows that show as modified are
  **CRLF churn with an empty content diff** — do not commit them.
- Engine suite: `cd app && npm run test:engine` → **4,956 passed, 2 failed** (see *Known reds*)

---

## The owner's order of work — where it stands

| # | item | state |
|---:|---|---|
| 1 | Land Kind 4 | ✅ merged from `worktree-indicator-ecosystem` (`cd078bbd2`), pieces verified |
| 2 | Barstate per the ruling | ✅ done end to end — semantics, calendar census, both runtimes, door, stability tests, divergence row |
| 3 | Volume through strict mode | ✅ measured, list below |
| 4 | TradingView visit | ⛔ **BLOCKED — needs a visible, focused Chrome window** |
| 5 | SAR memoisation | ⚠️ **believed already spent — see *Open questions*** |
| 6 | Group B (eight names) with fixtures | ⬜ not started; measurements in `r11-group-b-arity.md` |
| 7 | `time(timeframe)` + `ta.valuewhen` | ⬜ not started; measurements in `r11-time-and-valuewhen.md` |
| 8 | Remaining real names in demand order | ⬜ not started; list in `r11-remaining-nine.md` |
| 9 | Group C order-asserting rail | ⬜ not started; why the outcome-shaped version is vacuous is in `r11-vocabulary-gap.md` |
| 10 | M1 — Volume's numeric plots as a pane behind the flag | ⬜ not started |

Also outstanding from the owner's §3: apply the *"guard shipped unable to fire"* control rule
**retroactively to the object pool and the licence rail**.

---

## ⛔ Item 4 — exactly what is blocked, and the likely fix

The visit needs, before **any** study is added:

```js
document.visibilityState === 'visible' && document.hasFocus() === true
```

Both read false all session (`hidden` / `false`), so nothing was added — per the standing
instruction to stop rather than proceed.

⭐ **The probable cause is recoverable and the restart may fix it by itself.** The tab was
opened with `tabs_context_mcp{createIfEmpty:true}`, which creates a **new Chrome window**.
Foregrounding the owner's own window therefore never raised it. On resume: open the chart in
the window actually in front, and drive **that** tab.

Chart used: `https://www.tradingview.com/chart/VEeQHWPh/` — layout *UCT Vendor Capture*, and
it already carries `UCTPROBE_NS`, `UT Vol` and the other session's `Uncharted Clouds`.

⚠️ **Chart state was restored and verified before the session ended**: `AMEX:SPY`, `1D`, pane
stretch `[2000, 1000, 1000]`, all studies intact, no injected globals. Nothing to undo.

**Jobs waiting on that visit, in order:** live Aroon (SPY 1D, length 14) · the fold probe's
*numeric* half · the five-symbol containment probes · the three remaining barstate predicates
(`isrealtime`, `isnew`, `islastconfirmedhistory`) for completeness of the vendor fixture, even
though we no longer match them.

Probe sources are committed and ready to paste: `tools/visual_conformance/probes/`.

⛔ **What a hidden tab does and does not cost** is now written up in `capture-procedure.md` —
value reads are immune, **adding a study is not**, and `insertStudy` reports success while
inserting nothing.

---

## Volume's refusal list — verbatim, as of `cc1171d23`

```
SCREENER (default)     ok=false  refusals=5
    pine:function  line 225  token `ta.cum`
    pine:function  line 225  token `ta.cum`
    pine:function  line 225  token `ta.cum`
    pine:function  line 225  token `ta.cum`
    pine:window    line 233  token `isWeekly`
HOST / pane (strict)   ok=false  refusals=4
    pine:window    line 233  token `isWeekly`
    pine:window    line 233  token `isWeekly`
    pine:window    line 233  token `isWeekly`
    pine:reassign  line 250  token `:=`
```

⚠️ **`strict: true` is HOST/pane, not screener** — an earlier report in this wave had the two
labels inverted. The list above is the corrected one.

All five `barstate.*` sites (296, 299, 399, 429, 450) translate now. `ta.cum` refusing for a
screen and not a pane is the `window_dependent` ruling working. `pine:reassign` at 250 is new
and expected — it was always there and translation never reached it because barstate refused
first. `pine:window` 233 is the bind-time fold, the **other session's** work.

## Three-number metric: **30/266 host · 45/266 screener — unmoved**

Barstate moved the *pane*, not the corpus: `isconfirmed` already folded for the screener, and
those scripts are blocked by `pine:function` / `pine:request` / `pine:tuple` regardless.

---

## Known reds — routed, not silenced

1. **`tests/test_ast_interpret.py::test_the_escape_census_ZERO_is_ATTRIBUTABLE`** — inherited
   from the Kind 4 merge, **not ours**. Verified pre-existing by checking out HEAD's own
   `closedTable.json` and `indicator_compute.py`, running it, and restoring (hashes verified
   both directions): it fails identically with none of this wave's changes.
2. **Two census floors** — `capabilityDemandCensus` and `historyDemandCensus`, both
   `expected 129 to be greater than 150`. Diagnosed: `tests/fixtures/oos2_parity` is **empty**,
   and neither census includes `corpus/committed` at all. ⛔ **So "re-census" in items 5–8 is
   measuring 129 scripts, not 395** — worth settling before those items lean on it.

⛔ **Do not claim repo-green** while either stands.

---

## Open questions for the owner

1. **Item 5 (SAR memoisation) looks already spent.** The memo was built in this wave and
   **discarded**: it silently dropped `accum(...)` from four supertrend-family scripts — same
   guards, `ok:true` both ways, a formula that had quietly stopped being stateful — caught only
   by a byte-for-byte corpus comparison against the previous translator. It also bought almost
   nothing (2 cache stores on SAR). The whole **11.6s → 43ms** came from the depth bound, which
   is shipped with its three tests and a 1,000 ms regression ceiling. Re-attempting the memo
   would re-introduce a known-wrong result, so it is **not** being retried without a reason.
2. **`symbolScope.json::confirmed` is still empty and this wave did not fill it.** The
   five-symbol capture read `syminfo.tickerid`, which is a **different field** from
   `syminfo.exchange` that the map is keyed on. Filling it from what we measured would be the
   *"assertion wearing a data structure"* that file warns against.

---

## Where the reference material lives

| topic | file |
|---|---|
| barstate semantics, calendar, stability property | `docs/pine/barstate.md` |
| rails earned this wave (incl. the swallowed-host-error rule) | `docs/pine/rails.md` |
| hidden-tab / capture rules | `docs/pine/capture-procedure.md` |
| Group B arity, measured | `docs/pine/r11-group-b-arity.md` |
| `time()` + `ta.valuewhen` demand | `docs/pine/r11-time-and-valuewhen.md` |
| the remaining nine names | `docs/pine/r11-remaining-nine.md` |
| census + Group C | `docs/pine/r11-vocabulary-gap.md` |
| vendor captures | `tests/fixtures/vendor/barstate-realtime-spy-2026-09-09.json` |
| divergence disclosure | `tests/fixtures/vendor/divergences.json` |

## Standing constraints for this wave

Open-source scripts only; never read/reproduce protected or invite-only scripts; **AGPL
projects (PineTS, piner, pyne, pinescription, vela-pinets) must not be read, vendored or
linked**; the $1,199/dev/yr licence is declined; product copy says *"supports Pine Script®"*
descriptively only; nothing shipped is named Pine.

Shared worktree: **never `git add -A`**, pathspec commits only, never `git checkout` to revert
a mutation probe, never bare `git stash`. Merge `worktree-indicator-ecosystem` at every phase
boundary and record conflicts touched.

**Pause on:** member data · a vendor contradiction (Aroon, valuewhen, the fold probe) · the
other session's files · the calendar census contradicting the screener's session logic · a real
blocker.
