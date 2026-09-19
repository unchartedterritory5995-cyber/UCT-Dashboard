---
id: GATE-S9
title: Entitlements & Licensing Gate — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ✅ CP1 SIGNED AND BUILT 2026-09-19. CP2+ still ⛔ NOT PROPOSABLE — unchanged,
  waits on OI-03(a)/OI-03(b)/OI-12.
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

## ✅ APPROVAL — CP1 SIGNED 2026-09-19. CP2+ remains unauthorized, unchanged.

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

⛔⛔ **AND THE LICENSING HALF IS NOT A REFACTOR.** If OI-03(a) comes back *individual tier*, member-facing display of that data is **not permitted at all**, and S9's job changes from 'consolidate the gates' to 'enforce a prohibition'. Those are different systems. This is why no checkpoint below is proposable as more than a shape.

---

## 3. Proposed checkpoints, so an approval line can name one

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | The entitlement axis as **INERT DATA** + a duplication rail: every site that answers 'may this member' enumerated from source, with `PAID_PLANS`' two copies named. **No gate changed.** | measure at build | **S/M** |
| **CP2+** | ⛔ **NOT PROPOSABLE.** The shape depends on OI-03(a): a permissive answer makes CP2 a consolidation; a restrictive one makes it an enforcement boundary with member-visible consequences. | — | — |

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
