# Journal 2.0 Discipline — Phase A: Trade Entry Guards

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three per-account discipline settings (`defaultSizePct`, `defaultRMultipleTarget`, `maxRiskPerTradePct`) and wire them into AddPosition + AddTrade modals as auto-prefill, suggested-target display, and a soft-block risk-cap banner.

**Architecture:** Three nullable scalar columns added to `j2_accounts` via idempotent ALTER TABLE; settings flow through the existing `validate_settings_payload` and `_account_to_settings` paths; UI consumes via the existing `settings` prop already passed to both modals — **no new hooks, no new endpoints**.

**Tech Stack:** SQLite (via `auth_db.get_connection`), FastAPI, Python validators, React hooks, vitest, pytest.

**Why this scope:**
- Three settings is small enough to ship in a day.
- All three are **optional** (null = disabled). Existing accounts behave identically until the user opts in.
- Risk cap is **soft block** (red banner + Override button), never silent rejection. Friction is the feature; lockout is not.
- `defaultRMultipleTarget` is **display only** in v1. No `target_price` column, no analytics changes — proves value before expanding schema.

---

## File map

**Backend:**
- Modify: `api/services/journal_two/db.py` — add 3 idempotent ALTERs to `_PHASE_2_ALTERS`
- Modify: `api/services/journal_two/settings.py` — accept + validate the 3 new fields in `validate_settings_payload`, add to `default_settings_data`
- Modify: `api/services/journal_two/accounts.py` — extend `_default_settings_block`, `_account_to_settings`, `upsert_account_settings`, and the create paths to round-trip the 3 new columns
- Test: `api/services/journal_two/test_settings.py` — extend with validator tests
- Test: `api/services/journal_two/test_accounts.py` — extend with roundtrip test

**Frontend:**
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx` — new "ENTRY DEFAULTS & GUARDS" section after TRADE TYPES
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx` — prefill shares, suggested-target line, risk-cap banner + soft-block on Save
- Modify: `app/src/pages/journal-2-0/components/AddTradeModal.jsx` — risk-cap banner + soft-block (uses entry/stop/shares fields)
- Create: `app/src/pages/journal-2-0/lib/disciplineGuards.js` — pure functions: `computeImpliedRiskPct`, `computeSuggestedTarget`, `computeDefaultShares`. Reused by both modals.
- Test: `app/src/pages/journal-2-0/lib/disciplineGuards.test.js` — vitest unit tests for the pure functions
- Test: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx` — extend with one test for the new section round-tripping

---

## Settings schema (canonical shape after this phase)

```js
{
  accountSize: 100000,
  tradingMode: 'both',
  defaultStop: { mode: 'custom' },
  positionClosing: 'FIFO',
  breakevenRange: { enabled: false, unit: '$', value: 0 },
  setups: [],
  shareJournalData: false,

  // NEW in Phase A — all three are optional (null = disabled):
  defaultSizePct: null,            // % of accountSize used to pre-fill shares (e.g. 5 = 5%)
  defaultRMultipleTarget: null,    // R multiple for the suggested-target line (e.g. 2.0 = 2R target)
  maxRiskPerTradePct: null,        // % of accountSize hard cap (e.g. 1 = 1% account risk)
}
```

---

## Task 1: Backend schema migration

**Files:**
- Modify: `api/services/journal_two/db.py:230-234` (end of `_PHASE_2_ALTERS`)

- [ ] **Step 1: Append three idempotent ALTER statements**

```python
# In api/services/journal_two/db.py, inside _PHASE_2_ALTERS list, after the
# trading_mode ALTER added in Phase A foundation:
"ALTER TABLE j2_accounts ADD COLUMN default_size_pct REAL",
"ALTER TABLE j2_accounts ADD COLUMN default_r_multiple_target REAL",
"ALTER TABLE j2_accounts ADD COLUMN max_risk_per_trade_pct REAL",
```

All three are nullable (no DEFAULT) so existing rows get NULL = "disabled."

- [ ] **Step 2: Run schema test**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/test_accounts.py -q
```

Expected: PASS — schema migration is idempotent and existing tests still pass (the three new columns are read as NULL).

- [ ] **Step 3: Commit**

```bash
git add api/services/journal_two/db.py
git commit -m "feat(j2-discipline): add 3 nullable columns to j2_accounts for entry-guard settings"
```

---

## Task 2: Backend validator

**Files:**
- Modify: `api/services/journal_two/settings.py:30-43` (`default_settings_data`) and `:121-152` (`validate_settings_payload`)
- Test: `api/services/journal_two/test_settings.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `api/services/journal_two/test_settings.py`:

```python
def test_validate_accepts_phase_a_guards():
    payload = _baseline_payload() | {
        "defaultSizePct": 5,
        "defaultRMultipleTarget": 2,
        "maxRiskPerTradePct": 1,
    }
    out = settings_module.validate_settings_payload(payload)
    assert out["defaultSizePct"] == 5.0
    assert out["defaultRMultipleTarget"] == 2.0
    assert out["maxRiskPerTradePct"] == 1.0


def test_validate_phase_a_guards_default_to_none():
    out = settings_module.validate_settings_payload(_baseline_payload())
    assert out["defaultSizePct"] is None
    assert out["defaultRMultipleTarget"] is None
    assert out["maxRiskPerTradePct"] is None


def test_validate_phase_a_guards_reject_invalid_ranges():
    base = _baseline_payload()
    for field, bad_value in [
        ("defaultSizePct", -1),     # negative
        ("defaultSizePct", 101),    # >100
        ("defaultRMultipleTarget", 0),    # not > 0
        ("maxRiskPerTradePct", -0.5),     # negative
        ("maxRiskPerTradePct", 100),      # >=100, that'd be the whole account
    ]:
        with pytest.raises(settings_module.SettingsValidationError):
            settings_module.validate_settings_payload(base | {field: bad_value})
```

Where `_baseline_payload()` is whatever helper the existing tests use (check the file's existing fixtures — if there isn't one, inline a dict with all required fields).

- [ ] **Step 2: Run tests to confirm failure**

```bash
python -m pytest api/services/journal_two/test_settings.py::test_validate_accepts_phase_a_guards -v
```

Expected: FAIL — KeyError or AttributeError, fields not yet validated.

- [ ] **Step 3: Implement the validator changes**

In `api/services/journal_two/settings.py`, add to `default_settings_data`:

```python
def default_settings_data() -> dict[str, Any]:
    return {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        # Phase A — Entry Guards (nullable = disabled)
        "defaultSizePct": None,
        "defaultRMultipleTarget": None,
        "maxRiskPerTradePct": None,
    }
```

Add a new helper above `validate_settings_payload`:

```python
def _validate_optional_pct(value: Any, field_name: str, *, max_exclusive: float = 100.0) -> float | None:
    """Optional 0 < x < max_exclusive percent. None = disabled."""
    if value is None or value == "":
        return None
    if not isinstance(value, (int, float)):
        raise SettingsValidationError(f"{field_name} must be a number or null")
    f = float(value)
    if f <= 0 or f >= max_exclusive:
        raise SettingsValidationError(f"{field_name} must be in (0, {max_exclusive})")
    return f


def _validate_optional_positive(value: Any, field_name: str) -> float | None:
    """Optional positive number. None = disabled."""
    if value is None or value == "":
        return None
    if not isinstance(value, (int, float)):
        raise SettingsValidationError(f"{field_name} must be a number or null")
    f = float(value)
    if f <= 0:
        raise SettingsValidationError(f"{field_name} must be > 0")
    return f
```

Extend `validate_settings_payload` return dict:

```python
    return {
        "accountSize": float(account_size),
        "defaultStop": _validate_default_stop(payload.get("defaultStop")),
        "positionClosing": closing,
        "breakevenRange": _validate_breakeven_range(payload.get("breakevenRange")),
        "setups": _validate_setups(payload.get("setups", [])),
        "shareJournalData": bool(payload.get("shareJournalData", False)),
        "tradingMode": trading_mode,
        # Phase A
        "defaultSizePct": _validate_optional_pct(payload.get("defaultSizePct"), "defaultSizePct"),
        "defaultRMultipleTarget": _validate_optional_positive(payload.get("defaultRMultipleTarget"), "defaultRMultipleTarget"),
        "maxRiskPerTradePct": _validate_optional_pct(payload.get("maxRiskPerTradePct"), "maxRiskPerTradePct"),
    }
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
python -m pytest api/services/journal_two/test_settings.py -q
```

Expected: PASS — all new tests + existing tests green.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/settings.py api/services/journal_two/test_settings.py
git commit -m "feat(j2-discipline): validate Phase A guard settings (size/R-target/risk-cap)"
```

---

## Task 3: Backend accounts.py round-trip

**Files:**
- Modify: `api/services/journal_two/accounts.py` — `_default_settings_block`, `_account_to_settings`, `get_or_migrate_default_account` (INSERT), `create_account` (INSERT), `upsert_account_settings` (UPDATE)

- [ ] **Step 1: Write the failing test**

Append to `api/services/journal_two/test_accounts.py`:

```python
def test_phase_a_guards_roundtrip(db_conn):
    user_id = "u_phase_a_roundtrip"
    account = accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "defaultSizePct": 5,
        "defaultRMultipleTarget": 2,
        "maxRiskPerTradePct": 1,
    }
    saved = accounts_service.upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["defaultSizePct"] == 5.0
    assert saved["defaultRMultipleTarget"] == 2.0
    assert saved["maxRiskPerTradePct"] == 1.0
    # Re-read from a fresh connection-style call
    fresh = accounts_service.get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["defaultSizePct"] == 5.0
```

- [ ] **Step 2: Run to confirm failure**

```bash
python -m pytest api/services/journal_two/test_accounts.py::test_phase_a_guards_roundtrip -v
```

Expected: FAIL — fields are not persisted yet.

- [ ] **Step 3: Implement read/write**

In `api/services/journal_two/accounts.py`:

In `_default_settings_block()` add the three keys:
```python
        "tradingMode": "both",
        "defaultSizePct": None,
        "defaultRMultipleTarget": None,
        "maxRiskPerTradePct": None,
    }
```

In `_account_to_settings()` extend the returned dict (keep the existing `keys` defensive guard pattern):
```python
        return {
            ...
            "tradingMode": row["trading_mode"] if "trading_mode" in keys else "both",
            "defaultSizePct": row["default_size_pct"] if "default_size_pct" in keys else None,
            "defaultRMultipleTarget": row["default_r_multiple_target"] if "default_r_multiple_target" in keys else None,
            "maxRiskPerTradePct": row["max_risk_per_trade_pct"] if "max_risk_per_trade_pct" in keys else None,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
```

In `upsert_account_settings()`, extend the UPDATE statement and bound parameters:
```python
        conn.execute(
            """
            UPDATE j2_accounts
               SET account_size = ?, default_stop = ?, position_closing = ?,
                   breakeven_range = ?, setups = ?, share_journal_data = ?,
                   trading_mode = ?,
                   default_size_pct = ?,
                   default_r_multiple_target = ?,
                   max_risk_per_trade_pct = ?,
                   updated_at = ?
             WHERE id = ? AND user_id = ?
            """,
            (
                float(full_validated["accountSize"]),
                json.dumps(full_validated["defaultStop"]),
                full_validated["positionClosing"],
                json.dumps(full_validated["breakevenRange"]),
                json.dumps(full_validated["setups"]),
                1 if full_validated.get("shareJournalData") else 0,
                full_validated.get("tradingMode", "both"),
                full_validated.get("defaultSizePct"),
                full_validated.get("defaultRMultipleTarget"),
                full_validated.get("maxRiskPerTradePct"),
                now, account_id, user_id,
            ),
        )
```

The two INSERT paths (`get_or_migrate_default_account`, `create_account`) **don't need changes** — Phase A defaults are all `None`, and SQLite uses NULL for unset nullable columns. Confirmed by reading the existing INSERT statements that don't list the new columns.

- [ ] **Step 4: Run all account tests**

```bash
python -m pytest api/services/journal_two/test_accounts.py -q
```

Expected: PASS — all 23+1 tests green.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/accounts.py api/services/journal_two/test_accounts.py
git commit -m "feat(j2-discipline): persist Phase A guard settings on j2_accounts"
```

---

## Task 4: Frontend pure-function library

**Files:**
- Create: `app/src/pages/journal-2-0/lib/disciplineGuards.js`
- Test: `app/src/pages/journal-2-0/lib/disciplineGuards.test.js`

- [ ] **Step 1: Write the failing tests**

Create `app/src/pages/journal-2-0/lib/disciplineGuards.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  computeDefaultShares,
  computeSuggestedTarget,
  computeImpliedRiskPct,
} from './disciplineGuards'

describe('computeDefaultShares', () => {
  it('returns null when any input missing', () => {
    expect(computeDefaultShares({ accountSize: null, defaultSizePct: 5, entryPrice: 100 })).toBeNull()
    expect(computeDefaultShares({ accountSize: 100_000, defaultSizePct: null, entryPrice: 100 })).toBeNull()
    expect(computeDefaultShares({ accountSize: 100_000, defaultSizePct: 5, entryPrice: 0 })).toBeNull()
  })
  it('returns floor(positionDollars / entryPrice)', () => {
    // 5% of 100k = 5000; at $100 = 50 shares
    expect(computeDefaultShares({ accountSize: 100_000, defaultSizePct: 5, entryPrice: 100 })).toBe(50)
    // 5% of 100k = 5000; at $33 = 151.51 → floor = 151
    expect(computeDefaultShares({ accountSize: 100_000, defaultSizePct: 5, entryPrice: 33 })).toBe(151)
  })
})

describe('computeSuggestedTarget', () => {
  it('returns null when any input missing', () => {
    expect(computeSuggestedTarget({ side: 'Long', entryPrice: 100, stopPrice: 95, rMultiple: null })).toBeNull()
    expect(computeSuggestedTarget({ side: 'Long', entryPrice: 100, stopPrice: null, rMultiple: 2 })).toBeNull()
  })
  it('long: target = entry + R × (entry - stop)', () => {
    // 2R: stop $95 → risk $5/sh → target = 100 + 2*5 = 110
    expect(computeSuggestedTarget({ side: 'Long', entryPrice: 100, stopPrice: 95, rMultiple: 2 })).toBeCloseTo(110)
  })
  it('short: target = entry - R × (stop - entry)', () => {
    // 2R short: entry 100, stop 105 → risk $5/sh → target = 100 - 2*5 = 90
    expect(computeSuggestedTarget({ side: 'Short', entryPrice: 100, stopPrice: 105, rMultiple: 2 })).toBeCloseTo(90)
  })
})

describe('computeImpliedRiskPct', () => {
  it('returns null when any input missing or zero', () => {
    expect(computeImpliedRiskPct({ accountSize: null, shares: 50, entryPrice: 100, stopPrice: 95, side: 'Long' })).toBeNull()
    expect(computeImpliedRiskPct({ accountSize: 100_000, shares: 0, entryPrice: 100, stopPrice: 95, side: 'Long' })).toBeNull()
  })
  it('long: risk% = shares × (entry - stop) / accountSize × 100', () => {
    // 50 sh × $5 risk = $250, on $100k = 0.25%
    expect(computeImpliedRiskPct({ accountSize: 100_000, shares: 50, entryPrice: 100, stopPrice: 95, side: 'Long' })).toBeCloseTo(0.25)
  })
  it('short: risk% = shares × (stop - entry) / accountSize × 100', () => {
    expect(computeImpliedRiskPct({ accountSize: 100_000, shares: 50, entryPrice: 100, stopPrice: 105, side: 'Short' })).toBeCloseTo(0.25)
  })
  it('returns null when stop on wrong side of entry (long stop above)', () => {
    expect(computeImpliedRiskPct({ accountSize: 100_000, shares: 50, entryPrice: 100, stopPrice: 105, side: 'Long' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd app && npx vitest run src/pages/journal-2-0/lib/disciplineGuards.test.js
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the library**

Create `app/src/pages/journal-2-0/lib/disciplineGuards.js`:

```js
/**
 * Pure helpers for the J2 entry-guard layer (Phase A).
 * No React, no fetch — just math. Reused by AddPositionModal + AddTradeModal.
 */

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Pre-fill suggested share count from default size %. Floor to whole shares. */
export function computeDefaultShares({ accountSize, defaultSizePct, entryPrice }) {
  const acct = numOrNull(accountSize)
  const pct = numOrNull(defaultSizePct)
  const entry = numOrNull(entryPrice)
  if (!acct || !pct || !entry || entry <= 0) return null
  const positionDollars = acct * (pct / 100)
  return Math.floor(positionDollars / entry)
}

/** Display-only suggested-target price from R-multiple goal. */
export function computeSuggestedTarget({ side, entryPrice, stopPrice, rMultiple }) {
  const entry = numOrNull(entryPrice)
  const stop = numOrNull(stopPrice)
  const r = numOrNull(rMultiple)
  if (!entry || stop === null || !r) return null
  if (side === 'Long') {
    if (stop >= entry) return null
    return entry + r * (entry - stop)
  }
  if (side === 'Short') {
    if (stop <= entry) return null
    return entry - r * (stop - entry)
  }
  return null
}

/** Implied $ risk as % of account, given current form values. Null if not computable. */
export function computeImpliedRiskPct({ accountSize, shares, entryPrice, stopPrice, side }) {
  const acct = numOrNull(accountSize)
  const sh = numOrNull(shares)
  const entry = numOrNull(entryPrice)
  const stop = numOrNull(stopPrice)
  if (!acct || acct <= 0 || !sh || sh <= 0 || !entry || stop === null) return null
  const perShare = side === 'Long' ? entry - stop : stop - entry
  if (perShare <= 0) return null  // stop on wrong side
  const dollarRisk = sh * perShare
  return (dollarRisk / acct) * 100
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
npx vitest run src/pages/journal-2-0/lib/disciplineGuards.test.js
```

Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/disciplineGuards.js app/src/pages/journal-2-0/lib/disciplineGuards.test.js
git commit -m "feat(j2-discipline): pure-function library for entry guard math"
```

---

## Task 5: Settings modal — Entry Defaults & Guards section

**Files:**
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx`

- [ ] **Step 1: Add three controlled-input states**

After the existing `tradingMode` state (~line 84):

```jsx
  const [defaultSizePct, setDefaultSizePct] = useState(
    settings?.defaultSizePct == null ? '' : String(settings.defaultSizePct),
  )
  const [defaultRMultipleTarget, setDefaultRMultipleTarget] = useState(
    settings?.defaultRMultipleTarget == null ? '' : String(settings.defaultRMultipleTarget),
  )
  const [maxRiskPerTradePct, setMaxRiskPerTradePct] = useState(
    settings?.maxRiskPerTradePct == null ? '' : String(settings.maxRiskPerTradePct),
  )
```

- [ ] **Step 2: Include in payload + dependency array**

In `handleSave`'s `payload`, add:

```jsx
      defaultSizePct: defaultSizePct === '' ? null : Number(defaultSizePct),
      defaultRMultipleTarget: defaultRMultipleTarget === '' ? null : Number(defaultRMultipleTarget),
      maxRiskPerTradePct: maxRiskPerTradePct === '' ? null : Number(maxRiskPerTradePct),
```

In the `useCallback` deps array, add: `defaultSizePct, defaultRMultipleTarget, maxRiskPerTradePct`.

- [ ] **Step 3: Add the section JSX**

Insert immediately AFTER the existing TRADE TYPES section (so it sits between TRADE TYPES and DEFAULT STOP):

```jsx
          {/* ENTRY DEFAULTS & GUARDS — Phase A */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>ENTRY DEFAULTS & GUARDS</h3>
            <p className={styles.helper}>
              Auto-fill the Add Position form and warn when implied risk
              exceeds your cap. Leave any field blank to disable that guard.
            </p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Default Position Size (% of account)</span>
              <input
                type="number"
                min="0.1"
                max="99.9"
                step="0.1"
                value={defaultSizePct}
                onChange={(e) => setDefaultSizePct(e.target.value)}
                placeholder="e.g. 5"
                className={styles.numberInput}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Default Target (R multiple)</span>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={defaultRMultipleTarget}
                onChange={(e) => setDefaultRMultipleTarget(e.target.value)}
                placeholder="e.g. 2"
                className={styles.numberInput}
              />
              <span className={styles.helper}>
                Display only — Add Position will show a suggested target line
                computed from entry, stop, and this multiple.
              </span>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Max Risk Per Trade (% of account)</span>
              <input
                type="number"
                min="0.05"
                max="50"
                step="0.05"
                value={maxRiskPerTradePct}
                onChange={(e) => setMaxRiskPerTradePct(e.target.value)}
                placeholder="e.g. 1"
                className={styles.numberInput}
              />
              <span className={styles.helper}>
                Add Position will block save with a red banner when implied
                $ risk exceeds this cap (Override available).
              </span>
            </label>
          </section>

```

- [ ] **Step 4: Manually open the modal in dev to verify rendering**

Run `cd app && npm run dev`, open J2 → Settings, confirm the three new fields render with empty values for an existing account, and that saving + re-opening preserves them.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx
git commit -m "feat(j2-discipline): Entry Defaults & Guards section in Portfolio Settings"
```

---

## Task 6: AddPositionModal — auto-prefill shares + suggested target

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx`

- [ ] **Step 1: Import the helper functions**

At the top of the file:

```jsx
import {
  computeDefaultShares,
  computeSuggestedTarget,
  computeImpliedRiskPct,
} from '../lib/disciplineGuards'
```

- [ ] **Step 2: Track whether the user has edited Shares**

After `const [shares, setShares] = useState('')` add:

```jsx
  const [sharesUserEdited, setSharesUserEdited] = useState(false)
```

Bind `onChange` of the shares `<input>` to set both:

```jsx
  // In the existing shares input onChange:
  onChange={(e) => { setShares(e.target.value); setSharesUserEdited(true) }}
```

(Find the existing onChange line for the shares input around line 280-310 and update it.)

- [ ] **Step 3: Effect to auto-prefill shares**

Below the existing stop-prefill effects:

```jsx
  // Auto-prefill shares from settings.defaultSizePct on entryPrice change.
  // Never overwrites a user-edited value.
  useEffect(() => {
    if (sharesUserEdited) return
    const computed = computeDefaultShares({
      accountSize: settings?.accountSize,
      defaultSizePct: settings?.defaultSizePct,
      entryPrice,
    })
    if (computed != null && computed > 0) {
      setShares(String(computed))
    }
  }, [entryPrice, settings?.accountSize, settings?.defaultSizePct, sharesUserEdited])
```

- [ ] **Step 4: Compute suggested target + render below stop input**

Add near the bottom of the return, after the stop input row but before the Setup field:

```jsx
  const suggestedTarget = computeSuggestedTarget({
    side,
    entryPrice,
    stopPrice,
    rMultiple: settings?.defaultRMultipleTarget,
  })
```

In the JSX, after the stop input block, add:

```jsx
            {suggestedTarget != null && (
              <p className={styles.helperLine} style={{ color: 'var(--ut-gold)' }}>
                Suggested target ({settings.defaultRMultipleTarget}R):
                {' '}<strong>${suggestedTarget.toFixed(2)}</strong>
              </p>
            )}
```

Use whatever helper class is consistent with adjacent helpers — if `helperLine` doesn't exist, fall back to inline `style={{ fontSize: 12, color: 'var(--ut-gold)', marginTop: 4 }}`.

- [ ] **Step 5: Manual verification**

Open AddPosition modal in an account that has `defaultSizePct=5`, `defaultRMultipleTarget=2` set:
- Type entry $100 → Shares auto-fills to 50 (assuming $100k account).
- Type Stop $95 → "Suggested target (2R): $110.00" appears in gold.
- Manually type 30 in Shares → subsequent entry-price changes don't overwrite the 30.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/journal-2-0/components/AddPositionModal.jsx
git commit -m "feat(j2-discipline): auto-prefill shares + show suggested R-target in AddPosition"
```

---

## Task 7: AddPositionModal — risk-cap banner + soft-block

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx`

- [ ] **Step 1: Compute implied risk + breach state**

Below the `suggestedTarget` computation:

```jsx
  const impliedRiskPct = computeImpliedRiskPct({
    accountSize: settings?.accountSize,
    shares,
    entryPrice,
    stopPrice,
    side,
  })
  const cap = settings?.maxRiskPerTradePct
  const overCap = cap != null && impliedRiskPct != null && impliedRiskPct > cap

  const [overrideArmed, setOverrideArmed] = useState(false)
  // Reset override when inputs change (so a user can't arm-then-edit-up risk)
  useEffect(() => { setOverrideArmed(false) }, [shares, entryPrice, stopPrice, side])
```

- [ ] **Step 2: Render banner**

Insert just above the existing error banner / footer:

```jsx
          {overCap && (
            <div
              role="alert"
              style={{
                margin: '0 0 12px',
                padding: '10px 14px',
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid var(--loss, #ef4444)',
                borderRadius: 8,
                color: 'var(--loss, #ef4444)',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <strong>Over risk cap.</strong>{' '}
              Implied risk <strong>{impliedRiskPct.toFixed(2)}%</strong> exceeds
              your cap of <strong>{cap}%</strong>.{' '}
              {overrideArmed
                ? 'Override armed — Save will commit anyway.'
                : (
                  <button
                    type="button"
                    onClick={() => setOverrideArmed(true)}
                    style={{
                      marginLeft: 6, padding: '2px 10px',
                      background: 'transparent',
                      border: '1px solid var(--loss, #ef4444)',
                      color: 'var(--loss, #ef4444)',
                      borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    Override
                  </button>
                )}
            </div>
          )}
```

- [ ] **Step 3: Disable Save when capped + not overridden**

Locate the existing Save `<button>` in the footer. Change its `disabled` prop to OR-in the cap check:

```jsx
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleSave}
            disabled={saving || (overCap && !overrideArmed)}
          >
            {saving ? 'Saving…' : 'Add Position'}
          </button>
```

- [ ] **Step 4: Manual verification**

With `maxRiskPerTradePct=1` set and a $100k account:
- Type 50 shares, entry $100, stop $90 → implied risk = 50×$10 = $500 = 0.5% → no banner.
- Edit stop to $80 → implied risk = $1000 = 1.0% → still at cap, no banner.
- Edit stop to $75 → 1.25% → red banner, Save disabled.
- Click Override → banner says "Override armed", Save enabled.
- Edit stop back to $80 → override resets, banner gone.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/AddPositionModal.jsx
git commit -m "feat(j2-discipline): risk-cap banner + soft-block in AddPosition"
```

---

## Task 8: AddTradeModal — risk-cap banner

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddTradeModal.jsx`

AddTrade is for already-closed trades — the user has actual entry, stop, exit, and shares. Same banner pattern, but no `overrideArmed` reset on input change is needed (no auto-prefill flow). Still allow override.

- [ ] **Step 1: Open the file and locate the form fields**

Look for the entry/stop/shares inputs and confirm they exist. AddTradeModal should already have `entryPrice`, `stopPrice` (or `originalStop`), `shares`, and `side` state.

- [ ] **Step 2: Import and compute**

Mirror Task 7 Steps 1-3:

```jsx
import { computeImpliedRiskPct } from '../lib/disciplineGuards'

// In component body:
const impliedRiskPct = computeImpliedRiskPct({
  accountSize: settings?.accountSize,
  shares,
  entryPrice,
  stopPrice: originalStop,  // adjust to whichever field name the modal uses
  side,
})
const cap = settings?.maxRiskPerTradePct
const overCap = cap != null && impliedRiskPct != null && impliedRiskPct > cap
const [overrideArmed, setOverrideArmed] = useState(false)
useEffect(() => { setOverrideArmed(false) }, [shares, entryPrice, originalStop, side])
```

- [ ] **Step 3: Same banner JSX + same Save-disabled rule as Task 7**

Copy the banner block verbatim. Apply `disabled={saving || (overCap && !overrideArmed)}` to Save.

- [ ] **Step 4: Manual verification**

Open AddTrade modal, type entry/stop/shares values that exceed cap → banner + soft block visible. Override works.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/AddTradeModal.jsx
git commit -m "feat(j2-discipline): risk-cap banner + soft-block in AddTrade"
```

---

## Task 9: Frontend modal test — settings round-trip

**Files:**
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx`

- [ ] **Step 1: Add a test for guard fields shipping in payload**

Append to the test file:

```jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

it('Phase A guard inputs ship in the save payload', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn().mockResolvedValue({})
  render(
    <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={vi.fn()} />,
  )

  const sizeInput = screen.getByLabelText(/Default Position Size/i)
  const rInput = screen.getByLabelText(/Default Target \(R multiple\)/i)
  const capInput = screen.getByLabelText(/Max Risk Per Trade/i)

  await user.clear(sizeInput); await user.type(sizeInput, '5')
  await user.clear(rInput); await user.type(rInput, '2')
  await user.clear(capInput); await user.type(capInput, '1')

  await user.click(screen.getByRole('button', { name: 'Save Settings' }))

  expect(onSave).toHaveBeenCalledTimes(1)
  const payload = onSave.mock.calls[0][0]
  expect(payload.defaultSizePct).toBe(5)
  expect(payload.defaultRMultipleTarget).toBe(2)
  expect(payload.maxRiskPerTradePct).toBe(1)
})
```

- [ ] **Step 2: Run**

```bash
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

Expected: PASS — 14 tests (was 13).

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
git commit -m "test(j2-discipline): assert Phase A guard fields round-trip via Save Settings"
```

---

## Task 10: End-to-end smoke + push

- [ ] **Step 1: Full backend test pass**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: PASS — all journal_two tests green.

- [ ] **Step 2: Full frontend build**

```bash
cd app && npm run build
```

Expected: clean build, no errors.

- [ ] **Step 3: Frontend test suite**

```bash
npx vitest run src/pages/journal-2-0
```

Expected: PASS.

- [ ] **Step 4: Manual smoke in dev server**

Start `cd app && npm run dev` and `uvicorn api.main:app --reload --port 8000`. Walk through:
1. Open J2 → Settings → fill all three guard fields → Save.
2. Re-open Settings → values persist.
3. Open Add Position → entry $100 auto-fills shares. Type stop $95 → suggested target appears.
4. Push stop further away → over-cap banner appears, Save disabled.
5. Click Override → Save enabled.
6. Open Add Trade → enter values that exceed cap → banner appears.
7. Switch accounts → if other account has no guards set, modals behave like before (no banner, no prefill).

- [ ] **Step 5: Final commit + push to Railway**

```bash
git push origin master
```

(All commits from Tasks 1-9 already on master from per-task commits — push lands them all together. Per `feedback_always_push.md`, no separate "release commit" needed.)

---

## Self-Review Checklist (run before handoff)

- [ ] Every spec requirement (3 settings + 4 UI behaviors: prefill, suggested target, banner, soft-block) maps to a task.
- [ ] No "TBD" / "implement appropriately" / "similar to" placeholders.
- [ ] Function names match across tasks: `computeDefaultShares`, `computeSuggestedTarget`, `computeImpliedRiskPct`.
- [ ] Settings shape consistent: `defaultSizePct`, `defaultRMultipleTarget`, `maxRiskPerTradePct` (camelCase API, snake_case columns: `default_size_pct`, `default_r_multiple_target`, `max_risk_per_trade_pct`).
- [ ] Phase A is isolated — no Phase B/C/D state machine assumed; settings sit alongside existing fields.
