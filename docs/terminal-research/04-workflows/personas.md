---
id: F-07-PERSONAS
title: User Persona Framework — five roles, three occupants, and a slot declared empty
role: MASTER_CHECKLIST item 12 ("User Persona Framework"), gate 10, owned by F-07 (`AGENT_REGISTRY.md:139`, "Workflow / JTBD synthesizer"). ⛔ There is NO contract file for F-07 — `ls 00-program-control/contracts/ | grep -c '^F-07'` → 0. Written against `contracts/_SHARED_PREAMBLE.md` plus the MASTER_CHECKLIST row, exactly as its two siblings were; that absence is in `## GAPS`, not papered over. Siblings at the same address: `jobs-to-be-done.md` (item 13, DRAFT COMPLETE, 45 jobs) and `workflow-library.md` (item 14, DRAFT COMPLETE, 38 workflows) are the inputs; `daily-journey.md` is NOT STARTED and nothing here writes it.
wave: 1
group: F
category: synthesis
scope: 04-workflows/ — the persona/role layer over items 13 and 14; no new primary research
confidence: 🟡 overall — every role attribute carries a tier and a source; the segmentation half is 🔴 by construction and says so
evidence_ceiling: Zero member research anywhere in the inputs, and no account-to-person mapping anywhere in the tree. One confirmed subject, who CARD 22 rules is the worst available one. The member role is therefore declared EMPTY rather than filled.
sources: 04-workflows/jobs-to-be-done.md, 04-workflows/workflow-library.md, 12-decisions/DECISION_CARDS_2026-09-26.md (CARDs 17/22/23/24/25/29/30), 00-program-control/GOVERNING_PRINCIPLES.md, 00-program-control/charter/C-master-directive.md PARTS XV-XVIII, 00-program-control/charter/OWNER_SEED_FACTS.md, 00-program-control/OWNER_INPUTS_REQUESTED.md, 00-program-control/CRITICAL_PATH.md, verification/2026-09-14/OI-06-telemetry-derived-defaults.md, 05-product-strategy/non-goals.md, 09-security-licensing-cost/security-entitlement-architecture.md, 10-roadmap/mvp.md, origin/master @ 2e0598bfa514303fe542c4473bd2f89470d04ec2
uct_relevance: high
status: draft
date: 2026-09-26
---

# USER PERSONA FRAMEWORK — five roles, three occupants, and a slot declared empty

> **Every code read in this file is against `origin/master` @
> `2e0598bfa514303fe542c4473bd2f89470d04ec2`** (`git rev-parse origin/master`, 2026-09-26). This
> branch is an older docs branch; nothing here was read from the worktree's own checkout.
> ⚠️ Item 14 pinned master at `74bdf4f68dd020af10a64b3cb5a6a64e0751ac11`. Master has moved since,
> so every code-derived number quoted *from* item 14 is dated to that earlier blob and was **not**
> re-derived here — see §10 C-P7.

---

## 0. ⛔⛔ THE VERDICT ON WHETHER THIS DOCUMENT SHOULD EXIST AT ALL

**It should not exist in its conventional form, and it does need to exist in the form below. Both
halves of that sentence are load-bearing, and the brief asked to be argued with rather than obeyed.**

### 0.1 The case against the conventional form, which is decisive

A persona document, as the genre supplies it, is three named people with ages, screenshots of their
mornings and quotes nobody said. **This programme has already ruled on exactly that artifact.**
`DECISION_CARDS_2026-09-26.md` CARD 22 refused a simulated beta test on the ground that *"a simulated
trader preferring a simulated terminal is evidence about the simulation"*, and called running one and
reporting a verdict *"this programme's signature failure — an instrument that cannot observe the thing
it names"*. ⛔ **A persona invented and then reasoned from is the same instrument with the same defect,
one layer earlier**: instead of simulating a *verdict*, it simulates the *subject*. Item 14 §2.3
already derived the sequence-specific form of the rule — *"a sequence attributed to 'professional
traders' with no artifact is a fabrication"* — and the person-specific form is the one this file owes.

⭐ **And the genre's danger is precisely its memorability.** The three things a reader of a persona
document retains — the name, the age, the narrated morning — are the three things no evidence here
supports. A table of tiers is forgotten; "Marcus, 34, checks his phone on the train" is quoted in a
roadmap meeting six months later as though it were measured. **The invented part outlives the labelled
part.** That asymmetry, not squeamishness about fiction, is why the refusals in §2.3 are absolute.

### 0.2 The case for the re-shaped form, which is also decisive

⭐⭐ **The charter never asked for the conventional form.** Read what Document C actually prescribes.
`grep -cE '^# PART [IVXLCDM]+ — .*PERSONA$' 00-program-control/charter/C-master-directive.md` → **4**,
and all four are written as **evaluative lenses with a test attached**, not as market segments:

- PART XV (`:651`): *"Create a dedicated trader persona and use it continuously… Every major interface
  decision should be evaluated by this persona. Ask: **Can an experienced trader accomplish the task
  faster after learning the system?**"*
- PART XVI (`:663`): *"Ask: **Does the terminal accelerate genuine company understanding rather than
  merely displaying market data?**"*
- PART XVII (`:671`): *"**Power should be discoverable without making the default product
  incomprehensible.**"* — and explicitly *"Do not automatically implement these exact modes. Explore
  whether this concept is useful."*
- PART XVIII (`:683`): a list of business dimensions to evaluate against.

**Not one of them asks for a name, an age, a photograph or a day in the life.** Every one ends in a
question you can put to a screen. ⛔ **So the conventional persona document is not what the charter
ordered — it is what the genre supplies when nobody checks.** A lens has a test attached; a segment
has a story attached. The charter asks for tests, and tests are writable from this evidence.

The second argument is CARD 29's: **jobs carry the verdict, features carry the evidence.** A persona is
neither, so it can only earn its place as an **index** — a way of asking which jobs travel together,
for one actor, on one clock, and which tools that actor leaves for. That index *is* derivable, because
items 13 and 14 already carry the jobs, the sequences and the break-out points. What is not derivable
is who else, besides the one confirmed actor, occupies it.

### 0.3 What this file therefore is, in one sentence

**Five roles defined by the work they do and the tools they break out to, with an evidence tier on
every attribute — of which three are three role-hours of the SAME confirmed person, one is a slot
declared EMPTY, and one exists because a ruling created it and has no occupant.** Plus eight
explicitly labelled hypotheses, each with the cheapest observation that would confirm it, and five
roles this product structurally cannot serve.

⛔⛔ **The segmentation half — "how many kinds of member are there" — is INCONCLUSIVE BY
CONSTRUCTION, in CARD 22's own vocabulary, and its blocking input is named: OI-02.**
`OWNER_INPUTS_REQUESTED.md:10` reads *"Internal dogfooders: how many people, which roles (trader /
analyst / partner), and who decides 'we prefer it'"*, and its own consequence column names **"persona
weighting"**. It is unanswered, its stated default is *"2–5 internal users: the owner plus at least one
partner"*, and CARD 22 §6 records that **OI-02 being answered supersedes CARD 22.** ⭐ So the question
this deliverable exists to answer has a known owner, a known channel and one open question — which is
a far more useful output than three invented traders, and is the whole reason the empty slot in §4 is
written as a row rather than omitted.

---

## 1. The population, stated once, with its sensitivity derived rather than asserted

⛔ **Never compute a percentage off this population. The reason, derived rather than asserted:**

```
python -c "
for n,label in ((26,'CARD 25 §3 ~26 accounts'),(29,'in-pod roster 29 users'),(23,'29 minus 6 admins'),
               (13,'13 with any page_views row'),(17,'17 stored layouts')):
    print(f'{label:32s} n={n:3d}  one account = {100.0/n:.2f} points')"
```

| denominator | n | one account moves a rate by |
|---|---|---|
| CARD 25 §3, *"~26 accounts"* | 26 | **3.85 points** |
| the in-pod read, *"29 users"* | 29 | **3.45 points** |
| members only (29 − 6 admins) | 23 | **4.35 points** |
| accounts with any `page_views` row | 13 | **7.69 points** |
| stored `charts_workspace_layout` blobs | 17 | **5.88 points** |

⭐⭐ **The sensitivity figure in circulation is 3.85, which is `1/26` — and 26 is not the number the
primary measurement reports.** `verification/2026-09-14/OI-06-telemetry-derived-defaults.md` states
**29 users, 6 admin · 23 member, 13 with any `page_views` row**, read in-pod against `/data/auth.db` at
`mode=ro`; item 14 §2.3 and `10-roadmap/mvp.md:326` both carry 29. CARD 25 §3 carries ~26. ⛔ **So the
choice of denominator alone moves the per-account sensitivity by a factor of 2.2**, from 3.45 to 7.69,
before anybody has measured anything. **That is the argument for an existence check, and it is
arithmetic rather than caution.** The discrepancy itself is recorded in §10 C-P1 and not resolved.

**The other population, kept strictly separate.** ~750 paying Discord members belong to the **Whop
product**, a separate live-trading-Discord product outside this programme's boundary (CARD 23, CARD 25
§3). ⛔ **Nothing in this file merges the two, and no role below is defined on Whop behaviour.** ⭐
What they legitimately are is the **recruitment pool** for the one thing CARD 22 §6 still needs: a
named non-builder subject. CARD 25 §3 makes exactly that point — *"the subject pool is not empty; it is
large, reachable, and already transacting"* — and that is the only use this file makes of the figure.

**One measurement spans more than the owner, and it is the only one that does.**
`OWNER_INPUTS_REQUESTED.md:25` (OI-19, ANSWERED-BY-MEASUREMENT 2026-09-18) counted
`j2_option_strategies` grouped by `strategy_type` against production: **6,131 recorded strategies,
`long_call` 5,263 · `long_put` 733 · `short_call` 94 · `short_put` 40 · `vertical_debit_put` 1** — and
states in its own cell that this is *"member-wide journal data, not the owner's personal trades
alone"*. ⚠️ **It was not grouped by account.** So 6,131 rows are consistent with many members trading
single legs and equally consistent with one account doing so. It is used in §5 as a bound on a role's
plausibility and in §6 as HYP-P06, never as a distribution.

---

## 2. Method

### 2.1 The unit: a role-hour, not a person

⭐ A **role** here is *a bundle of jobs with a shared clock, a shared surface set and a shared
break-out profile.* It is deliberately not a person, for the reason §4 makes plain: the three
occupied roles below are **the same human at different hours**, and writing them as three people would
invite a roadmap to build three products for one man.

**The test applied before a role was kept:** *could two different people occupy this role at the same
time without colliding?* If yes it is a role; if the only thing holding the bundle together is that
one person happens to do all of it, it is a **schedule**, not a role. R-01, R-02 and R-03 pass because
each has a separate surface set and a separate break-out profile; the reason they read as one person is
headcount, not structure.

### 2.2 The evidence tiers

Item 14 §2.2's five tiers are inherited verbatim and not re-derived: **T1** owner testimony (Level-1,
`GOVERNING_PRINCIPLES.md` §2) · **T2** a scheduled job · **T3** a recorded incident with a date ·
**T4** production telemetry, as an existence check only · **T5** code paths and in-file comments,
labelled CLAIM unless confirmed, and re-grepped with a date per CARD 24.

⭐ **One tier is added here, because neither sibling needed it and a persona document cannot do without
it: T0 — an owner ruling or a governing default.** CARD 22's split of recorder from adjudicator, and
`GOVERNING_PRINCIPLES.md` §13's *"no execution or order management"*, are not testimony about
behaviour; they **create or forbid a role outright**. ⛔ For this deliverable T0 outranks T1, because a
ruling cannot be wrong about the world — it defines the part of the world the product may occupy. **The
two most confident rows in this file (R-05 and NS-01) rest on rulings, not observations**, and that is
not a weakness of the evidence: it is the only tier here that is not an inference about a person.

⚠️ **And a correction to the brief this file was written against, which invited one.** The brief
states that a scheduled job is the strongest evidence of a real recurring workflow, *"because somebody
automated it after doing it by hand."* Item 14 §2.2 tier 2 says the sharper thing: *"A cron line
proves intent, never use."* **Both are right about different halves.** A `CronTrigger` is strong
evidence that the work RECURS and that a person wanted it to; it is **no** evidence that anybody reads
the output. The worked counterexample is in item 14 §5.4: **WF-C08 is fully substituted — break-out
NONE — and measurably barely used, at 16 `calendar_seen` rows in total.** ⛔ A role built on cron lines
alone would therefore describe a machine's day and call it a person's attention. Every scheduled-job
attribute below is labelled T2 and says what it does and does not establish.

### 2.3 ⛔ The refusals, and they are absolute

1. **No invented name, no demographic, no age, no photograph, no location, no tenure.** Nothing in the
   inputs carries any of it, for any actor, including the owner.
2. **No "day in the life" narrative.** Item 14 §2.6 already refused a merged timeline for a
   measurement reason (two clocks, one legible) and `daily-journey.md` is a separate NOT-STARTED
   deliverable. A narrative here would both duplicate it and invent the half that is unreadable.
3. **No quotes.** The only verbatim statements available are the owner's, and they are quoted from the
   cards that recorded them, attributed and dated. Nothing is put in anybody's mouth.
4. **No role defined by tier.** CARD 17: *"there is one paid tier only that is it."* `non-goals.md`
   NG-05: *"The entitlement axis is a **binary**."* So there is no free-versus-paid segmentation to
   describe and no upgrade persona to design for. §3 records what the code actually distinguishes.
5. **No percentage, no rate, no share, no "most members".** §1 is the derivation.
6. **No role whose defining job is placing a trade.** NG-01/02/03 and §13. Such a role is described in
   §5 as unservable rather than designed for.
7. **No cost, price, willingness-to-pay or pricing psychology.** CARD 25 §5, owner verbatim: *"Dont
   worry aobut anything else on costs or uses."* CARD 30 §3 confirms item 34 de-scoped. §7 records the
   consequence for charter PART XVIII's lens, which is the one place this bites.

### 2.4 Counting discipline

⛔ No count in this file is hand-typed beside the artifact that owns it. Each is a command.

- **Roles** = `grep -c '^#### R-0' 04-workflows/personas.md`
- **Roles with a confirmed occupant** = `grep -c '^#### R-0.*· OCCUPIED' 04-workflows/personas.md`
- **Roles declared unoccupied** = `grep -c '^#### R-0.*· UNOCCUPIED' 04-workflows/personas.md`
  ⚠️ **The `· ` in those two patterns is load-bearing** — `UNOCCUPIED` contains `OCCUPIED`, so a naive
  `'OCCUPIED'` would count all five roles as occupied. ⭐ Every command in this list was run against
  this file before it was committed to; a counting command that cannot distinguish is the same defect
  as a hand-typed count.
- **Labelled hypotheses** = `grep -c '^#### HYP-P' 04-workflows/personas.md`
- **Structurally unservable roles** = `grep -c '^#### NS-0' 04-workflows/personas.md`
- **Charter persona lenses** =
  `grep -cE '^# PART [IVXLCDM]+ — .*PERSONA$' 00-program-control/charter/C-master-directive.md` → **4**

Inputs, with the commands their own files state:

```
grep -c '^#### JTBD-'      04-workflows/jobs-to-be-done.md   -> 45
grep -c '^#### WEAK-'      04-workflows/jobs-to-be-done.md   ->  6
grep -c '^#### WF-'        04-workflows/workflow-library.md  -> 38
grep -c '^#### WEAK-WF-'   04-workflows/workflow-library.md  ->  6
```

**Item 13's job families**, derived per prefix (`for p in P O M C E W X B; do grep -c "^#### JTBD-$p" …`):
P **7** · O **4** · M **7** · C **3** · E **4** · W **4** · X **12** · B **4** — summing to 45, so a
misfiled prefix is catchable by one addition.

**Item 14's groups**, derived by sectioning §4 (`sed -n '/^### 4.N Group/,/^### 4.N+1 /p' | grep -c '^#### WF-'`):
A **7** · B **8** · C **14** · D **7** · E **2** — summing to 38.

**Item 14's break-out classes, RE-DERIVED here rather than quoted** (its §2.5 commands, run 2026-09-26):

```
NONE 7 · ADDRESSABLE 5 · STRUCTURAL 14 · NOT MEASURED 1 · N/A 11      sum = 38 = the workflow count
```

⚠️ **`MASTER_CHECKLIST.md:20` quotes NONE 5 · ADDRESSABLE 7.** The two figures swapped when item 14's
§5.1 correction withdrew `WF-C03` and `WF-C06` from ADDRESSABLE, and the checklist row was not
updated. **The file's own closure invariant still holds at 38**, which is how the move was caught
without trusting either number. §10 C-P5.

**Code derivations** (all at `2e0598bfa`):

```
# the actor classes the product enforces
python -c "import subprocess,ast; src=subprocess.run(['git','show','origin/master:api/middleware/auth_middleware.py'],
  capture_output=True,text=True).stdout; t=ast.parse(src);
  print([n.name for n in t.body if isinstance(n,ast.FunctionDef)])"
# -> 9 module-level functions; PAID_PLANS members -> 3  ['lifetime','premium','pro']

git show origin/master:app/src/constants/freePages.js        # -> FREE_PAGES = ['/morning-wire']
git grep -l  "require_admin" origin/master -- api | wc -l    # -> 51 files
git grep -lE "isAdmin|role *=== *'admin'" origin/master -- app/src | wc -l   # -> 53 files
git grep -n  "DensitySwitcher" origin/master -- app/src      # -> component, its test, and the barrel only
```

---

## 3. The actor classes the PRODUCT ITSELF enforces — the one axis that is measured

⭐ **This section is 🟢 and the rest of the file is not, for a structural reason: these distinctions are
evaluated on every single request.** They are not inferences about people; they are the product's own
answer to "who is asking".

**OBSERVATION.** `api/middleware/auth_middleware.py` (9 module-level functions, AST-derived) resolves
every request into one of four outcomes:

| class | how the product decides | what it sees |
|---|---|---|
| **anonymous** | `get_current_user` raises 401 when `validate_session` returns falsy (`:17-22`) | only `FREE_PAGES = ['/morning-wire']`, the single free route (`app/src/constants/freePages.js`) |
| **authenticated, not entitled** | `require_plan` → `meets_plan_gate` false → 403 *"Upgrade required"* (`:63-73`) | the free route and `/settings` |
| **entitled** | `meets_plan_gate` true (`:35-61`) | everything not admin-gated |
| **admin** | `require_admin`, `user.get("role") != "admin"` → 403 (`:75-79`) | additionally, 51 api files and 53 `app/src` files carry an admin-only branch |

**EVIDENCE.** CONFIRMED by code at the pinned SHA; the admin-branch file counts are `git grep -l`
derivations, above. The admin-only member-visible example: `app/src/pages/Breadth.jsx:529-530`,
`BreadthTabs({ isAdmin })` → `resolveBreadthTabs(isAdmin)`, which adds a tab for admins alone.

**INTERPRETATION — and here is the one contradiction worth surfacing rather than smoothing.** NG-05
states *"the entitlement axis is a binary"*, and as to **capability** that is exactly right:
`meets_plan_gate` is one boolean and nothing downstream branches on which plan satisfied it. ⛔ **But
there are at least five distinct ways to be on the allowed side of that one boundary** — `PAID_PLANS`
holds **3** strings (`lifetime`, `premium`, `pro`), plus `comped`, plus an in-trial account, plus
admin, which *"always passes regardless of plan"*. **One entitlement boundary; five admission routes,
all recorded per-account in `auth.db`.** That is not a capability axis and must never be surfaced as
one (NG-05 forbids it), but it **is** a real, already-stored distinction in how an account arrived —
and the only such distinction the estate records. §10 C-P3.

⭐⭐ **A fifth actor class exists, and it is not an entitlement class at all — it is an EDITORIAL SEAT.**
`api/routers/wire_feedback.py:58` stamps `is_admin = 1 if user.get("role") == "admin" else 0` on
**every** per-segment vote, and `:81` exposes only `store.recent_admin_votes(days=days)` to the engine.
**So a member may vote on the letter and the loop that rewrites tomorrow's letter will not read it.**
That is a code-enforced two-seat model — a reader seat and an editorial seat — inside the publisher
workflow, and it is the single strongest piece of evidence in this file that R-02 below is a genuine
role rather than a spare hour of R-01's.

**RELEVANCE TO UCT.** ⛔ The admin class is **not** a tier and must not be modelled as one: per
`09-security-licensing-cost/security-entitlement-architecture.md` (§ INTERPRETATION, `:258-265`) admin
is *"deploy-coupled, code-coupled"*, has **no revocation path in the application**, and
*"admin ⇒ paid-equivalent"* so there is *"no 'admin but not paid' and no 'read-only admin'"*. Its
DP-5 (`:725`) asks whether a staff tier finer than admin — *"support, read-only desk, contractor"* —
should exist, and assigns it to the **Owner**. ⭐ **That question is a persona question wearing an
entitlements costume, and it is the one this file most wants answered**, because it decides whether
"admin" names a desk trader or a mixed bag of operators. See HYP-P08 and §10 C-P2.

**CONFIDENCE.** 🟢 on the mechanism, at the pinned SHA. 🔴 on **who holds each class** — no
account-to-person mapping exists anywhere in this programme's tree (GAPS 2).

---

## 4. The roles — derived from evidenced jobs and workflows

⛔⛔ **Read this section's shape before its rows. R-01, R-02 and R-03 are almost certainly the SAME
PERSON at three different hours.** Three roles, one confirmed occupant. That is the honest finding and
it is the one a roadmap most needs, because three roles read as three audiences, and building three
products for one man is the failure mode this framing exists to prevent. ⭐ Each is nevertheless a
separate role by §2.1's test — separate surface set, separate break-out profile, and in R-02's case a
separate **seat** enforced in code (§3) — which is why they are not collapsed.

⚠️ **And CARD 22 §1.1 sharpens it in the direction nobody wants: the one confirmed occupant is the
WORST available subject, not the most convenient one** — *"his switching cost is ~0 and he needs no
onboarding"*, and *"a builder's session is QA and in a log QA is indistinguishable from preference."*
So the same person who makes these three roles evidenced also makes them unusable as a verdict. **Every
row below is therefore useful for DESIGN and inadmissible as ACCEPTANCE.**

---

#### R-01 — The desk at a screen · OCCUPIED (one confirmed occupant)

| attribute | value | tier | source |
|---|---|---|---|
| Occupant | the owner, confirmed | **T1** | OI-06 answered directly 2026-09-19 (`OWNER_INPUTS_REQUESTED.md:14`; `DECISION_CARDS_2026-09-18.md` §7d); CARD 25 §4 *"Assume that i personally use every other site mentioned"* |
| Jobs it holds | item 13's hour families P **7** · O **4** · M **7** · C **3** = **21** of 45 | **T5/T3** | `jobs-to-be-done.md` §3.1–3.4, counts derived §2.4 |
| Sequences | item 14 Group C, **14** workflows | **T5** | `workflow-library.md` §4.3, count derived §2.4 |
| Opens on | `/dashboard` — **22** of 50 admin session-days, first by a factor of two | **T4** | `OI-06-telemetry-derived-defaults.md` §2 |
| Lives in | `/journal/notebook` **1097** views · `/charts` **1010** · `/dashboard` **809** | **T4** | ibid. ⭐ *"The desk OPENS on the dashboard and LIVES in the notebook and charts"* — the two orderings disagree and the disagreement is the finding |
| Surfaces touched per account | min 1 · **median 11** · max 56, over 13 accounts | **T4** | ibid. §1. ⚠️ *"n = 13. That is a listing, not a statistic"* |
| Customises its screen | **17** stored layouts, **7** distinct widget signatures, blob bytes 111→6731 | **T4** | ibid. §4. ⭐ a 60× spread in appetite; **9 of 17 diverge from the largest cluster** |
| Breaks out to | finviz.com · TradingView · thinkorswim | **T1** tool / **T5** step | `workflow-library.md` §5.1 — **4 of the 5 surviving ADDRESSABLE rows are Group C** (WF-C09, C11, C12, C13) |
| Break-out posture | *"let me look at it properly"* (WF-C09, C13) and *"let me express a condition and receive it back"* (WF-C11, C12) | **T5** | ibid. ⛔ *"None of these postures is a screen. A roadmap that answers them with pages will leave the tabs open."* |
| Time on task, frequency, rank | **NOT DETERMINED, permanently as far as these inputs reach** | — | the owner was asked to rank by time spent and declined (`jobs-to-be-done.md` GAPS 2) |

⛔ **The last row is the one that matters most, because charter PART XV's persona opens with *"This
person spends hours per day in the product"* — and that clause is unevidenced for any actor in this
estate.** No timing artifact exists anywhere in the inputs. §7 records what that does to PART XV's own
test.

**CONFIDENCE.** 🟡 — 🟢 that the role exists and is occupied; 🔴 on everything about how much of a day
it consumes and in what order. **EVIDENCE CEILING:** the session-opener ordering is **admin-only** (50
day-sessions) while the total-views column spans all 13 accounts with rows — *"the two halves of that
finding have different populations"* (item 14 §2.3). Raised by one recorded morning's click sequence,
which item 13 GAPS 1 names as *"the single cheapest thing that would move this file"*.

---

#### R-02 — The desk as publisher · OCCUPIED (one confirmed occupant, and a code-enforced second seat)

| attribute | value | tier | source |
|---|---|---|---|
| Jobs it holds | item 13's B family, **4** of 45 | **T5** | `jobs-to-be-done.md` §3.8 |
| Sequences | item 14 Group D, **7** workflows | **T5/T2** | `workflow-library.md` §4.4 |
| Its clock | wire critic **05:00 CT** = 06:00 ET; the Saturday week post **04:30 ET** | **T1/T2** | `OWNER_SEED_FACTS.md:20`; `workflow-library.md` §3.1 |
| Seat model | **enforced in code**: every wire-segment vote is stamped `is_admin`, and only admin votes reach the engine | **T5** | `api/routers/wire_feedback.py:58`, `:81` @ `2e0598bfa` |
| Break-out profile | **STRUCTURAL by choice** — Discord, Substack, YouTube, Zoom | **T5** | `workflow-library.md` §5.2 |
| Its tightest loop | **WF-D02**, break-out **NONE** — *"the tightest loop in the estate because every step is ours"* | **T5** | ibid. §5.4 |

⭐⭐ **R-02's break-out profile is the INVERSE of R-01's, and that inversion is the reason it is a
separate role rather than a spare hour.** R-01's exits are ADDRESSABLE — a named tool at a named step,
closable in principle. R-02's exits are STRUCTURAL and are **destinations we chose**: item 14 §5.2's
own reading is that *"most structural exits are destinations we chose — publishing to the audience
where the audience is. Those are not failures of aggregation."* ⛔ **A coverage ledger that treats
R-02's exits as gaps will try to close an exit that is the feature.** Under CARD 25's aggregation
thesis that is the single most available misreading, and this row exists to block it.

**CONFIDENCE.** 🟢 on the sequences and the seat model. 🔴 on whether anyone but the owner has ever
occupied the editorial seat — see HYP-P03.

---

#### R-03 — The desk as operator of its own machines · OCCUPIED (one confirmed occupant)

| attribute | value | tier | source |
|---|---|---|---|
| Sequences | item 14 Groups A + B, **7 + 8 = 15** workflows | **T2** | `workflow-library.md` §4.1–4.2 |
| Its own machine's roster | **9** jobs named at Level-1, *"None of this is visible from any repository runtime. Start times are local Central Time."* | **T1** | `OWNER_SEED_FACTS.md:20`; derivation `workflow-library.md` §2.5 |
| The pod's roster | **168** scheduler registrations, AST-derived, **164** with literal ids, **68** naming `mon-fri` | **T5** | `workflow-library.md` §2.5 ⚠️ **at SHA `74bdf4f68`, not re-derived here** (§10 C-P7) |
| Legibility | **half.** The consumer's clock answers a grep; the producer's does not | **T1/T5** | ibid. F2 |
| Known unreadable members | *"EOD updater"* and *"market ingest"* are **names only**; a tenth PC job (`CLAUDE.md:572-573`) is absent from the Level-1 roster | **T1/T5** | ibid. §3.1 — *"The PC roster is not a closed list."* |
| Busiest hour | **08:00–09:30 ET, before the bell** | **T2** | ibid. §3.2 — several subsystems each schedule a pre-open pass *"to have an answer ready before a person asks"* |

⭐ **What a cron line establishes, precisely.** That the work recurs, and that a person wanted it to.
Item 14 §2.2 tier 2 records two `CronTrigger`s that name the person in the comment — the catalyst
hunter's *"(user-defined 2026-07-02): traders check the board at 8:00 / 8:30 / 8:45 AM ET"*
(`api/main.py:6832-6835`), and the buzz digest's *"The owner asked for the board through the session
(2026-09-02), not once at the close"* (`:6502-6504`). ⛔ **What it does not establish is attention.**
See §2.2's WF-C08 counterexample.

⭐⭐ **Why this role is load-bearing for CARD 22 specifically: you cannot withdraw a scheduled job
from the person who wrote the cron.** The withdrawal test — *"turn the surface off for a defined
block, unannounced"*, the one instrument two of three reviewers invented independently — is
structurally inapplicable to R-03, because R-03 is the party who would have to perform the withdrawal
on itself. **That is CARD 22 §1.1's "worst available subject" restated as a mechanism rather than a
judgement**, and it is the sharpest available argument for why a non-builder subject is required
rather than preferred.

**CONFIDENCE.** 🟢 on the pod half (fully derivable). 🔴 on the PC half's times, which *"exist only
outside this programme's tree"*.

---

#### R-04 — The member at a screen · UNOCCUPIED, AND DELIBERATELY DECLARED EMPTY

⛔⛔ **This row is the reason the document is worth writing. It is a slot with no occupant in evidence,
and filling it is the single worst error available here.**

**What evidences the SLOT (that the seat exists and is sat in by somebody):**

| signal | value | tier | source |
|---|---|---|---|
| member accounts | **23** of 29 | T4 | `OI-06-telemetry-derived-defaults.md` header |
| accounts with any `page_views` row | **13**, six of the roster being admins | T4 | ibid. |
| alerts fired in production | **956** `calendar_alerts_fired` rows | T4 | ibid. §5 — the **highest-volume member-side artifact in the programme** |
| AI lane use | **79** `ai_search_log` rows | T4 | ibid. |
| unseen-state use | **16** `calendar_seen` rows in total | T4 | ibid. §3 |
| journal option strategies | **6,131**, 98%+ directional single-leg, **not grouped by account** | T4 | `OWNER_INPUTS_REQUESTED.md:25` |
| screens built and kept | **17** layouts, **7** signatures, **9 of 17** diverging from the largest cluster | T4 | ibid. §4 |

**What evidences the EMPTINESS (that no member ROLE can be stated):**

1. ⛔ **No member sequence exists anywhere in the inputs.** Item 14 quarantines *"the member's own
   morning"* as `WEAK-WF-01` for exactly this reason: *"the only ordering the programme owns is admin
   session-days… There is no member sequence in the inputs, and constructing one would be the CARD 22
   error applied to a morning."*
2. ⛔ **Zero member research, and it is named as the ceiling on everything.** Item 13 GAPS 1: *"No
   interview, survey, session recording, click path, support ticket, churn reason or win/loss note
   exists in the inputs."*
3. ⛔ **A substitute was attempted and refused twice.** `10-roadmap/mvp.md` §4.3, citing item 35's
   PH-5: an aggregate route-breadth substitute was *"attempted twice, two different formulations,
   refused both times"* under production-read permissions, against a population of *"13 accounts of
   which 6 are admins"*.
4. ⚠️ **The one populous measurement is ungrouped.** 6,131 option strategies is an existence check on
   *a* shape of trading, not on *how many* members hold it (§1).

⭐⭐ **So R-04 is written as a row with an empty occupant field rather than omitted, because the
absence is a finding and an omission would read as an oversight.** Every hypothesis in §6 is an
attempt to put one attribute into this row at the cost of one cheap observation — and until one lands,
**this is where a conventional persona document would have invented three people.**

**CONFIDENCE.** 🟢 that the slot exists (seven independent production signals). 🔴🔴 that anything can
be said about its occupant. **EVIDENCE CEILING:** absolute at this headcount. Raised only by OI-02, or
by one named subject from the Whop recruitment pool per CARD 22 §6.

---

#### R-05 — The adjudicator · UNOCCUPIED, AND REQUIRED BY RULING

⭐⭐ **The only role in this programme whose existence is established by a RULING rather than an
observation — which makes it, on §2.2's scale, the best-evidenced role in this file (T0).**

CARD 22 §2 rules: *"adopt the methodologist's split… Recorder and adjudicator are different people.
The adjudicator's act is not 'did we like it' but 'does this record satisfy the rule signed on date
D', answered **PASS / FAIL / INCONCLUSIVE**."*

| attribute | value | tier | source |
|---|---|---|---|
| Created by | an owner-delegated ruling, 2026-09-26 | **T0** | CARD 22 §2 |
| Must NOT be | a subject of the trial | **T0** | ibid. §1.1 — *"a subject cannot adjudicate their own preference"* |
| Its act | apply a pre-committed rule; answer PASS / FAIL / INCONCLUSIVE | **T0** | ibid. §2 |
| Its blocking pre-condition | **PRE-REGISTRATION** — workflow, incumbent tool, subject and span in a dated artifact whose timestamp precedes day 1 | **T0** | ibid. §4 — *"Absent ⇒ the claim is blocked regardless of anyone's opinion"* |
| Its sequences | item 14 Group E, **2** workflows (WF-E01 measuring preference; WF-E02 choosing what to pre-register) | **T5** | `workflow-library.md` §4.5 |
| Occupant | **NONE NAMED.** ⛔ *"if no non-subject adjudicator exists at this headcount, the verdict is INCONCLUSIVE-BY-CONSTRUCTION and says so on its face. It does not become a PASS because nobody was available to disagree."* | **T0** | CARD 22 §2, §6 |

⚠️ **Including a programme role in a user-persona framework is a judgement call and is labelled as
one.** R-05 is not a user of the product. It is included because OI-02's third clause — *"and who
decides 'we prefer it'"* — is a persona question the programme has already ruled on, and because a
persona framework that omits the only role the owner has been asked by name to fill would be omitting
the one actionable row.

**CONFIDENCE.** 🟢 that the role is required and what it must do. 🔴 that it can be filled at this
headcount — which is itself CARD 22 §6's stated finding.

---

## 5. ⛔ The roles this product structurally cannot serve — and why naming them is the useful half

⭐ A coverage ledger written under CARD 25's *"someone can only use our site"* thesis needs this
section more than it needs §4, because **an exit that cannot be closed must never be counted as a
coverage failure somebody could fix** (CARD 25 §2). Three kinds of row appear here and the kind is
stated, because they are not equally reversible.

#### NS-01 — The executing trader · KIND: governing prohibition (owner-movable only)

A role whose defining job is **placing the order**. ⛔ `GOVERNING_PRINCIPLES.md` §13 and `non-goals.md`
**NG-01** (*"No execution. No order entry, no order routing, no trade placement — in any surface, for
any asset class, at any tier"*), **NG-02** (no order management, no position-of-record) and **NG-03**
(no broker write path, *"including a 'send this to my broker' bridge"* — ⚠️ **DERIVED**, integrator-
ratified per CARD 30 §1, **not** an owner ruling; do not cite it as §13). All three **PERMANENT**.

Item 14 classes `WF-C14` STRUCTURAL for exactly this reason, and CARD 25 §2 names it the ceiling the
thesis runs to: *"full substitution is achievable for research and analysis and structurally bounded at
execution."* ⭐ **So designing for this role is not ambitious, it is void** — and the correct product
statement is item 14 §5.2's: a flow ending in "place the trade" leaves our site **by design**.

#### NS-02 — The FX, fixed-income or crypto trader · KIND: governing prohibition (with a named re-open)

`non-goals.md` **NG-09**: *"No FX, no fixed income, no crypto. US equities primary; options active;
indices and ETFs as context; futures positioning (COT) as a research rail."* ⭐ Its own consequence
line is the persona statement: *"a member whose day includes FX or crypto **cannot** be fully
substituted in V1, and that is a known, dated, reversible bound."* Re-open trigger is named: **OI-05**.

#### NS-03 — The multi-leg options strategist · KIND: a MEASUREMENT, not a rule (therefore reversible)

⚠️ **This row differs in kind from NS-01 and NS-02 and the difference matters.** Nothing forbids
serving spreads. What exists is a measurement: OI-19, 2026-09-18, **6,131** recorded strategies of
which `vertical_debit_put` accounts for **1** and every condor/butterfly type for **0** —
*"98%+ directional single-leg; essentially zero spread/condor usage"*, and it *"Confirms the existing
default exactly. Market Chameleon is the resolved slot."* ⛔ **But the query was not grouped by
account**, so it bounds the role's observed volume and says nothing about its member count (§1). A
future grouping could move this row; a ruling could not.

#### NS-04 — The institutional analyst · KIND: a charter prescription the evidence does not support

⛔⛔ **This is the sharpest contradiction in the deliverable, and it is between the charter and the
programme's own findings.** Charter PART XVI (`:663`) prescribes a persona who *"studies businesses
deeply; reads filings; compares years of financial data; studies margins, valuation, competitors,
estimates, and management commentary"*. Against that, item 13 §5's "people and company intelligence"
row (quoting `best-of-breed.md` §3.2 E1, one step removed) records: best-in-class is Bloomberg `MGMT`
and it is graded **thin**, the runner-up cell is **empty**, and UCT is *"absent — no equivalent
anywhere in the ledger"*, at **🔴**.

⭐ **So PART XVI names a persona for which the product has no capability and the market has no strong
incumbent.** That is not a contradiction to resolve — both statements are true — but it is a decision
someone must take knowingly: either the lens is retired, or the gap becomes a roadmap row. §10 C-P6.
⛔ Nothing here proposes either; it is recorded so the silence is a decision rather than an oversight.

#### NS-05 — The collaborating desk · KIND: quarantined belief plus a zero-transferability finding

Two traders working one live position. Item 13 quarantines it as `WEAK-03`: partner collaboration is
evidenced only in **code** (`OWNER_SEED_FACTS.md` §4 names five partner-owned modules) and dogfooding
headcount is a **default**, not a measurement — *"Nothing evidences co-trading."* And the transferable
mechanism scores zero: `best-of-breed.md` §3.6 X1 grades Bloomberg IB's network transferability at
**zero** — *"cloning the network without the network"* (quoted via item 13 §6, one step removed).

---

## 6. HYPOTHESES — labelled, with the cheapest observation that would confirm each

⛔ **Everything in this section is a belief, not a finding.** Each row names why it is believed (a real
reason with a source, never a vibe), the cheapest observation that would confirm it, and what that
observation would decide. ⭐ **No row's observation is a build.** Where one would have been, the row
says so and is downgraded to an owner question instead.

#### HYP-P01 — More than one member role exists inside the 23 member accounts
- **Why believed.** **7** distinct widget signatures over **17** stored layouts, with **9 of 17
  diverging from the largest cluster** and blob bytes spanning **111 → 6731** — a 60× spread in how
  much screen a person builds (`OI-06-telemetry-derived-defaults.md` §4). Its own conclusion: *"P5 and
  P6 are NOT answering a need nobody has."*
- **Cheapest observation.** Join the **already-measured** signature clusters to `user_id` and `role` —
  one read-only query against `auth.db`'s `user_preferences`, **no code change**, and the same in-pod
  read that produced the byte distribution had the rows in hand.
- ⛔ **What it can and cannot yield.** At n=17 it yields a **listing** of which signatures belong to
  which accounts and whether admins cluster apart from members. **Never a rate** (§1).
- **Decides.** Whether the personalization work has one target shape or several.

#### HYP-P02 — A skill-level / density axis is real, not just prescribed
- **Why believed.** Charter PART XVII asks for exactly this axis and says *"explore whether this
  concept is useful."* And the estate half-built it: `app/src/components/mobile/DensitySwitcher.jsx`
  plus `DENSITY_OPTIONS` exist, are exported from the mobile barrel (`mobile/index.js:9`), carry a test
  (`DensitySwitcher.test.jsx`) — and are **mounted by nothing** on master @ `2e0598bfa`
  (`git grep -n "DensitySwitcher" origin/master -- app/src` returns the component, its test and the
  barrel export only). `RESEARCH_GAPS.md` RG-10 records the same thing plus the 30px-row-versus-44px-
  tap-floor tension. ⭐ **A component built, exported, tested and never mounted is evidence somebody
  believed in the axis and never got to test it.**
- **Cheapest observation.** ⛔ **Not a mount — that is a build.** One owner sentence: *does the desk
  ever use the product on a phone during RTH?* Item 13 `JTBD-X12` records 🔴 on UCT-side mobile usage
  with *"no observable can be stated"*, so nothing cheaper exists. **Filed as an OI candidate, not a
  task.**
- **Decides.** Whether Terminal-Next carries a density model at all, which RG-10 says decides the
  phone question.

#### HYP-P03 — The editorial seat can be occupied by someone who is not the owner
- **Why believed.** The two-seat model is already **in code**: `wire_feedback.py:58` stamps `is_admin`
  on every vote and `:81` feeds only admin votes to the engine (§3). A mechanism that distinguishes
  seats has anticipated a second occupant.
- **Cheapest observation.** Count the distinct `user_id`s in the wire-feedback store with
  `is_admin = 1`, and whether any non-admin row has ever been written — one read-only query.
- **Decides.** Whether R-02 is a role or a schedule, which decides whether the publisher workflows are
  designed for delegation.

#### HYP-P04 — A reader-only member exists whose entire use is the Morning Wire
- **Why believed.** `FREE_PAGES = ['/morning-wire']` is the **single** free route (derived, §2.4), the
  seed fact names the wire as the paywalled item, and CARD 17 records that *which* page is free is now
  *"the only remaining lever on acquisition"*. ⚠️ **And the striking observation, stated with its
  bound:** `/morning-wire` appears **once** as a session-opener in 50 admin day-sessions and does not
  appear in the total-views column at all — but **that column is a top-12 listing**, so its absence
  bounds its views **below `/settings`'s 74** and is **not a zero**.
- **Cheapest observation.** One read-only count of `page_views` rows where the page is
  `/morning-wire`, by account — the same in-pod read already had the table open.
- **Decides.** Whether the acquisition surface has any measured traffic, which is the one thing CARD
  17's "only remaining lever" claim rests on and nothing has measured.

#### HYP-P05 — The alert consumer is a distinct role, not an attribute of R-01
- **Why believed.** **956** `calendar_alerts_fired` rows against **79** `ai_search_log` and **16**
  `calendar_seen` — alerts are the highest-volume member-side artifact in the programme by more than
  an order of magnitude. And item 13 ranks `JTBD-M06` (*be told when something happens*) **third of
  45**, on the ground that it is the only job for which the owner volunteered an external dependency
  unprompted — TradingView alerts, confirmed in the workflow 2026-09-19.
- **Cheapest observation.** `calendar_alerts_fired` grouped by `user_id` — one read-only query against
  `calendar_alerts.db` (named explicitly in OI-21's corrected cell, `OWNER_INPUTS_REQUESTED.md:34`).
- ⛔ Yields a listing. **Never a rate.**
- **Decides.** Whether the alert lane serves one heavy account or a spread, which decides whether
  item 14's `WF-B06` break-out (currently the only 🟢-tool ADDRESSABLE row) is one person's exit or a
  population's.

#### HYP-P06 — The directional single-leg trader is the dominant member shape, not one account's habit
- **Why believed.** OI-19's 6,131 strategies, 98%+ `long_call`/`long_put`, stated in its own cell as
  member-wide.
- **Cheapest observation.** Re-run the same query with `GROUP BY account` — one clause added to a
  query already written and already run.
- **Decides.** Whether NS-03 is a measured product boundary or an artifact of one account (§5).

#### HYP-P07 — A non-builder subject exists and is reachable
- **Why believed.** CARD 25 §3: **~750 people already paying for a sibling product.** *"The subject
  pool is not empty; it is large, reachable, and already transacting… But 'there isn't one' is no
  longer the likely answer."*
- **Cheapest observation.** ⭐ **The owner names one.** Zero cost, owner-only, and it is the single
  blocking item in CARD 22 §6. ⛔ Naming a real person is not delegable and nothing here proposes a
  candidate.
- **Decides.** Whether the MVP's verdict can be anything other than INCONCLUSIVE-BY-CONSTRUCTION.

#### HYP-P08 — The admin class contains at least one non-trader
- **Why believed.** `10-roadmap/mvp.md:334` states that *"the programme already carries an outside
  contractor holding production admin as a live risk"*, and DP-5
  (`security-entitlement-architecture.md:725`) asks the owner whether a staff tier finer than admin —
  *"support, read-only desk, contractor"* — should exist. If either is right, **"6 admin accounts" is
  not "6 desk traders"**, and R-01's admin-only telemetry anchor is measuring a mixed population.
- **Cheapest observation.** Read the **6** `role = 'admin'` rows with their `created_at` and classify
  each — one read-only query, against a table the 2026-09-14 in-pod read already opened to produce
  *"6 admin · 23 member"*.
- ⚠️ **And this observation would resolve a live contradiction**, because the same programme records
  the admin roster as *"NOT DETERMINED — production `auth.db` was never read"*
  (`security-entitlement-architecture.md:271-272`) while `mvp.md:334` asserts who holds it. §10 C-P2.
- **Decides.** Whether the one telemetry anchor under R-01 is a desk signal or an operator signal —
  which is the difference between a design input and a measurement artifact.

---

## 7. The four charter lenses, re-shaped into tests that can actually be run

⭐ Charter PARTS XV–XVIII each already carry their own question. This section adds only two columns:
what evidence can answer it, and ⛔ where the lens **cannot** be run and must not be pretended.

| lens | the charter's own question, verbatim | what can answer it today | ⛔ where it cannot be run |
|---|---|---|---|
| **PART XV — Trader** (`:651`) | *"Can an experienced trader accomplish the task faster after learning the system?"* | R-01's break-out set (item 14 §5.1, 5 rows over 4 tools and 3 postures) and item 14 §7's waiting inventory | ⛔ **"faster" has no baseline.** No time-on-task figure exists for any actor, and the owner declined to rank by time spent (item 13 GAPS 2). ⚰️ **The persona's own opening clause — *"This person spends hours per day in the product"* — is unevidenced.** The lens must be run as *"does this remove a named break-out"*, not as *"is it faster"* |
| **PART XVI — Investor / Analyst** (`:663`) | *"Does the terminal accelerate genuine company understanding rather than merely displaying market data?"* | item 13 `JTBD-E02` (the per-ticker history join: 19,050 + 4,440 + 243 + 447/10,808 rows, *"no benchmarked product has it"*) and `JTBD-W04` | ⛔ **NS-04.** The filings-and-statements half is graded *"absent — no equivalent anywhere in the ledger"* at 🔴, so the lens can only be run on the desk-decision-trail half. Running it whole would score a capability that does not exist |
| **PART XVII — Member** (`:671`) | *"Power should be discoverable without making the default product incomprehensible."* | item 13 `JTBD-X09` (feature status at the point of use — served by **one** product in the set) and the 111→6731-byte layout spread | ⛔ **The mode axis has exactly one artifact and it is unmounted** (HYP-P02). ⚠️ And the charter's own instruction stands: *"Do not automatically implement these exact modes."* A Beginner/Advanced/Professional split cannot be evidenced here |
| **PART XVIII — CEO / Business** (`:683`) | evaluate *"differentiation, retention, revenue opportunity… development cost, infrastructure cost, market-data cost… pricing opportunity, premium tiers"* | the coverage half: CARD 25 §1 makes **gap coverage** the binding constraint and names item 9 *"the single most goal-aligned not-started deliverable"* | ⛔⛔ **The cost-and-pricing half of this lens is closed.** CARD 25 §5, owner verbatim: *"Dont worry aobut anything else on costs or uses"*; CARD 30 §3 confirms item 34 de-scoped; **NG-05** forbids a tier axis and **NG-06** forbids metering as a mechanism. So *"pricing opportunity"* and *"premium tiers"* are not runnable and *"infrastructure / market-data cost"* is out of scope. ⚠️ **Licensing is NOT** — CARD 26 keeps it load-bearing, and CARD 26 §4 adds that each **new** data source is its own open question |

⚠️ **PART XVIII's reading is mine and is stated so it can be corrected in one line rather than
assumed**, in CARD 25 §5's own idiom: I am treating the de-scoping as closing the cost, pricing and
tier columns of this lens while leaving differentiation, retention, moat, coverage, support burden and
legal exposure fully open. **If the cost columns are meant to be run anyway, one sentence reinstates
them.**

---

## 8. How a role earns promotion out of §6, and how one gets retired

⭐ Stated so that this file can be maintained without being rewritten, and so that promotion is a
mechanical act rather than a judgement.

1. **Promotion into §4 requires an artifact, never a second opinion.** Item 13 §7.7's rule, adopted
   verbatim: *"Promotion out of §6 requires an artefact, not a second opinion."* A hypothesis whose
   observation was run and came back ambiguous stays in §6 with the result recorded.
2. **A promoted role must carry an occupant field.** If the observation establishes the role and not
   its occupant, the row enters §4 as **UNOCCUPIED** — R-04 and R-05 are the worked examples. ⛔ An
   occupied row with an inferred occupant is the fabrication this document exists to avoid.
3. **Retirement requires quoting the reading that failed.** CARD 22's anti-waiver clause is adopted
   here for the same reason it was written there: *"a re-cut of this bar must QUOTE THE READING THAT
   FAILED. Without that, 'we re-cut the bar' and 'we failed and moved it' are the same sentence."*
4. **Every code-derived attribute carries its SHA and must be re-grepped before it is acted on.** CARD
   24's lesson: *"a COMPETITIVE dependency can be retired by ordinary refactoring while the research
   describing it stays perfectly intact."* Two attributes in this file already depend on that
   discipline — the unmounted `DensitySwitcher` (HYP-P02) and the editorial seat (§3).
5. **This file is superseded, not amended, by OI-02.** CARD 22 §6's reversal condition applies with
   the same force here, because OI-02 is the persona question: when it is answered, §4's occupant
   fields and §6's first three rows are re-derived from the answer rather than patched.

---

## 9. ⛔ What this document does NOT decide

1. **It does not name a person.** Not the owner (named only as "the owner", as every sibling does),
   not a subject, not an adjudicator, not a member. CARD 22 §6 keeps subject-naming with the owner and
   CARD 22 §5 records what happens when an argument disqualifies *"a specific person on a misread
   record"*.
2. **It does not rank the roles.** Three are one person's hours; ranking them would rank a schedule.
3. **It does not assign a role to a surface, a screen or an IA position.** Items 19–20 own that, and
   item 13 §7.3 already refused the same move for jobs.
4. **It does not decide any displace / absorb / bridge call.** It reports item 13 §4's and item 14
   §5's verdicts, each of which labels itself a hypothesis pending owner confirmation.
5. **It does not size, sequence, schedule or cost anything.** No band, no estimate, no order, and per
   CARD 25 §5 no cost of any kind.
6. **It does not establish frequency, duration, time-on-task or value for any role.** §7 records what
   that costs charter PART XV's own test.
7. **It does not write `daily-journey.md`.** The hour-by-hour narrative is a separate NOT-STARTED
   deliverable and §2.3.2 explains why duplicating it here would be invention.
8. **It does not merge the two populations, and it does not read any Whop artifact.** §1.
9. **It does not settle whether a §6 hypothesis is real.** Eight beliefs, zero findings.
10. **It does not supply the MVP verdict.** Under CARD 22 §4 that requires pre-registration, a
    non-builder subject and a non-subject adjudicator, and this file supplies none of them — it names
    the roles they would occupy.

---

## 10. Contradictions recorded, not resolved

**C-P1 — the account roster has two readings, and the sensitivity figure in circulation uses the
minority one.** CARD 25 §3 and `GOVERNING_PRINCIPLES.md` §13's corrected clause say *"~26 accounts"*;
the primary in-pod measurement says **29 users (6 admin · 23 member)**
(`OI-06-telemetry-derived-defaults.md` header), and item 14 §2.3 and `mvp.md:326` both carry 29. **The
3.85-point per-account sensitivity in general circulation is `1/26`; on the primary's 29 it is 3.45,
and on the 13 accounts that actually carry `page_views` rows it is 7.69** (§1). Not resolvable from
what this file can reach; the derivation prints all five so no reader inherits one.

**C-P2 — the admin roster is simultaneously NOT DETERMINED and asserted.**
`security-entitlement-architecture.md:271-272`: *"🔴 on **who holds it** — production `auth.db` was
never read, so the admin roster is **NOT DETERMINED**."* `mvp.md:334`: *"the programme already carries
an outside contractor holding production admin as a live risk."* ⚠️ The second sentence carries no
citation in this tree and appears exactly once outside this file —
`grep -rn -i "outside contractor" --include=*.md . | grep -v '04-workflows/personas.md'` → **1** hit
(⭐ the exclusion is necessary and is the point: **this file's own two mentions would otherwise be
counted as corroboration of the claim it is questioning**, which is the two-copies-read-as-
corroboration defect the estate has paid for twice). Either it came from outside the tree or the
roster is partly determined. **Load-bearing,
because it decides whether "admin" names a trader role or a mixed one** — HYP-P08.

**C-P3 — one entitlement boundary, five admission routes.** NG-05: *"The entitlement axis is a
**binary**."* Code at `2e0598bfa`: `PAID_PLANS` holds **3** strings (`lifetime`, `premium`, `pro`),
plus `comped`, plus an in-trial account, plus admin which *"always passes regardless of plan"*. ⭐
**Both are right about different things** — capability is one boolean, admission is five routes — and
the distinction is recorded because a persona document is exactly where they would be confused. §3.

**C-P4 — the desk-tool roster has three non-identical readings. The UNION is printed; none is
picked.**

| source | roster |
|---|---|
| `GOVERNING_PRINCIPLES.md` §13 defaults | thinkorswim/Schwab · TradingView · Finviz · Discord · Substack · YouTube |
| OI-06's answer, 2026-09-19 (`OWNER_INPUTS_REQUESTED.md:14`) | thinkorswim · TradingView · Finviz · **Unusual Whales** + *"many many many others"* |
| CARD 25 §4 | thinkorswim/Schwab · TradingView · Finviz · **Market Chameleon** *"and the other named sites"* |

⛔ **The union is the only honest reading, and item 13 §4 already records why:** *"Any displacement
plan sized against the four named tools is sized against an undercount."* ⚠️ And the biggest hole in
that section is named — **Unusual Whales is the one owner-named hand-opened tool with no `desk-tools/`
note at all** (item 13 GAPS 3).

**C-P5 — `MASTER_CHECKLIST.md:20` quotes a pre-correction break-out shape.** The row says *"NONE 5 ·
ADDRESSABLE 7"*; the live derivation over the same file gives **NONE 7 · ADDRESSABLE 5**, because item
14 §5.1 withdrew `WF-C03` and `WF-C06` from ADDRESSABLE and they landed in NONE. ⭐ **Caught only
because the file's own sum invariant still closes at 38** — which is the argument for that invariant.

**C-P6 — charter PART XVI prescribes a persona the programme grades absent.** §5 NS-04. Both
statements stand; the decision (retire the lens or open a roadmap row) is nobody's in this file.

**C-P7 — two different master SHAs are in play across items 12 and 14.** Item 14 pinned
`74bdf4f68dd020af10a64b3cb5a6a64e0751ac11`; this file reads `2e0598bfa514303fe542c4473bd2f89470d04ec2`.
Every code-derived figure **quoted from** item 14 — notably the **168** scheduler registrations under
R-03 — is dated to the earlier blob and was not re-derived here.

⚠️ **One thing that looks like a contradiction and is a WORDING COLLISION, recorded because it has
already caused one misread.** Three documents say the owner "declined to itemise", about three
different questions. CARD 22 §5 records the practitioner's claim *"the owner declined to itemize rank
and time-spent across the four external tools"* as **wrong** — *"the record says the opposite"*,
because OI-06 **was** answered on 2026-09-19 naming all four tools. Meanwhile CP-06
(`CRITICAL_PATH.md:12`) and CARD 25 §4 both correctly record that he declined the **per-step**
attribution. ⭐ **The precise reading, which all three support:** he **named the tools** and confirmed
TradingView alerts are in the workflow; he **declined** rank, time-spent, the itemisation of the
"others", and which step each tool serves. CARD 22 §5 notes that one of the two legs under a
person-disqualifying argument *"does not exist"* — this file states the distinction explicitly so the
collision cannot propagate a third time.

---

## GAPS

1. ⛔⛔ **Zero member research, and it is the ceiling on §4's R-04 and on every row in §6.** Inherited
   from item 13 GAPS 1 and not improved here: no interview, survey, session recording, click path,
   support ticket, churn reason or win/loss note exists in the inputs. ⭐ The cheapest thing that would
   move this file is the same thing that would move item 13: **one recorded morning's click sequence**.
2. ⛔⛔ **No account-to-person mapping exists anywhere in this programme's tree.** An account is not a
   person: **6 admin accounts is not 6 desk humans**, and **29 accounts is not 29 traders**. Nothing
   read here maps them, and HYP-P08 exists because the one document that names a holder contradicts the
   one that says the roster is unread.
3. ⛔ **No time-on-task, no frequency, no rank for any role.** So no role carries the first clause of
   charter PART XV's own persona description, and PART XV's test cannot be run as written (§7).
4. ⚠️ **The Whop population was not examined and no Whop artifact was read.** It appears here once, as
   a recruitment pool per CARD 25 §3, and nowhere else. Merging it would cross a product line
   (CARD 23).
5. ⚠️ **Item 14's pod-scheduler AST count was not re-derived at the current SHA** (C-P7). R-03's
   `168 / 164 / 68` figures are quoted, dated, and should be re-run before they are acted on.
6. ⚠️ **`best-of-breed.md` was not read directly.** Every figure attributed to it here is quoted
   through item 13 §5 or §6, **one step removed**, and says so at the point of use. Item 9 (the
   Cross-Product Capability Matrix) is NOT STARTED, and CARD 25 §1 names it *"the single most
   goal-aligned not-started deliverable in the programme"* — a role-versus-coverage cross-tab is not
   writable until it lands.
7. ⚠️ **No F-07 contract exists** (`ls 00-program-control/contracts/ | grep -c '^F-07'` → 0). Items 12,
   13 and 14 all carry F-07 in the MASTER_CHECKLIST and none has a contract file, so this file's scope
   is read off the checklist row plus `_SHARED_PREAMBLE.md`, exactly as its two siblings were.
8. ⚠️ **`06-ux-and-information-architecture/information-architecture.md:729` records that *"the
   workflow library (F-07) and personas do not exist yet"*** and that its own §12 chains were
   reconstructed *"not from a UCT persona artifact"*. That statement is now stale in two of its three
   clauses and **is not corrected here** — it is a different deliverable's file.

## NOT INSPECTED

- **Production `auth.db`.** Never read by this role. Every population figure is quoted from the
  2026-09-14 in-pod read (`verification/2026-09-14/OI-06-telemetry-derived-defaults.md`) or from OI-19
  and OI-21's answered cells. No query was run against production and none should be inferred to have
  been.
- **Any member, and any member-facing channel.** No Discord, Whop, Substack, Zoom or YouTube surface
  was opened.
- **`C:\data`.** Never touched; the local stale-backend port was never probed.
- **`05-product-strategy/capability-matrix/best-of-breed.md`** and item 9 (NOT STARTED) — GAPS 6.
- **Competitor dossier sections B ("User Types: primary personas", per charter PART LX `:1078`).**
  ⭐ Worth naming as the single largest *unread* persona source in the programme: eleven dossiers each
  carry a Section B describing who that product serves. ⛔ It is evidence about **vendors' targeting**,
  not about UCT's members, which is why it was not substituted for the empty R-04 — but a future pass
  could read all eleven and report what the market believes its user types are, clearly labelled as a
  claim about vendors.
- **`10-roadmap/success-metrics.md` (item 35)** — its PH-5 is quoted through `mvp.md` §4.3, one step
  removed.
- **Partner-owned files.** Not read beyond noting their existence per `OWNER_SEED_FACTS.md` §4.

## SOURCES

**Owner testimony and rulings (T0/T1).** `12-decisions/DECISION_CARDS_2026-09-26.md` CARD 17 (one paid
tier), CARD 22 §1–§6 (the definition of done, the three-reviewer panel, the recorder/adjudicator split,
the three withdrawn citations), CARD 23 (the price and the product boundary), CARD 24 (the Finviz
re-grep), CARD 25 §1–§5 (the aggregation thesis, the execution ceiling, the two populations, personal
use of every named tool, costs de-scoped), CARD 29 (jobs carry the verdict), CARD 30 §1/§3 (NG-03's
provenance, item 34 de-scoped) · `12-decisions/DECISION_CARDS_2026-09-18.md` §7d (OI-06's real answer) ·
`00-program-control/charter/OWNER_SEED_FACTS.md` `:20`, §4, §6 (`:61`) ·
`00-program-control/GOVERNING_PRINCIPLES.md` §2, §13, §14 (gate item 10) ·
`00-program-control/charter/C-master-directive.md` PARTS XV `:651`, XVI `:663`, XVII `:671`,
XVIII `:683`, LX `:1078`, Part CLXIII deliverable 12 `:1804`, MASTER PLAN §5 `:2219`.

**Programme control.** `MASTER_CHECKLIST.md:18` (item 12's row and path), `:19`, `:20` ·
`AGENT_REGISTRY.md:139` · `CRITICAL_PATH.md:12` (CP-06) · `OWNER_INPUTS_REQUESTED.md:10` (OI-02), `:14`
(OI-06), `:25` (OI-19), `:34` (OI-21) · `RESEARCH_GAPS.md:15` (RG-10) ·
`contracts/_SHARED_PREAMBLE.md`.

**Siblings and neighbours.** `04-workflows/jobs-to-be-done.md` §1, §2.1–2.6, §3.1–3.8, §4, §5, §6, §7,
GAPS · `04-workflows/workflow-library.md` F1–F4, §2.1–2.6, §3.1–3.2, §4.1–4.5, §5.1–5.4, §8.2, §9, §10,
GAPS · `05-product-strategy/non-goals.md` NG-01 `:69`, NG-02 `:70`, NG-03 `:71`, NG-04 `:95`, NG-05
`:96`, NG-06 `:97`, NG-09 `:107` · `09-security-licensing-cost/security-entitlement-architecture.md`
`:258-275`, DP-5 `:725` · `10-roadmap/mvp.md` §4.2 `:325-334`, §4.3 ·
`06-ux-and-information-architecture/information-architecture.md:729`.

**Measurement.** `verification/2026-09-14/OI-06-telemetry-derived-defaults.md` §1 (distinct-pages
distribution), §2 (both orderings), §3 (`calendar_seen`), §4 (layout signatures), §5 (the four OI-21
tables and the retraction).

**Code, all at `origin/master` `2e0598bfa514303fe542c4473bd2f89470d04ec2`, read 2026-09-26 via
`git show` / `git grep`.** `api/middleware/auth_middleware.py` `:17`, `:25`, `:30`, `:35-61`, `:63-73`,
`:75-79`, `PAID_PLANS` · `api/routers/wire_feedback.py:58`, `:76`, `:81` ·
`app/src/constants/freePages.js` · `app/src/components/mobile/DensitySwitcher.jsx`,
`mobile/index.js:9`, `DensitySwitcher.test.jsx` · `app/src/pages/Breadth.jsx:529-530`.

⛔ **Nothing in the application source was edited, and nothing was committed, staged or pushed.** The
only file written by this role is this one.
