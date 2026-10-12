# UCT Agent — Natural Language & Intent Intelligence · Architecture Phase

Status: **architecture + test design only** (owner-authorized 2026-10-12). No runtime change. Branch
`docs/agent-nl-intent` (worktree `C:\w\nli`) on master = production `8179ab21be`. Not pushed.
Companion: [EVAL-PLAN.md](EVAL-PLAN.md) · corpus `app/src/agent/__fixtures__/nlIntent/corpus.json` (192 cases) ·
harness `app/src/agent/agentNlCorpus.test.js` · baseline rows `baseline-2026-10-12.json`.

## 1. Executive summary

UCT Agent already has a sound, layered understanding pipeline: a deterministic fast path for obvious
commands, deterministic routing, a model that plans against a manifest generated from the capability
registry, and strong post-model guards (registry re-validation, argument resolvers, deixis, approvals,
receipts, Undo). **The model is the only layer that tolerates natural language.** Every deterministic
layer is exact: no typo tolerance anywhere in the frontend, aliases only where hand-listed, one
capability (`layout.open`) that resolves the member's words through `resolveArgs`.

Measured on the new corpus (deterministic layers, no model):

| | Result |
|---|---|
| Cases | 192 across 14 categories |
| Should resolve with no model call ("ideal fast") | 94 |
| …resolved correctly today | **48 / 94 (51%)** |
| Typo cases resolved deterministically | **0 / 16** |
| Deterministic misfires (wrong action, no model involved) | **1** — "add it to momentum" adds the ticker **IT** |
| Routing misses (a needed action group not sent) | 3 / 48 checked |
| Typed answers to UCT's own question resumed | **0** — the stored plan is lost; the model re-plans from text |

The improvement strategy is **not** more hand-written phrases. It is four reusable mechanisms that plug
into hooks that already exist (`resolveArgs`, capability `fast`, context providers, the pending-question
flow), all deterministic, all fail-safe to "ask" or "let the model plan", none a second planner:

1. **Answer resolution** — a typed reply to UCT's own question resumes the stored plan.
2. **One lexical matcher** — normalized + bounded edit-distance matching of names and vocabulary,
   drawn from the registry and live state (not hand lists); ambiguous or destructive → ask.
3. **Grounded tickers** — pronouns are never tickers; lowercase/company names are confirmed through
   the existing ticker search before they become an argument.
4. **Reference context** — the last change and the last listed results as a small structured context
   section, so "do the same on the other chart" / "open the second one" are planned from state, not prose.

## 2. Current architecture (as implemented)

```
member text
  │
  ├─ L0 canon()            fastPath.js:33-58  13 meaning-preserving rewrites (number words, 5m/1h, synonyms
  │                         throw/stick/slap→add, get rid of→remove, "this/my chart"→"the chart", lead-ins)
  ├─ L1 fast phrases       fastPath.js:138    undo/confirm/dismiss/subset → fastWhole capabilities (whole text) →
  │                         extractTarget (position | all) → clause split (, ; and then &) → each capability's
  │                         `fast` (anchored regex; some resolve against live host state). All-or-nothing; >1 hit → model
  ├─ L2 target rules       useAgent.js        single kind: all → fan-out; position → matchPosition; deixis →
  │                         selected chart (deixis.js); one left → it; else LOCAL question (pendingRef 'target')
  │                         resolveArgs (layout.open only): id → name → word subset → "previous" → ask
  ├─ L3 routing            routing.js         regex words per action group (+ ticker after a show verb);
  │                         nothing matched → full manifest; need_groups → ONE reroute
  ├─ L4 model              turn.py            system prompt (dispositions, defaults, targeting, follow-ups) +
  │                         manifest lines (summary + hints + enums) + <workspace_context> (22 providers) +
  │                         history (last 12 turns, TEXT + [UCT executed] receipts) + pending proposal
  └─ L5 post-model guards  sanitize_envelope (unknown action ⇒ refuse; unknown target ⇒ "Which one do you mean?";
                            claims stripped) → bindSourceRefs/translateRefs → screenModelOps (indicator/save) →
                            screenDeicticOps (this chart) → screenNewChart → resolveArgs → planOps (shape + check)
                            → policy (confirm / irreversible ⇒ propose) → commit via product writers → receipt → Undo
Recovery: model clarify (choices are labels; a click re-sends the label to the model) · local question
(choices carry refs; ONLY a click resumes the plan) · need_groups reroute · Undo · proposal approve/subset/dismiss.
```

Key facts with evidence:
- **No fuzzy matching exists** in the frontend (grep for levenshtein/distance/fuzzy/similarity/typo/closest:
  none). Reusable ranked matchers exist: `components/chart/toolSearch.js:70` (exact > prefix > alias >
  substring), `pages/charts/widgets/companySearchIndex.js:88`, `IndicatorLibraryDialog.jsx:97`. Server:
  `api/routers/ticker_search.py:260` ranks symbol exact > prefix > contains > **name contains**.
- **Name matching** is exact (`norm` = lowercase, quotes stripped): `resolveList` (watchlist.js:82),
  `resolveName` (layout.js:59), saved screens (screener.js:604), templates (chart.js:174). Looser: only
  `layoutCandidates` (open only) and screener `matchValues`. Delete hints say "never pick one by similarity".
- **Tickers** are recognized by SHAPE only (chart.setSymbol needs UPPERCASE after a verb or `$x`;
  `parseTickers` uppercases any word; routing needs capitals). `unknownSymbols` validates exact tickers;
  nothing maps a company name to a ticker except the model.
- **Indicators**: `defIdOfWords` (indicatorEdits.js:282) = exact defId or full name; `settingsOfWords`
  handles "20 ema", "rsi 7"; "bollinger" (defId `bb`, name "Bollinger Bands") falls through — the catalog's
  `shortName`/tags are not consulted; multi-input ("macd 12 26 9") is model-only.
- **Conversation memory** is text: `history_messages` (turn.py:510) replays member/agent text and
  outcome receipts. Context refs are re-minted per turn. A LOCAL question is recorded as the fixed
  outcome "Asked which target." (useAgent.js fast branch) — its choices and stored ops never reach history.
- **Typed answers**: a local question resolves only through `chooseTarget` (a click,
  AgentPanel.jsx:198). A typed "the right one" / "AMD" / "2" goes to fastParse, finds nothing, and is sent
  to the model, which sees "Asked which target." — not the plan, not the choices.

## 3. Capability gaps and user impact (ranked: impact ÷ effort)

| # | Gap | Evidence (corpus) | User impact | Effort |
|---|---|---|---|---|
| G1 | **Typed answers to UCT's own questions drop the plan** | recover-01…07 | High: the most natural reply ("the right one") costs a model call and can re-plan differently; Undo/approval unaffected | Low |
| G2 | **Pronoun parsed as a ticker** | ticker-09 → `watchlist.add ["IT"]` (deterministic, no model) | High (correctness): a wrong symbol written to a member's list | Very low |
| G3 | **No typo tolerance in deterministic layers** | typo: 0/16 ideal-fast reached; typo-06 also loses the layouts routing group | Medium-high: every typo costs a model call; name typos (layouts, lists) leave the model to guess among names | Medium |
| G4 | **Name resolution exact except layout.open** | typo-06/07/08/20, ws-13 | Medium: "open swng board", "momentm watchlist" depend on the model; destructive typos must ASK (typo-13, safety-08) | Low (reuse resolveArgs) |
| G5 | **Lowercase tickers and company names** | slang-04, ticker-01/03/04/06, typo-12 | Medium: "pull up nvda", "show me apple" go to the model with no symbol grounding | Low-medium |
| G6 | **Indicator aliases and multi-input** | ind-01/11, slang-13, ind-02 | Medium: "add bollinger", "stochastics", "bollies", "macd 12 26 9" | Low (needs an Indicators catalog alias field) |
| G7 | **References to earlier turns are prose-only** | ref-01/04/05/11 | Medium: "do the same on the other chart", "open the second one" rely on the model reading receipts | Medium |
| G8 | **Routing words are brittle** | ws-09 / typo-06 (no "layout" word), screen-04 ("momentum" → indicators; screener missing), "show me the leaders" (no group) | Low-medium: a reroute costs a 2nd model call; noise groups waste tokens | Low — but **routing is frozen for this phase** |
| G9 | **Narrow approval/subset phrasing** | ref-13 "only the first two" (not a subset phrase) | Low-medium | Very low |
| G10 | **Exclusive layout.open blocks compound requests** | multi-03 (parsed right, refused as "two steps") | Medium for power users | Medium (planner) |
| G11 | **Model clarify on an unknown target has no choices** | sanitize_envelope → "Which one do you mean?" with `choices: []` | Low-medium (recovery quality) | Low — **turn.py frozen this phase** |
| G12 | **Bare commands with a selected chart still ask** | ambig-01 | Owner decision (conservative today) | Very low |
| G13 | **Model-side intent quality is unmeasured** | slang/mi/screen/ref are model-path | Unknown: no live evaluation has been run | Needs owner $ |

## 4. Design principles

1. **One planner, one registry.** Every improvement feeds the existing pipeline: a better argument, a
   better target, a better context fact, or a resumed stored plan. Nothing executes outside
   planOps → policy → product writer → receipt → Undo.
2. **Vocabulary comes from the system, not from hand lists.** The lexicon is generated from capability
   enums and fast tables, the indicator catalog (names, short names, aliases), the routing group words,
   and live state (layout, watchlist, saved-screen, template names; chart symbols; context labels).
   A new capability or a renamed layout is understood the day it exists.
3. **Deterministic only when certain.** A correction or match is used only when it is unique and
   high-confidence; otherwise the text goes to the model unchanged, or UCT asks with real choices.
4. **Destructive targets are never fuzzy.** For confirm/irreversible capabilities a fuzzy match can only
   produce a question ("Did you mean “Swing”?"), never an argument.
5. **Tickers are grounded, never guessed.** A symbol from free text is an argument only after the
   existing ticker search confirms it; pronouns and common words are never tickers.
6. **The member's words beat inferred context; explicit beats implicit** (position/symbol > selection >
   only-target > ask), as in Slice 1B.
7. **Every NL improvement ships with corpus cases** and moves a measured number.

## 5. Improvement strategy (compatible components)

| Id | Component | Where it plugs in | Owner of the call site |
|---|---|---|---|
| S1 | **Answer resolver** `agent/nl/answer.js` (new, pure): given a pending local question (choices with refs/labels, stored ops) and the typed reply → `{ pick: ref }` by ordinal ("2", "the second", "first one"), position word, symbol/label token, label edit-distance; `{ all }` for "both/all"; `{ dismiss }`; `{ changed }` when the reply is a new request (falls through to the normal path, the question is kept if still relevant) | `useAgent.send`: before fastParse when `pendingRef.kind === 'target'` → the existing `chooseTarget` | Agent (useAgent) — **overlaps Response Experience** |
| S2 | **Lexical matcher** `agent/nl/match.js` (new, pure): normalize (case, quotes, punctuation, plural, "my/the", trailing kind word) → exact → token-set → prefix → Damerau-Levenshtein (≤1 for 4–7 chars, ≤2 for ≥8), returns ranked candidates + confidence | capability `resolveArgs` (hook exists): layout open/rename/duplicate, watchlist (open/add/remove/show), saved screens, templates; destructive capabilities: fuzzy ⇒ `{ask}` only | capability modules (Agent) — low overlap |
| S3 | **Registry lexicon** `agent/nl/lexicon.js` (new): builds the closed vocabulary (§4.2) and corrects single tokens before fastParse when the correction is unique and the token is not a ticker/number/proper name in context; corrections are logged in telemetry, never shown as a claim | one call before `fastParse` (fastPath.js / useAgent.send) | Agent (fastPath) — medium overlap |
| S4 | **Ticker grounding**: (a) pronoun/stopword guard in `parseTickers` (it/this/that/them/these/those/one/all/both/me…); (b) lowercase ticker after a show verb → candidate, confirmed by `unknownSymbols` in `prepare`; (c) company name → `/api/ticker-search` name match: unique exact name ⇒ that ticker (said in the receipt), several ⇒ ask | chart.js / watchlist.js / workspace.js capability `fast` + `prepare` | capability modules (Agent) — low overlap |
| S5 | **Reference context** provider `recent` (Context-owned module): last executed change (actions, target labels, args digest, at) and the last listed result set (ordinal → id: layouts list, screen rows, indicator list) — capped, labels only | registerContextProvider; data via a small host accessor fed by the runtime's receipts | Context provider (mine) + one useAgent accessor (Agent) |
| S6 | **Indicator aliases**: catalog rows expose `shortName`, plural and `aliases` (Indicators-owned); `defIdOfWords` consults them through S2 | indicatorEdits.js `fast` | Indicators seam + Agent capability |
| S7 | **Exclusive continuation**: after an exclusive op (layout.open) lands, the remaining ops of the SAME fast/approved plan are re-planned on the new board by the existing planner (as `sequential` indicator edits already do) | executor/runtime (Agent) | Agent — later |
| S8 | **Routing hardening**: route on lexicon-normalized text; add a group when a live NAME from context (layout/list/screen) appears; demote noise words ("momentum" + list noun ⇒ lists) | routing.js | **frozen this phase** |
| S9 | **Clarify with real choices** when the model names an unknown target | turn.py sanitize_envelope + panel | **frozen this phase** |

What this deliberately avoids: a second intent classifier, an embedding service, a phrase list per
feature, client-side "smart" execution outside the planner, and any change to prompts/history/rendering
during the Response Experience work.

## 6. Implementation slices (proposed order)

| Slice | Content | Corpus targets | Files | Overlap |
|---|---|---|---|---|
| **N1 — safety + recovery** | S4a pronoun guard; S1 answer resolver (ordinal/position/symbol/label/all/dismiss); record local questions WITH choices for the model's history (outcome text only, no schema change) | ticker-09 → not WRONG; recover-01…07 resolved locally (0 → 6/7) | watchlist.js (parseTickers), new nl/answer.js, useAgent.send (1 call site) | useAgent.send ⇄ Response Experience: **coordinate** |
| **N2 — names** | S2 matcher in resolveArgs for layout/watchlist/saved-screen/template; destructive ⇒ ask | typo-06/07/08/20, ws-13, typo-13/safety-08 ask | new nl/match.js, layout.js, watchlist.js, savedScreens.js, chart.js (findTemplate) | none with Response Experience |
| **N3 — vocabulary** | S3 lexicon pre-pass (tokens only, registry-derived); subset phrasing ("only the first two") | typo 0/16 → ≥12/16; ref-13 | new nl/lexicon.js, fastPath.js (1 call) | low (fastPath not routing) |
| **N4 — tickers** | S4b/c lowercase + company names via ticker search; receipts name the resolved ticker | slang-04, ticker-01/03/04/06, typo-12 | chart.js, workspace.js, agentClient.js (read-only search helper) | none |
| **N5 — references** | S5 `recent` context provider (last change + last listed set) | ref-01/04/05/11 on the live replay | new provider module + 1 host accessor | context only; history untouched |
| **N6 — after Response Experience lands** | S8 routing hardening; S9 clarify choices | routing misses 3 → 0; G11 | routing.js, turn.py | wait for RX |
| **N7 — cross-team** | S6 indicator aliases (Indicators catalog field); S7 exclusive continuation | ind-01/11, slang-13, multi-03 | Indicators catalog; executor/runtime | Indicators; Agent planner |

Each slice: corpus cases flip from `to-model`/`WRONG` to `fast-correct`/`local-clarify`, KNOWN_WRONG only
shrinks, the Agent gate suites stay green, and (after N5) the live replay set is re-scored.

## 7. Ownership and integration boundaries

| Area | Owner | This phase | NL slices |
|---|---|---|---|
| `agent/nl/*` (answer, match, lexicon) — new, pure | Context & Awareness | — | owns |
| corpus + `agentNlCorpus.test.js` | Context & Awareness | **added (standalone)** | owns |
| capability modules (`capabilities/*.js`) `fast` / `resolveArgs` / `prepare` | Agent (ack per item, as in Phase 1) | untouched | N1–N4 edits with ack |
| `fastPath.js` (one lexicon call) | Agent | untouched | N3 with ack |
| `useAgent.js` send / pending-question flow | Agent; **conversation behaviour = Response Experience** | untouched | N1 needs both |
| `routing.js` | Agent | **frozen** (owner) | N6 only |
| `turn.py` prompt, history, sanitizer; `store.py` persistence | Agent / Response Experience | **frozen** | N6 only; N1 records outcome text only |
| `AgentPanel.jsx` / rendering / UI | Response Experience | **frozen** | none planned |
| Indicator catalog aliases | Indicators | — | N7 dependency |
| Market Intelligence (breadth) | MI | — | none (breadth phrasing is model-path; routing words N6) |

## 8. Dependencies on Response Experience (exact overlap risks)

1. **`useAgent.send` and the pending-question lifecycle (N1).** Answer resolution sits at the top of
   `send`, next to the existing confirm/subset/dismiss handling. If Response Experience restructures
   `send`, pending state, or how questions/choices are rendered and recorded, N1 must land after it or
   be built against its new shape. **Highest risk.**
2. **History content of local questions (N1).** Recording "Which chart? (Left chart (NVDA) / Right chart
   (AMD))" instead of "Asked which target." changes what the model reads next turn. That is conversation
   history semantics — needs Response Experience agreement (no schema change proposed).
3. **Clarify rendering (N6/S9).** Choices for model clarifications are a UI + sanitizer change.
4. **Routing and prompt (N6).** Explicitly frozen by the owner for this phase.
5. **Reply wording.** NL slices add receipts like "Using NVDA (NVIDIA)" or "Did you mean “Swing”?" —
   wording conventions should follow whatever Response Experience establishes.
6. **No overlap:** `agent/nl/*`, capability `resolveArgs`/`prepare`, the corpus/harness, context providers.

## 9. Open decisions (owner)

1. Implicit targeting: with several charts and a fresh click selection, should a bare command
   ("switch to weekly") use the selected chart (TradingView behaviour) or keep asking (today)?
2. Auto-correction visibility: silently correct a unique typo ("weeky" → weekly) with the receipt as the
   record (recommended), or say "(taking “weeky” as weekly)"?
3. Company names: resolve a unique exact company-name match automatically and name it in the receipt
   (recommended), or always confirm?
4. Live replay of the corpus (≈ $1.90 typical, ≤ $3.15 worst on claude-haiku-4-5 at the Phase 2 pricing; cap $3.50):
   authorize when ready (EVAL-PLAN §4).
5. Sequencing with Response Experience: N2–N4 can proceed in parallel (no overlap); N1 waits for or
   coordinates with Response Experience's `send`/question changes.
