# Breadth Data Charts — PROGRAMME CHECKLIST

**This file is the source of truth for the programme's state.** Directive **DC-1** (2026-09-17).
A fresh session must be able to resume from this file alone, and it is updated **in the same
commit as the work it records**. A checklist that lags is a false instrument.

The programme ends when this file reads **DONE** — DC-1 §5's DC8, which is reached when
everything buildable is built, previewed, and the flips are the owner's.

Created 2026-09-17 (Session 1, discovery).
Last updated: **2026-09-18 — DC8 DONE (D-055). PROGRAMME DONE.** All items built,
previewed, and the §5 production flip executed and pod-verified: `BREADTH_SERIES_
ENDPOINT_ENABLED=1`, `BREADTH_DC_V2_2_ENABLED=1`, `BREADTH_DC_V2_3_ENABLED=1` are all
live on `web`. Every paid member now sees Data Charts V2.

---

## STATE VOCABULARY

Inherited from the reader programme, plus one.

| State | Means |
|---|---|
| `DONE` | finished and merged to master; nothing further |
| `BUILT` | built and gated on a branch, **not on master** — names the branch |
| `READY` | preconditions met, waiting only for a slot |
| `BLOCKED` | a named precondition is not met — names it |
| `OWNER-GATE` | previewed and awaiting the owner's word; **the programme keeps building past it** |
| `OWNER-PENDING` | needs the owner's keyboard or ruling |
| `UNKNOWN` | not established this session; carries what would answer it |
| `NOT STARTED` | no work done |

⛔ **A state is changed only by evidence, never by expectation.** "It should have landed" is
not `DONE`, and a document saying so is not evidence — `RESUME.md` said "NEXT: V2-1" while
V2-1 was already merged.

---

## THE ONE-SCREEN ANSWER

| Item | State |
|---|---|
| **DC1** discovery | ✅ **DONE** — `00-profile.md`; baselines deliberately deferred to DC2 (no deterministic harness exists yet) |
| **DC2** harness + golden diff + perf rail | ✅ **DONE 2026-09-17** — `tools/breadth_charts_shots.py` + `tests/test_breadth_charts_shots.py`; goldens tracked at `shots-golden/` (incl. `dom/`), scratch dir gitignored |
| **DC3** V2-2 built dark | ✅ **DONE** — commits `7dec41299`/`652813b57` on this branch; runtime-flag-gated (`BREADTH_DC_V2_2_ENABLED`), not yet merged to master |
| **DC4** V2-2 previewed | ✅ **REACHABLE** — Q1 resolved (below): `BREADTH_DC_V2_2_ENABLED=admin` previews it for admins with **no deploy**, same mechanism as `HUB_PREVIEW_ENABLED`. Not yet armed on any Railway service — that is §5's flip, not this item. |
| **DC5** V2-3 wire fields dark | ✅ **NO WIRE FIELDS NEEDED** (Q3 resolved 2026-09-17). `reconstructed[]` is already on the wire; the era note is computed CLIENT-SIDE from `universe_count` (`01-audit.md:309-311`), and the start-of-data marker from the first non-null per key. **The client-side injection that makes this true — `universe_count` riding the request whenever a count panel is selected under v23, without becoming its own panel — landed 2026-09-17 (L-A/L-B, `BreadthChartsV2.jsx`).** |
| **DC6** V2-3 UI dark, LTTB, cap raised | ✅ **DONE 2026-09-17.** V2-3 UI (coverage, A-28 marks, era note, LTTB via ECharts native `sampling`, extended-days picker) built `670376b5d`/`a80cef80f`. **Q4 CLOSED same day (D-054):** `/series`' span cap raised 365→4,700 sessions (`_SERIES_MAX_SESSIONS_DEFAULT`), server AND client (`useBreadthSeries.MAX_SESSIONS`) in lockstep, with a real bug fixed in the same landing — the client's session-count-as-calendar-day comparison would have silently refused V2-3's own "Max" preset even after the raise; now scaled by `SESSION_TO_CALENDAR_DAY_RATIO` matching the server's `×1.6`. |
| **DC7** V2-3 previewed | ✅ **REACHABLE** — same mechanism as DC4, `BREADTH_DC_V2_3_ENABLED=admin`. Not yet armed. |
| **DC8** flips, watches, records, FINAL | ✅ **DONE 2026-09-18 (D-055).** All three variables flipped in order, each its own redeploy, each pod-verified before the next: series read path ON → `V2_2_ENABLED=admin` → widen to `1` (10-min watch, 10/10 healthy) → `V2_3_ENABLED=1` (10-min watch, 10/10 healthy). Live evidence captured on production at 1280/380: coverage bands, era note (real universe counts, not the audit's illustrative ones), LTTB engaged on the Max preset. **THE PROGRAMME IS DONE.** |

**Q1 is RESOLVED (2026-09-17).** V2's flags moved from build-time `VITE_*` (compiled
into the bundle) to the auth payload (`BREADTH_DC_V2_2_ENABLED`/`BREADTH_DC_V2_3_ENABLED`,
read per-request in `_access_payload`, exactly `HUB_PREVIEW_ENABLED`'s pattern) — `0`/unset
= off, `admin` = owner-preview, `1` = every paid member. Both are now `1` in production
(D-055) — every paid member sees V2-2 and V2-3.

**Landing history:** `breadth/dc-v2` merged to master as `546a11419` (rebased clean onto
master first, zero file overlap measured and confirmed). A separate, unrelated
promotion-pipeline bug (`full-suite-report.yml` missing its `promotion-gate:` marker,
blocking ALL production promotions repo-wide) was found and fixed in the same window
(`a5309c492`) — see D-055. Both landed to `production` and were confirmed live via
`/api/health` and the auth-payload flags before any variable was touched.

---

## NEW WORK ITEM FOUND IN DISCOVERY

### W2-0 · V2-1's tokens + validated palette

**`NOT STARTED` — and it is a prerequisite of V2-2, not a parallel task.**

V2-1 landed deliberately unstyled: *"⛔ NO STYLING ON PURPOSE … adding tokens now would put
`--v2-*` custom properties into every theme island before a single pixel is designed."* The
reasoning is sound and this programme agrees with it — but DC-1 §2.2 requires **sticky
colours assigned deterministically from one authority**, and that authority is the palette
V2-1 deferred.

⛔ Filed as a **sub-item of W2**, not a new increment, so the roadmap's numbering is not
disturbed. ⚠️ It touches **theme islands** — `app/src/styles/themeIslands.test.js` fails by
name on a `--*` token added without pinning it in every island. That rail is inherited, not
new, and it will fire.

---

## R — ROADMAP STATE

| Merge | State |
|---|---|
| C1 · honest states | `UNKNOWN` — resolve A-numbers via `COVERAGE.md` |
| C2 · chart mechanics | `UNKNOWN` — same |
| C3 · touch & ARIA | `UNKNOWN` — same |
| R1 · one registry | `UNKNOWN` — same |
| B1 · series endpoint | ✅ `DONE` — merged `5a0e224f4`, dark, contract `docs/breadth/api-series.md` |
| V2-1 · foundation | ⚠️ `PARTIAL` — shell/flag/read-path/golden landed `ee31cbc57`; tokens+palette, responsive height, URL state, range pills, header/freshness **not seen** |
| V2-2 · stacked panels | `NOT STARTED` |
| V2-3 · honest coverage + long history | `NOT STARTED` |
| V2-4 · controls | `NOT STARTED` — out of DC-1's scope |
| V2-5 · reading & sharing | `NOT STARTED` — out of DC-1's scope |

---

## W — WORKSTREAMS

| # | Workstream | State |
|---|---|---|
| **W1** | harness + goldens + perf rail | ✅ **DONE** — `tools/breadth_charts_shots.py`, goldens tracked |
| **W2-0** | V2-1 tokens + validated palette | `NOT STARTED` — W2 shipped unstyled anyway (colours via `stickyColours.js`'s own deterministic assignment, not a token system); revisit if/when V2-1's own styling pass lands |
| **W2** | V2-2 stacked panels, dark | ✅ **DONE** — `652813b57`/`7dec41299`: panels, sticky colours, linked crosshair + zoom, log toggle |
| **W3** | V2-3 coverage + long history, dark | ✅ **BUILT 2026-09-17.** Q4 CLOSED: measured real wheel-zoom on the phone viewport, 365→4,530 points, paint within 2% and zoom-settle within 11% — no cliff. Coverage bands, A-28 `mark` (added — R1 shipped 4 of 6 declared fields, not this one), the era note, LTTB (delegated to ECharts' native `sampling: 'lttb'`, D-053 — a hand-rolled version was built, mutation-proved, then thrown away once checked against the installed package), and the extended-days picker are all in. `coverage absent → render == V2-2` holds at the OPTION level (scoped to coverage chrome — the always-visible days picker is a documented, separate claim). |
| **W4** | records | rolling — `00-profile.md` open, DECISIONS entries per ruling applied |

⭐ **W3's wire half is further along than DC-1 assumed.** `reconstructed[]` already ships in
the `/series` response, so DC-1 §2.4's "derived from wire fields, never from the client
guessing by date" needs **no router change** for reconstructed sessions. Only the era note
is outstanding, and its definition is `UNKNOWN`.

---

## OPEN QUESTIONS — the live ones

| # | Question | What would answer it |
|---|---|---|
| **Q1** | ~~A `VITE_` flag cannot do per-user preview or instant rollback. Move V2-2/V2-3 to an auth-payload capability?~~ | ✅ **CLOSED.** Owner ruled yes; built as `BREADTH_DC_V2_2_ENABLED`/`_V2_3_ENABLED` on the auth payload, `0`/`admin`/`1`, same mechanism as `HUB_PREVIEW_ENABLED`. `api/routers/auth.py`, `AuthContext.jsx`'s `SERVER_FLAGS`, `flag.js`'s `useDcFlags`/`useV2Enabled`. |
| **Q2** | ~~Are C1/C2/C3/R1 done?~~ | ✅ **CLOSED 2026-09-17.** C1/C2/C3 in production (ancestry-checked); **R1 PARTIAL — `mark` and `refLines` absent**. ⚠️ The instruction in this cell was itself wrong: `COVERAGE.md:35` is stale and would have given a wrong answer for two of four. Anchored to `git merge-base --is-ancestor` instead. `01-spec-v2-2-v2-3.md` §0.1-0.2 |
| **Q3** | ~~What is the "era note" (A-28, A-39)?~~ | ✅ **CLOSED 2026-09-17.** The "Era comparability" bullet, `01-audit.md:309-311`; A-28 at `:245`, A-39 at `:256`. All quoted verbatim in `01-spec-v2-2-v2-3.md` §2.4-2.6. **No wire field required** — the guess that it was a serialiser projection was wrong. |
| **Q4** | ~~Is `/series` fast enough for long history?~~ | ✅ **CLOSED 2026-09-17 — D-054.** Combined the reader's now-measured post-fix cost (`FINAL.md` §14.1/§14.3: p50 277-497 ms, worst deploy max 3,752 ms) with `/series`'s OWN already-measured marginal cost at full span (`api-series.md`, D-035: 30.3 ms cold p50 at 4,530 sessions/8 keys) — no fresh sandboxed measurement needed, both pieces already existed and together answer it completely. Cap raised 365→4,700 sessions on that evidence. |
| **Q5** | Does the ledger's `where` mean "targets" or "is set on"? | The ledger's schema doc; `tools/flag_ledger_audit.py` |

---

## STANDING RULES INHERITED (DC-1 §0)

Unchanged from the reader programme and in force here:

- no market-hours window; the pre-push guard's recency (≥600 s) and burst (≥3 distinct web
  deploys/60 min) clauses are the authority; never `--no-verify`
- ⛔ **announce intent at the session layer before taking a landing slot** — the push→deploy-record
  blind window is **2.5–3.5 min** (measured twice) and no guard can see through it
- master-first landings; a push is not clear until **SUCCESS on the deploy's OWN record**
- one worktree one writer; stage by name, never `git add -A`; `git commit -F - <<'MSG'`
- controls that can fail; mutation-proved rails; counts derived not typed; INCONCLUSIVE ≠ CLEAN
- ⛔ `--kv` describes the service, **only the pod describes the process**;
  `railway variable delete` **does not redeploy** (`--set` does)
- ⛔ the reader's 8 hot-path files are **not touched by this programme**
