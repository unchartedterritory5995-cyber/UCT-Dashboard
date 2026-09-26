---
id: OWNER-MEMO-1
title: Owner Decision Memo - the four decisions, and what to build first
role: >
  Gate item 38. The only document in this programme written for the owner rather than for the
  programme. It asks for the decisions nobody else can make and says what to do first.
status: draft
length: four pages of memo; the derivation appendix is the footnote the no-typed-count rule requires
---

# Owner Decision Memo

**This does not recount the programme.** The other gate deliverables did that — see `MASTER_CHECKLIST.md`, which is the index. ⚰️ *This sentence read "Thirty-seven documents did that": the one number in this memo with no entry in its own appendix, and it silently counted a deliverable that did not yet exist.* Every number is derived by
the command in the appendix, never typed beside the claim it describes.

---

## 1. The recommendation

**Do four things this week and none of them is a feature.** Send one email to Massive. Name one
person who is not you. Say the word *deploy* on a fix that is already committed with its rail. Then
spend the first build lane re-checking the backlog against the code you already have -- because the
cheapest work in this programme is verification, not building: of the build tickets checked against
`master`, close to a quarter turned out to already ship, and **forty-eight were never checked at
all** [D3]. Then build rung zero -- a flag declared dark, two rails, one cohort dependency, one
payload field -- the smallest buildable item in the plan and the only one whose absence means
**nothing you build can be shown to a member**. And treat **pre-trade options analysis** -- chain,
greeks, vol surface, payoff graph -- as the product's first *coverage commitment* rather than its
first build: it is the biggest single reason a member keeps another tab open [D1], it is fully inside
your own charter, and **it has no ticket** -- the only chain-adjacent row in the whole backlog
proposes *deleting* the module it would be built on [D2]. The risk here is real and not hedged: a
week whose visible output is one email, one name, one push and a switch nobody can see **looks like a
week with nothing shipped**, and it is the week that makes every later claim believable.

---

## 2. What to build first, and what it costs in lanes

**The rig is three build lanes and one integrator.** Forty items are startable with no hard
prerequisite; the agent cap cuts that to three; the box's one-gate rule cuts the *verification* step
to one; the merge queue allows one master merge in flight repo-wide; and zero lanes may touch the
flow-worker watch paths during the trading day [D4]. **Forty down to three is the most important
planning fact in the programme** -- any plan assuming more parallelism is fiction -- and because
verification collapses to one, the gate rather than the coding sets the pace.

* **Lane B -- rung zero, and it is the one I would start.** The cohort store is not in it: it already
  ships, with an operator CLI and a second live cohort proving it generalised [D5]. What remains is
  the master flag declared **dark before it is set anywhere**, a rail that it is read *per request*
  (a module-level read passes every other test and turns the no-redeploy rollback into a fiction), a
  rail pinning the literal default, one reusable cohort dependency, and one `cohorts` field on the
  access payload -- today the server can gate on a cohort while the client cannot know it is in one.
  Its exit condition is **the OFF state watched to actually kill something** before ON is trusted.
* **Lane A -- the floor.** Split the ops and business notification channels before the traffic
  arrives, then make the one performance gate able to print its own number: it currently counts a
  tier that was ruled *served* as cold, so on the daily timeframe **no number prints at all**.
* **Lane C -- the honest blank, which is coverage and not polish.** Say what you do not have, at the
  number: futures instead of a figure from an unsuitable source, the dealer-positioning assumption
  label, one rail that every panel uses the shared provenance set (the primitives all ship, so this
  is the rail and nothing else). A member who learns a boundary once stops looking; one who finds a
  silently missing number opens the other tab permanently.
* **The gate cannot share a lane**, because it *is* verification: every guard observed red before
  green, with a control so it cannot pass for the wrong reason.

**Costing no lane at all:** the vendor email, the subject's name, the deploy word, one monitor read,
two product sentences -- the highest-leverage set in the plan, none of it engineering. One has
already moved: **the quiet measurement window is declared**, Tuesday 2026-09-29, 09:15-12:15 Eastern,
run sheet written. The roadmap that landed today still lists it as a decision nobody has made --
worth remembering whenever a cell in this programme says you have not decided something.

⛔ **What I would not build first: the options work.** Its data question is unasked, it has no
ticket, and the machinery that exists rides a source the licensing register classes unsuitable with
no purchasable remedy -- surfacing it as-is publishes a derived work off a feed we should not publish
from. One email decides whether it is a build or a second-source problem; **either answer is
progress**.

---

## 3. What you owe, and what the delay costs

| # | the decision | why it can only be yours | cost of delay |
|---|---|---|---|
| 1 | **Name a non-builder who will actually use it** | Three reviewers, independently, same conclusion: near-zero switching cost and no onboarding make you the *worst* available subject, not the most convenient -- and in any log a builder's QA is indistinguishable from preference. | **The highest-leverage decision on this page.** Without a name the MVP returns INCONCLUSIVE-BY-CONSTRUCTION -- not a fail, something worse: a result nobody could contradict. Roughly 750 people already pay for the sibling Discord [D7], so *"there isn't one"* is no longer the likely answer -- and if it still is, **that is a finding, not a blocker.** |
| 2 | **The seat model** | One unmetered plan says nothing about how many people may sit on one subscription, and no artifact answers it. | Nothing is blocked today; it becomes a rewrite the day two people share one login. ⚠️ **Two cards disagree about whether you already closed it** -- CARD 23 leaves it open, CARD 25 reads your costs-and-usage de-scoping as closing it. One word tells me which; I am not resolving it. |
| 3 | **One trading morning, watched** | An observation, not a decision, and no telemetry substitutes: our instrumentation records this app only. | Nothing waits on it -- the workspace ruling holds under both shapes. But its value **decays**: the longer it waits, the more you are observing the product we built for you rather than the one you chose. |
| 4 | **The word "deploy" on the wire watchdog** | `master` is production; a push needs your explicit word plus a member-impact paragraph. Delegated judgement was never deploy authority. | ⛔ **The only cost of delay already being paid.** The missed-run alert runs at 09:05 ET and asks a function that, before 09:30, expects *yesterday* -- so a one-run miss compares yesterday against yesterday and cannot fire until the payload is two days stale [D8]. The incident it was built for is dated 2026-08-14: members saw the previous day's list all day. Fix and rail are committed on `fix/wire-watchdog-cannot-fire`, ⚠️ **two commits ahead of master** -- the second an unrelated docstring correction, so decide whether both go. |

Three further one-sentence calls are yours and deliberately **not** in this table, because nothing is
blocked five ways on them: the maximum age a panel may display without saying so; extend-or-delete on
Confluence Radar; whether the Discord bot's earnings-date path is superseded (roadmap section 2.1).

---

## 4. What this programme found that changes the plan

**The biggest reason a member keeps another tab open has no ticket, and a deletion ticket points at
the same module.** It is the largest break-out on five independent axes: four uncoordinated
authors name it the top gap, six of the thirteen benchmarked products ship it, it holds two break-out
jobs, and its absence is verified in your own source with a dated deferral -- *"Greeks, live quotes,
IV rank: out of scope v1"* [D1]. It is **in charter**: no-execution governs order flow, a backtest
places no order, and a live mounted backtest already serves members. Across a ninety-three-ticket
backlog there is no row for it, and the one chain-adjacent row proposes retiring the chain leg [D2].
**Two intentions point at one module and neither names the other**; somebody owes a ruling.

**Verification is cheaper than building, and most of it was never done.** Six tickets were written
and found already shipping across the packages checked -- one recorded as *absent* and sized large
ships admin-mounted with seven tables; another was deleted before it was written. Forty-eight
were never checked against `master`, which at the observed rate leaves **about eleven more
already-ships hiding in the plan** [D3]. ⚠️ Any sequencing resting on those bands is provisional,
mine included.

**The quarantine is larger than the moat, and the strongest asset reaches nobody.** Nineteen assets
are claimed and not evidenced against fourteen genuinely accumulated [D6] -- the shape is the
finding. The strongest is a decision record: 22,574 candidate rows over sixty issues, **19,611 of
them considered and rejected with the stage each died at** [D6]. Judgement under uncertainty: no vendor
sells it, no scrape recovers it, unambiguously yours -- and its only reader on `master` is an admin
replay script. **No member surface at all.** Under an aggregation thesis that is the cheapest
genuinely differentiated surface in the estate.

**Delivery is concurrency-bound, not dependency-bound** [D4]. Any plan implying a fourth lane is
wrong about the machine rather than the work -- and the box running the lanes is also the data
producer for your scheduled member-facing jobs, so a verification window is a scheduling decision
before it is a technical one.

**The definition of done had no subject, and now has a pool.** A three-reviewer panel ruled you
cannot supply the verdict on your own product; the paying Discord membership changes the
availability, not the rule. ⚠️ **Two products, two populations, never one denominator:** the ~750
paying members are the Whop product's; UCT Intelligence is roughly 26 accounts with thirteen holding
any page-view row, and that figure disagrees with an in-pod read of 29 -- reported, not resolved
[D7]. Never compute a percentage off either.

---

## 5. What this programme could not answer

* **Whether a tier you already hold carries historical option chains and IV history.** Nobody here
  controls it; one email, and it gates the largest coverage item.
* **Whether you open finviz.com by hand for a chart step.** No code read answers a desk question.
* **Anything about the live pod.** Every flag named in this programme is **named and unread**; a grep
  over git is a statement about source, never about what is running.
* **Bands 4 and 5 of the backlog against `master`** -- the forty-eight above.
* **Bloomberg's real ceiling**, needing a seat or a practitioner; and whether provider grants reach
  *derived works* rather than display -- recorded as a risk you accepted knowingly, with a date.
* **Contradictions between equally standing documents, left standing**: two post totals, two universe
  sizes, three readings of one collector's hour, and a ledger whose measurement error has no reliable
  direction.

⛔ **One thing this memo does not say.** It does not say the product is ready, or nearly ready, or
that a member would prefer it. **Nobody has been in a position to say that** -- which is decision 1
on page three, and why it is first.

---

## Appendix -- every number above, with the command that produced it

Run from `docs/terminal-research/`; code reads are at `origin/master` `2e0598bfa`. Nothing is typed.
⛔ A count is comparable only to a count produced the same way, so no figure here is re-derived from
another document's number -- and no flag state is asserted anywhere above.

```bash
# [D1] 6 products ship it, of 13 benchmarked; the dated in-code deferral; the only importers
sed -n '432p' 05-product-strategy/capability-matrix/capability-matrix.md | awk -F'|' '{print $4}' \
  | tr '·' '\n' | sed 's/^ *//;s/ *$//' | grep -c .
ls 03-competitive-research/*/dossier.md | wc -l
git grep -n "out of scope v1" origin/master -- api/services/journal_two/options.py
git grep -lE 'services\.options_chain' origin/master -- 'api/**'      # 2: voice tools, discord manifest

# [D2] 93 tickets; 0 for it; the chain-adjacent row is a retirement
grep -oE 'TERM-[0-9]{3}' 10-roadmap/backlog.md | sort -u | wc -l
grep -cE 'BRK-01' 10-roadmap/backlog.md
grep -nE 'TERM-069' 10-roadmap/backlog.md

# [D3] six hits in 26 packages; 49 unchecked, less the one item 28 checked; expected remainder
grep -nE '26 packages' 10-roadmap/backlog.md ; grep -nE '^### H4\.' 10-roadmap/roadmap.md
python -c "print(round(48*6/26,1), round(100*6/26,1))"

# [D4] the concurrency ceiling: 40 -> 3+1 -> 1 -> 1 -> 0
grep -nE '^\| (graph width|after the agent cap|after the box|after the merge|after the deploy)' \
  10-roadmap/roadmap.md

# [D5] rung zero: what ships, what does not
git show origin/master:api/services/rollout.py | wc -l
git show origin/master:tools/rollout_cohort.py | wc -l
git grep -l 'TERMINAL_NEXT_ENABLED' origin/master -- api app/src | wc -l
git grep -n 'cohorts' origin/master -- api/routers/auth.py

# [D6] moat vs quarantine; the decision record
for p in ACC BLT LIC CLM; do printf "%s=%s " $p $(grep -oE "\b$p-[0-9]{2}\b" \
  05-product-strategy/proprietary-advantage-inventory.md | sort -u | wc -l); done
grep -n '19,611' 05-product-strategy/proprietary-advantage-inventory.md

# [D7] two products, two populations, and the roster disagreement
grep -n '~26 accounts' 12-decisions/DECISION_CARDS_2026-09-26.md
sed -n '104,116p' 04-workflows/personas.md

# [D8] the watchdog that cannot fire, and the branch that fixes it
git grep -n 'hour=9, minute=5' origin/master -- api/main.py
git grep -n '(9, 30)' origin/master -- api/services/engine.py
git log --oneline origin/master..fix/wire-watchdog-cannot-fire
```

**Four things to read behind this:** `10-roadmap/roadmap.md` (the sequence);
`12-decisions/DECISION_CARDS_2026-09-26.md` CARDs 22, 25, 27, 28 (page three's rulings);
`05-product-strategy/capability-matrix/capability-matrix.md` section 4 (the options gap's evidence);
`10-roadmap/backlog.md` GAPS 2 (the forty-eight).
