# UCT Agent × Indicator Intelligence — M2 and M3 proposals

> **Status: PROPOSALS for joint review — nothing here is implemented.** M1 (`indicator.list`,
> `indicator.openCreate`) is built and accepted locally on `feat/uct-agent-m1` (unreleased).
> Indicator Intelligence owns formula interpretation, calculation, validation and authoring
> throughout; the M2 gate is Indicators' (`docs/indicators/AGENT-INTEGRATION-HANDOFF.md` §13).

---

## M2 — joint contract proposal: add / remove / show / hide one indicator on one chart

**Scope.** Four ops on ONE chart, one instance each: `indicator.add {defId, inputs|null}`,
`indicator.remove {instance}`, `indicator.setVisible {instance, visible}`. Re-parameterising
(inputs, style, placement) is **not** M2. Nothing creates or edits a *definition*.

| Concern | Proposal | Owner |
|---|---|---|
| **Canonical writers** | Add → `engine/instanceControls.addInstance`; remove → `removeInstance`; show/hide → the legend chip's own hide writer (Indicators names it). Called inside the chart kind's commit, producing a byte-identical `indicatorInstances` to the Indicator Library dialog for the same input. The Agent file is registered by **Indicators** in the door-EIGHT ledger of `controlDoorCensus.test.js`; no other Agent code writes `indicatorInstances`. | Indicators names/approves the writers; Agent calls them |
| **Target kind** | A new Agent kind `indicatorInstance` (one snapshot per instance per chart), refs = `instanceId`, read through `instancesOf`. Names are display only. | Agent |
| **Permissions** | Agent admin-dark gate + paid; the chart is writable (`canManageIndicators`, exposed as `canManageIndicators()` on the ChartPane handle beside `canCreateIndicator`); a custom `defId` must be the member's own (`userDefinitionRows`) or a built-in; foreign/unknown refused *before* any proposal. No cohort or budget change. | Indicators exposes `canManageIndicators()`; Agent checks it |
| **Stale guards** | The proposal pins `instanceFingerprint(cs)` (and the definition `version` for a custom add). Apply re-reads and refuses on mismatch ("changed while I was working"). `boardInSync` and the protected-layout guard (Main Trading) apply — `indicatorInstance` is an on-the-board kind. | Agent |
| **Persistence + read-back** | Write through the chart's one persist path (`ChartWidget` `.agent.commit` → `onOptsChange`); `host.persist()` ACK before Undo is offered; after Apply, `instancesOf` must show exactly the intended change by `instanceId` or the receipt says it did not land. The stored blob never contains `u_studio-preview` (asserted with the studio open). | Agent, with Indicators' read-back rule |
| **Undo** | Exact and instance-scoped: add → `removeInstance(id)`; remove → the removed instance restored byte-identically at its position (tombstone revived, same id); hide ↔ show. Undo refuses only when **that instance** changed since (fingerprint narrowed via `fingerprintFor`), never after an unrelated theme/timeframe/scale change. | Agent (runtime), Indicators (restore writer for a tombstone) |
| **Errors / conflicts** | Writer refusals surface verbatim as refusal receipts (`validateInstance` errors). No server write is involved in M2 (chart settings only); a 409 on the board save is the existing workspace CAS path (`workspace-revision-safety`) — the receipt says the board changed elsewhere and nothing was overwritten. | Agent |
| **Never** | No `/api/user-definitions` write, no `/converse`, no alert arm, no definition edit. | both |
| **Acceptance** | Failing-first tests for each §13 criterion; Library add/remove, Create Indicator, Modify, legend chips and the Indicators suites unchanged; manifest golden + group rails; joint local sandbox pass (Indicators runs it) before any production step. | joint |

**Open questions for Indicators:** (1) the hide writer's name and whether hide is a separate
door in the census; (2) whether `removeInstance` can expose a "revive" for exact Undo or the Agent
should restore the prior instance object through `addInstance` at an index; (3) whether
`canManageIndicators()` should join the ChartPane handle now (one line, Indicators-owned).

---

## M3 — architectural proposal: hand a natural-language request to the authoring engine

**Principle.** One authoring conversation per draft, owned by Create Indicator. The Agent never
interprets a formula, never calls `/converse` itself, never holds a draft.

1. **Hand-off, not a second conversation.** M1 already prefills the box. M3 adds an
   Indicators-owned `submitSeed({chart, seed})` on the ChartPane handle that **sends** the seed as
   the studio's own first turn — the same request, budget, cohort gate and ledger as the member
   pressing Send. The Agent's turn ends at the hand-off; the studio's conversation continues in
   the studio. The Agent records only the hand-off in its own history (no duplicate AI thread).
2. **Draft ownership.** Drafts stay with Create Indicator (keyed per chart / per definition, as
   today). An existing draft still wins — the hand-off returns `{draft:true}` and does not send.
   A `listDrafts()` read (deferred from M1) lets the Agent say "you have an unfinished indicator on
   the left chart" without opening it.
3. **Preview, edit, save approval.** Unchanged and entirely in the studio: preview is the studio's
   chart-preview channel (never stored), edits are the member's, **Save is always the member's
   click** in the studio. The Agent has no save path, and an Agent "yes, save it" is refused with
   a pointer to the studio's Save button.
4. **Status read-back for receipts.** An Indicators-owned `studioStatus(chart) → {state:
   'closed'|'draft'|'awaiting-model'|'preview'|'invalid'|'saved', defId?, version?, error?}`. The
   Agent's receipts quote it and nothing else:

   | state | receipt |
   |---|---|
   | `draft` | "Your request is in Create Indicator on <chart> — not sent." |
   | `awaiting-model` | "Sent to Create Indicator; it's working on it there." |
   | `preview` | "Create Indicator is showing a preview on <chart> — nothing is saved." |
   | `invalid` | "Create Indicator couldn't build it: <error, verbatim>." |
   | `saved` | "Saved as <name> v<version> (you saved it in Create Indicator)." — only from a read-back of the saved row |
   | failure of the hand-off | the opener/submit refusal reason, verbatim |

5. **Budgets and gates.** The studio's `/converse` budget and cohort gate apply unchanged; the
   Agent's own daily cap counts only the Agent turn that routed the hand-off.
6. **Ownership.** Indicators: `submitSeed`, `studioStatus`, `listDrafts`, the conversation, drafts,
   preview, validation, save. Agent: routing, deciding *that* a request is an authoring request,
   the hand-off call, and receipts from `studioStatus`.

**Not proposed:** the Agent composing formulas, editing a draft's text after hand-off, or
auto-saving. Any of these would duplicate Indicator Intelligence's authority.
