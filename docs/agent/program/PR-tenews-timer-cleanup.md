# PR: TE News widget clears its flash timers on unmount

**Why.** Master gate 42569053007 (#978, 973269c788) went red on one unhandled `ReferenceError: window is not defined`, with every test passing. The News (Trade Exchange) widget's new-headline highlight schedules a 2.1 s `setTimeout` to clear the flash, and nothing ever cleared it. A test that unmounts while a headline is flashing (`TradeExchangeNewsWidget.terminal.test.jsx`, and "history never flashes…" in `TradeExchangeNewsWidget.test.jsx`) leaves the timer pending, and it fires after jsdom is torn down.

**Change** (`app/src/pages/charts/widgets/TradeExchangeNewsWidget.jsx` only, product code):
- Each flash-clear timer's id is kept in a ref (`flashTimersRef`, a Set). A timer removes itself when it fires.
- An unmount-only effect clears every pending flash-clear timer.
- Behaviour while mounted is unchanged: a new headline still flashes for `FLASH_MS` (2.1 s), and the highlight, sound and history rules are untouched.

**Sweep of the same file.**
- Every other timer was already cleared by its effect's cleanup: the search debounce (`setTimeout` / `clearTimeout`), the toast (`setTimeout` / `clearTimeout`) and the 30 s age ticker (`setInterval` / `clearInterval`).
- The sound gap (`SOUND_GAP_MS`) is a timestamp throttle (`lastSoundRef`), not a timer, so it has nothing to clear.
- No other uncleared timer or interval in this file.

**Test.** New: "unmounting mid-flash leaves no timer behind" in `TradeExchangeNewsWidget.test.jsx`. With fake timers, a live headline flashes, the widget unmounts, and the test asserts:
- `vi.getTimerCount()` is 0;
- advancing 5 s throws nothing;
- `console.error` is never called.
- Without the fix it fails ("expected 1 to be 0"); with it, it passes.

**Checks (local).**
- `TradeExchangeNewsWidget.test.jsx` and `TradeExchangeNewsWidget.terminal.test.jsx`: 89/89.
- Full app vitest suite through the suite lock: see the report.

**Known dev-only effect.** Under React StrictMode's development double-mount, a flash timer set before the simulated unmount is cleared, so a flash shown at that moment can stick until the next headline arrives. Production (no double-mount) is unaffected.

**Scope.** Nothing else changes. Options-flow and bars code are not touched.
