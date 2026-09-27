---
id: PACKET-AE
title: RG-40 — `GET /api/voice/risk-dashboard` is a fully-built, still-live backend endpoint whose ONLY frontend consumer was deliberately deleted 4 months ago — retire the backend, or build it a real UI? — decision gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET AE — an orphaned risk-officer readout: retire the door, or rebuild it?

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-23
APPROVED AT SHA:  d56a02db8
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this finding.
> **Non-collision:** grepped fresh, twice — once at investigation start and again
> immediately before this commit — for `packet-a[a-z]-` across
> `docs/terminal-research/12-decisions/gates/**` and `.scopes/**` in
> `terminal-research`, and the entire `s7-price-level` worktree. Highest claimed
> double-letter on disk is `packet-ac-` (`RG-37`). A sibling agent is concurrently
> drafting `packet-ad-`. `packet-ae-` appears nowhere in either worktree; this
> packet claims it.

⛔ **ZERO PRODUCT CODE.** This packet is a decision request. No file under `api/**`
or `app/**` has been edited to produce it. Whichever option the owner signs below,
the **approved build scope is CP1 only** — the narrow action named in that option,
nothing broader.

---

## 1 · The finding, re-verified fresh against current source (2026-09-22)

`GET /api/voice/risk-dashboard` (`api/routers/voice.py:346-351`,
`risk_dashboard_get`) is live, mounted, and reachable today:

```python
@router.get("/risk-dashboard")
def risk_dashboard_get(user: dict = Depends(requires_voice_access)):
    """Compose the Risk Dashboard payload for the user — total heat,
    by-symbol, by-sector, recent refusals, account settings."""
    from api.services.voice_position_sizing import get_risk_dashboard
    return get_risk_dashboard(user["id"])
```

`requires_voice_access` (`api/middleware/auth_middleware.py:101-110`) passes any
**admin, any of the three paid plans (`pro`/`premium`/`lifetime`), or anyone
inside a full-access trial** — so any paid, trial, or admin member can hit this
route directly today (curl, a saved bookmark, a browser devtools fetch) and get
back real, current portfolio-risk numbers computed from their own open
positions.

`voice_position_sizing.get_risk_dashboard()` (`api/services/voice_position_sizing.py:193-277`)
— its own docstring says **"Used by the Risk Dashboard UI panel to visualize the
position-sizing engine state."** That panel does not exist. Confirmed by
`git log --follow` on the file it once fed:

| Commit | Date | What it did |
|---|---|---|
| `c2da811c1` | 2026-05-12 | **Added** `app/src/pages/RiskDashboard.jsx` — "New /risk page that visualizes the position-sizing engine state — the same data Compass's Risk Officer mandate uses to approve or refuse trades." Own commit message: *"7/7 tests in `tests/test_risk_dashboard.py`"* |
| `709f4407a` | 2026-05-25 | **Route dropped** — commit `feat(access): restrict free tier to 6 pages, drop Risk tab`: "Removes /risk route + RiskDashboard import + nav entry (sidebar). The RiskDashboard.jsx component file is retained but no longer reachable." A deliberate product decision (narrowing the free tier to 6 pages), not an accident — the diff shows the route, the lazy import, and the sidebar entry all removed together in one commit, alongside `FREE_PAGES` narrowing in `AuthGuard.jsx`/`MobileNav.jsx`/`NavBar.jsx` |
| `d26cee0c0` | 2026-08-09 | **File deleted** — `chore(dead-code): delete 37 unreachable frontend modules`, with the sweep's own note: *"RiskDashboard: the Risk tab was deliberately dropped in 709f4407."* `RiskDashboard.jsx` (264 lines) + `RiskDashboard.module.css` (278 lines) removed |

The deleted component's own header comment (read from the pre-delete blob,
`git show d26cee0c0~1:app/src/pages/RiskDashboard.jsx`) confirms exactly what it
rendered: headline portfolio heat % with a cap line, open-position count + total
dollar risk, by-symbol concentration bars, by-sector concentration bars, recent
`validate_trade` refusals, and the account's caps (size / max risk per trade /
heat cap / sector cap).

**The backend was never cleaned up alongside the frontend retirement.** Today:

- `get_risk_dashboard` has **exactly one call site in the whole repo** — the
  orphaned route (fresh grep, `api/**`). It is not registered as a voice tool or
  a chat tool anywhere (`voice_tool_impls.py`, `coach_chat_tools.py`,
  `voice_agents.py` — none of them reference it).
- **Zero frontend callers anywhere in `app/src`** (fresh case-insensitive grep
  for `risk-dashboard`/`risk_dashboard`/`riskDashboard` — the two Python files
  above are the only matches in the whole checkout).
- `tests/test_risk_dashboard.py` (the "7/7" from the original commit) still
  exists and still exercises the function directly — it is not a rail on a
  reachable surface, it is a rail on an orphan.
- The route still runs the real computation, against the member's real open
  positions, on every hit.

---

## 2 · The load-bearing question: does `portfolio_heat.py` already cover this? (Rung-4/5 mentor, CLAUDE.md)

This is the single most important thing this packet has to get right, so it is
answered from both files read in full, not from either file's own claims about
itself.

### What `get_risk_dashboard` actually computes (`voice_position_sizing.py:100-277`)

| Field | Source | Note |
|---|---|---|
| `account_size`, `max_risk_per_trade_pct` | `_get_account_settings` → `j2_accounts` settings, default $25,000 / 1% | |
| `portfolio_heat_cap_pct` | `max_risk_pct × 3.0` | a **static multiple of the per-trade setting** — comment says "mirror validate_trade rule 3" |
| `max_sector_concentration_pct` | `max_risk_pct × 2.5` | same idea — "mirror validate_trade rule 5" — but **never actually checked against anything**; it is a number in the payload, no sector is flagged for breaching it |
| `total_risk_dollars`, `portfolio_heat_pct` | `_current_portfolio_risk` — sums `shares × abs(entry − stop)` over every open position | **no placeholder-stop handling at all** — see below |
| `by_symbol` / `by_sector` (top 6 each) | same sum, grouped | dollar + pct only, no breach flag |
| `recent_refusals` (last 10) | live `SELECT … FROM voice_tool_calls WHERE tool_name='validate_trade' AND ok=0` | a real, currently-written table (confirmed: `validate_trade` is actively called from the mentor's add-trade gate, `voice_agents.py:173`, `voice_prompts/compass.py:181`) |

### What `portfolio_heat.py` actually computes (`api/services/portfolio_heat.py`, full file read)

Already-shipped, already-live, documented at length in `CLAUDE.md` under
"Rung-4/5 mentor — multi-name + portfolio verdicts":

| Field | Source | Note |
|---|---|---|
| `risk_heat_pct` | same underlying idea (`Σ shares×(entry−stop)` / account) | vs a **dynamic** aggregate cap read from `brain_service.aggregate_heat_cap_pct()` (10% Desjardins default, fail-soft), not a static per-trade-setting multiple |
| `notional_exposure_pct` | `Σ shares×entry` / account | **has no counterpart in `get_risk_dashboard` at all** — checked against a `_regime_ceiling_pct()` that scales 20%→100% with the live UCT Exposure Rating |
| `per_position[]` | side, `dist_to_stop_pct`, `placeholder_stop` flag | per-position detail `get_risk_dashboard` does not return |
| `by_symbol` / `by_sector` | same shape, same source (`journal_two.positions`) | |
| `concentration_flags[]` | sectors where `sector_risk / real_risk > 0.40` | an **actual breach flag** — `get_risk_dashboard` only ever returns a raw top-6 list, never flags one |
| `placeholder_stops[]` + exclusion | `is_placeholder_stop(stop, entry)` (`api/services/placeholder_stop.py`) excludes broker-imported no-real-stop positions from the confident heat number and separately names them | **`get_risk_dashboard` has none of this** — see below, this is the material gap |
| `room_to_add_pct`, `sources[]` | derived | |

### The one material, safety-relevant difference — and it runs the WRONG way for reviving the old code

`_current_portfolio_risk` (the function `get_risk_dashboard` depends on) computes
`risk_per_share = abs(float(entry) - float(stop))` for **every** open position
with **no placeholder-stop check whatsoever**. `portfolio_heat.py`'s own
in-file comment calls this exact failure mode SAFETY-CRITICAL:

> "counting them 0-risk under-reports heat → would green-light an over-cap add"

A broker-imported position with no real stop stores `stop_price == entry_price`
(`CLAUDE.md`, Broker Sync section: *"`j2_positions.stop_price`/`entry_date` are
NOT NULL → broker imports store placeholders"*). Under `get_risk_dashboard`'s
math that position contributes **exactly zero** to `total_risk_dollars` and
`portfolio_heat_pct` — silently under-reporting a member's real exposure.
`portfolio_heat.py` was built specifically to close this hole
(`is_placeholder_stop`, tolerance-based, not exact-equality — its own header
comment documents an earlier, narrower version of this exact guard that itself
had to be widened after a real drifted-float row slipped past it). **Reviving
`get_risk_dashboard`'s computation as a UI today would reintroduce a bug the
mentor initiative had already found and fixed months earlier**, under a
different name, in a different file.

### `portfolio_heat.py` already has a real, live, paid-gated member door — shipped yesterday

This is decisive and was not something to assume — it was read from source.
`api/routers/portfolio_heat.py` (own header: *"A14 CP1
(GATE-A14-PORTFOLIO-HEAT-CP1, signed 2026-09-21, fingerprint `417b6b853`) — the
first member-facing door on `portfolio_heat.py`."*) mounts
`GET /api/portfolio/heat`, paid-gated (`require_paid`, its own 402), as a
**plain pass-through** — "no new parameter, no change to `portfolio_heat()`'s
signature or return shape, no new computation." `app/src/pages/PortfolioHeat.jsx`
(172 lines, live route `/portfolio-heat`, nav entry "Portfolio Risk" per
`CLAUDE.md`'s generated nav table, added 2026-09-21) renders exactly that
payload: heat vs cap bar, notional vs regime-ceiling bar, by-symbol / by-sector
breakdown, concentration flags, placeholder-stop callouts. Its own header
comment: *"a plain renderer over `GET /api/portfolio/heat`'s own fields. No new
computation, no field invented."*

**So the product question this packet was filed to answer — "should a member be
able to see their portfolio risk on a real page" — was already asked and
answered, one day before this finding was filed, for the newer and safer
computation.** A member who wants exactly what the deleted `RiskDashboard.jsx`
promised (headline heat, by-symbol/by-sector bars, cap lines) already has it
today at `/portfolio-heat`, computed off the code path without the
placeholder-stop bug.

### What is genuinely NOT covered by `portfolio_heat.py`

One thing, and only one: **`recent_refusals`** — a chronological list of the
member's own last 10 `validate_trade` refusals, with `refusal_basis` and
`reason`, sourced from the real, currently-populated `voice_tool_calls` table.
`portfolio_heat.py` is a pure state read (its own docstring: *"structural STATE
read, NO GO-path"*) and has no analogue — it does not look at history, only the
current book. Nothing else in the product surfaces "why did Compass refuse my
last trade" as a list (fresh grep across `app/src` for any UI reading
`recent_refusals`/`refusal_basis`/`voice_tool_calls`: nothing, aside from the
false-positive noise of unrelated `*Refusal*` test/component names — e.g.
`IndicatorAlertPopover.refusals.test.jsx`, `pine.refusalAuthority.test.js` —
that share the word but not the subject).

---

## 3 · Option A — Retire

Delete the backend endpoint + service function, following this repo's
established DOCUMENTED-BUT-UNREACHABLE retirement idiom (`CLAUDE.md`'s own
`⚰️ DOCUMENTED BUT UNREACHABLE` table is the precedent: record what it was, why
it's gone, what superseded it — never a silent deletion).

**What actually has to change:**

- `api/routers/voice.py:346-351` — delete `risk_dashboard_get` and its route
  decorator.
- `api/services/voice_position_sizing.py:193-277` — delete `get_risk_dashboard`
  (and its now-dead helpers `_get_account_settings` / `_current_portfolio_risk`
  / `_sectors_for_symbol` **only if nothing else calls them** — they must be
  re-checked for other callers before deletion, since `_get_account_settings`'s
  name suggests it could be reused elsewhere; a quick grep at build time, not
  assumed here).
- `tests/test_risk_dashboard.py` — delete (it tests only the removed function).
- One line in `CLAUDE.md`'s `⚰️ DOCUMENTED BUT UNREACHABLE` table recording: what
  it was, the three commits above, and that `portfolio_heat.py` + `/portfolio-heat`
  (A14 CP1) is what a member gets instead.

**Is this safe?** Yes, cleanly: the endpoint has one caller (nothing), the
function has one caller (the endpoint), and the deleted computation was already
demonstrated to under-report risk relative to the code path that superseded it
in practice. No migration, no stored data, no other surface depends on either
symbol.

**The one loss:** the `recent_refusals` feature (§2) has no home anywhere else
in the product. Retiring cleanly loses it, not just its old UI.

---

## 4 · Option B — Revive: build a real, current UI consumer

Only sensible if §2 had found `get_risk_dashboard` computed something material
that `portfolio_heat.py` does not. It found exactly one such thing —
`recent_refusals` — and that one thing is narrow enough that a full revival is
disproportionate to it.

**What a revival would actually require, to be worth doing at all:**

- The `_current_portfolio_risk` heat computation would need the SAME
  placeholder-stop fix `portfolio_heat.py` already has, or it ships a page that
  under-reports risk for every member with a broker-imported no-stop position —
  reintroducing a bug the mentor initiative already closed elsewhere.
- The static `× 3.0` / `× 2.5` cap multiples would need reconciling against
  `portfolio_heat.py`'s dynamic `brain_service.aggregate_heat_cap_pct()` +
  regime-ceiling model, or the app would show a member **two different heat
  caps on two different pages** for the same account — the exact
  two-authorities-over-one-value shape this repo's own `CLAUDE.md` names
  repeatedly as a defect class (see Packet W, same worktree, for the identical
  reasoning applied to a "regime" vocabulary collision).
- Realistically, the only piece worth reviving is `recent_refusals` — which
  could instead be added as a small section on the ALREADY-LIVE
  `/portfolio-heat` page, reading straight from `voice_tool_calls` (as
  `get_risk_dashboard` already does), with **zero** re-derivation of heat/caps/
  concentration that page already gets correctly from `portfolio_heat.py`.
  That is a materially smaller, safer change than resurrecting the whole
  orphaned endpoint and its own separate risk-math implementation.

**If B is chosen, this packet's recommendation (§5) is that "B" should mean the
narrow addition described in the previous paragraph — not a restoration of
`get_risk_dashboard`'s own computation.** The CHOOSE line in §6 governs which of
these the owner intends; the checkpoint table in §7 is scoped to whichever is
signed.

---

## 5 · Recommendation

**Option A (retire).** Grounded in what was read, not preference:

- The product need `RiskDashboard.jsx` and `get_risk_dashboard` were built to
  serve — "let a member see their own portfolio risk" — already has a live,
  current, paid-gated answer at `/portfolio-heat`, shipped 2026-09-21
  (`GATE-A14-PORTFOLIO-HEAT-CP1`), one day before this finding, computed off
  `portfolio_heat.py`.
- `portfolio_heat.py` covers the SAME core ground more completely (notional
  exposure vs. regime ceiling, actual concentration-breach flags, per-position
  detail) and more SAFELY (placeholder-stop detection `get_risk_dashboard`'s
  computation never had).
- The one feature genuinely unique to the orphan — `recent_refusals` — is real
  and additive, but narrow enough that it does not justify reviving a whole
  second risk-computation surface; it is better added as a small section on the
  page that already exists, in a follow-up this packet does not scope.
- Reviving the orphan's OWN math as a UI would ship a page that quietly
  under-reports heat for every member with a broker-imported placeholder stop —
  a regression relative to what `/portfolio-heat` already gets right today.

**A third option is not warranted.** The gap this packet found (`recent_refusals`)
is real but small enough that "leave it out of scope, note it as a candidate
follow-up" is more honest than manufacturing a third checkbox for one field.

---

## 6 · The decision

```
CHOOSE ONE:

  A) RETIRE — delete GET /api/voice/risk-dashboard, delete
     voice_position_sizing.get_risk_dashboard() (and its now-orphaned private
     helpers, re-checked for other callers first), delete
     tests/test_risk_dashboard.py, and record the retirement in CLAUDE.md's
     "DOCUMENTED BUT UNREACHABLE" table naming portfolio_heat.py +
     /portfolio-heat (A14 CP1) as what a member gets instead. The
     recent_refusals feature is NOT carried forward under this option.

  B) REVIVE (NARROW) — add a "Recent refusals" section to the ALREADY-LIVE
     /portfolio-heat page, reading the last 10 validate_trade refusals from
     voice_tool_calls (the same read get_risk_dashboard already does), with NO
     new heat/cap/concentration computation — that page keeps reading
     portfolio_heat.py for everything it already gets right. The orphaned
     endpoint, its function, and its own heat math are retired exactly as in
     Option A; only the refusal-history read is carried forward, relocated.

CHOOSE: A
```

**Decided 2026-09-23, by the owner, in chat: "A retire."** Matches §5's
recommendation.

---

## 7 · Proposed checkpoint — CP1 only, narrow either way

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | Whichever option is signed above, and nothing else. **If A:** delete `risk_dashboard_get` (`api/routers/voice.py:346-351`), delete `get_risk_dashboard` and any private helper proven to have no other caller (`api/services/voice_position_sizing.py`), delete `tests/test_risk_dashboard.py`, add one row to `CLAUDE.md`'s DOCUMENTED-BUT-UNREACHABLE table. **If B:** add a read-only "Recent refusals" section to `app/src/pages/PortfolioHeat.jsx`, backed by a new thin read (reusing the exact `voice_tool_calls` query already written in `get_risk_dashboard`, relocated rather than re-derived) exposed on the existing `/api/portfolio/heat` response or a small sibling endpoint on the same router; THEN delete the orphaned `/api/voice/risk-dashboard` route, `get_risk_dashboard`, and its now-superseded heat-computation helpers exactly as in Option A (the refusal read is relocated, not the whole function kept alive). | none | **S** |

### Explicitly OUT of CP1, either way

- No change to `portfolio_heat.py` itself — it is correct and live; this packet
  is entirely about the orphan, not its already-shipped replacement.
- No reconciliation of `validate_trade`'s own cap math (`× 3.0` / `× 2.5`
  multiples) against `portfolio_heat.py`'s dynamic cap model — a separate,
  larger decision if the two are ever found to disagree in a way that matters.
- No change to `j2_accounts` settings, `voice_tool_calls` schema, or any stored
  data.
- Under B: no revival of `get_risk_dashboard`'s own placeholder-stop-unsafe heat
  computation in any form — the relocated feature is refusal history only.

### Risk

**Low, under either option.** Option A is a pure deletion of unreachable code
with one call site each; nothing else in the repo depends on either symbol
(verified by grep, not assumed). Option B's risk is confined to one small,
additive, read-only section on an already-shipped page, reusing an
already-written query verbatim — it does not touch `portfolio_heat.py`'s
computation or its cap model.

### MUST-BUILD, exactly (populated once §6 is signed — not before)

Left unwritten on purpose: writing implementation steps for an unsigned
decision would itself be scope creep past CP1. Whichever letter is chosen, the
next step is a short MUST-BUILD list scoped to that letter's row in §7's table
above — nothing broader.
