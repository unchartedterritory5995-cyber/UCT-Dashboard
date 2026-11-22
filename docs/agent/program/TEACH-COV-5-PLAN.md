# TEACH-COV-5 plan: estimated from the measured hit rate

> **BROWSER-MOCK-MODEL / SIMULATED.** Counts come from the local agent harness with a scripted model (LOCAL native Windows Node v24, headless Chrome). They are not production evidence and not gate evidence.

**Where the program stands** (teach-cov-4 `aba69e1ad5` run, `runs/2026-11-09.cov4.results.json`):
- 281 VERIFIED of 304 browser cases.
- **281 of 499 inventory rows.**
- Held-out: every set passes, apart from the KNOWN MISSES listed in `CHARTS_TEACH_STATUS.md` (5 of them).

## 1. Measured hit rate: why these estimates are smaller

| Batch | Planned | Actual | Hit rate |
|---|---|---|---|
| cov-3 | about +44–50 | +25 (245 → 270) | about 0.5 |
| cov-4 | about +47 | +11 (270 → 281) | about 0.23 |

By kind of work, across cov-3 and cov-4:
- **Routing for a family:** about 0.5. About half the inventory's own words are terse enough to reach the row.
- **Givens (seeded state):** about 0.25. Most state can't be seeded through a pref or a fixture route.
- **Runner abilities:** about 0.3.
- **Hand-assigning a row to the walkthrough it already reaches:** about 0.85. 6 of 7 such rows passed in the browser (C3-063, C1-076, C1-119, C1-120 and others).

Each estimate below is the item's row count times its measured rate, rounded down.

## 2. The 23 unverified cov-4 cases, by root cause

| Root cause | # | Cases |
|---|---|---|
| A. Missing pre-state the harness can't seed | 12 | C1-045, C3-210 (replay running); C2-007 (a saved indicator definition); C2-091 (MACD on the chart); C2-092 (a yes/no-signal indicator); C2-100 (a blocked alert: the harness catalog is never "ready"); C3-122 (a Volume Surge list's delete); C3-198, C3-199, C3-200 (an AI Search answer); C3-203 (an open note); C3-219 (an ETF's profile) |
| B. Runner action | 4 | C1-152, C1-153 (right-click on a fib's or measure's own pixels); C3-136, C3-146 (follow a placed widget) |
| C. Guide gap | 2 | C3-023 (the chart tab dot shows only on a selected, LINKED extra tab); C3-058 (a narrow grid cell) |
| D. Correctly unavailable (release switch off) | 3 | C3-120, C3-183, C3-184 |
| E. Blocked on another team's anchor | 2 | C2-070, C2-071 (`data-guide="builder.intent"`, Pine's #994; kept off every teach PR per AUDIT) |

## 3. The remaining families, by member value

| Family | Rows not VERIFIED | Member value | What stands in the way |
|---|---|---|---|
| Watchlist list management (Watchlists page) | about 10 | High | The owner's decision on the `Watchlists.jsx` patch. The walkthroughs exist on `cov-4-wl`, switched off. |
| Rows that already reach the right walkthrough but have no assignment | 87 NO ASSIGNED WALKTHROUGH | Mixed | Only a person's review in `expected.json`. Some reach the wrong walkthrough. |
| Chart Settings rows | 6 (solid background, magnet, info row, header colours, custom colours, light/dark) | High | Terse inventory words ("background to black", "light chart"). |
| Drawing menu rows | 4 (text style, price label, duplicate, save as default) | High | No assignment, and their bare words ask instead of routing. |
| Widget controls (Breadth, Market Map, NH/NL, Calendar, Options Flow) | about 12 | Medium | Routing, plus data givens. |
| Builder: saved definitions | about 6 | Medium | Routing, plus a saved definition (a given the harness can't seed today). |
| Keyboard and Popout | about 8 | Medium | Teach-the-key cards. |

## 4. teach-cov-5, ranked by expected gain per unit of work

| # | Work | Rows | Rate | **Expected** |
|---|---|---|---|---|
| 1 | **Hand review of NO ASSIGNED rows.** Judge, row by row, whether the walkthrough the words already reach is right; assign the right ones in `expected.json` with "reviewed by hand"; browser-run them. Rows that reach the wrong walkthrough go to item 3. | about 20 of the 87 look right on a first read of the probe | 0.85 × a 0.6 share judged right | **+8** |
| 2 | **Watchlists page rows.** Assign the ~10 inventory rows to `watchlistPage`; browser runs on the real page. | about 10 | 0.5 | **+4**, **only if** the owner applies the patch (0 otherwise) |
| 3 | **Routing for Chart Settings and drawing menu rows.** Held-out first. | 10 | 0.5 × the share whose inventory words carry a name | **+3** |
| 4 | **Givens that can be seeded:** an AI Search answer (scripted model), an open note (Notebook route), a Volume Surge list's delete (scope picker open). | 5 | 0.25 | **+1** |
| 5 | **Runner abilities:** right-click on a drawing's own pixels; follow a placed widget. | 4 | 0.3 | **+1** |
| 6 | **Guide gap: a narrow grid cell** (maximize first). | 1 | 0.5 | **+0–1** |

**Expected after cov-5:** about 281 + 8 + 3 + 1 + 1 ≈ **294 of 499**, or about **298** if the Watchlists patch lands.

## 5. Kept out on purpose
- **D (release switch off):** these remain truthful "unavailable".
- **E (Pine's anchor):** waits on #994, on a separate branch.
- **Replay and saved-definition givens:** the harness can't seed them through prefs or fixture routes. Each needs its owner's seeding path, which is listed as a request, not planned work.
- **Rows whose inventory words stay ambiguous on purpose:** "log", "take RSI off", "show that one".

## Gates (as before)
- Held-out phrasings first for every routing change, with misses recorded as KNOWN MISSES, never edited to pass.
- Product commits separate from harness commits.
- A browser single run per item, then one fresh full runner pass and one locked full suite per reviewable head.
- A notebook-bytes delta of ≤ 0 against master for anything that reaches first-open.
- Everything labelled LOCAL / SIMULATED.
