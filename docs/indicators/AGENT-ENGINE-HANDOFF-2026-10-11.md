# Indicators Engine → UCT Agent: integration readiness (2026-10-11, master `b4282b5d9d`)

Documentation only — what the ONE engine already exposes for an Agent to call. Nothing here is a new
planner, runtime, schema or tool registry. Verified against the code at that commit.

## 1. What the engine can create and execute

| Output | How it is declared | Runs on |
|---|---|---|
| A value per bar (`series`) | a formula plot (`line`, `stepline`, `histogram`, `area`, `baseline`) | chart, Info Row, alerts, scans |
| A true/false per bar (`condition`) | a boolean formula | chart (markers / paint), alerts, scans |
| Discrete marks (`events`) | `markers` (shape, position, text ≤ 24) | chart |
| Today's value (`scalar`) | a screener scalar (e.g. `rs_rank`) | scans only (refused in alerts by name, gate `scalar`) |
| Fill between two outputs | `band` with `edges: {upper, lower}` | chart |
| Background / candle colour | `paints`: `bgcolor`, `barcolor` (conditional colour) | chart |
| Guide lines | `hlines` (fixed levels) | chart — never a value (alerts refuse it alone, gate `presentation`, since Phase 6) |

Output kinds: `engine/outputType.js` (`series`, `condition`, `events`, `scalar`). Grammar:
`docs/formulas/GRAMMAR.md` (closed: 79 functions, 138 scalars). Imports — Pine (member door), thinkScript
(10/24 corpus), TC2000 PCF — all translate into these SAME documents.

## 2. Entry points (existing, owned by Indicators)

| Need | Call | Contract |
|---|---|---|
| What can be added, with its settings | `indicatorCatalog.catalogRows(registry)` / `userCatalogRows` — each row carries `inputs` (key, type, default, min/max/step, options) | `agent-seams-2026-10-11.md` §1 |
| Add / remove / show / hide on one chart (incl. settings) | `builder/agentMutations.js` `planIndicatorMutation` → `applyIndicatorMutation` → `confirmIndicatorMutation` → `undoIndicatorMutation` | `uct.indicators.mutation/1`; reasons `REASONS` (incl. `bad-input`) |
| Validate one setting | `engine/instanceControls.checkInstanceInput(def, key, value)` → `{ok, value}` or `{ok:false, why, spec}` | the settings dialog's own rule |
| Write / edit a formula conversationally | `builder/agentAuthoring.js`: `openDraft`, `draftTurn`, `draftUndo`, `renameDraft`, `discardDraft`, `saveDraft`, `showDraftPreview`, `draftStatus`, `listDrafts` | `uct.indicators.authoring/1`; reasons `AUTHORING_REASONS`; `AGENT-M3-CONTRACT.md` §16 (⚠ its title still says "PROPOSED, not implemented" — the code on master implements it) |
| Can this output feed a chart / alert / scan? | `engine/evaluability.evaluability(def, key, lane, ctx)` → `{status: supported|refused|disclosed, gate, guard, reason}` | browser preflight; the server (`alert_user_series`, scan lane) is the authority |
| Persist | `POST/PUT /api/user-definitions` (append-only versions; `baseVersion` refuses a stale write; `previewAcked` for a `preview-repaints` badge), `/fork`, `/share`, `/history`, `DELETE` | `api/routers/user_definitions.py`; refusals `SaveRefused` (`repaint`, `repaint-ack`, …) |

## 3. Validation and error contract

- Every refusal is BY NAME: `REASONS` (mutation), `AUTHORING_REASONS` (drafts), `evaluability` `gate`/`guard`
  with a member sentence, server `SaveRefused` / `AdmissionRefused.gate` (alert lane: `definition`, `lane`,
  `requirements`, `repaint`, `budget`, `cross-lane`, `bars`, `plot`, `withheld`, `scalar`, `presentation`).
- Nothing is half-done: a bad setting refuses the whole add; a save is one version; an alert refusal is
  raised before the row is inserted.

## 4. Preview, persistence, application

- **Preview** (`showDraftPreview`) draws on the chart without saving. **Save** (`saveDraft`) appends a
  version and is read back; it refuses `stale-revision`, `needs-ack`, `not-dirty`, `save-conflict`.
- **Application** to a chart is the mutation interface (one write, one receipt, one Undo); confirmation is
  only from the authoritative read-back (`did-not-land` / `unconfirmed` are never "done").

## 5. Needs the member's approval

- Saving a definition with a `preview-repaints` badge (explicit acknowledgement; `repaints` is never saved).
- Removing an indicator (it can disconnect other indicators' inputs) and any change to several charts.
- Overwriting a saved definition (a new version — the Agent proposes it, the member confirms).
- Arming an alert (the alert surface's own approval).

## 6. Experimental or disabled

- **Per-bar Pine runtime** (`VITE_PINE_RUNTIME_PANE_ENABLED`, `PINE_RUNTIME_STAGE`): OFF in production.
  An Agent must not offer a runtime script as drawable; `validateUserDefinitions` refuses to install one.
- **Lower-timeframe series** (`VITE_PINE_LOWER_TF_ENABLED`): OFF.
- Runtime documents: no alerts, scans or other-timeframe calculation (refused by name).
- Reserved plot styles `zones`, `bgband`, `barcolor` (as a style), `fill`, `cross`: refused by name.
