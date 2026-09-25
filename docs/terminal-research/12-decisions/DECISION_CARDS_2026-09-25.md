# DECISION CARDS — 2026-09-25

⚠️ Every card here was **ruled under explicit owner delegation** — the owner's words, in
order, were "1. Yes, 2. You decide. 3 What?" and then "you decide all" — and is recorded
as **delegated**, not as owner authorship (the Packet W / CARD 6 precedent). Each card is
one screen; every number is sourced to an artifact under `10-roadmap/evidence/`. A card's
"re-open trigger" is the only thing that reopens it — not a re-reading of the same data.

---

## CARD 1 — S7 price-level: the flip, its persistence semantics, and the CP4 bar

**Question (CARD 6 of 2026-09-18, options A/B/C/D):** flip delivery of the new
price-level evaluator's alerts and retire the legacy `watchlist_alerts` rule?

**Evidence, measured 2026-09-25 ~05:00Z** (`evidence/2026-09-25-s7-price-level-dark-read/`,
read through `GET /api/admin/alert-taxonomy/dark-report/price-level` as the admin smoke
account): **13 predicates** (was 10 on 09-18; the two `UCTA5` breadth pseudo-tickers F-S7-6
made visible are now priced), **12 verdict-ready** at ≥ 5 sessions (seven at 10), **one
genuine agreed event** (`legacy:f0d66360`, agreed 1 · new_only 0 · legacy_only 0 — a real
crossing both rules fired on, new since 09-18), **zero `new_only` anywhere**, `legacy_only`
2344 on exactly the one predicate CARD 6 already explained (RMIX: a level crossed once
BEFORE the window and never re-crossed — a tick count of the legacy's stateless mirror, not
disagreement), two `line`-kind levels now covered, **trendline / anchor-rewrite exercise
still zero** (`is_trendline: false` on all 13).

**RULED (delegated):**

1. **Persistence semantics — A, one-shot.** The member-facing legacy is already one-shot:
   `watchlist_alert_service._trigger_alert` sets `is_active = 0` before any channel runs
   (line 183; its own docstring at 262–282 describes the silence as terminal). "Re-fires
   every minute" describes only the DARK mirror's stateless test, never what a member has
   ever received. So the flip ships **one fire per predicate per arm**, exactly what members
   know; the new evaluator's transition semantics adds only the guarantee that a crossing
   from before the window is never replayed. A member-visible "re-arm on the opposite
   cross" control is a later checkpoint, not a v1 default.
2. **Scope — fixed-price levels only.** Trendline/anchor-rewrite has zero dark exercise;
   it stays on the legacy path until it has its own five sessions.
3. **Timing — HOLD stands for the flip itself, with the bar rewritten so it can be met.**
   The LEDGER's CP4 bar (`legacy_only == 0 and agreed ≥ 20 over ≥ 5 sessions`) was a
   forecast, and the measured base rate falsifies it: 1 agreed event across 12 ready
   predicates over 10 sessions ≈ 0.008 events per predicate-session, so 20 events needs on
   the order of **200+ sessions** on these fixtures — a measurement that cannot complete
   (the "longer than the gap between disturbances" class). Most fixtures are synthetic
   targets 30%–5× from the market (CARD 6's own finding); they will not cross.
   **New bar, delegated:** `agreed ≥ 5` across `≥ 3 distinct predicates`, `new_only == 0`,
   `legacy_only == 0` excluding pre-window persistence, over `≥ 5 sessions`, **on levels
   set by real s7-dark members** (admin/staff accounts, `api/services/rollout.py`). The
   smoke account arms nothing — it holds no real alerts by rule.
4. **The one human step, and it is small:** a real s7-dark member (the owner's own account
   qualifies) sets **3–5 price alerts within ~2% of the market on liquid names** through the
   ordinary Watchlists door. Those cross within days; nothing else in this card moves until
   they exist.

**Re-open trigger:** the new bar met (agent re-reads the dark report and assembles the
flip packet the same day), or the owner overriding scope/semantics in writing.

> **The human step is DONE — 2026-09-25 ~05:55Z.** From the owner's own account (a real
> s7-dark member, id prefix `7a6d0299`), signed in by the owner, with explicit approval:
> five fixed-price alerts within ~1–1.5% of the market — SPY above 775.50 / below 760.00,
> QQQ above 750.00, NVDA below 220.50, AAPL above 342.50 — all read back active. Record:
> `evidence/2026-09-25-s7-real-member-arming/`. The smoke account was signed OUT of that
> browser first so nothing could land on it. From here the bar is a matter of sessions.

---

## CARD 2 — S7 scan-membership-change: CP4 vs FLIP

Decided 2026-09-25 under "you decide" and recorded in the go-live packet §2c: one synthetic
screen (4 of 5 sessions agreed, 0 disagreements as of 09-25) is enough to **assemble CP4**
(widen the cohort via the S12 tag, still dark) once the 09-26 tick lands, and **not enough
to FLIP** — FLIP waits for `legacy_only == 0` over ≥ 5 sessions on ≥ 3 definitions held by
≥ 2 real members. Same one human step as CARD 1, applied to screens instead of levels.

> **DONE — 2026-09-25 ~05:55Z**, through the Screener menu's own bell buttons from the
> owner's account: **26wk HV**, **Above 50 on volume**, **Oops Reversal** (three distinct
> definitions; the last shares its tree with the smoke account's 09-21 subscription, so that
> definition now has two members, one real). Read back exactly three, `mode: both`. The
> nightly sweep projects them from tonight; five sessions per definition is the floor.

---

## CARD 3 — A12 Watchlists: the dated wait, and what gets built on the date

**RULED (delegated):** the **2026-10-12** gate (30 days of Wave Q1 stability, `F-S5-1`)
stands — it is a stability measurement, not a preference. What is decided NOW so no day is
lost on 10-12: **A12 CP2 = named addresses + share tokens for watchlists**, a straight
generalization of the layout mechanism already live (`?openLayout=`/`?openShared=` on
`/charts`, `ba283518c`): `?openWatchlist=<id>` and `?openSharedWatchlist=<token>`, one
placement per URL, token minted the same way. The other four terminal-grade properties
already hold for the Watchlists widget (one context via `useAppFocus`, arrow-key navigation,
per-widget `ErrorBoundary`, no provenance claim to make), so CP2 is the whole remaining gap.
**No standalone PRD** is required for a generalization of a shipped, tested mechanism; the
CP2 packet carries a one-page PRD-lite section instead (the personalization PRD already
owns the saved-object model). Agent-buildable on 10-12; nothing before.

**Re-open trigger:** Wave Q1 shows a keep-or-revert regression before 10-12.

> **Amended the same day under "we are on a one-week crunch — expedite".** The 10-12 gate
> binds the S5 saved-object half only (gap 2 of A12 CP1's rail, the `watchlist_view_documents`
> store copied from S5's CAS shape). The other two gaps depend on nothing that is not live
> today, so they were built and shipped as **A12 CP2 (part 1)**: the chosen performance
> columns persist per member (`watchlist_perf_cols`, hydrated after prefs load, written on
> change — CP1's gap-1 pin flipped as designed and was updated), and `/charts?openWatchlist=
> <watchKey>` is a real address in the same shape as the layout doors (validated against the
> registry's forms, retargets the board's Watchlist widget or adds one, strips its param,
> degrades on junk). Rails: 5 + 4 new cases, 59/59 existing Watchlists tests, the A12 rail
> 7/7. **Gap 2 stays on 2026-10-12.** Record: RESUME-HERE §3 / §5.

---

## CARD 4 — A14 Portfolio & Risk

**RULED (delegated): out of this program, and that is a scope statement, not a deferral.**
The member door exists (`/portfolio-heat`, A14 CP1, live since 2026-09-21) and is the whole
of what the roadmap authorized. Everything beyond it is gated on S9 Entitlements (not built,
a business decision about tiers) and D8 (a portfolio-risk deferral the owner made). Neither
is a build item and neither is improved by an agent guessing at it.

**Re-open trigger:** an entitlements decision (tiers exist and `S9` gets a gate), or D8
lifted in writing.

---

## CARD 5 — D5 CP2 (the inert corp-actions ledger)

**RULED (delegated): not built.** Nothing reads it; a table with no consumer is a second
authority waiting to drift. **Re-open trigger:** a consumer PRD that names the ledger as its
source — at which point CP2 is authorized by that PRD's own gate, the way every other
`address_book.py` extension was.

---

## CARD 6 — D5 CP6 (merger / `relation_added`)

**RULED (delegated): closed on the current plan.** No vendor signal exists — verified live
against two real M&A tickers (both 404). Not a cost decision this program makes.
**Re-open trigger:** a Massive plan change; re-probe the same two tickers first, build
nothing until one answers.

---

## CARD 7 — CP7 member-facing adjustment sentence

**RULED (delegated): stays deferred to S8/S10 per its own approval**, and the copy is
decided now so the deferral costs nothing later. When a surface renders
`GET /api/bars/{ticker}/adjustment-basis`, the sentence is:

> Prices reflect splits and dividends as of {basis_date}. Source: {vendor}.

Two facts, both from the endpoint, no adjective. **Re-open trigger:** S8/S10 mounting the
basis on a member surface.

---

## CARD 8 — A10 CP2 (mount the AI print explainer in `OptionsFlow.jsx`)

**RULED (delegated): the decision is draft PR #194** (`feat/a10-cp2-flow-explain-mount`,
`6ea3d40aa`): six inserted lines in the partner file, zero modified, zero deleted, a 7-case
structural guard, every rail green except the reachability rail's now-stale "held unmounted"
entry, which the merger deletes (the authoring session's tool policy refused that shared-file
edit twice). **Merge on Ravi's acknowledgment — nobody decides that for him.** If no ack by
**2026-10-02**, the owner asks Ravi directly with the PR's "What Ravi needs to know" section;
the PR stays a draft until then. Web-only; `flow-worker` imports nothing here (gate §6).

> **Superseded the same day.** The owner released the Ravi precondition ("Forget Ravi we are
> fine"); CP2 landed as `13ecb46e3` + `d199ea601` (SUCCESS 16:20:37Z), was **rolled back under
> H15** (`3b2e1a28a`, 16:31:53Z) when the warm-pod nav smoke timed out on a fresh
> `/options-flow` load at +5.5 min, and was then **exonerated by the controlled comparison**:
> the reverted build failed identically at the same pod age (RESUME-HERE §3 / §7). The re-land
> is prepared on `merge-run` (`88399772c` + `056290d37`) and its push is the owner's one command
> (RESUME-HERE §5). PR #194 is closed with the after-the-fact notice for Ravi.
> **The owner pushed it at 17:27:25Z; LIVE as `7878374fb` (SUCCESS 17:30:04Z), with the
> market-hours smoke floor that stops the false H15 shipped in the same stack.** CARD 8 is done.

---

## What is NOT decided here, on purpose

- Whether real members outside the s7-dark cohort ever see the new alert path — that is
  the FLIP line and it waits on CARD 1's bar.
- Any change to the smoke account's standing rule (no real alerts, no real subscriptions).
- Anything in a partner-owned file beyond the six lines in PR #194.
