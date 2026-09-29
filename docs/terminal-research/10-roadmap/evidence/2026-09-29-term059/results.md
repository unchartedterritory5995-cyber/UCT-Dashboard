# TERM-059 — Label a stale or proxied value at the value (FB-A11-03)

Base: `5acc73133` (worktree branch `worktree-agent-a1dc629f36e5c7e4a`). Built in `d50694379`
(not pushed). Scope built: the
Breadth Monitor's **NAAIM** column only. Every other stale/proxied value the spec names is
listed under *Follow-ups* below, not built.

## Premises, verified before building

| Premise (from the brief) | Verdict | Evidence |
|---|---|---|
| The backlog row's ⚠️ ("the max-age sentence exists twice and unreconciled, RM-N03") is stale | ✅ stale | `82a547a49` *"fix(provenance): RM-N03 was ONE rule stated twice with no pointer — the module now CITES CARD 33 instead of restating it"*; `app/src/components/provenance/freshnessAge.js:5-8` cites `DECISION_CARDS_2026-09-26.md` CARD 33 §2 |
| `freshnessAge.js` exports `mustShowAge` / `ageThresholdMs` | ✅ | `freshnessAge.js:216` (`ageThresholdMs`), `:259` (`explainMustShowAge`), `:284` (`mustShowAge`) at base |
| `FreshnessBadge.jsx` exists | ✅ | `app/src/components/provenance/FreshnessBadge.jsx` (171 lines at base) |
| TERM-041 is built | ✅ (read, not re-derived) | `docs/terminal-research/10-roadmap/backlog.md` TERM-041 row reads *"✅ BUILT 2026-09-29"* |
| NAAIM has a dated input at `api/services/breadth_monitor.py ~1315-1319` | ⚠️ **path corrected** | the `naaim_date` read is in the ROUTER, `api/routers/breadth_monitor.py:1315-1319` (`naaim_store.ingest(..., observed_on=metrics.get("naaim_date"))`); the service file has no `naaim_date` at all |
| Whether `naaim_date` reaches the client | ✅ **it does — no server change needed** | the collector's snapshot blob carries it; `numeric_of` (`api/services/breadth_monitor.py:98-109`) drops only `*_list` keys; `_metrics_for_dates` (`:470`) feeds `get_history` / `get_history_deep`, which `GET /api/breadth-monitor` (`api/routers/breadth_monitor.py:551`) serves row-for-row. The live row carries it too: `NOT_LIVE` lists `"naaim", "naaim_date"` (`api/services/breadth_live.py:122`) and the live route copies every `NOT_LIVE` key from the latest row (`api/routers/breadth_monitor.py:1053`). An independent reader of the same endpoint already depends on it: `tools/breadth_live_open_check.py:199` |
| (found) Reconstructed pre-collector rows carry NAAIM **without** a date | ⚠️ gap, not fixed here | `breadth_sentiment_history.values_asof` (`api/services/breadth_sentiment_history.py:174-205`) forward-fills the VALUE only; `breadth_daily_ohlc` overlays it onto the materialised reconstructed rows. Fixing it means changing the materialised rows and rebuilding them — not a minimal payload change. These rows now render *"weekly · undated"* rather than a bare number (follow-up 1) |

⚠️ Not measured: production data. No production row was read; that `naaim_date` is populated
in production is inferred from the code path and from `breadth_live_open_check.py`'s own
check (`naaim=… carries NO survey date` is a problem it reports, so the field is expected).

## What was built

- **`app/src/pages/breadth/naaimAge.js`** — supplies the two facts about NAAIM to TERM-006's
  authority (`explainMustShowAge`) and decides nothing about age itself: the value's own
  as-of (`row.naaim_date`, from the data, never "today") and the survey's cadence (weekly).
  ⭐ **"now" is the row's own session**, not the wall clock — the Monitor is a table of dated
  sessions, and against the wall clock every historical row would badge for being history.
  The live row uses the wall clock. Calendar dates are compared as noon-UTC instants (the same
  ET calendar day in both DST states), never `new Date('YYYY-MM-DD')`, which is UTC midnight
  — the previous evening in New York.
- **`FreshnessBadge` gains an `age` prop** — `{cadence, asOfDate}`, rendered as the age
  clause *"weekly · as of 2026-06-17"* (or *"weekly · undated"*). The caller mounts it only
  when the authority said so, exactly as `sessionStale` already arrives computed. With no D1
  class the clause stands in for the tier (no *UNKNOWN* beside a known as-of). The date is
  rendered as given, never pushed through the time-of-day clause (which would have printed
  *"as of 8:00 PM ET"*). An age-clause badge starts no 1 s interval — one per Monitor row
  would otherwise add up. Every existing caller is unchanged (no `age` ⇒ byte-identical).
- **Breadth.jsx** — the NAAIM column carries `age: naaimAge`; the generic cell renders the
  badge inline after the number (`.valueAge`: inline, one line — every Monitor row is a fixed
  32 px and the table is `nowrap`), and the cell's hover title reads
  *"NAAIM: weekly survey dated …"*. No new interactive element, so no tap target changes.
- **Same commit, by design:** the `reachable.test.js` AWAITING_A_DECISION block
  *"TERM-006 AGE AUTHORITY — SHIPPED WITHOUT A CONSUMER"* and its `PARKING_EXPIRES` row are
  removed (a tombstone comment records it); `freshnessAge.test.js` §7's *"no consumer yet"*
  rail (asserted the importer list was EMPTY) now names the adopter by path and asserts the
  Monitor actually wires it; `freshnessAge.js`'s *"NO CONSUMER YET"* header section and the
  §8 *"THIS GUARDS A RULE NOBODY RENDERS"* note are rewritten to match.
- **`panelAdoption.baseline.json`** banks `app/src/pages/Breadth.jsx` as a provenance
  adopter (via the rail's own `UPDATE_PROVENANCE_ADOPTION_BASELINE=1` mode — its "baseline is
  CURRENT" check requires a new adopter to be banked in the same commit).

## What a member sees, and when

On `/breadth` → **Monitor**, in the **NAAIM** column (Sentiment group):

- a reading whose survey predates the row's own session by more than TERM-006's threshold
  reads **`44.44 [clock icon] weekly · as of 2026-05-18`**; hovering says *"NAAIM: weekly survey dated
  2026-05-18"*. A 101-day-old feed therefore cannot render an unlabelled number.
- ⚠️ **In practice that is every row after the survey date.** NAAIM is weekly, and
  `freshnessAge` caps every cadence at one trading session (CARD 33 §2's carve-out: a
  slower-than-daily surface states its own cadence) — so the column states its as-of on
  every session the survey was carried into. That is the ruling's intended render, not
  noise; a reading dated the row's own session renders bare (the railed control).
- a pre-collector (reconstructed, before 2026-01-02) row reads **`55.55 [clock icon] weekly · undated`**.
- the live intraday row measures against the wall clock.

**When:** on the next `web` deploy after this branch lands on `master`. Not pushed.

## Tests (scoped, `cd app && npx vitest run <files>`)

| Run | Files | Tests | Result |
|---|---|---|---|
| new + touched provenance | `pages/breadth/naaimAge.test.jsx`, `provenance/FreshnessBadge.test.jsx`, `provenance/freshnessAge.test.js` | 115 | 3/3 files passed |
| reachable + provenance dir + S10/census rails | `screener/reachable.test.js`, `components/provenance/**`, `lib/presentation/{handRolledFormatters.census,s10Adoption,presentationPrimitives}.test.*`, `pages/research/i1S8Boundary.test.js` | 301 | 15/15 files passed |
| Breadth page | `src/pages/breadth/**`, `pages/Breadth.pageHeaderBleed.test.js` | 1,230 | 107/107 files passed |
| other rails naming Breadth.jsx + style rails | `hooks/pollingSites.rail`, `hub/deferredRowClosures`, `hub/sections/breadthSection`, `utils/jsonFetcher`, `styles/{tapFloor,themeIslands,tokens.reachable}`, `__tests__/sourcesAreText` | 67 | 8/8 files passed |

No server file changed, so no pytest and no `flow_worker_watch_coverage.py` run was required.

## Mutation proofs (byte backup to a lane-unique file, restore, sha verified)

1. **Flip the comparison** in `freshnessAge.js` — `ageMs > threshold.thresholdMs` →
   `ageMs <= threshold.thresholdMs`. `naaimAge.test.jsx`: **6 of 14 red**, including BOTH
   rendered-text rails — *"the 101-day-old reading says so beside the number"* (stale no
   longer labelled) and *"CONTROL: a reading from the row's own session renders BARE"* (fresh
   now labelled). Restored from `freshnessAge.js.term059-a1dc629f.bak`; sha256
   `2e81feb0…cd3d8` before and after; the file's diff against the HEAD blob is comment lines
   only.
2. **Unwire the cell** — drop `age: naaimAge` from the NAAIM column in `Breadth.jsx`.
   **4 red across 2 files**: three rendered-text rails in `naaimAge.test.jsx` and
   `freshnessAge.test.js` §7's *"the adopter is itself rendered by a page"*. Restored; sha256
   `be87d674…58bd0` before and after.

## Follow-ups — values the spec names beyond NAAIM (NOT built here)

FB-A11-03's provenance is ledger **H8**: *"Public sentiment scrapes — NAAIM, AAII, CBOE
put/call, CNN fear & greed, Macrotrends, Barchart, YCharts"*, and its statement asks for the
as-of **and the source name** at the value.

1. **NAAIM on reconstructed rows** — carry the survey date through
   `breadth_sentiment_history.values_asof` into the materialised reconstructed rows (needs a
   rebuild), so *"weekly · undated"* becomes a real as-of.
2. **AAII** (`aaii_bulls` / `aaii_neutral` / `aaii_bears` / `aaii_spread`) — weekly, already
   dated (`aaii_survey_date`), but its staleness is shown only as italic/opacity plus a hover
   title (`Breadth.jsx` `isStaleAaii`), never as rendered text. Same pattern as NAAIM: an
   `age:` hook on the four columns.
3. **CBOE put/call** (`cboe_putcall`) — daily; the row carries no per-value date, so an
   unpublished session is an honest gap but a late print cannot be labelled.
4. **CNN Fear & Greed** (`cnn_fear_greed`) — daily; no per-value date on the row.
5. **Macrotrends / Barchart / YCharts** proxies — named by H8; no surface consuming them was
   identified in `app/src` during this pass. Identify before building.
6. **The source name at the value** — which feed supplied the accepted NAAIM reading lives in
   `naaim_store` (`SOURCE_COLLECTOR` et al.), not in the Monitor row; not rendered.
7. **NAAIM on other surfaces** — the Heatmap/Views tiles (`heatmapMetrics.js` forward-fills
   NAAIM via `FFILL_KEYS`), the `/charts` Breadth widget, and the chart engine's NAAIM series
   render it without this label.
8. **TERM-082's serve-stale response header** — `evidence/2026-09-29-term082-serve-stale-census`
   records that no frontend reads it yet; it is the response-level half of this ticket.
