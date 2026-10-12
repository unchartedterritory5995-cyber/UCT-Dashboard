# UCT Agent — response presentation (2026-10-12)

**Principle:** give the member exactly the information they need, in the simplest useful format, with
more detail only when appropriate or requested.

## The contract — `app/src/agent/present.js`

Every answer a query capability returns becomes ONE **view**, rendered by `AgentResult.jsx`:

| kind | use it for | shape |
|---|---|---|
| `value` | one figure | `{ value, label, note? }` |
| `comparison` | values side by side + the change | `{ title?, items: [{label, value, note?}] }` |
| `metrics` | a few labelled figures | `{ title?, items, note? }` — items may carry `aka` (other ways members say the label) |
| `range` | a period summarised | `{ title?, items (First/Last/Change/Low/High/Average), note }` |
| `table` | ranked lists, screens | `{ text?, table: {columns, rows} }` |
| `headlines` | news items | `{ title?, headlines: [{title, meta}], source }` |
| `text` | prose | `{ text }` |
| `error` | refusal / missing data + what to do next | `{ text }` |

Any view may carry `details` (full text, full table, items — shown collapsed), `link`, `sources`.

### Adding a capability

Return what you already return — `{ text, table?, link? }` or a string — and you get a sensible view:
rows render as a responsive table; long text shows its lead with the rest under **Details**.

To be precise, also return `present: { kind, ... }`. Keep the full `text` too: it becomes the details,
the saved transcript text, and (for ordinary, non-local answers) what the model sees in history.

* **Focus:** for a `metrics` result, label your items the way members ask (add `aka` for symbols like
  "P/E"); when the member names one, only that figure is shown.
* **Depth on request:** the member's words "why / explain / in detail / methodology / walk me through…"
  show the full answer instead of the lead (`wantsDetail`).
* Never put a figure in `present` that is not in your result — the view is presentation, not data.

## Persistence and the two channels

* The member's transcript keeps each answer's view in the outcome row's data (`outcomeData.views`,
  bounded by `compactView` — the store never cuts a row's JSON; oversized display data is dropped first).
  Restore (`itemsFromTurns`) brings back answers, receipts, proposals (marked "from an earlier session"),
  questions and refusals; empty rows are skipped; older text-only rows still render.
* ⛔ **Views are never read into a model request.** The server's history door
  (`api/services/uct_agent/turn.py: outcome_for_model / is_local_row`) replays only a row's text — or,
  for a local-only result such as breadth, a fixed note. Naming reads text only. Tests:
  `tests/test_uct_agent_presentation.py`, `tests/test_uct_agent_breadth.py`.

## Layout

The transcript column is a size container (`container: agentlist`); `AgentResult.module.css` adapts to
the PANEL's width, never the window: wrapping rows (no sideways scroll), one card per row for 3+ column
tables on a narrow column, compact label/value rows for figures, comparison tiles side by side until the
column is really narrow. Structured views use the column's width; a single figure and prose stay small.

## Mixed requests

What a turn did is said by what actually ran: receipts for changes, a view per answer, a refusal for
what was refused. A local-only lookup beside news or an explanation gets UCT's fixed notice of the part
NOT done — unless a `news.*` op answered it from UCT's stored feed, whose card says so
("From UCT's news feed (not a live web search)").

## Acceptance stabilization (2026-10-12)

* **Breadth freshness policy.** Breadth answers come only from MI's FINALIZED end-of-day sessions
  (owner decision D5, `market_intel.breadth_reads`); source selection is unchanged and there is no
  intraday or provisional breadth here. A present-tense answer (no date named) always states its session
  ("As of 2026-10-08 close") and, when trading sessions after it have completed but are not finalized,
  says so from DATES ONLY: "2026-10-09 isn't finalized in UCT's breadth data yet."
  (`breadth_present.freshness_note`, `session_calendar.is_trading_day`). A request for a past date gets
  no such note. Any current-session/provisional mode needs an owner decision and an MI-owned, labelled mode.
* **Comparisons read in time order.** Earlier → Latest (or Later) → Change, and the change is always
  LATER − EARLIER, whatever order the request named the dates in: MI's own `change` (first − second),
  negated when the first date is the earlier one, never recomputed. A true minus sign plus "Down" /
  "Up" / "Unchanged"; a change that rounds to zero carries no sign.
* **General breadth.** `breadth.show` with `metrics: []` means "how's breadth?": the browser-only
  route fills UCT's documented overview, `breadth_present.OVERVIEW_METRICS`, which is % above 50-day,
  % above 200-day, net new highs − lows and net advancers. That is four measures, inside MI's limit;
  naming more than four is still refused. The default never appears in a model request: the manifest
  only says `[] = general overview`.
* **Single values.** Compact label above the figure ("NVDA · Market cap": a result's `present.short`
  names its subject), figure 20px (18px on a narrow panel), the source/session as a note, the full
  result under Details. Links into UCT are quiet text actions ("Open NVDA in Research →").
* **Headlines.** The first 5 are shown; the rest are under Details ("3 more headlines · details"), with
  their time and source; asking for detail shows them all.
* **Rows.** No scroll box inside the transcript: the first 8 rows, then "Show all N rows" in place; the
  answer's link (e.g. "Open in Screener") carries the full result.

Tests: `tests/test_uct_agent_acceptance_stabilization.py`, `app/src/agent/agentAcceptanceStabilization.test.jsx`.
