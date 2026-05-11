# Journal 2.0 Discipline — Phase D: Regime-Aware Sizing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkbox syntax.

**Goal:** Multiply the Phase A default position size by a user-defined regime multiplier (green/amber/orange/red) so trades automatically size down in hostile markets. Stamp the active regime on every new trade so future analytics can answer "win rate by regime?"

**Architecture:**
- One new per-account setting `regimeSizeMultipliers` (JSON object with `green`/`amber`/`orange`/`red` keys, each nullable).
- One new column on `j2_trades`: `regime TEXT` nullable. Set at INSERT time from current wire_data.
- New backend service `regime.py` classifying `wire_data["exposure"]["score"]` into `green | amber | orange | red`.
- New endpoint `GET /api/j2/regime`.
- New SWR hook (5-min refresh — regime classification updates infrequently).
- AddPositionModal: when regime is known AND multiplier configured, apply to `defaultSizePct` prefill + show a banner.
- `trades.py` (closure flow): stamp the active regime at INSERT.

**Tech Stack:** SQLite, FastAPI, React + SWR, vitest, pytest.

**Regime classification (matches existing UCT thresholds):**
- `score >= 90` → `green`
- `score >= 50` → `amber`
- `score >= 15` → `orange`
- else (`< 15` or unknown) → `red`

When exposure data is missing entirely, regime is `null` and the feature is a no-op.

**Multiplier defaults (when user opts in):**
- green: 1.0 (no scaling)
- amber: 0.75
- orange: 0.5
- red: 0 (effectively skip; banner shows "RED regime — entry blocked at size 0. Override?")

User can configure any/all four. Missing keys = "no scaling for that regime."

---

## File map

**Backend:**
- Modify: `api/services/journal_two/db.py` — 2 ALTERs
- Modify: `api/services/journal_two/settings.py` — extend defaults + validator
- Modify: `api/services/journal_two/accounts.py` — round-trip
- Create: `api/services/journal_two/regime.py` — `classify_regime(score)` + `get_current_regime()`
- Create: `api/services/journal_two/test_regime.py`
- Modify: `api/services/journal_two/trades.py` — stamp `regime` at INSERT
- Modify: `api/routers/journal_two.py` — `GET /regime` endpoint

**Frontend:**
- Create: `app/src/pages/journal-2-0/hooks/useJ2CurrentRegime.js`
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx` — 4 number inputs
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx` — apply multiplier + banner
- Test: extend `PortfolioSettingsModal.test.jsx`

---

## Settings shape (canonical, after this phase)

```js
{
  // ... existing Phase A/B/C ...
  regimeSizeMultipliers: {},   // {green?, amber?, orange?, red?} — all keys optional
}
```

## Current-regime response

```json
{
  "regime": "amber",
  "score": 62.4,
  "source": "wire_data",
  "asOf": "2026-05-10T07:35:00-04:00"
}
```

When no wire_data: `{regime: null, score: null, source: null, asOf: null}`.

---

## Task 1: Backend schema

**Files:** `api/services/journal_two/db.py`

- [ ] **Step 1: Append 2 ALTERs**

After the Phase C block:

```python
    # Phase D — Regime-Aware Sizing
    "ALTER TABLE j2_accounts ADD COLUMN regime_size_multipliers TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE j2_trades ADD COLUMN regime TEXT",
```

- [ ] **Step 2: Run accounts tests, expect no regression**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/test_accounts.py -q
```

Expected: 26 passing.

- [ ] **Step 3: Commit**

```bash
git add api/services/journal_two/db.py
git commit -m "feat(j2-discipline): add Phase D columns (regime_size_multipliers + j2_trades.regime)"
```

---

## Task 2: Settings validator

**Files:** `api/services/journal_two/settings.py`, `test_settings.py`

- [ ] **Step 1: Append failing tests**

```python
def test_validate_accepts_phase_d_regime_multipliers():
    from api.services.journal_two import settings as svc
    payload = _baseline_payload() | {
        "regimeSizeMultipliers": {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0},
    }
    out = svc.validate_settings_payload(payload)
    assert out["regimeSizeMultipliers"] == {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0.0}


def test_validate_phase_d_partial_multipliers():
    from api.services.journal_two import settings as svc
    # Only setting two of the four is fine
    out = svc.validate_settings_payload(_baseline_payload() | {
        "regimeSizeMultipliers": {"orange": 0.5, "red": 0},
    })
    assert out["regimeSizeMultipliers"] == {"orange": 0.5, "red": 0.0}


def test_validate_phase_d_defaults_to_empty_dict():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["regimeSizeMultipliers"] == {}


def test_validate_phase_d_rejects_invalid():
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    base = _baseline_payload()
    invalid = [
        {"regimeSizeMultipliers": "green"},                       # not a dict
        {"regimeSizeMultipliers": {"foo": 1.0}},                  # unknown key
        {"regimeSizeMultipliers": {"green": -0.1}},               # negative
        {"regimeSizeMultipliers": {"green": 5.1}},                # >5x
        {"regimeSizeMultipliers": {"green": "1.0"}},              # string instead of number
    ]
    for bad in invalid:
        with pytest.raises(SettingsValidationError):
            svc.validate_settings_payload(base | bad)
```

Run, expect failures.

- [ ] **Step 2: Implement helper**

In `settings.py`, after the existing helpers:

```python
_VALID_REGIME_KEYS = {"green", "amber", "orange", "red"}


def _validate_regime_multipliers(value: Any) -> dict[str, float]:
    """Object with optional green/amber/orange/red keys, values in [0, 5].
    Empty/None = {} (disabled). Unknown keys are rejected."""
    if value is None or value == "":
        return {}
    if not isinstance(value, dict):
        raise SettingsValidationError("regimeSizeMultipliers must be an object")
    out: dict[str, float] = {}
    for k, v in value.items():
        if k not in _VALID_REGIME_KEYS:
            raise SettingsValidationError(
                f"regimeSizeMultipliers: unknown regime '{k}' (must be one of {sorted(_VALID_REGIME_KEYS)})"
            )
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise SettingsValidationError(f"regimeSizeMultipliers.{k} must be a number")
        f = float(v)
        if f < 0 or f > 5:
            raise SettingsValidationError(f"regimeSizeMultipliers.{k} must be in [0, 5]")
        out[k] = f
    return out
```

Extend `default_settings_data()`:

```python
        "aPlusRiskMultiplier": None,
        # Phase D — Regime-Aware Sizing
        "regimeSizeMultipliers": {},
    }
```

Extend `validate_settings_payload` return:

```python
        "aPlusRiskMultiplier": _validate_optional_multiplier(
            payload.get("aPlusRiskMultiplier"), "aPlusRiskMultiplier",
        ),
        # Phase D
        "regimeSizeMultipliers": _validate_regime_multipliers(payload.get("regimeSizeMultipliers", {})),
    }
```

- [ ] **Step 3: Run, watch pass**

```bash
python -m pytest api/services/journal_two/test_settings.py -q
```

Expected: 29 passing (25 prior + 4 new).

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/settings.py api/services/journal_two/test_settings.py
git commit -m "feat(j2-discipline): validate Phase D regimeSizeMultipliers"
```

---

## Task 3: accounts.py round-trip

**Files:** `api/services/journal_two/accounts.py`, `test_accounts.py`

- [ ] **Step 1: Append failing test**

```python
def test_phase_d_regime_multipliers_roundtrip(db_conn):
    user_id = "u_phase_d_roundtrip"
    account = accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "regimeSizeMultipliers": {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0},
    }
    saved = accounts_service.upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["regimeSizeMultipliers"] == {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0.0}

    fresh = accounts_service.get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["regimeSizeMultipliers"] == {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0.0}
```

- [ ] **Step 2: Wire reads/writes in accounts.py**

In `_default_settings_block()`, append:
```python
        "aPlusRiskMultiplier": None,
        "regimeSizeMultipliers": {},
    }
```

In `_account_to_settings()` return dict, append:
```python
            "aPlusRiskMultiplier": row["a_plus_risk_multiplier"] if "a_plus_risk_multiplier" in keys else None,
            "regimeSizeMultipliers": json.loads(row["regime_size_multipliers"]) if "regime_size_multipliers" in keys else {},
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
```

In `upsert_account_settings()` UPDATE, extend SET + tuple. Add column AFTER `a_plus_risk_multiplier`:

```python
                   a_plus_risk_multiplier = ?,
                   regime_size_multipliers = ?,
                   updated_at = ?
```

Tuple values:
```python
                full_validated.get("aPlusRiskMultiplier"),
                json.dumps(full_validated.get("regimeSizeMultipliers", {})),
                now, account_id, user_id,
```

- [ ] **Step 3: Run tests**

```bash
python -m pytest api/services/journal_two/test_accounts.py -q
```

Expected: 27 passing.

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/accounts.py api/services/journal_two/test_accounts.py
git commit -m "feat(j2-discipline): persist Phase D regimeSizeMultipliers on j2_accounts"
```

---

## Task 4: regime.py service

**Files:** `api/services/journal_two/regime.py`, `test_regime.py`

- [ ] **Step 1: Write failing tests**

Create `api/services/journal_two/test_regime.py`:

```python
"""Tests for the Phase D regime classifier."""
from __future__ import annotations

import pytest


def test_classify_regime_thresholds():
    from api.services.journal_two import regime
    assert regime.classify_regime(None) is None
    assert regime.classify_regime(150) == "green"
    assert regime.classify_regime(90) == "green"
    assert regime.classify_regime(89) == "amber"
    assert regime.classify_regime(50) == "amber"
    assert regime.classify_regime(49) == "orange"
    assert regime.classify_regime(15) == "orange"
    assert regime.classify_regime(14) == "red"
    assert regime.classify_regime(0) == "red"


def test_get_current_regime_handles_missing_wire(monkeypatch):
    """When wire_data is empty / unavailable, return null shape."""
    from api.services.journal_two import regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: None)
    out = regime.get_current_regime()
    assert out["regime"] is None
    assert out["score"] is None


def test_get_current_regime_reads_exposure_score(monkeypatch):
    from api.services.journal_two import regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: {
        "score": 72.5,
        "as_of": "2026-05-10T07:35:00-04:00",
    })
    out = regime.get_current_regime()
    assert out["regime"] == "amber"
    assert out["score"] == 72.5
```

Run, expect ImportError.

- [ ] **Step 2: Implement**

Create `api/services/journal_two/regime.py`:

```python
"""
Journal 2.0 — current-regime classifier (Phase D).

Pure-ish read against the wire_data cache. Classifies the UCT Exposure
Rating score (0–150) into one of four regime labels matching the existing
Breadth Monitor thresholds:

  score >= 90 → "green"
  score >= 50 → "amber"
  score >= 15 → "orange"
  else        → "red"

When wire_data is unavailable, returns regime=None (feature no-ops).
"""

from __future__ import annotations

from typing import Any


def classify_regime(score: float | None) -> str | None:
    if score is None:
        return None
    s = float(score)
    if s >= 90:
        return "green"
    if s >= 50:
        return "amber"
    if s >= 15:
        return "orange"
    return "red"


def _read_exposure() -> dict | None:
    """Read the exposure block from the wire_data cache; None if missing."""
    try:
        from api.services import engine as engine_service
    except Exception:
        return None
    try:
        breadth = engine_service.get_breadth()
    except Exception:
        return None
    exp = (breadth or {}).get("exposure")
    if not exp or exp.get("score") is None:
        return None
    return exp


def get_current_regime() -> dict[str, Any]:
    """Return the current regime label + raw score, or null fields."""
    exp = _read_exposure()
    if exp is None:
        return {"regime": None, "score": None, "source": None, "asOf": None}
    return {
        "regime": classify_regime(exp.get("score")),
        "score": float(exp.get("score")),
        "source": "wire_data",
        "asOf": exp.get("as_of") or exp.get("date"),
    }
```

- [ ] **Step 3: Run tests**

```bash
python -m pytest api/services/journal_two/test_regime.py -q
python -m pytest api/services/journal_two/ -q
```

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/regime.py api/services/journal_two/test_regime.py
git commit -m "feat(j2-discipline): regime classifier service for Phase D sizing"
```

---

## Task 5: Regime endpoint

**Files:** `api/routers/journal_two.py`

- [ ] **Step 1: Add import + endpoint**

Import:
```python
from api.services.journal_two import regime as regime_service
```

Endpoint (after the setup-stats route or wherever feels appropriate near the discipline routes):

```python
@router.get("/regime")
def get_current_regime_route(
    user: dict = Depends(get_current_user),
):
    """Current UCT regime label + score. Unaffected by account; cached
    in the wire_data layer at the engine push cadence."""
    return regime_service.get_current_regime()
```

(No path param, no query — the regime is a global value driven by the daily engine push.)

- [ ] **Step 2: Verify**

```bash
python -c "from api.routers import journal_two; print('OK')"
python -m pytest api/services/journal_two/ -q
```

- [ ] **Step 3: Commit**

```bash
git add api/routers/journal_two.py
git commit -m "feat(j2-discipline): GET /regime endpoint"
```

---

## Task 6: trades.py stamps regime at INSERT

**Files:** `api/services/journal_two/trades.py`

- [ ] **Step 1: Read the file to locate the j2_trades INSERT statements**

Look for `INSERT INTO j2_trades`. There are two — both should stamp `regime` at write time.

- [ ] **Step 2: Add regime to both INSERT paths**

For each INSERT statement:
1. Add `regime` to the column list.
2. Add a placeholder `?` to the VALUES.
3. Add `regime_service.get_current_regime().get("regime")` to the parameter tuple.

Add the import at the top of `trades.py`:
```python
from api.services.journal_two import regime as regime_service
```

Example structural pattern (adapt to whatever the actual INSERT looks like — column lists and tuples will differ):

```python
conn.execute(
    """
    INSERT INTO j2_trades (
        id, user_id, position_id, symbol, side, shares,
        entry_price, entry_date, exit_price, exit_date,
        original_stop, setup, notes, pnl_dollar, pnl_percent,
        r_multiple, hold_days, result, context_at_entry,
        created_at, account_id, regime
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
    (
        # ... existing values ...,
        regime_service.get_current_regime().get("regime"),
    ),
)
```

Apply to BOTH INSERT statements in the file.

- [ ] **Step 3: Verify nothing broke**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: all tests still pass. Existing trade-creation tests don't assert on `regime`, but they should keep working — the regime function returns `None` when wire_data is absent (typical in tests), so the column gets NULL.

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/trades.py
git commit -m "feat(j2-discipline): stamp regime on j2_trades INSERT for future analytics"
```

---

## Task 7: useJ2CurrentRegime hook

**Files:** `app/src/pages/journal-2-0/hooks/useJ2CurrentRegime.js`

- [ ] **Step 1: Create**

```js
/**
 * SWR hook: current UCT regime classification.
 * 5-minute refresh — regime updates infrequently (engine push runs daily).
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2CurrentRegime() {
  const { data, error, isLoading } = useSWR('/api/j2/regime', fetcher, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return { regime: data, isLoading, error }
}
```

- [ ] **Step 2: Build verify, commit**

```bash
cd C:/Users/Patrick/uct-dashboard/app && npm run build
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/hooks/useJ2CurrentRegime.js
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-discipline): useJ2CurrentRegime hook (5-min refresh)"
```

---

## Task 8: PortfolioSettingsModal — regime multipliers section

**Files:** `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx`

- [ ] **Step 1: Add state**

After Phase C states (`aPlusRiskMultiplier`):

```jsx
  const [regimeSizeMultipliers, setRegimeSizeMultipliers] = useState(() => {
    const seed = settings?.regimeSizeMultipliers || {}
    return {
      green: seed.green == null ? '' : String(seed.green),
      amber: seed.amber == null ? '' : String(seed.amber),
      orange: seed.orange == null ? '' : String(seed.orange),
      red: seed.red == null ? '' : String(seed.red),
    }
  })
```

- [ ] **Step 2: Payload + deps**

In `handleSave` payload, after `aPlusRiskMultiplier`:

```jsx
      aPlusRiskMultiplier: aPlusRiskMultiplier === '' ? null : Number(aPlusRiskMultiplier),
      regimeSizeMultipliers: Object.fromEntries(
        Object.entries(regimeSizeMultipliers)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => [k, Number(v)])
      ),
```

Add `regimeSizeMultipliers` to the `useCallback` deps array (after `aPlusRiskMultiplier`).

- [ ] **Step 3: Add section after SETUP-AWARE COACHING**

```jsx
          {/* REGIME-AWARE SIZING — Phase D */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>REGIME-AWARE SIZING</h3>
            <p className={styles.helper}>
              Auto-scale Default Position Size based on UCT regime. Multiplier
              of <code>0.5</code> = 50% normal size, <code>0</code> = skip
              entries in that regime. Leave blank to skip scaling for any
              regime.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '8px 0' }}>
              {[
                { key: 'green', label: 'GREEN', tint: '#22c55e' },
                { key: 'amber', label: 'AMBER', tint: '#fbbf24' },
                { key: 'orange', label: 'ORANGE', tint: '#fb923c' },
                { key: 'red', label: 'RED', tint: '#ef4444' },
              ].map(({ key, label, tint }) => (
                <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, color: tint }}>
                    {label}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="0.05"
                    value={regimeSizeMultipliers[key]}
                    onChange={(e) =>
                      setRegimeSizeMultipliers((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={key === 'green' ? '1.0' : key === 'amber' ? '0.75' : key === 'orange' ? '0.5' : '0'}
                    className={styles.numberInput}
                  />
                </label>
              ))}
            </div>
          </section>

```

Insert immediately AFTER the SETUP-AWARE COACHING `</section>` close, BEFORE the `{/* 5.2 DEFAULT STOP */}` comment.

- [ ] **Step 4: Build + tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

Expected: clean; 16 pass.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-discipline): REGIME-AWARE SIZING section in Portfolio Settings"
```

---

## Task 9: AddPositionModal — apply regime multiplier + banner

**Files:** `app/src/pages/journal-2-0/components/AddPositionModal.jsx`

- [ ] **Step 1: Imports**

```jsx
import useJ2CurrentRegime from '../hooks/useJ2CurrentRegime'
```

- [ ] **Step 2: Hook call**

After the existing setup-stats hook:

```jsx
  const { regime: regimeData } = useJ2CurrentRegime()
  const currentRegime = regimeData?.regime
  const regimeMult = (settings?.regimeSizeMultipliers || {})[currentRegime]
  const regimeMultActive = currentRegime != null && regimeMult != null && regimeMult !== 1
```

- [ ] **Step 3: Adjust the prefill effect**

Find the existing `useEffect` that auto-prefills `shares` from `defaultSizePct`. Currently it calls `computeDefaultShares({ accountSize, defaultSizePct, entryPrice })`. Change the `defaultSizePct` value passed in so it includes the regime multiplier:

```jsx
  useEffect(() => {
    if (sharesUserEdited) return
    const baseSizePct = settings?.defaultSizePct
    const scaledSizePct = (baseSizePct != null && regimeMult != null)
      ? baseSizePct * regimeMult
      : baseSizePct
    const computed = computeDefaultShares({
      accountSize: settings?.accountSize,
      defaultSizePct: scaledSizePct,
      entryPrice,
    })
    if (computed != null && computed > 0) setShares(String(computed))
  }, [entryPrice, settings?.accountSize, settings?.defaultSizePct, regimeMult, sharesUserEdited])
```

When `regimeMult` is 0 (RED regime, skip entries), `scaledSizePct` becomes 0 → `computeDefaultShares` returns 0/0 = 0, the `computed > 0` guard skips the prefill → shares stays blank. The user can manually type shares to override, with the banner explaining why.

- [ ] **Step 4: Render an informational banner above the form**

Find a spot above the form fields (similar placement to the DisciplineLockBanner). Render:

```jsx
          {regimeMultActive && (
            <div
              style={{
                margin: '0 0 12px',
                padding: '8px 12px',
                background: 'rgba(201, 168, 76, 0.08)',
                border: '1px solid rgba(201, 168, 76, 0.35)',
                borderRadius: 6,
                color: 'var(--text-bright)',
                fontSize: 12,
              }}
            >
              🎯 Regime is <strong>{currentRegime.toUpperCase()}</strong>.
              Default size scaled to <strong>{Math.round(regimeMult * 100)}%</strong>
              {regimeMult === 0 && ' — no size prefilled. Override by typing shares manually.'}
            </div>
          )}
```

- [ ] **Step 5: Build + tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

Expected: clean; 16 pass.

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/AddPositionModal.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-discipline): apply regime size multiplier + banner in AddPosition"
```

---

## Task 10: PortfolioSettingsModal Phase D round-trip test

**File:** `app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx`

- [ ] **Step 1: Add a vitest case**

```jsx
it('Phase D regime multipliers ship in the save payload', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn().mockResolvedValue({})
  render(
    <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={vi.fn()} />,
  )

  // Use label text from the regime section
  const greenInput = screen.getByRole('spinbutton', { name: /GREEN/i }).closest('label').querySelector('input')
    || screen.getByLabelText(/GREEN/i)
  // Simpler: use placeholder-based queries since the spinbutton accessibility is wonky in jsdom
  // Try direct: find all number inputs in the regime section by index — but labels are clearer:
  // Actually the <label> wraps <span>GREEN</span><input/> so getByLabelText should work.

  // Cleanest path:
  const greenInputEl = screen.getByLabelText(/GREEN/i)
  await user.clear(greenInputEl)
  await user.type(greenInputEl, '1.0')

  const orangeInputEl = screen.getByLabelText(/ORANGE/i)
  await user.clear(orangeInputEl)
  await user.type(orangeInputEl, '0.5')

  await user.click(screen.getByRole('button', { name: 'Save Settings' }))

  expect(onSave).toHaveBeenCalledTimes(1)
  const payload = onSave.mock.calls[0][0]
  expect(payload.regimeSizeMultipliers).toEqual({ green: 1.0, orange: 0.5 })
})
```

- [ ] **Step 2: Run**

```bash
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

Expected: 17 pass.

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "test(j2-discipline): Phase D regime multipliers round-trip"
```

---

## Task 11: End-to-end smoke + push

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/ -q
cd app
npm run build
npx vitest run src/pages/journal-2-0/
cd ..
git push origin master
```

---

## Self-Review Checklist

- [ ] Schema mapping consistent: `regimeSizeMultipliers` ↔ `regime_size_multipliers`, `regime` column on `j2_trades`.
- [ ] Existing trades-write tests still pass when wire_data is absent (regime stamps as NULL).
- [ ] `regimeMult === 0` blocks the prefill but allows manual override.
- [ ] Banner shows the elevated/scaled %; uppercase regime label.
- [ ] When wire_data is unavailable, useJ2CurrentRegime returns `{regime: null}` and the prefill behaves exactly like Phase A (no scaling).
