# r8-presets: rename and delete a News filter preset (C3-140 completed)

Local branch, not pushed. Base: r8-scanner-filter 6e9b4e7dad, because C3-140's apply (the `preset` control) lives there.
r8-indicator-style does not contain it. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted model).

## What

- The News (Trade Exchange) widget's saved filter presets are now an item list (`ITEM_LISTS.tradeExchangeNews.presets`). They use the
  same mechanism as the Theme Tracker's theme sets (C3-174): ONE more control of `widget.setOption`, with the value
  `rename:<name>=><new name>` or `delete:<name>`.
- Writes go through the widget's own preset store: its door calls the Presets menu's own `renamePreset` / `deletePreset`
  over `opts.presets`, one operation each and never the whole list.
- Rename can be undone (it renames back). Delete is always shown first (Apply) and has no Undo. Deleting the applied preset
  clears `presetId`, as the menu does.
- Refusals give the real names:
  - a missing preset: "no “Crypto” among your filter presets (Earnings Watch, Macro only, Fed search)";
  - an ambiguous part of a name: "could be … or …";
  - a taken name: "already have a filter preset named …";
  - a name over 40 characters, the widget's own rename box limit. This is a new generic `max` check on item lists in `board.js`.

## Bytes

- Manifest: **0 bytes** (no new action, and widget.setOption's text is unchanged; the golden test passes un-updated).
- Context: only when the News widget's controls are in the widgetControls section, it gains one item-list word,
  `presets(rename:<name>=><new>|delete:<name>; yours: <names>)`. That is about 50 bytes plus the preset names.

## Evidence

- Held-out (`agentPresetManageHeldOut`, 4, committed first in 2dd9331883). Each phrasing runs over the REAL widget
  (`teNewsWatchlist.outcome`):
  - rename 2/2: the name reads back from opts and from the menu's options; Undo restores it;
  - delete 2/2: one card, nothing deleted before Apply, gone after; there is no Undo.
- NEGATIVE: missing, ambiguous, taken and too-long names are refused with the real names; nothing changes and no card is shown.
- Targeted vitest (SIMULATED), all pass:
  - teNewsWatchlist.outcome 21/21;
  - widget controls / options / door rows / theme tracker / SAT-1 requests / contracts / the widgets folder: 1110/1110;
  - routing collision v1 + v2, capreg inventory + golden, routing, scan-filter held-out, exec families: 849/849.

## Full suite

Not run: the suite lock is held for release runs. It is owed when the Lead clears it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
