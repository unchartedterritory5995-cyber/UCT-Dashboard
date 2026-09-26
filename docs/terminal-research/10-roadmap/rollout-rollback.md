---
id: H-07
title: Rollout and rollback — the five rungs Terminal-Next ships on, the six tiers it comes back on, and the two levers that are not in any inventory
role: >
  The rollout-strategy deliverable, rollback included. MASTER_CHECKLIST item 37, gate
  item 37 (`10-roadmap/rollout-rollback.md`, owner H-07). It is a synthesis, not an
  invention: this repo has shipped three different rollout shapes and performed every
  rollback tier below at least once, and wrote down what happened each time.
wave: 4
group: H
category: rollout-plan
inputs: >
  `C:\Users\Patrick\uct-worktrees\_merge-master\CLAUDE.md` (read 2026-09-25, file mtime
  2026-09-25 11:49) — H14 §3003-3049, H15 §3051-3079, FLAG-FIRST ROLLBACK §2074-2091,
  `HUB_PREVIEW_ENABLED` §2591-2617, the two Notebook levers §3658-3714, `--set` measured
  both ways §3716-3779, the queue discipline §3204-3303, the bars push feed §1496-1544,
  the joystick exposure section §1716-1762, `DESK_PUBLIC_SHOWS` §5279-5325 ·
  `docs/runbooks/deploy-windows.md` (mtime 2026-09-25 13:21) ·
  `docs/plans/joystick/rollback-runbook.md` · `docs/breadth/deploy-gate-v2.md` §5.1e ·
  `docs/feature_flags.json` (mtime 2026-09-25 21:06) · `tools/flag_ledger_audit.py` ·
  `tools/pre_push_guard.py` · `tools/hub_nav_smoke.py` ·
  `api/services/feature_flag_index.py` · `api/routers/auth.py` ·
  `app/src/hub/rolloutStage.js` · `app/src/hub/registry.js` ·
  `app/src/components/StockChart.jsx` · `.github/workflows/master-deploy-gate.yml` ·
  `.github/workflows/promote-production.yml` · sibling research documents: gate item 24
  `07-technical-architecture/realtime-performance-architecture.md` §2.4, gate item 23
  `09-security-licensing-cost/security-entitlement-architecture.md` §3.4, gate item 25
  `10-roadmap/observability-plan.md` frontmatter, `12-decisions/DECISION_CARDS_2026-09-26.md`
  CARD 17, `10-roadmap/2026-09-23-one-week-execution-roadmap.md` §6,
  `10-roadmap/2026-09-24-go-live-packet.md` §2a.
scope: >
  Source read READ-ONLY in the sibling worktree
  `C:\Users\Patrick\uct-worktrees\_merge-master`; nothing written there. ⛔ NO git command
  of any kind was run (another session owns the commit) — every place a SHA belongs says
  so. ⛔ NO network request, NO `railway` command, NO production call, NO test, NO repo
  script; in particular `tools/flag_ledger_audit.py` was READ and never RUN, which is why
  §1.1's flag states are claims about an artifact and not about the pod. One file written:
  this one. `05-product-strategy/feature-opportunity-backlog.md` and
  `10-roadmap/testing-plan.md` are being written concurrently by other agents and were not
  touched or read.
confidence: >
  🟢 high on every `file:line` — each was opened at that offset, not grepped-and-assumed.
  🟢 high on the two structural findings (§1.1 the inventory cannot see a kill switch;
  §1.6 a revert no longer deploys by itself), both read straight out of source and
  workflow YAML. 🟢 high on the three rollout shapes and the four tiers — each is a
  shipped mechanism with its own file. 🟡 on anything about what is SET in production
  today: no Railway read was available, so each flag state is quoted from
  `docs/feature_flags.json` at its mtime 2026-09-25 21:06 and labelled as a claim about
  that file. 🟡 on the member population (26, measured 2026-09-12 per CLAUDE.md:2560) —
  thirteen days old at write time and the direction of error matters, so §2 uses it as an
  order-of-magnitude argument and never as an arithmetic input.
evidence_ceiling: >
  ⛔ No flag was read live, no flip was performed, no rollback was rehearsed, and no smoke
  was run by this document. It establishes which levers EXIST, what each COSTS and what it
  REACHES, from source; it establishes nothing about the pod's current configuration. ⛔ No
  git command, so no claim here is pinned to a SHA this session verified — SHAs appearing
  below are quoted from artifacts and labelled as such. ⛔ The `--set` restart question is
  carried unresolved on purpose (§1.5): two measurements, both real, and the repo
  explicitly forbids re-litigating it from one data point. ⛔ Whether
  `tools/flag_ledger_audit.py` runs clean today is outside this document; it is read as
  source, and its own docstring's blind spot is quoted rather than tested.
status: draft
---

# Rollout and rollback for Terminal-Next (H-07, gate item 37)

## 0. Headline — three conclusions

**⭐⭐ 1. The two levers a rollback actually pulls are the two levers no inventory can
see.** `docs/feature_flags.json` is the repo's only flag inventory, and the gate list it
is held to is derived by AST through `needs_declaration()`, which is `not defaults_on()`
(`api/services/feature_flag_index.py:396-407`). A kill switch defaults **ON**, so
`defaults_on()` is true, so `needs_declaration()` is false, so **a kill switch is outside
the ledger by construction**. Measured on the file as of its mtime 2026-09-25 21:06:
`HUB_PREVIEW_ENABLED` — the lever H15 step 1 names as the rollback
(`CLAUDE.md:3064-3066`) — occurs **0 times** in it, and `NOTEBOOK_OFFLINE_DEFAULT_ON` —
the fast Notebook lever (`CLAUDE.md:3666-3674`) — occurs twice, both times inside a
*note*, never as a key. Its four enablement-gate siblings ARE keys. **So the artifact a
responder would open to find the rollback lever does not contain it**, and
`tools/flag_ledger_audit.py`, which audits the ledger, cannot see it either. Terminal-Next
must not inherit that: §4 item 1 and RB-4 fix it in one line each.

**⛔⛔ 2. Since the 2026-09-16 cutover, `revert-and-push` is no longer a rollback — it is a
rollback *request*.** `web` deploys from `production`, which only the promotion workflow
advances and only after `master deploy gate` passes (`docs/runbooks/deploy-windows.md:7-20`);
`promote-production.yml:73-78` refuses to promote when the gate concluded anything but
success, and `:146-165` promotes **fast-forward only, never `--force`**. A red gate is now
a non-deploy. That is excellent for a bad merge and **actively dangerous for a rollback**,
because the one moment you need a push to land is the moment you least know what the gate
will say. The repo already invented the answer and has used it: a **pre-authored rollback
branch, pushed ahead of the incident and gated green with the flag already false** —
`rollback/notebook-offline-default-off`, which CLAUDE.md:3587-3589 records at
`3db89e205` (SHA quoted from that artifact; not pinned by me — no git by instruction).
That tier is not a nicety. For anything bundle-shaped it is **the only revert whose gate
result is known before you need it**, and §3 therefore ranks it above plain revert.

**⭐ 3. Terminal-Next cannot stage by tier and should not stage by percentage — so it
stages by cohort, then by surface.** Tier is foreclosed: *"there is one paid tier only
that is it"* (owner, 2026-09-26, `12-decisions/DECISION_CARDS_2026-09-26.md` CARD 17,
which also states *"Cohorts are not tiers"*). Percentage is foreclosed twice over, and the
second reason is the interesting one: gate item 23 §3.4 rules percentage *"⚠️ browsers,
not users … fine for a render canary, **never** an entitlement"*, and CLAUDE.md:2560
records **26 users in production** as of 2026-09-12 — a stable per-browser bucket
(`StockChart.jsx:1272-1280`) over 26 accounts yields a cohort nobody can reason about,
where the precedent it would copy ramped 0→25→100 over *~200* users
(`StockChart.jsx:1265-1268`). **The shape that fits is rung 2 of the ladder item 23
already drew, followed by the per-surface Set shape the joystick hub already ships.**

---

## 1. What this codebase already does, measured

### 1.1 One ledger, one auditor, and the hole in the middle

`docs/feature_flags.json` is the inventory. Its own `_readme` states the contract
(`docs/feature_flags.json:2-53`): *"Every feature GATE that is OFF unless something turns
it on must appear here"*, the list is *"DERIVED by AST … and never typed"*, and — the
sentence that matters most — *"This file records INTENT. It cannot see Railway, so it can
drift from reality."*

**How I counted it** (two independent readers, because one reader's bug is invisible):

| method | result |
|---|---|
| `Grep` `^    "[A-Z_0-9]+": \{` over the file | **210** entries at top nesting |
| of those, `^    "VITE_[A-Z_0-9]+": \{` | **21** |
| `Grep` `"status": "armed"` / `"dark"` / `"pending"` | **153** / **57** / **0** |
| parsing the JSON and taking `len(flags)` and `len(build_flags)` | **189** and **21** |
| `Grep` for any key containing `DISABLE` | **0** |

189 + 21 = 210 and 153 + 57 = 210, so the regex reader and the JSON parser agree. ⚠️ Two
instruments agreeing is evidence about their shared input (`CLAUDE.md:3388`) — here the
shared input *is* the artifact under measurement, so the agreement is worth exactly one
thing: neither reader mis-tokenised the file.

**The structural finding.** `needs_declaration(name, default)` returns
`not defaults_on(name, default)` (`api/services/feature_flag_index.py:407`), and its
docstring says why: *"a gate on by default is self-evidently a live decision, while a gate
off by default and set nowhere is indistinguishable from one that was forgotten"*
(`:397-406`). That reasoning is sound **about ambiguity** and it has the side effect that
the ledger's population is *enablement gates only*. `defaults_on` also treats
`*_DISABLED`/`DISABLE_*` as inverted (`:383-393`) — and zero ledger keys contain
`DISABLE`, so that branch has no representative in the file either. Consequences, each
measured above:

- `HUB_PREVIEW_ENABLED`: **0 occurrences** in `docs/feature_flags.json`. Read per request
  at `api/routers/auth.py:305-307`, default ON, polarity justified in the comment
  immediately above (`:302-304`): *"a forgotten variable indistinguishable from a
  deliberate shutdown."*
- `NOTEBOOK_OFFLINE_DEFAULT_ON`: **2 occurrences, neither a key.** Its polarity is
  declared in code instead, in a table with the reason inline
  (`api/routers/auth.py:126-137`): one kill switch `True`, four enablement gates `False`.
- The five Notebook-family *keys* the ledger does carry are
  `NOTEBOOK_OFFLINE_READ_ON`, `NOTEBOOK_CONFLICT_UX_ON`, `NOTEBOOK_ATTACHMENTS_ON`,
  `NOTEBOOK_ASK_INSERT_ON`, `NOTEBOOK_DOOR_GUARD` — i.e. exactly the gates and the mode
  flag, and not the kill switch.

⚠️ **All flag states in this section are claims about `docs/feature_flags.json` at mtime
2026-09-25 21:06, not claims about the pod.** The ledger's own prior incident is the
reason to say that so bluntly: `RESEARCH_TECHNICAL_TAB_ENABLED` was flipped ON at
2026-09-09 23:22:30 ET and verified in-process, its entry kept the merge-time `dark` state
for a day, two readers then disagreed about whether the surface was live, and a session
reading the ledger reported the live flag as a discovery
(`CLAUDE.md:3748-3761`). The entry now carries that history verbatim in its own `note`
field. ⭐ The rule extracted there is the one this document obeys throughout: *"The ledger
records INTENT and cannot see Railway; the checkpoint records WHAT HAPPENED. When they
disagree about a live flag, the checkpoint wins and the ledger is the thing that drifted."*

**`tools/flag_ledger_audit.py` is the only thing that compares the two** — read, not run.
Its four questions are declared in its own docstring (`tools/flag_ledger_audit.py:17-22`)
and implemented at `:149-167`:

| question | field |
|---|---|
| armed here but set by NO service ⇒ fiction | `claims_armed_but_unset` |
| off here but SET somewhere ⇒ undocumented decision | `claims_off_but_set` |
| off-by-default and UNDECLARED ⇒ the suite should be red | `undeclared` |
| still awaiting a decision | `still_pending` |

⛔ **All four are about PRESENCE, never VALUE**, and the tool says so at `:24-26`, with the
measured consequence at `:28-32`: it reports a clean `0/0/0/0` while **five** flags
declared `armed` with `web` in `where` read `'0'` in the live web process. Three of the
five are deliberate (the P5 flow-worker cutover); two are unexplained. ⭐ The point it
makes about itself is the one to carry: *"this tool cannot tell them apart."*

⚠️ **And the auditor was itself unrunnable, which is why the drift above went unseen
rather than unfixed.** On Windows `subprocess.run(..., text=True)` decodes the Railway
CLI's UTF-8 with the locale codec (cp1252); the first box-drawing byte killed a reader
thread and the tool reported *"could not enumerate the project's services"* — which reads
as auth or project trouble, not an encoding bug (`CLAUDE.md:3763-3770`). The fix is visible
in source today (`encoding="utf-8", errors="replace"`, `tools/flag_ledger_audit.py:187-189`).
⚰️ **A monitoring tool that cannot run is not a monitoring tool**, and it fails in the
direction that reads as an environment problem. Two further self-corrections in the same
file are worth copying rather than re-deriving: the service roster is DERIVED and a failure
to derive it **refuses** rather than falling back to a shorter list, because a partial
roster once filed a live gate as fiction and acting on it could have unset it
(`:67-78`); and an empty variable listing **refuses** rather than being called clean
(`:202-205`).

⛔ **One more class the ledger cannot see at all, and it cost 25 days.**
`DESK_PUBLIC_SHOWS` carries no `ENABLED`/`DISABLE` marker, so `is_gate()` was false for it
and the flag-ledger rail never asked about it — while the live value was the wildcard `*`
and CLAUDE.md asserted the opposite (`CLAUDE.md:5312-5316`). The repair is the shape to
imitate: an offline rail (`tests/test_visibility_flag_ledger.py`) plus the live half
(`flag_ledger_audit.py --visibility`, `:209-248`), and **a wildcard is permitted if and
only if the entry carries a dated `owner_decision`** — which the entry now does, quoting
the owner's 2026-08-19 decision reaffirmed 2026-09-13. ⭐ *"The rail records intent; it does
not veto it. A wildcard costs one dated sentence."*

### 1.2 Polarity is the whole design, and it is stated per capability

> **A kill switch defaults ON. An enablement gate defaults OFF.**

Both halves are in one table with the reason inline (`api/routers/auth.py:126-137`):
`NOTEBOOK_OFFLINE_DEFAULT_ON: True` with the comment *"kill switch — unset means ON"*, and
four `*_ON: False` marked *"enablement — unset means OFF"*. The justification is the same
one in both directions and it is about **ambiguity, not caution**: for a kill switch,
*"unset means 'not killed' — a forgotten variable must never be indistinguishable from a
deliberate shutdown"* (`:127-129`); for a gate, *"unset means 'not turned on yet'"*
(`:129-130`). `HUB_PREVIEW_ENABLED` states the identical rule at its own read site
(`api/routers/auth.py:302-304`), and production sets it to a literal `true` **deliberately,
so "on on purpose" is distinguishable from "unset"** (`CLAUDE.md:2593-2599`).

Three corollaries this repo paid for:

- ⭐ **A mode flag whose default is the safe behaviour can ship ahead of the thing it
  protects.** `NOTEBOOK_DOOR_GUARD` went to production **unset**, verified `None`
  in-process, so the guard behaved exactly as before: *"The lever exists before it is
  needed, and arming it changed nothing"* (`CLAUDE.md:2088-2091`).
- ⚠️ **A default-off flag can still fail open on the client.** Gate item 23 §1.6 records
  that the client mirror *"is not an authority, and it defaults OPEN"* — so polarity must
  be enforced where the decision is made, not where it is displayed.
- ⛔ **An exposure default is not a security boundary.** `POST /api/auth/preferences`
  accepts any `{key, value}` from any authenticated user with no validation, so a member
  can set `joystick_hub.enabled` directly; the runbook says so itself rather than claiming
  members *cannot* (`docs/plans/joystick/rollback-runbook.md:220-229`). A rollout stage
  that must actually deny access needs a server-side gate, not a preference default.

### 1.3 Three rollout shapes in one codebase — and when each is right

**(a) Percentage — `BARS_PUSH_ROLLOUT_PCT`.** `export const BARS_PUSH_ROLLOUT_PCT = 100`
(`app/src/components/StockChart.jsx:1269`). The bucket is per-browser, random once, and
**persisted**, explicitly so a browser's in/out status does not flip between renders or as
the dial ramps (`:1272-1280`). Resolution order is opt-in `'1'`, opt-out `'0'`, else
`_rolloutBucket() < PCT` (`:1282-1289`). ⭐ Three separate reverts, at three costs, named
in the comment at `:1265-1268` and in `CLAUDE.md:1533-1537`: **cohort narrow** = lower the
dial + deploy (~10 min); **full backend kill** = `STREAM_BARS_ENABLED=0` + redeploy;
**instant per-browser** = `window.__uctBarsPush(false)` from devtools, which writes
localStorage *and dispatches a same-tab event so open charts re-evaluate without a reload*
(`:1292-1300`). No-storage falls back to bucket `100` — i.e. **out** of the rollout, the
safe direction (`:1279`).
→ **Right when** the risk is capacity or render behaviour and the population is large
enough for a fraction to mean something. The comment states the coupling: each eligible
chart holds one SSE loop on the single shared event loop, *"so CHANGING this is a SCALING
step"*.
→ **Wrong for** entitlement (item 23 §3.4: browsers, not users) and wrong at n≈26.

**(b) Stage number — `ROLLOUT_STAGE`.** `export const ROLLOUT_STAGE = 1`
(`app/src/hub/rolloutStage.js:52`), with `STAGE_NAMES` beside it (`:55-59`) and two pure
predicates: `cardVisible()` (`:70-73`) and `unsetDefault()` (`:84-87`). ⛔ **A stage is a
deploy, deliberately** — a build-time constant rather than a Railway variable, *"because
each stage is meant to be a reviewed change with a member-impact paragraph and a smoke run
behind it — not something that can drift between what is deployed and what is configured"*
(`:44-46`). And ⛔⛔ the kill switch **outranks every stage**, checked first in
`useHubActive.js` (`:48-51`).
⭐ Two design decisions in that file are worth lifting wholesale. First, the two exposure
answers *"USED TO LIVE IN TWO FILES, and they had to agree by hand"* — a rollout moves them
together, because two authorities over one rollout is how a stage half-ships (`:3-8`).
Second, `cardVisible` is `isAdmin || everChose` **stage-independently**, because hiding the
card from someone already opted in would strand them ON with no way off (`:64-68`) — the
same defect as never giving them one.
⚰️ **And this file contains a live instance of the defect it warns about.** The comment
block asserts *"SO `ROLLOUT_STAGE = 2` IN TODAY'S SOURCE SHIPS THE RETIRED OPT-IN RUNG"*
(`:25`) twenty-seven lines above `export const ROLLOUT_STAGE = 1` (`:52`). A second
authority over one value, in the rollout gate itself. Worse, `:15-28` records that the
owner's 2026-09-13 ruling **renumbered the ladder** and *"the numbers DO NOT LINE UP with
what this file implements"* — ruled 2 equals code 3, and ruled 3 has no rung in the code at
all. So in this repo today, "stage 2" means two different things in two artifacts.
→ **Right when** each step is genuinely a reviewed, deployed change and you want the step
recorded in the build rather than in a variable.
→ **Carries a mandatory discipline**: a change to the stage or the exposure set *"must
arrive with regenerated artifacts in the same commit"*, byte-compared by
`hub/surfaceMatrixIsCurrent.test.js` (`CLAUDE.md:1722-1731`).

**(c) Per-surface Set — `PREVIEW_MODES`.** `export const PREVIEW_MODES = new Set([...])`
(`app/src/hub/registry.js:720`), holding `'home', 'flow'` at `:748`, with
`export const PREVIEW = PREVIEW_MODES.size > 0` derived from it rather than restated
(`:752`). The declaration argues for itself: ⛔ *"PER-MODE, NOT ONE GLOBAL BOOLEAN"*,
because the sections ship one at a time and a single flag *"would force all nine to flip
together — which would mean either shipping unfinished sections or holding finished ones
back"* (`:712-716`). ⭐ It is a **projection over the registry, never a destructive edit**
(`:703-708`), so the not-yet-exposed work stays defined and testable. **Deleting one id
from that Set is one line and can expose nineteen already-declared actions**
(`CLAUDE.md:1718-1719`) — the highest-leverage edit in the feature, and the mechanism by
which `calendar` once shipped a five-action fan into a navigation-only preview (`:726-727`).
⛔ Two of the modes still in the set are **not unfinished builds** and the comment says so
(`:740-747`): `home` keeps a curated preview fan by owner ruling, and `flow`'s real fan is
byte-identical to its preview, *"so the flag changes no bubble, only the chip."*
→ **Right when** the unit of risk is a *surface*, the surfaces ship at different times, and
they share components. That is exactly Terminal-Next's shape.

### 1.4 The rollback tiers, as practised, with what each costs

Ordered cheapest-first, which is the order `CLAUDE.md:2074-2091` insists be decided
**before** you need it — *"Order the levers before you need them, and verify each one IN THE
RUNNING PROCESS, never from `--kv`."*

| # | tier | mechanism | cost | reach |
|---|---|---|---|---|
| 0 | per-browser | a devtools call writing localStorage + a same-tab event (`StockChart.jsx:1292-1300`) | none | that browser, immediately, no reload |
| 1 | env var, no rebuild | kill switch / mode flag read per request in `_access_payload` (`auth.py:305-307`) | possibly a restart (§1.5) — never a build | each member on their next authenticated request |
| 2 | env var + redeploy | backend capability off, e.g. `STREAM_BARS_ENABLED=0` (`CLAUDE.md:1535`) | one web deploy | everyone, after the new boot |
| 3 | revert-and-push | `git revert` → `master` → gate → promote (`deploy-gate-v2.md:164-171`) | full build + the gate's verdict, unknown at incident time | on reload; an open tab keeps the old bundle |
| 4 | **pre-authored rollback branch** | pushed ahead, gated and gauntleted green with the flag already false (`CLAUDE.md:3587-3589`) | same build as tier 3, **minus the unknown** | as tier 3 |
| 5 | emergency `production` force | disable the promote workflow, force-with-lease, fix forward, re-enable (`deploy-gate-v2.md:179-191`) | owner-only, loud by design | as tier 3 |

⛔ **Tier 0 does not exist unless you build it.** It is not a platform feature; it is nine
lines in `StockChart.jsx`. A rollout that wants it must ship it with the feature.

⛔ **Tier 5's ordering is load-bearing and counter-intuitive.** *"Disabling first is
load-bearing. Leave it enabled and the next master push undoes the reset"*
(`deploy-gate-v2.md:188-189`). And a plain manual reset of `production` is **silently
undone**: the older SHA is still an ancestor of master, so the next promotion fast-forwards
straight over the rollback and re-deploys the bad commit — *"A rollback that the next green
push quietly reverses is worse than none"* (`:173-177`).

### 1.5 `--set` redeploys, `delete` does not, and the direction that looks safer fails silently

⛔ The order for the Notebook's fix-6 rollback names it in one line
(`CLAUDE.md:2081-2083`): *"`--set` REDEPLOYS; `delete` does NOT, and a deleted variable can
stay live in the process while `--kv` reports it gone."* The go-live packet turned that into
an operating instruction for a real flip: **prefer `--set …=0` over `delete`**
(`10-roadmap/2026-09-24-go-live-packet.md` §2a item 4). ⭐ That is the whole trap — the
gentler-looking verb is the one whose read-back lies.

⚠️ **And whether `--set` restarts is NOT settled.** Both measurements are kept
(`CLAUDE.md:3723-3732`): 2026-08-30 on `chart-renderer`, `--set` **staged only** — `--kv`
read the new value back immediately while `/proc/1/environ` still held the old one;
2026-09-09 on `web`, `--set` **auto-redeployed**, and an explicit `railway redeploy` 16 s
later was refused as *"currently building"*. The file says plainly: *"Do not re-litigate it
from either data point alone"* — that is how it came to hold three contradictory sentences.
The procedure that survives either behaviour (`:3734-3741`): set it, watch for a **new
boot** stamped after the `--set`, redeploy only if no boot appears in ~3 minutes, and
confirm the **running process** — `--kv` shows what the service is configured with, *"which
is not evidence the process has it."* ⭐ And one probe during a swap is not a verdict: right
after a redeploy the old pod can still answer (`:3775-3777`).

⛔⛔ **This document resolves one self-contradiction here, because a rollback plan cannot
ship with it.** CLAUDE.md:1752-1754 and H15 step 1 (`:3064-3065`) both say the hub kill
switch takes effect *"no redeploy"*; `docs/plans/joystick/rollback-runbook.md:45-47` says
*"`railway variables --set` STAGES AND REDEPLOYS. There is no documented no-redeploy form
of this command"*; and `CLAUDE.md:3772` says *"A flip is therefore a RESTART either way."*
**They are describing two different things and the ambiguous word is "redeploy".** The
ruling this document carries, and the wording it asks every downstream artifact to use:

> **A request-time flag flip needs NO REBUILD of your code. It may still cost a RESTART of
> the service.** The cheapness is that the bundle is untouched and the value applies on the
> next authenticated request; the cost is one web swap. Say "no rebuild", never "no
> redeploy".

That reading is what makes the runbook's own next sentence true — the switch *"is still far
better than a revert, because it needs no build of your code and touches only web"*
(`rollback-runbook.md:46-47`) — and it keeps `CLAUDE.md:3772`'s consequence intact: a flip
is bound by the push window.

⛔⛔ **A flip is not finished when the process has the value; it is finished when the ledger
says so** (`CLAUDE.md:3743-3746`): `status` to `armed`, the SERVICE in `where`, the flip
timestamp in the note, **in the same docs push**.

### 1.6 What a deploy actually costs — three quantities the accepted documents conflate

Gate item 24 §2.4 separates them (`07-technical-architecture/realtime-performance-architecture.md:343-366`):

| quantity | measurement | source |
|---|---|---|
| `/api/*` unavailability during a swap | **82–119 s**, n = 1 | `docs/runbooks/deploy-windows.md:47-52` |
| push → `web` deploy `SUCCESS` | **3m40s – 6m40s**, five deploys | Protocol E, item 24 |
| end-to-end incl. gate + promote workflows | **~10 min** | CP-05, 2026-09-23 |

⭐ **And the first was not observed on any orderly deploy.** Across five watched swaps
`/api/*` answered on every attempt with **no 502 window caught**, and fresh-pod page loads
came in at 3.11 s and 3.69 s DOMContentLoaded at pod ages 34 s and 49 s (item 24 §2.4).
⛔ The one recorded 502 came from a **superseded** deploy — a second merge marking the first
`REMOVED` mid-flight, a request dying with a 500 after 93 s and `/api/health` serving 502
for ~45 s. **So the architectural cost of deploying is a cold cache; the availability cost
belongs to pushing twice inside one build** — and those have different fixes, the second
being already solved by the queue and the guard.

⚠️ The 82–119 s figure is **a platform floor, not a tunable cost**, and
`deploy-windows.md:54-71` forbids proposing a readiness gate for it: `web` has a volume
mounted, and Railway documents that a volume-attached service cannot overlap deploys *"even
if there is a healthcheck endpoint configured."* Two independent investigations six weeks
apart reached the same conclusion. **The only lever is deploy FREQUENCY.**

Tiering, from the single authority (`deploy-windows.md:38-99`): **Tier 1** — docs,
markdown, `tests/**`, `tools/**`, `scripts/**`, `app/**` → restarts web only, push any
time, cost is the blip plus a possibly-lost APScheduler slot (its job store is in memory, so
a slot whose minute passes during the swap is lost outright, not run late). **Tier 2** —
anything on flow-worker's watch list → after-hours or weekend only, because Massive OPRA
does not replay and the gap is permanent until the T+1 flat file. ⛔⛔ **Tier 2 has no
override, measured 2026-09-25**: a 09:42 CT push took the whole Options Flow family to 502
for most of the session — the new consumer never re-authenticated, `flow_watchdog`
force-exited a process that was serving HTTP fine, Railway marked it CRASHED and did not
restart it, and the only lever that breaks the loop is an owner action (`:84-95`). ⭐ *"Never
delay a deploy" is a rule about `web`.*

⚰️ **One stale artifact to stop quoting.** `docs/plans/joystick/rollback-runbook.md:117-139`
declares deploy windows retired outright (*"There is no deploy window. Push when the work is
ready"*, owner 2026-09-11). `deploy-windows.md` is dated later (owner-approved 2026-09-11,
file mtime 2026-09-25 13:21), states it is the single authority, and carries the
no-exceptions Tier-2 rule measured 2026-09-25. **Pick `deploy-windows.md`.** The runbook's
§4 is correct about Tier 1 and wrong about Tier 2; nothing in Terminal-Next should cite it
for timing.

### 1.7 The queue discipline, and the blind window no threshold closes

One master merge at a time, made mechanical by `tools/pre_push_guard.py`
(`deploy-windows.md:363-413`). The two live clauses, read from source:

- **recency** — `RECENT_PUSH_WINDOW_SECONDS = 600` (`tools/pre_push_guard.py:532`), and
  separately a `SUCCESS` younger than `MIN_SETTLE_SECONDS = 150` (`:102`) is refused,
  because Railway reports SUCCESS at healthcheck while the old container is still draining.
- **burst** — `BURST_MIN_DEPLOYS = 3` distinct commits in `BURST_WINDOW_SECONDS = 3600`
  (`:543-544`).

⛔ **It fails closed**: CLI missing, unauthenticated, project unlinked, hook absent — all
refuse, because *"a guard that fails open reports 'fine' precisely when it has stopped
working"* (`deploy-windows.md:378-379`). ⛔ It does **not** require the deployed commit to be
yours; SUCCESS on another workstream's commit still means the pod is settled.

⛔⛔ **Two levers, and the reason the scoped one exists is a rollout lesson in itself.** On
2026-09-17 a session needing to pass the **burst** clause alone reached for the global skip
`UCT_SKIP_PREPUSH_GUARD=1`, which waived the **in-flight** clause too, and the push landed
inside another workstream's swap (`CLAUDE.md:3208-3214`). The guard had had the right lever
since D-10 — R19's scoped attestation `UCT_BURST_ATTESTED_BY` + `UCT_BURST_ATTESTED_AT`
(`tools/pre_push_guard.py:337-338`), which *"EXITS THE BURST CLAUSE AND NOTHING ELSE"*
(`:347`) and provably cannot satisfy recency or in-flight. ⭐ *"Nobody reached for it because
a global one existed. The fix is fewer levers, not more care."* The global skip is now
**rollback-only**: HEAD must be a real revert of the commit the deploy record says
production is serving, with `UCT_ROLLBACK_REASON` set (`CLAUDE.md:3224-3226`;
`deploy-windows.md:401-406`). ⛔⛔ And never `git push --no-verify` or `-n` — it skips every
hook and leaves no trace anywhere (`CLAUDE.md:3204-3206`).

⛔⛔ **The guard has a ~3.5-minute blind window, by construction, and no settle threshold
fixes it.** Railway creates the deploy record **minutes** after the push and the delay is
**variable** — two independent measurements 47 s apart gave **3m25s** and **2m38s**
(`CLAUDE.md:3278-3284`). So the guard, which reads the Railway deploy list, cannot see a
push that has already happened, and during that window it answers *"master is quiet"* with
complete confidence — which it did, in both directions, in one night (`:3286-3295`).
⛔ *"WAITING LONGER DOES NOT CLOSE IT … **'No deploy in flight' is evidence about DEPLOYS,
never about PUSHES.**"* Push-level serialisation must come from the
`concurrency: master-deploy` group at GitHub, which sees the push itself —
`.github/workflows/master-deploy-gate.yml:67-69`, where `cancel-in-progress: false` is
called *"THE WHOLE MECHANISM"* (`:44`). ⛔ **Do not calibrate a wait on 3m25s**: two samples
establish that it varies, not a bound, and a fitted wait fails silently — you read a quiet
queue and believe it.

⛔ **A related misread to inoculate against.** *One landing produced FIVE deploy records*,
three inside 16 seconds, and the two clauses disagreed about the same event while both
behaved correctly: burst dedupes by commit (five deploys of one commit = one landing),
recency counts records (five, each restarting the 600 s clock). A waiting session sees
`541 → 431 → 320 → 516 → 398` while `origin/master` never moves. ⭐ **Watch for a NEW SHA,
not for the timer moving** (`CLAUDE.md:3252-3270`).

### 1.8 The two rules that govern a live failure

⛔⛔ **H15 — a failing post-deploy smoke is rolled back FIRST and diagnosed second**
(`CLAUDE.md:3051-3079`). The order is: roll back via the runbook; confirm the rollback took
*at the layer the failure appeared in*, not by reading the variable back; **then** report,
then diagnose. The reason is not tidiness — it is who pays: *"Once a member is looking at a
broken screen, the time cost of a diagnosis is paid by them."* The failure mode the rule
names is the sentence *"Let me just check one thing first."*

⚠️ **INCONCLUSIVE is not FAILED and must not trigger a rollback.**
`tools/hub_nav_smoke.py` exits **2** when nothing was measurable and **1** when a break was
measured, *"precisely so this rule cannot fire on an unmeasured deploy"* (`:3076-3079`;
the exit contract is documented in the tool at `tools/hub_nav_smoke.py:43` and tabulated in
`docs/plans/joystick/rollback-runbook.md:181-190`). ⭐ Rolling back on an INCONCLUSIVE
teaches everyone to stop running the smoke. The smoke also refuses to judge a pod below an
age floor and calls that INCONCLUSIVE too (`hub_nav_smoke.py:93,107`) — with the
re-derivation warning attached, because the floor is a small-n number.

⛔⛔ **H14 — a hazard class found while the code is live is a hard stop, not a footnote**
(`CLAUDE.md:3003-3049`). Written from the 2026-09-10 navigation freeze: a subagent reported
a complete, correct description of a hazard class — *"`useHubMode` re-registration is
identity-driven, so any host passing an unmemoized callback loops"* — as a curiosity. The
class was **already live**; clicking any nav entry on `/dashboard` changed the URL and left
the screen where it was, app-wide, for **four and a half hours**, and it was found by a
member. ⭐⭐ *"A green suite, a 200 and a rising uptime are all compatible with a browser
that cannot change pages."* The gate was green (1,261 files, 18,708 tests, 0 NEW),
`/api/health` returned 200 throughout, and the first-hour watch recorded five clean samples
while the defect was live — because it polled the server and the server was never unwell.
The four requirements, in order: name the **class** not the instance; enumerate what
exhibits it **from source**, not from memory (the freeze's host was not the one the finding
came from); check the **live build** at the layer the hazard would show up in; and **block
the next deploy** until those are done. ⛔ The tell is the word *"interesting"* — a hazard
class reported as interesting has already been demoted.

---

## 2. The rollout ladder for Terminal-Next

Five rungs. The numbering is the ladder gate item 23 §3.4 already drew
(`09-security-licensing-cost/security-entitlement-architecture.md:658-667`), so this
document adds no sixth vocabulary. ⛔ **No rung is a tier.** CARD 17 forecloses tier
staging and states the reason it survives anyway: *"The dark-cohort ladder is unaffected.
Cohorts are not tiers."*

⛔ **Every rung carries a NAME at the call site, not only a number.** That is not style: in
this repo today "stage 2" means the code's opt-in rung and the owner's everyone rung in two
different artifacts (`app/src/hub/rolloutStage.js:15-28`). A bare integer in a member-impact
paragraph is how a rollout ships the wrong exposure under the right sentence.

### S0 — Declared and unset (rung 0)

**True at this rung.** One master switch, `TERMINAL_NEXT_ENABLED`, declared in
`docs/feature_flags.json` with `status: dark`, read **per request** in
`_access_payload`, unset ⇒ OFF for everyone including admins. Zero member-visible change.
The name carries `_ENABLED` so the AST index and `tests/test_feature_flag_ledger.py` can
see it — gate item 23 §3.4 step 4 names this explicitly, because *"a name without
`ENABLED`/`DISABLE`/`_ON` is invisible to the only inventory that exists."*

**Gate to advance.** The flag read back **in-process**, not from `--kv` (§1.5). A rail
asserting the read is per-request, on the `tests/test_hub_preview_flag.py::test_the_flag_is_read_per_request`
pattern — *"the load-bearing one: a module-level capture passes every other test and makes
the no-redeploy rollback a fiction"* (`CLAUDE.md:2613-2615`). A second rail pinning the
literal default so it cannot be changed and the test *"fixed" to match* (`:2616-2617`).

**Rollback.** Nothing to roll back; the value it would revert to is the value it has. ⭐
This is the `NOTEBOOK_DOOR_GUARD` property — the lever exists before it is needed and
arming it changed nothing (`CLAUDE.md:2088-2091`).

### S1 — Owner preview (rung 1: `TERMINAL_NEXT_ENABLED=admin`)

**True at this rung.** The surface is live for admins only, resolved per request from the
role already on the auth payload. This rung **already ships** and costs no new code: gate
item 23 §3.4 records it as ✅ NEW since D-10, with `_breadth_dc_flags(is_admin=...)`
resolving `admin` at `api/routers/auth.py:230-265` and `COMPASS_MENTOR_MODE` as the older
precedent. Its own docstring states both halves of why it matters: *"`admin` IS THE OWNER
PREVIEW, and it is the reason a build-time flag could not do this job at all: one bundle
cannot be on for one member and off for the rest"*, and ⛔⛔ *"`admin` MUST READ FALSE FOR A
MEMBER. That is the whole safety property, and it is the ONLY direction of this flag that
can cost anything."* It fails closed by construction: `is_admin` defaults to `False`, so *"a
call site that forgets to pass the role sees what a member sees."* ⛔ An unrecognised value
takes the default, never its opposite — a typo'd `"flase"` must not turn a dark surface on
(`auth.py:233-235`).

**Gate to advance.** The admin-true / member-false rail, mutation-proved (item 23 §3.4
names `test_admin_means_ADMIN_ONLY_and_a_member_sees_OFF`). A real owner pass on a real
device — *"this codebase has already found bugs on real Safari that jsdom and Chromium both
missed entirely"* (§6 item 6 of the one-week roadmap; the underlying incident is
`CLAUDE.md:1108`). The OFF state watched to actually kill something **before** the ON state
is trusted (§6 item 3: *"A kill switch nobody has watched actually kill something isn't a
kill switch, it's a variable"*).

**Rollback.** Tier 1 — `--set TERMINAL_NEXT_ENABLED=0`, no rebuild.
**Cost:** possibly one web restart (§1.5). **Reach:** the owner's next authenticated
request. Blast radius is one account, which is the point of the rung.

### S2 — Named cohort (rung 2 — ⛔ ABSENT today; the only rung that needs a build)

**True at this rung.** A named cohort inside the single paid tier sees the surface; everyone
else sees today's product. Item 23 §2.1 and §3.4 are explicit that this rung **does not
exist**: the store and the admin UI exist and **no gate reads them**. The build is four
things, in the shape the repo already argues for (§3.4):

1. one helper `has_tag(user_id, tag) -> bool` over the existing `get_user_tags` query;
2. one dependency **beside** `require_paid`, never a replacement for it, so one 402 keeps
   meaning one thing (`entitlements.py:296-301`);
3. one field on `_access_payload` (e.g. `"cohorts": ["terminal-next"]`), because that
   payload is the house channel and a `/api/flags` endpoint is a struck decision — ⭐ there
   is **no feature-flag endpoint in this app** and Wave K *"deliberately did not add one"*
   (`CLAUDE.md:3668-3669`);
4. `TERMINAL_NEXT_ENABLED` kept as the master kill switch **paired** with the cohort,
   exactly as `COMPASS_MENTOR_MODE` + `COMPASS_MENTOR_BETA_EMAILS` already does — *"the
   kill switch is what a responder pulls, and it must be inside the one inventory with a
   rail."*

⛔ **Never `user_preferences`** — the member writes their own, so an entitlement stored
there is self-grantable (item 23 §3.4; the same hole `rollback-runbook.md:220-229` names for
the hub). ⛔ **One implementation, not a third** — `COMPASS_MENTOR_MODE`'s cohort logic is
already implemented twice, each copy claiming to mirror the other.

**Gate to advance.** DP-3 answered (item 23 §3.5): is the cohort **durable per-user** (a
tag, admin-editable, auditable) or **ephemeral per-deploy** (an env allowlist)? *"the two
answers produce different beta operations."* RB-2 below proposes a default. Plus: the
post-deploy smoke exits 0 on the Terminal-Next routes, and the cohort's own OFF state
watched to kill.

**Rollback.** Tier 1 on the master switch — `TERMINAL_NEXT_ENABLED=0`, no rebuild, reach =
next authenticated request. ⛔ **Not by deleting tags.** Stopping a dark run must never be a
DELETE against member data — flags stay env vars and cohorts stay tags
(`feedback_kill_switch_never_a_delete`). Removing a member from the cohort is a legitimate
*per-member* action and a DB write; it is not the incident lever.

### S3 — Surface by surface (the `PREVIEW_MODES` shape)

**True at this rung.** The cohort is wide (or everyone, if S4 has landed) but each
Terminal-Next surface leaves the preview projection in its own commit, with its own
member-impact paragraph and its own smoke run. The mechanism is a Set of surface ids
projected over a registry, never a destructive edit (`app/src/hub/registry.js:703-720`), so
un-exposed surfaces stay defined, imported and testable.

**Why this rung and not a percentage.** The unit of risk for Terminal-Next is a surface, the
surfaces will not be finished simultaneously, and they share components — which is verbatim
the argument `registry.js:712-716` makes for per-mode over one global boolean. ⭐ And the
Set shape has a property a percentage does not: you can read the remaining work at a
glance.

**Gate to advance, per surface.** The regenerated artifact in the **same commit**,
byte-compared by a rail on the `hub/surfaceMatrixIsCurrent.test.js` pattern
(`CLAUDE.md:1722-1731`) — the generator there reads bindings from an **acorn parse tree**
because it was regex-based twice and wrong twice. And the exposure count checked
deliberately: removing one id from the hub's Set can expose **nineteen** already-declared
actions in one line (`CLAUDE.md:1718-1719`), and `calendar` once shipped a five-action fan
into a navigation-only preview that way (`registry.js:726-727`).

**Rollback.** Tier 3 or 4 — re-adding the id is a **deploy**, because the Set is a build
constant. **Cost:** a full build plus the gate's verdict. **Reach:** on reload; an open tab
keeps the old bundle. ⛔ Which is why §3 prefers **tier 4** here: pre-author the re-add
branch before the exposure commit ships.

### S4 — Everyone (rung 4)

**True at this rung.** The flag is truthy for all, the preview Set is empty for the
Terminal-Next surfaces, and the ledger entry says `armed` with the flip timestamp — in the
**same docs push** that records the flip (`CLAUDE.md:3743-3746`).

⛔⛔ **The graduation commit is where this rollout is most likely to lose its own lever.**
At the moment the surface becomes default-on, the flag stops being an enablement gate and
starts being a kill switch. `needs_declaration()` then returns **false** for it
(`api/services/feature_flag_index.py:396-407`), so the AST rail stops requiring an entry
and the flag can silently leave the only inventory that exists — which is exactly the state
`HUB_PREVIEW_ENABLED` is in today (§1.1: 0 occurrences). RB-4 fixes this in one line.

**Gate to advance.** There is nothing above this rung. What must be true to stay here: the
smoke green on the Terminal-Next routes, the ledger updated, and the tier-4 branch still
gated green against a master that has moved (RB-8).

**Rollback.** Back down one rung at a time, in reverse. ⛔ **Never straight to a revert when
a rung exists** — `CLAUDE.md:2084-2085` ranks the whole-wave kill *second*, *"because it
stops a whole wave to fix one write path."*

### ⭐ Reach, which is the column people forget

| lever | what it reaches | what it does NOT reach |
|---|---|---|
| tier 0 devtools/localStorage | that browser, immediately | anyone else |
| tier 1 request-time flag | each member on their next authenticated request or reload | **a tab mid-session** |
| tier 2 env + redeploy | everyone, after the new boot | a browser holding the old bundle, for bundle-shaped state |
| tiers 3–5 bundle change | each member **on reload** | **a tab mid-session** |

The owner ruling is verbatim and this document does not soften it
(`CLAUDE.md:3676-3677`): *"a flip reaches a member on their next authenticated request or
reload; it does not reach a tab mid-session (latched for §21). If the auth payload is
unreachable, the wave stays ON — the switch kills a decision, not an outage."*

⭐ **And the client may deliberately latch the answer**, as Wave Q1 does
(`CLAUDE.md:3679-3683`): a tab that has already decided it may write must never see "am I
allowed to write" change between a PUT going out and its ack coming back; a later poll
disagreeing is **counted, not applied**. Item 23 §3.4 draws the conclusion for any rollout
plan: *"A dark cohort is therefore **not** an instant close-down on an open tab, and any
rollback plan that assumes otherwise is wrong."*

⛔ **There is no service worker, and the rollback reasoning leans on that** — stated
precisely rather than absolutely (`CLAUDE.md:3704-3714`): `main.jsx` registers no caching
service worker; what exists at `/sw.js` is a **self-uninstalling kill switch** fetched only
by a browser still carrying the legacy cache-first worker. A cache-first SW would serve a
stale bundle straight through a revert, which is the one failure the rollback text tells a
reader not to worry about.

⚰️ **The reach sentence is the single most-corrupted line in this programme's history.** For
most of Wave Q1 the canary *"stamped the opposite instruction on every evidence row"*, and
it was corrected 2026-09-12 (`CLAUDE.md:3695-3696`). The Wave K response was to write the
sentence verbatim in five places and add `tests/test_k_reach_statement.py` to keep them
identical (`:3605-3607`). RB-7 adopts that.

---

## 3. The rollback decision table

⛔ Read top-to-bottom. The first row whose failure shape matches is the tier, and H15
applies to every row: **roll back, confirm, report, then diagnose.** Every "verify" column
means *in the running process or at the layer the failure appeared in* — never a variable
read-back (`CLAUDE.md:3067-3069`).

| failure shape | tier | command | how to verify it took | reach |
|---|---|---|---|---|
| One operator's or one tester's browser is wrong; everyone else is fine | 0 | the feature's devtools helper, on the `setBarsPushEnabled` pattern (`StockChart.jsx:1292-1300`) | the surface changes in that tab without a reload | that browser, instantly |
| Terminal-Next is misbehaving for its cohort; the rest of the product is healthy | 1 | `railway variables --service web --set TERMINAL_NEXT_ENABLED=0` | a **new boot** stamped after the `--set`, then read the value in-process (`os.environ.get` over `railway ssh`, or `/proc/1/environ`), then one authenticated request showing the surface gone | next authenticated request; **not** a tab mid-session |
| A *backend* capability behind the surface is the problem (a stream, a worker, a job) | 2 | the capability's own gate to `0`, then confirm a redeploy — the `STREAM_BARS_ENABLED=0` shape (`CLAUDE.md:1535`) | `/api/health` uptime **reset**, plus the capability's own status endpoint showing it inert | everyone, after the boot |
| A build-time constant or an exposure Set is wrong (stage number, `PREVIEW_MODES` id, a compiled default) | **4 preferred, 3 if no branch exists** | push the pre-authored rollback branch; else `git revert --no-edit <bad-sha>` → `git push origin HEAD:master` (`deploy-gate-v2.md:164-171`) | the gate green, the promotion recorded, `/api/health` uptime reset, **and** an ancestry check that the shipped commit is contained in what production serves — never the SHA on the green deployment (`rollback-runbook.md:153-155`) | on reload |
| The above, and the master gate is red for an unrelated reason | 5 | owner-only, in this order: `gh workflow disable "promote to production"` → `git push --force-with-lease origin <last-good>:refs/heads/production` → fix forward on master → re-enable (`deploy-gate-v2.md:179-186`) | `production` at the intended SHA **and** the workflow still disabled until master is fixed | on reload |
| The push queue is the problem — a stacked push, a deploy marked REMOVED mid-flight | — | **wait**, do not push. A push is not clear until its web deploy reaches `SUCCESS` (`CLAUDE.md:3241-3243`) | a **new SHA** on `origin/master`, not a moving timer (`:3268`) | — |
| The smoke exited **2** | ⛔ **none** | say *"the deploy is unverified, not bad"*, in those words; fix the measurement; re-run (`rollback-runbook.md:185`) | — | — |
| A hazard **class** was just named and might be live | ⛔ **H14, before any deploy** | enumerate what exhibits it from source; check the **live build** at the hazard's own layer; block the next deploy until done (`CLAUDE.md:3033-3042`) | the live check, in a browser if it is a render hazard — `/api/health` cannot see one | — |

⛔ **Only one variable is ever named for the guard bypass, and it is rollback-only:**
`UCT_ROLLBACK_REASON="<why members need this now>" UCT_SKIP_PREPUSH_GUARD=1 git push …`,
and the guard refuses it unless HEAD is a real revert of the commit the deploy record says
production is serving (`deploy-windows.md:405-406`). A burst-only refusal with recency and
in-flight passing on their own uses the **scoped attestation** instead (`:401-403`). ⚰️ The
retired deploy-window override is deliberately **not** named here: *"the right treatment for
a dead name is to stop saying it"* (`CLAUDE.md:3228-3233`).

---

## 4. What must exist before stage one — a checklist, each item with the incident behind it

1. ⛔ **`TERMINAL_NEXT_ENABLED` declared in `docs/feature_flags.json`, with a name the AST
   index can see.** *Incident:* `DESK_PUBLIC_SHOWS` carries no `ENABLED`/`DISABLE` marker,
   `is_gate()` was false for it, the rail never asked, and for **25 days** the live wildcard
   and the doc disagreed with nothing able to tell (`CLAUDE.md:5312-5316`). *Second
   incident:* Wave K shipped four capabilities the AST could not see, so **140 flag tests
   passed over a ledger that was four gates short** (`docs/feature_flags.json:17-22`).
2. ⛔ **A rail that the flag is read per request.** *Incident:* named in
   `tests/test_hub_preview_flag.py` as *"the load-bearing one: a module-level capture passes
   every other test and makes the no-redeploy rollback a fiction"* (`CLAUDE.md:2613-2615`).
3. ⛔ **A rail pinning the literal default**, not just the behaviour — *"so the default
   cannot be changed and the test 'fixed' to match"* (`CLAUDE.md:2616-2617`).
4. ⛔ **The OFF state watched to actually kill something, before the ON state is trusted.**
   §6 item 3 of the one-week roadmap: *"A kill switch nobody has watched actually kill
   something isn't a kill switch, it's a variable."*
5. ⚠️ **`tools/flag_ledger_audit.py` proved runnable on this box, and its blind spot written
   down beside its output.** *Incident:* the cp1252 pipe decode made it unrunnable and the
   failure read as an auth problem, so a real drift went unseen for a day
   (`CLAUDE.md:3763-3770`). *And:* it answers about **presence, never value** — a clean
   `0/0/0/0` coexisted with five `armed` flags reading `'0'` live
   (`tools/flag_ledger_audit.py:24-37`). ⛔ A clean run is not evidence the feature is on
   where a reader would believe it is.
6. ⛔ **A post-deploy smoke covering the Terminal-Next routes, with three exit codes.**
   *Incident:* the 2026-09-10 freeze, where every pre-push condition held and navigation was
   broken app-wide for 4.5 h (`rollback-runbook.md:162-168`). ⚠️ It must exit **2** for
   unmeasurable, or H15 will fire on unmeasured deploys (`CLAUDE.md:3076-3079`). ⭐ Add
   routes to the existing instrument rather than writing a second one — two smokes would be
   two authorities on "is the app navigable".
7. ⛔ **A pre-authored rollback branch, pushed and gated green with the flag already false,
   before the first member-facing flip.** *Incident:* the cutover made a red gate a
   non-deploy (`deploy-windows.md:13-14`), so a revert's landing is conditional on a verdict
   you do not have during an incident. *Precedent:* `rollback/notebook-offline-default-off`,
   recorded at `3db89e205`, *"gated and gauntleted green with the flag false"*
   (`CLAUDE.md:3587-3589`; SHA quoted from that artifact).
8. ⛔ **The rollback lever written down before the flag flips** — which variable, what it
   reverts to, and how you would know it worked (§6 item 4). The go-live packet's §2a item 4
   is the model, including *"prefer `--set …=0` over `delete`"*.
9. ⛔ **A member-impact paragraph, and the reach sentence verbatim, kept identical by a
   rail.** *Incident:* for most of Wave Q1 the canary stamped the **opposite** rollback
   instruction on every evidence row (`CLAUDE.md:3695-3696`); the response was five verbatim
   copies plus `tests/test_k_reach_statement.py` (`:3605-3607`).
10. ⛔ **The owner's explicit "go", per surface — not a bundled "ship everything"** (§6 item
    9). The go-live packet shows what that costs in practice: nine points per flag, with
    ⚠️ marking what is genuinely still missing rather than rounding it up to done.
11. ⛔ **A recovery path in the same commit as any dismissable control.** *Incident:* "Hide
    joystick" shipped writing `joystick_hub.enabled = false` while the Settings toggle that
    turns it back on was scheduled for a later phase; the two documented routes back were an
    admin editing `user_preferences` and the member pasting a `fetch()` into devtools, and
    the owner hit it on production as an admin (`CLAUDE.md:2620-2625`). ⭐ The corollary is
    already encoded at `rolloutStage.js:64-68`: no stage may remove somebody's only way off.
12. ⛔ **The ledger updated in the same docs push that records the flip time.** *Incident:*
    `RESEARCH_TECHNICAL_TAB_ENABLED`, above (`CLAUDE.md:3748-3761`).
13. ⚠️ **Confirm the surface touches no Restricted-tier data still awaiting CP-03** (§6 item
    5) — that rule holds regardless of code readiness, and it is not this document's to
    waive.

---

## 5. Defaultable rulings

Each is a default, not a question handed back. Each names what would overturn it. **Vetoable
in one word.**

| # | ruling | overturned by | vetoable |
|---|---|---|---|
| **RB-1** | **Terminal-Next stages by cohort, then by surface. Percentage is reserved for a render/streaming canary and is never an entitlement rung.** | A Terminal-Next surface that is purely a render path with no entitlement meaning *and* a population where a fraction is interpretable — item 23 §3.4 rules percentage buckets **browsers, not users**, and CLAUDE.md:2560 records 26 production users at 2026-09-12. | yes |
| **RB-2** | **DP-3 defaults to a DURABLE per-user tag** (`user_tags` + `has_tag`), not an env allowlist. A cohort that survives a deploy is auditable, admin-editable without a push, and answers "who saw this" after the fact. | The owner wanting the cohort to reset on every deploy, or wanting zero DB surface for the beta. | yes |
| **RB-3** | **Five rungs, S0–S4 as named in §2, and a rung is never shipped as a bare integer** — every stage carries its name at the call site and in the member-impact paragraph. | The owner collapsing S1 and S2 (owner preview straight to a wide cohort). *Justified by:* `rolloutStage.js:15-28`, where the code's numbering and the owner's ruling disagree today. | yes |
| **RB-4** | **At the S4 graduation commit, the flag is added to `docs/feature_flags.json` BY HAND with `status: armed` and a note saying it is now a kill switch outside `needs_declaration()`'s scope — plus a rail asserting the ledger contains it by name.** Without this the master rollback lever silently leaves the only inventory the moment it starts mattering most. | Widening `needs_declaration()` to cover kill switches, which is a better fix and a bigger one — it changes what every default-on gate owes the ledger. | yes |
| **RB-5** | **Every flip is verified by a NEW BOOT plus an in-process read, never `--kv`; and a flip is treated as a RESTART, so it is bound by the Tier-1 push window.** Downstream wording is *"no rebuild"*, never *"no redeploy"* (§1.5). | A third `--set` measurement establishing the behaviour — ⛔ and CLAUDE.md:3730-3732 forbids concluding from one data point. | yes |
| **RB-6** | **Terminal-Next adds its routes to `tools/hub_nav_smoke.py` rather than getting a second smoke**, and inherits its 0/1/2 exit contract unchanged. | A Terminal-Next failure mode that instrument structurally cannot see (it watches navigation and main-thread starvation), which would justify a *sibling* instrument with its own name, never a fork. | yes |
| **RB-7** | **One reach sentence, verbatim wherever it appears, held identical by a rail** on the `test_k_reach_statement.py` pattern. | Nothing. ⚰️ This is the line that was inverted across a whole wave's evidence rows. | yes |
| **RB-8** | **The tier-4 rollback branch is re-gated whenever master has moved more than five commits ahead of it, or has touched a file it touches** — the same predicate the rebase rule already uses (`CLAUDE.md:3165-3179`), measured rather than guessed. | A cheaper staleness signal; or the gate becoming fast enough that tier 3 is as predictable as tier 4. | yes |
| **RB-9** | **The plan does NOT promise an instant close-down on an open tab, at any rung.** The only mechanism would be a client poll that is *applied* rather than latched, which contradicts Wave Q1 §21's deliberate latch (`CLAUDE.md:3679-3683`). Accept next-request / reload reach and say so in the member-impact paragraph. | A Terminal-Next surface where a stale in-tab decision is genuinely unsafe — in which case the latch question is reopened as a design item, not as a rollback assumption. | yes |
| **RB-10** | **If a render canary is ever used, the bucket is per-browser and persisted, and the dial is a build constant** — the `uct.barsPush.bucket` shape, with no-storage falling **out** of the rollout (`StockChart.jsx:1272-1280`). No runtime percentage. | Nothing on the evidence available; a runtime percentage would put a second authority beside the bundle and make "what did this browser get" unanswerable after the fact. | yes |
| **RB-11** | **Flips ride the Tier-1 window and nothing in Terminal-Next ships into flow-worker's watch list during RTH.** A flip is a restart (RB-5), and the measured cost of Tier 2 during a session is the whole Options Flow family at 502 for most of a day (`deploy-windows.md:84-95`). | Terminal-Next acquiring a genuine flow-worker dependency — which would be an architecture decision, not a rollout one. | yes |

---

## 6. ⛔ What this document does NOT decide

- **Any flag's current live state.** No Railway read, no production call. Every state above
  is a claim about `docs/feature_flags.json` at mtime 2026-09-25 21:06, or about a source
  file's declared default. ⛔ Do not quote this document for what is set on the pod.
- **Whether `railway variables --set` restarts the service.** Two measurements, both kept,
  both real (`CLAUDE.md:3723-3732`). RB-5 is a procedure that survives either; it is not an
  answer.
- **DP-3, DP-4 and the price/trial/seat questions.** RB-2 defaults DP-3 and can be vetoed in
  one word. DP-4 (is a persisted, admin-toggled runtime kill switch required?) is the
  owner's, and item 23 §3.5 notes the only runtime switch today is maintenance mode, which
  kills everything and resets on every redeploy. Price, trial and seat model are named in
  CARD 17 as *"still undecided and still not mine"*.
- **Which Terminal-Next surfaces exist, or their order.** That is items 27–29 (MVP,
  roadmap, dependency graph). This document supplies the ladder those surfaces climb and
  the tiers they come back down; it names none of them.
- **The testing strategy.** Item 36, in flight in a sibling file this session did not touch.
  §4's rails are rollout preconditions, not a test plan.
- **Whether `needs_declaration()` should be widened to cover kill switches.** §1.1 and RB-4
  establish the hole and patch it for one flag. Widening it is a change to what every
  default-on gate in the repo owes the ledger, and it belongs to whoever owns
  `api/services/feature_flag_index.py`.
- **The joystick stage-2 PR.** `app/src/hub/rolloutStage.js:30-37` states that renumbering
  is a member-facing exposure change belonging to that PR, which Patrick merges. ⛔ Nothing
  here asks for it, and §1.3's ⚰️ note about the `= 2` comment is a finding to hand to that
  owner, not a change to make.
- **Any SHA.** No git command was run, by instruction. SHAs quoted above come from artifacts
  and are labelled; anywhere a pinned SHA belongs, **SHA not pinned (no git by instruction)**.

---

## GAPS

1. ⛔ **No live flag read, so §1.1's central finding is one-sided.** I proved
   `HUB_PREVIEW_ENABLED` is absent from the ledger; I could not prove what the pod has. The
   ledger's own history makes the asymmetry matter — the checkpoint wins over the ledger, and
   I have no checkpoint. **Closes with:** one `railway variables --service web --kv` read and
   one in-process read, by whoever holds the credential.
2. ⛔ **`tools/flag_ledger_audit.py` was read, never run.** So "the encoding bug is fixed"
   is a claim about source (`:187-189`), not about behaviour on this box today. ⚰️ And the
   original failure looked like an auth problem, which is precisely the shape a reader
   dismisses. **Closes with:** one run, plus `--visibility`.
3. ⚠️ **The 26-user population is 13 days old** at write time (measured 2026-09-12,
   `CLAUDE.md:2560-2562`) and the site is in `COMING_SOON_MODE`, so the roster is admins and
   testers. §2 uses it as an order-of-magnitude argument only. ⚰️ The adjacent trap is
   recorded in the same passage: the ~20,640-user figure elsewhere is the **dev box**, and
   production is ~800× smaller than the number a reader would otherwise carry.
4. ⚠️ **How many ledger flags are kill switches is unmeasurable from the ledger**, because
   kill switches are not in it and zero keys contain `DISABLE`. A full census would need an
   AST pass over `api/**` for default-on gates — which would be a script, and no script was
   run. **So the size of the hole in §1.1 is unknown; only its existence is measured.**
5. ⚠️ **Whether any Terminal-Next surface is bundle-shaped at all is not yet knowable.** If
   every rung rides `_access_payload`, tiers 3–5 never fire and RB-8 is dead weight. If any
   exposure lands in a build constant — as both the hub's Set and its stage number do — they
   are the primary tiers. Items 27–29 decide this.
6. ⚠️ **SSE-pool reconnection without user action, and warm-ratio recovery time after a
   swap, are unmeasured** (item 24 §2.4's own honest remainder). Both need a browser session
   held open across a deploy. That is the one thing that could change the reach table: it is
   the difference between "an open tab keeps the old bundle" and "an open tab loses its
   stream".
7. ⚠️ **Tier 0 has one precedent and one shape.** `setBarsPushEnabled` is a chart-specific
   helper; whether the same pattern is appropriate for an entitlement-adjacent surface (where
   a member could set the key themselves, as with `user_preferences`) is not settled here.
8. ⚠️ **No rollback was rehearsed.** Every tier above is documented and has been performed at
   least once by this repo; none was performed by this document. ⛔ A tier nobody has pulled
   in anger is a procedure, not a capability — the same objection §4 item 4 makes about an
   unwatched kill switch.

---

## SOURCES

Read-only, in `C:\Users\Patrick\uct-worktrees\_merge-master` unless marked. Commands and
offsets given so each claim can be re-derived.

**Code**
- `api/routers/auth.py:126-137` — `NOTEBOOK_FLAGS`, polarity per capability with the reason inline.
- `api/routers/auth.py:230-265` — `_breadth_dc_flags`, the `admin` rung; unrecognised value takes the default; `is_admin` defaults False.
- `api/routers/auth.py:291-307` — `hub_preview_enabled`, read at request time, default ON, kill-switch polarity stated.
- `api/services/feature_flag_index.py:383-393` (`defaults_on`), `:396-407` (`needs_declaration`).
- `app/src/hub/rolloutStage.js` — `:3-8` two authorities; `:15-28` the ruling/code numbering mismatch and the `= 2` comment; `:30-37` renumbering belongs to the stage-2 PR; `:44-46` a stage is a deploy; `:48-51` the kill switch outranks every stage; `:52` `ROLLOUT_STAGE = 1`; `:55-59` `STAGE_NAMES`; `:64-73` `cardVisible`; `:76-87` `unsetDefault`.
- `app/src/hub/registry.js:703-720` the projection and `PREVIEW_MODES`; `:712-716` per-mode not one boolean; `:721-748` the increment history and why `home`/`flow` remain; `:752` `PREVIEW` derived.
- `app/src/components/StockChart.jsx:1259-1269` the widen dial and the three reverts; `:1272-1280` `_rolloutBucket`; `:1282-1289` `_barsPushEnabled`; `:1292-1300` `setBarsPushEnabled`.

**Tools**
- `tools/flag_ledger_audit.py:1-50` docstring incl. the `0/0/0/0` blind spot and the five `armed`-reading-`'0'` flags; `:67-78` the derived roster and why a partial one refuses; `:144-167` `audit()`; `:173-206` `_values_for` and the empty-read refusal; `:209-248` `visibility_audit`.
- `tools/pre_push_guard.py:102` `MIN_SETTLE_SECONDS = 150`; `:312-330` `decide`; `:337-347` the scoped attestation and its scope; `:532` `RECENT_PUSH_WINDOW_SECONDS = 600`; `:543-544` `BURST_WINDOW_SECONDS`/`BURST_MIN_DEPLOYS`; `:580-649` `decide_cadence`.
- `tools/hub_nav_smoke.py:43` the exit-2 contract; `:93,107` the pod-age floors.

**Runbooks and workflows**
- `docs/runbooks/deploy-windows.md:7-30` the cutover; `:38-71` Tier 1, the 82–119 s measurement and the platform floor; `:73-99` Tier 2 and the 2026-09-25 flow-worker incident; `:363-413` the guard; `:401-406` the two levers.
- `docs/plans/joystick/rollback-runbook.md:17-56` §1/§1A and *"`--set` STAGES AND REDEPLOYS"*; `:86-95` confirming the switch and the reach caveat; `:99-113` the revert path and its cost; `:117-139` ⚰️ the retired-windows section; `:143-158` first-hour signals and the ancestry check; `:162-190` condition 8 and the exit table; `:220-229` B6 is not a security boundary.
- `docs/breadth/deploy-gate-v2.md:164-191` §5.1e rollback — revert promoted forward, why a manual reset is silently undone, the emergency path and its ordering; `:195-204` why neither guard needs to watch `production`.
- `.github/workflows/master-deploy-gate.yml:44` `cancel-in-progress: false` is the whole mechanism; `:59-69` name, branches, concurrency; `:105-170` the promotion-control compensating check.
- `.github/workflows/promote-production.yml:30-44` triggers incl. `workflow_dispatch` with a `sha`; `:69-78` a failed gate promotes nothing; `:146-165` fast-forward only, never `--force`.

**Ledger**
- `docs/feature_flags.json` (mtime 2026-09-25 21:06) `:2-53` the `_readme`; the `RESEARCH_TECHNICAL_TAB_ENABLED`, `RESEARCH_FLOW_TAB_ENABLED` and `DESK_PUBLIC_SHOWS` entries read in full. Counts as tabulated in §1.1, by `Grep` and by parsing.

**CLAUDE.md** (mtime 2026-09-25 11:49) — `:1496-1544` bars push feed, `:1533-1537` rollout and revert; `:1716-1732` exposure and the regeneration commands; `:1750-1762` flags, rollback, devices; `:2053-2072` documented is not bounded; `:2074-2091` flag-first rollback and `--set`/`delete`; `:2560-2567` the production population; `:2591-2617` `HUB_PREVIEW_ENABLED`; `:2620-2625` the Hide defect; `:3003-3049` H14; `:3051-3079` H15; `:3165-3179` the rebase predicate; `:3181-3202` deploy windows pointer; `:3204-3233` the two levers and the retired name; `:3241-3250` a push is not clear until SUCCESS; `:3252-3276` the redeploy storm; `:3278-3303` the blind window; `:3388` two instruments agreeing; `:3577-3592` Wave Q1 and the pre-authored rollback branch; `:3594-3614` Wave K shipped dark; `:3658-3714` the two levers and the reach ruling; `:3716-3779` `--set` measured both ways, the ledger rule, the unrunnable auditor; `:5279-5325` `DESK_PUBLIC_SHOWS` and the flag with no marker.

**Sibling research documents** (in `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research`)
- `12-decisions/DECISION_CARDS_2026-09-26.md` CARD 17 — one paid tier; what it forecloses; *"Cohorts are not tiers."*
- `09-security-licensing-cost/security-entitlement-architecture.md:658-716` §3.4 — the five-rung ladder, rung 1's docstring, how to build rung 2, never `user_preferences`, the reach and ledger warnings; `:717-729` §3.5 DP-1…DP-8.
- `07-technical-architecture/realtime-performance-architecture.md:343-366` §2.4 — the three deploy quantities and the superseded-deploy finding.
- `10-roadmap/2026-09-23-one-week-execution-roadmap.md:945-1000` §6 — the nine going-live points and how a change actually reaches production.
- `10-roadmap/2026-09-24-go-live-packet.md:54-112` §2a — a real flag's nine points, incl. *"prefer `--set …=0` over `delete`"*, the honest ⚠️ on the real-device pass, and the post-flip verification trail.
- `10-roadmap/observability-plan.md` frontmatter — read for house form only.
- `00-program-control/MASTER_CHECKLIST.md:43` — item 37, this file, owner H-07.

⚠️ **Not a source:** `C:\Users\Patrick\uct-worktrees\terminal-research\CLAUDE.md`, which the
harness auto-loads into this worktree and which says of itself that it is eight recorded
facts behind and that two of its claims are actively dangerous. Everything above was read
from the `_merge-master` copy.
