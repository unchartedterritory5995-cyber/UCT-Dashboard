# UCT Agent — Indicators M1 integration plan (Agent side)

> **Status: BUILT + ACCEPTED LOCALLY 2026-10-09 (branch `feat/uct-agent-m1`, unreleased).** Start gate met: interfaces on master at `83ff279b3d` (feature `4fa65141a2`), live in production, Indicators confirmed them (cross-session message 2026-10-09). As built: `agentSeams.js` exports no `createIndicatorAvailable` — access comes from Indicators' `createIndicatorAccess` / `useCreateIndicatorAccess` (`studio/createIndicatorFlag.js`), the button's own rule. Receipts add one opener case the table below lacked: already open on the same target → "didn't type over what's in the box". Next: `docs/agent/M2-M3-PROPOSALS.md`.
>
> *Original status:* PLANNED — not started. Plan of record: `docs/indicators/AGENT-INTEGRATION-CONTRACT.md` (Indicators-owned) and `docs/indicators/AGENT-INTEGRATION-HANDOFF.md`. This file is only the Agent team's half.
>
> **Start gate (owner, 2026-10-09):** M1 begins only when ALL hold:
> 1. `app/src/components/chart/builder/agentSeams.js` (`instancesOf`, `seedFrom`, `SEED_MAX`, `createIndicatorAvailable`) and the opener (`openCreateIndicatorFor` / `canCreateIndicator` on the toolbar → StockChart → ChartPane handle) are **merged into master**;
> 2. their tests pass on master;
> 3. the Indicator team **confirms** the interfaces are ready.
>
> Until then, no Agent code imports or references them. M2 (add/remove) is evaluated separately after M1 is verified.

## 1. What the Agent builds (and nothing else)

| # | Piece | File | Notes |
|---|---|---|---|
| 1 | Host binding | `pages/charts/widgets/ChartWidget.jsx` (the `chartApiById` `.agent` adapter the Agent maintains) | `openCreateIndicator: (o) => paneRef.current?.openCreateIndicatorFor?.(o) ?? {ok:false, reason:'unavailable'}`, `canCreateIndicator: () => !!paneRef.current?.canCreateIndicator?.()`; `host.js` chart source passes both through the snapshot (as `view`/`goTo` are). |
| 2 | Capability context | `agent/useAgent.js` `capCtx` | Today `{surface}`. Add `createIndicator: createIndicatorAvailable(auth)` — computed by the INDICATORS helper from the auth payload the panel already has — so `available()` can hide `indicator.openCreate`. The manifest becomes per-member for that one action; the golden manifest is generated with it available (admin + flag) and a rail checks it is absent otherwise. |
| 3 | `indicator.list` | `agent/capabilities/indicators.js` (new) | `query: true`, target `chart`. Answer = `instancesOf(snap.cs, nativeRegistry)` rendered as a table (name, built-in/custom, shown/hidden, price/pane). Empty → "No indicators on <SYM>." Instances are addressed by `instanceId` through the Agent's short refs; names are display only. |
| 4 | `indicator.openCreate` | same | target `chart`, `risk: 'local'`, `undo: 'none'` (+ undoNote "close the Create Indicator panel"), args `{request: string|null (≤ 600), defId: string|null}` both required. `check`: refuse when the chart snapshot says `canCreateIndicator` is false (sentence from the opener's `reason` vocabulary). `defId` must come from an `indicator.list` row on that chart (refs), never a name. `apply` calls the host opener with `seedFrom(request)`; the receipt maps `{prefilled, draft, editing, reason}`. **The Agent never sends the seed, never calls `/converse`, never saves.** |
| 5 | Routing group | `agent/routing.js` | `{ id: 'indicators', domains: ['indicator'] }` with the contract's words + the condition rule `/\b(when|whenever|if)\b.*\b(cross(es)?|above|below)\b/`. Overlap with `charts` (colour, markers, compare) routes both; hints decide. Python `_GROUP_OF` + golden + group rails updated. |
| 6 | Discovery | `agent/discovery.js` | `indicators` / `customIndicator` topics move to `partial`: list + open Create Indicator; adding/removing stays "planned (M2)". |
| 7 | Docs | ROADMAP / CAPABILITY-CONTRACT / PRODUCT-HANDOFFS §9 | release row, coverage row, the M2 gate pointer. |

The Agent reads `cs` it already has; it never reads `indicatorInstances` itself, never imports `engine/instanceControls`, and never registers in the door-EIGHT ledger (that is M2, and the Indicator team's decision).

## 2. Receipts (from the opener's result)

| Opener result | Receipt |
|---|---|
| `{ok:true, prefilled:true}` | "Opened Create Indicator on <chart> with your request in the box — press Send when you're ready." |
| `{ok:true, draft:true}` | "Opened Create Indicator on <chart> — your earlier draft is open instead (your new request was not added)." |
| `{ok:true, editing:true}` | "Opened Modify on <name> in Create Indicator." |
| `{ok:false, reason:'access'}` | refusal: "Create Indicator isn't available for your account." |
| `{ok:false, reason:'readonly'}` | refusal: "That chart can't open Create Indicator." |
| `{ok:false, reason:'unknown-definition'}` | refusal: "I couldn't find that indicator on your account." |
| `{ok:false, reason:'unavailable'}` | refusal: "Create Indicator isn't reachable on that chart right now." |

No Undo is offered (`undo: 'none'`); the receipt says "close the panel to cancel".

## 3. Acceptance (maps the contract's §5 to Agent tests)

| Contract § 5 | Agent test | Kind |
|---|---|---|
| 1 `instancesOf` equals the blob through the registry | Indicators' own test; the Agent asserts its table is built ONLY from `instancesOf` output | unit |
| 2 list on 0 / 1 / 12 indicators; preview never listed | `agentIndicatorsM1.test.jsx` | unit + local browser |
| 3 `openCreate` absent for non-admin / admin without flag / non-cohort member | manifest-per-ctx rail | unit (contract) |
| 4 seed: panel opens, box holds it, NO `/converse`, Agent counter +1, Indicators ledger unchanged | local browser (network log asserts zero `/converse`) + real model (counter delta) | browser + real model |
| 5 existing draft wins; result `draft` | local browser | browser |
| 6 `defId` → Modify; unknown/foreign → refusal | unit + local browser | both |
| 7 Main Trading never touched | `chart_settings` / board fingerprint before = after; the protected-layout guard also refuses any board change there | browser |
| 8 routing: "add an RSI with a 4-colour histogram" → indicators; "make the chart dark" → not; "colour the candles by trend" → both | routing unit test | unit |

Plus the Agent's standing gates: golden + Python contract rails, full Agent suite, Batch 5/6/drawings/integrated browser suites, and a real-model pass on 10 indicator phrasings (list, open with a request, open Modify, an add/remove request that must be answered "not yet" — M2).

## 4. Risks

- **Per-member manifest:** today every member's manifest is the same; `available()` on auth makes one action conditional. The golden stays the admin+flag manifest; a rail asserts the variants.
- **Two Escape owners / Chart Settings open:** the opener closes Chart Settings first (Indicators); the Agent must not open anything else in the same plan (`exclusive` on `indicator.openCreate`).
- **Draft wins:** the receipt must never claim the seed was placed when `draft:true`.
