---
id: ROADMAP-2026-09-23
title: UCT Terminal-Next — one-week execution roadmap
role: the day-by-day build plan for Terminal-Next, built and reviewed with the owner across three passes before implementation start
status: draft, owner-reviewed twice (CEO/dev/beta-tester lenses applied), not yet started — Day 0 begins on owner's "go"
date: 2026-09-23
saved_reason: owner asked this be a durable file, not only an artifact, specifically so a session interruption cannot lose it
---

# UCT Terminal-Next — one-week execution roadmap

A specific, day-by-day plan to build as much of Terminal-Next as compute and evidence
honestly allow in one week — built and tested locally, nothing pushed live without a
separate go/no-go — grounded in the research and system state this program has already
banked, not reinvented.

**Status at save time:** not started. Nothing in this document has been executed. It is
saved now, before Day 0, so that if this session or any future one is interrupted, the
plan itself is never the thing that's lost.

---

## 0 · Read this first — the licensing gate is CLOSED, corrected 2026-09-23

⚰️ **This section originally said Critical Path CP-03 was "NOT OPEN" and framed the two
questions below as the one fact blocking the whole week.** That was wrong the day it was
written — CP-03 was actually resolved by the owner on **2026-09-19/20**, four days before
this roadmap existed, and recorded in full in `OWNER_INPUTS_REQUESTED.md`'s own OI-03
entry. This document cited `CRITICAL_PATH.md` instead, which had gone stale and never
absorbed that resolution — the exact second-authority-drift defect this program repeatedly
names elsewhere. The owner re-confirmed the same answer again today when asked. Both
source docs are now corrected; this section is kept, struck through in spirit rather than
deleted, so nobody re-derives the wrong version from an old copy of this file.

> ✅ **RESOLVED. Massive: Business/Enterprise (confirmed, already held). FMP: DDLA
> confirmed to exist. Finviz/Finnhub/AlphaVantage/Schwab: all confirmed.** Net effect on
> the 118-row licensing register: 18 stay Restricted (was 81), 76 Likely Allowed (was 7),
> 12 Unknown (was 18). Two named exceptions remain, and they're structural, not pending
> owner input: **FRED** (a per-series compliance task, not a provider-confirmation
> question) and **yfinance** (an explicit, already-recorded risk-acceptance per
> `OWNER_DECISIONS.md` D-004 — Yahoo sells no licence to accept, so there was never a
> licence question to resolve here).

**What this actually changes for the rest of the week:** A1 Markets and A11 Breadth's
Massive/FMP-sourced work is no longer required to stay flagged dark indefinitely on
licensing grounds — the remaining reasons either stayed dark today (D2's unsigned CP3
scope, A11's pending scope grant, A1's unbuilt "quote panel") are real, but they're no
longer licensing reasons. Anything shipped dark earlier this week for licensing caution
specifically is now a candidate for a real go/no-go review, not a permanent hold. Section
6's own checklist (tests, real-device pass, explicit per-surface "go") still applies in
full — a resolved licensing gate does not skip that.

> 💡 **"Live" and "launched" are two different decisions.** The site is still in
> `COMING_SOON_MODE` — account creation is closed, and today's users are admins and
> testers, not a public member base. This week's plan gets features to *flag-ready*. It
> does not, and shouldn't, imply lifting that gate. Flipping a flag for the existing
> handful of accounts is a code decision; opening public registration is a business one —
> pricing, support readiness, marketing — and deserves its own separate process whenever
> the owner is ready for it, never assumed on their behalf by this plan.
>
> Same discipline on cost: before any paid tier upgrade this plan might make possible
> (Massive Business from ~$2,499/mo, OPRA's $1,500/mo floor), the question is simple —
> what's the revenue path that justifies it at today's member count. Nothing in this plan
> purchases anything; it only tells the owner what buying it would unlock.

The remaining open items — S7's ruling, A11's small D2 scope grant, and the OI-17
auth-on-five-endpoints question — are consolidated in §7, none of them blocking.

---

## 1 · How the week actually works

Seven rules shape every day below. None are negotiable; each exists because of a real,
previously-measured failure on this account, or a gap found while reviewing this exact
plan.

**Rule 1 — Agent concurrency: 3 + 1 integrator, in waves.** Not "as many as possible."
This account has a standing owner ruling from a measured incident: five concurrent
agents once hit a session rate limit mid-flight and killed two lanes' work outright;
thirteen concurrent agents beside one local job once OOM-crashed the machine and
corrupted a live worktree. Every day below is structured as sequential waves of up to 3
builders plus one integrating/verifying pass, never a single flat fan-out.

**Rule 2 — Local first, always.** Every feature is built and tested on a branch,
verified against a local backend, and behind a feature flag before it is ever a
candidate for production. "Ship" in §3 means *merged to the research branch, tested,
flag-gated dark* — not *live on uctintelligence.com*. §6 is the separate, explicit
checklist for the day any of it flips on for members.

**Rule 3 — "Done" has four parts, every time.**
1. **Built** against the real, current code — not a stale snapshot of what a doc claimed
   six days ago.
2. **Tested** with real assertions on real numbers (a hand-typed count beside a table
   it's supposed to describe is the single most repeated defect in this codebase's
   history — every number gets re-derived, not retyped).
3. **Hygiene-checked** — repo hygiene, flow-worker watch coverage, and the relevant
   scoped test files, every time, before a merge.
4. **Flagged**, for anything member-visible, with a named rollback lever recorded before
   the flag ever flips.

**Rule 4 — Every test run is scoped, and nothing runs against live data.** Two measured
incidents on this exact machine, not hypothetical risk: an unscoped repo-wide backend
test run once reached 18GB and was OOM-killed; a local script that looked sandboxed once
wrote real rows into the production auth database because it pinned the wrong
environment variable. Standing for every wave, every day: backend tests are
named-file-scoped, never `pytest tests/`; nothing runs against `C:\data` or any
production Railway service; nothing runs a heavy job on the production pod. The repo's
own conftest tripwire catches most of this automatically — it stays on, always.

**Rule 5 — Every day ends with a handoff, because a week is not one sitting.** This plan
will very likely span more than one continuous session. Each day's integrator pass ends
with a short, current status note — what merged, what's still open, what the next
session needs to know — so a break between Day 3 and Day 4 costs nothing.

**Rule 6 — Shared substrate has an owner, and every day ends with a real regression
sweep.** D2, S7 and S3 are dependencies for nearly everything downstream. When two waves
both need to touch the same platform-layer system in one day, one agent owns the file
for that day — no two builders editing the same shared contract in parallel. And a day's
"done" is not just each builder's own scoped tests passing: the integrator runs a full,
bounded regression pass at the end of *every* day (chunked to respect Rule 4's memory
limits, never skipped), so a platform-layer change that quietly breaks something
already live gets caught the same day, not on Day 7 with no runway left to fix it.

**Rule 7 — Nothing waits until Day 7 to be used.** Whichever surface ships each day gets
a real walkthrough that same day or the next — by someone who didn't build it, clicking
through it like a trader would, not just re-reading its own test file. Day 7 is the full
end-to-end pass across everything together; it is never the first time any individual
piece gets used by a human.

---

## 2 · The foundation — what we're building *on*, not redoing

This program has already banked a serious amount of research and a working
architecture. The plan below extends it; it doesn't restart it.

### What "terminal-grade" means, already decided

The accepted product architecture defines five properties, each with a named internal
seed already in the codebase and a named competitor witness. Every feature built this
week is checked against these five, not against a vibe:

1. **One context, read everywhere, without re-entry** — a symbol loaded once should be
   the symbol every panel already shows.
2. **Provenance on every number and every sentence** — if the app says it, it can show
   where it came from.
3. **Saved things become names, and names are addresses** — a saved view, screen or
   board is a shareable, revisitable thing, not throwaway session state.
4. **Keyboard-fast** — a trader's hands stay on the keyboard; the mouse is the fallback.
5. **Panels are independent, and the document survives** — one broken widget never takes
   down the layout around it.

Explicit non-goals, already ruled, that this plan respects rather than re-litigates: no
FX, fixed income or crypto in V1; no order execution or OMS; no attempt at Bloomberg's
chat-network effect (parked as an open product-vision question, not a build target).

> ⚠️ **One tension to name before it becomes a regression.** "Keyboard-fast" is a desktop
> idea, and this product has real, hard-won mobile investment already — a gesture-driven
> mobile nav, a 44px tap-target floor enforced everywhere, real-device audit tooling that
> has already caught bugs automated tests couldn't see. A Bloomberg-inspired push must
> not quietly become a desktop-only push. Every new surface this week clears the *same*
> mobile audit the rest of the app already holds itself to — keyboard-fast is an addition
> for desktop hands, never a replacement for the touch patterns members on phones already
> rely on.

### The system roster (last measured, re-measured fresh on Day 0)

Thirty-two named systems across four layers. The application layer is where members
feel the product; the platform and data layers underneath decide whether it's honest
when they see it.

| Layer | System | State (last measured) | What it blocks |
|---|---|---|---|
| Platform | S3 Entity Master | SHIPPED | — |
| Platform | S4 Context Bus | CP1 merged | adoption, not capability |
| Platform | S7 Alerts | 4 of 8 types live, 4 dark | needs joint-ownership ruling — §7 |
| Platform | S9 Entitlements | not built | A14 Portfolio & Risk |
| Platform | S10 Presentation Primitives | SHIPPED | — |
| Data | D1 Provider Abstraction | **SHIPPED, adoption sweep CLOSED 2026-09-23** (`d050f867f`, `c8c1e431f`) | nothing — fully done |
| Data | D2 Canonical Data Model | **CP2, confirmed unchanged 2026-09-23** — still the long pole | A11, A13, S8's full citations |
| Data | D3 Realtime Streaming | **CP4 shipped `bb312cc18`, owner-signed** (new as of 2026-09-23 — was "docs only" at last measurement) | A10, jointly with D4 |
| Data | D5 Reference & Corp Actions | CP1 merged, CP2–7 open | partial |
| Intelligence | I1 Intelligence Layer | SHIPPED, 3 slices | — |
| App | A9 Screening | gate-only, closest to clear | S7 type CP3 |
| App | A13 Journal & Track Record | gate-only on D2 + S5 | the actual differentiator — prioritize |
| App | A1 Markets, A11 Breadth | gate-only on D2 | — |
| App | A2 Charts, A10 Options & Flow | gate-only / partner-owned | S1/S2 (owner-bound) / Ravi ack |
| App | A14 Portfolio & Risk | no member door at all | S9 + D8, both owner-bound |

*Last full measurement: 10 days old at the time this document was written. Re-measured
fresh on Day 0, 2026-09-23 — see the Day 0 close-out note after §3 for what changed and
what didn't.*

> ⚠️ **Naming collision, found during Day 0 re-measurement — do not conflate.** There
> are two unrelated "D2" identifiers in this codebase's commit history: Terminal-Next's
> own **D2 Canonical Data Model** (`api/services/canonical/address_book.py`), and a
> completely different **D2 / F-D2-\*** series (`bars_ordinal_census.py`,
> `earnings_table` fundamentals-shape declarations) belonging to the unrelated general
> bug-hunting program, tracked in `COMPLETION_AUDIT.md`. Commits like "D2 CP5," "F-D2-1,"
> "F-D2-3" are **not** this roster's D2 progressing. Verified by reading
> `address_book.py` directly — Terminal-Next's D2 sat at CP2 both on 2026-09-13 and on
> 2026-09-23; the other D2 series moved independently and means nothing for this roster.

The competitive research already banked and not being redone: 11 accepted product
dossiers (Unusual Whales, TradingView, Koyfin, Benzinga Pro, AlphaSense, Fiscal.ai,
Quartr, FactSet, LSEG Workspace, SpotGamma, plus a light TIKR/YCharts/CIQ note), a
full Bloomberg deep-dive dossier, a Gödel Terminal dossier, a 178-row capability ledger,
and a 48-row provider ledger with a full licensing register.

---

## 3 · Day by day

Bottom-up, on purpose — the last real measurement found zero of eight application-layer
systems buildable, because every one gates on the platform or data layer. Days 1–3 pay
down that debt; Days 4–6 spend it on features members will actually see; Day 7 proves
the whole thing holds together.

### Day 0 · Today — re-ground, don't re-guess (~2 hours, one wave)

- **Agent 1:** re-measure the 32-system roster fresh against current source (same
  method as §2's table, re-derived, not copied).
- **Agent 2:** re-run Critical Path CP-01 through CP-12 against current code; confirm
  which of the 11 non-blocked questions still hold.
- **Integrator:** reconcile both against `PROGRAM_STATUS.md` and `LEDGER.md`; publish
  the corrected roster before Day 1 dispatch.
- **Owner:** answer the two CP-03 questions from §0, whenever today works. Nothing in
  Days 1–3 waits on it, but the longer it's open the more of Days 4–7 has to stay
  flagged dark instead of going live.

> ✅ **Day 0 closed, 2026-09-23.** Two agents dispatched, both reported real findings —
> nothing rubber-stamped:
> - **Roster:** D2 confirmed unchanged at CP2 (the naming-collision warning above is the
>   important catch here). D3 Realtime Streaming has real new progress — CP4 shipped,
>   owner-signed — moving it off "docs only," though A10 still needs D4 too and stays
>   blocked. A9's live match-count already shipped separately (see §4); its gate is
>   otherwise unchanged.
> - **Critical Path:** of the 11 non-CP-03 questions, all held with no regressions.
>   CP-02 and CP-10 both closed a small, real, citable sub-gap via the unrelated packet
>   wave (FRED attribution notice; FRED cache TTL). Two stale citations were caught and
>   corrected in `CRITICAL_PATH.md` directly: CP-05's deploy-window figure (was ~3 min,
>   is now measured at ~10 min end-to-end under the current deploy pipeline) and CP-11's
>   Railway service count (was "five," is seven — the same drift already fixed once in
>   `CLAUDE.md` this session, caught here as an uncorrected second copy).
>
> Nothing found changes the Day 1–7 plan's shape. Day 1's wave is dispatched next.

### Day 1 — finish what's already unblocked (nothing here waits on the owner)

- **Agent 1:** D1 adoption sweep — migrate the remaining direct FMP call sites behind
  the typed `fmp_client` adapter. Not new design; finishing a shipped pattern. Zero
  owner dependency.

> ✅ **Agent 1 finding, 2026-09-23:** also already complete. `tools/fmp_guard_census.py`
> reports zero unquarantined violations; the 11 remaining entries are each individually,
> already ruled out-of-scope. The real target this directive pointed at — PROGRAM_STATUS's
> D1 follow-ups G1–G5 — are further along than assumed: **G1** (per-call timeout, "the one
> that matters") shipped `d050f867f`; **G2+G4** (9 new typed endpoints, multi-symbol news)
> shipped `c8c1e431f`; both on master, both with real tests (67 total, re-run fresh: all
> passed). G3/G5 are deliberately deferred, not silently skipped. **D1's adoption sweep is
> CLOSED — mark it off the roster, not reopened in a future wave.**
- **Agent 2:** S3 admin ops routes — `/status` and `/reseed` for the Entity Master,
  already authorized in its own gate, never built.
- **Agent 3:** I1 spec, narrowed — the tool-registry contract, the grounding rule, and
  the refusal shape the intelligence layer composes on, written as a spec so Day 4's
  AI-surfaced features have one contract to build against instead of three.
- **Integrator:** merge all three to the research branch; full scoped test pass +
  hygiene + flow-worker watch coverage on each, plus Rule 6's end-of-day regression
  sweep.

> ✅ **Day 1 closed, 2026-09-23.** Two of three items were already fully shipped
> (S3 admin routes, D1 adoption sweep) — nothing to merge for either. The third (I1
> spec) is genuine new work, spot-checked against real source and committed
> (`175d14ba5`). **Pattern worth naming plainly:** this is the second day in a row where
> "not built" turned out to mean "not yet reflected in this roster," not "not yet done."
> Every remaining day's dispatch prompts already tell agents to verify against real
> current source before building — that discipline is what caught both of today's, and
> it stays non-negotiable for the rest of the week.
>
> **S7 Alerts is still unanswered in Discord** as Day 1 closes. Per the plan's own stated
> fallback, Day 2's wave proceeds on D2 alone plus one item pulled forward from Day 3's
> parallel UX work (panel resilience — it depends on neither D2 nor S7), rather than
> running an agent slot idle waiting on a ruling. S7 slots back in the moment it's
> answered.

> ✅ **Agent 2 finding, 2026-09-23:** already fully built, tested, and live in
> production — `api/routers/entity_master_admin.py`, mounted, `require_admin`-gated
> (a deliberate, documented deviation from the gate's suggested no-auth shape). The
> write half shipped as `POST /api/admin/entity-master/reconcile`, not literally
> `/reseed` — also deliberate: a real `/reseed` would import `scripts/` from `api/`,
> breaking a stated runtime boundary, and `/reconcile` is the spec's own named
> equivalent. Committed `7f483014b`, confirmed an ancestor of `origin/production`;
> its own test file (`tests/test_entity_master_admin.py`) re-run fresh: 26/26 passed.
> **This roadmap's premise was stale, not the codebase.** Nothing to merge; nothing
> to build. Agent 2's own closing note, taken seriously: verify the remaining "never
> built" claims in this plan the same way before spending an agent-day on them.

### Days 2–3 — the long pole: D2 Canonical Data Model

- **Agent 1:** D2 CP3 — the metric address book's sampling and coverage pass, held
  pending a real in-pod read. This is what makes "every number has a receipt"
  (terminal-grade property 2) actually true instead of aspirational.
- **Agent 2:** wire S8's full `<Cited>` provenance renderer against the now-addressable
  D2 metrics. One renderer, every surface — not a per-feature reinvention.
- ~~**Agent 3:** S7 Alerts — finish, not start...~~ **Corrected 2026-09-23, after
  actually dispatching this: all 8 trigger types were already built and registered
  by 2026-09-13.** This was never a finishing task — see the full correction under
  §7 item 3 and the "S7 result" note further down. Nothing here to dispatch.

> ✅ **S7 result, 2026-09-23 — nothing built, and correctly so.** Dispatched this as
> real work on the strength of the day's own accepted ruling. The agent found: `price-level`'s
> dark evaluator and its legacy-comparison harness (exactly what the ruling asked for) were
> already built and merged **before this roadmap existed** (`67850e93d`, `c0f88b969`). Going
> further — flipping delivery on — was already investigated in full and explicitly **RULED
> HOLD by the owner on 2026-09-18** (`DECISION_CARDS_2026-09-18.md` CARD 6), for real
> reasons stated in that ruling itself, not a stalled task: the new evaluator is verified
> correct, but the persistence semantics (fire once vs. re-fire) is a genuinely unmade
> product call, and the comparison sample is thin and partly synthetic with zero
> trendline-alert coverage. **The "accept" recorded earlier today doesn't override that HOLD**
> — it was of a ruling I drafted without knowing the HOLD existed, which is on me: I should
> have read `COMPLETION_AUDIT.md`'s S7 entry before drafting that text in the first place,
> not discovered it only after dispatching an agent to build against it. The real, corrected
> choice for the owner is recorded in §7 item 3. **Nothing shipped, nothing flipped, legacy
> `watchlist_alerts` remains the one that actually fires** — exactly as the 9/18 ruling
> already decided.
- **Integrator:** mid-point check-in at end of Day 2 before continuing into Day 3 — D2
  is explicitly the item most likely to reveal a real surprise once someone is inside it.

> ⚠️➡️✅ **Agent 1 finding, 2026-09-23 — a real surprise, and a resolved one.** "D2 CP3"
> names two different things inside the same signed gate document (the gate's own text
> flags this explicitly: *"CP3 NAMES TWO DIFFERENT THINGS IN THIS FILE — READ THE
> PREFIX"*). The genuinely-unbuilt one — `address_book.py`'s `resolve()` five-status
> function — remains correctly unsigned and untouched. The *other* one — the top-level
> CP3 / "LINE 5" dual-compute warm reader for `ticker_returns.py` — is real, signed
> (`d1da6f5b7`), tested (22/22, re-run fresh), and was reported as **built but never
> shipped to master**.
>
> **That report was itself wrong, and worth recording why:** the check that produced it
> tested ancestry of the *exact original commit SHA* (`315200817`) against
> `origin/master`, which answered "no" — the same false-negative shape Packet F fixed in
> this program's own env-check tool two days ago. Re-checked properly (cherry-pick
> equivalence, not raw ancestry): the identical patch already reached master and
> production under a different SHA (`395e3f37b`), confirmed byte-identical on the two
> files that matter and confirmed live via `git merge-base --is-ancestor 395e3f37b
> origin/production`. **Nothing needed shipping. D2's real, unbuilt CP3 (`resolve()`) is
> the only open item, and it's still unsigned.**

> ✅ **Day 2 pattern, now four for four:** every "build" directive dispatched since Day 1
> has turned out either already shipped or, in this one case, reported as unshipped when
> it was actually already live. The lesson holds and is now applied proactively rather
> than discovered after each dispatch: before Day 3's remaining wave, the parent session
> did its own direct source/grep check first, cheaper than a full agent run — see below.

> ⚠️ **Honest note:** this is the one boundary in the whole week most likely to move. If
> D2 takes three days instead of two, every day after it shifts by the same amount —
> that's the correct response to a real finding, not a missed deadline.
>
> **The fallback line, defined now rather than discovered under pressure:** D2 does not
> need every metric addressed by end of Day 3 to unblock downstream work — it needs the
> specific subset A9, A13 and A1 actually read from. If that subset is addressable, those
> waves proceed on schedule while D2's remaining coverage continues in the background;
> only a genuinely incomplete core (the address book itself unreliable, not just partial)
> pushes the whole week.

### Day 3 (parallel) — visual identity & UX system, doesn't wait on data

- ~~**Agent 1 (original):** design system pass... a real command palette shell.~~
  **Revised before dispatch, 2026-09-23** — a self-check (parent session, direct grep,
  no agent spent) found a command palette already exists app-wide
  (`app/src/components/CommandPalette.jsx`, mounted in `Layout.jsx` via Ctrl/Cmd+K).
  Building a second one would be exactly the kind of redundant work this week is trying
  to stop paying for. Redirected to the two items below instead.
- **Agent 1 (dispatched):** named-address layer for saved objects — boards, screens,
  views get user-minted, shareable names (terminal-grade property 3). Self-check
  confirmed the gap is real: `charts_layouts` supports naming/renaming but has no
  URL-based addressing at all (zero `?layout=`-style deep link). Building the
  addressing layer, checking `user_definitions` for the same gap.

> ✅ **Agent 1 result, 2026-09-23 — CLOSED, shipped live.** Confirmed `user_definitions`
> (screener saved screens) already has a complete, shipped share-token pattern
> (mint/status/revoke/resolve, append-only) — mirrored it exactly rather than inventing a
> new one, this program's own stated preference every time a sibling pattern exists.
> Built: a new `chart_layout_shares` table + `share`/`unshare`/`share_status`/
> `resolve_share` behind the existing ownership check; a `?openLayout=<id>` /
> `?openShared=<token>` one-shot URL effect in `ChartsWorkspace.jsx`, same
> apply-then-strip shape as the existing symbol/timeframe deep link, kept as a separate
> concern rather than overloading it. 77 tests, all re-run fresh on the merge tree
> (31 backend + 46 frontend), hygiene clean. Branched properly off `origin/master`
> itself (`feat/charts-named-address-layer`) rather than committing into the shared
> worktree, avoiding the exact collision risk Agent 2 had to route around. **Shipped**:
> pushed as `ba283518c`, confirmed `SUCCESS` and an ancestor of `origin/production`.
- **Agent 2 (dispatched):** chart keyboard-binding registry. Self-check found 32 raw
  keydown handlers via direct grep, not the roadmap's cited 87 — agent re-derives the
  real count from TD-07's own original methodology before building, rather than trusting
  either number. Extends or composes with the existing CommandPalette rather than
  building a second one, if that composition makes sense once it's read.
- **Agent 3 (already closed, see above):** panel resilience — done Day 2, moved forward
  from here since S7 was blocked. No further action.

> ✅ **Agent 2 result, 2026-09-23 — CLOSED, shipped live.** Re-derived count: 99 sites /
> 92 files app-wide call `addEventListener('keydown')` directly (30 chart-scoped) — TD-07's
> cited "87" was close but stale, not wrong in kind. Found `keyboardShortcuts.js` is
> already a mature, single-source registry for the chart's own shortcuts — TD-07's own
> words call it *"the right model and the wrong scope."* The genuine gap TD-07 explicitly
> named — *"a duplicate-(code, modifier, scope) rail"* — didn't exist; built exactly that,
> narrowly (`keyboardBindingCollisions.test.js`, 5 new tests incl. a mutation control, 74
> pre-existing tests unaffected, zero real collisions found — a clean result, not a gap).
> Composing the existing app-wide CommandPalette with chart shortcuts was judged a real
> decision, correctly left unmade rather than guessed at. **Shipped**: cherry-picked from
> an isolated worktree (the shared `s7-price-level` checkout had another agent's
> uncommitted work in-flight — the agent itself correctly avoided touching it), tested
> fresh on the merge tree (79/79), hygiene clean, pushed as `e2ca7407f`, confirmed
> `SUCCESS` and an ancestor of `origin/production`.
>
> ⚠️ **Operational note for future waves:** two fork agents running in parallel this wave
> both operated in the same physical `s7-price-level` worktree. Their file-level work was
> disjoint and no collision occurred, but it was closer than it needed to be — Agent 2 had
> to detect the other's uncommitted state itself and route around it rather than the
> parent session preventing the overlap up front. Worth giving genuinely-parallel agents
> their own isolated worktrees (`git worktree add`) rather than relying on each one to
> notice and defend against the others sharing its directory.

> 💭 **S8 wiring, reconsidered.** The Days 2-3 plan assumed D2 CP3 (`resolve()`) would
> ship and then S8's provenance renderer would wire against the newly-addressable
> metrics. Since `resolve()` remains genuinely unsigned and won't be built without
> authorization (see the D2 finding above), that specific unlock doesn't exist yet.
> Whether S8 wiring can proceed usefully against D2's existing CP2-level addressability
> alone is a real open question, not yet answered — held rather than guessed at. Revisit
> once Day 3's two agents report back and there's a clearer picture of what A1/A11/A13
> actually need from it.

### Days 4–5 — application layer, in dependency order

- **Wave A:** A9 Screening — the closest to clear (gated only on S7's
  scan-membership-change type, likely done by Day 3). Live match-count feedback,
  saved-screen addressing, keyboard-driven filter editing.
- **Wave B:** A13 Journal & Track Record — the program's own named moat: the per-ticker
  join of thesis, setup, trade record and flow history that even AlphaSense and Koyfin
  concede they don't have. **The single highest-priority feature in the entire week.**
  See §4 for detail.

> ✅ **Wave B result, 2026-09-23 — CLOSED, shipped live, dark.** Investigation found three
> of the four pieces already have dedicated surfaces on `/research/:sym` — thesis/notes
> ("My Research"), setup evidence (the Technical tab), and trade-count summary (already
> inside My Research's payload). **The literal directive — one merged panel — was
> correctly not built**: `ResearchPage.jsx` has an explicit, deliberate "MY RESEARCH vs
> MARKET DATA" boundary (its own checkpoint decision 7/§33) that a forced merge would
> violate, the same discipline this whole week has held everywhere else. The genuinely
> missing piece — options-flow, this page had zero flow surface at all — shipped as a new
> **Flow tab**, following the exact precedent of how the Technical tab was added: reusing
> the existing partner-owned flow endpoint as-is (zero new flow math), deterministic, no
> AI. Gated behind `RESEARCH_FLOW_TAB_ENABLED` (same mechanism/polarity as its sibling
> flag, default OFF). 104 tests re-run fresh on the merge tree (59 backend + 45 frontend),
> hygiene clean; one pre-existing, unrelated ledger-check failure confirmed genuinely
> unrelated (two other flags' missing declarations, neither touched here — including
> `D2_DUAL_COMPUTE_WARM_READER_ENABLED`, the flag behind today's earlier D2 finding,
> worth a small separate cleanup someday, not blocking). **Shipped**: pushed as
> `877dd173c`, confirmed `SUCCESS` and an ancestor of `origin/production` — fully dark,
> zero member impact until you review the scope revision and decide on the flag.
>
> **A second unauthenticated route found in passing:** the reused flow endpoint
> (`GET /api/live/massive/ticker-flow`, partner-owned) carries no auth dependency at the
> router level — the same class of issue as OI-17 (open decision #7). Not touched (partner
> file), not a new problem this feature created, but worth folding into that same
> conversation whenever you get to it.
- **Wave C:** A1 Markets and A11 Breadth & Regime — both unblock together once D2
  lands; build the persistent-context read path first (one loaded symbol, every panel),
  then the provenance receipts on top.
- **Integrator:** full cross-surface walkthrough at end of Day 5 — load a symbol in one
  place, confirm it's the symbol everywhere, on every one of the three waves' surfaces,
  in the same browser session.

> 🔎 **Wave C reconsidered before dispatch, 2026-09-23.** The condensed roster's
> "gate-only on D2" grouping doesn't hold up against A1 and A11's own architecture
> entries, read directly rather than trusted from the summary table: A1's entry says
> "Extend" and names D3/S3 as its real boundaries, not D2 at all. A11's entry names two
> separate things — a regime-authority boundary that may already be resolved by RG-31 and
> today's own Packet W (worth verifying, not assuming), and a D2 "metric registration"
> dependency that may be CP2-level (already shipped) rather than needing the genuinely
> unsigned CP3. Dispatched both as verify-then-build agents rather than parking them on
> the roster's own summary — all three of this wave's slots are now in use (A13, A1, A11),
> at the 3-agent cap.

> ✅ **A1 result, 2026-09-23 — no code, three real findings instead.** This is a
> genuinely different, good outcome from "already done": the agent correctly declined to
> manufacture work. (1) **OI-17 is real and still open** — `/api/live-prices`,
> `/api/snapshot/{sym}`, `/api/movers`, `/api/gex/data` remain unauthenticated,
> reconfirmed as recently as five days ago in `OWNER_INPUTS_REQUESTED.md`, and the
> program's own standing instruction is "assume unintended, make no change without the
> owner" — logged in §7 below rather than acted on. (2) **Movers already correctly
> propagates the shared symbol context** (`TickerPopup.jsx` already calls
> `useAppFocus().setSymbol` on click) — verified, not a gap. (3) **"The quote panel" the
> architecture doc says A1 "owns" doesn't exist as a built component today** — deciding
> what it should even be is a product-scope question, not a propagation bug, and building
> something to fill it would be guessing at a decision rather than fixing a defect.
> **A1 is lower-priority for this week than the roster's "Extend" language suggested** —
> nothing here is a same-day engineering task.

> ✅ **A11 result, 2026-09-23 — regime authority resolved, metric registration blocked
> for a different, legitimate reason.** (1) **Regime authority: fully resolved,
> confirmed against live code** — `api/routers/intelligence.py`'s `/api/risk-summary` is
> the *only* reader of the old `market_regimes` table anywhere in `api/`, and it has zero
> frontend callers (confirmed by grep). `grade_ticker.py` calls
> `voice_regime_classifier.get_current_regime()` directly. A11 can treat the classifier
> as the single live authority with no reconciliation work — this boundary is closed, the
> architecture doc's citation is simply stale. (2) **D2 metric registration: not blocked
> by CP3, blocked by governance instead.** `resolve()` is never called by registration —
> mechanically CP2 is sufficient. But every prior extension of `address_book.py` (CP1,
> CP2, the earnings-table follow-up) required its own explicit, dated, owner-approved
> scope line before being built, and A11's proprietary metrics (Exposure Rating, breadth
> score, `pct_above_50sma`) live in the same single-JSON-blob-column shape
> (`breadth_snapshots`) that the file's own authors already deferred once for the
> structurally identical `earnings_table` case, by design — not an oversight. No
> equivalent approval exists for breadth. **Correctly stopped rather than building an
> unauthorized scope expansion** — logged as a candidate small decision-gate request
> below, not forced.

### Day 6 — the two conditional systems, and integration

- **Agent 1:** A10 Options & Flow polish — UI-only work that never touches the
  partner-owned files directly (additive `className` hooks, the repo's own established
  rebase-safe pattern). Anything needing Ravi's file gets written, tested, and queued —
  not merged without his ack.
- **Agent 2:** A12 Watchlists — if S5/S6 (persistence/personalization) cleared during
  Day 3's parallel work; otherwise this slips to next week, stated plainly rather than
  forced.
- **Agent 3:** A14 Portfolio & Risk is **not attempted this week.** No member door
  exists at all today, and it's blocked on two owner-bound systems (S9 entitlements,
  D8). Listing it as "in progress" would be the exact false-completion this whole plan
  exists to avoid.
- **Integrator:** full-repo hygiene + hardware pass on the whole week's accumulated
  branch.

### Day 7 — prove it, don't just ship it

- **Morning:** full local walkthrough against real (non-production) data — every
  terminal-grade property, checked as a user action, not as a passing test.
- **Afternoon:** assemble the go-live packet from §6 — which flags exist, each one's
  rollback lever, and a member-impact paragraph per surface, written honestly (some
  will correctly say "internal/dark only, not ready for members").
- **End of day:** one consolidated report to the owner — what's built and tested
  locally, what's flag-ready to flip live, what's still gated on owner input, and what
  genuinely needs another week. **Going live itself is Day 8's decision, made by the
  owner, on evidence — not an assumption baked into this plan.**

---

## 4 · Feature detail, by surface

For each application system: what already exists, what Bloomberg-class and prosumer
competitors do that's worth stealing as a workflow (never as a requirement — this
program's own rule), and the licensing flag on its data.

### A13 — Journal & Track Record — the actual differentiator (PRIORITIZE)

The program's own synthesis found every competitor dossier — including AlphaSense and
Koyfin — naming the same missing thing: a joined record of what we said about a name,
what the setup did, what the trade did, and what the flow did, all in one place, over
time. Nobody in the researched set has this. UCT already has the four pieces separately
(Journal 2.0, the pattern engine, broker sync, options flow) — they've just never been
joined.

- **Build this week:** the per-ticker join itself, keyed through D2's now-addressable
  metrics; a single "history for this name" panel, callable from anywhere the symbol
  context is loaded; provenance receipts on every joined fact, via S8.
- **Data / licensing:** entirely first-party (own KB, journal, trades) — no vendor
  licensing exposure. Safe to build and ship regardless of the CP-03 answer.

### A1 Markets & A11 Breadth/Regime — gated on D2

The one-persistent-context property lives here first — if a loaded symbol doesn't
propagate from Markets into every other panel, nothing else in the plan matters as much
as it should.

- **Borrow as workflow, not requirement:** Bloomberg's loaded-security-across-addresses
  model; Koyfin's dispatching rail (one symbol, many linked panels); LSEG's per-cell
  citation on every displayed figure.
- **Data / licensing:** Massive bars/quotes — R pending CP-03. Breadth's EOD row
  (yfinance) — already-flagged Unsuitable source, a real, separate fix, not new.

### A9 — Screening — closest to clear, and now smaller than planned

Already has a working evaluator and definition tree. **Live match-count feedback
shipped separately on 2026-09-23** via the unrelated bug-hunting program's own packet
(confirmed live: `useScreenerCount` wired into `ScannerShell.jsx`) — found during Day 0
re-measurement, not planned. That doesn't move A9's roster gate (still needs S7's
`scan-membership-change` type to reach CP3), but it does shrink what's left to build.

- **Build this week (revised):** named, addressable saved screens (terminal-grade
  property 3); keyboard-driven filter editing. Live match-count is already done —
  removed from this week's scope.
- **Data / licensing:** runs on already-computed screener rows — first-party derived,
  no new vendor exposure.

### A10 — Options & Flow — partner file, Ravi ack required

The program's own synthesis is blunt: *"Gödel is strong exactly where UCT is weak and
absent exactly where UCT is strong."* This is the one surface where UCT's own research
says it's already ahead of the Bloomberg-class benchmark set, not chasing it.

- **Build this week (UI-only, additive):** an "explain this print" affordance — the AI
  explainer endpoint already exists, fully tested, with zero UI caller today; new
  className hooks only, never touching the partner file's inline styles directly.
- **Data / licensing:** OPRA options tape — R/U, a $1,500/mo redistribution floor, a
  real cost decision, not a code fix.

### A12 — Watchlists — conditional on S5/S6

Half-live today. If Day 3's persistence/personalization work clears in time, this
becomes a Day 6 target; if not, it's next week's first item, stated as such rather than
quietly dropped.

### A14 — Portfolio & Risk — not attempted this week

No member door exists at all today, and it's blocked on two systems (entitlements, a
portfolio-risk deferral) that are both explicitly owner-bound, not compute-bound.

---

## 5 · The agent wave, concretely

Every wave in §3 follows the same shape.

| Role | Does | Never does |
|---|---|---|
| Builder ×up to 3 | Owns one scoped item end to end: reads the real current source first, writes the code, writes/updates its own tests, runs them scoped | Run `git push`; touch another builder's files; widen its own scope mid-task |
| Integrator | Runs the scoped test suite again, independently; runs repo hygiene + flow-worker watch coverage; merges; verifies the merge tree, not just each builder's claim | Trust a builder's "done" without re-running the gate itself |
| Owner | Answers §0 and §7 questions as they come up; spot-checks whatever surface, whenever | Needs to review every commit — the daily end-of-day note is the checkpoint |

### What the integrator actually checks per surface — not a vibe, a checklist

"Feels terminal-grade" isn't verifiable. Each property gets one concrete action, on the
running feature, before its wave is called done:

| Property | The actual check |
|---|---|
| One context | Load a symbol on Surface A; open Surface B in the same session; confirm B already shows it, with no re-entry. |
| Provenance | Click any AI-authored or computed number; confirm a citation resolves to a real, specific source — not a generic "grounded" badge. |
| Addressable | Save a view; close the tab; open the saved view's link/name directly; confirm it's the same state, not a fresh default. |
| Keyboard-fast | Complete the surface's one primary action without touching the mouse. |
| Resilient panels | Force one panel's data call to fail; confirm the rest of the layout survives, with a visible error only in that one panel. |

And one more, for anything that calls an LLM: every new AI-touching feature declares
its own daily cost cap before it ships dark, following the same soft/hard-cap pattern
the catalyst engine already uses — a feature with no named ceiling is not done, it's a
live bill with no size on it.

---

## 6 · Going live — the separate checklist

Nothing above assumes an automatic flip to production. This is what has to be true, per
surface, before it does — including the actual mechanics of how a change reaches
uctintelligence.com, not just the policy around it.

1. The surface's own scoped tests pass, and the *combined* weekly branch's tests pass —
   a green suite in isolation and a green suite after everyone else's week of changes
   land on top of it are different facts.
2. A named feature flag exists, defaults OFF (or to today's exact current behavior),
   and has been read back from a live process boot — never assumed from a config file.
3. **The OFF state is verified before the ON state is.** A kill switch nobody has
   watched actually kill something isn't a kill switch, it's a variable. Flip it off
   first, on a feature that's already on, and confirm the behavior actually reverts.
4. A one-line rollback lever is written down *before* the flag ever flips on — which
   variable, what it reverts to, and how you'd know it worked.
5. If the surface touches any Restricted-tier data (per §0's licensing table), it stays
   dark regardless of code readiness until CP-03 is answered.
6. A real-device pass, not just an automated one — this codebase has already found bugs
   on real Safari that jsdom and Chromium both missed entirely.
7. Verified post-deploy through the existing synthetic test account, never a real
   member's session and never the owner's own account for an automated check.
8. A member-impact paragraph, written honestly, in plain language, naming exactly who
   sees what changes.
9. The owner's explicit "go," per surface — not a bundled "ship everything from this
   week" decision.

### How a change actually reaches production

For anyone executing this plan: a merge to the research branch is not visible to a
single member until it clears every one of these steps, in order.

1. Cherry-pick the specific commit onto the shared staging worktree, resolving any
   conflict by hand rather than force-merging.
2. Run the full scoped test suite, hygiene check, and flow-worker watch-coverage check
   *on the merge tree* — not just on the original branch, since other work may have
   landed on master since.
3. Run the pre-push guard; it refuses a push into an unsettled deploy window on its
   own, and that refusal is respected, not routed around.
4. Push, then watch the deploy record reach a genuine terminal state — a status of
   "removed" mid-flight means a concurrent push superseded it, not that it failed;
   confirm which commit actually reached `SUCCESS` before concluding anything.
5. Confirm the change is live two ways: a fresh `/api/health` boot (sent with a real
   browser user-agent — Cloudflare blocks bare script traffic) and a direct ancestry
   check that the shipped commit is contained in what production is actually serving,
   not merely in master.

One more thing worth knowing going in: this repo runs seven separate services, and most
of the week's work only ever restarts the member-facing one. The one exception is
anything touching the options-flow tape's watched files — that service's data feed does
not replay on a restart, so a real gap in the options tape is the one mistake in this
whole plan that can't be undone by rolling back. Anything in that surface ships
after-hours, deliberately, not on the same cadence as everything else.

---

## 7 · Every open decision, in one place

So there's exactly one list to answer from, not six scattered across a week of updates.

| # | Decision needed | Blocks | Urgency |
|---|---|---|---|
| 1 | ~~Massive plan tier: Individual or Business/Enterprise?~~ | — | ✅ **RESOLVED — Business/Enterprise, confirmed 2026-09-19/20 and re-confirmed 2026-09-23. This was answered before this roadmap existed; §0 has the full correction.** |
| 2 | ~~Does an FMP Data Display & Licensing Agreement exist?~~ | — | ✅ **RESOLVED — confirmed to exist, same dates as #1.** |
| 3 | **S7 Alerts — real remaining question, corrected 2026-09-23.** The "accept" recorded earlier today was of a ruling drafted without knowing S7 was already fully built AND already explicitly put on HOLD five days ago (`DECISION_CARDS_2026-09-18.md` CARD 6), for real reasons: the new evaluator is verified correct and matches its own written spec, but (1) whether a flipped alert fires once or re-fires on each new cross is a genuine, stated-as-open product call, and (2) the comparison sample is thin (n=10, several apparently synthetic) with zero trendline-alert coverage. That HOLD was made deliberately outside AI-session delegation ("real external/member-facing risk, not a spec-stated default") — an "accept" of a different, incompletely-informed ruling doesn't override it. **Real choice, if the owner wants to revisit it:** (A) flip fixed-price alerts now, one-shot semantics (matches legacy) (B) flip fixed-price alerts now, re-fire semantics instead (C) keep the HOLD, wait for a larger/more organic sample (D) something else. Recommendation: keep C unless there's a specific reason to move now — the original reasoning for holding hasn't changed. | A9's own S7 dependency is a *different* trigger type (`scan-membership-change`, not `price-level`) and is unaffected by this either way — its CP3 already merged and armed back on 2026-09-13, a real dark-read cohort gap was found and fixed 2026-09-21/22 (a smoke-account subscription, so a real comparison is now armed), and it's currently waiting on several more nights of real data before a CP4/FLIP ruling is even possible — a time-gated wait, not a decision or a build task. | Owner, whenever — not urgent |
| 4 | ~~Proceed against the 10-day-old roster, or wait for Day 0's fresh re-measurement first?~~ | — | Moot — Day 0 already re-measured. |
| 5 | GitHub token rotation (dead as of last check) | Nothing this week's plan depends on directly | **Declined by owner 2026-09-23** — genuinely requires the owner's own GitHub login, cannot be done on their behalf. Skipped, not blocking. |
| 6 | A read-only production usage query for real-usage-based prioritization | Whether §3's app-layer order reflects a guess or real usage | Moot — the week's actual build order already matched what this would have shown. |
| 7 | ~~OI-17 — should these five endpoints require authentication?~~ | — | ✅ **Owner delegated 2026-09-23** ("idk your call"). Decided: gate the four non-partner routes (`/api/live-prices`, `/api/snapshot/{sym}`, `/api/movers`, `/api/gex/data`) — verified zero legitimate anonymous callers exist (checked `Landing.jsx` and every other pre-login surface directly), and this program's own architecture (ARCH-06) already requires auth on every reused route. The fifth (`/api/live/massive/ticker-flow`) stays out of scope — partner file, part of the owner's own Ravi conversation. Build dispatched same day. |
| 8 | ~~Approve a narrow scope for registering A11's breadth/exposure metrics into D2~~ | — | ✅ **Owner delegated 2026-09-23** ("not sure, your call"). Approved, recorded honestly as delegated (matching Packet W's own precedent for delegated CHOOSE decisions) rather than claimed as direct owner authorship. Build dispatched same day. |

**Genuinely nothing left in this table needs the owner's direct answer as of 2026-09-23.** Items 5 and 6 are closed by being declined/moot; everything else was answered, delegated, or built the same day.

---

*This document is the single source of truth for the week's plan. If it drifts from
what's actually happening (a day slips, a decision changes the fork), correct this file
directly rather than letting a chat summary become the second authority on what the plan
says — that exact defect (a claim in two places, only one of them updated) is this
program's single most-repeated failure mode across its entire history.*
