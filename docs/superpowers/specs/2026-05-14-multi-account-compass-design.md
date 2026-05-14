# Multi-Account Compass — Design Spec

**Date:** 2026-05-14
**Status:** Draft (awaiting user approval before plan)
**Owner:** Compass coaching layer

## Problem

Compass today is per-account. Each `j2_accounts` row has its own `trader_profile`, weekly reviews, EOD recaps, chat history, and `compass_enabled` toggle. The J2 header has an account selector with a "All Accounts" mode (`accountId = null`), but in that mode `CompassTab` short-circuits to:

> Select a single account to view Compass reviews.

A trader with multiple accounts (e.g. Default + a separate cash account) cannot get coaching that spans their portfolio. They have to inspect each account's coach independently, and there's no place where Compass reasons about the trader as one person.

## Goal

Add a **unified coaching identity** that activates when the J2 header selector is on **All Accounts**. The unified coach reads trades, positions, and discipline events from every account that the user has opted in (via the existing `compass_enabled` toggle), maintains its own trader profile + review/recap history, and behaves as a single coach across the portfolio. Per-account coaches continue to work unchanged.

## Non-goals (v1)

- **No data migration.** Existing per-account artifacts stay where they are. Unified mode starts empty.
- **No unified onboarding flow.** The user seeds the unified trader profile manually for v1 (or via a one-click "import from \<account\>" affordance — see "Open questions").
- **No unified email digest.** Per-account weekly Compass emails keep firing as today; v1 does not add a portfolio-level email.
- **No unification of pre-trade verdict / per-trade post-mortem / interventions.** These remain per-account in v1 (a position belongs to one account; the verdict consults *that* account's risk caps). The unified trader profile may still be injected as context.
- **No cross-account discipline rules in v1.** Tilt detection and cooling-off remain per-account.

## Design

### Account-id convention

| Value                | Meaning                                                                |
|----------------------|------------------------------------------------------------------------|
| real UUID (`acc_…`)  | Per-account coach. Same behavior as today.                             |
| literal `'_all_'`    | Unified coach. Reads from all `compass_enabled` accounts.              |

`'_all_'` already exists as the localStorage sentinel for "All Accounts" in `useJ2SelectedAccount.js` (`STORAGE_KEY = 'uct.j2.selectedAccountId'`, `ALL_ACCOUNTS = '_all_'`). The frontend currently maps the sentinel back to `null` for hook consumers. After this change, Compass hooks and endpoints accept `'_all_'` as a first-class account id; everything else (positions, trades, calendar, etc.) keeps treating it as "All Accounts" for filtering.

### Schema

One new table, no migration of existing rows.

```sql
CREATE TABLE IF NOT EXISTS j2_unified_coach_state (
  user_id          TEXT PRIMARY KEY,
  trader_profile   TEXT NOT NULL DEFAULT '',
  compass_enabled  INTEGER NOT NULL DEFAULT 1,
  onboarded        INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

Existing tables — `j2_coach_reviews`, `j2_eod_recaps`, `j2_chat_messages`, `j2_profile_suggestions`, `j2_verdicts` (latter unused in unified mode but valid), `j2_weekly_email_log` — keep their `account_id TEXT` column. Unified-mode rows just carry `account_id = '_all_'`. No FK on these columns, so the sentinel is legal as-is.

`j2_verdicts` and `j2_trade_reviews` never receive `'_all_'`. They are by nature scoped to one position/trade in one account.

### Scope resolution helper

A single helper, used by every assembler/tool that reads coaching data:

```python
# api/services/journal_two/coach_scope.py
def resolve_account_scope(
    conn: sqlite3.Connection,
    user_id: str,
    account_id: str,
) -> list[str]:
    """Return the list of real account ids this Compass call should query.

    - account_id == '_all_': all of the user's accounts with compass_enabled = 1
    - any other value: [account_id] (validated by the caller as usual)
    """
```

Callers either `WHERE account_id = ?` (single value, today's path) or `WHERE account_id IN (?, ?, …)` (unified path). Each fetched row is tagged with its source `account_name` so the LLM can attribute statements.

### Read path

The following modules learn about `'_all_'`:

- **`coach_data_assembler.py`** — `assemble_week` and `assemble_day` accept `account_id='_all_'`. Internal helpers (`_trades_in_range`, `_open_positions`, `_discipline_events`, `_recent_eod_summaries`, `_feedback_signals`, `_last_weekly_summary_and_focus`) call `resolve_account_scope` and switch their `WHERE account_id = ?` clause to `WHERE account_id IN (...)`. Each returned record gets `account_id` + `account_name` fields so the prompt can render "[Default] AAPL +1.2R".

- **`coach_chat_tools.py`** — Each read tool (`get_positions`, `get_trades`, `get_pnl_today`, `get_recent_reviews`, `get_active_interventions`, `get_trader_profile`, `get_account_summary`, etc.) calls `resolve_account_scope` and unions its query. Action tools that mutate state (`add_position`, `update_trader_profile`, `dismiss_intervention`, etc.) behave as follows in unified mode:
  - `update_trader_profile` → writes to `j2_unified_coach_state.trader_profile`.
  - `add_position` → refuses with a friendly error: *"This is a unified-mode chat. Tell me which account to add the position to."*
  - `dismiss_intervention` / per-account state mutations → require the LLM to specify an `account_id` argument; the preview surface confirms it.

- **`overview.py`** — `get_overview(user_id, account_id)` accepts `'_all_'` and aggregates the overview card. Per-account-only fields (e.g. "today's open positions" expand across accounts; "regime alert count" sums).

- **`pre_trade_verdict.py`** and **`trade_review.py`** — Unchanged in v1. When generating a verdict for a position in account X, they may *additionally* read `j2_unified_coach_state.trader_profile` and append it to the LLM system prompt (so coaching style stays consistent) — but the verdict itself is always written to that one account's row.

- **`profile_suggestions.py`** — Profile suggestions can target unified mode: a `👎` on a unified weekly review creates an `account_id='_all_'` suggestion. Existing per-account suggestions keep working.

- **`coach_email_digest.py`** — Untouched in v1. Iterates accounts where `compass_enabled=1` and sends per-account emails as today.

### Write path

| Artifact                            | Where it persists in unified mode                       |
|-------------------------------------|---------------------------------------------------------|
| Unified trader profile              | `j2_unified_coach_state.trader_profile`                 |
| Weekly review                       | `j2_coach_reviews` with `account_id='_all_'`            |
| EOD recap                           | `j2_eod_recaps` with `account_id='_all_'`               |
| Chat messages                       | `j2_chat_messages` with `account_id='_all_'`            |
| Profile suggestions                 | `j2_profile_suggestions` with `account_id='_all_'`      |
| `compass_enabled` toggle            | `j2_unified_coach_state.compass_enabled`                |
| Pre-trade verdict                   | Per-account, unchanged                                  |
| Per-trade post-mortem               | Per-account, unchanged                                  |
| Interventions                       | Per-account, unchanged                                  |

### Endpoints

The existing route shape is reused. Today's routes nest coach paths under the account: `/api/j2/accounts/{account_id}/coach/...`. Examples:

```
GET    /api/j2/accounts/{account_id}/coach/weekly-reviews
POST   /api/j2/accounts/{account_id}/coach/weekly-reviews/generate
GET    /api/j2/accounts/{account_id}/coach/eod-recaps
POST   /api/j2/accounts/{account_id}/coach/chat/stream
GET    /api/j2/accounts/{account_id}/coach/overview
GET    /api/j2/accounts/{account_id}/coach/profile
PUT    /api/j2/accounts/{account_id}/coach/profile
GET    /api/j2/accounts/{account_id}/coach/interventions/active
GET    /api/j2/accounts/{account_id}/coach/profile-suggestions
…
```

These accept `account_id = '_all_'` in the URL path. The route handlers add one new precheck:

```python
if account_id == "_all_":
    state = unified_coach_service.get_or_create(user_id)
    if not state["compass_enabled"]:
        raise HTTPException(403, "Unified Compass is disabled.")
else:
    # existing per-account gate
    settings_check = accounts_service.get_account_settings(user_id, account_id)
    if settings_check is None: raise 404
    if not settings_check["compassEnabled"]: raise 403
```

Pre-trade verdict / trade-review / intervention endpoints reject `'_all_'` with 400 ("Unified mode cannot generate per-trade artifacts — switch to a single account").

A small new endpoint pair manages unified state:

```
GET  /api/j2/unified-coach          → { traderProfile, compassEnabled, onboarded }
PUT  /api/j2/unified-coach          → { traderProfile?, compassEnabled? }
```

(No `/api/j2/unified-coach/onboarding` in v1.)

### Frontend

#### Remove the guard

`app/src/pages/journal-2-0/tabs/CompassTab.jsx:74` currently returns an empty-state when `accountId` is null. After the change:

```jsx
const scope = accountId ?? '_all_'   // null → unified
```

`scope` is what gets passed to every Compass hook (`useJ2CoachReviews(scope)`, `useInterventions(scope)`, `useCompassOverview(scope)`, etc.).

#### Hooks

Each Compass hook constructs its URL from the scope. When `scope === '_all_'`, hit the same routes with `_all_` in the path. Interventions hook gracefully returns an empty array in unified mode (no per-account tilt detection in v1).

The trader-profile hook gets a second path:

```js
const traderProfileUrl =
  scope === '_all_'
    ? '/api/j2/unified-coach'
    : `/api/j2/coach/${scope}/trader-profile`
```

#### CompassTab in unified mode

Same structure, with three differences:
- Header: "🧭 Compass — Portfolio" instead of "🧭 Compass".
- A small sub-line names the accounts in scope: *"Coaching across Default + Cash (2 accounts)."*
- The Trader Profile editor reads/writes to the unified endpoint.
- Interventions banner suppressed (v1 limitation, with an info tooltip).

#### Other Compass surfaces

- **AddPositionModal** 🧭 Pre-Trade Verdict button — unchanged. Always operates on the account the position is being added to.
- **TradeDrawer** 🧭 Tell-me-about-this-trade button — unchanged.
- **Compass Overview card** — accepts the new scope. In unified mode, the per-week-focus + this-week-recap pulls from `_all_` rows; the position list spans accounts.
- **Voice mode** — `setVoicePageHint` includes the unified scope tag. Voice tools call into the same union-aware tool implementations.

### Test plan

- **Schema**: migration creates `j2_unified_coach_state` idempotently on startup (`init_db` extension).
- **Scope helper**: unit tests for `resolve_account_scope` — happy path (real id, `'_all_'` with N enabled accounts, `'_all_'` with all disabled → empty list).
- **Assemblers**: `assemble_week('_all_', ...)` returns trades from 2 accounts, tagged with `account_name`.
- **Chat tools**: `get_positions` with `'_all_'` unions positions from 2 accounts. `update_trader_profile` with `'_all_'` writes to unified state. `add_position` with `'_all_'` rejects.
- **Endpoints**: `GET /api/j2/coach/_all_/reviews` returns the unified-bucket reviews. `PUT /api/j2/unified-coach` round-trips. Pre-trade verdict with `_all_` returns 400.
- **Frontend**: `CompassTab` renders unified header when scope is `'_all_'`. `TraderProfileEditor` round-trips through the unified endpoint.
- **Compass enabled gate**: with unified `compass_enabled=0`, all unified routes 403.

### Risk and rollback

- Strictly additive — no migration, no behavior change to per-account coaches.
- `j2_unified_coach_state` defaults to `compass_enabled=1, trader_profile=''` on first read. Pre-existing users hit unified mode and get an empty coach until they generate.
- Rollback: gate the `'_all_'` codepath behind a feature flag (`UNIFIED_COMPASS_ENABLED`, default true). Flip false on Railway env to fully revert to "Select a single account" guard.

### Open questions

1. **Seeding the unified trader profile.** On first load of unified mode, should we offer a "Import profile from \<account name\>" button instead of forcing the user to type one from scratch? Lean: yes, as a single-click affordance, but not a blocker for v1.
2. **Interventions in unified mode.** v1 hides them. v2 candidate: a portfolio-level cooling-off rule (e.g. "you took 5 losses across accounts today — slow down everywhere"). Tracked as future work.
3. **Voice picker in unified mode.** The Compass × Voice unification project (in-flight) is independent; v1 ships without changing the voice surface, but the voice tools (which are the same Python entry points) inherit `'_all_'` handling for free.

### Phased rollout

| Phase | Scope                                                                 |
|-------|-----------------------------------------------------------------------|
| 1     | Schema + scope helper + unit tests                                    |
| 2     | Assemblers + chat tools accept `'_all_'`                              |
| 3     | Endpoints accept `'_all_'`; `/api/j2/unified-coach` GET/PUT shipped   |
| 4     | Frontend: drop guard, route hooks through scope, unified header copy. Wire feature flag `UNIFIED_COMPASS_ENABLED` (env-driven, default `true`) — when false the guard stays. |
| 5     | Test pass, commit + push, manual smoke in production                  |

Per `feedback_ship_then_polish.md`: all 5 phases run end-to-end before polish; per-account behavior must never regress along the way.
