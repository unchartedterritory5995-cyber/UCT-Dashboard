# UCT Indicators — Batch 2 (Expressive Authoring): morning report, 2026-10-09

Branch `feat/indicator-batch2` in `C:\w\p6`, from master `bf1fca0690`. **Local only: nothing pushed,
nothing deployed, no Railway variable read or changed, cohort switch and budgets untouched, no
production access of any kind tonight.** Agent and Breadth code untouched; Main Trading untouched
(no production session was opened).

## A. Work completed

| # | Capability | State |
|---|---|---|
| 1 | Multi-state colouring (≤ 4 states): plot/histogram, candles (`barcolor`), background (`bgcolor`); relations positive/negative × rising/falling or any yes/no condition; "otherwise" colour | ✅ |
| 2 | Conditional tables: text colour / background following a yes/no output, Yes/No labels, text size, merged header (span), exact reopen | ✅ |
| 3 | Marker size + colour through conversation (per signal; calculation unchanged) | ✅ (and markers now actually draw — §F) |
| 4 | Formula + AI vocabulary: `linreg`, `correlation`, `vwma`, `roc`, `mom`, Keltner (`kcMiddle/Upper/Lower`) as exact-identity expansions shared with the Pine translator; both lanes; no approximation | ✅ |
| 5 | Preview, follow-up edit, Undo, save/reopen, versioning, share/install/fork, Batch 1 drafts + receipts | ✅ |

**Architecture reused, no new engine:** the palette/`colorMode:'column:<key>'` path and paint palettes
(colour states are one hidden index column + `colorPalette`); the object program + renderer (tables:
`c:'if'` colour nodes, `mergecells`, `text_size`); the closed table (expansions are trees of existing
functions — stored definitions carry primitives only); the shared patch schema (browser + server);
the existing safe-colour validation (`presentation:colour`).

**Remaining (not done, by design or scope):** real-model acceptance (needs your authorization and a
deployed environment); merging the 14 newer master commits (no file overlap — see B); items in §I.

## B. Git state

- Commits (on top of `bf1fca0690`):
  - `b193499433` feature — colour states, tables, markers, vocabulary
  - `a58eb5a5de` hardening — bounded expansion size (both lanes), chart-door function words, save-door colour tests
  - `def2c525cb` browser-acceptance fixes — markers drawn, reload-safe other symbols, inspector, prompt; docs
  - `1eb1cb2830` docs — Agent handoff after master's Gate C
  - (+ this report)
- 36 files, +4,982 / −123. Working tree clean apart from this report's commit.
- **Master drift:** `origin/master` = `6862564e6d`, 14 commits ahead of the base (UCT Agent Batch 6,
  Breadth NH/NL intraday, live-flow, notebook). **No file overlap** with this branch.

## C. Test results (branch vs master, same machine)

| Suite | Branch | Master | Verdict |
|---|---|---|---|
| New Batch 2 JS: `batch2.expressive` (18), `batch2.saveFixture` (1), `callExpansions` (22), `markerHost` (5), `secondarySourcesRevalidate` (3), `indicatorRegistry.hiddenStyle` (2) | all pass | — | ✅ |
| New Batch 2 Python: `test_call_expansions_parity` (12), `test_batch2_save_door` (17) | all pass | — | ✅ |
| JS builder + engine/ast + truth (7,427 tests) | 1 fail (`targetScriptReport`) | same | no regression |
| JS `src/components` full (22,173 tests) | 15 fail / 12 files | each file re-run alone: identical to master except `enumerationSites` (fixed: vocabulary moved to JSON — now master's single failure) | no regression |
| Python: every file touching the conversation door / planner (27 files, 837 tests) | 11 fail | same 11 on master | no regression |
| Python suspect files from the full run (11 files incl. `compute_graph`, `concept_vocabulary`, `ast_interpret`, `ast_conformance`) | — | identical counts on master | no regression |
| Python full suite (single process, 2 h 45 m) | 254 failed + 36 errors in 84 files / 41,801 passed | each of the 84 files re-run alone on both trees: 83 identical, 1 better on the branch (`test_mutation_check` 1 vs 3) | no regression |
| `vite build` | rc 0, StockChart chunk 745.76 kB (was 745.40) | | ✅ |
| Lint, changed files | no new errors (StockChart 109 = master 109) | | ✅ |

## D. Browser acceptance (local sandbox, isolated DBs, scripted stand-in model)

All on an AAPL daily chart in the sandbox's stub-admin layout:

1. ✅ "Make a momentum histogram: bright green when positive and rising, dark green … orange when
   negative and rising" → four colours drawn; card lists all four states. (Before tonight's fix the
   server planner cut the whole "momentum" clause.)
2. ✅ "Color candles green in an uptrend, yellow in consolidation, and red in a downtrend" → three-state candles.
3. ✅ Conditional table — RSI 61.2 (green), Trend "Bullish" (dark-green background), RS vs SPY 0.440 (green).
4. ✅ Merged title "Market status" across two columns, large text.
5. ✅ Big orange up-arrows below the bar at each close/EMA-20 cross (only after the marker fix — §F);
   removing the indicator removes the arrows.
6. ✅ "LINREG 50" light-blue line on price. 7. ✅ "CORRELATION 20 (SPY Close)" pane, within ±1.
8. ✅ Modify the saved histogram ("slow average 30 bars") → all four states kept, saved as version 2,
   semantics 2 stamped; reload → histogram, candles and table (incl. RS vs SPY, after the fix) exact.
9. ✅ "Make the bars that are negative and falling purple" → only that state changed; Undo restored red.
10. ✅ Batch 1: draft recovered after reload ("Recovered your unsaved draft …"); receipts "Indicator
    saved and added" / "Changes saved … version 2".
- Light theme ("Paper"): all state colours legible; plain table text follows the theme's pale text
  colour (pre-existing theme choice — OPEN-FINDINGS §9). Small panes (71 px) render all states.
  Window-resize to phone width was not possible (maximised window); table fit is covered by tests.

## E. Model acceptance

**No real-model run** (no local key; production not touched, as instructed). Everything above used
the dev-only scripted model, which proves plumbing, gates and rendering — not model judgement.
Recommended real-model set after a guarded deploy: the ten items above in the owner's words,
especially the bare "relative strength" table (expect a clarifying question — §F), "momentum
histogram", and a Keltner request.

## F. Security and correctness findings

Fixed in this branch:
- **Expansion amplification (Batch 2 introduced):** an expansion repeats its arguments; nesting
  multiplied (`correlation` 3×/level) — a 250-character formula became a 25 MB definition (depth 10)
  or froze the tab for 68 s (depth 12); the server walked the same tree. Both lanes now refuse in ~1 ms
  past 1,000 written nodes (largest realistic composite: 209) or 200 levels.
- **Colour injection:** every new colour field (states, palettes, cell colours, marker colour) is
  refused with CSS (`url(…)`, `expression(…)`, `;`) at the browser door and the save door (tested).
- **Markers never drew on a live chart (pre-existing, found tonight):** the binder's glyph capability
  was never injected; price-pane glyphs also anchored at price ≈ 0. Pine `plotshape` imports were
  affected too.
- **Saved `sym()` reads blank after reload (pre-existing):** other-symbol bars were never requested
  once saved definitions loaded.
- **Inspector** offered inert colour/width boxes for hidden data columns.
- **Prompt:** a bare "relative strength" request made a model that picks SPY hit the unnamed-symbol
  refusal; the model is now told to ask which symbol.

Checked, no issue: tables bounded (12×6, 48 cells, text ≤ 40, labels ≤ 16, spans inside); no new
routes, no new network destinations (the other-symbol fix only issues the `/api/bars` requests that
were always intended); no change to legacy definitions (byte-identical test); no cross-member
paths touched (save/share/fork unchanged and owner-scoped).

Recorded for other owners (`docs/indicators/OPEN-FINDINGS-2026-10.md`): §1 RSI-levels alert
limitation, §2 receipt overlaps chart content (seen again tonight), §3 output relabel on rename,
§4 shared-layout colour sinks (chart/workspace), §5 Breadth flag, §9 light-theme contrast (chart
themes), §10 `useFundamentalSources` has the same reload pattern (chart owner).

## G. Agent integration handoff

`docs/indicators/AGENT-INTEGRATION-HANDOFF.md`. In one paragraph: the Agent has no indicator
capability today. The authoring core is already headless (`applyTurn`, `undo`, `prepareSave`,
`storeConversation`, `instanceControls`); the studio loop, preview and the opener are UI-bound,
and the opener is not reachable from the Agent host. Recommended M1 = `indicator.list` (query) +
`indicator.openCreate` (hand-off, optional seed that never auto-sends). The Agent never saves and
never calls `/converse` (the member does both inside Create Indicator, on Indicators' budget).
M2 = add/remove saved or built-in indicators with an instance-narrowed fingerprint and exact Undo.
Missing interfaces: `instancesOf`, `instanceFingerprint`, `listDrafts`, the 422 refusal passthrough,
a host opener, an `indicators` routing group (which must pack under 55 per request after master's
Gate C).

## H. Deployment readiness

**Ready for a guarded release, pending your approval and the real-model check.** Merge
`origin/master` first (clean — no overlap), re-run the guard (`tools/pre_push_guard.py`, capture
rc), deploy dark (cohort stays off), then production admin acceptance on a scratch chart (never
Main Trading) plus the real-model set in §E. Note that the marker and reload fixes change
member-visible behaviour for **existing** indicators too: markers that were invisible will start
drawing, and saved `sym()` indicators will populate after reload.

## I. Decisions needed from you

1. **Approve (or not) the guarded release** and a real-model acceptance budget (~$0.30–0.50 on the
   admin cap, by Batch 1's measure).
2. **Markers going visible for everyone** (Pine imports and authored markers that never drew):
   ship with Batch 2, or behind a flag?
3. **Scratch definitions on the production drill board** from Batch 1 (`u_868299cd6d93`,
   `u_8374090b129e`): remove?
4. **Agent M1**: approve the plan in the handoff (and who builds the Agent half).
