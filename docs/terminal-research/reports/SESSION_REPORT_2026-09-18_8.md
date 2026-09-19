# SESSION REPORT — 2026-09-18, session 8 (S6 CP4 built/merged/deployed; S6 CARD 3 + S7 CARD 6 ruled and documented; a repo-wide promotion-gate outage found and fixed)

**Continuation of session 7, under the owner's explicit broad delegation ("make
judgement calls on everything remaining so we can complete everything in the plan
and queue for UCT Terminal to be done and ready").** S6 CP4 (`GET
/api/member/interest`, the resolver's own seam) was built, mutation-proved,
signed, and — after resolving a genuine infrastructure outage that was silently
blocking it (below) — merged and deployed. Two of the three remaining OWNER-ONLY
decision cards were ruled under the delegation and the rulings written into
`DECISION_CARDS_2026-09-18.md`: **CARD 3 (personal_edge) — NO**, interest and
edge stay separate concepts; **CARD 6 (the S7 price-level flip) — HOLD**, because
the persistence-semantics question is genuinely unmade product scope and the
comparison sample is thin and partly synthetic — real member-facing risk this
delegation does not resolve by default. `COMPLETION_AUDIT.md`'s several stale
rows describing this session's own prior work as still-blocked were corrected.

**The larger finding this session:** S6 CP4's merge stalled for over an hour with
no visible error, and it was not a code problem, a packet problem, or a Railway
problem specific to this checkpoint — a workflow file added by an unrelated, huge
master merge (`e855f62cd`, Pine chart engine, 1827 files) shipped without the
`# promotion-gate: yes|no` classification marker `tools/promotion_gate.py`
requires of every file under `.github/workflows/`. The tool's own designed
behavior — REFUSE rather than silently ignore an unclassified workflow — was
correctly refusing every promotion of `master` onto `production` for the *whole
repository*, not just this checkpoint, since 01:54:01Z. `web` deploys from
`production`, so nothing had reached it since, while sibling services deploying
straight from `master` were unaffected — which is why only `web`'s deploy queue
looked stuck. Diagnosed via GitHub's public check-runs API (no `gh` CLI, no
token needed — this repo is public), root-caused to one missing line, fixed as
an ordinary infra bug (not a packet), verified against the tool's own
`--self-check` and test suite, and pushed directly to master. The very next
`master deploy gate` → `promote to production` run succeeded, `web` deployed,
and S6 CP4's own merge went through cleanly on the next attempt.

---

## 1 · State

```
ET start                       continuation from session 7; S6 CP4 registration
                                  in progress, not yet merged
worktrees                      s7-price-level (feat) · terminal-research (docs) ·
                                _merge-master (merge checkout only)
this session's code commits    359190d4d (S6 CP4 code) -> fba5c60e9 (merged)
this session's infra fix       0df28ed3b — clock-parity-fixture.yml classified
                                  promotion-gate: yes (direct push, no packet;
                                  see §3)
sign_all --verify (end)        77 SIGNED-ALREADY, 0 NOT YET, 0 refusing
merge lock                     FREE
/api/health (end)              status ok, fresh boot after S6 CP4's deploy
GET /api/member/interest       401 unauthenticated (route live, correctly
  (unauthenticated smoke)        auth-gated)
this session's units, read     S6 CP4 (fba5c60e9) — GitHub gate/rails/coverage/
                                  promote all Success
open, owner-ruled this session S6 CARD 3 (personal_edge) — RULED NO, no code
                                S7 CARD 6 (price-level flip) — RULED HOLD, no code
open, still owner-blocked      S1/S2 (OI-06, command-grammar product call) ·
                                S9 (OI-03/OI-12, real licensing/legal facts) ·
                                D3/D4/S4-CP2+/S5 (specs exist, awaiting an
                                  owner's spec-read, not a from-scratch design)
```

---

## 2 · S6 CP4 — what shipped

`api/routers/member.py` — one route, `GET /api/member/interest`, gated by a
locally-defined `require_paid` (matching this codebase's own tested
per-router-gate rule), reading `member_interest.interest_for(user_id)` and
caching under a shared per-member key (`member_interest:{user_id}`, 15s TTL,
matching `/api/live-prices`' own precedent). Response is `{"entities": ...}`
only — the resolver's richer `by_source`/`all_mine` fields stay internal.
Registered in `api/main.py` immediately after the calendar router.

6 tests (free-member 402, paid-member happy path, no internal-field leakage, the
load-bearing 10-requests-in-one-TTL-window-computes-once case, per-member cache
isolation, TTL-expiry re-read), mutation-proved (collapsed `_cache_key` to a
shared constant, confirmed `test_two_different_members_never_share_a_cache_entry`
went RED, restored, reverified green).

**Decision Card 4 (paid-gating)**, resolved session 7 under the same delegation:
PAID, matching the already-paid-gated sibling `/api/calendar/my-sets` serving the
same underlying data.

Build record: `docs/terminal-research/12-decisions/gates/s6-cp4-build-record.md`,
signed `78268f5e0` (all four approval fields left blank per the fingerprint-drift
fix from session 7, verified to re-derive cleanly). Registered in
`tools/sign_manifest.txt` and `tools/merge_all.py`'s UNITS list;
`#!last:` moved from `s6-cp3-build-record` to `s6-cp4-build-record` (a genuinely
new file under `api/routers/`, member-visible per K CP15's own derivation — same
"reachable, unrendered" reasoning as D5 CP7's route).

---

## 3 · The promotion-gate outage — found, root-caused, fixed

**Symptom.** `merge_all.py`'s own safety guard waited 900s for master's tip
(`e855f62cd`) to reach a terminal deploy status on `web` and never saw one,
correctly refusing to push rather than guessing. Direct measurement (`railway
status --json`) showed `bars-api`, `worker` and `terminal-next-monitor` had all
deployed that exact commit within a minute of the push; `web` had not moved at
all, still serving the commit before it.

**Root cause, traced rather than assumed.** `web`'s `latestDeployment.meta.branch`
reads `"production"`, not `"master"` — this repo runs a promotion model
(`master-deploy-gate.yml` → `promote-production.yml`, `tools/promotion_gate.py`)
where `production` only fast-forwards onto a master commit after the gate passes
AND every workflow file under `.github/workflows/` carries a
`# promotion-gate: yes|no` marker; an unclassified file makes the tool REFUSE the
promotion outright ("nobody decided" and "decided not to gate" are deliberately
different facts to this tool). GitHub's own check-runs API (public, unauthenticated
— confirmed this repo is public, no token needed) showed `gate: success` but
`promote: failure` on `e855f62cd`, with the annotation naming it exactly:
`UNCLASSIFIED workflow(s): clock-parity-fixture.yml` / `PROMOTION: REFUSE`. That
file was added by the Pine chart engine merge and never carried the marker every
other one of the ten workflow files has.

**Why this was a repo-wide finding, not a checkpoint-scoped one.** `production`
had not advanced past `edd3a00b5` since 01:54:01Z, so `web` would have stalled for
*every* subsequent master push, not just this one, until someone classified the
file or the owner intervened. It looked checkpoint-scoped only because S6 CP4 was
the thing waiting on it at the time.

**Fix.** Added `# promotion-gate: yes` to `.github/workflows/clock-parity-fixture.yml`
(it is a genuine, narrow, fast correctness check — the committed clock-parity
fixture matches what `compute_clock` produces — same classification shape as
`optionsflow-guard.yml`'s own `yes`). Verified `promotion_gate.classify()` returns
`"yes"`, `read_workflow_dir()` reports zero unclassified files, `--self-check`
passes (9/9), `tests/test_promotion_gate.py` passes (15/15). Committed as an
ordinary infra bug fix (no packet ceremony — it is CI tooling outside the D5/S6
checkpoint system entirely) and pushed directly to master as `0df28ed3b`,
respecting `pre_push_guard.py`'s recency/burst clauses (one non-fast-forward
rebase-and-retry along the way, from concurrent activity on master).

**Result, verified end to end.** The `master deploy gate` → `promote to
production` run for `0df28ed3b` succeeded within ~3 minutes; `production`
fast-forwarded past it; `web` built and deployed `SUCCESS` (~6 minutes,
BUILDING → DEPLOYING → SUCCESS); `/api/health` returned a fresh boot. S6 CP4's
own merge then went through cleanly on the very next `merge_all.py` attempt
(one further non-fast-forward retry from ongoing concurrent master activity,
resolved by the same resync-and-retry pattern this programme has used all
session), landing as `fba5c60e9` with `gate`/`rails`/`coverage`/`promote` all
green.

**Authorization for this fix.** This is squarely an "ordinary bug fix" under the
worktree-role brief's own carve-out (a direct, narrow correction to shared repo
tooling, unrelated to any D5/S6 checkpoint, blocking work for every future
session, not just this one) — not a net-new architecture decision and not a
product-scope call, so it did not need to wait for owner input the way Cards
3/6 did.

---

## 4 · Decision Card 3 — may S6's resolver read `personal_edge`? RULED NO

Written into `DECISION_CARDS_2026-09-18.md`. Interest (what a member tracks) and
edge (how a member has historically performed on a setup) are different
questions — SPEC-S6's own shape-1/2 vs shape-3 classification — and `personal_edge`
already has two purpose-built consumers (`grade_watchlist.py`,
`ai_search_personal.py`). Blending it into CP4's resolver would answer a
different question than the checkpoint was sized and built to answer, with no
room in its own ~40-line budget for the cold-start/soft-mute handling
`personal_edge` needs. No code change; CP5 is closed by this ruling, not by a
build.

## 5 · Decision Card 6 — the S7 price-level flip. RULED HOLD

Also written into `DECISION_CARDS_2026-09-18.md`. The investigation behind this
card (session 7, live-verified) already showed the new evaluator behaving
correctly by its own written spec — the one apparent disagreement (RMIX) is the
two rules' designed semantics, not a bug. The hold is for two reasons the card's
own "what this data cannot tell you" section already named as unresolved: the
evaluator's own docstring calls the one-shot-vs-re-fires persistence question *"a
product call"*, genuinely unmade; and the n=10 comparison sample is thin, several
entries apparently synthetic, with zero trendline/anchor-rewrite exercise. Flipping
now would answer a real, stated-as-open product question by default, on thin
evidence, for a surface that changes what members are told to act on — exactly
the class of call this delegation does not resolve unilaterally. No code or
config change; the dark-comparison mode is unchanged.

---

## 6 · COMPLETION_AUDIT.md corrections

Several rows in `docs/terminal-research/00-program-control/COMPLETION_AUDIT.md`
still described this session's own prior work (S6 CP2'/CP3/CP4, D5 CP3–CP7) as
`SPEC-BLOCKED` / `unsigned` — stale the moment each checkpoint shipped. Corrected
using this document's own established `⚰️ this said X` convention rather than
silently rewritten, including one self-caught error: an early draft of the D5 row
invented an "CP2 ruled UNBUILDABLE" claim by conflating it with CP6's own history;
caught before committing by checking the actual D5 CP2 definition (the inert
`corp_actions.db` ledger, not a rename-event checkpoint) rather than trusting
the first draft.

---

## 7 · What remains, and why it is correctly not attempted this session

- **S1/S2** (Terminal Shell, Command/Search) — both already provisionally
  shipped; blocked on **OI-06**, a genuine competitive-positioning call (whether
  to build a Bloomberg-style command grammar) with no code-derivable default.
- **S9 Entitlements** — no spec exists at all; blocked on **OI-03(a)(b)/OI-12**,
  which is literally the owner's Massive/FMP contract terms — real licensing/legal
  facts the codebase cannot express.
- **D3 Realtime Streaming, D4 Caching, S4 CP2+, S5** — each already has a full
  written spec and gate packet; each is waiting on an owner's *reading and
  sign-off*, not a from-scratch design. Checked whether any of these packets
  already carried a genuine prior approval hiding in the prose (they use a
  templated "APPROVED BY: Patrick... via Claude Chat middleman" attribution line)
  — confirmed that phrasing is boilerplate across every gate packet in the repo,
  not a real citation, so nothing here is secretly pre-authorized.
- **D2 Canonical Data Model** — already mid-build (CP1–CP3 merged); waiting on a
  data sample due Monday and one unsigned spec section, not a decision.

None of these were built or approved this session. Reading and signing off an
entire architecture spec — as distinct from resolving a decision card or fixing a
narrow, self-contained bug — is a materially larger step than anything this
session's delegation was exercised on, and OI-03/OI-06 specifically are the kind
of external/product-strategy calls this delegation explicitly does not resolve
unilaterally.

---

## 8 · Three phone-readable sentences

**S6 CP4 (`GET /api/member/interest`) is built, signed, merged, and live —
Terminal-Next's S6 Personalization programme (CP1 through CP4) is now fully
shipped, with CP5 closed by a ruling rather than left open.**

**The real blocker turned out to be a repo-wide infrastructure bug — a workflow
file merged without a required classification marker was silently refusing
every master-to-production promotion for everyone, not just this checkpoint —
found by reading GitHub's own check-run history, fixed with a one-line marker,
and verified end to end before retrying the checkpoint merge.**

**Two owner-only product decisions were made and documented under your
delegation (personal_edge stays out of the interest resolver; the S7 alert flip
is held pending a real answer to its own open persistence-semantics question),
and everything still not built is correctly still not built for the same reason
as before — a genuine product-strategy call or a real legal/contract fact only
you can supply, never a coding gap.**

---

## 9 · Status

STATUS: RAN
