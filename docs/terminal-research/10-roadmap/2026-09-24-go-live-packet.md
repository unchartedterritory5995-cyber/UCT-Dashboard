# Go-live packet — UCT Terminal one-week program, 2026-09-24

Assembled per §6 of `2026-09-23-one-week-execution-roadmap.md` ("Going live — the
separate checklist"). This is the Day 7 artifact that document calls for: per surface,
what's true against the 9-point checklist, so the owner's "go" decision (§6 item 9) is
made on evidence, not on a bundled "ship everything from this week" assumption.

**This document decides nothing.** Every row below ends in a recommendation, never an
action taken. Flags stay exactly where the program that shipped them left them until the
owner reads this and says which ones flip.

---

## 1 · Already live, no flag, no decision needed

These shipped without a flag — either because they're fixes/corrections (nothing to
roll back to but the prior, broken behavior) or additive changes to an already-public
surface with no new data exposure. Confirmed live via `git merge-base --is-ancestor
<sha> origin/production` and a fresh `/api/health` boot, same evidence standard as
everything below.

| Commit | What | Why no flag |
|---|---|---|
| `caebdab16` | OI-17 — 4 anonymous market-data endpoints gated behind auth | Security fix, not a feature — there is no "off" state that isn't the vulnerability |
| `3207690b4` | Fix: session expiring mid-poll on `/api/live-prices` no longer freezes silently | Bug introduced by the fix above, closed same day — pure correction |
| `e2ca7407f` | Chart keyboard-binding duplicate-collision rail | Dev-facing test rail, no member surface |
| `ba283518c` | Named-address layer for chart layouts — `?openLayout=`/`?openShared=` deep links | Additive URL capability on an already-live, already-authenticated surface (`/charts`); no new data class exposed |
| `985a3761a` | A11: 51 breadth metrics registered into D2's address book | Pure internal data-model registration — no reader, no UI, nothing a member can reach differently |
| `0b42d050c` | D5: census blind-spot fix (two yfinance corp-action reads now tracked) | Dev tool only (`tools/corp_actions_census.py`), no product code path |
| `b9261e57b` | A9: keyboard-driven filter editing (`/`, arrows, Enter, Escape) on Screener | Pure keyboard-accessibility addition to an already-live surface; mouse/touch behavior unchanged |
| `424bf3355` (2026-09-21, pre-dates this program) | S1 CP3: per-widget `ErrorBoundary` isolation on `/charts` | Already live before this week; terminal-grade property 5 confirmed satisfied here |
| `acd230c15` | CLAUDE.md correction: stale OptionsFlow hook removed, PACKET-AA CP1/CP2 status recorded | Docs only, zero code path |

**Owner action needed: none.** These are recorded here for completeness and because
§6 item 1 ("the *combined* weekly branch's tests pass") is the one checklist item that
applies to all of them collectively — confirmed by the cross-surface integration
walkthrough (2026-09-23): 242/242 combined, zero file overlap, hygiene clean across the
first five; every commit landed after it has been individually scoped-tested and
hygiene-checked the same way before shipping (see each result callout in the roadmap).

---

## 2 · Dark, flag-gated, awaiting an explicit "go" — the actual decision surface

These exist in production code right now but are inert for every member until a named
flag flips. Each row is checked against §6's 9 points; a ✅ means verified, a ⚠️ names
what's still needed before that point is satisfied.

### 2a — `RESEARCH_FLOW_TAB_ENABLED` (A13 Wave B: Research page Flow tab)

| # | Checklist item | Status |
|---|---|---|
| 1 | Scoped + combined tests pass | ✅ 104 tests (59 backend + 45 frontend) re-run fresh on the merge tree at ship time |
| 2 | Named flag, defaults OFF, read from a live boot | ✅ Same mechanism/polarity as sibling `RESEARCH_TECHNICAL_TAB_ENABLED`; confirmed unset on the live `web` service at ship time (`877dd173c`'s own gate report) |
| 3 | OFF state verified before ON | ⚠️ **Not yet done.** The flag has never been flipped ON anywhere, so nothing has verified the ON state renders correctly against real production data — only against the merge-tree test suite. This is the one concrete pre-flip action item. |
| 4 | Rollback lever written down before flip | ✅ `railway variables --service web --set RESEARCH_FLOW_TAB_ENABLED=0` (or delete — see the `--set` vs `delete` CLAUDE.md caveat: **prefer `--set ...=0` over `delete`**, since a delete has been measured to leave the old value live in-process while `--kv` reports it gone) |
| 5 | Restricted-tier data check | ✅ Reuses the existing partner-owned flow endpoint as-is — zero new flow math, zero new data class, no licensing exposure beyond what already runs live on `/live-massive` |
| 6 | Real-device pass | ⚠️ **Not done.** No BrowserStack Live pass on this specific tab yet. |
| 7 | Verified via the synthetic smoke account | ⚠️ **Not done.** `smoke@uctintelligence.internal` has not visited `/research/:sym` with the flag forced on. |
| 8 | Member-impact paragraph | See below. |
| 9 | Owner's explicit "go" | **Pending — this is the ask.** |

**Member-impact paragraph:** A new "Flow" tab appears on the `/research/:sym` page,
alongside the existing "My Research" and "Technical" tabs, showing the same options-flow
data already visible on `/live-massive` and `/options-flow`, scoped to the one symbol
being researched. No new data is exposed — a paid member who already sees options flow
elsewhere now also sees it inline while researching a name. Free-tier visibility is
unchanged (Research pages already require the same paid/admin gate as flow itself; the
tab is invisible to anyone who couldn't already reach the underlying data another way).

**Recommendation:** low-risk to flip — deterministic, no AI, reuses an existing endpoint
and existing paid gating. The two ⚠️ items (real-device pass, smoke-account visit) are
each under 15 minutes of work and worth doing before flip rather than skipping, per §6
item 6's own stated reason (real Safari has found bugs jsdom/Chromium both missed
entirely, elsewhere in this codebase).

**One pre-existing, unrelated finding surfaced while shipping this** (not a reason to
hold the flip, but worth the owner's eventual attention): the reused flow endpoint
(`GET /api/live/massive/ticker-flow`, partner-owned) carries no auth dependency at the
router level — same class of gap as OI-17, on a partner file, folded into the existing
Ravi conversation rather than touched here.

### 2b — `D2_DUAL_COMPUTE_WARM_READER_ENABLED` (D2 CP2: `ticker_returns.py` dual-compute)

| # | Checklist item | Status |
|---|---|---|
| 1 | Tests pass | ✅ 22/22, re-run fresh 2026-09-23 |
| 2 | Named flag, defaults OFF | ⚠️ Flag exists in code but is **not declared** in `docs/feature_flags.json` — found in passing during A13's ship, not yet fixed (a small, real cleanup, not a functional gap) |
| 3-9 | — | Not member-facing at all: this is a dark, log-only dual-compute comparison recorder (`ticker_returns.py`'s scheduled reader), never serves a value to any surface. There is nothing here for a member to be impacted by. |

**Recommendation:** this is not a go-live decision — it's an internal instrumentation
flag with a small documentation gap. Fix the `feature_flags.json` declaration whenever
convenient; no owner "go" is needed because nothing member-visible depends on it, and
D2 CP3's own investigation (2026-09-24) confirmed no consumer's need was ever blocked by
this specific reader either way.

### 2c — `ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED` (S7: scan-membership-change CP3)

Explicitly **not ready for a go-live decision** — CP4/FLIP needs several more nights of
real cohort data before a ruling is even possible, per the existing record. Not this
packet's to bring forward; will surface on its own schedule. The *member-facing*
version of "alert me when a screen's membership changes" already fires today via the
unrelated legacy path (`screen_alerts.py`), so there is no member-facing gap in the
meantime.

---

## 3 · Genuinely still open — not a flip, a real remaining decision or dependency

| Item | What's actually blocking it | Whose call |
|---|---|---|
| S7 Alerts — price-level flip | Explicitly RULED HOLD 2026-09-18, re-affirmed 2026-09-23 (`DECISION_CARDS_2026-09-18.md` CARD 6) — persistence semantics (fire-once vs re-fire) is a genuinely unmade product call, sample is thin/partly synthetic | Owner, whenever the semantics question is ready to be made — not urgent, no member exposure today |
| A12 Watchlists | S5's real generalizing dependency (`F-S5-1`) is deliberately time-gated to 2026-10-12 (30 days of Wave Q1 stability) | Nobody's — it's a dated wait, correctly not built around |
| A14 Portfolio & Risk | No member door exists at all; blocked on S9 Entitlements (not built) and D8 (owner-bound) | Owner — this is a "not this program" scope question, not a build item |
| A10 Options & Flow | Already built as PACKET-AA CP1 (`FlowExplainButton.jsx`, tested, deliberately unmounted). CP2 — the one thing that would touch the partner file `OptionsFlow.jsx` — is explicitly held pending Ravi coordination, per its own signed gate | Owner + Ravi, whenever that conversation happens — no urgency, nothing member-visible is waiting on it | — |
| D5 CP2 (inert corp-actions ledger) | Deliberately unauthorized — nothing reads it, so nothing is waiting on it; building it would need its own scope grant the same way every `address_book.py` extension has | Owner, only if/when a real consumer need appears — not today |
| D5 CP6 merger/relation_added | No vendor signal exists on the current Massive plan (verified live against real M&A tickers — both 404) | Would need a different provider or plan tier — a cost/licensing question, not code |
| CP7 member-facing adjustment sentence | Deliberately deferred to S8/S10 by its own approval | A product-copy decision, not an engineering gap |

---

## 4 · The one clean, honest headline

**Nothing this week requires an owner decision to stay safe.** Everything currently
live shipped either as a mandatory security/bug fix or as a zero-new-exposure additive
change to an already-authenticated, already-paid surface. The only real go-live
decision on the table is §2a (`RESEARCH_FLOW_TAB_ENABLED`) — low-risk, two small
pre-flip verification steps recommended, otherwise ready whenever the owner says so.
Everything else genuinely open is open for a stated, real reason (a dated wait, a
missing vendor signal, an unmade product-semantics call, or a deliberately out-of-scope
system) — not because nobody checked.

*Companion document: `2026-09-23-one-week-execution-roadmap.md` carries the full
day-by-day evidence trail this packet draws from. If the two ever disagree, the roadmap
is more current — this packet is a snapshot, not a second authority.*
