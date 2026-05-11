# Journal 2.0 Discipline — Phase F: Streak Nudges + Hold-Time Staleness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Surface three advisory (non-blocking) nudges in the J2 Open Positions header:
1. **Loss streak:** after N consecutive losing trades today, show "you're N down today. Take a break?"
2. **Win streak:** after M consecutive winners (any day), show "M in a row. Don't size up out of euphoria."
3. **Stale positions:** N positions held > 30 days with empty/no notes — "Review these."

Each nudge is dismissible via localStorage. Thresholds are per-account-configurable, with sensible defaults (loss=3, win=5, stale=30 days).

**Why:** Phase F is the polish layer for the deterministic discipline track. Where Phases A–E intervened at decision time, Phase F provides ambient awareness — gentle reminders, never blocks.

---

## Settings shape (after this phase)

```js
{
  // ... existing Phase A-E ...
  lossStreakThreshold: null,           // default 3
  winStreakThreshold: null,            // default 5
  staleHoldDaysThreshold: null,        // default 30
}
```

## Nudges endpoint response

```json
{
  "lossStreakCount": 3,
  "winStreakCount": 0,
  "staleCount": 2,
  "thresholds": {"loss": 3, "win": 5, "staleDays": 30}
}
```

When no trades / no positions, counts are 0. The thresholds field exposes the resolved values (account override or default).

---

## Tasks

### F-Task 1: Schema — 3 columns on j2_accounts

```python
    # Phase F — Streak nudges + stale-hold thresholds (nullable INTEGERs; null = use defaults)
    "ALTER TABLE j2_accounts ADD COLUMN loss_streak_threshold INTEGER",
    "ALTER TABLE j2_accounts ADD COLUMN win_streak_threshold INTEGER",
    "ALTER TABLE j2_accounts ADD COLUMN stale_hold_days_threshold INTEGER",
```

### F-Task 2: Settings validator

Reuse `_validate_optional_positive_int` from Phase B for all three. Default to None.

### F-Task 3: accounts.py round-trip

Standard pattern — extend `_default_settings_block`, `_account_to_settings`, `upsert_account_settings`. Add 1 test.

### F-Task 4: nudges.py service

```python
"""Phase F nudges — loss/win streak counts + stale-position count."""

DEFAULT_LOSS_STREAK = 3
DEFAULT_WIN_STREAK = 5
DEFAULT_STALE_DAYS = 30


def get_nudges_state(user_id, account_id, *, conn=None, now=None):
    """Compute streak counts + stale-position count for one account."""
    # 1. Pull settings to resolve thresholds.
    # 2. Walk j2_trades (ORDER BY exit_date DESC) — count consecutive 'Loss' from latest until we hit a non-Loss.
    #    For loss-streak, only count trades whose exit_date is today (ET).
    # 3. Walk same list — count consecutive 'Win' from latest until we hit a non-Win (no date restriction).
    # 4. Count j2_positions WHERE user_id=? AND account_id=? AND closed_at IS NULL
    #    AND entry_date < (now_et - N days) AND (notes IS NULL OR notes = '').
    # 5. Return {lossStreakCount, winStreakCount, staleCount, thresholds: {loss, win, staleDays}}.
```

Tests:
- No trades / no positions → all 0
- 3 consecutive losses today → lossStreakCount = 3
- 2 losses today + 1 loss yesterday → lossStreakCount = 2 (resets on day boundary)
- 5 wins on different days → winStreakCount = 5 (no day restriction)
- Position older than 30 days with no notes → staleCount = 1
- Position older than 30 days WITH notes → staleCount = 0

### F-Task 5: Nudges endpoint

`GET /api/j2/accounts/{id}/nudges` calling the service.

### F-Task 6: useJ2Nudges hook

SWR, 60s refresh. Returns null when accountId is null.

### F-Task 7: NudgesBanner component

Renders 0-3 nudge entries in a horizontal strip. Each nudge has:
- An icon (🛑 for loss, 🏆 for win, ⏳ for stale)
- A short message
- A "Dismiss" / "Snooze 1h" button that adds to localStorage

State key: `uct.j2.nudges.dismissed.{accountId}` = `{ [nudgeKey]: expiryISO }`. Each dismiss adds an entry expiring 1 hour from now. The component reads localStorage on mount + skips rendering dismissed nudges.

Test cases:
- No active nudges → renders nothing
- Loss streak active, not dismissed → renders
- Loss streak active, dismissed → renders nothing
- Dismissed but expired → renders again

### F-Task 8: PortfolioSettingsModal NUDGES section

Three number inputs with placeholders showing defaults (3, 5, 30). Standard wiring + 1 round-trip test.

### F-Task 9: Mount NudgesBanner in OpenPositionsTab

Above the stats bar.

### F-Task 10: Smoke + push

Standard final task.

---

## Carry-forwards (polish pass)

- Nudge messaging could be more personalized using user's name + trade specifics.
- Mobile-responsive nudge strip layout.
- Optional: snooze-to-tomorrow option in addition to 1h snooze.
- "Notes required on close" toggle — could fit here but defer to a separate concern after Phase G brainstorm.
