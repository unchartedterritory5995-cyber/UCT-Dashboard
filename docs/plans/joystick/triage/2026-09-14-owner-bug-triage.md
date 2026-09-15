# W3 · Triage instrument for the owner's bug list

**This is the instrument, not the findings.** Nothing here speculates about what Patrick will
report. Fill it in as items arrive.

⛔ **Everything below the checklist is MACHINE-DERIVED from `app/src/hub/registry.js` and
`app/src/hub/rolloutStage.js`** — both sides imported and enumerated, never hand-transcribed.
Re-derive rather than trusting this snapshot if either file has moved.

---

## ONE-SCREEN INTAKE CHECKLIST

For every item on the list, in order:

1. **Copy his words verbatim.** Do not paraphrase. A paraphrase is already a diagnosis.
2. **Name the mode and action from the inventory below.** If the registry does not declare it,
   the report may be about something else entirely — say so rather than forcing a match.
3. **WRONG or NOT-NICE-YET?** Wrong = the product does something other than what the registry or
   the spec says. Not-nice-yet = it does the right thing and the right thing feels bad.
   **Only WRONG can block stage 2.**
4. **Does it reproduce on the stage-1 build LIVE RIGHT NOW?** YES / NO / **UNTESTED**.
   ⛔ UNTESTED is not a pass. A YES is an **H14 check-the-live-build item**, not a queue item.
5. **Would it be member-visible after stage 2?** Use the visibility delta — at stage 1 only
   admins have the hub, so a defect can be live and invisible today and member-visible the
   instant stage 2 lands.
6. **Blocks stage 2?** Yes only if (WRONG) **and** (member-visible after stage 2).
7. **Owner ruling needed?** Anything where the registry and his expectation disagree is a ruling,
   not a bug — route it to him rather than deciding it.

⛔ **The asymmetry that makes this worth doing:** *not reproducible today* does **not** mean *not
a stage-2 problem*. Today the hub reaches admins only.

---

## 1 · Registry inventory — 10 modes, 62 actions

Derived by importing `registry.js` from `launch/stage-2-member-preview` and enumerating
`modes` / `fanFor()`. `validateRegistry()` returns **0 problems** on both master and the branch.

⭐ **`journal.close` is the ONLY `flickable: false` action in the entire registry.** A report that
"the flick did nothing" on that action is **correct behaviour**, not a bug. Everywhere else a
flick firing is correct.

⚠️ **`catalysts` declares no `route`** — it is claimed by a Dashboard tile, not derived from the
URL. That is why a market holiday (no tile) makes the hub fall back to the route-derived mode.

| OUTER_MAX | INNER_MAX | HUB_REQUIREMENTS | FLICK_GUARDABLE_KINDS |
|---|---|---|---|
| 5 | 4 | `symbol, position, list, flagged, chart` | `confirm, run` |

Action tally: `run` 32 · `navigate` 17 · `home` 9 · `confirm` 4 — rings OUTER 30 / inner 32 —
`escalate` on 7 — `requires` on 25 (`symbol` 19, `position` 4, `chart` 2).

| mode | route | tapHint | cursor | action | kind | ring | flickable | escalate | requires |
|---|---|---|---|---|---|---|---|---|---|
| `breadth` | `/breadth` | tap: next tab | — | `breadth.voice` | run | inner | ✅ | — | — |
|  | | |  | `breadth.home` | home | inner | ✅ | — | — |
| `calendar` | `/calendar` | tap: next day | `calendar` | `calendar.macro` | run | OUTER | ✅ | — | — |
|  | | |  | `calendar.myNames` | navigate | OUTER | ✅ | — | — |
|  | | |  | `calendar.voice` | run | inner | ✅ | — | — |
|  | | |  | `calendar.home` | home | inner | ✅ | — | — |
| `catalysts` | — *(no route)* | tap: next row | `catalysts` | `catalysts.chartIt` | navigate | OUTER | ✅ | — | `symbol` |
|  | | |  | `catalysts.flag` | run | OUTER | ✅ | — | `symbol` |
|  | | |  | `catalysts.why` | navigate | OUTER | ✅ | — | `symbol` |
|  | | |  | `catalysts.filter` | run | inner | ✅ | — | — |
|  | | |  | `catalysts.note` | run | inner | ✅ | — | `symbol` |
|  | | |  | `catalysts.voice` | run | inner | ✅ | — | — |
|  | | |  | `catalysts.home` | home | inner | ✅ | — | — |
| `chart` | `/charts` | tap: next timeframe | — | `chart.planTrade` | run | OUTER | ✅ | — | `symbol` |
|  | | |  | `chart.alert` | confirm | OUTER | ✅ | ⚠️ | `symbol` |
|  | | |  | `chart.flag` | run | OUTER | ✅ | — | `symbol` |
|  | | |  | `chart.draw` | run | OUTER | ✅ | — | `chart` |
|  | | |  | `chart.compare` | run | OUTER | ✅ | — | `chart` |
|  | | |  | `chart.logTrade` | run | inner | ✅ | — | `symbol` |
|  | | |  | `chart.note` | run | inner | ✅ | — | `symbol` |
|  | | |  | `chart.voice` | run | inner | ✅ | — | — |
|  | | |  | `chart.home` | home | inner | ✅ | — | — |
| `flow` | `/options-flow` | navigate only | — | `flow.voice` | run | inner | ✅ | — | — |
|  | | |  | `flow.home` | home | inner | ✅ | — | — |
| `home` | `/dashboard` | tap: last section | `home` | `home.scan` | navigate | OUTER | ✅ | — | — |
|  | | |  | `home.chart` | navigate | OUTER | ✅ | — | — |
|  | | |  | `home.breadth` | navigate | OUTER | ✅ | — | — |
|  | | |  | `home.wire` | navigate | OUTER | ✅ | — | — |
|  | | |  | `home.flow` | navigate | OUTER | ✅ | — | — |
|  | | |  | `home.journal` | navigate | inner | ✅ | — | — |
|  | | |  | `home.notebook` | navigate | inner | ✅ | — | — |
|  | | |  | `home.calendar` | navigate | inner | ✅ | — | — |
|  | | |  | `home.voice` | run | inner | ✅ | — | — |
| `journal` | `/journal/trades` | tap: next position | `journal` | `journal.chartIt` | navigate | OUTER | ✅ | — | `symbol` |
|  | | |  | `journal.moveStop` | run | OUTER | ✅ | ⚠️ | `position` |
|  | | |  | `journal.breakeven` | run | OUTER | ✅ | ⚠️ | `position` |
|  | | |  | `journal.close` | run | OUTER | ⛔ **false** | ⚠️ | `position` |
|  | | |  | `journal.planTrade` | run | inner | ✅ | — | `position` |
|  | | |  | `journal.note` | run | inner | ✅ | — | `symbol` |
|  | | |  | `journal.voice` | run | inner | ✅ | — | — |
|  | | |  | `journal.home` | home | inner | ✅ | — | — |
| `notebook` | `/journal/notebook` | tap: next note | `notebook` | `notebook.newNote` | run | OUTER | ✅ | — | — |
|  | | |  | `notebook.voiceNote` | run | OUTER | ✅ | — | — |
|  | | |  | `notebook.linkTicker` | confirm | OUTER | ✅ | ⚠️ | — |
|  | | |  | `notebook.templates` | confirm | OUTER | ✅ | ⚠️ | — |
|  | | |  | `notebook.dailyPlan` | navigate | inner | ✅ | — | — |
|  | | |  | `notebook.postMortem` | navigate | inner | ✅ | — | — |
|  | | |  | `notebook.voice` | run | inner | ✅ | — | — |
|  | | |  | `notebook.home` | home | inner | ✅ | — | — |
| `scan` | `/screener` | tap: next result | `scan` | `scan.chartIt` | navigate | OUTER | ✅ | — | `symbol` |
|  | | |  | `scan.flag` | run | OUTER | ✅ | — | `symbol` |
|  | | |  | `scan.alert` | confirm | OUTER | ✅ | ⚠️ | `symbol` |
|  | | |  | `scan.planTrade` | run | OUTER | ✅ | — | `symbol` |
|  | | |  | `scan.scans` | run | inner | ✅ | — | — |
|  | | |  | `scan.why` | navigate | inner | ✅ | — | `symbol` |
|  | | |  | `scan.voice` | run | inner | ✅ | — | — |
|  | | |  | `scan.home` | home | inner | ✅ | — | — |
| `wire` | `/morning-wire` | tap: next segment | `wire` | `wire.chartIt` | navigate | OUTER | ✅ | — | `symbol` |
|  | | |  | `wire.flag` | run | OUTER | ✅ | — | `symbol` |
|  | | |  | `wire.note` | run | OUTER | ✅ | — | `symbol` |
|  | | |  | `wire.voice` | run | inner | ✅ | — | — |
|  | | |  | `wire.home` | home | inner | ✅ | — | — |

---

## 2 · Stage-1 vs stage-2 visibility delta

Derived from `rolloutStage.js` on both sides. **Nothing here is a threshold retyped** — these are
the functions' own answers.

| question | stage 1 (live now) | stage 2 (branch) |
|---|---|---|
| `ROLLOUT_STAGE` | **1** | **2** |
| `unsetDefault({isAdmin: true})` | `true` | `true` |
| `unsetDefault({isAdmin: false})` | **`false`** | **`true`** ← the widening |
| `cardVisible` admin, never chose | `true` | `true` |
| `cardVisible` member, never chose | **`false`** | **`true`** |
| `cardVisible` member, ever chose | `true` | `true` |
| `PREVIEW_MODES` | `['home', 'flow']` | **`[]`** (empty) |
| `PREVIEW` | `true` | `false` |

⛔ **An explicit stored preference always wins at both stages, in both directions.**
`unsetDefault` is consulted **only** when nothing is stored. A member who has chosen OFF stays OFF
at stage 2; a member who chose ON already has it.

### Who sees the hub

| account | stage 1 | stage 2 |
|---|---|---|
| admin, no stored preference | **sees it** | sees it |
| member, no stored preference | does not see it | **sees it** ← the whole change |
| member, stored `true` | sees it | sees it |
| member, stored `false` | does not see it | **still does not** |
| signed-out visitor | n/a — the Settings route is behind `AuthGuard` | n/a |

### What changes on the glass

| surface | stage 1 | stage 2 |
|---|---|---|
| chip hint, `home` and `flow` | **"Preview — more coming"** | each mode's **real tap hint** |
| chip hint, all other modes | real tap hint | unchanged |
| Settings label | `Joystick shortcuts (preview)` | unchanged — **this is what carries the preview framing at stage 2** |
| `home` fan | 9 bubbles | **9 bubbles** — none added, none removed |
| `home.wire` | inner | **OUTER** |
| `home.journal` | OUTER | **inner** |
| `home.calendar` | inner | inner — **survives** |
| `flow` fan | `[flow.voice, flow.home]` | identical — a **measured** no-op |

⭐ **`home` is the only fan whose geometry moves**, and it moves by exactly two bubbles swapping
rings. If a report is about where a Home bubble sits, check which stage he was on.

⚠️ **This interacts with row D1 of `owner-run.md`**, which asks whether the **Wire** bubble can be
told from the **Journal** bubble by sight — the two that swap. A D1 answer collected at stage 1
describes a layout stage 2 changes.

---

## 3 · Per-item triage template

Copy this block once per reported item. Leave nothing blank; `UNTESTED` and `UNKNOWN` are real
answers, a blank is not.

```markdown
### ITEM <n> — <short handle>

**Verbatim (his words, unedited):**
>

**Mode / action (from the inventory):**  `<mode>.<action>`  ·  or `NOT IN REGISTRY — see note`

**WRONG or NOT-NICE-YET:**  <WRONG | NOT-NICE-YET>
**Why, in one sentence:**  <what the registry/spec says vs what happened>

**Reproduces on the LIVE stage-1 build:**  <YES | NO | UNTESTED>
  - measured how: <the probe, with its control>
  - ⛔ UNTESTED is not a pass.

**Member-visible after stage 2:**  <YES | NO | UNKNOWN>
  - reason, from the visibility delta: <...>

**Blocks stage 2:**  <YES | NO>   (YES only if WRONG *and* member-visible after stage 2)

**H14 — live hazard class?:**  <YES -> check the live build NOW | NO>

**Owner ruling needed:**  <YES — question: ... | NO>

**Filed as:** <D-nn | R-nn | 71-open-items-proposals.md | none yet>
```

---

## 4 · Reproduction protocol on the LIVE stage-1 build

⛔ **The smoke account is the only account automation may sign in as**, and it is currently a
clean control (`joystick_hub` unset — `tools/smoke_reset.py`, step 0 and final step).
**At stage 1 the hub is visible to it ONLY because it is admin.** Never let that become "the hub
was visible, so members can see it".

### PRESENT IS NOT SHOWING

`HubRoot` keeps its container in the DOM and sets the HTML `hidden` attribute, so a
`querySelector` presence check answers *"did React render the container"*, never *"can a member
see it"*. To claim visibility, measure **all** of:

```js
const el = document.querySelector('[data-testid="hub-root"]')
const cs = el && getComputedStyle(el)
const r  = el && el.getBoundingClientRect()
;({ found: !!el, hidden: el && el.hidden, display: cs && cs.display,
    visibility: cs && cs.visibility, w: r && Math.round(r.width), h: r && Math.round(r.height) })
```

⛔ `offsetParent === null` proves **nothing** — the hub is `position: fixed`, so that is null while
it is plainly on screen.

### Assert user-facing TEXT, not structural state

Two toasts shipped broken with every structural assertion green: one passed `message` where the
component reads `msg` (rendered blank), and both were owned by the element their own action
unmounts (rendered for zero frames). **Read the rendered string.**

### Every probe carries a control

A probe that returns "fine" for everything is reporting a property of itself. Before recording an
absence, show the probe returning the other answer on a case where the thing is present.

⚠️ **Preferences come back as a JSON STRING** from `/api/auth/preferences` —
`j.joystick_hub.enabled` is `undefined` by construction. Parse first, or a fiction gets recorded.

### Anything you change, change back

The smoke account must end as it started. `tools/smoke_reset.py` is the final step, and the run
is not finished until it exits 0.

---

## 5 · ⛔ THE TRANSPORT CAVEAT — inline, so it cannot be forgotten mid-triage

**A BrowserStack Live mirror has a measured floor of 260–427 ms per gesture, against
`FLICK_MS = 120`.** Therefore, on a mirror:

- **flick is UNMEASURABLE** — not "slow", not "failing". The transport cannot produce the input.
- **hold and scrub are INCONCLUSIVE-TRANSPORT by construction** — the mirror cannot hold a press.
- Shrinking the drag does **not** help: the cost is per pointer-event round trip, not per pixel.
- Synthetic pointer events dispatched onto the mirror canvas are **silently discarded**.

**INCONCLUSIVE is recorded as neither a pass nor a failure**, and it must never trigger a
rollback. If an item's reproduction needs a flick, a hold or a scrub, the answer on a mirror is
INCONCLUSIVE-TRANSPORT and the item stays open pending a real device — it is **not** closed as
"could not reproduce".

⭐ **What a mirror IS good for:** anything untimed — does it render, where is it, does it resolve
the right target, does the label say the right thing. Route every timing question to a real finger.
