---
id: PACKET-AA
title: RG-38 — api/flow_explain.py ("AI Print Explainer") is fully built, cost-guarded and paid-gated, with zero frontend callers — two-checkpoint wiring gate, split for partner-file safety
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET AA — Options Flow "Explain this print" wiring gate

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-23
APPROVED AT SHA:  f7fb7c477
SCOPE APPROVED:   CP1, CP2 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ✅ **CP2's partner-coordination precondition WAIVED BY THE OWNER, 2026-09-25** — verbatim:
> *"Forget Ravi we are fine."* The §4/§6/§7 requirement was the owner's to hold and the owner's
> to release; it is released for this checkpoint only. CP2 lands through the ordinary pipeline
> (six inserted lines in `OptionsFlow.jsx`, zero modified, PR #194 → cherry-picked to master).
> Ravi is still told after the fact via the PR's "What Ravi needs to know" section, which stays
> on the closed PR.

> ⛔ **TEMPLATE FIX, 2026-09-23, not a signature:** the `SCOPE APPROVED:` line above originally
> carried instructional prose ("CP1 AND/OR CP2 — name exactly which checkpoint(s), and nothing
> else in the packet.") instead of being genuinely blank, which does not match this repo's
> `sign_gate.py` convention (every other packet's template leaves all four fields blank with
> nothing after the colon) and made the tool refuse to sign it ("no BLANK `SCOPE APPROVED:`
> line"). Restored to blank here; the guidance it carried is unchanged in substance: `SCOPE
> APPROVED:` should name `CP1`, `CP2`, or `CP1 AND CP2` — nothing else in the packet is
> authorized by any subset of those.

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs `api/flow_explain.py`'s
> frontend wiring. **⛔ LETTER CONVENTION CHANGE, recorded here per instruction:** all 26
> single letters A–Z are claimed by prior packets (A–Z all present in
> `docs/terminal-research/12-decisions/gates/`, confirmed by listing that directory — every
> letter from `packet-a-*` through `packet-z-*` has a file). This is therefore the **first
> double-letter packet**, `PACKET-AA`. **Non-collision, checked immediately before writing this
> file:** grepped both worktrees case-insensitively for `packet-aa` and `PACKET-AA` — **zero
> hits** in `docs/terminal-research/12-decisions/gates/` (any file), the root `.scopes/`
> directory in `terminal-research`, and the entire `s7-price-level` checkout (code, docs, tests).
> **`PACKET-AB` is also unclaimed** as of this check — `AA` is used here on the letter's own
> merits (first free), not because `AB` collided. **RG number was re-checked, not assumed, after
> a live collision:** the highest id at first read was `RG-36`, so this row was drafted as
> `RG-37` — before it could be committed, a concurrent session landed
> `9e4b7bd71 "docs: draft PACKET-AC — post-signup referral-code apply gate (RG-37)"` on this same
> branch, claiming that exact number first. Re-scanned `RESEARCH_GAPS.md` after that commit
> landed (highest id now `RG-37`) and re-registered this finding as **RG-38**. `PACKET-AC`'s file
> and `PACKET-AA`'s (this one) do not collide on the letter; only the RG number needed moving.

⛔ **THIS PACKET PROPOSES REAL PRODUCT CODE, SPLIT INTO TWO CHECKPOINTS FOR A PARTNER-FILE
REASON, NOT A CONVENIENCE REASON.** `app/src/pages/OptionsFlow.jsx` is partner-owned (Ravi
co-edits this exact file, plus `schwab_router.py` and `live_massive_router.py` — this repo's own
`CLAUDE.md`, "OptionsFlow mobile (partner-owned, ~7k lines, all inline styles)"). **CP1 touches
that file NOT AT ALL** and can be built, reviewed and tested in complete isolation. **CP2 is the
only piece that touches `OptionsFlow.jsx`, is a single additive `className` hook, and — even
though it is additive-only — explicitly REQUIRES the owner's coordination with Ravi BEFORE it
lands.** That requirement is stated plainly in §4/§6 below, not softened into a suggestion.

---

## 1 · The finding, re-verified fresh, 2026-09-22

`api/flow_explain.py` (681 lines) is a complete, production-grade "AI Print Explainer" for
Options Flow. Read in full for this packet; every claim below cites the actual line.

**The pipeline is deterministic-first** (`build_context()`, lines 444–458): before any LLM call,
the endpoint computes real facts from the print — `_vol_vs_oi()` (opening vs. ambiguous verdict,
line 318), `_moneyness()` (ITM/ATM/OTM + signed distance, line 329), `_dte_bucket()` (0DTE /
weekly / near-term / medium-term / LEAPS, line 349), `_premium_bucket()` (small / retail-plus /
institutional / whale, line 361), `_aggression()` (reads the print's `side` — ASK / ABOVE ASK /
BID / BELOW BID — into a plain-English aggression read, line 371), `_earnings_proximity()`
(queries `engine.get_earnings()`'s bmo/amc buckets for the ticker, line 384), and optional GEX
context (`_gex_context()`, line 425 — deliberately read-only against a cache key nothing
populates yet, never a live Schwab call, per the file's own header comment lines 20–26). The
model (`_call_llm()`, line 593, default `claude-opus-4-8` via `_model_name()` line 103) narrates
these facts under a strict system prompt (lines 516–531: "Use ONLY the facts provided… Never
predict where the stock is going… output STRICT JSON") — it cannot invent a number the
deterministic pass didn't hand it. Every failure mode (LLM timeout, overload, garbled JSON, cost
cap tripped) degrades to `_deterministic_explanation()` (line 488) — the endpoint **never 500s
for an LLM problem** (line 671's bare `except Exception`).

**Route:** `POST /api/flow-explain` and `POST /api/flow-explain/` (`router = APIRouter(prefix=
"/api/flow-explain", …)` line 49; both verbs registered at lines 625–627, the bare form
`include_in_schema=False` so only the trailing-slash form appears in the OpenAPI schema).
Mounted unconditionally — `api/main.py:61` imports it, `api/main.py:8273`
`app.include_router(flow_explain_router)`, **no feature flag gates the mount** (confirmed by
reading the eight lines around 8273: only a `try/except` around the unrelated flow-proxy
registration, nothing gating this router).

**Paid gate:** `require_paid()` (lines 52–77) — `if not is_paid_user(user): raise
HTTPException(402, "Flow explanations require a paid plan")`. Its own docstring explains it was
added 2026-08-09 because the two cost caps below are NOT an auth gate and free signups were
spending the firm's Anthropic tokens before it existed.

**Cost caps — read as literal constants, not restated from memory:**
- **Global daily cap**, `_daily_cap_usd()` (lines 107–111): `float(os.environ.get(
  "FLOW_EXPLAIN_DAILY_CAP_USD", "5.0"))` — **$5.00/day** default. Enforced at line 653:
  `if _spend_today(date_et) >= _daily_cap_usd(): ` → serves the deterministic fallback, $0 spend,
  and **caches** that fallback for the rest of the ET day (line 657) so the cap stays tripped
  without re-computing.
- **Per-user daily cap**, `_user_daily_cap()` (lines 114–118): `int(os.environ.get(
  "FLOW_EXPLAIN_USER_DAILY_CAP", "50"))` — **50 requests/day** default. Enforced at lines 634–640
  (`_bump_user_count()` then `if count > _user_daily_cap(): raise HTTPException(429, …)`),
  counted **before** the cache lookup so a cached hit still counts against the day's quota.
- Pricing table for cost estimation (lines 86–92): `claude-opus-4-8`/`4-7` at $5/$25 per 1M
  tokens in/out, `claude-sonnet-4-6` at $3/$15, `claude-haiku-4-5` at $1/$5; an unrecognized model
  id falls back to a deliberately conservative $15/$75 so the cap trips early rather than late.

**Cache:** SQLite at `FLOW_EXPLAIN_DB_PATH` (default `/data/flow_explain.db`, line 100), schema
at lines 133–151 — `flow_explanations` (keyed on ticker+cp+strike+exp+vol/oi-bucket+side+ET-date,
`_cache_key()` line 461), `flow_explain_costs` (per-ET-day USD spend), `flow_explain_user_requests`
(per-user per-day request count). Backed by a bounded in-process dict (`_MEM_CACHE`, capped at
`_MEM_CACHE_MAX=2048`, line 96) that falls back to it transparently if SQLite is briefly
unavailable (lines 176–225) — the endpoint degrades, it never breaks.

**Request/response shape** (`FlowPrint`/`FlowExplainResponse`, lines 279–313): request takes
`ticker, cp, strike, exp, dte, premium, volume, oi, side, spot, order_type, color, grade, tier`
(the last three optional) — every field a print row already carries. Response is
`{explanation: str, signals: list[str], cached: bool, model: str}`.

**Confirmed by an existing, real backend test suite** — `tests/test_flow_explain.py` (paid gate,
happy path, both caps, cache hit, LLM-failure fallback, cache-key shape, validation) and two
cross-cutting suites that already know this router exists: `tests/test_flow_proxy.py:131–140`
explicitly excludes `/api/flow-explain` from the worker read-proxy ("web-local backing store…
proxying them would serve an empty worker DB") and `tests/test_paywall_gate_free_tier.py:119–121,
196–197` asserts both the bare and slash forms are paywall-gated for a free account. **flow-worker
never reaches this file at all** — `grep flow_explain api/flow_worker_main.py` returns zero
matches, and `tools/flow_worker_watch_coverage.py`'s own reachable-set (run fresh for this
packet) does not include it. This is a **web-only** router with its own web-local SQLite store,
outside flow-worker's territory by construction, not by luck.

**This is not a stub or a half-feature. It is a complete, tested, cost-guarded, paid-gated,
production-mounted backend with zero UI door.**

## 2 · Zero frontend callers — exhaustive, re-verified fresh, 2026-09-22

Grepped `app/src` (the whole tree) case-insensitively for four forms:

| pattern | hits | disposition |
|---|---|---|
| `flow-explain` | 0 | — |
| `flowExplain` | 0 | — |
| `FlowExplain` | 0 | — |
| `explain` (bare, case-insensitive) | 132 files | **every one checked; none reference this endpoint** |

The 132-file hit list for the bare word is generic English usage (`explanation`, `explaining`,
`explained`) scattered across unrelated components (chart engine tests, research tabs, hub
sections, journal notebook, etc.). Specifically checked the three files whose names suggested a
plausible connection to Options Flow — `OptionsFlow_admin.jsx:4206` ("…explaining what was found
and why a fallback was or wasn't built" — a code comment about an unrelated fallback),
`OptionsFlow.picksScroller.test.js:98` ("the root clip that produced the misleading zero is still
explained" — a test description string), `optionsFlow/flowBootstrap.test.js:158` ("explaining
that CONV is optional-chained elsewhere" — a code comment) — **all three are unrelated prose, not
the feature.** No "Explain" button, tooltip, icon, or modal exists anywhere under `pages/
optionsFlow/` or on `OptionsFlow.jsx` itself, confirmed by also grepping the latter directly for
the four patterns above (all zero) and by reading its full hook-className roster (below).

## 3 · The insertion point — read from `OptionsFlow.jsx` directly, not assumed

**Hooks actually present in `OptionsFlow.jsx` today** (`grep -o 'className="of-[a-zA-Z0-9_-]*"'`,
run fresh for this packet — the definitive list, not a restatement of CLAUDE.md's): `of-tabs`
(3989), `of-refresh` (4063), `of-mroot` (4141), `of-chiprow-wrap` (4181, 5231, 5442),
`of-chiprow-seg` (5576, 6009), `of-fetchpl` (6022), `of-picks` (6037), `of-pickrow` (6039, 6149).
**Correction to CLAUDE.md's own list, found while re-verifying for this packet:** the doc names
`of-tip` (theme/sector help ⓘ, "tap-toggled via a `data-pin` flag") as a hook in use — neither
`of-tip` nor `data-pin` appears anywhere in the current file (checked both, zero hits). The ⓘ
affordance the doc is describing does still exist, at lines 7427–7454 (the theme/sector help
icon in the Search tab), but today it is **hover-only** — `onMouseEnter`/`onMouseLeave` toggling
`style.display` on a sibling `<div data-tip="1">` — with no className hook and no touch-survival
handling. This is not this packet's defect to fix; it means CP2 must build its own working
tap-toggle rather than copy an example that is no longer present in the file.

**The narrowest correct insertion point for an "Explain" trigger is per-print-row, in one of the
three structurally-identical flow-print tables already in the file** — each renders one `<tr>`
per individual print with a field set that maps directly onto `FlowPrint`:

- **Contract Detail Modal → "Strike Flow Detail" table** (lines 3366–3416): opens when a member
  clicks a contract row (`fetchContractHistory`); `strikeTrades.map((tr,i)=>…)` (line 3397) renders
  one row per print with `tr.Ty` (order_type), `tr.Si` (side), `tr.V` (volume), `tr.OI` (oi),
  `tr.P` (premium), `tr.Co` (color), `tr.Dt`/`tr.time` (timestamp) — columns `["Day","Time","Type",
  "Side","Color","Vol","OI","Premium","Price"]` (line 3392). The contract's `sym`, `cp`, `K`
  (strike), `exp` and the live `curPrice` (spot) are all already in scope in this same modal
  (lines 3273–3283) — every `FlowPrint` field this endpoint needs is present in this one table
  with no new data plumbing.
- The same modal's "Other Flow for {sym}" table (lines 3457–3485) and the Leaderboard's
  "TOP TRADES BY PREMIUM" table (lines 6279–6308) are the same row shape, elsewhere in the file.

CP1's standalone component is built against this shape (a `FlowPrint`-compatible props object);
CP2 decides, in coordination with the owner and the insertion review, which of these (most likely
the Strike Flow Detail table, since it is the canonical per-contract, per-print view) gets the new
`className` hook. **`app/src/pages/optionsFlow/`** is the file's own established home for
OptionsFlow-adjacent JSX pulled out of the inline-style monolith — `FlowIcon.jsx` already lives
there and is imported into `OptionsFlow.jsx` (line 54: `import FlowIcon from
"./optionsFlow/FlowIcon"`) — so CP1's new files belong beside it.

## 4 · Proposed checkpoints

| CP | scope | touches `OptionsFlow.jsx`? | requires partner coordination? |
|---|---|---|---|
| **CP1** | Standalone, self-contained UI: new `app/src/pages/optionsFlow/FlowExplainButton.jsx` + `FlowExplainModal.jsx` (or a single combined component — build-time call). Calls `POST /api/flow-explain` with a `FlowPrint`-shaped payload; owns its own loading / error / cost-cap-hit (429 and the deterministic-fallback `model` value) / cached-badge states. Buildable and fully testable (component tests, a mocked fetch) **without editing `OptionsFlow.jsx` at all.** | **NO** | **NO** — build and test in isolation today |
| **CP2** | The insertion: one additive `className` hook (e.g. `of-explain` or `of-explain-trigger`, following the `of-*` convention) added to the flow-print row markup identified in §3, mounting CP1's component per print row. **Never touches any existing inline `style={{}}` object in `OptionsFlow.jsx`** — the new hook is a new attribute on the row/cell, nothing removed or restyled. | **YES — this is its only job** | **YES, explicitly, before it lands** |

Both checkpoints are independently approvable. CP1 can ship alone (a built, tested, but unmounted
component — the same "built and correct, wired to nothing" shape this program's other packets
have found elsewhere, held here on purpose rather than by accident). CP2 cannot usefully ship
without CP1 already built, but CP1 does **not** require CP2's approval to build.

### CP1 — exactly what changes

- New files only, under `app/src/pages/optionsFlow/`: `FlowExplainButton.jsx` (or fan-out into a
  button + modal pair). No existing file is edited.
- Calls `POST /api/flow-explain` with `{ticker, cp, strike, exp, dte, premium, volume, oi, side,
  spot, order_type, color, grade?, tier?}` — every field a print row (`tr`/`t` object in the
  tables at §3) already carries in this component, plus `spot` from the already-fetched
  `curPrice`/live-price context and `dte` derived from `exp` the same way the file already
  computes it elsewhere for its own "DTE" columns.
- Renders the response (`explanation`, `signals[]`, `cached`, `model`) in its own modal/popover.
  Handles: loading state; a 402 (should not fire post-paywall, but the caller is defense-in-depth
  since `AuthGuard` gates the page, not this call); a 429 (`FLOW_EXPLAIN_USER_DAILY_CAP` hit —
  show the exact message the backend already composes, line 639: *"Daily explain limit reached
  (50/day). Resets at midnight ET."*); the deterministic-fallback case (`model ===
  "deterministic-fallback"`) shown as a plain-English explanation with no "AI" framing, since
  that is what it is.
- Zero backend change. Zero change to `OptionsFlow.jsx`.

### CP2 — exactly what changes, and the coordination requirement stated plainly

- **One new `className` on the row/cell chosen in §3** (or on a small wrapping `<td>`/`<span>`
  added inline in the map callback) that mounts CP1's `FlowExplainButton`, passed the row's own
  print data. This is the *only* edit to `OptionsFlow.jsx` in this entire packet.
- **Never edits an existing inline `style={{}}` object.** The hook is additive: a new className
  string and, if a new cell is needed, a new `<td>` — not a rewrite of an existing one.
- **⛔ EXPLICIT REQUIREMENT, STATED PLAINLY, NOT SOFTENED: this checkpoint requires the owner's
  acknowledgment and coordination with Ravi BEFORE it lands, even though the diff is
  additive-only.** `OptionsFlow.jsx` is a live file Ravi edits concurrently; an additive-only
  diff still creates a merge/rebase surface neither side chose, and the file's own convention
  (CLAUDE.md's "Rebase-safe technique only") exists specifically so this kind of change does not
  surprise the partner mid-edit. **This is not a suggestion to be careful — it is a precondition
  on CP2 landing, full stop**, distinct from and in addition to the ordinary code-review any
  checkpoint gets.

## 5 · Why this is two checkpoints and not one — and why CP1 is not "half a feature"

A single-checkpoint version of this packet would bundle CP1's isolated, harmless, fully-testable
work with CP2's partner-file edit, forcing the owner to either (a) wait on Ravi's coordination
before *any* of this can be approved, or (b) approve touching a partner's live file to get a
button built. Neither is necessary: CP1 has no dependency on CP2 to be correct, reviewable, or
even demoed (a standalone dev harness or Storybook-less manual render can exercise it against the
real endpoint before it is ever mounted). Splitting them means the owner can say "build CP1 now"
today and decide CP2's timing separately, once Ravi has been looped in — exactly the shape this
program's own multi-checkpoint convention (`PACKET-K`, `PACKET-S`) exists for, applied here for a
partner-safety reason rather than a mere size reason.

## 6 · flow-worker / partner-file impact — checked, not assumed

- **flow-worker never imports `api/flow_explain.py`** (§1) — CP1/CP2 are pure frontend and this
  gate touches no backend file at all, so flow-worker reachability is moot for this packet by
  construction, not by luck.
- **`OptionsFlow.jsx` is Ravi's file.** CP2 is scoped to the single narrowest possible edit (one
  className, mirroring the `of-*` convention already in the file) specifically so that if CP2 is
  approved, the diff Ravi has to reconcile against is as small as this program can make it — one
  line adding a hook, not a restructure. This does not remove the coordination requirement in
  §4/§6 above; it only bounds the size of what needs coordinating.

## 7 · MUST-BUILD, exactly

**CP1:**
1. `app/src/pages/optionsFlow/FlowExplainButton.jsx` (+ a modal, combined or separate file):
   calls `POST /api/flow-explain`, owns loading/error/cost-cap-hit/cached states, renders
   `explanation` + `signals[]`, labels a `deterministic-fallback` response as such (no false "AI"
   framing).
2. Component-level tests (mocked fetch): happy path, 429, LLM-failure-fallback shape, cached
   badge.
3. No change to any other file. No change to `api/**`.

**CP2 — requires the §4/§6 coordination precondition before landing:**
1. One new `className` hook on the flow-print row identified in §3 (or the narrower cell within
   it), following the `of-*` naming convention, mounting CP1's component with that row's print
   data.
2. Zero edits to any existing inline `style={{}}` object in `OptionsFlow.jsx`. A diff review that
   finds a touched `style={{}}` object fails this checkpoint regardless of correctness elsewhere.
3. Owner + Ravi acknowledgment recorded before merge — not merely before the PR is opened.

Nothing else. No backend change in either checkpoint. No change to `api/flow_explain.py`,
`api/main.py`, `schwab_router.py`, or `live_massive_router.py`.
