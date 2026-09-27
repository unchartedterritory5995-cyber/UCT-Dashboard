---
id: OWNER-INPUTS-FORM
title: Owner inputs — a fill-in form. Pasting it back IS the ruling.
role: every input that blocks a system, and every PROVISIONAL taken without one, as one-line choices
status: awaiting the owner. Nothing here is decided.
date: 2026-09-12
---

# Owner inputs — fill in and paste back

⭐ **HOW TO USE THIS:** replace each `CHOOSE: ____` with a letter or a yes/no and paste the whole
file back. **That is the whole ruling** — no other form is needed, and anything you leave blank
stays blocked rather than silently defaulting.

⛔ **A BLANK IS NOT A DEFAULT.** Every line below has a recommendation, and the recommendation is
what this programme would do; it is not what it *has* done. Nothing here has been acted on.

---

## ✅ PART A — RESOLVED 2026-09-14 WITHOUT THE OWNER. Kept for the record.

> The owner's 2026-09-14 instruction converted these from questions into **procedures**. What each
> became is recorded here; the form below is history.

| was | is now |
|---|---|
| **A1 · OI-03(a) Massive tier** | **UNKNOWN-VERIFIED** — attempted in the browser, `massive.com/dashboard` redirects to signup, **not signed in**, no credential entered. → **conservative default: INDIVIDUAL tier, no member display.** |
| **A2 · OI-03(b) FMP agreement** | **UNKNOWN-VERIFIED** — `site.financialmodelingprep.com/…/dashboard` redirects to `/register`. → **conservative default: NO agreement.** ⛔ And a licensing agreement is a **contract**, so even a signed-in dashboard might not settle it: absence from a dashboard is not absence of a contract. |
| **A3 · OI-06 desk morning** | ✅ **DERIVED FROM TELEMETRY 2026-09-14**, production `/data/auth.db` (29 users). Manifest order = **session-opener** order (`/dashboard` first, 22 of 50 admin session-days), tiebroken by total views; S2's default command = *open the dashboard*. ⛔ The external-tool half of OI-06 is **structurally unanswerable** from our own `page_views` — telemetry records this app only — so it falls to shipped behaviour: **no external-tool affordance, no TradingView alerts assumed.** `verification/2026-09-14/OI-06-telemetry-derived-defaults.md`. |
| **A4 · browser checks** | **RUN** 2026-09-14 as admin via the smoke-login link. Bell PARTIAL, Ask-AI provenance PASS, S3 `/status` queued. `verification/2026-09-14/browser-checks.md`. |

### ⛔ The consequence of the two conservative defaults, stated once

**The 57 licensing-register rows that MOVE on these two facts are RESTRICTED, and S9 is built
to ENFORCE that rather than to
assume it away.** Per the owner's rule: *a conservative default that is wrong costs features; a
permissive default that is wrong costs a licensing breach.*

⭐ **This is a DEFAULT, not a finding**, and it must be re-read the moment either account can be
opened — as **one unit**, because a per-row correction would leave the register in a state no
single fact explains. Evidence: `verification/2026-09-14/OI-03-vendor-tier-and-licensing.md`.

---

## ⚰️ PART A (historical) — the four inputs that blocked a system

### A1 · OI-03(a) — the Massive data tier

**Question:** Which Massive tier does UCT hold?
**Why it blocks:** every member-facing data feature; whether cost scales per member.

```
  A) Business / Enterprise  — ToS permits display to Edge Users
  B) Individual tier        — individual use only, no member display
  C) Don't know / need to check the contract

CHOOSE: ____
```
**Recommendation:** **C is an honest answer and unblocks nothing** — if it is C, say so and S9
stays blocked; the programme will not guess. **Unblocks:** S9 Entitlements, A14 Portfolio & Risk.

### A2 · OI-03(b) — the FMP display agreement

**Question:** Does UCT hold an FMP Data Display and Licensing Agreement? (FMP bars multi-user
display without one.)

```
  A) Yes, signed
  B) No
  C) Don't know

CHOOSE: ____
```
**Recommendation:** none — this is a fact about a contract, not a judgement.
**Unblocks:** S9, A14, and the licensing register's FMP rows.

### A3 · OI-06 — the tools the desk actually opens by hand

**Question:** Of thinkorswim, TradingView, Finviz, Market Chameleon, Unusual Whales, SpotGamma —
which do you and the partner open **by hand** on a trading day, and does the desk run any
TradingView alerts?

```
  Opened by hand (list, in order of time spent): ______________________________
  TradingView alerts in use?  YES / NO :  ____
```
**Why it blocks:** S1's surface manifest and S2's keyboard registry both shipped PROVISIONAL
*ahead* of this, and you ruled its findings get diffed against what shipped.
**Recommendation:** answer even if the list is short — **a two-item answer unblocks three
systems.** **Unblocks:** S1, S2, A2.

### A4 · Browser checks — F-I1-2

**Question:** F-I1-2 needs a browser run you perform. Do you want it this week?

```
  A) Yes — I'll run it, keep F-I1-2 open
  B) No  — park it further, and say so in the audit
  C) Close it as EXCLUDED with the reason "not worth the owner's time"

CHOOSE: ____
```
**Recommendation:** **B.** It has been parked once already and nothing depends on it.
**Unblocks:** nothing — this only moves F-I1-2 out of "in progress".

---

## PART B — the PROVISIONALs taken today, for confirm-or-reverse

Each was taken so the day would not stall. **Reversing any of them costs little now and more
later.**

### B1 · The H-prefix collision (F-AUDIT-1, new today)

`H14` is BOTH a hazard rule (*a live hazard is a hard stop*) and a hypothesis in
`hypothesis-register.md`. The whole H1–H35 range overlaps. Same shape for `G`: `G1`–`G5` are D1
provider gaps, `G7`–`G12` are capability-ledger gaps.

```
  A) Rename the HYPOTHESIS register (HY-01…)  — rules keep their ids
  B) Rename the RULES (HR-01…)                — hypotheses keep theirs
  C) Leave both; disambiguate at each mention

CHOOSE: ____
```
**PROVISIONAL taken: A.** The rules are cited in commit messages and code comments across the
estate; the hypotheses are cited only inside `13-executive-synthesis/`. Renaming the smaller blast
radius is cheaper and safer.

### B2 · `650865d5` — the unresolvable deploy citation

Cited six times as the 2026-07-26 healthcheck deploy; matches no git object anywhere. The commit
matching its description exactly is `2908ab227` (reverted same day by `f5fb3e21d`).

```
  A) Keep 2908ab227 — it is the verified commit
  B) Restore 650865d5 and mark it UNRESOLVED (it may be a Railway deploy id)

CHOOSE: ____
```
**PROVISIONAL taken: A**, with the original recorded in the tombstone either way.

### B3 · D2 CP3's gate narrowing

"≥200 rows" is counted as **200 AGREED rows**, because the literal reading passes on 200 rows of
`book_unavailable` — a deleted manifest has zero inequalities.

```
  A) Confirm: 200 AGREED rows
  B) Reverse: 200 rows of any outcome

CHOOSE: ____
```
**PROVISIONAL taken: A.** Already recorded in the D2 gate. **B would let a deleted manifest
certify the book.**

### B4 · D2 §9.5 — the indicator axis

Neither a translation table (maps 1 of 31) nor a migration (nothing to migrate into). The
recommendation is a **second address form** describing a computation.

```
  A) Sign §9.5 as written — declare 30 addresses + (metric, timeframe) cadence
  B) Reject; indicator-condition stays permanently at CP1-CP2
  C) Something else: _______________________________________________

CHOOSE: ____
```
**PROVISIONAL taken: none — this one is genuinely yours.** ⛔ It changes what the address book IS:
today it maps a name to a stored place and computes nothing. **Unblocks:** `indicator-condition`
CP3, whose approval line is already signed and VOID until this merges.

### B5 · F-S7-RC-1 and F-S7-RC-3 — two confirmed regime defects — ✅ RESOLVED 2026-09-20

RC-1: the `dedup_key` is built and never read. RC-3: path B has no ledger, so it re-queues the
same unchanged flip until the shared 8/day cap, crowding out `daily_focus`.

```
  A) Fix both now, own PR, member-visible (fewer duplicate insights)
  B) Fix RC-3 only (the one that costs a member their daily_focus)
  C) Record as EXCLUDED — the whole path retires at the S7 flip anyway

CHOOSE: B
```
⚰️ **PROVISIONAL taken (never resolved): C**, on the reasoning that both die at the flip — ⚠️
*"but the flip has no date, and 'it retires eventually' has kept two live defects alive before
in this estate. If the flip is more than a month out, B."* **CHOSEN 2026-09-20: B**, applying
that stated fallback — the flip is presently blocked/undated (the production dark-comparison
read for A9/A11/A13/event-proximity has no date), so the "if more than a month out" condition
is satisfied. RC-3 fixed, `feat/s7-price-level` `87b5735f4`. RC-1 EXCLUDED (its cost is
genuinely near-zero today — path A's own ledger already suppresses same-cycle floods; only a
fast A→B→A flap across cycles is uncovered, and that is a nuisance-severity gap, not a
member-harm one like RC-3's daily_focus crowd-out).

### B6 · The two S7 dark flags have no retirement date

`ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED` and `..._EVENT_PROXIMITY_...` each retire only when
their type flips, and nothing forces that.

```
  A) Set a review date: ____________
  B) Leave them; the dark read decides

CHOOSE: ____
```
**PROVISIONAL taken: B**, ⚠️ with the warning that a dark flag with no retirement date becomes
permanent by default — which is how this estate acquired the flags it now cannot explain.


### B4-PLAIN · D2 §9.5, the indicator axis — five plain lines, as asked

1. **What the metric address book is today.** One file listing 142 metrics, each saying *where a
   value is already stored* — a table and a column, nothing more. It computes nothing, so it can
   never be wrong about a number; it can only be wrong about a location.

2. **What the indicator axis adds.** Thirty more addresses that have **no stored location** —
   `bb.upper`, `rsi`, `macd` and the rest are calculated on demand from bars, differ per
   timeframe, and change meaning with their parameters. The book would start describing *work to
   be done* instead of *a place to look*.

3. **What signing it lets happen.** `indicator-condition` becomes buildable. Today every predicate
   a member could write in the legacy alert lane **refuses** — measured: 31 legacy addresses, 142
   book metrics, exactly one shared (`close` ↔ `ohlcv.c`). Signing unblocks that type's CP3, whose
   approval line is already written and void until this merges.

4. **What it risks.** The book stops being a pure lookup, which is the property that makes it safe
   — a wrong entry today points at the wrong column and is caught; a wrong entry then computes a
   wrong number and looks authoritative. It also needs `bars_fetch`/`bars_sqlite` edits, and those
   sit inside flow-worker's closure, so declaring the cadence costs either a tape gap or a change
   to what flow-worker watches.

5. **Recommendation.** ⚠️ **Not yet — and not never.** The unblock is one alert type; the cost is
   the book's defining property plus a flow-worker decision nobody has made. **Settle the
   flow-worker watch-list question first** (that is a small, reversible call), and sign §9.5 after.
   If you want `indicator-condition` sooner than that, sign it — but sign the watch-list change
   with it, because building one without the other ships a declaration the worker computes against
   a stale copy of.

---

## PART B-2 — ⚰️ ANSWERED BY ACTION SINCE THIS FORM WAS WRITTEN (2026-09-12)

Left in place rather than deleted, so a returned form cannot contradict what shipped.

| item | state now |
|---|---|
| **B4 / B4-PLAIN** · D2 §9.5, the indicator axis | ✅ **SIGNED AND MERGED** as **GATE-D2 CP4**, fingerprint `3257cc319`, merge `404b808c5`. §4 was re-numbered in the signing commit because §9.5's scope matched none of CP1/CP2/CP3. **This CHOOSE is moot** — answer it only if you want the decision reversed. |
| **C1** · arming the four new CP3 sweeps | ✅ **DONE 2026-09-13**, plus a fifth: `indicator-condition` armed 20:48:30 UTC. **Seven** dark sweeps are now armed, not four. |
| **B6** · the S7 dark flags have no retirement date | ⚠️ **STILL OPEN AND NOW WIDER** — it said *"the two S7 dark flags"*; there are **seven**. |

---

## PART D — PROVISIONALs taken 2026-09-13, awaiting confirm-or-reverse

### D1 · F-S7-PL-2 — per-sweep windows NARROW what `--ticking` calls a stall

Generalising `--ticking` over the sweep table gave each sweep its own window. A sweep that dies
**mid-window** and is only checked **after** the close now reports exit `0`, where the single
global window would have reported a stall.

```
  A) KEEP the narrowing — a windowed sweep that stopped at its window's close has done nothing
     wrong, and flagging it every weekend gets the command muted
  B) REVERSE it — a stale heartbeat is a stall whatever the clock says

CHOOSE: ____
```
**Recommendation: A.** The Monday 09:05 ET check is inside every window, so it is not a gap today.
**Unblocks:** nothing — it settles whether the instrument is measuring the right thing.

### D2 · F-GATE-1 — two approval-fingerprint conventions, and one duplicated pin

27 of 33 approval lines are `git hash-object` content fingerprints; **6 are commit SHAs**. Both pin
bytes. ⛔ But `s7-event-proximity`'s **two** lines carry the **same** value, and that commit
contained only the first block.

```
  A) Content fingerprint is the one convention; re-pin the 6 (needs 6 new signatures)
  B) Both conventions are acceptable; re-pin ONLY event-proximity line 2 (1 new signature)
  C) Record and leave — the bytes are recoverable either way

CHOOSE: ____
```
**Recommendation: B.** A is six signatures for a property `git show` already gives; C leaves one
line pinning a state in which it did not exist. **Unblocks:** nothing — it closes F-GATE-1.

### D3 · F-S7-IC-1 — thirty indicator outputs the book carries in no form — ✅ RESOLVED 2026-09-20

CP3 now reports them **NOT COMPARABLE per predicate**, which is honest. Closing the finding needs a
book form for the thirty — **thirty declarations plus a warmup contract**, and it is blocked on the
`bars_fetch`/`bars_sqlite` watch-list decision you already ruled (the list is NOT widened).

```
  A) Declare the thirty later, after the flow-worker watch-list question is reopened
  B) EXCLUDE the thirty permanently — the legacy indicator lane keeps its own vocabulary
  C) Leave OPEN, unscheduled

CHOOSE: B
```
⚰️ **Recommendation on record was C** ("the dark read will show whether any member predicate is
affected; deciding before that data is guessing") — but the dark read, whenever it happens, only
ever speaks to the ONE comparable predicate; it can never produce evidence about the other thirty
either way, since they are structurally NOT COMPARABLE by vocabulary, not by missing data. Waiting
on it does not actually inform this decision. **CHOSEN 2026-09-20: B, EXCLUDE** — owner approved
the agent's recommendation that a 30-indicator vocabulary-mapping exercise is real, separate work
that nothing else in the programme is blocked on; the legacy indicator lane keeps its own
vocabulary. **Unblocks:** the indicator-condition FLIP is no longer waiting on this finding.

---

## ✅ PART E — RESOLVED 2026-09-14, NO ANSWER NEEDED. Kept for the record.

### E1 · The Railway staged-change queue holds somebody else's change

`terminal-next-monitor` needs two dashboard settings — **source repo**
(`unchartedterritory5995-cyber/UCT-Dashboard`, branch `master`, repo root, no custom start command)
and **cron** (`0,12,20,30 11,12,13,14,20,21 * * *`). Both were entered; **both are unapplied**, and
`railway status --json` still reads `source.repo: null`, `cronSchedule: null`.

⛔ The reason is not the settings. **Railway's staged-change queue is per-ENVIRONMENT**: one
**Deploy** applies everything staged, and the queue also holds **`web` → `CHART_EDGE_SECRET`, one
variable, "web will redeploy"** — not this programme's change. Deploying it would put another
workstream's secret into production and restart `web`. Discarding it would destroy their work.
**Neither was done.**

✅ **IT RESOLVED ITSELF AND THEN WAS APPLIED.** The chart-edge workstream applied its own
`CHART_EDGE_SECRET` (web deployed `954309f0f`), leaving the queue empty. With nothing foreign
staged, the two monitor settings were applied through the dashboard and the Details dialog listed
**only `terminal-next-monitor`**. CLI readback: `source.repo` set, `cronSchedule` set,
`nextCronRunAt` 2026-09-14T11:00:00Z, deploy SUCCESS on `e659454bb`, first run posted to admin
Discord. ⛔ **Nothing belonging to another workstream was deployed or discarded.**

⚰️ The three options below are kept because the CONSTRAINT is permanent even though this
instance cleared: Railway's staged-change queue is per-environment, so any future dashboard change
here can be blocked the same way by somebody else's staged work.

~~**CHOOSE ONE:**~~

- [ ] **E1-a** — *"`CHART_EDGE_SECRET` is mine / is fine; deploy both together."* One Deploy applies
      the monitor's two settings **and** the web variable, and `web` restarts. Bound by the
      one-master-merge-at-a-time rule: `web` must read SUCCESS before the next push.
- [ ] **E1-b** — *"Leave the web change alone; apply the monitor's two settings by a
      service-scoped path."* I would set them through Railway's API against
      `serviceId 12d04e57-6a56-455e-b9ec-d46cf0864162` only, which never touches `web`.
- [ ] **E1-c** — *"Leave it entirely; I will do it."* Layer 1 stays code-only until then, and the
      Monday check stays a hand command.

⚠️ Whichever you pick, **verify by `railway status --json`, never by the service card** — mid-attempt
the card read *"3 Changes · Next in 11 hours"*, a next-run time for a cron that did not exist.

---

## PART C — the one thing I need that is not a ruling

### C1 · Arming the four new CP3 sweeps

Their approval lines are signed and every flag is **OFF**. Arming is your flip, after the
price-level dark read. **No action needed now** — recorded so it is not forgotten.

---

## PART G — NEW 2026-09-20, surfaced while scoping A14 off DEC-08's answer

### G1 · A14 (Portfolio & Risk) — who may see aggregate risk? — ✅ ANSWERED 2026-09-20

DEC-08 was answered directly this session ("does the desk need a corp-actions/portfolio-risk
calendar daily?" → **"Yes, we need it daily."**), and I went to scope A14's first real checkpoint
off that answer. It turns out DEC-08 was never A14's only blocker — the original research
(`10-roadmap/2026-09-12-a-series-bucket-sort.md:357`) named it **owner-bound twice over**: DEC-08
itself, and separately, *"S9 (who may see aggregate risk)"*. S9 is now fully done (both CP1 and
CP2 signed), but checked what it actually answered: OI-03(a)(b)/OI-12 are about which **vendor**
licensing tier we hold (Massive Business/Enterprise, FMP DDLA) — a completely different question
from which **member subscription tier** gets to see a new aggregate-risk feature. Nothing S9 built
answers this second question, and it was never separately asked.

This matters because the answer is not free to skip: `api/services/portfolio_heat.py` (203 lines)
already computes the real numbers — risk-heat against the 10% aggregate cap, notional exposure
against the regime ceiling, per-position at-risk, by-sector concentration, broker-placeholder-stop
detection — confirmed still true this pass. It has **zero** page routes (0 of 91 match
`portfolio|risk|heat`) and is reachable only through four assistant-tool call sites
(`journal_two/coach_chat_tools.py`, `voice_tool_impls.py`, `ai_search_personal.py`,
`grade_watchlist.py` — the last of these reuses portfolio_heat's own internal helpers for a
different purpose, not a duplicate reader of the same fact, so no A12-style consistency rail
applies here). Giving it a real page is a small build — the hard part was always this ruling, not
the code — and the prior research said so explicitly: *"that is a door problem, not a system, and
it should not be smuggled in under an A14 CP1."* I'm asking rather than guessing, on purpose.

```
  A) Paid tier only (e.g. the same tier that gates other advanced surfaces)
  B) All logged-in members, free tier included
  C) Admin/staff only for now, as an internal tool, before any member-facing tier decision
  D) Something else: _______________________________________________

CHOOSE: D
```

**Owner's answer, verbatim, live session 2026-09-20:** *"we no longer have a free and paid tier,
only paid."* **Verified against the code the same session**, not taken on faith:
`app/src/constants/freePages.js` — `export const FREE_PAGES = ['/morning-wire']`. Every other
router/page comment citing this constant (`api/routers/{calendar,engine_data,modelbook,scans}.py`,
`api/top_flow_router.py`) independently confirms the same list and dates the change to
*"the 2026-07-19 owner decision."* Options A and B in this form both assumed a live free/paid
split that does not exist — **there is nothing to gate against**, since the entire logged-in
member base is already paid, one marketing page excepted. This CLOSES G1 as: **gate the new
aggregate-risk page as an ordinary paid-member feature** — no special elevated tier, and not
admin-only (C was not chosen). **Unblocks:** A14's first real CP1 (a thin page wired to
`portfolio_heat.py`, reusing the already-computed numbers — no new computation, no schema change),
gated the same way every other paid surface already is.

⚠️ **Flagged, not fixed here — a broader finding, out of this item's scope:** the code worktree's
own `CLAUDE.md` ("Auth & User System") still documents a **"Free tier: Dashboard, Breadth, Charts,
Options Flow, Journal, Model Book accessible without payment"** — six pages, not the one
(`/morning-wire`) `FREE_PAGES` actually names. That description predates the 2026-07-19 change and
is stale by the same evidence that closes this item. Worth a correction pass in that file, but it
is CODE-repo documentation, not this programme's own tracked doc — flagged for the owner to decide
whether/when to fix it, not silently corrected here.

---

## What this form unblocks, in order of leverage

| answer | unblocks |
|---|---|
| **A3 (OI-06)** | **S1, S2, A2** — three systems, one answer |
| **A1 + A2 (OI-03)** | **S9, A14** |
| **B4 (D2 §9.5)** | `indicator-condition` CP3 |
| **G1 (who sees A14)** | **A14** — its first real CP1 |
| B1, B2, B3, B5, B6 | bookkeeping and two live defects; no system |
