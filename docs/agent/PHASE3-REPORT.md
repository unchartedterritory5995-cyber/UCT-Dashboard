# UCT Agent Phase 3: report (overnight 2026-10-29 → 30)

**Status: five draft PRs, all unmerged and undeployed.** They form a stack that merges in order:

| # | Workstream | Branch | Base |
|---|---|---|---|
| #515 | WS1 conversational intelligence | `p3/ws1-conversation` | master |
| #518 | WS2 workspace operations | `p3/ws2-workspace` | #515 |
| #521 | WS3 product guide | `p3/ws3-guide` | #518 |
| #522 | WS4 Undo and receipts | `p3/ws4-reliability` | #521 |
| WS5 | integration and acceptance | `p3/ws5-integration` | #522 |

When a PR merges, GitHub retargets the next one to master.

**Safety:**
- The Agent stays admin-only, and NL-1 stays OFF.
- No server allow-list, approval rule, action limit, cost control, receipt or Undo rule was loosened.
- No Indicators, Breaking News, flow-worker, Wisdom or Desk file was changed.

Each workstream has its own doc: `PHASE3-CONVERSATION.md`, `PHASE3-WORKSPACE.md`, `PHASE3-GUIDE.md`,
`PHASE3-RELIABILITY.md`, plus the Indicators handoff in `PHASE3-INDICATORS-HANDOFF.md`.

## How it was measured

Before any change, a baseline probe ran the brief's example requests through the real Agent panel with a stand-in model.
- **14 of 18 needed the model or stopped on a question.**
- **Every one of them now reads locally**, except instance-specific corrections ("actually the 20 instead"), which go to
  the model by design, and a request with no tickers ("four daily charts"), which the model asks about.
- Each is asserted on the board in tests.

## Status by workstream

| Workstream | Status | Notes |
|---|---|---|
| WS1 conversation | COMPLETE | references ("the other one", "them"), corrections, described Undo, flexible wording, failure sentences |
| WS1-E bounded model repair | NOT STARTED (deliberate) | It adds a paid call per failure; measuring its benefit needs a paid evaluation the owner hasn't authorised |
| WS2 workspace | COMPLETE | `board.swap`, `board.duplicateChart`, the grid's watchlist rail, workspace composition, local board phrases, timeframe sync |
| WS2-D drawings | PARTIAL (documented) | The boundaries and the follow-ups that need no anchor guessing are documented; anchored tools are a separate milestone |
| WS2 settings eligibility (`known` → `eligible` rows) | NOT STARTED | `chartSettingsDescriptors.js` sits under `components/chart`, so ownership must be confirmed before Agent write permission is widened |
| WS3 guide | COMPLETE | link, hide drawings, canvas, layouts menu; settings explained from the descriptor table; Do it for me for the link colour |
| WS4-A Indicators Undo residue | HANDED OFF | Diagnosed. Indicators' draft #517 fixes it in their own file. No Agent change needed |
| WS4-B/C/D | COMPLETE | "undo all of that" with an exact partial account; receipts name the chart |
| WS5 integration | COMPLETE | 10 scenarios plus an ordinal-target fix the smoke run found |

## Release order

#515, then #518, then #521, then #522, then WS5, one at a time, each through the gate and verified live (as in Phase 2).

**Services that may rebuild.**
- #515 touches `api/services/uct_agent/turn.py`, which isn't on flow-worker's watch list.
- Services without watch patterns may rebuild from master as usual.
- The others are frontend and docs only.

**Contract change (#518 and #521):**
- `manifest.golden.json` adds 2 actions, the `chartGrid.set.watchlist` argument, and 4 guide feature ids.
- The NL-1 parity fixture was regenerated.
- If Indicators #520 (manifest functions) lands first, nothing in the Agent's action catalog changes. Re-run the rails.

## Hands-on acceptance (after each release, on an admin account)

1. **WS1:**
   - "add the 9 and 20 ema", then "make the 9 green", then "make the other one yellow": EMA 20 turns yellow. Then "undo
     just the colour change".
   - "change the bottom right to amd", then "actually, change the second chart instead": the change moves, and one Undo
     reverses it.
2. **WS2:**
   - "Make me a workspace with four daily charts for NVDA, AMD, AVGO and MU, a watchlist, and RSI beneath each chart":
     a 2×2, a watchlist on the right, RSI on each. Then "undo everything you just did".
   - "duplicate this chart", "move my watchlist to the left".
3. **WS3:**
   - "how do I link my charts?" highlights the link dot. "do it for me" offers the colours, and Undo reverses the pick.
   - With Chart Settings open on Canvas, "explain these settings".
4. **WS4:** on four charts, "slap the 9/20 on all four", then "undo all of that": all eight are gone. Receipts name the
   chart.
5. **Phase 2 still holds:** the EMA colours, "open daily charts for aapl msft nvda, each with a 50sma", and "Show me how
   to change the timeframe".

## Known limitations

- **Instance-specific corrections** ("actually the 20 instead") go to the model.
- **"Them"** with nothing to point at asks; it never guesses every chart.
- **copyLook is still proposed** ("make everything look like my NVDA chart"), per the owner rule.
- **A workspace request with no tickers** ("four daily charts") goes to the model.
- **The toolbar's "hide drawings" eye and the Agent's "hide all my drawings"** are different writers. Do it for me says
  which one runs.
- **Indicator Undo leaves residue in stored settings** until Indicators #517 merges. The Agent's own Undos are no longer
  blocked by it.
- **Verified in the real workspace in the local harness** (writes refused, scripted model), not yet in production.
