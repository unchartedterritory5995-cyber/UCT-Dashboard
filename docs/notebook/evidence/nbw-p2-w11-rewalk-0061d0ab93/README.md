# Targeted re-walk on nbw-p2-impl `0061d0ab93` (R-RAW)

Raw evidence of the targeted Task 11.20 re-walk (walk D1-D6, W11-R80/R82, editorNormalForm, PD-1..PD-3, and a quick re-run of W11.1-W11.3 and W11.17, with W11.7/W11.8 to make the gallery listings). `walk.json` and `steps/*.json` were written by the walker after every step, before this file. Verdict rule as in `nbw-p2-w11-walk-985d79d74a`: FAIL = a failed check, or an axe serious/critical, overflow, touch tap-floor or raw `{{block:` finding; HTTP/console events are listed but do not fail a step alone.

- Tip `0061d0ab93e51a105b1f875ef99d672779247b1c`, frozen; `app/dist/index.html` 2026-10-27 09:13:32 -05:00, later than the commit (09:12:43). Re-checked before this commit.
- Recipe B: `seed_members.py --seed 20261024 --schema-via-clock-launcher` into the fresh data dir `<scratchpad>\sbx-rewalk-20261027091520` (P01 P04 P08 P14 P25 P28 P29 P35 P36 P40 P45 P46). One boot, ON, `sandbox_clock.py` via `harness/boot_sandbox.py` (hermetic `campaign_env`, lockwatch on), 127.0.0.1:8171; `logs/boot-on.*` are its whole stdout/stderr. Teardown deleted only that data dir and the walker's own work dir, each by its full path.
- D1 is checked after EVERY Use (library and member template): no sheet left open, `document.activeElement` is the note title, no inert ancestor.
- VID: the YouTube IFrame API is a stand-in (`harness/driver/ytstub.py`, installed with `add_init_script`); GlobalVideoLayer, its store, controls, keep-live marker and drag code are the product's. One admin-created education video (`Walk test session`, twice) exists in this sandbox only.
- PD-1: logged out; the theme is the app's own no-flash cache `uct.appTheme.v1`; the loading state is held by leaving `/api/auth/login` pending (then answered 401).

## Step x viewport

| Step | 1200 | 820 | 390 |
|---|---|---|---|
| W11.0 | [PASS](steps/1200-W11_0.json) | [PASS](steps/820-W11_0.json) | [PASS](steps/390-W11_0.json) |
| W11.1 | [PASS](steps/1200-W11_1.json) | [PASS](steps/820-W11_1.json) | [PASS](steps/390-W11_1.json) |
| W11.2 | [PASS](steps/1200-W11_2.json) | [PASS](steps/820-W11_2.json) | [PASS](steps/390-W11_2.json) |
| W11.3 | [PASS](steps/1200-W11_3.json) | [PASS](steps/820-W11_3.json) | [PASS](steps/390-W11_3.json) |
| W11.7 | [PASS](steps/1200-W11_7.json) | [PASS](steps/820-W11_7.json) | [PASS](steps/390-W11_7.json) |
| W11.8 | [PASS](steps/1200-W11_8.json) | [PASS](steps/820-W11_8.json) | [PASS](steps/390-W11_8.json) |
| W11.17 | [PASS](steps/1200-W11_17.json) | [PASS](steps/820-W11_17.json) | [PASS](steps/390-W11_17.json) |
| D2 | [FAIL](steps/1200-D2.json) | [FAIL](steps/820-D2.json) | [FAIL](steps/390-D2.json) |
| D3 | [PASS](steps/1200-D3.json) | [PASS](steps/820-D3.json) | [PASS](steps/390-D3.json) |
| D4 | [PASS](steps/1200-D4.json) | [PASS](steps/820-D4.json) | [PASS](steps/390-D4.json) |
| D5 | [PASS](steps/1200-D5.json) | [PASS](steps/820-D5.json) | [PASS](steps/390-D5.json) |
| D6 | [PASS](steps/1200-D6.json) | [PASS](steps/820-D6.json) | [PASS](steps/390-D6.json) |
| VID | [FAIL](steps/1200-VID.json) | [FAIL](steps/820-VID.json) | [FAIL](steps/390-VID.json) |
| ENF | [PASS](steps/1200-ENF.json) | [PASS](steps/820-ENF.json) | [PASS](steps/390-ENF.json) |
| PD1 | [FAIL](steps/1200-PD1.json) | [FAIL](steps/820-PD1.json) | [FAIL](steps/390-PD1.json) |
| PD2 | [FAIL](steps/1200-PD2.json) | [FAIL](steps/820-PD2.json) | [FAIL](steps/390-PD2.json) |
| PD3 | [PASS](steps/1200-PD3.json) | [PASS](steps/820-PD3.json) | [PASS](steps/390-PD3.json) |

## Defects recorded by the walker

1. **minor** 1200 PD2: `builder preview over an empty source: ._summary_odb41_183 (data-testid=builder-preview)`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (PD-2's rule, another surface). Saw: shown at 1200: ['Net P&L for options strategies in the last 90 days, all accounts. 0 strategies.']. Screenshot: `None`
2. **minor** 1200 PD2: `[data-testid=builder-live] (the builder's polite live region) over an empty source`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (the same rule PD-2 applied to the bar). Saw: the live region announces 'Net P&L for options strategies in the last 90 days, all accounts. 0 strategies.': a zero count, not the empty sentence. Screenshot: `None`
3. **minor** 1200 PD2: `builder preview over an empty source: ._coverage_odb41_165 (data-testid=builder-sections)`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (PD-2's rule, another surface). Saw: shown at 1200: ['Days open known on 0 of 0 positions', 'Average days open for open positions right now, all accounts. 0 positions.']. Screenshot: `1200/PD2-builder-options.png`
4. **minor** 1200 PD2: `[data-testid=builder-live] (the builder's polite live region) over an empty source`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (the same rule PD-2 applied to the bar). Saw: the live region announces 'Average days open for open positions right now, all accounts. 0 positions.': a zero count, not the empty sentence. Screenshot: `1200/PD2-builder-options.png`
5. **minor** 820 PD2: `builder preview over an empty source: ._summary_odb41_183 (data-testid=builder-preview)`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (PD-2's rule, another surface). Saw: shown at 820: ['Net P&L for options strategies in the last 90 days, all accounts. 0 strategies.']. Screenshot: `None`
6. **minor** 820 PD2: `[data-testid=builder-live] (the builder's polite live region) over an empty source`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (the same rule PD-2 applied to the bar). Saw: the live region announces 'Net P&L for options strategies in the last 90 days, all accounts. 0 strategies.': a zero count, not the empty sentence. Screenshot: `None`
7. **minor** 820 PD2: `builder preview over an empty source: ._coverage_odb41_165 (data-testid=builder-sections)`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (PD-2's rule, another surface). Saw: shown at 820: ['Days open known on 0 of 0 positions', 'Average days open for open positions right now, all accounts. 0 positions.']. Screenshot: `820/PD2-builder-options.png`
8. **minor** 820 PD2: `[data-testid=builder-live] (the builder's polite live region) over an empty source`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (the same rule PD-2 applied to the bar). Saw: the live region announces 'Average days open for open positions right now, all accounts. 0 positions.': a zero count, not the empty sentence. Screenshot: `820/PD2-builder-options.png`
9. **minor** 390 PD2: `[data-testid=builder-live] (the builder's polite live region) over an empty source`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (the same rule PD-2 applied to the bar). Saw: the live region announces 'Net P&L for options strategies in the last 90 days, all accounts. 0 strategies.': a zero count, not the empty sentence. Screenshot: `None`
10. **minor** 390 PD2: `builder preview over an empty source: ._coverage_odb41_165 (data-testid=builder-sections)`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (PD-2's rule, another surface). Saw: shown at 390: ['Days open known on 0 of 0 positions']. Screenshot: `390/PD2-builder-options.png`
11. **minor** 390 PD2: `[data-testid=builder-live] (the builder's polite live region) over an empty source`. Expected: plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (the same rule PD-2 applied to the bar). Saw: the live region announces 'Average days open for open positions right now, all accounts. 0 positions.': a zero count, not the empty sentence. Screenshot: `390/PD2-builder-options.png`

## OPEN for the owner

- VoiceOver on iOS Safari (BrowserStack Live): OPEN.
- Production was not touched.
