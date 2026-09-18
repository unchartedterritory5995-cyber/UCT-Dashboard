# Breadth Data Charts — session log

Programme opened **2026-09-17** under directive **DC-1**. Inherits the standing rules of the
Breadth History Reader programme (DC-1 §0), which closed the same day.

---

## Session 1 — DISCOVERY (DC-1 §1), read-only

**Base:** `origin/master` at `e50c0552d`. Branch `breadth/data-charts`. Nothing built,
nothing pushed, no member-visible change.

### ⛔ FIRST, A CORRECTION TO MY OWN FIRST READING

The directive's §1.1 says *"If V2-1 or anything before it is not DONE, say so — it changes
the order."* The first document I opened, `docs/breadth/RESUME.md:26`, says:

> **NEXT: V2-1**, then V2-2 … V2-5

I was about to report V2-1 as not started. **It is built.** `app/src/pages/breadth/v2/`
holds a shell, a flag module, a read hook and a golden, landed in `ee31cbc57`, and
`BreadthCharts.jsx:84` dispatches on it.

⭐ **`RESUME.md` was true when written and the world moved under it** — the same failure kind
the reader programme closed on (3b: *a record right when written, substituting for a
re-check*). It caught me on the first file of the new programme, which is the argument for
the habit rather than against it: the check that corrected it was one `git grep`, and the
only reason I ran it is that the directive told me the answer mattered.

⛔ **Everything below is derived from code and measurement. Where a document is the only
source, it is named as a document, not as a fact.**

---

## 1.1 · THE ROADMAP — re-emitted

**Authority:** `docs/breadth/01-audit.md`, "Prioritised backlog" table (line ~366).

| # | Merge | Contents | Lane | State |
|---|---|---|---|---|
| 1 | **C1 — honest states** | A-01 (+A-38), A-09, A-10 (stale "as of"), A-12 (basis label), A-15 ("sessions"), A-35, A-34 | C | ✅ **BUILT, in production** — `d6ac61816`, ancestor of `origin/master` |
| 2 | **C2 — chart mechanics** | A-02, A-03, A-06, A-07, A-08, A-22, A-04, runtime magnitude rule replacing `MAX_ABS` | C | ✅ **BUILT, in production** — `0148ef52d`; `MAX_ABS` deleted, `chartMagnitude.js` is the live rule |
| 3 | **C3 — touch & ARIA** | A-19, A-24 | C | ✅ **BUILT, in production** — merge `a9290e7f4` |
| 4 | **R1 — one registry** | canonical `chartMetrics.js`, `heatmapMetrics.js` as adapter, byte-identical `HM_METRICS` | R | ⚠️ **PARTIAL** — adapter shipped (`6d944b8c8`), golden unregenerated; but **`mark` and `refLines` were never added**, and `mark` IS A-28 |
| 5 | **B1 — series endpoint (dark)** | projected, pre-encoded, cached `/series` | B | ✅ **DONE** — merged `5a0e224f4`, deploy `5582d6d4`, contract `docs/breadth/api-series.md`, ruling D-041 |
| 6 | **V2-1 — foundation** | flag, lazy V2 tab, `?tab=charts`, URL state, range pills, persistence, tokens + validated palette, responsive height, header/freshness | V2 | ⚠️ **PARTIAL** — see below |
| 7 | **V2-2 — stacked panels** | A-05, magnitude split, metric-attached lines per panel, log scale, sticky colours, end labels | V2 | **NOT STARTED** |
| 8 | **V2-3 — honest coverage + long history** | A-10 coverage language, A-11 via B1, LTTB, era note, A-28 marks, A-39 | V2 | **NOT STARTED** |
| 9 | **V2-4 — controls** | preset sheet, metrics sheet, compact phone toolbar, A-17, A-18, A-20, A-26, A-27 | V2 | **NOT STARTED** |
| 10 | **V2-5 — reading & sharing** | tooltip (A-25), keyboard + table (A-23), drill-through (A-29), export (A-30), shading (A-32), unoffered fields (A-33), percentile basis toggle | V2 | **NOT STARTED** |

✅ **C1/C2/C3/R1 RESOLVED 2026-09-17** (DC-2 §3.1). C1, C2 and C3 are in production; R1 is
PARTIAL. Verdicts are anchored to `git merge-base --is-ancestor` against `origin/master`,
**not** to a tracking doc — because both tracking docs are stale, in opposite directions:
`COVERAGE.md:35` still shows `C3 🔨 · R1 📋`, and `STATUS.md:253` still says "R1's master
merge is NOT taken" when it was taken. ⚰️ This paragraph used to say *"resolve each merge's
A-numbers against `docs/breadth/COVERAGE.md`"* — following that instruction would have
produced a WRONG answer for two of the four items. ⭐ A doc that tells you where to look is
worth less than the two-line git question that settles it.

⛔ **The one that matters for V2-3:** R1 declared six per-metric schema fields
(`01-audit.md:315-317`) and shipped four. **`mark` and `refLines` are absent** —
and A-28 IS the `mark` field, so V2-3 adds it rather than reading it. Full evidence:
`01-spec-v2-2-v2-3.md` §0.1-0.2.

### ⚠️ V2-1 IS PARTIAL, AND THE GAP IS MOST OF ITS ROADMAP SCOPE

What landed (`ee31cbc57`), in the shell's own words:

> *"the read path and its honest states, wired end to end. What this is NOT, yet: a chart."*
> *"⛔ NO STYLING ON PURPOSE."*

| V2-1 roadmap content | present? |
|---|---|
| flag | ✅ `app/src/pages/breadth/v2/flag.js` — ⚰️ **was** `VITE_BREADTH_CHARTS_V2_ENABLED` with a build ARG; **RETIRED 2026-09-17** (DC-2 §2). The ARG, the ENV entry and the ledger row are deleted and the gate is now the RUNTIME `breadth_dc_v2_2/3_enabled` off the auth payload. It had been UNSET on every service for its whole life, so `v2Enabled()` was never true in production. |
| dispatch to V2 | ✅ `BreadthCharts.jsx` — now `useV2Enabled() ? <BreadthChartsV2 /> : <BreadthChartsV1 />`, true iff an increment is on |
| read path + honest states | ✅ `useBreadthSeries.js` |
| flag-off invisibility | ✅ `flagOff.golden.html` + `flagOff.golden.test.jsx`, byte-for-byte DOM |
| lazy V2 tab / `?tab=charts` | ❓ not seen |
| URL state, range pills, persistence | ❓ not seen |
| tokens + validated palette | ❌ explicitly deferred — *"adding tokens now would put `--v2-*` custom properties into every theme island before a single pixel is designed"* |
| responsive height | ❌ same |
| header/freshness | ❓ not seen |

⭐ **The deferral is reasoned, not an omission**, and its reasoning is the same as this
programme's: styling arrives with the chart. But it means **V2-2 cannot be "panels in the V2
tab" — it is the first increment that draws anything at all**, and the palette V2-2's sticky
colours (DC-1 §2.2) depend on does not exist yet.

**Consequence for DC-1 §6's order:** the palette + tokens half of V2-1 is a prerequisite of
V2-2, not a parallel task. Proposed as a sub-item **W2-0** rather than a new increment, so
the roadmap's numbering is not disturbed.

---

## 1.2 · WHAT MEMBERS SEE TODAY

| | |
|---|---|
| Entry | `/breadth` → `Breadth.jsx:6` imports `BreadthCharts` → Data Charts tab |
| V1 component | `app/src/pages/BreadthCharts.jsx` (+ `BreadthCharts.module.css`) |
| V1 support | `pages/breadth/`: `ftdMarkers`, `PresetRow`, `MetricReadout`, `chartLoadError`, `sessionDates`, `chartTicks`, `chartZoom`, `chartMagnitude` |
| Charting library | **ECharts** via `echarts-for-react`; shared core at `components/research-kit/charts/echartsCore.js` |
| V1 data | `useSWR` + `jsonFetcher`, plus `useLiveBreadth` |
| V2 component | `app/src/pages/breadth/v2/BreadthChartsV2.jsx` — **dark**, unstyled, no chart |
| V2 data | `useBreadthSeries(keys, from, to)` → `GET /api/breadth-monitor/series` |

⛔ **`/series` is DARK AND RETURNS 404 TODAY.** `BREADTH_SERIES_ENDPOINT_ENABLED` is unset on
`web` (read live, 252 vars, the five `BREADTH_*` present do not include it). So the V2 shell's
read path reaches a 404 **by design** — the hook's own docstring says so and surfaces the
error rather than smoothing it.

### Baseline screenshots — NOT PRODUCED THIS SESSION, and why

**There is no deterministic screenshot harness in this repo.** Measured, not assumed:

- the frontend stack is **vitest + jsdom** (`app/package.json`) and **jsdom performs no
  layout** — it cannot screenshot, resolve `calc()`, or measure a box
- `tools/mobile_audit.py` **is** a Playwright screenshot sweep and is the closest precedent,
  but it drives a **live backend with a real login**, so its output is not deterministic
- ✅ **Python Playwright IS installed and Chromium launches** — verified by launching it:
  `chromium 145.0.7632.6`

So W1 is buildable and is correctly DC-1's first workstream. The missing piece is **route
interception** (`page.route`) to serve a fixed `/series` and `/api/breadth-monitor` response
so the PNG depends only on the tree.

⛔ **Baselines are deliberately not captured against live data.** A golden shot against a
moving backend re-records itself every day and proves nothing — the same defect as a rail
whose fixture is a moving reference, which the reader programme hit on 2026-09-17.

---

## 1.3 · THE DATA CONTRACT

**Authority:** `docs/breadth/api-series.md` (B1, D-035) + `api/routers/breadth_monitor.py:649`.

    GET /api/breadth-monitor/series?keys=<csv>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>

| param | rule |
|---|---|
| `keys` | canonical snake_case, comma separated, **cap 8** (`_SERIES_MAX_KEYS`); a 9th is `400`; repeats deduped |
| `to` | default: latest stored session |
| `from` | default: the 365 most recent stored sessions ending at `to`; `from > to` → `400` |
| span | capped at **365 stored sessions** (`BREADTH_SERIES_MAX_SESSIONS`), **enforced as 584 calendar days** (365 × 1.6) |

Response `200`:

```json
{ "from": "…", "to": "…", "sessions": 4530,
  "dates": ["…"], "series": {"breadth_score": [41.0, null, …]},
  "reconstructed": ["…"], "missing": ["not_a_metric"] }
```

### ⭐ THE COVERAGE FIELD V2-3 NEEDS IS ALREADY ON THE WIRE

The directive asks whether `_reconstructed` reaches the client. **It does:**
`reconstructed` is a top-level array of the dates whose row carries `_reconstructed`. So
DC-1 §2.4's *"derived from wire fields, never from the client guessing by date"* is
**satisfiable today with no router change**.

Also already contractual and load-bearing for V2-3:

- **non-finite and absent both become `null`, never `0`** — "absence is not zero, and a `0`
  here is a breadth reading a member would act on"
- `missing[]` carries unknown keys as **partial success, never 400**
- `dates` ascending, each once; every series column the same length as `dates`

### What V2-3 still needs, and where it comes from

| need | status | source without touching the reader hot path |
|---|---|---|
| reconstructed sessions | ✅ on the wire | — |
| **era note** | ✅ **RESOLVED** `01-audit.md:309-311` — the "Era comparability" bullet | ⭐ **NO wire change.** Computed client-side from `universe_count` end-to-end in the window (>20 % ⇒ show the note + a one-tap swap to `hi_ratio`/`lo_ratio`). The "would be a router/serialiser projection" guess in this cell was WRONG — recorded rather than overwritten, because it is the kind of guess that becomes a wire change nobody needed. |
| series start date ("where a series begins") | ❓ UNKNOWN | derivable client-side from the first non-null per key — **no wire change needed** if so |

⛔ The 365-session cap is enforced **before** the read, on calendar days, because counting
sessions requires reading them and a post-read rejection "has already paid the 55 s it exists
to prevent". **Any cap raise (DC-1 §2.1) must preserve that ordering.**

⚠️ **Flag-first, then paid.** `require_series_flag` is declared *before* `require_paid`, and
`tests/test_breadth_series_endpoint.py` asserts the two **positions**, not just the statuses —
because three green status codes are also compatible with a route that 404s for another
reason. Any change near that route must not reorder them.

---

## 1.4 · LONG HISTORY — ⛔ BLOCKED, and it is a real blocker

**The measurements DC-1 §1.4 asks for cannot be taken.** `/series` returns **404 for every
caller** in production because `BREADTH_SERIES_ENDPOINT_ENABLED` is unset on `web`, and the
hook additionally declines to request more than 365 sessions.

⛔ **Arming that flag is a production change and a deploy.** DC-1 §1 is explicitly read-only,
and §2.1's cap raise is scoped to V2-3. This session does not arm it.

**What would answer it, in preference order:**

1. **A local backend with the flag set and a real breadth DB** — no production change, fully
   deterministic, and the same path W1's harness needs. ⚠️ `C:\data` is real on this box, so
   this must go through the AST-derived env census (repo-root `conftest.py`), **not** a
   hand-set `DATA_DIR` — the 2026-09-12 incident where a "sandboxed" probe still wrote two
   live DBs is exactly this trap.
2. Arm the flag on `web` under an explicit owner ruling, measure, and leave it armed or dark
   per DC-1 §2.1's threshold.

⚠️ **The reader's numbers do not transfer.** The reader programme's ~300 ms p50 / 15×–141×
range was measured on `GET /api/breadth-monitor?days=N`, **a different route** with a
different serialiser. `/series` is "projected, pre-encoded, cached" and may be faster or
slower; assuming either is the proxy defect. **UNKNOWN until measured.**

---

## 1.5 · EXISTING TESTS, AND THE GAP

| file | covers |
|---|---|
| `BreadthCharts.test.jsx` | V1 general |
| `BreadthCharts.mechanics.test.jsx` | chart mechanics (C2 lane) |
| `BreadthCharts.a11y.test.jsx` | accessibility |
| `BreadthCharts.live.test.jsx` | live row behaviour |
| `BreadthCharts.loadError.test.jsx` | load failure states |
| `BreadthCharts.refresh.test.jsx` | refresh behaviour |
| `breadth/v2/BreadthChartsV2.test.jsx` | V2 shell |
| `breadth/v2/useBreadthSeries.test.jsx` | V2 read hook |
| `breadth/v2/flagOff.golden.test.jsx` | **flag-off DOM byte-identity** |

### ⛔ THE GAP IS EXACTLY THE ONE DC-1 W1 NAMES

**Nothing in this repo can catch a regression in panel layout, colour assignment, axis scale
or legend**, because all of it runs in **jsdom, which performs no layout**. A test can assert
that an ECharts `option` object contains a colour; it cannot assert the legend is readable at
380 px, that panels did not overlap, or that a scale flipped.

⭐ **The `flagOff.golden` is the right shape and the wrong medium for this.** It compares
**DOM**, which is perfect for "V2 changed nothing while dark" and blind to everything visual.
W1 is the pixel counterpart, and the two are complementary, not redundant.

⚠️ Its normalisation note is worth inheriting verbatim: it normalises **exactly two** things
(React ids and ISO dates) because *"a normaliser that erases too much is a golden that cannot
fail"*, and the ISO-date normalisation exists because an un-normalised golden built on TODAY
"would rot at the next midnight and be regenerated out of existence within a day."

---

## 1.6 · FLAGS

| flag | state | where |
|---|---|---|
| `VITE_BREADTH_CHARTS_V2_ENABLED` | build-time (Vite), ARG+ENV in `Dockerfile.web:95/114` | the V2 shell |
| `BREADTH_SERIES_ENDPOINT_ENABLED` | ledger `dark` | gates `/series` |

⚠️ **A ledger inconsistency, recorded not resolved.** `BREADTH_SERIES_ENDPOINT_ENABLED` is
`dark` with `where: ["web"]`, while `BREADTH_RESIDENT_RECON_ENABLED` is `dark` with
`where: []` and a note saying *"set on no service"*. The series flag is **not** set on `web`
(read live). So either `where` means "the service it targets" (and the ledger is consistent),
or it means "where it is set" (and this row is drifted). **UNKNOWN — the ledger's own schema
doc would answer it**, and `tools/flag_ledger_audit.py` is the instrument.

**Proposed names** (DC-1 §1.6), `_ENABLED`-suffixed so `is_gate()` sees them, ledger row in
the same commit as the first read (the rule `test_no_stale_build_flag_rows` enforces:
`declared ⊆ names_read(repo)`):

- `VITE_BREADTH_DC_V2_2_ENABLED`
- `VITE_BREADTH_DC_V2_3_ENABLED`

⚠️ **`VITE_`-prefixed, not bare** — these are frontend flags compiled into the bundle, and
the V2-1 precedent is a build ARG. ⛔ That means **a flip is a REBUILD AND A DEPLOY, not a
variable change** — which directly contradicts DC-1 §4.3's implied "flip on a word" and §4.4's
"regression → flag OFF" as a fast lever. **This is the most important open question in the
discovery** and is raised in full below.

---

## OPEN QUESTIONS

**Q1 — ⛔ A FRONTEND FLAG FLIP IS A DEPLOY, SO §4.2/§4.3/§4.4 NEED A MECHANISM.**
`VITE_*` flags are compiled into the bundle. Consequences the directive's design assumes away:
- **§4.2 owner preview** — a build-time flag cannot be "on for the owner, off for members";
  there is one bundle. A query param read at runtime *can*, but then the code is in every
  member's bundle and the gate is client-side.
- **§4.3 flip** — needs a rebuild + deploy (~3 min), not a word taking effect immediately.
- **§4.4 rollback** — "flag OFF" is a deploy too. The reader programme's rollback lever
  (`railway variable delete`) **does not exist for a build-time flag**, and is now known not
  to redeploy anyway.
⭐ The repo already solves this shape elsewhere: `HUB_PREVIEW_ENABLED` and the Notebook wave
ride the **auth payload** (`_access_payload` in `api/routers/auth.py`), read per request, no
rebuild — and that is how `isAdmin`-gated UI already works. **Proposal: gate V2-2/V2-3 on a
server-supplied capability on the auth payload rather than a `VITE_` flag**, which makes
owner-preview, instant flip and instant rollback all real. Needs an owner ruling because it
changes DC-1 §1.6's shape.

**Q2 — are C1/C2/C3/R1 done?** ✅ **RESOLVED 2026-09-17** (DC-2 §3.1) — C1, C2 and C3 are
BUILT and in production, each confirmed by `git merge-base --is-ancestor` against
`origin/master`, not by a tracking doc. **R1 is PARTIAL**: the `heatmapMetrics` adapter
shipped and `HM_METRICS` is derived, but the declared schema fields **`mark` and `refLines`
do not exist** in `chartMetrics.js` — and `mark` is exactly what A-28 is built on, so V2-3's
A-28 work is net-new. Full table + citations: `01-spec-v2-2-v2-3.md` §0.1-0.2.
⚠️ **`COVERAGE.md:35` — the file this question told a reader to resolve it with — is STALE**
(it still shows `C3 🔨 · R1 📋`), and `STATUS.md:253` is stale in the opposite direction
("R1's master merge is NOT taken"; it was). Resolving Q2 the way this line instructed would
have produced a wrong answer, which is why the verdicts are anchored to git.

**Q3 — what is the "era note" (A-28/A-39)?** ✅ **RESOLVED 2026-09-17** — it is the **Era
comparability** bullet at `docs/breadth/01-audit.md:309-311`, quoted verbatim in
`01-spec-v2-2-v2-3.md` §2.4, with A-28 at `01-audit.md:245` and A-39 at `:256`.
⭐ **It needs NO wire field.** The guess below (a router/serialiser projection) was wrong: the
note is computed client-side from `universe_count` within the window. The only requirement is
that `universe_count` be among the ≤8 requested keys while a count panel is on screen.

**Q4 — is `/series` fast enough for long history?** UNKNOWN and unmeasurable while dark
(§1.4). The reader's numbers are for a different route and do not transfer.

**Q5 — does the ledger's `where` mean "targets" or "is set on"?** UNKNOWN (§1.6).
