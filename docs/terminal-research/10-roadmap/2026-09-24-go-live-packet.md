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
| `6e7b10407` | Flag-ledger truth-up (12 entries, live audit exit 0), provenance-quote rationale, R-27 smoke tool fixes | Docs/tests/tools only |
| `73a4286d0` (via `68872b3e0`, rolled back `5fd248c40`, re-landed) | Bars-pack client sends the session cookie — the Universe Bars Pack had 401'd for every member since the 2026-09-13 chart-data gate | A correction to an already-live, already-gated data path; no new exposure — the gate is untouched, the client simply stopped omitting the cookie. Member-visible improvement (instant first-view charts back). Verified on a warm pod: smoke PASS, console 401s 0 |

**Owner action needed: none.** These are recorded here for completeness and because
§6 item 1 ("the *combined* weekly branch's tests pass") is the one checklist item that
applies to all of them collectively — confirmed by the cross-surface integration
walkthrough (2026-09-23): 242/242 combined, zero file overlap, hygiene clean across the
first five; every commit landed after it has been individually scoped-tested and
hygiene-checked the same way before shipping (see each result callout in the roadmap).

**Day 7's own "walkthrough as user actions" pass — done 2026-09-24, 5/5.** Separate from
the test-suite walkthrough above: every §5 terminal-grade property was performed as a
member would perform it, against a local boot of the shipped code (one context ·
provenance · addressable · keyboard-fast · resilient panels), each with what the browser
showed recorded. Result callout and the evidence folder
(`evidence/2026-09-24-day7-walkthrough/`) are in the roadmap under Day 7. This does not
change any row in §2 — it confirms the already-live surfaces behave as the properties
demand; the flag decisions below stand on their own evidence.

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
| 3 | OFF state verified before ON | ✅ **OFF confirmed live in production** (the flag has never been set on any service; `RESEARCH_FLOW_TAB_ENABLED` is absent, which this flag's own polarity treats as OFF). **ON confirmed 2026-09-24 against a real local boot** running the exact shipped code, real backend data, a real browser session — see item 6. Production itself has not been flipped (that's item 9, the owner's call), so the ON state has been verified locally but not yet against the live deploy; that's the honest, narrower claim. |
| 4 | Rollback lever written down before flip | ✅ `railway variables --service web --set RESEARCH_FLOW_TAB_ENABLED=0` (or delete — see the `--set` vs `delete` CLAUDE.md caveat: **prefer `--set ...=0` over `delete`**, since a delete has been measured to leave the old value live in-process while `--kv` reports it gone) |
| 5 | Restricted-tier data check | ✅ Reuses the existing partner-owned flow endpoint as-is — zero new flow math, zero new data class, no licensing exposure beyond what already runs live on `/live-massive` |
| 6 | Real-device pass | ⚠️ **Partial, done 2026-09-24, be precise about what it is.** Ran a real local boot (flag forced ON locally only, never touching production) + `tools/mobile_audit.py` against `/research/AAPL` at phone/phone390/tablet/touch1024/desktop — the Flow tab renders, zero horizontal overflow at any width, no new sub-44px targets introduced. Then clicked into it via a headless-Chromium Playwright session at a 390×844 phone viewport: real content rendered (Net Flow direction/premiums, top-contracts table), no error boundary, no crash. **This is NOT a BrowserStack Live / real-Safari pass** — this codebase has a documented incident (`docs/notebook`) where jsdom AND Chromium both missed a production crash that only a real old Safari caught. Judged low-risk to skip that step here specifically: this feature reuses the exact tab pattern the already-real-device-tested Technical tab uses, introduces no exotic/bleeding-edge browser API, and does no client-side math (pure data passthrough) — but that is a risk judgment, not a substitute for the real thing, and is named as such rather than rounded up to "done." |
| 7 | Verified via the synthetic smoke account | ⚠️ **Structurally can't be done pre-flip.** §6 item 7 means a POST-deploy check against the live service — this app has no staging environment (one Railway environment, no per-branch preview, per `CLAUDE.md`), so there is nowhere to run the smoke account against this flag turned on except production itself, after the flip. The local verification above (a local admin test account, the closest available substitute) stands in for this until the flip happens; `smoke@uctintelligence.internal` visiting `/research/:sym` right after the real flip is the actual completion of this item, not a pre-condition to it. **Completed 2026-09-24, post-flip:** `tools/hub_nav_smoke.py --auth` against production as the synthetic account — SMOKE PASS, 19 routes probed for a render loop, 31 nav entries exercised, every one moved both the URL and the screen, busiest main thread `/breadth` 4.6% blocked (limit 60%). R-27's own instrument (`tools/postdeploy_client_smoke.py`) answered INCONCLUSIVE: the rig browser carries a leftover `uct.j2.offline.enabled='0'` opt-out key, not reset from this programme because the rig belongs to the Notebook workstream — see the Day 7 follow-up callout in the roadmap. The phone-class pass (`--auth --touch`) FAILED on 6 routes where the joystick hub is absent — a joystick-programme finding, not this flag's (the Flow tab's own route `/research/:sym` is not among them); recorded for its owner in `docs/plans/joystick/smoke-runs/2026-09-24T23-17Z-touch.md`. |
| 8 | Member-impact paragraph | See below. |
| 9 | Owner's explicit "go" | Given 2026-09-24, flipped live, verified end-to-end (config set, fresh boot, in-process confirmation, and a real browser render check on two tickers on live production). See feature_flags.json's own entry for the full verification trail. |

**Member-impact paragraph:** A new "Flow" tab appears on the `/research/:sym` page,
alongside the existing "My Research" and "Technical" tabs, showing the same options-flow
data already visible on `/live-massive` and `/options-flow`, scoped to the one symbol
being researched. No new data is exposed — a paid member who already sees options flow
elsewhere now also sees it inline while researching a name. Free-tier visibility is
unchanged (Research pages already require the same paid/admin gate as flow itself; the
tab is invisible to anyone who couldn't already reach the underlying data another way).

**Recommendation, updated 2026-09-24:** low-risk to flip — deterministic, no AI, reuses
an existing endpoint and existing paid gating, and now also verified end-to-end against
a real local boot with real backend data (net-flow direction, premiums, a real contracts
table — not a mock). Item 7 (smoke account) completes itself the moment the flip
happens, not before. The one item genuinely still open by choice, not oversight, is a
true BrowserStack Live pass — judged proportionate to skip given the pattern-reuse and
lack of exotic browser APIs, but that's a risk call for the owner to override if they'd
rather not take it. **Ready for the owner's "go" whenever they want it; nothing further
is blocking on this session's side.**

Flip confirmed live, 2026-09-24. RESEARCH_FLOW_TAB_ENABLED is armed on the web
service, a fresh boot was confirmed, and the flag was verified in-process via a real
authenticated session (research_flow_tab_enabled: true). Visited /research/AAPL and
/research/NVDA live on production in a real browser session: both rendered the correct
empty-state copy for the Flow tab, no errors. One resolved false alarm along the way --
the tab looked stuck loading on first click in the automation browser tab specifically
because that tab was backgrounded (document.visibilityState stayed "hidden" the whole
session, which throttles Chrome's JS timers), not a product bug. Confirmed clean on
retry and on a second ticker. Full detail in feature_flags.json's RESEARCH_FLOW_TAB_ENABLED
entry.

Historical note this recommendation leans on, per §6 item 6's own stated reason (real
Safari has found bugs jsdom/Chromium both missed
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
| 2 | Named flag, defaults OFF | ✅ **Declared 2026-09-24 in `6e7b10407`** (status `dark`, alongside `WISDOM_EXTRACT_PRESCREEN_ENABLED`, the other undeclared gate the same sweep found); `tools/flag_ledger_audit.py` against live Railway now exits 0. ⚰️ This row said "not declared … not yet fixed" for a day after it was |
| 3-9 | — | Not member-facing at all: this is a dark, log-only dual-compute comparison recorder (`ticker_returns.py`'s scheduled reader), never serves a value to any surface. There is nothing here for a member to be impacted by. |

**Recommendation:** this is not a go-live decision — it's an internal instrumentation
flag with a small documentation gap. Fix the `feature_flags.json` declaration whenever
convenient; no owner "go" is needed because nothing member-visible depends on it, and
D2 CP3's own investigation (2026-09-24) confirmed no consumer's need was ever blocked by
this specific reader either way.

### 2c — `ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED` (S7: scan-membership-change CP3)

Explicitly **not ready for a go-live decision** — CP4/FLIP needs several more nights of
real cohort data before a ruling is even possible, per the existing record. Not this
packet's to bring forward; will surface on its own schedule.

> **Dark read 2026-09-25 ~04:00Z** (`GET /api/admin/alert-taxonomy/dark-report/scan-membership-change`
> as the admin smoke account; evidence in
> `evidence/2026-09-25-s7-scan-membership-dark-read/`): `predicate_count` **1** (was 0 on
> 2026-09-22 — the smoke account's own "Oops Reversal" subscription is being swept),
> status **OBSERVED**, `observed 4 · agreed 4 · new_only 0 · legacy_only 0 ·
> not_comparable 0`, drift 0/0, `sessions_covered` 09-22 · 09-23 · 09-24 · 09-25,
> heartbeat 12 ticks, `verdict_ready: false`, `min_sessions_for_verdict: 5`. **One more
> nightly tick (the 2026-09-26 session) meets the session floor.** ⚠️ It will still be
> n = 1 predicate on the synthetic account — the report's own first blind spot says the
> `screen_alert_subs` population is unmeasured and the s7-dark cohort is admins/staff/test
> only by design — so "verdict_ready" tomorrow is a statement about session count, not
> about members. A CP4 ruling packet can be assembled after that tick; whether one screen
> from one synthetic account is enough evidence is the owner's call, not this packet's.
>
> **Decision, delegated by the owner 2026-09-25 ("you decide") and recorded as delegated:**
> one synthetic screen is **NOT sufficient evidence for a FLIP**, and it **IS sufficient to
> assemble the CP4 packet** once the 09-26 tick lands. Reasoning: the harness compares two
> RULES over inputs it is handed, and every one of its own blind spots is about the
> population — `screen_alert_subs` unmeasured, `MAX_PER_USER=6` unmodelled (a property of a
> member's whole run, invisible with one screen), retention with no owner. Five agreeing
> sessions on one definition proves the rule agrees with the legacy on that definition's hit
> set; it says nothing about a member with six screens or about a definition whose hit set
> churns. So: (1) CP4 (all-members cohort via the S12 tag, STILL DARK, no delivery) may be
> signed on the 5-session read — CP4's job is exactly to widen the population; (2) the FLIP
> line waits for the CP4 cohort to show `legacy_only == 0` over ≥ 5 sessions on ≥ 3 distinct
> definitions held by ≥ 2 real members (the LEDGER's own CP4 shape, `legacy_only == 0` and
> `agreed ≥ 20` over ≥ 5 sessions, applied per definition rather than pooled); (3) the smoke
> account arms **no further subscriptions** — its one owner-authorized row is a control, and
> the account's rule is that it holds no real alerts. A real s7-dark member (the owner's own
> account is one) subscribing to 2–3 screens they actually use is the cheapest way to get (2). The *member-facing*
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
| ~~`/api/provenance/quote` + `/provenance-demo` still public (found 2026-09-24)~~ — **CLOSED 2026-09-25, `7e0ab34c2`** | Gated together in one commit under OI-17's delegated ruling: the endpoint takes `Depends(get_current_user)`, the page moved inside `<AuthGuard/>`; anonymous → 401 pinned (`tests/test_provenance_quote.py`, 10/10) and proved on the live pod (401 where the previous pod answered 200). The demo was never linked from any nav, so no member path changed | Done — `RESUME-HERE.md` §3 |

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
