# Journal 2.0 Discipline — Phase E: Custom Mistakes + Emotions Taxonomy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Give each account a user-editable list of mistake tags and emotion tags. Capture chosen tags on every closed trade via ClosePositionModal and AddTradeModal. Persist them on `j2_trades` so future Phase G analytics can answer "win rate by mistake" / "P&L by emotion."

**Architecture:**
- 2 new per-account settings (`mistakeTags`, `emotionTags`) — both `string[]`, default `[]`.
- 2 new nullable JSON columns on `j2_trades` (`mistake_tags`, `emotion_tags`).
- Settings UI: 2 new sections with the same chip+add pattern as TRADE SETUPS, plus "Seed standard list" buttons that one-click populate the OLD Journal's 17 mistakes / 15 emotions.
- New shared `TagChipPicker` component for multi-select in the close/add modals.
- ClosePositionModal + AddTradeModal capture chosen tags; trades.py persists them.

**Why:**
- Existing J2 has zero mistake/emotion capture (verified earlier — `grep mistake/emotion` returns no hits in J2 modals).
- Patrick said: "power users hate canned mistake tags; their actual mistakes are personal." Defaults are available as a one-click seed, not forced on.

**Seed lists (offered as one-click "Seed standard" buttons, NOT pre-populated):**
- Mistakes (17): `overtrading`, `FOMO`, `chasing`, `early_exit`, `late_entry`, `no_stop`, `oversized`, `countertrend`, `revenge`, `ignored_thesis`, `added_to_loser`, `cut_winner`, `broke_loss_rule`, `broke_size_rule`, `broke_checklist`, `boredom`, `hesitation`.
- Emotions (15): `confident`, `anxious`, `greedy`, `fearful`, `calm`, `frustrated`, `euphoric`, `bored`, `disciplined`, `impulsive`, `patient`, `rushed`, `focused`, `distracted`, `revenge-driven`.

---

## Settings shape (after this phase)

```js
{
  // ... existing Phase A-D ...
  mistakeTags: [],
  emotionTags: [],
}
```

## Trade payload (close_position + create_trade_manual)

```js
{
  // ... existing fields ...
  mistakeTags?: string[],   // optional; defaults to []
  emotionTags?: string[],   // optional; defaults to []
}
```

---

## Tasks

### Task 1: Schema (2 on `j2_accounts`, 2 on `j2_trades`)

`api/services/journal_two/db.py` — append to `_PHASE_2_ALTERS`:

```python
    # Phase E — Mistakes + Emotions taxonomy
    "ALTER TABLE j2_accounts ADD COLUMN mistake_tags TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE j2_accounts ADD COLUMN emotion_tags TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE j2_trades ADD COLUMN mistake_tags TEXT",
    "ALTER TABLE j2_trades ADD COLUMN emotion_tags TEXT",
```

Test suite must still pass.

### Task 2: Settings validator

Both fields reuse `_validate_string_list` from Phase C. Add to `default_settings_data()` and `validate_settings_payload`:

```python
        # Phase E
        "mistakeTags": _validate_string_list(payload.get("mistakeTags", []), "mistakeTags"),
        "emotionTags": _validate_string_list(payload.get("emotionTags", []), "emotionTags"),
```

Add tests:
- `test_validate_accepts_phase_e_taxonomies`
- `test_validate_phase_e_defaults_to_empty_lists`

### Task 3: accounts.py round-trip

- `_default_settings_block()`: add `mistakeTags: []`, `emotionTags: []`.
- `_account_to_settings()`: add 2 read lines with `json.loads(row["mistake_tags"])` / `json.loads(row["emotion_tags"])` + defensive `in keys` guard.
- `upsert_account_settings()` UPDATE: extend SET + tuple with `mistake_tags = ?` and `emotion_tags = ?`, values from `json.dumps(full_validated.get(...))`.
- Add `test_phase_e_taxonomies_roundtrip`.

### Task 4: trades.py captures mistake_tags + emotion_tags

In trades.py:
1. Read both fields from the trade payload (default `[]`).
2. Validate they're list-of-strings (lightweight — reject non-list, ignore non-string entries).
3. INSERT them as `json.dumps([...])` into the new columns. Apply to ALL THREE INSERT statements found earlier (close_position, create_trade_manual, bulk_insert_trades — though bulk_insert doesn't get the new fields since CSV doesn't carry them; pass `'[]'` literal).
4. UPDATE `_row_to_trade()` (or whatever maps `j2_trades` row → dict) so closed-trade reads expose `mistakeTags` and `emotionTags` (defaulting to `[]` when stored value is null/missing).

Add test: write a trade with mistake_tags=`['fomo']` + emotion_tags=`['euphoric']`, re-read, assert preserved.

### Task 5: Frontend `TagChipPicker.jsx` (new)

Shared component used by ClosePositionModal + AddTradeModal. Props: `available: string[]`, `selected: string[]`, `onChange(next)`, `placeholder?`. Renders chips (active when selected); clicking toggles membership.

```jsx
export default function TagChipPicker({ available, selected, onChange, placeholder }) {
  if (available.length === 0) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
      {placeholder || 'No tags configured. Add some in Settings.'}
    </span>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {available.map((t) => {
        const active = selected.includes(t)
        return (
          <button
            key={t} type="button" aria-pressed={active}
            onClick={() => onChange(active ? selected.filter((x) => x !== t) : [...selected, t])}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: active ? 'var(--ut-gold, #c9a84c)' : 'transparent',
              color: active ? 'var(--bg, #000)' : 'var(--text-bright)',
              border: `1px solid ${active ? 'var(--ut-gold, #c9a84c)' : 'var(--border)'}`,
              borderRadius: 999, cursor: 'pointer',
            }}
          >{active ? '✓ ' : ''}{t}</button>
        )
      })}
    </div>
  )
}
```

Add vitest spec covering: renders chips, clicking toggles, empty-available shows placeholder.

### Task 6: PortfolioSettingsModal — MISTAKES + EMOTIONS sections

Add 2 new states (`mistakeTags`, `emotionTags`), wired into payload + deps. Add 2 new sections after REGIME-AWARE SIZING that mirror the existing TRADE SETUPS chip+add pattern. Each section gets a "+ Seed standard 17/15" button that appends the canonical list (de-duplicated against current contents).

### Task 7: ClosePositionModal + AddTradeModal capture

Both modals:
1. Pull `mistakeTags` and `emotionTags` lists from `settings`.
2. Add 2 controlled state vars (selected lists).
3. Render 2 `TagChipPicker` blocks below the Notes field.
4. Include the selected lists in the `onSave` payload.

### Task 8: PortfolioSettingsModal round-trip test

Click "Seed standard 17 mistakes" then save; assert `payload.mistakeTags` contains all 17.

### Task 9: Smoke + push

Run backend + frontend test suites + build, push to Railway.

---

## Carry-forwards (defer to polish pass)

- Analytics dimension: "win rate by mistake" / "P&L by emotion" — requires analytics service work that's better done after Phase G's brainstorm.
- Color-coding mistake vs emotion chips differently in the picker.
- "Required on close" toggle (force tagging before save).
