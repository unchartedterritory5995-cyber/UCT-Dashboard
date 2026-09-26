---
id: ARCH-06
title: Security & entitlement architecture — what enforces access today, what does not, and what Terminal-Next must enforce
role: Security & entitlement architect (ARCH-06). Gated deliverable, MASTER_CHECKLIST item 23, gate item 15.
wave: 4
group: ARCH
category: architecture-proposal
scope: >
  Read-only. Inputs: D-10 `01-existing-system/flags-and-entitlements.md` (accepted), F-04
  `09-security-licensing-cost/licensing-register.md` (accepted, incl. its §3B/§4.4 rules for this
  role), R-17 in `00-program-control/RISK_REGISTER.md`, S9 in `05-product-strategy/product-architecture.md`
  and its row in `capability-infrastructure-matrix.md`. Source measured in the sibling worktree
  `C:\Users\Patrick\uct-worktrees\_merge-master` — `api/middleware/auth_middleware.py`,
  `api/routers/auth.py`, `api/services/entitlements.py`, `api/bars_auth.py`,
  `api/auth_surface_check.py`, `api/services/auth_db.py`, `api/services/auth_service.py`,
  the R-17 route families, `app/src/context/AuthContext.jsx`, `app/src/constants/freePages.js`,
  and that repo's `CLAUDE.md`. No git command was run, no test executed, no production call made,
  no `railway` command issued, no vendor contacted.
confidence: >
  🟢 high on what the source in that worktree declares (every claim below carries a `file:line`).
  🟡 on completeness of the route sweep — enumerated by reading named files, not by importing
  `api.main:app` and walking `app.routes`. 🔴 on anything about PRODUCTION: nothing was probed.
evidence_ceiling: >
  ⛔ THE BIGGEST CEILING IS THE ONE THAT MATTERS MOST HERE. Measurements are of MASTER as checked
  out in `_merge-master` on 2026-09-25. The contract forbids git, so the worktree's HEAD SHA was
  never read and its relationship to `origin/production` was never established — and `web` deploys
  from `production`, not `master` (CLAUDE.md, "Gate carry-over", C5). So every "now gated" statement
  in §2.2 is a statement about SOURCE, never about the running service. A source read cannot close
  R-17; one read-only GET per route can, and is named as measurement m2 below.
  Further: no probe, no test run, no middleware-prefix enumeration, and no body-level inline auth
  checks were read for the handlers that take a bare `request: Request`. Production `auth.db` was
  never opened, so the admin roster and any `user_tags` population are NOT DETERMINED.
sources: >
  docs/terminal-research/01-existing-system/flags-and-entitlements.md (D-10) ·
  docs/terminal-research/09-security-licensing-cost/licensing-register.md (F-04, §3B, §4.1, §4.4) ·
  docs/terminal-research/00-program-control/RISK_REGISTER.md (R-17) ·
  docs/terminal-research/00-program-control/OWNER_DECISIONS.md (D-001, D-002, D-004) ·
  docs/terminal-research/05-product-strategy/product-architecture.md (S9) ·
  docs/terminal-research/05-product-strategy/capability-infrastructure-matrix.md (row S9) ·
  docs/terminal-research/07-technical-architecture/current-ui-architecture.md (D-06, house style) ·
  docs/terminal-research/06-ux-and-information-architecture/fixed-modular-hybrid.md (C5-03, house style) ·
  _merge-master:api/middleware/auth_middleware.py · api/routers/auth.py · api/services/entitlements.py ·
  api/bars_auth.py · api/auth_surface_check.py · api/services/auth_db.py · api/services/auth_service.py ·
  api/routers/{live_prices,snapshot,movers,bars,stream,breadth_monitor}.py · api/gex_router.py ·
  api/dealer_positioning_router.py · api/flow_scoreboard.py · api/routers/render_panels.py ·
  app/src/context/AuthContext.jsx · app/src/constants/freePages.js · _merge-master:CLAUDE.md
uct_relevance: high
status: draft
date: 2026-09-25
---

# ARCH-06 — Security & entitlement architecture

**Vocabulary.** TERMINAL-CURRENT is the route `/calendar`, display-named "UCT Terminal".
TERMINAL-NEXT is the product this program designs. **S9** is the platform-core system
`product-architecture.md` names "Entitlements & Licensing Gate"; this document is the
architecture for S9's enforcement, and S9's own ownership boundary is the sentence this
document is built around: *"Decisions, not enforcement points — every data route enforces
server-side (R-17 → ARCH-06: Tier S); S9 is what the route consults"*
(`05-product-strategy/product-architecture.md`, S9 → Ownership boundary).

---

## 0. Headline

**Three findings, in order of consequence.**

**(1) ⭐ R-17's three CONFIRMED routes now declare an auth dependency in master's source.**
`/api/live-prices`, `/api/snapshot`, `/api/snapshot/{ticker}`, `/api/movers`,
`/api/extended-movers` and `/api/gex/data` all carry `Depends(get_current_user)` today, and the
whole `/api/bars*` and `/api/stream/bars` family carries `Depends(require_bars_access)`
(§2.2 has every line). ⛔ **This does NOT close R-17, and must not be reported as closing it.**
The finding was established by probe; it can only be retired by probe. I read source in a master
worktree, could not read the SHA, and `web` deploys from `production` — so the honest statement is
*the omission appears remediated in source; the running service was not measured*.

**(2) 🔴 And the family is not empty. Six route families still declare no dependency in the
same source read** — `/api/stream/prices` (real-time equity ticks), `/api/gex/compare`, the three
`/api/dealer-positioning/*` diagnostics, `/api/flow-scoreboard` (public by its own docstring),
and `/r/*` (*"EFFECTIVELY PUBLIC"* by its own docstring). Two of those are deliberate and have
owner escalations open (ESC-13, ESC-06); four look like the same omission class R-17 named.
**The remediation was per-route. The class was not addressed** — which is exactly what F-04's
rule R-A6-1 predicted when it said this needs *"a rail, not a fix"*, and it is still true:
`api/auth_surface_check.py:79` sets `MUTATING = {"POST","PUT","PATCH","DELETE"}` and `:248`
iterates only those, so **the boot auditor still cannot see a GET.**

**(3) The entitlement mechanism is real, well-reasoned, and has no data in it — and the one
thing Terminal-Next needs that it lacks is a per-user cohort any gate reads.**
`entitlements.py` ships four axes and one toolkit `"all"` whose three optional bounds are `None`
(`:241-249`), reading a `user["toolkit"]` key the `users` table does not have (`toolkit_for:268-275`
vs `auth_db.py`, where `grep toolkit` returns **nothing**). D-10's gap stands unchanged, and
`entitlements.py` remains its natural seat.

⭐ **What HAS changed since D-10, and it is the most useful thing in this document:** the auth
payload now carries an `admin` cohort rung that resolves **per request, from the member's role**
(`auth.py:214` `_ADMIN_ONLY = "admin"`, resolved `:253-263`, spread at `:375`). D-10 recorded that
no cohort of any kind reached the client. One now does. It is a *class*, not a named set — but it
is rung 1 of the dark-launch ladder, it is already shipped, rail-tested and mutation-proved, and
Terminal-Next gets it for free (§3.4).

**CONFIDENCE.** 🟢 on all three against the source read. 🔴 on production for finding 1.

---

## 1. What exists today, measured from source

### 1.1 Authentication is one cookie, one dependency chain, and a header that says it blocks nothing

**OBSERVATION.** Authentication is a session cookie (`uct_session`) resolved by
`validate_session` inside FastAPI dependencies. There is no middleware that blocks requests by
default. The module's own header states the design in two sentences, and the second one is the
origin of the whole R-17 defect class.

**EVIDENCE.** `api/middleware/auth_middleware.py:1-4` —
*"Auth middleware — extracts session token from cookie, attaches user to request. **Does NOT block
any existing endpoints. Only used by routes that explicitly depend on it.**"* The chain:

| dependency | line | refusal | note |
|---|---|---|---|
| `get_session_token` | `:13` | — | raw cookie read |
| `get_current_user` | `:17-22` | **401** `"Not authenticated"` | the base gate |
| `get_current_user_optional` | `:25-27` | never raises | returns `None` |
| `get_current_user_with_plan` | `:30-33` | — | adds `plan` via `get_user_plan` |
| `meets_plan_gate(user, plans)` | `:36-61` | returns bool | **THE membership predicate** |
| `require_plan(plans)` | `:64-72` | **403** `"Upgrade required"` | thin cookie layer over the above |
| `require_admin` | `:75-79` | **403** `"Admin access required"` | `user.get("role") != "admin"` |
| `is_paid_user` | `:92-98` | — | delegates to `trial.is_paid_or_trial` |
| `requires_voice_access` | `:101-110` | **402** | admin ∪ `PAID_PLANS` ∪ active trial |

`PAID_PLANS = {"pro", "premium", "lifetime"}` at `:86`, with the in-file comment
*"Single source of truth — mirrored by isPaid in app/src/context/AuthContext.jsx"*.
`meets_plan_gate`'s docstring is explicit that it exists to stop re-derivation: *"Any other caller
resolving its own user … must call THIS function directly rather than re-deriving the rule — two
copies of one membership predicate drift the moment either one changes and nothing catches it"*
(`:46-52`).

**INTERPRETATION.** The primitive is sound and the anti-duplication reasoning is already written
down by the code that owns it. The cost of "blocks nothing by default" is that **a route is
protected by an act of authorship**, so protection is present exactly where somebody remembered
it — and absent, silently, where nobody did. That is not a bug in this module; it is the
architectural property §3.6 must rail against.

**RELEVANCE TO UCT.** Terminal-Next inherits a working auth primitive and an unenforced habit.
The primitive needs no redesign. The habit needs a check.

**CONFIDENCE.** 🟢 high — one file, read end to end (111 lines).

### 1.2 The paid gate is defined per router — and two paid families disagree about `comped`

**OBSERVATION.** `require_paid` is **defined**, never imported: each router declares its own, so
each owns its own 402 sentence. Measured 2026-09-25 by
`grep -rn "def require_paid" api/ | wc -l` → **46** definitions, all with the identical signature
`(user: dict = Depends(get_current_user_with_plan))`. ⛔ Re-derive that number rather than
trusting it here; the command is the authority.

**EVIDENCE.** Representative sites: `api/routers/ai_search.py:40`, `calendar.py:38`,
`breadth_monitor.py:69`, `portfolio_heat.py:28`, `journal_two.py:2506`, `api/flow_explain.py:52`.
D-10 §8 names the rail that pins the per-router convention
(`tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`) — 🟡 inherited
from D-10, not re-executed or re-read here.

**⭐ And there is a SECOND paid family, which disagrees with the first on purpose.**
`api/bars_auth.py:88-113` defines `require_bars_access` — the gate on every chart-data route — and
its docstring states the divergence outright:

> *"ENTITLEMENT IS `meets_plan_gate`, NOT A SECOND PLAN PREDICATE. … the two shipped paid families
> genuinely DISAGREE about `comped` (`test_the_two_paid_gate_families_DISAGREE_about_comped` pins
> it), and the owner's policy for chart data names comped and trial as ALLOWED. So this surface
> takes the `require_plan`/`meets_plan_gate` family deliberately, and answers 403 the way that
> family does — rather than `require_paid`'s 402, which would refuse a comped account."*

It also states the 401-vs-403 rule (`:105-109`): *"401 is 'you are not signed in'; 403 is 'you
are, and this plan does not include chart data'. Collapsing them would leave a member with an
expired session and a free member looking identical."* And it carries a service bypass:
`_push_secret_ok(authorization)` returns `{"via": "push_secret"}` before any session is read
(`:111-112`).

**INTERPRETATION.** This is the most important structural fact in §1 for Terminal-Next. There are
**two paid predicates with two different answers for `comped`, two different HTTP codes, and one
service-credential bypass** — and every part of that is deliberate, documented and tested. It is
not debt to be tidied away. It is evidence that "is this member entitled" is *already* a question
with more than one legitimate answer depending on the data class, which is exactly what an
entitlement object has to model instead of collapse.

**RELEVANCE TO UCT.** A single `entitlement(session)` object (§3.1) must be able to return
different verdicts per data class without becoming two predicates again. The refusal *code* is
part of the contract, not an implementation detail.

**CONFIDENCE.** 🟢 high — both files read directly.

### 1.3 Flags ride the auth payload, and there is NO feature-flag endpoint — verified

**OBSERVATION.** `_access_payload(user, plan)` (`api/routers/auth.py:267`) is the single shared
block on every auth response. It is spread into signup, login, `/me` and the TOTP path at
`:435`, `:470`, `:505`, `:530` and `:927`. Every flag it carries is read from `os.environ`
**inside the function**, i.e. per request.

**EVIDENCE — what rides it.** Point at the source, do not trust this list to stay complete:

| payload key | line | polarity | table |
|---|---|---|---|
| `trial` · `paid_equiv` · `billing` | `:284-290` | derived | `is_paid_plan = is_admin or plan in PAID_PLANS` (`:282`) |
| `hub_preview_enabled` | `:305-307` | **KILL** — unset ⇒ ON | — |
| `research_technical_tab_enabled` | `:328-330` | enablement — unset ⇒ OFF | — |
| `research_flow_tab_enabled` | `:340-342` | enablement | — |
| `s7_filing_watch_enabled` | `:353-355` | enablement | — |
| `**_notebook_flags()` | `:364` | mixed, per capability | `NOTEBOOK_FLAGS` `:131-137`, `NOTEBOOK_MODE_FLAGS` `:160-162` |
| `**_breadth_dc_flags(is_admin=is_admin)` | `:375` | enablement **+ `admin`** | `BREADTH_DC_FLAGS` `:205-208` |

**EVIDENCE — the absence.** `grep -rn "/api/flags\|\"/features\|'/config'" api/routers/ api/*.py`
returns exactly **one** hit, and it is a docstring explaining why the endpoint does not exist:
`auth.py:220` — *"RIDES THIS PAYLOAD RATHER THAN A NEW `/api/flags`, and that is a decision the
repo already made and recorded: `kill-switch-spec.md` first specified `GET /api/config` and
**struck it on the day it was written**, because this app treats the absence of a config endpoint
as deliberate and a second mechanism would be a second authority. It would also reach members
LATER — a boot-read needs a reload, while this arrives on the next authenticated request."*
The same reasoning is restated at `:357-363`. **CONFIRMED: there is no feature-flag endpoint in
this application, and its absence is a recorded decision rather than an omission.**

**EVIDENCE — the discipline the tables encode.** Three rules, each stated at its own site:
polarity is per capability and not a style choice (`:126-130` — *"a forgotten variable must never
be indistinguishable from a deliberate shutdown"*); an **unrecognised value takes the default,
never its opposite** (`:186-188`, `:196-198`, `:233-235` — *"a typo'd 'flase' must not kill a
shipped wave"*); and the env name → payload key relation exists in exactly one function,
`_notebook_flag_key` (`:168-174`), so *"a rename cannot leave one side behind"*.

**INTERPRETATION.** The channel D-10 recommended for a client-visible gate — one field on
`_access_payload` — is now the house mechanism, used by four independent flag families, with the
polarity and typo-safety rules written beside each table. Terminal-Next does not need to invent a
flag channel and should not add one; adding `/api/flags` would re-open a decision this repo made
and recorded twice.

**RELEVANCE TO UCT.** Anything Terminal-Next needs the browser to know about entitlement or
release state goes on this payload. That includes the cohort field §3.4 proposes.

**CONFIDENCE.** 🟢 high — I ran the grep and read every cited line.

### 1.4 Admin is granted by an environment variable plus two source literals, and there is no demote path in code

**OBSERVATION.** `users.role == 'admin'` is the only admin representation. It is written in
exactly two places, both promotions, both keyed on an email set assembled **at module import**.

**EVIDENCE.**
- `auth.py:107` — `ADMIN_EMAILS = set(filter(None, os.environ.get("ADMIN_EMAILS", "").split(",")))`
- `:108-109` — two addresses added as **source literals** (`# Owner always admin`, `# Admin`).
- Promotion at signup: `:397-403` (`UPDATE users SET role = 'admin'`).
- Promotion at login: `:446-452` (same, guarded by `role != 'admin'`).
- Those two `UPDATE … SET role` statements are the only role writes in the file.
- Import-time assembly means the value is **frozen for the life of the process**; a change to
  `ADMIN_EMAILS` needs a restart, not just a variable set (D-10 §1.1's import-time class).
- CLAUDE.md states the consequence independently, in the smoke-account section: *"Its admin role
  comes from `ADMIN_EMAILS` because there is **no other path**: `api/routers/auth.py` promotes on
  signup and on login from that set, and no admin endpoint sets a role."*

**⭐ Admin implies paid-equivalent, by derivation rather than by a separate branch** —
`meets_plan_gate:53-54`, `_access_payload:282`, and client-side `AuthContext.jsx:275`. D-06 §2
recorded the same at the nav layer (`showAll = isPaid`).

**INTERPRETATION.** Three properties follow, and all three are architectural inputs rather than
complaints. (a) Admin is a **deploy-coupled, code-coupled** grant: one of the two literals cannot
be changed without a commit. (b) There is **no revocation path in the application** — removing an
address from `ADMIN_EMAILS` stops future promotions and does not demote an existing row, because
nothing writes `role = 'member'`. (c) Because admin ⇒ paid-equivalent, an admin grant is
simultaneously the widest entitlement in the product; there is no "admin but not paid" and no
"read-only admin".

**RELEVANCE TO UCT.** If Terminal-Next introduces any staff tier finer than "admin" — support,
read-only desk, contractor — it is a new concept, not a configuration of this one. And the
ladder's first rung (§3.4) inherits admin's coarseness: "show it to admins" means "show it to
everyone who can also do everything".

**CONFIDENCE.** 🟢 high on the mechanism. 🔴 on **who holds it** — production `auth.db` was never
read, so the admin roster is **NOT DETERMINED**.

**OPEN QUESTION.** Who currently holds `role = 'admin'` in production, and is a demote operation
needed before Terminal-Next ships? Answering it is one read of a live table, which this program
does not do.

### 1.5 `entitlements.py` — what it actually does today

**OBSERVATION.** It is a complete, rail-tested entitlement *mechanism* carrying **one toolkit**
whose three optional bounds are `None`, keyed on a field the schema does not define. Its four
design rulings are more valuable to Terminal-Next than its data.

**EVIDENCE — the shape.**
- Header `:1-18`: *"⭐ WHAT IT GATES: BREADTH. Symbols, history depth, definition count, refresh
  cadence. ⛔ WHAT IT NEVER GATES: MECHANICS. Nobody is sold a worse RSI. ⛔ AND IT IS APPLIED
  WHERE BREADTH IS PRODUCED, NEVER WHERE IT IS DISPLAYED. A UI that hides rows is not
  entitlement — the rows were computed, they held the GIL while a universe sweep ran, and a client
  can ask for them."*
- Refusal vocabulary `:122-124`, and the set is **closed by construction**:
  `ToolkitWithheld.__init__:147-154` raises `ValueError` on an unknown reason —
  *"The set is closed on purpose: a coverage line branches on it."*
- `:13-18`: *"`withheld` IS NEITHER `dropped` NOR `not_computable` … Folding any two makes a
  capped screen read as a broken one and a broken one read as a capped one, and a trader acts on
  the difference."*
- `Limits` `:178-204` — frozen dataclass, four fields, **every field required**
  (*"A default here would be a fifth place a cap number could live"*), `None` means ungated on that
  axis and `max_definitions` has no ungated spelling.
- `_check_count:206-213` — the bool branch comes first, because `isinstance(True, int)` is true and
  `max_symbols=True` *"would silently cap a universe sweep at ONE symbol while reading as
  'enabled'"*.
- `TOOLKITS` `:241-249` — one entry, `"all"`; `max_symbols`/`max_history_bars`/`min_refresh_seconds`
  all `None` with `# OWNER: §8.4` / `§8.5`; `max_definitions` **references**
  `user_definitions.MAX_DEFINITIONS_PER_USER` rather than restating it, and `:233-240` explains why
  — *"turning a capacity bound into an entitlement bound is a CATEGORY CHANGE"*.

**EVIDENCE — the four axes and their wiring.**

| axis | function | outcome | wired? |
|---|---|---|---|
| symbols | `apply_symbol_cap:307-329` | `(kept, withheld)` — **both lists, because the withheld ones have names**; order is the caller's | ✅ (mirrored by `scan_evaluator._apply_limits`, agreement railed) |
| history depth | `apply_history_cap:332-359` | **unchanged bars, or a refusal — never shorter** | ✅ (`:58-62`, `scan_evaluator._history_withheld`) |
| definition count | `check_definition_count:362-376` | raises `ToolkitLimitExceeded` (a `ValueError`, so the store's existing 400 handler carries it — `:157-165`) | ✅ |
| refresh cadence | `refresh_floor_seconds:379-415` | `max(data floor, plan floor)` — **entitlement may only ever RAISE it** | ⛔ not wired (D-10 §7: no per-toolkit scheduler surface) |

**EVIDENCE — the door.** `limits_dependency:293-302` — *"IT IS A SECOND DEPENDENCY BESIDE
`require_paid`, NEVER A REPLACEMENT FOR IT. … One dependency answering both would make a single
402 mean two different things."* Applied at `definition_record.py:138`, `scan_results.py:114`,
`scan_run.py:190`, `user_definitions.py:286`, `:412`, `:635` (measured 2026-09-25;
`grep -rn limits_dependency api/`). `user_definitions.py:112-113` records a deliberate
**non**-application on a route that stores nothing.

**EVIDENCE — the missing data.** `toolkit_for:254-275` reads `user.get("toolkit")` and falls back
to `DEFAULT_TOOLKIT`; its docstring defends the lookup — *"ONE TOOLKIT SHIPS, AND THE LOOKUP IS
STILL REAL. Returning `DEFAULT_TOOLKIT` unconditionally would be indistinguishable from a lookup
that had been deleted."* And the field does not exist: the `users` table is created with six
columns (`auth_db.py`, `CREATE TABLE IF NOT EXISTS users` — id, email, password_hash,
display_name, role, created_at) plus four `ALTER TABLE users` migrations (`:567`, `:573`, `:579`,
`:585` — email_verified, last_login_at, referral_code, full_name). `grep -n toolkit
api/services/auth_db.py` returns **nothing**. 🟢 re-measured here, not inherited.

**INTERPRETATION.** The history-axis ruling (`:21-73`) is the most reusable artifact in this
subsystem and should govern every future axis. It is worth stating as a test, because it is what
separates a legitimate entitlement axis from selling a degraded product:

> **Breadth is how much of the market — and how much of the past — your plan lets you ASK about.
> Mechanics is what number comes back for the question you were allowed to ask.**

Its proof is a measurement, not an argument: `ema(close,20)` over 400 bars is `15.269399733598789`
and over the last 120 is `15.269384587868412`, a relative difference of `9.919e-07` — **inside
`pytest.approx`'s default `rel=1e-6`**, so a trimming implementation would have passed a naive
equality test (`:34-43`). The gate is therefore `repr()` for `repr()`.

**RELEVANCE TO UCT.** Terminal-Next's tiering belongs here, and only the `TOOLKITS` table changes
when the owner supplies numbers. Everything else — the vocabulary, the refusal type, the
produced-not-displayed rule, the two-dependency pattern — already ships.

**CONFIDENCE.** 🟢 high — the module is 416 lines and was read in full.

### 1.6 The client mirror is not an authority, and it defaults OPEN

**OBSERVATION.** `isPaid` on the client is a derived convenience, and the hook that exposes it
returns `true` when no provider is mounted.

**EVIDENCE.** `app/src/context/AuthContext.jsx:275` derives `isPaid` from role, plan and trial;
`:301` — `return ctx ? ctx.isPaid : true`, with the in-file note at `:294-300` that it *"defaults
to `true` when no AuthProvider is"* present. `FREE_PAGES` is now **one module** —
`app/src/constants/freePages.js:15` (`['/morning-wire']`) imported by `AuthGuard.jsx:8`,
`NavBar.jsx:7` and `MoreSheet.jsx:8`, with the file's own header naming the fix:
*"S9 CP1 follow-up — FREE_PAGES was hand-typed identically in THREE files"*.

⚰️ **D-10 §4.2's "three hand-synced copies" finding is CLOSED** and should not be re-reported.
The correction is itself evidence for §3.1: the fix was *derive from one module*, which is the same
move this document asks for one level up.

**INTERPRETATION.** A client gate that fails open is correct as a *rendering* default and
catastrophic as an *entitlement* default — which is precisely why F-04's R-A6-1 says *"the SPA
route guard is not entitlement"*. Nothing here needs changing; it needs never to be relied upon.

**CONFIDENCE.** 🟢 high.

### 1.7 The boot auditor is a good instrument pointed at half the surface

**OBSERVATION.** `api/auth_surface_check.py` (456 lines) inspects the **live route objects** at
boot and asks whether every route carries a recognised guard. It audits **mutating methods only**.

**EVIDENCE.** `GUARD_NAMES` at `:70`; `MUTATING = {"POST", "PUT", "PATCH", "DELETE"}` at `:79`;
`ALLOWED_OPEN` (an exact `(method, path)` → written-reason map) at `:118`; `audit_routes` at
`:225`, whose loop is `for method in sorted(m for m in methods if m in MUTATING)` at `:248`, with
the `ALLOWED_OPEN` exemption at `:250` and the guard test at `:252`. Proxied flow routes get a
third `DELEGATED` bucket verified over private networking (`fetch_worker_vouch:313`,
`verify_delegation:350`), and `:41-43` records that the delegated set *"are not ALLOWED_OPEN
either: that list means 'checked and safe for a stated reason'"*. D-10 §4.4 quotes the docstring's
reason for auditing route objects rather than probing: *"during this audit a probe of a mutating
endpoint executed a real production job (8,108 contracts captured) before anyone intended it."*

**INTERPRETATION.** The instrument's design is right in every respect except its aperture. It
reads the artifact (mounted routes) not a proxy; it distinguishes "open and checked" from "open";
it refuses to let a delegation pass unverified (*"A delegation nobody can fail would be a
suppression with better manners"*). And **a read-only endpoint that hands vendor real-time data to
an anonymous caller is invisible to it** — which is the whole of R-17.

**RELEVANCE TO UCT.** Terminal-Next's read endpoints are GETs. The cheapest, highest-leverage
security change available to this architecture is widening this file's aperture, not writing a new
instrument (§3.6).

**CONFIDENCE.** 🟢 high on the aperture (`:79`, `:248` read directly). 🟡 on whether some GETs are
covered by a middleware prefix instead — `middleware_guarded_prefixes(app)` exists at `:198` and
its population was **not** enumerated.

---

## 2. The named gaps

### 2.1 No per-user cohort store that any gate reads

**OBSERVATION.** Unchanged from D-10 §5.2, re-verified here. There is no cohort column, no cohort
table consulted by a gate, and no admin control that grants anything except `comped` (which grants
*paid*, not *beta*).

**EVIDENCE.**
- The `users` table has no cohort or toolkit field (§1.5, measured).
- `user_tags` **exists and is the right shape**: schema `auth_db.py:185-193` with indexes on
  **both** `user_id` (`:192`) and `tag` (`:193`); helpers `auth_service.py:811` `add_user_tag`,
  `:826` `remove_user_tag`, `:840` `get_user_tags`; joined into admin list filtering at `:336`.
  Admin-written only, with an existing admin UI (D-10 §5.3). **No gate reads it.**
- ⛔ `user_preferences` is the wrong store and D-10 §5.3 says why: `GET/POST /api/auth/preferences`
  (`auth.py:2272-2278`) is guarded by `get_current_user` only, so **the member writes their own
  preferences** — an entitlement stored there is self-grantable. `user_tags`' asymmetry (admin
  writes, member cannot) is the entire reason it is the right store.
- The only per-user lever an admin has today is `POST /api/auth/admin/comp-access`, and it grants
  paid (D-10 §5.1).

**INTERPRETATION.** Every component of a named-cohort mechanism is already built except the four
lines that connect them: a `has_tag` helper, a dependency beside `require_paid`, one field on
`_access_payload`, and a ledger-visible master switch. `entitlements.py` is the natural seat for
the *decision* (`toolkit_for` already asks the user object what it carries); `user_tags` is the
natural seat for the *data*.

**RELEVANCE TO UCT.** A Terminal-Next dark launch to named members is the first thing this product
has wanted that the codebase cannot express. Everything else in §3.4's ladder already exists.

**CONFIDENCE.** 🟢 high.

### 2.2 R-17 — every endpoint named, with what the source says today

**OBSERVATION.** R-17 (RISK_REGISTER, CONFIRMED 2026-09-02 08:05 UTC by read-only browser-UA GETs)
found that vendor real-time data was served to anyone with the URL. F-04 §3B tabulates the family
as X-06…X-13. Measured against master's source on 2026-09-25, **the three CONFIRMED routes and
most of the BY-SOURCE ones now declare a dependency; six families still do not.**

⛔ **Read the ceiling before the table.** This is a source read in a worktree whose SHA I could not
read, of a branch that is not what `web` serves. A source dependency is necessary and not
sufficient: it says the author wired a gate, not that the deployed process refuses an anonymous
GET. **R-17 stays open until one probe per route says otherwise** (measurement m2).

| F-04 row | Route(s) | Source today | Citation |
|---|---|---|---|
| X-06 | `GET /api/live-prices` | ✅ `Depends(get_current_user)` | `api/routers/live_prices.py:559` |
| X-07 | `GET /api/snapshot`, `/api/snapshot/{ticker}` | ✅ both | `api/routers/snapshot.py:9`, `:17` |
| X-08 | `GET /api/movers`, `/api/extended-movers` | ✅ both | `api/routers/movers.py:9`, `:30` |
| X-09 | `GET /api/gex/data` | ✅ | `api/gex_router.py:17` |
| X-09 | `GET /api/gex/compare` | 🔴 **no dependency** — `(ticker, dte)` only | `api/gex_router.py:35-39` |
| X-09 | `GET /api/dealer-positioning/status`, `/sample`, `/flow-sources` | 🔴 **no dependency** on any of the three | `api/dealer_positioning_router.py:56-57`, `:185-189`, `:221-222` |
| X-10 | `GET /api/bars/{ticker}`, `/{ticker}/adjustment-basis`, `/api/bars-history/{ticker}`, `/api/bars-today-pack`, `POST /api/bars/warm` | ✅ `Depends(require_bars_access)` on all five | `api/routers/bars.py:498`, `:529`, `:1117`, `:469`, `:335` |
| X-11 | `GET /api/stream/bars` (SSE) | ✅ `Depends(require_bars_access)` | `api/routers/stream.py:343` |
| X-11 | `GET /api/stream/prices` (SSE) | 🔴 **no dependency** — `(request, tickers)` only. Real-time equity ticks | `api/routers/stream.py:175-179` |
| X-12 | `GET /api/flow-scoreboard` | 🔴 **open by design** — *"No auth on the GET — read-only, cacheable, public"* | `api/flow_scoreboard.py:17`; routes `:328`, `:334` |
| X-13 | `/r/catalysts`, `/r/buzz`, `/r/flow`, `/r/book`, `/r/econ`, `/r/themes`, `/r/tweets`, `/r/breadth`, `/r/breadth-monitor`, `/r/earnings-history`, `/r/chart-settings`, `/r/calendar-week.png` | 🔴 **token only, and the token is public** — *"That token is inlined into the frontend JS bundle, so treat these as EFFECTIVELY PUBLIC"* | `api/routers/render_panels.py:1-9`; routes `:128`–`:558` |
| (F-04: NOT DETERMINED) | `GET /api/breadth-monitor/live` | ✅ `Depends(require_paid)` | `api/routers/breadth_monitor.py:1027` |
| (new, not in F-04) | `GET /api/breadth-monitor/live-diag`, `/live/reconcile` | ⚠️ **not determined** — both take `request: Request` with no `Depends`; an inline check in the body was not read | `api/routers/breadth_monitor.py:156-157`, `:1136-1138` |

**INTERPRETATION.** Two distinct things happened, and conflating them would be the error.

**(a) The individual routes were fixed.** Six of F-04's eight LIVE-TODAY or BY-SOURCE rows now
name a dependency in source, including all three the orchestrator probed. That is real progress on
the specific exposure, and it is worth saying plainly.

**(b) The class was not.** ⭐ The two most consequential remaining rows are **not** the ones marked
"by design". `/api/stream/prices` is a real-time tick stream with no gate, and
`/api/dealer-positioning/*` exposes option-chain-derived rows under the single process-wide Schwab
OAuth token F-04 describes at T-77. Both look exactly like the omission class — a read route whose
author did not add a dependency — and **both were invisible to every instrument in the repo**,
because the boot auditor skips GETs (§1.7) and nothing else looks. F-04's R-A6-1 already called
this: *"the 'unauthenticated by omission' class recurred after it was remediated once
(`admin_guard.py` → the GEX family) … so the architecture needs a route-table check that fails **by
name**"*. The GEX family has now been remediated a second time — `/data` is gated and `/compare`,
four lines below it, is not. **That is the same recurrence, one route apart, and it is the strongest
possible argument for a rail over a fix.**

**RELEVANCE TO UCT.** F-04's assumption A5 stands unchanged and is Tier-S: every data endpoint
Terminal-Next uses is authenticated server-side, and the open routes are treated as unintended
until the owner says otherwise (ESC-06). Nothing in this source read changes that; if anything the
`/compare` finding strengthens it.

**CONFIDENCE.** 🟢 high on what each cited line says. 🔴 on production. 🟡 on completeness — I read
the files F-04 named plus the neighbours I found while reading them; I did not import the app and
walk its routes, which is how the 2026-08-09 audit made a route claim exhaustive.

⭐ **RECOMMENDATION — report this correctly.** The right sentence for a status file is *"R-17's
routes appear gated in master's source; four look like fresh instances of the same class; the
finding is not closed because no probe was run."* The wrong sentence is *"R-17 is fixed."*

### 2.3 What the licensing register constrains about who may see what

**OBSERVATION.** F-04 does not merely add risk rows; §4.1 and §4.4 impose **hard design
constraints on this architecture**, several of which are not obvious from a security-only reading.
They are inputs, not opinions, and each is retired by a named escalation rather than by argument.

**EVIDENCE — the assumptions in force** (F-04 §4.1):
- **A5** — every data endpoint is authenticated server-side in Terminal-Next (Tier-S); the open
  routes are treated as unintended. *Retired by ESC-06 — and **either answer keeps the rule for
  Terminal-Next**.*
- **A1** — every member-facing raw-vendor display is Restricted-pending-contract, and no
  member-facing raw vendor surface is added to the roadmap (D-002 (b)+(c)).
- **A4** — UCT stays downstream of the SIPs and OPRA; no attestation, no entitlement reporting is
  built, and ⛔ **no surface may *require* UCT to run subscriber entitlement.**
- **A11** — desk-first lowers *reach*, not *class*: the desk-only escape does not exist at Massive,
  FMP or Finnhub.
- **A14** — contract facts come only from the owner; an armed flag, a 200 response and a code
  comment are none of them.

**EVIDENCE — the rules addressed to this role** (F-04 §4.4, R-A6-1…R-A6-10), compressed to what
they constrain:
- **R-A6-1** server-side auth on every data route, **as a rail that fails by name**, not a fix.
- **R-A6-2** **audience is an entitlement attribute** — `desk · member · community · paid
  newsletter · public` on every surface and every published artifact — and there is **one**
  publication chokepoint asking *"whose data is in this, and may it go out?"* ⭐ It also names the
  reusable idiom: the existing fail-closed gates (`DESK_PUBLIC_SHOWS`, `DESK_TSDR_ANNOUNCE_SHOWS`,
  blank-means-nothing webhooks) *"were built for the paywall question, not the vendor question;
  reuse them and add the second reason to consult them."*
- **R-A6-3** accepted risks live in `OWNER_DECISIONS.md`, **not docstrings** — the publication gate
  reads the decision file, *"so a surface is public because a decision says so, never because a
  comment does."* (The two live counterexamples are `/api/flow-scoreboard`'s docstring and
  `DESK_PUBLIC_SHOWS=*`.)
- **R-A6-4** per-member cost is visible at design time: **$1/member/mo per Tape A and B,
  $1.25/member/mo OPRA**, a Business gate at 200+ users, and **any cost that scales with member
  count escalates regardless of amount**.
- **R-A6-5** stay downstream unless the machinery is budgeted — and it enumerates that machinery
  (click-through subscriber agreement before real-time access; non-professional qualification prior
  to access; unique non-shared credentials; concurrent-session prevention; monthly entitlement
  reports; a three-year audit trail; semi-annual re-verification). ⭐ **ESC-05 is now ANSWERED
  favourably** (F-04 §0 addendum, 2026-09-19: Massive is vendor of record for customer-facing OPRA
  display), so this machinery **stays unbuilt** — that is a scope *reduction* handed to this
  architecture, and A4 makes it a constraint: no design may quietly re-introduce the requirement.
- **R-A6-6** entitlement **revocation reaches the client cache** — a churned member's
  browser-held vendor data in IndexedDB must be invalidable; today `CACHE_LOGIC_VERSION` in
  `barsIDB.js` is the only lever over members' devices.
- **R-A6-7** alerting is entitled as **non-display use** — deliver the level and the direction,
  never a live quote.
- **R-A6-8** `/r/*` gets real auth or delayed panels. **R-A6-9** guild locks and app-registration
  defaults must agree. **R-A6-10** member-generated redistribution needs a terms clause.

**⭐ The one constraint that cannot be bought out.** F-04 §3B: *"a route that answers without a
session is not 'member display', it is public redistribution — and a Business-tier Edge Users
carve-out cannot reach an audience that is nobody in particular."* Row T-02 is **R at either
tier**, and §3B's closing paragraph makes authentication *"the one remediation in the register that
makes a contract answer start to work"*. The cost bearing on that row family is **unbounded by
construction**: CTA Exhibit A lets NYSE *"bill for all devices on your network"* where entitlement
cannot be audited.

**INTERPRETATION.** Licensing turns three things from nice-to-have into structural. First,
**audience is a first-class entitlement dimension** — not a synonym for plan, because `public` and
`paid newsletter` are audiences no plan describes. Second, **entitlement must be revocable through
to the client cache**, which makes it a data-lifecycle concern and not only a request-time check.
Third, **provenance must be readable at the decision point**: R-A6-2's chokepoint cannot ask
"whose data is this" unless ARCH-04's R-A4-1 provenance field exists, so this architecture has a
hard dependency on that one.

**RELEVANCE TO UCT.** §3 is shaped by these. In particular the entitlement object carries
`audience` and `dataClasses`, and the third decision point (publication) exists because R-A6-2 says
it must.

**CONFIDENCE.** 🟢 high as a faithful reading of F-04. 🔴 on the underlying contract facts, which
F-04's own ceiling owns and which no agent in this program has seen.

---

## 3. The target architecture for Terminal-Next

*Observations and a proposal. Every number is the owner's (§4).*

### 3.1 One entitlement object, consulted in three places, authored once

**PROPOSAL.** S9 exposes one function and one object:

```
entitlement(session) -> {
  plan,                  # 'free' | 'pro' | … — from subscriptions (existing)
  paid_equiv,            # the derived verdict _access_payload already computes
  toolkit, limits,       # entitlements.TOOLKITS[…] — the four axes (existing)
  dataClasses,           # real-time | delayed-15 | end-of-day | historical (NEW, licensing-driven)
  audience,              # desk | member | community | paid-newsletter | public (NEW, R-A6-2)
  cohorts,               # named dark-launch memberships (NEW, §3.4)
  cadence                # the honest refresh floor (existing, unwired)
}
```

- ⛔ **One object, reused by every surface AND every agent.** `product-architecture.md` S9 and
  synthesis §12.5 state the reason: *"a parallel authorisation path is a second authority over what
  may this member see."* Concretely this means the AI tool registry's per-lane allowlists must
  become **a function of the entitlement**, not per-lane constants (`product-architecture.md`:
  *"the tool registry is the only door into application data … allowlists must become a function of
  the entitlement, S9, not per-lane constants"*).
- ⛔ **It must not collapse the two paid families** (§1.2). `comped` and the 402/403 split are
  deliberate and tested. The object returns a verdict *per data class*; the caller's refusal code
  stays the caller's.
- ⛔ **The client copy is never an authority** (§1.6). `_access_payload` may carry a *rendering*
  hint; the route decides.

**CONFIDENCE.** 🟡 — this is a proposal, and its dependency on ARCH-04's provenance field
(R-A4-1) is real. If provenance does not ship, `dataClasses` and `audience` have nothing to read.

### 3.2 Where a check happens — three points, three different questions

| # | Point | Question | Refusal | Precedent in code |
|---|---|---|---|---|
| 1 | **The route** | *May you be here at all?* | 401 not signed in · 402 plan · 403 role/plan-per-family | `get_current_user`, the 46 `require_paid` definitions, `require_bars_access`, `require_admin` |
| 2 | **The producer** | *How much of it do you get?* | `withheld`, with a reason from a **closed set** | `entitlements.apply_symbol_cap` / `apply_history_cap`; `scan_evaluator`'s coverage line |
| 3 | **The publication chokepoint** | *May this leave the product?* | refuse to publish; fail closed | R-A6-2; the `DESK_PUBLIC_SHOWS` blank-means-nothing idiom |

⛔ **Never the renderer.** `entitlements.py:8-11`: *"A UI that hides rows is not entitlement — the
rows were computed, they held the GIL while a universe sweep ran, and a client can ask for them."*

⛔ **The refusal vocabulary stays closed.** `withheld` ≠ `dropped` ≠ `not_computable`
(`entitlements.py:13-18`), enforced by `ToolkitWithheld.__init__:148-151` raising on an unknown
reason. Any new axis adds its reason token to that set, in one place, or the coverage line that
branches on it silently mis-reports.

⭐ **Point 3 is the one that does not exist yet**, and it is the point licensing actually needs
(R-A6-2, R-A6-3). It is also the cheapest to build on an existing idiom rather than from scratch:
the repo already has fail-closed publication gates whose *default is silence*; they need a second
reason to consult, not a replacement.

### 3.3 Tier boundaries — the axes exist, the numbers are not mine

**What exists** (§1.5): four axes, three of them `None` for everybody, three of four wired.

**What makes a new axis legitimate.** A four-part test, derived from the history ruling
(`entitlements.py:21-73`) rather than invented:

1. It narrows the **question** the member may ask, never the **answer** they get.
   *("Nobody is sold a worse RSI.")*
2. It is applied **where breadth is produced**, never where it is displayed.
3. Its refusal is a **declared outcome** with a token in the closed set — *"your plan stops here"* —
   not a quiet degradation. ⭐ The history axis was kept **as a refusal** precisely because the
   trimming alternative produced a number `pytest.approx` called equal to the honest one.
4. Its number lives in **exactly one table** (`TOOLKITS`), and if it currently equals a capacity
   bound it **references** that bound rather than restating it.

**Candidate Terminal-Next axes — observations, not requirements:**

| candidate | passes the test? | note |
|---|---|---|
| panel / board count, saved-object quota | ✅ count axis, same shape as `max_definitions` | S9 lists saved-object quota as an output; the capacity-vs-entitlement category change applies |
| **data class** (real-time · delayed-15 · EOD) | ✅ narrows the question | ⛔ **licensing-shaped, not product-shaped** — A1 and R-A4-2 may *force* this axis before anyone chooses it as a tier lever; delayed price + real-time volume is the named "load-bearing lever" |
| alert trigger types | ✅ | R-A6-7 makes alerting non-display; the axis is which trigger classes run on which data class |
| refresh cadence | ✅ **already exists, unwired** | ⛔ may only ever RAISE the floor (`refresh_floor_seconds:379-415`) — selling a refresh faster than the store rebuilds *"fails INVISIBLY"* |
| export rights | ✅ | an audience question as much as a plan one (R-A6-2) |
| AI lane budget | 🟡 | the per-user reserve + global USD budget pattern exists (D-10 §7); ⛔ *a per-user cap does not bound the population* |
| indicator/mechanics quality | ❌ **fails test 1** | this is the thing the history ruling forbids |

**CONFIDENCE.** 🟢 on the test (it is a reading of shipped code and its stated reasoning).
🟡 on the candidate list — it is derived from S9's outputs and F-04's rules, and it is not
exhaustive.

### 3.4 How a dark cohort is expressed — a five-rung ladder, four rungs already shipped

| rung | mechanism | exists? | evidence |
|---|---|---|---|
| 0 | **off** — enablement flag unset | ✅ | four flag families default OFF; `auth.py:131-137`, `:205-208`, `:328-355` |
| 1 | **admin** — per-request, role-derived, on the payload | ✅ **NEW since D-10** | `auth.py:214` `_ADMIN_ONLY`, resolved `:253-263`, spread `:375`; `COMPASS_MENTOR_MODE` is the older precedent |
| 2 | **named cohort** | 🔴 **ABSENT** | §2.1 — the store and the admin UI exist; no gate reads them |
| 3 | **percentage** | ⚠️ browsers, not users | `BARS_PUSH_ROLLOUT_PCT` buckets a browser via `localStorage`; fine for a render canary, **never** an entitlement |
| 4 | **everyone** | ✅ | flag set to a truthy value |

**⭐ Rung 1 is the finding worth acting on.** `_breadth_dc_flags(is_admin=is_admin)` ships an
owner-preview rung whose own docstring states both halves of why it matters:
*"`admin` IS THE OWNER PREVIEW, and it is the reason a build-time flag could not do this job at
all: one bundle cannot be on for one member and off for the rest"*, and
*"⛔⛔ `admin` MUST READ FALSE FOR A MEMBER. That is the whole safety property, and it is the ONLY
direction of this flag that can cost anything"* (`auth.py:237-246`), with the rail named and
mutation-proved. It also fails closed by construction: `is_admin` **defaults to `False`** so
*"a call site that forgets to pass the role sees what a member sees"* (`:248-250`).
Terminal-Next's first dark rung therefore costs one env value, `admin`, and no new code.

**How to build rung 2, in the shape the repo already argues for** (D-10 §5.3, re-verified §2.1):

1. one helper, `has_tag(user_id, tag) -> bool`, over the existing `get_user_tags` query
   (`auth_service.py:840`);
2. one dependency **beside** `require_paid`, following `limits_dependency`'s stated rule —
   *"A SECOND dependency beside `require_paid`, NEVER A REPLACEMENT FOR IT"*
   (`entitlements.py:296-301`) — so one 402 keeps meaning one thing;
3. one field on `_access_payload` (e.g. `"cohorts": ["terminal-next"]`), because that payload is
   the house channel and `/api/flags` is a struck decision (§1.3);
4. one master kill switch named `TERMINAL_NEXT_ENABLED` so the AST flag index and
   `tests/test_feature_flag_ledger.py` cover it (D-10 §1.2, §2.3 — a name without
   `ENABLED`/`DISABLE`/`_ON` is invisible to the only inventory that exists).

⛔ **Never `user_preferences`** — the member writes their own (§2.1), so an entitlement stored
there is self-grantable.
⛔ **One implementation, not a third.** `COMPASS_MENTOR_MODE`'s cohort logic is implemented
**twice** (D-10 §5.1, `voice.py` and `coach_chat.py`, each claiming to "mirror" the other). If a
shared helper lands, both copies read it — otherwise the codebase acquires a third cohort
mechanism beside two copies of a second one.
⛔ **Pair the boolean and the cohort.** Ship `TERMINAL_NEXT_ENABLED` (ledger-visible master kill
switch) *plus* the cohort, exactly as `COMPASS_MENTOR_MODE` + `COMPASS_MENTOR_BETA_EMAILS` already
does — the kill switch is what a responder pulls, and it must be inside the one inventory with a
rail.

**⚠️ What a flip actually reaches, stated because it bounds the design.** CLAUDE.md carries the
owner ruling verbatim: *"a flip reaches a member on their next authenticated request or reload; it
does not reach a tab mid-session … If the auth payload is unreachable, the wave stays ON — the
switch kills a decision, not an outage."* And the client **latches** the answer for the tab's
lifetime, deliberately, so a tab that has decided it may write never sees the answer change between
a request going out and its ack coming back. A dark cohort is therefore **not** an instant
close-down on an open tab, and any rollback plan that assumes otherwise is wrong.

**⚠️ And the ledger is the artifact most likely to be stale.** CLAUDE.md records the incident:
`RESEARCH_TECHNICAL_TAB_ENABLED` was flipped ON and verified in-process while its
`docs/feature_flags.json` entry kept the merge-time `dark` state for a day, after which two readers
disagreed about whether the surface was live. *"The ledger records INTENT and cannot see Railway;
the checkpoint records WHAT HAPPENED."* Any Terminal-Next cohort flip updates the ledger in the
same push that records the flip time.

### 3.5 The decision points

| # | Decision | Owner | Blocks | Recorded where |
|---|---|---|---|---|
| **DP-1** | Are the open-by-design routes (`/api/flow-scoreboard`, `/r/*`) to stay open? | **Owner** | nothing in Terminal-Next — A5 holds either way | `OWNER_DECISIONS.md` (ESC-06, ESC-13, OI-17) |
| **DP-2** | Tier count, names, prices, and every number in `TOOLKITS` | **Owner (S9 / D5 / OI-03, OI-12)** | the numbers only; the mechanism ships with `"all"` | `OWNER_DECISIONS.md`; then `entitlements.TOOLKITS` |
| **DP-3** | Does the beta cohort need to be **durable per-user** (a tag, admin-editable, auditable) or **ephemeral per-deploy** (an env allowlist)? | **Owner** | the rung-2 build; the two answers produce different beta operations | D-10 §5.3's open question, unanswered |
| **DP-4** | Is a **runtime** kill switch required (persisted, admin-toggled, no restart), or is deploy/restart-coupled rollback acceptable? | **Owner** | nothing — but note the only runtime switch today is maintenance mode, which kills everything and resets on every redeploy (D-10 §6) | — |
| **DP-5** | Does a staff tier finer than `admin` exist (support, read-only desk, contractor)? | **Owner** | any demote/scope work; today admin ⇒ paid-equivalent and there is no demote path (§1.4) | — |
| **DP-6** | Widen `auth_surface_check` to GETs | **Engineering** — no owner input needed | nothing; it is additive and fails closed | §3.6 |
| **DP-7** | Which data class each member surface may reach (real-time / delayed-15 / EOD) | **Owner + licensing** (A1, D-002, ESC-01/02) | the `dataClasses` axis; possibly the product shape | F-04 §1, §4.1 |
| **DP-8** | Whether provenance (R-A4-1) ships | **ARCH-04** | R-A6-2's chokepoint cannot ask "whose data is this" without it | F-04 §4.2 |

### 3.6 The rail, not the fix — the one engineering change this document argues for

**PROPOSAL.** Widen `api/auth_surface_check.py` to audit **read** routes, on the existing design,
and let it fail **by name** at boot.

- The aperture is one set: `MUTATING` at `:79`, consumed at `:248`. Reads need their own pass with
  its own allowlist, because a read allowlist will be longer and its entries need reasons.
- Reuse `ALLOWED_OPEN`'s shape exactly (`:118`): an exact `(method, path)` key → a **written
  reason**. The file already distinguishes *"checked and safe for a stated reason"* from *"open"*
  (`:41-43`); that distinction is the entire value.
- Reuse the delegation bucket for proxied flow routes (`:313`, `:350`) and its rule —
  *"A delegation nobody can fail would be a suppression with better manners."*
- ⛔ **It must be able to fire.** The repo's own standing rules apply: a guard nobody has seen fire
  is not a guard, and a rail needs a non-vacuity control proving the probe can see a sibling it is
  not looking for (CLAUDE.md, "An empty result is a failed invocation until proven otherwise";
  `tests/test_desk_session_audit.py` is the house example of the control idiom).
- ⛔ **It reads the mounted route objects, never a probe.** The auditor's own docstring records why:
  a probe of a mutating endpoint once executed a real production job before anyone intended it.

**Why a rail and not four fixes.** The GEX family was remediated once (`admin_guard.py`), recurred
(§2.2's X-09), was remediated again at `/api/gex/data` — and `/api/gex/compare`, four lines below
it in the same file, is still open. **A class that recurs after remediation is not a bug that
needs fixing again; it is a missing check.** F-04 R-A6-1 says so in those words, and this document's
own §2.2 is the third data point.

⚠️ **This is a Terminal-Next architecture requirement, and the four open routes in §2.2 are a
production matter for a normal engineering session** — not this program's to change (R-17's own
mitigation column says exactly that).

---

## 4. ⛔ What this document does NOT decide

**Read this section before quoting anything above as a decision.**

1. **⛔ Tiers, plans, prices, packaging and every number in `TOOLKITS` are an OWNER BUSINESS
   DECISION and are NOT mine to rule.** S9's own ownership boundary says the tier *numbers* are
   owner-bound (`product-architecture.md`, S9 → "Must NOT own"); `capability-infrastructure-matrix.md`
   row S9 says *"the tier numbers themselves are explicitly owner-bound"*; and `TOOLKITS`
   (`entitlements.py:226-240`) carries `# OWNER: §8.4` / `§8.5` against the three `None`s with
   `docs/decisions/2026-08-08-toolkit-gating-axes.md` still **🟡 OPEN**. This document describes
   **the mechanism, the axes, and the test a legitimate axis must pass**. It proposes no tier, no
   price, no plan name, no free-tier answer, and no allocation of any feature to any plan.
   **DP-2 is the owner's.**
2. **It does not decide whether the open-by-design routes stay open.** `/api/flow-scoreboard` and
   `/r/*` are ESC-13 and ESC-06 — owner calls, each with a cost written down. A5 holds for
   Terminal-Next under either answer, which is why this document can be written without them.
3. **It does not close R-17.** It reports a source read and names the measurement that would close
   it (m2). Reporting the routes as fixed on this evidence would be the exact defect class this
   program keeps recording.
4. **It does not classify any data use.** F-04 owns every licensing classification; §2.3 is a
   reading of F-04, not a second authority over it. Where the two ever disagree, F-04 governs.
5. **It does not change production.** No route was edited, no flag flipped, no variable set, no
   probe run. The four open routes in §2.2 are reported for a normal engineering session.
6. **It does not decide who holds admin, or whether anyone should be demoted.** That needs one read
   of production `auth.db`, which this program does not do (§1.4).
7. **It does not rule on cohort durability** (DP-3) or on whether a runtime kill switch is required
   (DP-4). Both change beta *operations*, not architecture, and both are the owner's.
8. **It does not specify ARCH-04's provenance field**, which it depends on (DP-8), or ARCH-05's
   prompt-eligibility check. It states the dependency and stops.

---

## GAPS

- **No probe, and that is the whole of R-17's ceiling.** Every "gated" claim in §2.2 is a source
  read. **Measurement m2:** one read-only, browser-UA, no-mutation GET per route in the §2.2 table
  against the live origin, recording status and whether a body came back. That is what closes or
  re-opens R-17, and it is one short session's work.
- **No SHA, no branch comparison.** This contract forbids git, so I could not read the worktree's
  HEAD, could not establish whether it is an ancestor of `origin/production`, and `web` deploys
  from `production`. **Everything in §1 and §2.2 is "master as checked out on 2026-09-25".**
- **The route sweep is file-derived, not app-derived.** I read the files F-04 §3B named plus
  neighbours found while reading them. Importing `api.main:app` and walking `app.routes` — the
  technique the 2026-08-09 reachability audit used for 986 routes — would make the list exhaustive.
  Until then, **a route absent from §2.2 is unexamined, not safe.**
- **Middleware coverage not enumerated.** `auth_surface_check.middleware_guarded_prefixes(app)`
  exists (`:198`) and its population was never read, so a GET I report as dependency-less could in
  principle be covered by a prefix. This cuts only one way (it could make §2.2 pessimistic); it
  cannot make a gated route ungated.
- **Body-level inline checks not read.** `/api/breadth-monitor/live-diag`, `/live/reconcile`,
  `/api/dealer-positioning/*` and `/api/gex/compare` take `request: Request` or bare params; I read
  signatures, not handler bodies. The repo has an established inline-check idiom
  (`_check_admin_auth(request)` as a first statement, per D-10 §4.4), so **"no `Depends`" is not
  the same as "no check"** for those four. Reading four function bodies settles it.
- **No test executed.** Every named rail (`tests/test_hub_preview_flag.py`,
  `test_feature_flag_ledger.py`, `test_the_two_paid_gate_families_DISAGREE_about_comped`,
  `test_admin_means_ADMIN_ONLY_and_a_member_sees_OFF`) was read about or read, never run.
- **Production `auth.db` never opened.** The admin roster, the `comped` population, and whether any
  `user_tags` row exists are all **NOT DETERMINED**. Note that `C:\data\auth.db` on the dev box is
  *not* production (CLAUDE.md: 26 production users vs ~20,640 locally) — sizing anything off the
  wrong one is a recorded hazard.
- **`require_paid`'s per-router rail inherited, not verified.** D-10 §8 names it; I counted the 46
  definitions but did not read the test.
- **TOTP enrolment policy not established.** D-10 GAPS records the same; whether admins are
  *required* to hold TOTP is unknown, and it bears directly on §1.4's grant path.
- **The referral system and Stripe's plan-minting path** were not read. D-10 notes `premium` and
  `lifetime` are in `PAID_PLANS` while the Stripe path writes only `"pro"` — a live open question
  about dead entitlement strings that this document did not re-measure.
- **Cohort-flip audit trail is best-effort.** D-10 §6 measured `log_activity` wrapping its whole
  insert in `try/except` that prints and continues — so it is a convenience log, not a compliance
  record. If a cohort grant must be *provable*, that changes.

## NOT INSPECTED

- **Railway** — the only authority on which flags are actually set, and on each service's watch
  paths. No `railway` command was run (contract).
- **The live origin** — no HTTP call of any kind.
- **Cloudflare** — the WAF, bot rules and Access policies that sit in front of every gate discussed
  here. Out of reach, and materially relevant: a rule there could mask or worsen §2.2.
- **Stripe** — which price ids exist, whether `premium`/`lifetime` were ever sold.
- **Partner-owned routers** beyond the signatures in §2.2 (`live_massive_router.py`,
  `schwab_router.py`, `massive_ws_worker.py`). Per the program preamble, described no further.
- **`api/flow_proxy.py`'s HMAC vouch path** — F-04 §3B excludes the proxied flow routes from its
  table on the grounds that they are proxy-vouched; I did not verify the vouch.
- **The `/r/*` out-of-repo consumers** (the wire's Playwright, the Sunday Scan PNG renderer, the
  chart-renderer service) — F-04 R-A6-8 notes all three are UCT's own, which is what makes real
  auth on `/r/*` feasible rather than breaking. Not verified here.

## SOURCES

**Program inputs (read).** D-10 `01-existing-system/flags-and-entitlements.md` (in full) ·
F-04 `09-security-licensing-cost/licensing-register.md` §0 addendum, §3B, §3D, §4.1, §4.4 ·
R-17 in `00-program-control/RISK_REGISTER.md` · `MASTER_CHECKLIST.md` item 23 ·
`AGENT_REGISTRY.md:162` (ARCH-06) · `OWNER_DECISIONS.md` D-002 · S9 in
`05-product-strategy/product-architecture.md` · row S9 in `capability-infrastructure-matrix.md` ·
house style from D-06 `07-technical-architecture/current-ui-architecture.md` and C5-03
`06-ux-and-information-architecture/fixed-modular-hybrid.md`.

**Source measured in `_merge-master`, 2026-09-25.** `api/middleware/auth_middleware.py` (full) ·
`api/services/entitlements.py` (full) · `api/routers/auth.py` (§§107-264, 267-403, 2272-2278) ·
`api/bars_auth.py:88-113` · `api/auth_surface_check.py` (structure + `:41-43`, `:70`, `:79`, `:118`,
`:198`, `:225`, `:248-252`, `:313`, `:350`) · `api/services/auth_db.py` (users schema, `:185-193`,
`:567-585`) · `api/services/auth_service.py:336, 811, 826, 840` ·
`api/routers/{live_prices,snapshot,movers,bars,stream,breadth_monitor}.py` ·
`api/gex_router.py` · `api/dealer_positioning_router.py` · `api/flow_scoreboard.py` ·
`api/routers/render_panels.py:1-9` · `app/src/context/AuthContext.jsx:275, 294-301` ·
`app/src/constants/freePages.js` · `_merge-master:CLAUDE.md` (Auth & User System;
`HUB_PREVIEW_ENABLED`; the smoke account; "Rolling back the Notebook wave"; the flag-ledger
staleness incident).

**Commands run** (so a reader can re-derive rather than trust): `grep -rn "def require_paid" api/`
· `grep -rn "limits_dependency" api/` · `grep -rn "/api/flags\|'/config'" api/routers/ api/*.py` ·
`grep -n toolkit api/services/auth_db.py` · `grep -rn FREE_PAGES app/src/`.
