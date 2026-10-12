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

* **Breadth freshness policy** (owner decision 2026-10-12; supersedes the finalized-only present tense).
  - *Present tense* ("what's breadth now?", a value with no date and `basis` not `"close"`): each measure
    comes from the Breadth team's current reading, `breadth_current.reading()` (contract:
    `docs/breadth/current-reading-contract.md`), applied by `api/services/uct_agent/breadth_now.py`.
    Each measure is labelled with ITS OWN status and time: "Intraday · 11:52 AM ET", "Provisional close · Oct 9".
    Approximate counts say "approximate count". The new-high / new-low family stays finalized-only and
    says so. A reading is shown as now only when the contract's `current` is True.
  - *Not current* (stale, unavailable, population drift, feed off): the member is told a live reading
    isn't available, and the finalized close is shown with its date as context.
  - *History, explicit closes* (`basis: "close"`), *comparisons and ranges*: MI's finalized read,
    unchanged (D5). A comparison's newest tile is labelled "Latest close".
  - The finalized-only note ("2026-10-09 isn't finalized in UCT's breadth data yet") remains for
    finalized answers. Finalization normally runs one session behind, by design.
  - ⛔ DEFAULT OFF: active only with `AGENT_BREADTH_CURRENT=1` (or true / on / yes) after an approved
    enablement. ON with the dependency or feed unavailable → "No current breadth reading is available right now".
    Obvious wording is routed deterministically (no model call). Activation, smoke plan, future
    live-vs-historical comparisons: `docs/agent/BREADTH-CURRENT-RELEASE.md`.
  - ⛔ Isolation is unchanged: current values travel only on the browser-only breadth route into the
    member's LOCAL row. The model's history note names the measures and says "the current reading";
    it never carries a value.
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
