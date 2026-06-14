# Calendar Week-Strip Calm Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the calendar's WeekSummary banner + MacroBand read as quiet context, consistent with the calmed feed.

**Architecture:** Frontend-only. `WeekSummary.jsx` renders 3 stats instead of 5; `Calendar.module.css` lightens `.summary` and `.macroband` chrome. No data/logic changes.

**Tech Stack:** React + Vite + CSS Modules, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-14-calendar-week-strip-calm-design.md`

---

## File Structure

- `app/src/pages/calendar/WeekSummary.jsx` — drop 2 stat columns.
- `app/src/pages/calendar/Calendar.module.css` — calm `.summary` / `.scol` / `.macroband` / `.mtag`.
- `app/src/pages/calendar/WeekSummary.test.jsx` — new: asserts kept/dropped stats.

---

## Task 1: Trim WeekSummary to 3 stats

**Files:**
- Create: `app/src/pages/calendar/WeekSummary.test.jsx`
- Modify: `app/src/pages/calendar/WeekSummary.jsx`

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/calendar/WeekSummary.test.jsx`:

```jsx
// app/src/pages/calendar/WeekSummary.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WeekSummary from './WeekSummary'

const stats = {
  mineCount: 2, total: 40, macroCount: 5,
  biggestMove: { sym: 'NVDA', pct: 7.8 }, next: 'AAPL',
}

describe('WeekSummary', () => {
  it('renders the three kept stats', () => {
    render(<WeekSummary stats={stats} />)
    expect(screen.getByText('Your reports this week')).toBeTruthy()
    expect(screen.getByText('Total reporters')).toBeTruthy()
    expect(screen.getByText('Biggest expected move')).toBeTruthy()
  })

  it('drops Macro prints and Next of yours', () => {
    render(<WeekSummary stats={stats} />)
    expect(screen.queryByText('Macro prints')).toBeNull()
    expect(screen.queryByText('Next of yours')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/pages/calendar/WeekSummary.test.jsx`
Expected: the "drops…" test FAILS (current component still renders those columns).

- [ ] **Step 3: Drop the two columns**

Replace the contents of `app/src/pages/calendar/WeekSummary.jsx` with:

```jsx
// app/src/pages/calendar/WeekSummary.jsx
import styles from './Calendar.module.css'

export default function WeekSummary({ stats }) {
  if (!stats) return null
  const col = (lbl, val, cls = '') => (
    <div className={styles.scol}><span className={styles.scolLbl}>{lbl}</span>
      <b className={cls}>{val}</b></div>
  )
  return (
    <div className={styles.summary}>
      {col('Your reports this week', stats.mineCount, styles.gold)}
      {col('Total reporters', stats.total)}
      {stats.biggestMove && col('Biggest expected move', `${stats.biggestMove.sym} ±${stats.biggestMove.pct}%`, styles.gold)}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/pages/calendar/WeekSummary.test.jsx`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/calendar/WeekSummary.jsx app/src/pages/calendar/WeekSummary.test.jsx
git commit -m "feat(calendar): trim WeekSummary to three quiet stats"
```

---

## Task 2: Calm the strip CSS

**Files:**
- Modify: `app/src/pages/calendar/Calendar.module.css`

- [ ] **Step 1: Flatten WeekSummary + add hairline separators**

Replace the `.summary` rule:

```css
.summary {
  display: flex;
  gap: 18px;
  padding: 11px 18px;
  background: linear-gradient(90deg, rgba(201, 168, 76, 0.07), transparent);
  border-bottom: 1px solid var(--cal-line);
  font-size: 12px;
  flex-wrap: wrap;
}
```

with:

```css
.summary {
  display: flex;
  gap: 18px;
  padding: 10px 18px;
  background: transparent;
  border-bottom: 1px solid var(--cal-line);
  font-size: 12px;
  flex-wrap: wrap;
}

.scol + .scol {
  border-left: 1px solid var(--cal-line);
  padding-left: 18px;
}
```

Then change `.summary b` font-size 15 → 14:

```css
.summary b {
  font-size: 14px;
  display: block;
  font-weight: 800;
}
```

- [ ] **Step 2: Lighten MacroBand**

Replace the `.macroband` rule:

```css
.macroband {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 11px;
  padding: 8px 10px;
  background: var(--cal-panel);
  border: 1px solid var(--cal-line);
  border-left: 2px solid var(--cal-blue);
  border-radius: 9px;
}
```

with:

```css
.macroband {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 11px;
  padding: 6px 9px;
  background: transparent;
  border: 1px solid var(--cal-line);
  border-left: 2px solid rgba(107, 163, 190, 0.5);
  border-radius: 9px;
}
```

Then change `.mtag` font-size 11 → 10:

```css
.mtag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--cal-dim);
  padding: 1px 4px;
}
```

- [ ] **Step 3: Build + calendar tests**

Run: `cd app && npm run build && npx vitest run src/pages/calendar`
Expected: build succeeds; all calendar tests PASS.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/calendar/Calendar.module.css
git commit -m "style(calendar): flatten WeekSummary + lighten MacroBand chrome"
```

---

## Task 3: Verify + push

- [ ] **Step 1: Full calendar suite**

Run: `cd app && npx vitest run src/pages/calendar`
Expected: all PASS (incl. new `WeekSummary.test.jsx`).

- [ ] **Step 2: Final build**

Run: `cd app && npm run build`
Expected: succeeds.

- [ ] **Step 3: Push**

```bash
git push origin master
```

- [ ] **Step 4: Manual check (record result)**

On `/calendar`: WeekSummary is a quiet 3-stat line (no gold banner, hairline
separators); MacroBand is a subtle strip; numbers still correct.

---

## Self-Review Notes

- **Spec coverage:** §1 WeekSummary 3 stats + flat + separators → Tasks 1 & 2;
  §2 MacroBand lighten → Task 2; testing → Task 1 + Task 3.
- **No placeholders:** full file/CSS content in every step; exact commands + expected.
- **Consistency:** `.gold` class (used for mine/biggest) is preserved and exists in
  `Calendar.module.css`; `.scol`/`.scolLbl`/`.summary b` names match the stylesheet.
