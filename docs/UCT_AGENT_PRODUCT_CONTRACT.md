# UCT Agent Product Contract

**Status:** canonical product specification. **Owner of the behaviour:** the site owner. **Maintained by:** the UCT Agent Program Lead. Current progress does not live here; this file says what correct behaviour is.

UCT Agent is, in priority order:

1. A fast natural-language operator and interactive guide for the entire UCT Intelligence website.
2. An expert market research assistant.
3. An opt-in personalized trading coach.

A change that conflicts with this contract is a defect or needs an owner decision. A behaviour counts as delivered only when it has been verified in the environment the owner uses, not when a PR merges or tests pass.

## Foundational principle: generalization first

UCT Agent is a general-purpose operator grounded in UCT's actual capabilities, not a collection of programmed sentences. Owner examples demonstrate a capability family; they are not the boundary of the feature.

- **Compose, don't enumerate.** If the underlying system supports the primitives, the Agent combines them without new application code for each combination.
- **Fix the reusable layer.** When a request fails, find the root cause first: capability, metadata, schema, interpretation, target resolution, planner composition, UI state, validation, an unsupported primitive, guide metadata, data access or read-back. A handler for one sentence is not a fix.
- **Prove the family.** A fix is tested with the original request, other phrasings, other parameters, other combinations, negative cases, and held-out requests not used to design it.
- **Never pretend.** A genuinely missing primitive is said to be missing, never silently substituted, and is added through the canonical system.
- **Stay constrained.** The model may reason about intent and composition, but execution stays on supported, validated UCT operations, within existing spending limits.

### Explain, teach, do

| Mode | Example | Behaviour |
|---|---|---|
| Explain | What is RSI? | Answers in chat |
| Teach | How do I add RSI? | Visual walkthrough on the real controls |
| Do | Add RSI to this chart. | Executes through the canonical interface |

Natural variations reach the right mode without an extra question when intent is clear. A user can cancel a walkthrough or switch from teach to do.

### Visual teaching

The existing "Changing the timeframe" guide is the visual reference: gold outline on the real control, a floating dark panel, a step counter, and Next and Close. Teaching uses one shared engine with registered control ids, validated task paths and flexible understanding. It never invents controls or click sequences.

A walkthrough must read the current UI state and start at the relevant step, advance when the user completes a step where supported, recover from unexpected state, and allow forward, back, cancel and restart. The overlay must not cover the control the user needs. Written instructions are not teaching coverage.

## Roadmap sequence

The owner has set this order. It takes precedence over any other prioritization.

| Phase | Goal | Agent location |
|---|---|---|
| 1. Charts mastery | The Agent can do every meaningful action a human can do in the Charts workspace | Charts |
| 2. UCT information access | The Agent knows everything UCT Intelligence knows that it is authorized to use: Morning Wire, UCT Terminal, Breadth, market data, news, financials, calendars, historical information and other existing resources, through canonical data services | Charts |
| 3. Other workspaces | The mature Agent operates other UCT workspaces and sections | Rest of the website |

No worker is assigned to a later phase's main work until the earlier phase is substantially complete. Already working research capabilities are preserved during Phase 1, and improvements keep shipping throughout.

### Phase exit criteria

A phase is substantially complete when all of its criteria pass with evidence.

**Phase 1**
- A code-derived inventory of Charts human actions exists, and every row has a status.
- Every P0 action, and at least 90% of P1 actions, is proven by an outcome test that checks resulting state, not by a registry entry. Exclusions are listed with a reason.
- C1, C2, C3 and C4 pass on production, verified by the owner or by a live admin test.
- A multistep regression set of real Charts workflows passes with no wrong-target action and no false receipt.
- Simple local commands have a measured median against the speed targets, and any miss is explained.
- Execution coverage and visual teaching coverage are tracked separately. Teaching is VERIFIED only by a walkthrough working in a real browser. Both approach full coverage of supported actions, and every exclusion has a recorded reason.
- Held-out generalization tests pass for each capability family, including prompts not used in design.

Coverage is reported as verified actions over discovered human actions, by feature area. The denominator counts actions, not phrasings, and may grow as the inventory finds more. Registered capabilities, PRs and commits are not coverage.

Action states: UNMAPPED, MISSING, IMPLEMENTED / UNVERIFIED, VERIFIED, BLOCKED. VERIFIED needs a browser test, authoritative state read-back or equivalent end-to-end evidence, never source inspection alone.

Phase 1 acceptance tasks, a starting set that grows with the inventory:

| ID | Prompt | Pass |
|---|---|---|
| A | Change this chart to NVDA daily. | Correct chart, symbol and timeframe, concise confirmation |
| B | Create four equal-sized charts showing SPY, QQQ, NVDA, and TSLA. | Correct layout, equal sizing, correct symbols, verified state |
| C | Apply my usual indicators to all four charts. | Uses actual saved preferences or asks one targeted question |
| D | Create a watchlist of these tickers and save this layout. | Whole workflow completes without unnecessary confirmation |
| E | Show me how to create a watchlist. | Complete, cancelable, interactive tutorial in the real interface |
| F | Add RSI and change its appearance. | Canonical indicator APIs; natural follow-ups work |
| G | Make the top-left chart a weekly chart. | Spatial reference resolved correctly |
| H | Undo that last change. | The supported action reverts correctly |
| I | Find stocks matching these technical conditions. | Existing scanning infrastructure; accurate results |
| J | Build an indicator that does this. | Existing custom-indicator engine; unsupported conditions reported honestly |

**Phase 2**
- Each authorized UCT information source is either reachable from the Charts Agent through a canonical service or listed with the licensing or data reason it is not.
- C5, C6, C7, C8 and C9 pass on production with grounded answers.
- Research leaves the workspace unchanged, and no restricted content reaches the model.

**Phase 3**
- Each in-scope workspace has at least one useful end-to-end action and a tutorial. Navigating to a page does not count as coverage.
- C10 passes on each one.

## 1. Global rules

These apply to every scenario in section 3.

| ID | Rule | How it is checked |
|---|---|---|
| G1 | Never claim success when any part of the execution failed. A partial failure names what landed and what did not. | Receipt compared with read-back state |
| G2 | Never fabricate financial data, catalysts, historical results or receipts. | Every figure traces to a gateway read; unsupported ones are absent or marked not known |
| G3 | Never act on the wrong target. An unclear target asks; it does not guess. | Target check against the board before and after |
| G4 | Use canonical UCT interfaces. No DOM control and no competing implementation of a feature. | Capability goes through the feature's own writer |
| G5 | Research and answers leave the workspace unchanged unless a change was requested. | Layout and chart state identical before and after |
| G6 | Simple actions get short replies. Research gets richer visual output. | Reply length and view type |
| G7 | Understand conversational follow-ups. | Follow-up set in regression tests |
| G8 | Stay within licensed data boundaries and existing cost limits. | Licensing class of each source; budget ledger |
| G9 | Admin-only access stays enforced on the server. | Server auth tests |

### Permissions

| Request type | Behaviour |
|---|---|
| Explicitly requested, non-destructive | Execute without confirmation |
| Deletion | Requires approval |
| Destructive overwrite, other materially consequential action | Appropriate protection: approval, create-only, or a refusal with an alternative |
| Partial failure | Report truthfully under G1 |

### Status indicators

| State | Shown when | Rule |
|---|---|---|
| `UCT Agent is working` | The Agent is performing website actions | Driven by real execution state, never by a timer |
| `typing` | The Agent is generating a conversational response | Driven by real generation state |
| `Online` | Idle | Returned to after success, failure and cancellation |

### Speed targets

Targets are not achievements. A number may be reported only from measurement.

| Class | Target | Measured as |
|---|---|---|
| Simple local command | Under 1 s, where technically feasible | Send to verified completion (`verified_ms`) |
| Complex command | Meaningful visible progress in about 1 s | Send to first visible feedback (`visible_ms`) |
| Research | Starts responding promptly; more time is allowed for real computation or retrieval | `visible_ms`, then time to the finished answer |

Every speed report includes first visible feedback, model latency, verified action completion, model rounds and error rate.

## 2. Test format

Each scenario gives one owner-usable prompt. **Pass** lists what must be observed. **Fail** lists what must not happen. The prompt is an example of a class, so phrasings with the same meaning are held to the same result. Passing depends on behaviour, not on exact wording, except where text is quoted as the expected form.

## 3. Scenarios

### C1. Command

> Switch this chart to NVDA daily.

- **Pass:** executes immediately. The selected chart shows NVDA on the daily timeframe. Reply is concise, in the form "Chart changed to Nvidia daily." Undo is available.
- **Fail:** explains the process; asks for confirmation; changes another chart.
- **Speed:** simple local command.

### C2. Multi-action workflow

> Open four charts, arrange them 2×2, set their symbols, and apply indicators.

- **Pass:** work starts promptly. `UCT Agent is working` shows during execution and `typing` only while generating a conversational response. The entire workflow is executed. One concise, truthful completion receipt appears. No approval is requested for these non-destructive changes.
- **Fail:** stops after the first step; asks for routine approval; reports a step that did not land.
- **Speed:** complex command.

### C3. Teaching

> Show me how to create a watchlist.

- **Pass:** reuses UCT's existing interactive tutorial system. The actual website controls are highlighted. Guidance appears on-screen in context, not as a long chat explanation. The tutorial can be canceled at any time. If a control disappears, the tutorial says so and stops.
- **Fail:** a long chat explanation; a competing tutorial framework; a highlight on the wrong control; changes made for the user during a show-me.

### C4. Ambiguous instruction

> Make my charts look better.

- **Pass:** uses known preferences where reasonable. Asks a concise clarifying question when important preferences are unavailable.
- **Fail:** arbitrary destructive changes; a long questionnaire.

### C5. Market research

> Why is NVDA up 6%?

- **Pass:** checks for relevant verified catalysts. Checks sector-wide and sympathy moves. Separates evidence from interpretation. Says what is not known. Sources are dated.
- **Fail:** an invented explanation; interpretation shown as fact; workspace changes.

### C6. Historical analysis

> How often did the S&P 500 gain more than 2% after falling 3%?

- **Pass:** uses authorized historical data and accurate calculation. Shows a clean table of dates and occurrences, relevant charts, and a short written summary. The workspace is unchanged.
- **Fail:** figures not computed from stored data; an unauthorized data source; opened or modified charts.

### C7. Comparison

> Compare NVDA, AMD, and AVGO.

- **Pass:** clean visual rankings or tables with a concise written assessment.
- **Fail:** automatically opens or modifies charts.

### C8. Natural-language scan

> Find stocks above their 9 and 20 EMAs with volume twice average and ADR above 4%.

- **Pass:** matching stocks appear in chat with accurate counts and source grounding. The Agent offers to create a persistent UCT screener.
- **Fail:** workspace changes without a request; a wrong filter sign or sector; an invented statistic.

### C9. Personalized brief

> Give me my morning brief.

- **Pass:** delivers a useful default brief. The user can customize it conversationally. Appropriate account-level preferences are retained for future briefs.
- **Fail:** customization that disappears next time; preferences stored beyond what is appropriate.

### C10. Website-wide control (Phase 3)

> Any action a person can take on a UCT page, requested from that page.

- **Pass:** the Agent performs it through that page's canonical interface, or says plainly that it cannot yet. New UCT features integrate through the capability registry and page hosts.
- **Fail:** claiming a capability that does not exist; a second control architecture.

### C11. Monitoring

> Tell me when NVDA gets back above its 20 EMA.

- **Pass:** the request becomes a persistent monitor on existing alert infrastructure, and the receipt says what will fire and how.
- **Fail:** a promise with nothing persisted; a competing alert engine.

### C12. Screenshots

> Here is a chart screenshot. Rebuild this.

- **Pass:** states what it saw, what it inferred, and what it could not tell. Reuses the indicator builder's screenshot pathway where applicable.
- **Fail:** presents an inference as a reading of the image.

### C13. Coach

Coach and Brain behaviour stays off until each feature meets its own correctness and authorization requirements. Removing a dark launch is not a sufficient reason to enable them.

## 4. Changing this contract

Product behaviour changes need the owner's decision. Routine engineering choices that satisfy this contract do not.
