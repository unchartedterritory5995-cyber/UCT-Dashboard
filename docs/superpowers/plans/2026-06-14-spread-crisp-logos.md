# Spread Crisp Logos (Focused Bundle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the crisp `CompanyLogo` to each ticker row on MoversSidebar, the UCT 20 / Leadership tile, and the Stock Catalysts table.

**Architecture:** Additive frontend change. Each surface wraps its ticker in a small flex group `[logo] TICKER` using the existing `CompanyLogo` (crisp 256px + monogram fallback). No data/logic/layout changes; OptionsFlow is out of scope.

**Tech Stack:** React + Vite + CSS Modules, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-14-spread-crisp-logos-design.md`

---

## File Structure

- `app/src/components/MoversSidebar.jsx` + `MoversSidebar.module.css` — 18px logo per row.
- `app/src/components/tiles/LeadershipTile.jsx` + `LeadershipTile.module.css` — 20px logo per row.
- `app/src/components/tiles/CatalystTable.jsx` + `CatalystTable.module.css` — 20px logo in Sym cell.
- `app/src/components/MoversSidebar.test.jsx` — new: asserts a logo renders per mover row.

Import paths for `CompanyLogo`: from `MoversSidebar.jsx` use `./CompanyLogo`; from the two `tiles/` files use `../CompanyLogo`.

---

## Task 1: MoversSidebar logos (+ test)

**Files:**
- Create: `app/src/components/MoversSidebar.test.jsx`
- Modify: `app/src/components/MoversSidebar.jsx`, `app/src/components/MoversSidebar.module.css`

- [ ] **Step 1: Write the failing test**

Create `app/src/components/MoversSidebar.test.jsx`:

```jsx
// app/src/components/MoversSidebar.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Stub the logo + popup + data hooks so the component mounts cheaply.
vi.mock('./CompanyLogo', () => ({ default: ({ sym }) => <span data-testid="logo">{sym}</span> }))
vi.mock('./TickerPopup', () => ({ default: ({ children }) => <>{children}</> }))
vi.mock('../hooks/useMobileSWR', () => ({ default: () => ({ data: undefined, error: undefined, mutate: () => {} }) }))
vi.mock('../hooks/useBatchTweetCounts', () => ({ default: () => ({ data: {} }) }))
vi.mock('../hooks/useTapeFeed', () => ({ default: () => ({ data: [] }) }))
vi.mock('../hooks/useTickerTweets', () => ({ default: () => ({ data: [] }) }))

import MoversSidebar from './MoversSidebar'

describe('MoversSidebar', () => {
  it('renders a company logo for each mover row', () => {
    render(<MoversSidebar data={{
      ripping: [{ sym: 'NVDA', pct: '+4.2%' }],
      drilling: [{ sym: 'TSLA', pct: '-3.0%' }],
    }} />)
    const logos = screen.getAllByTestId('logo').map(l => l.textContent)
    expect(logos).toEqual(expect.arrayContaining(['NVDA', 'TSLA']))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/components/MoversSidebar.test.jsx`
Expected: FAIL (no `logo` testid — logos not added yet).

- [ ] **Step 3: Add the import**

In `app/src/components/MoversSidebar.jsx`, add after `import TickerPopup from './TickerPopup'`:

```jsx
import CompanyLogo from './CompanyLogo'
```

- [ ] **Step 4: Add the logo in MoverSection**

In `MoverSection`, replace:

```jsx
                <TickerPopup sym={item.sym}>
                  <span className={styles.sym}>{item.sym}</span>
                </TickerPopup>
```

with:

```jsx
                <span className={styles.symWrap}>
                  <CompanyLogo sym={item.sym} size={18} />
                  <TickerPopup sym={item.sym}>
                    <span className={styles.sym}>{item.sym}</span>
                  </TickerPopup>
                </span>
```

- [ ] **Step 5: Add the logo in TapeSection**

In `TapeSection`, replace:

```jsx
                <TickerPopup sym={row.ticker}>
                  <span className={styles.sym}>{row.ticker}</span>
                </TickerPopup>
```

with:

```jsx
                <span className={styles.symWrap}>
                  <CompanyLogo sym={row.ticker} size={18} />
                  <TickerPopup sym={row.ticker}>
                    <span className={styles.sym}>{row.ticker}</span>
                  </TickerPopup>
                </span>
```

- [ ] **Step 6: Add the wrapper CSS**

In `app/src/components/MoversSidebar.module.css`, add after the `.sym { … }` rule (ends at the line `}` following `letter-spacing: 0.5px;`):

```css
.symWrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
```

- [ ] **Step 7: Run the test**

Run: `cd app && npx vitest run src/components/MoversSidebar.test.jsx`
Expected: PASS.

- [ ] **Step 8: Build**

Run: `cd app && npm run build`
Expected: succeeds.

- [ ] **Step 9: Commit**

```bash
git add app/src/components/MoversSidebar.jsx app/src/components/MoversSidebar.module.css app/src/components/MoversSidebar.test.jsx
git commit -m "feat(movers): add crisp company logos to mover + tape rows"
```

---

## Task 2: Leadership tile (UCT 20) logos

**Files:**
- Modify: `app/src/components/tiles/LeadershipTile.jsx`, `app/src/components/tiles/LeadershipTile.module.css`

- [ ] **Step 1: Add the import**

In `app/src/components/tiles/LeadershipTile.jsx`, add after `import TickerPopup from '../TickerPopup'`:

```jsx
import CompanyLogo from '../CompanyLogo'
```

- [ ] **Step 2: Add the logo to the `.top` row**

Replace:

```jsx
                  <div className={styles.top} onClick={() => thesis && toggle(i)} style={thesis ? { cursor: 'pointer' } : undefined}>
                    <TickerPopup sym={sym}>
                      <span className={styles.sym}>{sym}</span>
                    </TickerPopup>
```

with:

```jsx
                  <div className={styles.top} onClick={() => thesis && toggle(i)} style={thesis ? { cursor: 'pointer' } : undefined}>
                    <CompanyLogo sym={sym} size={20} />
                    <TickerPopup sym={sym}>
                      <span className={styles.sym}>{sym}</span>
                    </TickerPopup>
```

(`.top` is already `display: flex; align-items: center; gap: 8px`, so the logo aligns with the ticker + price chips — no CSS change strictly required. Step 3 adds a tiny guard only if needed.)

- [ ] **Step 3: (No CSS change needed)**

`.top` already centers and gaps its children. Leave `LeadershipTile.module.css` unchanged unless the build/visual shows misalignment. (Listed explicitly so the engineer doesn't hunt for a missing edit.)

- [ ] **Step 4: Build**

Run: `cd app && npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/tiles/LeadershipTile.jsx
git commit -m "feat(uct20): add crisp company logos to Leadership tile rows"
```

---

## Task 3: Stock Catalysts table logos

**Files:**
- Modify: `app/src/components/tiles/CatalystTable.jsx`, `app/src/components/tiles/CatalystTable.module.css`

- [ ] **Step 1: Add the import**

In `app/src/components/tiles/CatalystTable.jsx`, add after `import TickerPopup from '../TickerPopup'`:

```jsx
import CompanyLogo from '../CompanyLogo'
```

- [ ] **Step 2: Add the logo to the Sym cell**

Replace:

```jsx
                    <td className={styles.colSym}>
                      <TickerPopup sym={r.ticker}>
                        <span className={styles.ticker}>
                          {onMyList && <span className={styles.star} title="On your watchlist or flagged">★</span>}
                          {r.ticker}
                        </span>
                      </TickerPopup>
                    </td>
```

with:

```jsx
                    <td className={styles.colSym}>
                      <span className={styles.symCell}>
                        <CompanyLogo sym={r.ticker} size={20} />
                        <TickerPopup sym={r.ticker}>
                          <span className={styles.ticker}>
                            {onMyList && <span className={styles.star} title="On your watchlist or flagged">★</span>}
                            {r.ticker}
                          </span>
                        </TickerPopup>
                      </span>
                    </td>
```

- [ ] **Step 3: Widen the Sym column + add the flex wrapper CSS**

In `app/src/components/tiles/CatalystTable.module.css`, change:

```css
.colSym     { width: 80px; white-space: nowrap; }
```

to:

```css
.colSym     { width: 104px; white-space: nowrap; }

.symCell {
  display: flex;
  align-items: center;
  gap: 7px;
}
```

- [ ] **Step 4: Build**

Run: `cd app && npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/tiles/CatalystTable.jsx app/src/components/tiles/CatalystTable.module.css
git commit -m "feat(catalysts): add crisp company logos to Stock Catalysts rows"
```

---

## Task 4: Full verification + push

- [ ] **Step 1: Run the new test + a broad sweep**

Run: `cd app && npx vitest run src/components/MoversSidebar.test.jsx src/pages/calendar`
Expected: all PASS (the new MoversSidebar test + calendar suite as a regression guard).

- [ ] **Step 2: Final build**

Run: `cd app && npm run build`
Expected: succeeds.

- [ ] **Step 3: Push**

```bash
git push origin master
```

- [ ] **Step 4: Manual check (record result)**

On the dashboard: MoversSidebar rows, UCT 20 rows, and Stock Catalysts rows each
show a crisp logo (monogram for unknown tickers) aligned left of the ticker, with
no row/column overflow or layout breakage.

---

## Self-Review Notes

- **Spec coverage:** §1 MoversSidebar → Task 1; §2 Leadership → Task 2; §3 Catalysts
  → Task 3; testing/verification → Task 1 (test) + Task 4. Performance note needs no
  code (existing cache/prewarm covers it).
- **Import paths:** `./CompanyLogo` from `components/MoversSidebar.jsx`;
  `../CompanyLogo` from `components/tiles/*` — verified against the file tree.
- **No placeholders:** every code step shows literal find/replace blocks; Task 2
  Step 3 explicitly states "no CSS change" so it isn't mistaken for a gap.
- **Class names:** new `.symWrap` (movers) and `.symCell` (catalysts) are distinct and
  introduced alongside their JSX usage; `.top` (leadership) reused as-is.
