# G-1 — Setup research report

**Date:** 2026-08-09 · **Branch:** `feat/phase-c-alerts` · **Status:** ✅ COMPLETE (research + catalog only)

⛔ **No product file was touched.** `conceptVocabulary.json`, `starterScans.json`,
`closedTable.json` and `setupGroups.js` are byte-unchanged. Everything written lives under
`.superpowers/sdd/phase-g/`.

## Deliverables

| File | What it is |
|---|---|
| `setups/setup_sources.json` | **100 sources**, each with something that resolves — a URL, a book + chapter, a firm store + selector, or a firm code location. Plus the rejection ledger. |
| `setups/setup_criteria.json` | **279 criteria** across all 32 taxonomy setups + universal filters. Each carries the condition, the exact number, its source ids, a verbatim quote, an expressibility tag and a confidence note. |
| `setups/SETUP_NOTES.md` | The reader's guide: coverage, disagreements, gaps, and the ranked build queue. |
| `_parse_probe.test.js`, `_catalog_formulas.test.js` | Throwaway gates. **141 tests pass.** Delete with this directory. |

## Numbers

- **100 sources registered** · 6 verified by direct fetch in this pass · ~275–450 examined across six parallel sweeps · the rest rejected with reasons recorded.
- **279 criteria** · **110 `expressible` today** · 34 `needs-preset` · 31 `needs-column` · 57 `needs-engine` · 26 `needs-cadence`.
- **31 criteria carry a `disagreement` block holding 62 additional published numbers.** Nothing averaged.
- **114 formulas recorded — every one parsed by the shipped parser**, and every name in an `expressible` one checked against `closedTable.json`'s declarations, with two working controls.
- **19 of 32 setups** now have three or more expressible criteria; **7 have none**.

## The five findings that change what gets built

1. 🔴 **`4B` means "much too soon to consider buying."** In Weinstein's own sub-stage table the
   bottoming buy is **`4B-`**. The firm ships a long setup under a label that, as published,
   means the opposite — and neither label is in the 1988 book.
2. 🔴 **Five `starterScans.json` refusals are stale.** The bounded offset landed the same day
   (`291c9d8a`) and they still say the table has no bar-offset node. `Red to Green`,
   `Oops Reversal`, `Kicker Candle`, `Remount` and `Classic U&R` are now sayable —
   **four of them with no new threshold at all.** The open question is an owner's: does the bar
   count inside `expr[n]` count as a numeric literal needing its own citation?
3. 🔴 **The firm's own Model Book is empty where the brief expected it.** `/data/modelbook.db`
   holds 20 stocks and **0 setups, 0 examples**; production is behind auth (401) and signing in
   was out of bounds. The firm's labelled evidence that *is* reachable lives in the brain:
   **48 templates, 94 published triggers with real entries and stops, 18 labelled charts.**
4. 🔴 **Three refusals are answered by numbers that now exist.** Launchpad's convergence band
   (within **1–3%** of the 21 SMA / 50 SMA / 65 EMA, verified by direct fetch) · U&R's prominent
   low (**8 sessions** — from the firm's own owner-flagged OSCR example) · HVC's lookback
   (**252 bars**, published independently by TraderLion and by the firm's own `computeHVC`).
5. 🔴 **A fetch-and-summarise tool was caught fabricating a table** for a page that contains
   none. Anything marked `resolved: reported` should be re-pulled raw before it grounds a
   shipped starter.

## One operational note

⚠️ **`closedTable.json` moved under this catalog mid-pass** — a concurrent Phase-G agent
declared `accum`, taking the function count 28 → 29. It cost nothing because the gate
**re-derives the declared names from the table on every run** instead of checking against a
roster typed into the catalog. Both files were re-validated and the gate re-run against the
current table afterwards. ⛔ Do not re-type the table's counts into any later artifact.

## Could NOT pin down

**Setups with no published number at all:** **Slingshot** (least-sourced of the 32 — three firm
KB rows name it, none defines it, no external source) · **Green to Red** (zero sources, firm or
external) · **Parabolic Long** · **News Failure** · **Wedge Pop / Wedge Drop / EMA Crossback**
(Kell publishes no numbers — two Kell-bylined articles read in full contain only MA periods) ·
**Weinstein's 4B-** (criteria exist only in two videos with empty caption tracks) ·
**Minervini's Power Earnings Gap** (no published numeric definition anywhere; attribution
contested).

**Missing data, not missing numbers:** a listing-date column (all of IPO Base) · a
news/earnings-surprise column (five setups) · a float column · swing-point/trendline geometry
(six setups) · a cross-symbol series · an intraday cadence (all six Intraday setups).

**Not reached:** investors.com and Investopedia are host-blocked outright, which thinned the
IBD/O'Neil lane; the textbook layer, broker education and the official screener vendors were
not swept. The **~1,000-source target was not met** — the session's WebSearch and subagent
budgets were both exhausted mid-run, and that is recorded rather than papered over.
