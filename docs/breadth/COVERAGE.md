# Coverage — the original brief, line by line

The program brief of 2026-09-13 (recovered verbatim from this session's transcript), mapped to what shipped, what is
planned and where. Nothing here re-opens a decision; it exists so an interruption cannot lose an obligation.

Status: ✅ in production · 🔨 built, gating · 📋 planned in a written plan · ⏳ later phase · ⛔ ruled out (with the line)

---

## 1. The brief's known defects (a) … (k)

| Brief | Defect | Finding | Merge | Status |
|---|---|---|---|---|
| (a) | "Notable Extremes" in all six groups, works only in MA Breadth | A-22 | C2 | ✅ `0148ef52d` |
| (b) | Preset reference lines vanish on any add/remove | A-03 | C2 | ✅ `0148ef52d` |
| (c) | X-axis labels MM/DD with no year | A-06 | C2 | ✅ `0148ef52d` |
| (d) | Inline fetcher parses error bodies → 401/402/500 render "No data in selected range" | A-01 (P0) | C1 | ✅ `d6ac61816` |
| (e) | The ~6× magnitude guard runs only for presets; hand-picked sets flatten silently | A-04 | C2 | ✅ `0148ef52d` — runtime rule over visible rows; the `MAX_ABS` table is deleted |
| (f) | Date range resets to 90 days every visit, not saved | A-20 | V2-4 | 📋 range pills + persistence (D-015) |
| (g) | Tooltip shows no units or percentile | A-25 | V2-5 | 📋 |
| (h) | Chart height fixed at 680 px on phones | A-16 | V2-1 | 📋 responsive height |
| (i) | Colours hard-coded hex, not the Views palette system | A-13, A-14 | V2-1 | 📋 validated palette + chrome from tokens (D-010, D-019, D-020) |
| (j) | Percentile is window-relative only | A-12 | C1 + V2-5 | ✅ basis stated ("75th of 4 shown"); 📋 all-history toggle (D-013) |
| (k) | No URL state, share link, export, drill-through, normalisation, log scale, multi-panel, regime shading, custom presets | A-21, A-30, A-29, A-05, A-31, A-32, A-23 | V2-1/2/5 | 📋 — except custom presets, ⛔ D-014 (argued, follow-up not rejected forever) |

⚠️ Brief (d) said `Breadth.jsx`; the fetcher was `BreadthCharts.jsx:19`. Corrected in discovery §1 and fixed there.

## 2. Phases

| Phase | Deliverable | Status |
|---|---|---|
| 0 Discovery | `00-discovery.md`, rig `tools/breadth_charts_rig.py`, before-screenshots at 4 widths | ✅ |
| 1 Audit | `01-audit.md` (A-01…A-41, lanes, backlog, north star), `collector-asks.md` (11 asks) | ✅ |
| 2 Design | `02-design.md`, `mock/` rendered with the rig | ✅ |
| 3 Implementation | C1 ✅ · C2 ✅ · C3 🔨 · R1 📋 · B1 📋 · V2-1…V2-5 📋 | in progress |
| 4 Verification | `03-before-after.md`, after-screenshots, flag-off identical (D-022 method) | ⏳ |
| 5 Merge | flag OFF, `flip-packet.md` | ⏳ |
| 6 Manual | flip decision, real-device pass, BrowserStack, collector asks, purge of `b98ce804b` | ⏳ |

## 3. The brief's Phase-3 test list

Brief line: *"unit tests for X-domain/tick-format per range, Y framing and padding per family, magnitude guard on
hand-picked sets, reference-line attachment by metric, coverage/absence rendering (null never becomes 0), resampling
correctness against raw daily rows, URL⇄state round-trip, request dedup/cancellation, error-body handling through
jsonFetcher"* plus a member-smoke rig test.

| Required test | Where it lives | Status |
|---|---|---|
| X-domain / tick format per range | `breadth/chartTicks.test.js` (8) | ✅ C2 |
| Y framing and padding per family | `breadth/chartMetrics.test.js` "axis framing" + every-family gate | ✅ pre-existing, kept |
| Magnitude guard on hand-picked sets | `breadth/chartMagnitude.test.js` (5) + `BreadthCharts.mechanics` | ✅ C2 |
| Reference-line attachment by metric | `chartMetrics.test.js` resolveLines block incl. an every-preset rail | ✅ C2 |
| Coverage / absence rendering — **null never becomes 0** | partially: `connectNulls: false`, stale badge, `latestPoint` | **OWED** — see §5.1 |
| Resampling correctness against raw daily rows | B1 + V2-3 (LTTB) | 📋 |
| URL ⇄ state round-trip | V2-1 | 📋 |
| Request dedup / cancellation | C1 covers refresh COUNTS; dedup/cancel not yet railed | **OWED** — see §5.2 |
| Error-body handling through `jsonFetcher` | `chartLoadError.test.js`, `BreadthCharts.loadError.test.jsx`, the `STILL_UNCHECKED` ratchet | ✅ C1 |
| Rig test as member-smoke: every control, no console errors, requests/interaction ≤ threshold, CLS ≤ threshold, forced 500 is an error not "No data" | rig exercises all of it and records it; only the 500-vs-"No data" case is a hard assertion today | **OWED** — see §5.3 |
| Keep the existing Data Charts tests green | 27 + 6 + 11 + 9 + 86 … all green, no baseline regression | ✅ |
| Run the frontend suite chunked | `scripts/gate_shards.py --shards 6`, one gate at a time | ✅ |

## 4. Standing engineering rules

| Rule | State |
|---|---|
| New data code uses `utils/jsonFetcher.js`; retire the inline fetcher for this tab | ✅ C1; `pages/BreadthCharts.jsx` deleted from `STILL_UNCHECKED` |
| Any new polling call gets a registry row with a reason | ✅ none added (D-027); rail green for this tab |
| ONE source of truth for metric definitions: `chartMetrics.js` canonical, `heatmapMetrics.js` migrated | 📋 R1 as its own merge (D-011, D-034) |
| Deploy authority `deploy-windows.md` + CLAUDE.md; one master merge at a time; web SUCCESS before the next; member summary per merge | ✅ followed for C1 and C2; recorded in STATUS |
| Member-view checks use member-smoke, never admin smoke | ✅ rig only |
| Flag `VITE_BREADTH_CHARTS_V2_ENABLED` default off, Dockerfile.web build arg, VITE_ CI check green | 📋 V2-1. **Declared in `docs/feature_flags.json` → `build_flags`** (D-001, owner-ratified post-restart); the brief's `docs/frontend_feature_flags.json` does not exist |
| Any new server endpoint ships dark behind a backend flag with its own ledger row | 📋 B1 `BREADTH_SERIES_ENDPOINT_ENABLED` (D-035) |
| Corrective defect fixes may go flag-free with tests and a member summary | ✅ C1, C2, C3 |
| Never rebase; merge master in | ✅ |
| Collector work goes to `collector-asks.md`, never blocks | ✅ 11 asks recorded |
| Owner's phone / eyes / BrowserStack deferred to Phase 6 | ✅ nothing asked of the owner so far |

## 5. Owed — obligations from the brief with no home yet

Each becomes a task in the merge named, so the brief's test list closes.

**5.1 "Null never becomes 0" needs its own rail.** The tab does not draw absence as zero today (`connectNulls: false`,
`latestPoint` skips nulls, the readout dates a stale series), but nothing FAILS if a future edit coerces a null. Home:
**V2-3** (honest coverage), as a test over the option ECharts is handed — every gap in a fixture stays `null` in
`series.data`, with a control proving a real 0 still plots as 0.

**5.2 Request dedup / cancellation.** C1 rails how MANY history requests fire on the close transition and on revisit.
Not railed: two mounts of the tab inside SWR's dedup window issue one request, and a range change in flight does not
apply a stale answer. Home: **V2-1** (the V2 tab owns its own fetch path), with the legacy tab left as-is.

**5.3 Rig assertions with thresholds.** `breadth_charts_rig.py` measures console errors, requests per interaction and
layout shift, and hard-asserts only the placeholder sentences. Home: **Phase 4**, where the before/after numbers are the
thresholds — the rig gains a `--assert` mode that exits non-zero on a console error, on requests per interaction above
the before-state, or on CLS above it.

## 6. Where the decisions live

`DECISIONS.md` D-001 … D-035. The brief's "do not re-propose" list is untouched: canonical reference constants (D-009),
bull/bear tone for opposed pairs only, one index series per preset, presets do not move the range except A/D Line,
NAAIM out of presets, closing-basis "(Close)" labels, absence is not zero. The one item the brief allowed to be
revisited — custom user presets — was argued and kept out (D-014).
