# Screener Focus on Phones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On phones (≤640 px) the Screener renders the Focus layout as one column, dark behind `SCREENER_FOCUS_PHONE_ENABLED`:
- the list comes first;
- tapping a row opens its chart full screen;
- swipe up or down (or the ↑/↓ header buttons) steps between stocks;
- Back returns to the list on the same row;
- the screen picker opens as a bottom sheet.

**Architecture:**
- `Screener.jsx` stops excluding phones when the flag reaches the user.
- Inside `FocusScreener`'s list mode, CSS `@media (max-width: 640px)` hides the side chart pane and makes the list full width. A tap opens the existing `ChartPane` inside the existing `components/mobile/Sheet.jsx` (`variant="fullscreen"`), driven by the same `useFocusSelection` state, so stepping and selection stay one authority.
- Tablet (641–1024 px) is untouched.

**Tech Stack:** React, CSS modules, vitest + Testing Library, Playwright (production verification only).

**Spec:** `docs/superpowers/specs/2026-10-16-screener-focus-next-design.md` §3.

## Global Constraints

- **Flag:** `SCREENER_FOCUS_PHONE_ENABLED` in `SCREENER_FLAGS` (`api/routers/auth.py`), three values, read per request, payload key `screener_focus_phone_enabled`. Off means today's phone page renders byte-for-byte unchanged.
- **Breakpoints:** only the canonical ones (`app/src/styles/breakpoints.css`/`.js`): phone `@media (max-width:640px)`. No new breakpoint literal.
- **Layout is CSS; behaviour is click-time JS** (CLAUDE.md: `useMediaQuery` is stale at first paint). Hide or show the pane with CSS `@media`. Decide "open a sheet vs select in place" at TAP time with `window.matchMedia('(max-width: 640px)').matches`, read inside the handler.
- **Tap targets ≥ 44 px** (`--tap-min`). No horizontal overflow at 390 px.
- **The joystick hub** (`app/src/hub/**`) is another workstream's. Do NOT edit it. The list only gets bottom padding so no row sits under the hub launcher. Read the hub launcher's size from its own CSS or constants and reference that token if it exists; otherwise use `calc(88px + env(safe-area-inset-bottom))` with a comment naming the hub file it was measured from.
- **House rules,** identical to the other two plans: new worktree from origin/master with `.uct-session-owner`; named test files only; separate test and commit calls; `git add` named paths; `git commit -F -` with both trailer lines; hygiene clean; mutation proofs restored from saved bytes.
- **Copy, exactly:** sheet Back button `Back to list`; header step buttons `Previous stock` / `Next stock` (aria-labels, glyphs ↑ ↓).

## Review Focus

1. **Rotating a phone to landscape (>640 px) with the chart sheet open** must not leave a stuck sheet over the tablet layout: the sheet closes, and the side pane shows the same stock. Test in Task 2.
2. **Stepping past the last loaded row** inside the sheet must load more (or stop at the end), never throw or close. Test in Task 2.
3. **The browser/hardware Back button** with the sheet open closes the sheet (Sheet's own Escape and close path), never navigates away from the Screener. Test in Task 2.
4. **A vertical scroll of the chart's price axis** must not step stocks. Only a deliberate swipe on the sheet's header strip steps. Test in Task 2.
5. **The flag at `admin`**: a member on a phone keeps the old page. Test in Task 1.

---

### Task 1: The flag and the phone gate

**Files:**
- Modify: `api/routers/auth.py` (`SCREENER_FLAGS` gains `"SCREENER_FOCUS_PHONE_ENABLED": False`)
- Modify: `tests/test_screener_focus_flag.py` (exact-dict assertion gains the key; keep every key other branches added)
- Modify: `docs/feature_flags.json` (dark entry, edited as TEXT)
- Modify: `app/src/context/AuthContext.jsx` (state + payload row + provider value, mirroring `screenerFocusLayoutEnabled`)
- Modify: `app/src/pages/Screener.jsx:101` (`focusOn` admits phones when `screenerFocusPhoneEnabled`)
- Test: `app/src/pages/Screener.focusPhone.test.jsx`, `tests/test_screener_focus_flag.py`

**Interfaces:**
- Produces: `AuthContext` value `screenerFocusPhoneEnabled: boolean`.

- [ ] **Step 1: Failing tests.**
  - **Frontend:** render `Screener` with `AuthContext` stubbed and `useIsPhone` mocked true. Assert:
    - (a) layout on, phone flag off → the old page (no `data-testid="focus-screener"`);
    - (b) layout on, phone flag on → `focus-screener` renders;
    - (c) desktop (useIsPhone false) with phone flag off → Focus renders, unchanged behaviour.
    - Copy the existing Screener test's providers/mocks pattern: find a test that renders `Screener.jsx` with `git grep -l "from '../Screener'\|from './Screener'" app/src`.
  - **Backend:** `_screener_flags` exposes `screener_focus_phone_enabled`, with the same three-value assertions as the existing focus flag tests.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `const focusOn = ctx?.screenerFocusLayoutEnabled === true && !embedded && !inPanel && (!isPhone || ctx?.screenerFocusPhoneEnabled === true)`. Update the comment above it to say phones are admitted behind the phone flag.
- [ ] **Step 4: Run them and see them pass,** together with the existing `Screener*.test.jsx` files and `tests/test_visibility_flag_ledger.py`.
- [ ] **Step 5: Mutation.** Drop the `isPhone` clause entirely → (a) goes red.
- [ ] **Step 6: Commit** (`feat(screener): admit phones to the Focus layout behind SCREENER_FOCUS_PHONE_ENABLED (dark)`).

---

### Task 2: One column, the chart sheet and stepping

**Files:**
- Create: `app/src/pages/screener/focus/PhoneChartSheet.jsx`
- Modify: `app/src/pages/screener/focus/FocusScreener.jsx` (list-mode body: tap handler + sheet)
- Modify: `app/src/pages/screener/focus/FocusScreener.module.css` (phone `@media` block)
- Modify: `app/src/pages/screener/focus/ScreenMenu.jsx` (on a phone, its dialog is a bottom sheet via `Sheet variant="bottom-sheet"`, decided at open time)
- Test: `app/src/pages/screener/focus/__tests__/phoneSheet.test.jsx`

**Interfaces:**
- Consumes: `useFocusSelection` (`sel.index`, `sel.select(i)`, the rows it steps), `ChartPane` props as used in list mode, `components/mobile/Sheet.jsx` (`open`, `onClose`, `variant`, `title`, `ariaLabel`).
- Produces: `<PhoneChartSheet open onClose row onPrev onNext canPrev canNext>{children}</PhoneChartSheet>`. Its header has `Back to list` plus the ↑/↓ buttons. The swipe zone is the header strip only.

- [ ] **Step 1: Failing tests** (`phoneSheet.test.jsx`). Mock `window.matchMedia` so `(max-width: 640px)` matches, and render `FocusScreener` the way `__tests__/FocusScreener.test.jsx` does (copy its providers/fixtures). Assert:
  1. Tapping row 2 opens a dialog named for that stock, showing its ChartPane (`focus-chart-pane` with aria-label `<T> chart`).
  2. `Next stock` steps to row 3 (pane aria-label changes, and the list's selected row is row 3). `Previous stock` steps back.
  3. A swipe-up on the header strip (pointerdown/move −80 px/up) steps next. The same gesture on the chart body does NOT step.
  4. `Back to list` closes the sheet; row 3 is still `aria-selected="true"` and focused in the list.
  5. At the last loaded row with `hasMore`, `Next stock` calls the list's load-more and stays open. Without `hasMore`, it is disabled.
  6. Escape closes the sheet (Sheet's own handler).
  7. With matchMedia NOT matching (tablet), tapping a row selects in place and opens no dialog. This is today's behaviour, unchanged.
  8. A `change` event to non-matching while the sheet is open closes it. The selected row is unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **`PhoneChartSheet.jsx`:** wraps `Sheet variant="fullscreen" open onClose labelledByTitle title={row.ticker}`. The header row holds `Back to list` (calls `onClose`), then `Previous stock` (↑, disabled when `!canPrev`), then `Next stock` (↓, disabled when `!canNext`), each `min-height: var(--tap-min)`. The swipe is a pointer handler on the header strip only: |dy| ≥ 60 px and |dy| > 2·|dx| steps (up = next).
  - **`FocusScreener`, list mode:**
    - add `const [phoneSheet, setPhoneSheet] = useState(false)`;
    - wrap `onSelect`: `const onRowSelect = i => { sel.select(i); if (window.matchMedia?.('(max-width: 640px)').matches) setPhoneSheet(true) }`, and pass `onRowSelect` to `ResultList`;
    - render `<PhoneChartSheet open={phoneSheet} …><ChartPane …same props… /></PhoneChartSheet>`. Keep the inline `ChartPane` for tablet and desktop; the CSS hides it on phones;
    - next means `sel.select(sel.index + 1)`, or `s.loadMore()` when at the end with `hasMore`;
    - add an effect subscribing to `matchMedia('(max-width: 640px)')` `change` that closes the sheet when it stops matching.
    - ⚠️ Mount only ONE `ChartPane` at a time on a phone: when `phoneSheet` is true, the inline pane is display:none by CSS, but it must not also run a chart. Render the inline pane only when not `phoneSheet`, or pass it `row={null}`. A second live StockChart doubles the bars fetches.
  - **CSS** (append; use only the phone breakpoint):

    ```css
    @media (max-width: 640px) {
      .body { flex-direction: column; }
      .body > [data-testid="focus-chart-pane"] { display: none; }
      .listWrap { width: 100%; max-width: none; padding-bottom: calc(88px + env(safe-area-inset-bottom)); }
      .row { min-height: var(--tap-min); }
    }
    ```

    Read `.listWrap` / `.pane` in the stylesheet first and adapt the selectors to the real class names. Replace `88px` with the hub launcher's real footprint per Global Constraints.
  - **`ScreenMenu`:** when the menu opens and `matchMedia('(max-width: 640px)').matches`, render its dialog body inside `Sheet variant="bottom-sheet"` instead of the anchored popover. Keep the dialog's `aria-label="Screens"` and the search box.
- [ ] **Step 4: Run the new file and ALL of `src/pages/screener/focus/` and `src/pages/Screener*.test.jsx`, and see them pass.** Run `styles/tapFloor.test.js` and `styles/tokens.reachable.test.js` too.
- [ ] **Step 5: Mutation.** Each of these must turn a test red:
  - (a) open the sheet regardless of matchMedia → test 7 red;
  - (b) let the chart body's swipe step → test 3 red;
  - (c) don't close on `change` → test 8 red.
- [ ] **Step 6: Commit** (`feat(screener): Focus on phones, list first with a full-screen chart sheet (dark)`).

---

## Rollout (controller)

1. Open the PR, wait for checks, then merge. Only one master merge at a time; wait for web SUCCESS.
2. Set `SCREENER_FOCUS_PHONE_ENABLED=admin` on web. Verify the new boot and read the value in-process.
3. Verify on production as smoke@ (Playwright, `is_mobile`, `has_touch`) at 390×844 and 820×1180, with screenshots:
   - the list is first, with no horizontal overflow and no sub-44 px targets on the list;
   - a tap opens the sheet; Next/Previous and swipe step; Back returns to the same row;
   - 820 px is unchanged from the 2026-10-16 audit;
   - zero page errors.
4. On the owner's go, set the flag to `1` and update the ledger in the same docs push.
