---
id: GATE-S9
title: Entitlements & Licensing Gate — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ✅ CP1 SIGNED AND BUILT 2026-09-19. OI-03(a)/(b), OI-12 and OI-09 all ANSWERED BY THE
  OWNER 2026-09-19 — Massive CONFIRMED Business/Enterprise (already held; corrects a same-day
  earlier, more tentative "Individual/beta" answer), FMP DDLA exists, paid-only model confirmed,
  and UCT CONFIRMED staying downstream (not a vendor of record with the SIPs/OPRA). CP2 is a
  CONSOLIDATION (30 of 38 gated rows go R→LA), not an enforcement boundary — but reading those
  30 rows individually (§8) found 19 are already LIVE (Business tier retroactively authorizes
  what members already see, zero member-visible effect) and 11 are unbuilt TERMINAL-NEXT
  candidates (also zero effect today; only unblocked for a future proposal). **✅ §8 CP2 SIGNED
  2026-09-19 (fingerprint `f808508f7`)** — a documentation-only checkpoint: the 19 LIVE rows are
  recorded as Business-tier-authorized, and A1's default is retired for the 11 unbuilt candidates.
  No code, no flag, no schema change; nothing built.
  ⚰️ **7 of the original 8 U rows are now RESOLVED — this line previously said 8 stayed U on four
  facts; three of those four facts are answered.** ESC-05 (T-23, T-24, T-25, N-07, N-08 — 5 rows)
  and ESC-14 (N-19 — 1 row) were ANSWERED BY THE OWNER 2026-09-19 from written Massive
  confirmation. **T-31 (1 row) was MEASURED 2026-09-19 (the 15-min lag was not enforced), FIXED
  the same day, and DEPLOYED TO PRODUCTION 2026-09-20** (`408b9a33f` on master, Railway `web`
  SUCCESS, `/api/health` uptime reset confirmed). **Only T-20 (ESC-21 + OI-03(d), 1 row) remains
  U** — the paid-Substack Edge User question and any signed addenda, neither addressed by any
  answer so far.
date: 2026-09-13
---

# GATE-S9 — Entitlements & Licensing Gate

## ⛔⛔ THIS SYSTEM IS OWNER-BLOCKED BEFORE IT IS SPEC-BLOCKED

> **S9 waits on OI-03(a), OI-03(b) and OI-12, and nothing in this packet can be signed until that is answered.**
> S9 decides **what a member may see**, and that is a function of two contracts nobody has read back to this programme — the Massive tier (OI-03(a)) and whether an FMP display agreement exists (OI-03(b)) — plus the commercial model (OI-12), where the code and the seed facts **disagree** about which page is free.

⭐ **The packet exists anyway, and that is deliberate.** Until now S9 had **no packet at all**,
which is a different and worse state than "unsigned": an unsigned packet is a thing the owner can
read and sign, while a missing one is work this programme owes before the owner can do anything.
COMPLETION_AUDIT §0 separates the two for exactly this reason.

⛔ **ZERO CODE WAS WRITTEN FOR THIS PACKET.** Nothing below is built, started, or partially
started.

## ✅ APPROVAL — CP1 SIGNED 2026-09-19. ⚰️ ~~CP2+ remains unauthorized, unchanged~~ — CP2 SIGNED separately, §8 (fingerprint `f808508f7`), true when this heading was written and stale since.

**Scope, verified against source before this line was written (2026-09-19):** enumerate every
"may this member see this" site as inert data, correct GATE-S9 §2's own stale finding, and add a
duplication rail — no gate read, no gate changed, no member-visible effect.

⭐ **THE FINDING §2 NAMED WAS IMPRECISE, AND THE CORRECTED VERSION IS WORSE.** §2 said "`PAID_PLANS`
is already copied twice." Measured: it is not, on the Python side — one definition
(`api/middleware/auth_middleware.py::PAID_PLANS`), and its own comment already says "single source
of truth — mirrored by `isPaid` in `AuthContext.jsx`." Following that pointer is the real finding:
**THREE independent JS re-implementations** of `['pro','premium','lifetime'].includes(plan)` —
`context/AuthContext.jsx` (the canonical `isPaid`, which ALSO ORs in `trial.active`),
`pages/Pricing.jsx` (`trulyPaid`, a DELIBERATELY narrower predicate for pricing-page messaging —
not a drift, a different concept correctly named), and `pages/Login.jsx` (post-login routing,
using the SAME predicate `isPaid` serves but missing the trial term it has). **`Login.jsx`'s gap
looks like a live, currently-shipping bug**: a member on an active trial, immediately after
signing in, may be routed to `/morning-wire` (the free page) instead of `/dashboard`, because its
hand-rolled check does not know about trials. RECORDED, NOT FIXED — this checkpoint changes no
gate; a targeted fix to `Login.jsx` alone (reading `useAuth().isPaid` instead of re-deriving it) is
a CP2-shaped or standalone follow-up, not CP1's.

**Separately, `FREE_PAGES` IS triplicated** exactly as §2 described the shape (just not the
variable) — `AuthGuard.jsx`, `mobile/MoreSheet.jsx`, `NavBar.jsx` each hand-type
`['/morning-wire']`, each commented "keep in sync with" the other two. Additionally recorded (not
fixed): the three consumers use DIFFERENT matching semantics against that identical array —
`AuthGuard.jsx` matches by prefix (`.some(p => path.startsWith(p))`), the other two by exact string
(`.includes(...)`) — invisible today only because every declared free page is a leaf route with no
sub-routes.

**Built:** `tools/build_entitlements_manifest.py` (the derivation, with `--check`) →
`api/data/entitlements_manifest.json` (git-tracked via `git add -f`, same as the D2 address book) →
`tests/test_entitlements_manifest.py` (12 tests: non-vacuity, the derivation rail run as a
subprocess, the `FREE_PAGES` divergence rail, the cross-lane mirror check, the trial-clause finding
asserted by name per file, and the inertness rail on BOTH lanes — Python `api/**` and frontend
`app/src/**/*.{jsx,js}` — since this manifest is the first S9 artifact either lane could read).

**⛔ FLOW-WORKER CLASSIFICATION, MEASURED.** All three new files (`tools/build_entitlements_
manifest.py`, `tests/test_entitlements_manifest.py`, `api/data/entitlements_manifest.json`) are
NOT reachable from `api/flow_worker_main.py`'s entry point at all — confirmed via
`tools.flow_worker_watch_coverage.reachable_paths()`, `verdict()` returns `ok=True, bad=set()`.
Zero flow-worker risk, any time.

**Mutation-proved:** the manifest's own inertness rail on both lanes (planting a fake Python
reader in `entitlements.py` and a fake JS reader in `AuthContext.jsx`, each restored and
byte-identical after); the derivation rail (corrupting the real on-disk manifest, confirming
`--check` returns exit 1 STALE, restoring returns exit 0); a first draft of the trial-clause scan
had a real bug (its detection window read 100 chars past the match, which bled into `Pricing.jsx`'s
unrelated NEXT statement — `const onTrial = ...` — and produced a false positive; caught by the
test asserting the finding BY NAME per file, fixed by measuring the true distances across all three
sites (16/40/none chars) and narrowing the window to 25). Full scoped regression:
`tests/test_entitlements.py` (pre-existing, 79 tests) + `tests/test_entitlements_manifest.py` (new,
12 tests), all green; zero frontend files modified (read-only enumeration).

**No schema change. No gate read or changed. No member-visible effect. CP2+ remains
NOT PROPOSABLE**, unchanged from §3 — this line authorizes CP1 only.

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-19)
APPROVED ON:      2026-09-19
APPROVED AT SHA:  11305b807
SCOPE APPROVED:   CP1 -- The entitlement axis as INERT DATA + a duplication rail: every site that answers 'may this member' enumerated from source. Corrects GATE-S9 section 2's stale finding (PAID_PLANS is NOT copied on the Python side -- single definition, many importers) with the real finding: THREE independent JS re-implementations of the paid-plan literal (context/AuthContext.jsx's canonical isPaid, which ORs in trial.active; pages/Pricing.jsx's deliberately-narrower trulyPaid; pages/Login.jsx's post-login routing check, which is missing the trial clause isPaid has -- recorded as a likely live bug routing trial members to the free page after login, not fixed here). Separately confirms FREE_PAGES is triplicated across AuthGuard.jsx/MoreSheet.jsx/NavBar.jsx with divergent matching semantics (prefix vs exact), also recorded not fixed. Built: tools/build_entitlements_manifest.py (the derivation, with --check) -> api/data/entitlements_manifest.json (git-tracked) -> tests/test_entitlements_manifest.py (12 tests: non-vacuity, derivation rail, FREE_PAGES divergence rail, cross-lane mirror check, trial-clause finding, inertness rail on both the Python and frontend lanes). Flow-worker classification measured: all three new files are unreachable from flow_worker_main.py's entry point, zero deploy risk. Mutation-proved: inertness rails on both lanes, the derivation rail's real --check pipeline, and the trial-clause scan's window (a first-draft bug caught by its own test, fixed by measuring exact character distances across all three sites). No schema change. No gate read or changed. No member-visible effect. CP2+ remains NOT PROPOSABLE, unchanged -- this line authorizes CP1 only.
```

---

## 1. What S9 is, per the architecture

`product-architecture.md` §5: the single authority on which plan, which cadence and which **data class** a member may receive — and, per the provider ledger §3.4, which trigger types may run on which data class for which audience.

---

## 2. ⛔ What is ALREADY SHIPPED, measured — because the gap is not "nothing exists"

⛔ **Entitlement logic is live and DUPLICATED, which is the finding.** `AuthGuard`, `FREE_PAGES`, `require_paid`, and `entitlements.py`'s `TOOLKITS` all answer a form of 'may this member', and `PAID_PLANS` **is already copied twice** (TD-20, cited in the architecture at §120).

⚰️ **THIS SAID `PAID_PLANS` WAS THE COPIED VARIABLE — MEASURED 2026-09-19, IT IS NOT.** `PAID_PLANS`
has one Python definition and many importers; its own comment already names where to look —
"mirrored by `isPaid` in `AuthContext.jsx`." The real duplication is THREE independent JS
re-implementations of that literal (`AuthContext.jsx`, `Login.jsx`, `Pricing.jsx`), one of which
(`Login.jsx`) looks like a live bug (see the CP1 approval block below). `FREE_PAGES` genuinely IS
triplicated as described. Struck rather than deleted so a reader sees which half of a two-clause
finding needed correcting and which didn't.

⚠️ `entitlements.py` ships exactly ONE toolkit (`"all"`) and the lookup is still real — returning the default unconditionally would be indistinguishable from a lookup that had been deleted. Any S9 checkpoint must preserve that distinction.

⛔⛔ **AND THE LICENSING HALF WAS NOT GOING TO BE A REFACTOR IF OI-03(a) HAD COME BACK RESTRICTIVE.** ⚰️ Written when the answer was still open: *"If OI-03(a) comes back individual tier, member-facing display of that data is not permitted at all, and S9's job changes from 'consolidate the gates' to 'enforce a prohibition.'"* **OI-03(a) is answered, 2026-09-19: CONFIRMED Business/Enterprise, already held** (correcting a same-day earlier, more tentative "Individual/beta" statement). **OI-09/OI-E02-09 is also answered, same day: UCT stays downstream, not a vendor of record** — N-26's attestation/entitlement machinery will not be built. S9's job is the consolidation branch — this paragraph is kept as the historical record of the branching logic rather than deleted. ⚰️ **The two contract-text questions the downstream answer alone did not reach — ESC-05 (does Massive's own agreement name OPRA display and pay the $1,500/mo floor?) and ESC-14 (is a server-side alert display or non-display use?) — are ANSWERED, 2026-09-19, from written Massive confirmation.** Both favourable. Only T-20 (ESC-21 + OI-03(d)) remains open of the original 8.

---

## 3. Proposed checkpoints, so an approval line can name one

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | The entitlement axis as **INERT DATA** + a duplication rail: every site that answers 'may this member' enumerated from source, with `PAID_PLANS`' two copies named. **No gate changed.** | measure at build | **S/M** |
| **CP2** | ⚰️ Was "CP2+" in this cell — `tools/sign_gate.py`'s checkpoint-declaration regex can't parse a trailing `+` inside `**...**`, so a scope naming "CP2" was refused as "no checkpoint this packet declares" until this cell read plainly. The "CP2+" shorthand used elsewhere in this packet's prose is unaffected. ⚰️ **OI-03(a) ANSWERED 2026-09-19 — the shape is now DETERMINED, not proposable-and-built in the same breath.** ⚰️ This row first read the RESTRICTIVE branch off the owner's first, more tentative same-day answer, then attributed all 8 surviving-U rows to just two ESC ids. **CONFIRMED Business/Enterprise, already held** flips the shape: **CP2 is a CONSOLIDATION that PERMITS Massive real-time data on member routes** — 30 of the 38 gated rows go R→LA. OI-03(b) (FMP DDLA exists), OI-12 (paid-only) and **OI-09/OI-E02-09 (UCT stays downstream, confirmed same day)** are also answered and do not further change CP2's shape. ⚰️ **Of the 8 rows that stayed U, 7 are now resolved:** **ESC-05** (Massive's Third-Party Agreement names OPRA display + pays the $1,500/mo floor — ANSWERED 2026-09-19, written confirmation) closes T-23, T-24, T-25, N-07, N-08 (5 rows); **ESC-14** (alert display vs. non-display use — ANSWERED, same confirmation) closes N-19; **T-31** (the same-day dark-pool lane's ≥15-min lag) was measured 2026-09-19, found not enforced, fixed the same day, and **DEPLOYED TO PRODUCTION 2026-09-20** (`408b9a33f`, Railway `web` SUCCESS). **Only T-20 remains U** — ESC-21 + OI-03(d) (is a paid-Substack audience an Edge User; any signed addenda), not addressed by any answer so far. **✅ See §8 — SIGNED 2026-09-19, fingerprint `f808508f7`.** | signed, §8 | **L** on paper; **measured in §8 as zero member-visible change for 19 of the 30 unlocked rows** (already LIVE — Business tier retroactively authorizes what members already see) and **no-op for the other 11** (TERMINAL-NEXT candidates, not built) |

---

## 4. ⛔ Watch-coverage classification — to be MEASURED at build time, not guessed

Every checkpoint above must be classified with `tools/flow_worker_watch_coverage.py` against the
tree it will merge on. ⚠️ **This packet deliberately does not pre-declare a classification**: the
closure moves as imports move, and a classification written weeks before the build is the stale
artifact this programme keeps paying for. The one exception is D4 CP3, where the owner
pre-declared BEHAVIOUR-CHANGING **because the measurement had already been taken that day**.

---

## 5. What this packet does NOT ask for

- **No answer to OI-03(a), OI-03(b) and OI-12.** That is the owner's, and it is upstream of every checkpoint here.
- **No member-visible change** at any checkpoint below CP1.
- **No flag armed.** Arming is always a separate owner decision.

---

## 6. Recommendation

**Sign nothing.** ⭐ CP1 (enumerate the duplication, change no gate) is real work that is correct under either answer, and it is the only part of S9 that is. Everything else waits on a contract. ⚠️ A14 Portfolio & Risk is blocked behind this AND behind D8, so S9 answering does not by itself unblock A14.

---

## 7. ✅ APPROVAL — the two mechanical findings CP1 recorded, now closed

⛔⛔ **NOT "S9 CP2."** ⚰️ Was "§3 is unchanged: CP2+ ... remains NOT PROPOSABLE until OI-03(a)/OI-03(b)/OI-12 are answered" — true when this line was written; **CP2 has since been proposed (§8) and SIGNED separately** (fingerprint `f808508f7`). This line authorizes exactly two narrow,
independent bug fixes CP1's own enumeration surfaced — using data and logic that ALREADY EXISTS,
building no new entitlement architecture, and deciding nothing about the blocked question.

**Fix 1 — `Login.jsx`'s trial-routing gap, closed.** CP1 recorded: a member on an active trial,
immediately after signing in, may be routed to `/morning-wire` instead of `/dashboard`, because
`Login.jsx`'s post-login routing check re-derived the paid-plan literal WITHOUT the trial clause
`AuthContext.jsx`'s canonical `isPaid` carries. Fixed by reading `data.paid_equiv` — the backend's
own already-computed answer (`api/routers/auth.py::_access_payload`, the same `is_paid_or_trial()`
chokepoint `isPaid` mirrors), already present on every `/login` and `/login/totp-verify` response.
Nothing re-derived; nothing new computed. Mutation-proved: reverting to the old inline check reds
the new `Login.test.jsx`'s trial-member test specifically, while the free/paid/admin cases stay
green — restored and reverified.

**Fix 2 — `FREE_PAGES`'s triplication, retired.** CP1 recorded three hand-typed copies of
`['/morning-wire']` (`AuthGuard.jsx`, `mobile/MoreSheet.jsx`, `NavBar.jsx`), each commented "keep in
sync with" the other two, with divergent matching semantics per consumer (prefix in AuthGuard.jsx,
exact in the other two). **The matching semantics are UNCHANGED, deliberately** — AuthGuard.jsx
tests a live `location.pathname` (a member could visit a nested sub-path, so prefix matching is
correct there); NavBar.jsx/MoreSheet.jsx test one fixed `NAV_ITEMS` target string (exact matching
is correct there too) — converging them would make one side wrong to fix the other. Only the VALUE
was ever duplicated: retired onto one export, `app/src/constants/freePages.js`, all three consumers
now import it. `tools/build_entitlements_manifest.py` extended to verify this holds (each consumer
imports the shared source and does not re-declare locally) — mutation-proved by planting a local
`const FREE_PAGES = [...]` back into `AuthGuard.jsx` alongside its import: `--check` correctly goes
STALE and the derivation test reds; restored and reverified.

**Flow-worker classification, measured:** none of the changed files (`Login.jsx`, `AuthGuard.jsx`,
`NavBar.jsx`, `MoreSheet.jsx`, `constants/freePages.js`, `tools/build_entitlements_manifest.py`,
`api/data/entitlements_manifest.json`, both test files) are under `api/services/` or otherwise
reachable from `api/flow_worker_main.py`'s entry point — `verdict()` returns `ok=True, bad=set()`.
Zero flow-worker risk.

**Full regression:** 80 backend tests (`test_entitlements.py` + `test_entitlements_manifest.py`,
both extended for the new reality) + 50 frontend tests (`Login.test.jsx` new — 4 tests — plus every
existing suite touching the four edited components), all green.

**Member-visible effect, stated plainly:** a member on an active trial who signs in now lands on
`/dashboard` instead of `/morning-wire` — a bug fix, not a new capability. Nothing else changes for
any member; `FREE_PAGES`'s value and each consumer's matching behaviour are byte-identical to
before.

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-19)
APPROVED ON:      2026-09-19
APPROVED AT SHA:  d4a4138a0
SCOPE APPROVED:   Section 7 -- the two mechanical findings CP1 recorded, now closed. NOT S9 CP2 -- section 3 is unchanged, CP2+ (consolidating or enforcing entitlements) remains NOT PROPOSABLE until OI-03(a)/OI-03(b)/OI-12 are answered. This line authorizes exactly two narrow, independent bug fixes using data and logic that already exists: (1) Login.jsx's trial-routing gap -- fixed by reading data.paid_equiv (the backend's own already-computed answer, already present on every login response) instead of re-deriving the paid-plan literal without the trial clause AuthContext.jsx's canonical isPaid carries; a member on an active trial now correctly lands on /dashboard instead of /morning-wire right after signing in. (2) FREE_PAGES's triplication across AuthGuard.jsx/MoreSheet.jsx/NavBar.jsx retired onto one export, app/src/constants/freePages.js -- matching semantics per consumer left deliberately unchanged (prefix for AuthGuard.jsx's live-pathname check, exact for the other two's fixed nav-item check), since converging them would make one side wrong to fix the other; only the duplicated VALUE is closed. Flow-worker classification measured: none of the changed files are reachable from flow_worker_main.py's entry point, zero risk. Mutation-proved both fixes on both arms (Login.jsx: reverting to the old check reds the trial-member test specifically; FREE_PAGES: planting a local redeclaration reds the derivation --check). Full regression: 80 backend + 50 frontend tests green. Member-visible effect stated plainly: a bug fix for trial members' post-login routing, nothing else changes for anyone.
```

---

## 8. ✅ CP2 — SIGNED 2026-09-19 (fingerprint `f808508f7`)

⛔ **This section exists because §3's CP2+ row could not be signed as written — "consolidate 30
rows" is a size, not a scope.** Reading each of the 30 R→LA rows individually (not as a count)
changes what CP2 actually is. That reading is below, traceable row-by-row to
`09-security-licensing-cost/licensing-register.md`.

### 8.1 The 30 unlocked rows split into two populations that need two different things

**19 rows are already LIVE in production today** (Part A / "today's uses" — every one has a
measured `LIVE` status per F-03b/ORCH-RAILWAY-01, not a code default): T-01 (live quotes), T-03
(developing intraday bar), T-04 (D/W/M history), T-05 (movers rails), T-06 (Massive news), T-07
(reference data), T-08 (desk display), T-09 (`bars.db` storage), T-10 (caching), T-11 (intraday
breadth analytics), T-14 (AI processing of Massive numbers), T-15 (AI chart-screenshot voice
processing), T-21 (Discord `/chart` house images), T-22 (dark-pool record alerts), T-26 (SWEEP/BLOCK
flow analytics), T-28 (options chain/Greeks/IV), T-29 (implied-capture storage), T-30 (dark-pool T+1
flat files), T-32 (`darkpool.db` storage). **For every one of these, CP2's member-visible effect is
ZERO.** Business/Enterprise tier retroactively authorizes what a member (or, for T-08/T-09/T-10/T-29/
T-32, the desk/internal system) already sees today. Nothing is unlocked because nothing was locked —
these features were built and shipped under the Individual-tier assumption; the licensing basis
under them changes, the product does not.

**11 rows are TERMINAL-NEXT candidates, not built** (Part B): N-01 (security-page real-time quote
header), N-02 (delayed-price/live-volume variant), N-03 (chart history), N-04 (chart real-time
developing bar), N-05 (watchlist quotes×N), N-09 (options flow historical-only), N-10 (options
chain/Greeks/IV + GEX panel), N-16 (AI answers over numeric vendor data), N-21 (screener live-price
columns), N-22 (breadth/RS/sector-flow panels), N-25 (retained derived history). **For these, CP2's
effect is also zero today** — none is built, so nothing changes for a member now. What CP2 does is
retire A1's blanket "no new member-facing raw vendor surface is added to the roadmap" default
**for these 11 specifically** — they become buildable candidates for a future, SEPARATE product
proposal. CP2 does not build any of them and does not authorize building any of them without that
future proposal's own review.

⭐ **This is why §3's "L, and it touches member-visible surfaces" sizing was wrong.** A checkpoint
whose entire live-population effect is "record that a licence question closed favourably, change no
code" is not the same size as one that flips a display behind a flag. Corrected above to **S** —
smaller than CP1, not larger, because CP1 built new tooling (the manifest + its rail) and CP2 as
scoped here builds none.

### 8.2 The 8 rows CP2 explicitly does not build on — 7 now RESOLVED elsewhere, 1 still open

§3's CP2+ row originally said "8 R→U... ESC-05... ESC-14" as if two facts covered all eight.
Reading each row's own "Owner fact that settles it" cell found **four distinct facts, one of
which was not a vendor question at all** — and by 2026-09-20, three of those four facts are
answered and the fourth is deployed. This table is kept as the historical record of what closed
each row and when, not as a live list of open items — **only T-20 is still open.**

| Row(s) | What it is | Live today? | What actually gated it, and its outcome |
|---|---|---|---|
| T-23, T-24, N-07, N-08 | Real-time OPRA options tape + NBBO histogram/quotes (T-23/T-24 = the current `/live-massive` product, LIVE; N-07/N-08 = an unbuilt options-flow-panel candidate) | T-23/T-24 **LIVE**; N-07/N-08 not built | **ESC-05 — ANSWERED 2026-09-19, favourably, written Massive confirmation.** Massive's Third-Party Agreement names customer-facing OPRA display and pays the $1,500/mo redistribution floor. **RESOLVED — LA.** |
| T-25 | `flow.db` full-tape OPRA archive, unbounded retention (`FLOW_PRUNE_ENABLED` written but armed on no service) | **LIVE** | ESC-05 (see above), plus OI-03(d) (no adverse storage addenda named). **RESOLVED — LA.** |
| T-31 | Same-day per-ticker `/v3/trades` dark-pool lane | **LIVE, fixed in production** | ⚰️ Was "Not a vendor question... resolvable by reading the code," then "measured, fixed, not yet deployed." **MEASURED 2026-09-19 (the ≥15-min lag was NOT enforced), FIXED the same day, DEPLOYED 2026-09-20** (`408b9a33f` on master, Railway `web` SUCCESS, `/api/health` uptime reset confirmed, `GET /api/darkpool/today` smoke-checked 401 post-deploy). **RESOLVED — LA.** |
| N-19 | Server-side alerting (watchlist price alerts, awareness stop-watch — "exists today" per its own row) | **LIVE** (the feature; the row is filed under Part B by table convention only) | **ESC-14 — ANSWERED 2026-09-19, favourably, written Massive confirmation.** A member-configured alert is the member's display use, not the platform's non-display use. **RESOLVED — LA.** |
| T-20 | Morning Wire → paid Substack (Massive+FMP+AV+Finviz sourced) | **LIVE** (`WIRE_ENABLED=1`) | **ESC-21 + OI-03(d)** — is a paid-Substack audience an "Edge User"? Any signed addenda? Distinct from OPRA and from alerting. **STILL OPEN — not addressed by any answer so far.** |

CP2 itself makes no claim, changes no code, and requests no answer on any of these — the
resolutions above happened through separate, narrower answers and one deploy, not through CP2.

### 8.3 The live exposure this reading surfaced — now down to one row

⛔⛔ **This section originally found six of the eight excluded rows running in production with an
unresolved R/U licensing classification: T-20, T-23, T-24, T-25, T-31, and the alerting feature
behind N-19.** As of 2026-09-20, **five of those six are resolved** (ESC-05 closes T-23/T-24/T-25;
ESC-14 closes N-19; T-31 is measured, fixed, and deployed to production). **T-20 is the only
live-today row with unresolved licensing status left.** The two unbuilt candidates (N-07, N-08)
still carry no present exposure since they don't exist yet.

The one thing that would close it:

1. **A written question to Massive and/or FMP covering ESC-21 (is a paid-Substack audience an
   Edge User?) and OI-03(d) (any signed addenda)** — a narrower, separate question from the OPRA
   and alerting ones already answered; can go out as its own short email.

None of this is part of CP2's scope below — it is named here because reading the 30 rows
individually is what surfaced that they are live exposure, not roadmap planning, and burying that
finding inside "CP2 unlocks 30 rows" would have been the same kind of hand-typed summary this
programme keeps correcting.

### 8.4 What CP2 itself builds

Given §8.1's finding — zero code change for either population of the 30 rows — CP2 as scoped here
is a **documentation checkpoint, matching CP1's own size class, not a feature checkpoint:**

- Record, in the licensing register (`§1` scenario cells already read Business = LA; no further
  edit needed there) and in a short addendum to `api/data/entitlements_manifest.json` or an
  equivalent artifact, that the 19 LIVE rows in §8.1 are Business-tier-authorized as of
  2026-09-19 — a compliance-status fact, not a feature flag.
- Retire A1's blanket "no new member-facing raw vendor surface is added to the roadmap" default
  **specifically for the 11 rows named in §8.1's second list** — they become eligible for a future
  product proposal; nothing is scheduled or built by this action.
- **No code change. No flag armed. No schema change. No member-visible effect** — the same three
  guarantees §5 already makes for everything below CP1, extended to cover CP2 explicitly rather
  than leaving it implied.

### 8.5 What this proposal does NOT ask for

- ⚰️ Was "No answer on ESC-05, ESC-14, ESC-21, or OI-03(d)." **ESC-05 and ESC-14 are now answered**
  (2026-09-19, written Massive confirmation) — this proposal did not ask for them and does not
  claim credit for them; they were separate answers. **ESC-21 and OI-03(d) (T-20) remain the
  owner's/Massive's**, listed in §8.3 as the one remaining action.
- No code or flag change for any of the rows in §8.2 (T-31's fix and deploy were likewise a
  separate action, not part of this proposal's own scope).
- No build authorization for any of the 11 TERMINAL-NEXT candidate rows in §8.1 — being made
  eligible for a future proposal is not the same as that proposal existing.
- No re-opening of OI-03(a), OI-03(b), OI-12, or OI-09 — all four are answered and this section
  does not touch them again.

### 8.6 Recommendation

**Sign CP2 as scoped here if the row-by-row categorization in §8.1/§8.2 checks out** — it is a
records-closure action with a stated zero member-visible effect, the same risk class as CP1.
⚰️ **The two "separately and not gated on signing CP2" actions this section used to name are both
done**: the Massive email covering ESC-05 + ESC-14 was answered 2026-09-19 (written confirmation),
and the T-31 fix (`2c6f4cd7e` on `feat/s7-price-level`) was merged to master as `408b9a33f` and
deployed 2026-09-20 (Railway `web` SUCCESS, `/api/health` uptime reset confirmed). **The one
remaining action, still not gated on CP2's sign-off:** a written question to Massive/FMP covering
T-20's ESC-21 (paid-Substack Edge User) and OI-03(d) (signed addenda).

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-19
APPROVED AT SHA:  f808508f7
SCOPE APPROVED:   Section 8 -- the CP2 scoped proposal, drafted 2026-09-19. This line authorizes CP2 as a documentation-only checkpoint: recording, in the licensing register and an addendum to the entitlements manifest (or equivalent artifact), that the 19 already-LIVE rows named in section 8.1 (T-01, T-03-T-11, T-14, T-15, T-21, T-22, T-26, T-28-T-30, T-32) are Business-tier-authorized as of 2026-09-19, and retiring assumption A1's blanket "no new member-facing raw vendor surface is added to the roadmap" default specifically for the 11 unbuilt TERMINAL-NEXT candidate rows named in section 8.1's second list (N-01-N-05, N-09, N-10, N-16, N-21, N-22, N-25), making them eligible for a future, separate product proposal. No code change. No flag armed. No schema change. No member-visible effect for any member today -- every one of the 19 LIVE rows is already running exactly as it runs today; every one of the 11 candidate rows remains unbuilt. This line does NOT authorize building any of the 11 candidates, does NOT change or resolve any of the 8 rows named in section 8.2 (T-20, T-23, T-24, T-25, T-31, N-07, N-08, N-19), and does NOT re-open OI-03(a), OI-03(b), OI-12, or OI-09, all of which are answered and unchanged by this line.
```
