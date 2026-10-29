# UCT Agent → Indicators: live-test findings (2026-10-28)

The owner tested the Agent in production. One failure involves the Indicators authoring subsystem, and the new end-to-end test found two naming issues. None of this changes an Indicators-owned file. The Agent-side fixes are on branch `feat/agent-operator-autoapply`.

> **Update (production test, 2026-10-28, after #486).** The same request in production showed a Proposed-changes card, and its Apply answered "I can’t check that approval any more". That was the **Agent's** approval state, not the builder: the model proposed the build, and the card's new-draft Save had no seal. Fixed Agent-side on branch `fix/agent-indicator-create` (CHARTS-OPERATOR-PLAN, "Custom-indicator creation"). No Indicators-owned file changes. Whether the builder's model refuses this request live (§1 below) is still unconfirmed until its telemetry is read and an authenticated test succeeds.

---

## 1. "Create a custom indicator … EMA percentage difference … separate pane" — refused

**Request (verbatim):**

> Create a custom indicator that shows the difference between the 9 EMA and 20 EMA as a percentage and put it in a separate pane.

**What the member saw:**

> The indicator builder couldn’t do that — nothing was saved.

That is the Agent's generic sentence for `turn-refused` with a gate that has no sentence of its own.

**What was checked, without a model call:**

| Stage | Result |
|---|---|
| Agent orchestration | `indicator.draft` sends the member's words verbatim with the chart's symbol and timeframe, the same input the Create Indicator dock sends. |
| Browser preflight (`localTurn`) | passes |
| Server preflight (`conversation_preflight.check`) and planner (`dc.plan`) | pass: understood, nothing "not understood", nothing unavailable |
| A correct change, `create {placement: 'pane', outputs: [{tree: (ema9 − ema20) / ema20 × 100}]}`, through the real `/converse` gates (scripted model) | `ok`, `turn: patch`, first attempt |
| The same change through the real engine (`applyTurn`) | applied |
| The Agent's save, chart add and own-pane placement with that answer | works end to end (`agentOperatorLive.test.jsx` L4) |

**Conclusion.** The deterministic path accepts this request and the correct formula. The refusal came from what the builder's model returned on the live call. That answer was refused after its one repair: most likely `envelope:schema`, `converse:unchecked` or `unsupported:node`, or an engine `schema:*` refusal of the change.

**Two shapes found locally that produce exactly that refusal:**
- `placement: 'separate'` (the member said "separate pane"), refused with `schema:enum … expected one of pane, price`.
- `set_levels` / `set_style` with field names outside the patch schema (`levels`, `plot`).

The production gate is recorded in the `converse_turn` telemetry row (`outcome`) for 2026-10-28, admin turns. It needs an admin read; the Agent session could not sign in.

**Needed from Indicators:**
1. Read the 2026-10-28 `converse_turn` rows for this turn and confirm the gate.
2. Run the request above through your own evaluation. If the model writes a placement or field the schema refuses, the fix belongs in the builder's prompt, schema description or repair diagnostic. For example: "a separate / own / new pane" is `placement: 'pane'`.
3. No contract change is needed for the workflow. The Agent already drives draft → save → add to chart → pane through the existing interfaces.

**Already fixed on the Agent side (this branch):**
- A refusal now says what failed:
  - the builder's own reason, when it gives a specific one;
  - otherwise, for a malformed answer: "The indicator builder’s answer wasn’t a valid indicator, so nothing was saved. Try asking again, or describe the calculation step by step."
- The gate code stays in the outcome record only.
- "Create a custom indicator that …" now builds, saves and adds the indicator in one go (R1, all of Indicators' conditions still checked).

## 2. The confirmed add receipt carries a cut-off name

After saving the indicator above, `confirmIndicatorMutation`'s receipt `name` was `(EMA 9 −`, a short name cut inside the formula. The Agent's receipt reads "Added (EMA 9 − on Chart (QQQ)." The Agent's one-line summary avoids it by using the saved name, but the line itself shows Indicators' name.

**Needed:** a short name that is never cut mid-expression. Fall back to the full name, or to a word boundary outside parentheses.

## 3. Derived names read like formulas; the model's own name is dropped

The builder's `create.name` (`EMA 9/20 % Diff`) was replaced by a name derived from the formula, `(EMA 9 − EMA 20) ÷ EMA 20 × 100`. The Agent never puts formula-like names in chat (`looksLikeFormula`, which now also catches `− × ÷`), so the member reads "your indicator".

**Suggested:** keep a descriptive model name when the member gave none, or derive a descriptive one, e.g. "EMA 9/20 % difference".
