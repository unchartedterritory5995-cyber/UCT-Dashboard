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
