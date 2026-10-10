# UCT Agent × Indicator Intelligence — M3 contract (PROPOSED, not approved, not implemented)

Status: **proposal for owner approval.** Audited against `origin/master` `475c858b6d` (2026-10-10).
Basis: the Agent team's M3 Architecture Coordination Review (accepted by the owner as the basis) and its
12 contract questions, used here as acceptance criteria (§13). Extends `AGENT-INTEGRATION-HANDOFF.md`
§11 (M1) and §14–§15 (M2), which stay authoritative for what they cover. **Nothing in this file is built.**

**The rule:** UCT Agent owns the member-facing conversation. Indicator Intelligence owns every authoring
semantic and all working state: the draft, its lineage, revision, history, Undo, preview, validation,
the model call (`/converse`), Save, and the read-back. The Agent never holds a definition, a tree, a
formula or a revision of its own, and never reconstructs an indicator from chat history.

Target conversation (acceptance script, §12):

| Member | Owner of the work | Mechanism |
|---|---|---|
| "Create RSI 28." | Indicators | new draft → authoring turn |
| "Add a 5-period moving average of that RSI." | Indicators | turn on the SAME draft (same lineage, revision+1) |
| "Make the RSI line blue." | Indicators | turn on the same draft |
| "Undo that." | Indicators (authoring Undo) | `draftUndo` — the last authoring revision, not a chart Undo |
| "Open AMD and NVDA charts." | Agent | existing `widget.addCharts` (always proposed) |
| "Save the indicator and add it to both." | Indicators (Save) + M2 (add) | `saveDraft` (confirmed) → M2 `add` per chart → per-chart receipts |

---

## 1. What exists today (verified in code)

### 1.1 Pure, React-free and reusable as is

| Function | File | What it does |
|---|---|---|
| `newAuthoringState({lineage})`, `openAuthoringState(def, {defId, version, lineage})` | `app/src/components/chart/builder/authoring/authoringState.js` :34 / :56 | Draft state `uct.authoring.state/1`: `{lineage, defId, baseVersion, revision, working, base, intent, requests, assumptions, questions, history, source}`. `mintLineage()` :24 = `auth_<12 hex>`. |
| `applyTurn(state, patch, ctx)` | same :84 | Applies one `uct.authoring.patch/1`. Refused → same state; question → questions only; applied → `revision+1`, history snapshot (cap `HISTORY_MAX` 50). |
| `undo(state)` | same :119 | Pops one snapshot exactly; `revision+1` (a view built before the Undo goes stale); no redo. |
| `isDirty`, `prepareSave(state, {draftId})` | same :152 / :164 | Edit = `defId` + integer `baseVersion` → `version = base+1`; else create. Runs `validateUserDefinitions`. |
| `applyPatch(def, patch, ctx)` | `authoring/applyPatch.js` :1308 | Stale `baseRevision` → `patch:stale` (:1321); atomic ops; `wouldApplyAlone`. |
| `compactView(def, state, gateCtx)` | `authoring/compactView.js` :155 | `uct.authoring.view/1`, ≤ 24 000 chars — what `/converse` reads. |
| `readback(def, state, gateCtx)` | `authoring/readback.js` :255 | Deterministic member wording (outputs, presentation, alerts, needsAck, status). |
| `classifyTurn(res)` | `authoring/turnOutcome.js` :29 | change / clarify / answer / unsupported / refused; disposition must match payload. |
| `preflight(words, {sym, tf})` | (imported by the hook) | Local refusal before any model call. |
| `converseTurn({message, state, gateCtx, snippets, fetchImpl})` | `authoring/converseClient.js` :109 | POST `/api/user-definitions/converse`; never throws; error gates `network`, `http:<status>`, server `gate`, `converse:no-envelope`, `converse:no-disposition`. |
| `storeConversation(state, {previewAcked, draftId, save})` | `builder/conversationSave.js` :40 | `prepareSave` → `saveUserDefinition`; stages validate / ack / store / conflict (409). |
| `attachConversation({storedDoc, created, requests, settings, registry, base})` | same :99 | Installs the definition; create → `addInstance`; edit → redraw the existing instance. |
| `readSession/writeSession/clearSession/draftWillRestore`, `createKey/editKey/newKey`, `chartScope`, `mintScope` | `authoring/conversationSessions.js` | THE draft store (§4). |
| M2 `planIndicatorMutation` … `undoIndicatorMutation` | `builder/agentMutations.js` | Chart instances: add / remove / show-hide / Undo (HANDOFF §15). |

### 1.2 Exists only inside React (the one real gap)

The **turn sequence** — preflight → name-only rename shortcut → `converseTurn` → `classifyTurn` →
`withMemberName` → `applyTurn` → transcript lines → session write — lives only in
`builder/studio/useIndicatorConversation.js` `send()` :188–283, and Save in its `save()` :306. The
Agent must not copy it (a second pipeline). **M3 step 1 extracts it, unchanged, into a pure module that
the hook itself then calls** (§3.1). The hook's observable behaviour must not change (gate G1).

### 1.3 Server (unchanged by M3)

- `/api/user-definitions/converse` is **stateless**: each turn carries `view` (with `revision`), the
  authoring assumptions/questions and ≤ 6 snippets. It stores and applies nothing; it returns the
  model's envelope for the client to apply. `conversationId` (= the draft's `lineage`) is used only for
  cost totals and telemetry.
- Gates in order: `require_paid` (402) → `require_create_indicator_access` (admin, or the
  `create-indicator` cohort when `CREATE_INDICATOR_COHORT_ENABLED`; else 403) → 40/hour window (429,
  `Retry-After`, shared with /propose) → one call in flight per member (`rate:busy`) → per-call
  `cost:global` / `cost:user` (daily allowance: member $0.75, admin ≥ $10; ledger shared with /propose).
- Envelope checks (`check_envelope`): schema, questions-with-ops, disposition, ≤ 12 ops,
  `baseRevision == view.revision` (`envelope:revision`), names, trees, symbols; then backstops.
- Save: `POST /api/user-definitions` (server mints the id), `PUT /{def_id}` with `base_version` (409
  `conflict {def_id, expected_version, current_version}`; 422 `refusal {gate, plot, mode, guard}`),
  `POST /{def_id}/fork` (custom copy). Semantics stamping is server-side.
- **The Agent's budget is separate** (`/api/agent/turn`: 300 turns/day, population cap, its own cost
  surface). An authoring turn reached through the Agent costs one Agent turn AND one converse turn (§7).

---

## 2. Ownership matrix

| Concern | Indicators | Agent |
|---|---|---|
| Member conversation, routing, intent ("is this an indicator request?"), chart selection, proposals, wording | — | ✔ |
| Draft identity, lineage, revision, history, authoring Undo, recovery, expiry | ✔ (`conversationSessions`, `authoringState`) | holds only an opaque `draftRef` |
| The model call for authoring (`/converse`), envelope application, validation | ✔ | never calls `/converse` |
| Advice vs clarification vs authoring (disposition) | ✔ (server + `classifyTurn`) | shows `reply` / `questions` verbatim |
| Preview on a chart | ✔ (preview channel) | asks for it on a chart ref; never writes the preview |
| Save (create / new version), conflict, refusal, read-back | ✔ | asks after explicit member approval |
| Adding the saved indicator to charts | M2 interface (✔) | calls M2 per chart |
| Opening charts for symbols | — | ✔ (`widget.addCharts`) |
| Create Indicator dock UI | ✔ | may open it (M1 opener) |
| Agent panel UI, Agent Undo stack | — | ✔ |

---

## 3. Proposed interfaces

Classification: **[R]** reusable as is · **[A]** exists, thin adapter · **[N]** missing, Indicators-owned ·
**[G]** Agent-owned integration.

### 3.1 [N — extraction] `builder/authoring/authoringSession.js` (pure, no React)

The hook's turn and save logic moved out verbatim; `useIndicatorConversation` becomes a thin React
wrapper over it (gate G1: its tests and behaviour unchanged). Exported for the Agent through
`builder/agentAuthoring.js` (§3.2), never imported by the Agent directly.

```ts
runTurn(snapshot, message, { sym, tf, converse = converseTurn, snippets }) → Promise<{ snapshot, outcome }>
runUndo(snapshot) → { snapshot, outcome }
runSave(snapshot, { previewAcked, save = saveUserDefinition }) → Promise<StoreResult>   // storeConversation
```

### 3.2 [N] `builder/agentAuthoring.js` — the Agent-facing interface (contract `uct.indicators.authoring/1`)

```ts
type DraftRef = { contract: 'uct.indicators.authoring/1'; key: string; lineage: string }   // opaque to Agent
type DraftStatus = { draftRef: DraftRef; mode: 'create' | 'edit'; defId: string | null; baseVersion: number | null;
                     revision: number; name: string | null; dirty: boolean; canUndo: boolean;
                     canSave: boolean; needsAck: boolean; questions: string[];
                     readback: Readback;              // readback.js, deterministic
                     savedAt: number; recovered: boolean; openInDock: boolean }
type TurnOutcome = { ok: true; kind: 'applied' | 'question' | 'answer' | 'unsupported';
                     revision: number; reply: string | null; questions: string[];
                     changes: string[]; readback: Readback }
                 | { ok: false; reason: Reason; detail?: object; revision: number }

openDraft({ create: true, chartRef? } | { edit: { defId } }, ctx) → { ok, draftRef, status } | refusal
draftTurn(draftRef, message, { expectedRevision }, ctx) → Promise<TurnOutcome>
draftUndo(draftRef, { expectedStepId }, ctx) → TurnOutcome   // §15.1
draftStatus(draftRef) → DraftStatus | { ok:false, reason:'draft-expired' }
listDrafts(ctx) → DraftStatus[]                                    // newest first
discardDraft(draftRef, { expectedRevision }) → { ok } | refusal     // clearSession
saveDraft(draftRef, { expectedRevision, acknowledged }, ctx) → Promise<SaveOutcome>
showDraftPreview(draftRef, chartRef, host) / clearDraftPreview(draftRef, host)   // §5
```

- `ctx = { canAuthor, sym, tf, converse?, chartId? }` — `canAuthor` is the existing Create Indicator
  access answer (`ChartPane.canCreateIndicator()` / `createIndicatorAccess`), re-read for every call.
- `draftTurn` requires `expectedRevision === status.revision`, else `stale-revision` (nothing sent,
  nothing spent). The model is then given `view.revision` as today, so the server's
  `envelope:revision` check still applies.
- `openDraft({edit})` opens on the member's **current saved version** (read from their definition rows)
  and keys the draft `editKey(defId)` — the SAME key the dock's Modify uses, so the Agent and the dock
  share one draft for one saved indicator.
- `openDraft({create})` keys the draft `createKey(mintScope())` — a fresh scope per Agent-created
  draft, independent of any chart. (`createKey(chartScope(chartId))` stays the dock's own create key.)

### 3.3 [A] Preview host — `ChartPane` handle (§5)

```ts
showAuthoringPreview(def, { replaces?: defId }) → { ok } | { ok:false, reason:'readonly'|'busy' }
clearAuthoringPreview() → void
```
Thin adapter over StockChart's existing `handleStudioPreview` (StockChart.jsx :6585) and
`chartPreview.previewInstanceFor/Like`, forwarded StockChart → ChartPane exactly like M1/M2 handles.

### 3.4 [R] M2 for "add it to both"

`planIndicatorMutation(cs, {op:'add', defId: savedId}, ctx)` per chart, unchanged.

### 3.5 [G] Agent responsibilities

Routing to these functions; one `draftRef` per Agent conversation as the *active* draft; showing
`reply`/`questions`/`readback` verbatim; the Save confirmation; opening charts (`widget.addCharts`);
the ChartWidget adapter lines for §3.3; its Undo stack entries (§8); receipts that quote the outcomes.

---

## 4. Draft identity, persistence, recovery, expiry

**One store, no second one:** `conversationSessions.js` — a module `Map` (24 sessions) mirrored to
**sessionStorage** key `uct.authoring.drafts.v1` (≤ 8 persisted, 12 h TTL, 1.5 MB cap, history trimmed to
10 when persisted). Snapshot `{state, transcript, acked}`.

| Event | Today | M3 |
|---|---|---|
| Dock closed with ✕ | draft kept | same |
| Chart symbol / timeframe change | kept (key is chart scope, not symbol) | same; Agent drafts are not chart-keyed at all |
| Workspace / layout switch, same tab | kept (module map) | same |
| Page reload, same tab | restored (sessionStorage; `recovered: true`) | same |
| New tab, new browser session, other device | **lost** (sessionStorage is per tab) | **unchanged** unless the owner approves D2 |
| Saved definition moved on (edit) | dropped as `stale` | `draft-stale` refusal; Agent offers to reopen |
| 12 h idle / evicted | gone | `draft-expired` |
| Save succeeded / Discard | cleared | cleared |

`draftRef.lineage` is the draft's stable identity for its life; it never changes across turns, Undo or
reload. A saved definition's identity is `{defId, version}` from the confirmed Save (§6).

## 5. Preview lifecycle and chart targeting

Today a preview exists only for the chart whose dock is open (`onPreview` is that StockChart's own
setter) and never persists (`stripPreview` in `handleUpdateChartSettings`). **Verified risk:** the
preview's registry entry is ONE module-global id (`u_studio-preview`); two previews on two charts would
share it and closing either uninstalls both.

- **Rule P1 (proposed): one live preview per browser tab.** Showing a preview on chart B clears it from
  chart A first. `showAuthoringPreview` → `busy` while a dock on another chart holds the preview.
- Agent asks `showDraftPreview(draftRef, chartRef)` only on a chart where `canManageIndicators()` and
  `canCreateIndicator()` are true; Indicators installs the draft's working definition under the preview
  id and updates it after every applied turn / Undo for that draft.
- Cleared on: Save (before the durable instance is added — today's order), Discard, draft expiry, the
  Agent asking, the chart unmounting, and showing a preview elsewhere.
- Previews are never persisted, never listed by `instancesOf`, refused by M2 `add`.

## 6. Save — explicit approval, canonical persistence, read-back

- Save is **always** a member-approved action (Agent `risk: 'confirm'`), never inferred from "looks good".
- `saveDraft` refuses `stale-revision`, `needs-ack` (repaint acknowledgement not given), `not-dirty`,
  `access`, `validation` (with `prepareSave` errors). It calls the existing `storeConversation`.
- **Read-back:** success is reported only after the stored row is read back (`GET
  /api/user-definitions/{defId}`, version and `ast_hash` equal to what was sent) — `saved-unconfirmed`
  otherwise. Result `{ ok, defId, version, created, astHash, name, receipt }`.
- 409 → `save-conflict {currentVersion}`; 422 → `save-refused {gate, guard}`; 402/403 verbatim.
- Edit drafts save a new version of the same `defId`; there is no implicit fork. A custom copy stays the
  existing `POST /{def_id}/fork` (not in M3's path unless D5).

## 7. Permission and budget

Checked for EVERY `draftTurn`, `draftUndo`, `saveDraft`, `showDraftPreview`, with a fresh ctx:
- Agent gate (paid + admin, Agent's own) → `canAuthor` (Create Indicator access: admin + flag, or the
  cohort) → for preview/add, `canManageIndicators()` on that chart.
- The server re-enforces paid + Create Indicator access on `/converse` and paid on Save.
- **Budget:** each authoring turn is a real `/converse` call against the member's Indicator allowance
  (40/hour, daily $), plus one Agent turn. Refusals surface verbatim: `rate:hour` (429 + retry-after),
  `rate:busy`, `cost:user`, `cost:global`. `draftUndo`, `draftStatus`, preview and Save make **no model
  call** and cost no Indicator allowance.

## 8. Authoring Undo vs M2 chart Undo

Two different things, never merged:
- **Authoring Undo** (`draftUndo`): reverts the last applied authoring revision of the active draft. No
  chart is touched. Available until the draft is saved/discarded/expired; survives reload (within §4).
- **Chart Undo** (M2 token): reverts a confirmed chart mutation; memory-only, session-scoped.
- **"Undo that"** resolves to the most recent *member-visible* action in the Agent's own action history:
  an authoring turn → `draftUndo`; a chart change → M2 Undo. Undo of a **Save** is not offered (a saved
  version is permanent history); the member can remove instances via M2 or reopen and edit.

## 9. Shared files and the right-side docks

| File | Owner | M3 change |
|---|---|---|
| `builder/authoring/*`, `builder/studio/*`, `builder/agentAuthoring.js` (new) | Indicators | extraction + new interface |
| `components/chart/ChartToolbar.jsx` | Indicators | preview channel exposed on the handle |
| `components/StockChart.jsx` | Indicators (chart) | forward `showAuthoringPreview` / `clearAuthoringPreview` (2 forwarders) |
| `components/chart/pane/ChartPane.jsx` | Indicators | the two handle methods |
| `pages/charts/widgets/ChartWidget.jsx` `.agent` entry | **Agent** | two adapter lines (as M1/M2) |
| `pages/charts/ChartsWorkspace.jsx`, `agent/*`, workspace persistence | **Agent** | none required by Indicators |

The Create Indicator dock is per chart, inside the pane (`data-studio-dock`); the Agent panel is a
workspace column. They share no state or file. **Rule D-dock:** when the dock is open on the same draft
key as the Agent's active draft, the dock owns the draft; Agent turns on it are refused with
`draft-open-in-dock` (the Agent may say so and offer to continue there). This avoids two writers on one
snapshot without a lock service.

## 10. Reasons (proposed `AUTHORING_REASONS`)

`bad-request`, `access` (no Create Indicator access), `readonly`, `permission-changed`, `draft-expired`,
`draft-stale` (saved definition moved on), `draft-open-in-dock`, `stale-revision`, `preflight` (local
refusal, with text), `rate:hour`, `rate:busy`, `cost:user`, `cost:global`, `network`, `http:<n>`,
`converse:*` / `envelope:*` (server gates passed through), `patch:*` (apply refusals), `nothing-to-undo`,
`not-dirty`, `needs-ack`, `validation`, `save-conflict`, `save-refused`, `saved-unconfirmed`, `busy`
(preview held elsewhere). Agent-side codes stay the Agent's.

## 11. Partial success: Save ok, chart application partly failed

Save and chart application are separate, ordered steps with separate receipts:
1. `saveDraft` confirmed → "Saved *RSI 28* (version 1)." The draft is cleared; the definition exists.
2. For each target chart, M2 `add` plan → apply → commit → confirm. Each chart gets its own receipt:
   "Added to AMD chart." / "Could not add to NVDA chart: the chart changed while I was working."
3. Nothing is rolled back. A failed chart can be retried with a plain M2 add of the saved `defId`.
4. The Agent never reports "saved and added to both" unless both confirmations succeeded.

## 12. Implementation sequence and gates (after approval only)

| Step | Owner | Gate |
|---|---|---|
| S1 extract the turn/save pipeline into `authoringSession.js`; hook calls it | Indicators | G1: every existing builder/studio/authoring test unchanged and green; dock browser smoke (create, Modify, Undo, Save, preview) identical |
| S2 `agentAuthoring.js` (open/turn/undo/status/list/discard/save + read-back) | Indicators | G2: unit tests for every reason; scripted-converse tests of the 6-line script; no second store (rail on storage keys) |
| S3 preview host handles + P1 one-preview rule | Indicators | G3: two-chart preview test (no shared-id teardown), never persisted, cleared on save/discard/unmount |
| S4 Agent capabilities + ChartWidget adapter lines | Agent | G4: Agent rails (never `/converse`, never a tree), receipts quote outcomes, confirm on Save |
| S5 joint local sandbox (scripted model) — the 6-line script, reload mid-draft, dock/Agent same-draft, budget refusal, Save conflict, partial add | joint | G5 |
| S6 admin production acceptance in the isolated "Agent Indicators Acceptance" workspace (HANDOFF §14.8 rules) | joint | G6: Main Trading fingerprint same, other layouts identical |

## 13. The 12 contract questions — answers (acceptance criteria)

1. **Invoke the engine without the dock, no duplicate pipeline?** Core yes [R]; the turn sequence needs
   S1 extraction [N], after which the dock and the Agent call the same code.
2. **Draft identity, lineage, revision, history, Undo?** §1.1 / §4: `lineage` (`auth_<hex>`), `revision`
   (int, +1 per applied turn and per Undo), `history` (≤ 50, ≤ 10 persisted), `undo()` exact, no redo.
3. **Survival?** §4 table. Survives ✕, chart changes, workspace switch, reload in the same tab; NOT a new
   tab/session/device (sessionStorage). Changing that is decision D2.
4. **Context; advice vs clarification vs authoring?** Context = `compactView` + assumptions/questions +
   ≤ 6 transcript snippets per turn (stateless server). Disposition `answer`/`unsupported` (no change),
   `clarify` (questions, no change), `change` (ops) — enforced server-side and by `classifyTurn`.
5. **Agent-requested preview?** §5 + §3.3 [A]; P1 one preview per tab.
6. **Validation, Save, revision, read-back?** §6; `prepareSave` + `storeConversation` [R], read-back [N].
7. **Stable saved reference for M2?** `{defId, version}` from the confirmed Save; M2 `add {defId}` [R].
8. **Multiple drafts without ambiguity?** One active `draftRef` per Agent conversation; `listDrafts` for
   "which one?"; the Agent asks the member when more than one could match — never guesses.
9. **Minimal shared host?** §9: two ChartPane handle methods + two ChartWidget adapter lines.
10. **Permissions, stale revisions, budgets, truthful receipts?** §7, §10; `expectedRevision` on every
    write; receipts only from confirmed outcomes.
11. **Partial success?** §11.
12. **Overlap / duplicate state?** None if S1 is an extraction: one draft store, one pipeline, one preview
    channel, one Save path. The Agent stores only `draftRef`s.

## 14. Decisions requiring owner approval

- **D1** — Approve S1: extract the hook's turn/save logic into a pure module (behaviour-preserving).
- **D2** — Draft durability: keep per-tab sessionStorage (recommended for M3), or add server-side drafts
  (a new store — explicitly not proposed without approval).
- **D3** — P1 one live preview per tab (recommended) vs per-chart preview ids (engine change).
- **D4** — Budget: an Agent-routed authoring turn costs one Agent turn + one Indicator converse turn
  (recommended, no budget change) vs exempting one of them.
- **D5** — Edit drafts: new version of the same definition only (recommended); forks stay manual.
- **D6** — Dock/Agent same-draft rule: dock wins, Agent refused `draft-open-in-dock` (recommended).
- **D7** — Undo of Save not offered (recommended).

---

## 15. Agent team review (2026-10-10) — reconciled

Agent review of `ab6dbb2720`: architecture AGREED (S1 extraction, one draft store, Agent holds only
`draftRef`, never `/converse`); D1–D7 no objection. Changes adopted:

1. **Stable step identity (Agent objection, ADOPTED).** `undo()` moves the revision forward, so an Undo
   entry pinned to a revision would fail on the second consecutive "undo". Each applied turn gets
   `stepId = "<lineage>:r<revision it produced>"` — derived from the existing history (a snapshot stores
   the revision *before* its turn; revisions only increase, so produced revisions are unique). **No
   engine change.** `TurnOutcome.stepId` (applied only); `DraftStatus.undoStepId` = the step `draftUndo`
   would revert (`history.at(-1).revision + 1`) or null. `draftUndo(draftRef, { expectedStepId })`
   replaces `expectedRevision` and refuses `stale-step` unless the top of history IS that step — so
   stacked Agent Undo stays exact, and a dock edit in between refuses cleanly. After a reload the Agent
   offers authoring Undo only from `draftStatus().undoStepId` ("undo the last change to <name>"), never
   from a stale stack entry.
2. **D6 enforced inside every write (CONFIRMED).** `draftTurn`, `draftUndo`, `saveDraft`,
   `discardDraft` and `showDraftPreview` themselves refuse `draft-open-in-dock`, checked at call time;
   `DraftStatus.openInDock` is informational only.
3. **Preview defaults (ADOPTED).** `showAuthoringPreview` returns `{ ok, movedFrom: chartRef | null }`.
   An existing preview of the draft is refreshed automatically after every applied turn / Undo. The
   Agent never shows a preview unasked — only when the member asks or names a chart for the draft.
4. **Acknowledgement text (ADOPTED).** `DraftStatus.ackText: string[]` — the exact repaint
   acknowledgement sentences from `readback` (`needsAck` lines). The Save proposal shows them verbatim;
   `acknowledged: true` is sent only from that approval.
5. **Partial success (Agent-side note).** After Save, each chart's M2 add is a SEPARATE commit with its
   own receipt and M2 Undo token — never one compensating multi-target plan (that would undo the chart
   that succeeded).
6. **Resume after reload.** The Agent may store the opaque `draftRef` with its conversation; on resume it
   calls `draftStatus` — `draft-expired` when the tab's draft store no longer has it (new tab/session, §4).
7. **Open (owner):** the "12 contract questions" / "M3 Architecture Coordination Review" source — the
   Agent team did not author it and has no copy; this contract answers the 12 items as given in the
   owner's brief (§13). Owner to confirm the source.

Reasons added: `stale-step`. (`stale-revision` remains for `draftTurn`, `saveDraft`, `discardDraft`.)

---

## 16. Indicators implementation notes (S1–S3, branch `feat/indicator-agent-m3`, NOT deployed)

Implemented: `builder/authoring/authoringSession.js` (S1), `builder/agentAuthoring.js` (S2+S3),
`builder/studio/previewChannel.js` (S3); ChartToolbar → StockChart → ChartPane handles
`showAuthoringPreview(definition, opts)` / `clearAuthoringPreview()`. Deviations from §3/§10 as
proposed, all narrower or more explicit:

1. **Refusal shape.** A turn the server or engine refuses is `{ok:false, reason:'turn-refused',
   detail:{gate?, codes?}}` — server gates (`rate:busy`, `cost:user`, `cost:global`, `http:429`,
   `envelope:*`, `network` …) pass through verbatim in `detail.gate` rather than each being a reason.
2. **Unsupported is a reply.** A pre-flighted or `unsupported` turn is `{ok:true, kind:'unsupported',
   gate?, preflight?}` (nothing changed — the dock shows it as an assistant reply too).
3. **Undo outcome** is `{ok:true, kind:'undone', undid, revision, undoStepId, lines, readback, preview?}`.
4. **Save** never attaches to a chart and never arms alerts (requested alerts are reported in
   `outcomes`); charts are added through M2. The draft ends once the store accepts it — success
   is reported only after the read-back (`saved-unconfirmed` otherwise).
5. **Preview** `busy` also when this chart's own dock is open; `invalid` when the registry refuses
   the working definition. Edit previews take their pending-input shaping as an injected
   function, so the eagerly-loaded toolbar has no import cycle into the save module.
6. **Draft store additions** (no second store): `sessionKeys()` and the in-memory dock hold
   (`holdInDock` / `releaseDock` / `isHeldInDock`); the dock hook holds its key while mounted.
   `listDrafts` covers `create:` / `edit:` keys only (not the Builder's `new:` sheet).
7. Telemetry from Agent-driven turns is logged by the shared pipeline under the studio surface.

### 16.1 Typed rename (owner-approved 2026-10-10)

`renameDraft(draftRef, name, { expectedRevision }, ctx)` — renames the draft and nothing else,
through the shared pipeline's ONE name-only step (`authoringSession.renameTurn`, the same step the
dock runs for "Call it X"). No model call, no allowance spent; same lineage; one revision; one
history step (undoable).

- **Success:** `{ ok: true, kind: 'applied', renameOnly: true, rename: { from, to }, revision, stepId,
  changes: [{ kind: 'renamed', from, to, op }], lines, readback }` (`to` may be clipped to the
  engine's name limit). Only the deterministic name-only path ever sets `renameOnly` / `rename` —
  `draftTurn` sets them when the member's message was name-only (the local path), never for a
  model-applied turn.
- **⛔ `changes` alone is NOT a rename-only proof:** `set_slot`, `set_output_tree`, `set_input`,
  `add_clause` and `remove_clause` record no change entry, so a model turn could rename AND change
  maths while reporting only `[renamed]`. Rely on `renameOnly: true` (or `renameDraft`'s success).
- **What a rename changes:** `meta.name`, `meta.shortName`, display labels derived from the name
  (an unlabelled first output; acknowledgement sentences that name it). Never keys, trees, inputs,
  placement, style, requests or repaint mode.
- **Refusals:** `bad-request` (no name), `name-unchanged`, `nothing-to-rename`, `stale-revision`,
  `access`, `draft-open-in-dock`, `draft-expired`, `draft-stale`, `unknown-definition`,
  `turn-refused` (`detail.codes`).
- **Save after a rename:** `saveDraft` re-reads the acknowledgement (it may name the renamed output)
  and confirms the stored NAME by read-back (name, id, version, maths) — `saved-unconfirmed` otherwise.

### 16.2 S5 refinements (owner, 2026-10-10)

- **A — originating chart.** `DraftStatus.chartRef` is the chart a draft was started for, exactly as
  `openDraft({create|edit, chartRef})` was given it — kept on the draft's own snapshot (the existing
  store; no new one) and unchanged by turns, renames, Undo and reloads. `null` when unknown (a
  dock-started draft, or one opened without a chart). The Agent uses it when the member names no
  other chart; when it is `null`, the chart is gone, or more than one could be meant, the Agent asks —
  it never substitutes the first chart.
- **B — delayed definition.** A confirmed Save's `{defId, version}` is final. When an M2 `add` of it is
  refused because the member's definition rows do not list it yet (`unknown-definition`), that chart's
  outcome is a truthful, RETRYABLE application failure carrying the same `defId`; a retry is a plain M2
  `add` of that `defId`. Never a second Save, never a new definition. (No Indicators change: M2 refuses
  truthfully today; the retry classification is the Agent's.)
