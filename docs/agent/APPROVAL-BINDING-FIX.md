# Approval-binding safety fix (Gate C release blocker)

Branch `fix/agent-approval-binding`, worktree `C:\UCT\approval-fix`, based on the Gate C rehearsal `5f32761809` (which is not modified). **Local only; for review.** Audit: `APPROVAL-SAFETY-AUDIT.md` on `feat/agent-charts-mastery` @ `bd5e709446`.

## Root causes
1. **The approved card was not bound to anything.** "Do it" re-planned the stored ops against the state at approval. Only sealed proposals were compared, and then only by card text.
2. **Unsealed proposals never expired.**
3. **A waiting card survived other changes.** Only a model plan replaced it; fast-path writes and Undo did not.
4. **Approval read caches, not the authority.**
   - Watchlists, alerts and saved screens were read from this tab's caches; the watchlist commit's server check compared against the approval-time plan, not the approved one.
   - `boardInSync` does not compare chart settings, so another tab's indicator edit was invisible.

## The fix (no new engine: the existing planner, kinds and approval path)
| Piece | Where |
|---|---|
| **Structured binding.** Per real target: kind + id, its *material state* (`approvalState`, else `fingerprint`), and the canonical planned **patch** (`approvalPatch` drops an approval's own seal). Per new target: its ops. Compared field by field, never by text. A subset approval ("do the first two") binds each touched target's state. | `executor.js` `approvalBinding` / `bindingDrift` |
| **Every proposal** stores its binding and expires after 10 minutes. "Do it" without a binding is refused. Each approval path compares: main, composed (at its rule gate), and fan-out. | `useAgent.js` |
| **Authoritative re-read** before the approval re-plan (`refreshForApproval`). Fails **closed** if the target can't be re-read. | `useAgent.js` + kinds |
| **Withdraw** a waiting proposal when any other change runs (a write or an Undo). Answers and questions keep it. | `useAgent.js` `withdrawPending` |
| **Server copy of one widget vs this tab's** (settings, chart tabs, timeframe), retried briefly for this tab's own save. | `host.js` `buildWidgetSync` → `host.widgetInSync` |

**Per kind:**
- **Watchlist:** server `fetchList`.
- **Alerts:** `loadAlerts({ force })` (the delete commit already compares the row signature).
- **Saved screens:** `loadSaved({ force })`, and the state includes the last screen and each saved definition.
- **Layouts:** list refresh. For save-current, save-as and a discarding open, the state includes the board's full content and unsaved flag.
- **Chart:** `widgetInSync`.
- **Indicator edits:** state = the chart's indicator instances and pane order, plus `widgetInSync`.

## Cross-session protection
| Resource | Authority checked at approval | Unreadable |
|---|---|---|
| Watchlists | the server list (`GET /api/watchlists/:id`) | refused |
| Alerts | the server book; the delete commit also compares the row signature | refused |
| Saved screens | the server list; the commit also re-reads it | refused |
| Layouts | the layout list re-read; another open layout is caught by `epoch` | refused |
| Charts / indicators | the server's stored board, compared for this widget's settings | refused |
| Board geometry | existing `boardInSync` | existing behaviour |

## Residual risks (not covered; none destructive without Undo)
- **Deferred follow-up steps** (`watchlist.open` after a create) and **fan-out follow-ups** run as approved re-validated steps, but not bound. Both are reversible; the fan-out binding is checked just before they run.
- **Board actions on widget content** (watchlist / scan shown in a widget, chart tabs, link colours): bound to this tab's board state and `boardInSync` (geometry, colour, timeframe), but not re-read for content from the server. All have exact Undo.
- **Drawings, digest, watchlist / alert / layout creation:** bound to this tab's state, no server re-read. Creation is not destructive; the digest change is what was approved.
- **Indicator binding is conservative:** any change to that chart's indicators refuses (a re-ask is needed).
- **Duplicating a layout** copies the stored layout at approval; its stored content is not in the binding.
- **Composed proposals** approve the rule (query + selection); the results resolve at Apply by design. The consumer's state is bound.
