# Journal 2.0 — Accounts Tab — Design Spec

**Phase 2 of the J2.0 Enhanced Suite (Calendar → Accounts → Analytics)**

**Date:** 2026-04-18
**Author:** Patrick (with Claude)
**Status:** Draft for review

---

## 1. Goals

Introduce a real **multi-account** model to Journal 2.0 so users can:

1. Track multiple trading books separately ("Live", "Paper", "Swing", "Earnings Plays") — each with its own settings, balance, and color.
2. View any account in isolation OR aggregate across "All Accounts" via a global header selector.
3. Compare performance across accounts side-by-side.
4. Use accounts as **discipline boundaries** — a "Earnings Plays" account can have a tighter stop style and a curated setups list distinct from your main book.

Phase 2 is the schema-touching piece. Calendar (Phase 1) is built `account_id`-aware from day one and just gains the selector wired up here.

## 2. Out of scope (explicit non-goals)

- **Multi-asset support** (Options/Futures/Crypto/Bets) — separate spec
- **Deposit/withdrawal/dividend ledger** — `starting_balance` is the only baseline; current balance derives from trades. Adjustment ledger is v2.
- **Account-to-account trade transfers** with provenance audit log — too speculative for v1
- **Per-account UI themes** — theme stays user-global
- **Account import wizard** — manually create accounts in v1; bulk import is later
- **Strategy / Portfolio nesting** ("Account → strategies inside") — flat structure for v1; nesting is post-v1

## 3. Nav placement

Add **Accounts** as a new tab in `JournalTwoRoot.jsx`:

```
📊 Open Positions  |  📒 Trade Journal  |  📅 Calendar  |  💼 Accounts  |  🌐 Community
```

Hotkey: **`g > t`** (mnemonic: "go > Trading accounts" — `g > a` already taken by Calendar).

## 4. Data model

### 4.1 New table: `j2_accounts`

One row per account. Each user has 1+ accounts (auto-created "Default" on migration).

```sql
CREATE TABLE IF NOT EXISTS j2_accounts (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    name                TEXT NOT NULL,
    color               TEXT NOT NULL,             -- one of 12 palette keys
    broker              TEXT,                      -- free string, optional
    starting_balance    REAL NOT NULL,
    -- Settings (per-account, moved from j2_settings)
    account_size        REAL NOT NULL,
    default_stop        TEXT NOT NULL DEFAULT '{"mode":"custom"}',
    position_closing    TEXT NOT NULL DEFAULT 'FIFO',
    breakeven_range     TEXT NOT NULL DEFAULT '{"enabled":false,"unit":"$","value":0}',
    setups              TEXT NOT NULL DEFAULT '[]',
    share_journal_data  INTEGER NOT NULL DEFAULT 0,
    -- Audit
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_j2_accounts_user ON j2_accounts(user_id);
```

**Color palette keys** (stored as the key string, mapped client-side to hex for theming):

```
blue, purple, teal, magenta, orange, lime, cyan, pink, slate, sky, emerald, amber
```

**Naming uniqueness:** `(user_id, name)` unique. UI rejects "duplicate name" with friendly message.

### 4.2 Schema additions

```sql
ALTER TABLE j2_positions ADD COLUMN account_id TEXT;
CREATE INDEX IF NOT EXISTS idx_j2_positions_account ON j2_positions(account_id);

ALTER TABLE j2_trades ADD COLUMN account_id TEXT;
CREATE INDEX IF NOT EXISTS idx_j2_trades_account ON j2_trades(account_id);
```

`account_id` is nullable in the **schema** (so the migration can run incrementally) but **enforced as NOT NULL by application code** post-migration. After all users are migrated and we've verified zero NULLs across the table, we can run a follow-up migration to add `NOT NULL` constraint.

### 4.3 `j2_settings` deprecation

After migration:
- The `j2_settings` table is no longer written to or read from for runtime.
- We **keep the table** for one release cycle as rollback insurance (data preserved).
- A follow-up cleanup migration drops it once we're confident in the new model.

## 5. Migration strategy

**Lazy, on-demand.** No deploy-time scripts.

The existing `settings_service.get_settings(user_id)` is the natural choke point — every J2.0 page reads it on mount. We modify it:

```python
def get_settings(user_id, account_id=None, conn=None):
    """
    If user has no accounts yet, run one-time migration:
      1. Create a 'Default' account from their j2_settings (or system defaults if none).
      2. UPDATE j2_positions SET account_id = <default> WHERE user_id = <u>
      3. UPDATE j2_trades SET account_id = <default> WHERE user_id = <u>
    Then return the requested account's settings (or 'Default' if account_id is None).
    """
```

**Migration is idempotent and atomic** (single SQL transaction).

**Edge cases:**
- User exists in `users` but has no `j2_settings` row → create Default with system seed values
- User has multiple `j2_settings` rows (shouldn't happen but defensive) → use the most recent
- Concurrent requests during first migration → SQL transaction + `INSERT OR IGNORE` semantics

**Rollback plan:** if a bug surfaces, we can revert the API code; `j2_settings` data is intact. Worst-case data loss = `account_id` rows we wrote (recoverable).

## 6. Backend / API

All routes under `/api/j2/*` in `api/routers/journal_two.py`.

### 6.1 Account CRUD

```
GET    /api/j2/accounts                  -> list user's accounts
POST   /api/j2/accounts                  -> create new account
GET    /api/j2/accounts/{account_id}     -> get one account
PUT    /api/j2/accounts/{account_id}     -> update name/color/broker/balance/settings
DELETE /api/j2/accounts/{account_id}     -> delete (only if zero trades + zero positions)
```

**Create payload:**

```json
{
  "name": "Earnings Plays",
  "color": "magenta",
  "broker": "Schwab",
  "startingBalance": 25000,
  "copySettingsFrom": "<source_account_id>"  // optional; if omitted, system defaults
}
```

If `copySettingsFrom` is provided, server reads that account's settings (account_size / default_stop / position_closing / breakeven_range / setups) and seeds the new account with copies. `share_journal_data` is NOT copied (always defaults to false for safety).

**Delete behavior:**

```
DELETE /api/j2/accounts/{account_id}
  -> 200 if account has zero positions + zero trades (deletes cleanly)
  -> 409 Conflict if account has any positions or trades
     Body: { "error": "...", "openPositionCount": 3, "tradeCount": 47 }
```

Client sees the 409 and shows the move-trades-first modal.

### 6.2 Move trades / positions

```
POST /api/j2/accounts/{source_account_id}/move-all-to/{target_account_id}
```

Atomically reassigns every position + trade from source to target. Returns:

```json
{ "movedPositions": 3, "movedTrades": 47 }
```

After a successful move, the user can issue `DELETE /api/j2/accounts/{source}` and it'll succeed.

### 6.3 Account comparison

```
GET /api/j2/accounts/comparison
```

Returns per-account aggregate metrics for the Comparison view:

```json
{
  "accounts": [
    {
      "id": "...",
      "name": "Live",
      "color": "blue",
      "currentBalance": 100823.50,
      "startingBalance": 100000,
      "totalReturn": 0.00824,
      "totalPnl": 823.50,
      "tradeCount": 47,
      "winRate": 0.617,
      "profitFactor": 2.31,
      "maxDrawdown": -1240.00,
      "maxDrawdownPct": -0.0124,
      "sharpe": 0.86,
      "avgWin": 87.20,
      "avgLoss": -42.10,
      "expectancy": 17.51
    },
    ...
  ]
}
```

### 6.4 All existing endpoints get `account_id` filter

Update every `/api/j2/*` read endpoint to accept optional `?account_id=<id>`:

- `GET /api/j2/positions?account_id=<id>` (NULL = all accounts)
- `GET /api/j2/trades?account_id=<id>`
- `GET /api/j2/calendar?account_id=<id>` (Phase 1 already accepts this — verify)
- `GET /api/j2/calendar/day/{date}?account_id=<id>`
- `GET /api/j2/community/*` — these IGNORE account_id (community is shared trades only)

Write endpoints **require** `account_id`:

- `POST /api/j2/positions` — payload must include `accountId`
- `POST /api/j2/trades` — payload must include `accountId`
- `POST /api/j2/positions/{id}/close` — inherits `account_id` from the position

### 6.5 Settings refactor

The single `settings_service` becomes account-scoped:

```python
def get_account_settings(user_id, account_id):  # was get_settings(user_id)
def upsert_account_settings(user_id, account_id, payload):  # was upsert_settings(user_id, payload)
```

Settings payload **does NOT** include `name`, `color`, `broker`, `starting_balance` — those live in account-CRUD endpoints. Settings payload IS still `accountSize`, `defaultStop`, `positionClosing`, `breakevenRange`, `setups`, `shareJournalData`.

Client uses `useJ2AccountSettings(accountId)` instead of `useJ2Settings()`.

### 6.6 Community feed updates

`api/services/journal_two/community.py`'s queries currently filter on `j2_settings.share_journal_data = 1`. After migration:

- The `j2_settings` table is no longer the source.
- Filter becomes: trades from accounts where `j2_accounts.share_journal_data = 1`.
- All `community.py` SQL JOINs change from `JOIN j2_settings s ON s.user_id = t.user_id` to `JOIN j2_accounts a ON a.id = t.account_id WHERE a.share_journal_data = 1`.

This is a quiet rewrite — community-feed users won't notice anything except sharing is now per-account.

## 7. Frontend / Components

### 7.1 New files

```
app/src/pages/journal-2-0/
├── tabs/
│   └── AccountsTab.jsx              ← list + comparison + add-account
├── components/accounts/
│   ├── AccountSelector.jsx          ← global header dropdown
│   ├── AccountList.jsx              ← list of account cards
│   ├── AccountCard.jsx              ← single account row (color dot, name, broker, balance, trade count, edit/delete)
│   ├── NewAccountModal.jsx          ← form: name, color picker, broker, starting balance, copy-settings-from
│   ├── EditAccountModal.jsx         ← edit name/color/broker/balance (settings have their own modal)
│   ├── AccountSettingsModal.jsx     ← per-account settings (replaces existing PortfolioSettingsModal)
│   ├── DeleteAccountModal.jsx       ← shows trade/position counts; offers move-to picker
│   ├── ComparisonGrid.jsx           ← side-by-side per-account metric cards
│   └── ColorPicker.jsx              ← 12-color palette swatch
├── hooks/
│   ├── useJ2Accounts.js             ← SWR for /api/j2/accounts
│   ├── useJ2AccountComparison.js    ← SWR for /api/j2/accounts/comparison
│   ├── useJ2SelectedAccount.js      ← localStorage-backed current selection
│   └── useJ2AccountSettings.js      ← replaces useJ2Settings
└── lib/
    └── accountColors.js             ← 12-color palette definition + theme mapping
```

### 7.2 Global Account Selector (header)

Replaces the existing **Settings $X** money pill in `JournalTwoRoot.jsx` with a two-element header cluster:

```
[ ● Live  $100,823 ▾ ]   [⚙]
   ↑ AccountSelector      ↑ Settings (gear icon, opens AccountSettingsModal for the current account)
```

**Selector dropdown contents:**

```
┌──────────────────────────────┐
│ ● Live          $100,823     │
│ ● Paper          $25,144     │
│ ● Swing          $50,000     │
├──────────────────────────────┤
│ 🌐 All Accounts              │
├──────────────────────────────┤
│ + New Account                │
└──────────────────────────────┘
```

State: stored in `localStorage` under `uct.j2.selectedAccountId`. Restored on app load. Falls back to first account if stored ID is invalid (e.g. account deleted).

When **All Accounts** is selected:
- Calendar / Open Positions / Trade Journal aggregate across accounts
- Settings gear is **disabled** with tooltip "Select a single account to edit settings"
- Add Position / Add Trade modals require an explicit Account dropdown pick (no pre-fill)

### 7.3 AccountsTab layout

```
┌─────────────────────────────────────────────────────────┐
│ Accounts                              [+ New Account]   │
│ Manage your trading accounts and compare performance    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  YOUR ACCOUNTS                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ● Live      Schwab     $100,823    47 trades    │   │
│  │                              [⚙ Settings] [✏][🗑]│   │
│  ├─────────────────────────────────────────────────┤   │
│  │ ● Paper                $25,144     12 trades    │   │
│  │                              [⚙ Settings] [✏][🗑]│   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ACCOUNT COMPARISON                                     │
│  ┌──────────┬──────────┬──────────┐                    │
│  │ ● Live   │ ● Paper  │ ● Swing  │                    │
│  │ +$823    │ +$144    │ +$0      │                    │
│  │ 61.7% WR │ 75% WR   │ -- WR    │                    │
│  │ PF 2.3   │ PF 1.8   │ PF --    │                    │
│  │ MaxDD-1.2%│ MaxDD-0% │ MaxDD-0% │                    │
│  └──────────┴──────────┴──────────┘                    │
│                                                         │
│  HOW ACCOUNTS WORK                                      │
│  Inline 3-step explainer (Create / Assign / Compare)    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.4 New Account modal

Form fields:

```
NAME *           [Earnings Plays______]
COLOR *          [● ● ● ● ● ● ● ● ● ● ● ●]   (12 swatches, click to pick)
BROKER           [Schwab______________] (optional)
STARTING BALANCE [$ 25,000____________]
COPY SETTINGS    [○ System defaults    ]
                 [● Live (current)     ]
                 [○ Paper              ]

                              [Cancel] [Create Account]
```

**Validation:**
- Name: 1–60 chars, unique within user
- Color: must be one of the palette keys
- Starting balance: > 0
- Account becomes the new selected account on success (good UX — you just made it, you want to go to it)

### 7.5 Edit Account modal

Same as New Account but no `copySettingsFrom`. **Cannot edit:** `id`, `created_at`. **Can edit:** name, color, broker, starting_balance. Settings are edited in a separate Settings modal (so the Edit modal stays focused on identity attributes).

**Editing `starting_balance`** is allowed — useful when you correct an initial mistake. Affects all derived "return" calculations retroactively.

### 7.6 Account Settings modal

Open via the gear icon in the header (or per-account `[⚙ Settings]` in AccountsTab). Identical to today's `PortfolioSettingsModal` (Account Size / Default Stop / Position Closing / Breakeven Range / Trade Setups / Community Sharing) but **scoped to the selected account**. Title becomes "Settings — Live" (account name).

### 7.7 Delete Account modal

Two-state:

**State 1 — Account is empty:**
```
Delete "Paper" account?
This action cannot be undone.
              [Cancel]  [Delete Account]
```

**State 2 — Account has trades or positions:**
```
Cannot delete "Paper"
3 open positions and 12 trades are in this account.
Move them to another account first:

  Move all to: [● Live ▾]
              [Cancel]  [Move + Delete]
```

`[Move + Delete]` runs `POST /move-all-to/{target}` then `DELETE /accounts/{source}` in sequence. Either both succeed or neither (errors trigger rollback toast).

### 7.8 Color palette module (`lib/accountColors.js`)

```js
export const ACCOUNT_COLORS = {
  blue:    { hex: '#5b9bd5', label: 'Blue'    },
  purple:  { hex: '#9d6bd9', label: 'Purple'  },
  teal:    { hex: '#3aa99e', label: 'Teal'    },
  magenta: { hex: '#cc66bb', label: 'Magenta' },
  orange:  { hex: '#e08956', label: 'Orange'  },
  lime:    { hex: '#a3c853', label: 'Lime'    },
  cyan:    { hex: '#5cb8d3', label: 'Cyan'    },
  pink:    { hex: '#e597b3', label: 'Pink'    },
  slate:   { hex: '#7a8499', label: 'Slate'   },
  sky:     { hex: '#82b6d9', label: 'Sky'     },
  emerald: { hex: '#5fbb8e', label: 'Emerald' },
  amber:   { hex: '#d4b35c', label: 'Amber'   },
}
```

Palette curated for: contrast against `var(--bg-surface)` (#1a1c17), distinguishable from gold accent (`#c9a84c`), and from each other (no two colors closer than ΔE 25 in CIELAB).

## 8. State management

- **`useJ2Accounts()`** — SWR over `/api/j2/accounts`. Refresh on focus; invalidated by mutations to accounts.
- **`useJ2SelectedAccount()`** — Returns `{ accountId, account, setAccount }`. Reads from localStorage; updates trigger re-renders. `accountId === null` means "All Accounts".
- **`useJ2AccountSettings(accountId)`** — SWR over the account's settings; replaces today's `useJ2Settings()`. When called with `null`, returns a synthetic "all-accounts" settings object that disables write-related UI.
- **`useJ2AccountComparison()`** — SWR over `/api/j2/accounts/comparison`.

All read hooks elsewhere (positions, trades, calendar) get an `accountId` arg passed from `useJ2SelectedAccount()`.

## 9. Account-aware existing tabs

### 9.1 Open Positions

- Reads filter by `accountId`
- "Add Position" pre-fills `accountId` from selected account
- New column (optional, off by default in column picker): **Account** with color dot + name (only useful in "All Accounts" view)

### 9.2 Trade Journal

- Same: filter by `accountId`, column picker gains "Account" column (off by default)
- Add Trade modal pre-fills `accountId`
- Filter sidebar gains an "Account" filter section in "All Accounts" mode (filters within "All Accounts" view to a subset of accounts)

### 9.3 Calendar (Phase 1 hookup)

- `useJ2Calendar({ accountId })` — already accepts the param per Phase 1 spec
- DayDetailPage `useJ2DayDetail(date, accountId)` — same
- Cell aggregations respect the selected account

### 9.4 Community

- Unchanged — community is cross-user shared trades. Account selection in the header has no effect here.

## 10. Error handling

- **Create account name collision** → 409 from server, modal shows inline "An account named 'Live' already exists"
- **Delete account with data** → 409 from server, modal switches to State 2 (move-trades-first)
- **Move trades atomicity** → SQL transaction; if any row fails, full rollback; toast "Couldn't move all trades — please try again"
- **Selected account deleted in another tab** → next read returns 404; localStorage cleared; selector falls back to first account; toast "Account no longer exists"
- **All Accounts + write attempt** (Add Position / Add Trade with no Account picked) → form-level error: "Pick an Account to save this trade to"
- **Migration failure mid-flight** → SQL transaction rolls back; user sees error banner with retry; data integrity preserved
- **Color palette key invalid** → server normalizes to `slate`; never errors

## 11. Testing strategy

### 11.1 Backend (pytest)

`api/services/journal_two/test_accounts.py`:
- Create / read / update / delete account
- Name uniqueness per user
- Delete blocked when positions/trades exist (409 with counts in body)
- Move-all-to atomicity (test mid-transaction failure rolls back)
- Settings copy-from logic (copies account_size/default_stop/etc., does NOT copy share_journal_data)
- Color palette validation (rejects unknown keys)
- User isolation (user A cannot see user B's accounts)

`api/services/journal_two/test_migration.py` (new):
- First-time migration creates "Default" account from j2_settings
- Migration assigns all positions/trades to Default
- Idempotent — running migration twice is safe
- User with no j2_settings row gets system-default account
- Concurrent migration calls don't double-create accounts

`api/services/journal_two/test_settings.py` (update):
- All tests refactored to use `get_account_settings(user_id, account_id)` instead of `get_settings(user_id)`
- New test: settings update only affects the targeted account

`api/services/journal_two/test_community.py` (update):
- Community filter now keys off `j2_accounts.share_journal_data` not `j2_settings`
- User with multiple accounts: only trades from sharing-enabled accounts surface in community feed

### 11.2 Frontend (vitest)

- `AccountSelector.test.jsx` — renders accounts, switches selection, persists to localStorage, falls back to first account on invalid stored ID
- `NewAccountModal.test.jsx` — validation rules, copy-from picker, color swatch click, success toast
- `DeleteAccountModal.test.jsx` — empty account → simple confirm; non-empty → move-to picker → atomic move+delete
- `ComparisonGrid.test.jsx` — renders one card per account, color matches palette, handles zero-trade accounts
- `useJ2SelectedAccount.test.js` — localStorage round-trip, "All Accounts" semantics
- Existing tests for `useJ2Settings` etc. updated to use account-scoped equivalents

### 11.3 Integration

- Brand-new user: log in → AccountsTab shows "Default" account auto-created with system defaults
- Existing J2.0 user: log in → migration runs → "Default" account contains their old j2_settings + all their old trades assigned to it
- Create new "Paper" account → switch to it → Open Positions shows zero (new account is empty) → switch back to "Default" → existing positions return
- Delete attempt on Default account with 47 trades → blocked → move all to "Paper" → delete succeeds
- Toggle `shareJournalData` ON for Paper account → Paper trades appear in community feed; Default trades don't (Default's toggle is off)

## 12. Migration / rollout

### 12.1 Pre-deploy

- Code: shipped behind no flag — additive feature
- DB migration: runs on app start (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN)
- The `j2_settings` table is **untouched** until follow-up cleanup (rollback insurance)

### 12.2 First user request post-deploy

- `get_account_settings()` detects no accounts for user
- Atomic transaction: create Default account from existing j2_settings; bulk-update all positions + trades with `account_id = <default_id>`; commit
- Subsequent requests use the new model

### 12.3 Two weeks post-deploy

- Assuming no issues, ship a follow-up migration: drop `j2_settings` table; add `NOT NULL` constraint to `j2_positions.account_id` and `j2_trades.account_id`

### 12.4 Rollback

- Revert API code → falls back to reading `j2_settings`
- `j2_accounts` and `account_id` columns can stay (unused, harmless)
- Or wipe `j2_accounts` and `account_id` columns to fully revert — `j2_settings` data is intact

## 13. Phase 1 (Calendar) hookup details

The Calendar spec is built `account_id`-aware. Phase 2 just wires up the selector:

1. `useJ2Calendar` and `useJ2DayDetail` already accept `accountId`. v1 was passing `undefined`. After Phase 2, they pass `accountId` from `useJ2SelectedAccount()`.
2. The CalendarTab's existing totals strip (Net P&L / Gross / Trades / etc.) automatically reflects the selected account.
3. Day notes remain global per (user, date) — NOT scoped by account, per Calendar spec §2.

## 14. Open questions

| Q | A | Revisit when |
|---|---|---|
| Drop j2_settings table when? | 2 weeks post-deploy, no issues | When confident |
| Per-account theme? | No, theme stays user-global | If users complain |
| Account archive (soft-delete)? | No, hard-delete with move-trades-first | If users want history of deleted accounts |
| Account-to-account trade transfer with audit? | No move-trades is the only path | If users want partial moves |
| Default new account from a template (e.g. "Day Trader" preset)? | No, copy-from-existing only | v2 |

---

**End of spec.** Ready for review.
