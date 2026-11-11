# COACH-1 — the coach's integration contract with Wave 2 (W3-5 / W3-6)

**Status:** frozen for Wave 3 by w3-a (2026-11-03). W3-5 (`coach.reviewSetup` over `chart.describeSetup`) and
W3-6 (`coach.contextHistory` over `history.eventStudy`) are BLOCKED on Wave 2 and are NOT built; this is the
contract the coach will code against when those kinds land on `agent/int-w3`. Owner: w3-a (coach side); the
Wave 2 builders own the kinds themselves. Changes to the inputs below are announced in the integrating PR.

## 1. What the coach is, in one paragraph

The coach TEACHES from a curated knowledge base (`docs/agent/coach/concepts/*.md`), grounds ONE observation per
answer in a served envelope, reviews the member's own journal DESCRIPTIVELY (counts and stats, never a trade's
prices, only with per-conversation consent), proposes a note the member approves, and never concludes, orders,
targets or guarantees. Every coach reply passes `api/services/uct_agent/coach/guard.py` server-side (mirror:
`app/src/agent/coach/guard.js`); a violating reply is replaced. Every coach answer ends "Educational, not advice."

## 2. Inputs the coach needs from `chart.describeSetup` (W3-5)

The coach consumes the kind's DataEnvelope exactly as served (MD-1 shape: `status`, `freshness`, `as_of`, `stale`,
`notes`, `data`). It needs, in `data`:

| field | type | the coach uses it for |
|---|---|---|
| `symbol` | string | naming the chart in the observation line |
| `through` | ISO date | the ONLY date the coach may say ("daily bars through 2026-10-30") |
| `structure` | enum `uptrend` / `downtrend` / `sideways` / `unclear` | a RELATION word, said as the kind says it |
| `vsAverages` | `{ "20": "above"/"below"/"at", "50": …, "200": … }` (any subset) | relation words only |
| `tightness` | enum `tight` / `normal` / `wide` / `unknown` | relation word |
| `volumeVsAverage` | enum `above` / `below` / `at` / `unknown` | relation word |
| `nearLevel` | `{ kind: "support"/"resistance"/null, distance: "near"/"far"/null }` | relation words |
| `sessions` | integer (the completed sessions the description covers) | a COUNT the coach may state |

Value-free rules the coach will enforce on its side regardless of the kind:
- The coach reads only ENUMS, RELATION WORDS, COUNTS and the envelope's own DATES from this kind. If the kind also
  serves prices, levels, percentages or ratios, the coach drops them before anything reaches the member's answer
  text or the model's context (`coach` entry). The guard's figure-traceability check then holds by construction.
- `status != ok|partial` or `stale: true` → no observation (the concept text alone). Nothing is guessed.
- The observation is ONE sentence per answer, built from at most three relations, worded by the coach from a
  fixed template (never by the model); the model may restate it once, as written.
- The coach never asks the kind for anything but the chart the member is looking at (selected, else the only one).

What W3-5 will do with it: `coach.reviewSetup` (query) = the concept(s) the described structure calls for
(e.g. `tightness: tight` → consolidation + breakouts) + the observation sentence + what to check + one question.
Never a verdict ("good setup"), never a direction.

## 3. Inputs the coach needs from `history.eventStudy` (W3-6)

The coach consumes the study envelope's AGGREGATES only:

| field | type | the coach uses it for |
|---|---|---|
| `event` | string (the study's own name, e.g. "close above 50-day after 20 sessions below") | naming the study |
| `symbol` or `universe` | string | naming the scope |
| `n` | integer | the sample size — stated, with the uncertainty sentence it requires |
| `window` | `{ from, to }` ISO dates | the dates the coach may state |
| `horizons` | `[{ sessions: int, pctPositive: number, median: number, worst: number, best: number }]` | COUNTS and the kind's own PERCENTAGES, quoted exactly as served |
| `caveats` | `[string]` | repeated verbatim after the figures |

Value-free rules:
- `pctPositive`, `median`, `worst`, `best` are figures FROM THE ENVELOPE: the coach may state them (the
  traceability check allows them because they are in the `coach` entry's `history` input), and must not derive,
  round differently, or combine them into a new figure (no "so about two thirds").
- The coach never names a single historical instance's prices or dates (no "on 2024-03-15 it rose 8%").
- `n` below the kind's own `minSample` (served by the kind) → the coach says the sample is too small and gives no
  figures.
- Every history answer carries: "past instances, not a forecast" and the uncertainty sentence; never
  "will", "likely to", odds language.
- Isolated kinds (ADR-005) are never studied; the coach refuses a study whose envelope carries `isolated: true`.

What W3-6 will do with it: `coach.contextHistory` (query) = the concept the event relates to + the aggregates as
served + the caveats + one question about the member's own plan.

## 4. Threading (W2-A1)

The single-turn coach workflow (W3-4: explain → what to check → one question back; `coach.next` quick replies)
adopts W2-A1 threading at integration: the coach's `question` becomes the thread's open prompt and the member's
reply to it is the next coach turn's `member_request`, with the same `coach` context entry (concept, consent,
review) carried forward by the thread, not re-derived from words. The guard runs on every threaded reply.

## 5. What does not change

Flag `UCT_AGENT_COACH` (default off), admin-only; no journal read without `coachConsent`; journal writes only as a
proposed note through `POST /api/j2/notes`; no autonomous trading; no price targets; telemetry value-free.
