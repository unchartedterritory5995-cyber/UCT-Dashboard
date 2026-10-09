# UCT Agent ↔ Indicator Intelligence — Milestone 1 integration contract

Status: **proposed contract, nothing implemented.** Prepared 2026-10-09 after the Batch 2 production
release (master `0693b529fc`). Companion to `AGENT-INTEGRATION-HANDOFF.md` (the investigation).

**Ownership (owner rule, unchanged):** the Agent team owns routing, capability declarations, proposals,
receipts, Undo plumbing and the host binding. The Indicators team owns everything indicator-specific:
what an instance *is*, its name, its definition, Create Indicator, authoring, saving. The Agent gets
no formula engine and no conversational indicator system; it **never calls `/converse` and never saves**.

M1 is a stepping stone toward deeper conversational integration (later milestones: add/remove
instances with exact Undo; then handing a seeded authoring turn to Indicators), not the end state.

## 1. What M1 does

| # | Capability (Agent name) | Kind | Effect | Undo |
|---|---|---|---|---|
| 1 | `indicator.list` | query | Lists the indicators currently on one chart | — |
| 2 | `indicator.openCreate` | navigation-like, `risk: 'local'` | Opens Create Indicator on one chart, optionally with the member's request **prefilled, never sent** | `undo: 'none'` (closing the panel is the member's) |

Two capabilities, one new routing group. Nothing in M1 writes chart settings, definitions, drafts or alerts.

## 2. Interfaces the Indicators team provides

All pure or host-agnostic; exported from `app/src/components/chart/builder/agentSeams.js` (new file,
Indicators-owned), with unit tests in the same directory.

```js
/** The indicators on ONE chart, in stored order, as plain data. Never the studio preview
 *  instance (`u_studio-preview`), never a tombstone (`deleted: true`). */
export function instancesOf(chartSettings, registry) // → Array<IndicatorSummary>

/** @typedef {{
 *   instanceId: string,          // 'inst:<defId>:<n>' — the stable handle
 *   defId: string,               // native id ('rsi') or 'u_' + 12 hex
 *   name: string,                // registry display name (data, NOT an identifier)
 *   kind: 'builtin' | 'custom',  // custom = a member's saved definition
 *   version: number | null,      // saved definition version, custom only
 *   hidden: boolean,
 *   placement: 'price' | 'pane',
 * }} IndicatorSummary */

/** Can THIS viewer open Create Indicator here? The same answer the toolbar button uses
 *  (`createIndicatorAccess` && `canModifyWithIntelligence`); the Agent's `available()` mirrors it. */
export function createIndicatorAvailable(authContext) // → boolean

/** A request seed: trimmed, ≤ 600 chars (the converse message cap is larger; the seed is
 *  member text, shown in the box for the member to edit and send). null when empty. */
export function seedFrom(text) // → string | null
```

And one host method, added by Indicators to the chart's toolbar API and forwarded by
`StockChart` / `ChartPane` exactly like the existing `openCreateIndicator`:

```js
// existing: openCreateIndicator(opts?) — extended, backwards compatible
openCreateIndicator({ defId?: string, seed?: string }) // → boolean (false = not opened)
```

- `defId` set → "Modify" on that saved definition (the existing path, draft key `edit:<defId>`).
- `seed` set → the text is placed in the input; **no request is made**; the member presses Send.
- If a draft exists for that chart (`create:<chartScope>`), the draft is restored as today and the seed
  is **not** applied (the member's unsaved work wins); the return value says so (`'draft'`).
- It re-checks `createIndicatorAvailable` itself (today the check lives only on the button).

## 3. What the Agent team builds

**Host binding** (`app/src/agent/host.js` / `ChartWidget` `chartApiById` entry): expose
`openCreateIndicator` from the chart's toolbar API (it is not reachable from the Agent host today)
and `read()` already returns `cs` for `instancesOf`.

**Capability declarations** (shape per `capabilities.js`):

```js
registerCapability({
  name: 'indicator.list', target: 'chart', query: true, risk: 'local', reversible: true, undo: 'exact',
  summary: 'List the indicators on a chart (names, built-in or custom, hidden or shown).',
  args: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  available: (ctx) => true,
  answer: (ctx, target) => instancesOf(target.read().cs, registry), // answer text built by the Agent
})
registerCapability({
  name: 'indicator.openCreate', target: 'chart', risk: 'local', reversible: true, undo: 'none',
  summary: 'Open Create Indicator on a chart so the member can build or edit an indicator there. Optionally prefill what they asked for; it is never sent automatically.',
  hints: 'Use for any request to make, build, change or colour an indicator. Put the member\'s own words in `request`. Never describe formulas yourself.',
  args: { type: 'object', additionalProperties: false,
    properties: { request: { type: ['string', 'null'], maxLength: 600 }, defId: { type: ['string', 'null'] } },
    required: ['request', 'defId'] },
  available: (ctx) => createIndicatorAvailable(ctx.auth),
  apply: (ctx, target, args) => target.openCreateIndicator({ defId: args.defId || undefined, seed: seedFrom(args.request) || undefined }),
})
```

- `defId` comes only from `indicator.list` output through the Agent's short refs — never a name.
- **Routing:** a new group `{ id: 'indicators', title: 'Indicators on a chart (list them; open Create Indicator to build or change one)', domains: ['indicator'] }`, words e.g. `/\bindicators?\b/`, `/\b(rsi|macd|ema|sma|vwap|atr|bollinger|keltner|regression|correlation|momentum|oscillator|histogram)\b/`, `/\b(build|make|create|code)\b.*\b(indicator|study|signal)\b/`. Two capabilities — well inside `maxGroupSize` 40 and the routed budget (`routingThreshold` 55 per request, Gate C).
- ⚠ **Overlap to settle (Agent team):** the `charts` group already claims `markers?`, `compare|versus|against` and `colou?rs?`. "Colour the candles by trend" is an *indicator* request (Batch 2 colour states), "colour the candles green" is a *chart* setting. Proposed rule: a message that matches an indicator word **and** a chart word routes both groups (the packing rule already allows it); the model's hints decide.
- Manifest rails: update `manifest.golden.json` (`UPDATE_AGENT_GOLDEN=1`), `agentContracts.test.js`, `tests/test_uct_agent_contract.py`, and the group-membership rail.

## 4. Budgets and permissions

- `indicator.list` / `indicator.openCreate` cost one Agent turn (Agent budget, `UCT_AGENT_DAILY_CAP`). Opening the panel costs nothing on Indicators' side; **every authoring turn after that is the member's, on Indicators' budget** (`/converse` caps unchanged). The Agent must not send the seed.
- Gates: Agent = paid + admin (admin-dark). Create Indicator = admin + `uct.feature.createIndicator`, or the cohort (still OFF). `available()` must return false for anyone who cannot open the panel — no manifest entry, no offer.

## 5. Acceptance tests (both teams)

1. `instancesOf` equals `cs.indicatorInstances` through the registry; never lists `u_studio-preview` or a `deleted` tombstone; names come from the registry, ids are stable across reloads.
2. `indicator.list` on a chart with 0, 1 and 12 indicators answers exactly (no model invention), and on a chart showing the live preview does not list the preview.
3. `indicator.openCreate` is absent from the manifest for a non-admin, for an admin without the flag, and (when the cohort opens) for a member outside it.
4. With a seed: the panel opens, the box holds the seed, **no `/converse` request is made**, the Agent's daily counter moves by exactly one, the Indicators spend ledger does not move.
5. With an existing draft on that chart: the draft is restored, the seed is not applied, the result says `'draft'`.
6. With `defId`: Modify opens on that definition's saved version; an unknown or foreign `defId` returns false and the Agent says it could not open it.
7. Main Trading is never touched: no `chart_settings` write occurs in any of the above (fingerprint before/after).
8. Routing: "add an RSI with a 4-colour histogram" routes `indicators`; "make the chart dark" does not; "colour the candles by trend" routes both.

## 6. Out of scope for M1 (named so nobody builds it by accident)

Adding/removing instances (M2), saving, alerts, version restore, sharing, the Agent describing or
editing formulas, and any Agent call to `/converse` or `/api/user-definitions`.
