# PR: teach a chart's keyboard shortcuts, from the chart's own declaration (teach-keys, acceleration plan #5)

> Unit tests and browser runs: LOCAL / SIMULATED. Branch `agent/pl/teach-keys`, cut from master `dfc645ccb3`.

## What it teaches
A member asks about a chart key, for example "what is the keyboard shortcut for log scale", "what does Alt+G do", "which key
adds this ticker to a watchlist", or "how do I see all the shortcuts". The guide rings the chart and its card says:
- which key to press, exactly as `components/chart/keyboardShortcuts.js` SHORTCUTS declares it;
- to click the chart first.

There is one walkthrough per declared key: 49 rows. Zoom (`+ / -`) is not one of them; it stays with chartView's existing
zoom row.

## Rules the cards follow
- **Read only, and nothing restated.** Each row is built from its SHORTCUTS entry: the title is `description (keys)`, and
  the card text uses the declared key. Neither `keyboardShortcuts.js` nor `pages/command/shortcutRegistry.js` is edited.
- **Platform only where the chart has it.** `matchShortcut` reads Ctrl as `ctrlKey || metaKey`, so a Ctrl key's card also
  names ⌘, as in "Ctrl+M (⌘M on a Mac)". Alt and Shift are stated as declared.
- **When the key works.** Every card starts with "Click the chart". Some keys only act in a certain state, and their cards
  say so:
  - Esc works while a drawing tool is armed;
  - the replay keys work while replay is running;
  - `Alt+\` works on a Multi Chart grid.
- **Teaching only.** The member presses every key. The rails spy confirms that answering calls no writer on the host and
  dispatches no keydown.

## Routing (`guide/keys.js`, `guide/actions.js`, `capabilities/guide.js`)
- **New family.** `chartKey` is first in ACTION_FAMILIES. It is reached only by words about a key: shortcut, hotkey,
  keyboard, "which/what key", "press", or a chord written out.
  - "Key levels", "key reversal" and "press release" do not reach it.
- **Choosing the row.**
  - If the question writes out a chord, that chord alone picks the row. The chord must match whole, so "Ctrl+Alt+J" is
    not Alt+J.
  - Otherwise the description's content words pick it, with a few synonyms (cursor ≈ mouse/pointer, ticker ≈ symbol).
  - The row that needs the most words is tried first, so "price alert where my mouse is" finds Alt+N, not Esc.
- **Several keys at once.** If the words fit several keys equally, the family steps aside. For example, C2-010's "chords
  for RSI, MACD, BB, VWAP" stays with chartView's row, which lists all four.
- **Question forms.** `guide.show` used to accept only "how do I / where / show me". It now also takes key questions to
  this family and nothing else (`KEY_ASK`): "what is the shortcut for…", "which key…", "is there a hotkey…", "what does
  Alt+G do".

## Commits
| commit | what |
|---|---|
| `06e471e70d` | held-out test, written before the family: 0/9 |
| `50246b633f` | product: the chartKey family, the KEY_ASK gate, rails |
| `bcf63dab91` | product fix: whole-chord matching; several keys at once are not one card (rails extended) |
| `465729f386` | harness: expected.json assignments, cases regenerated 318 → 324 (none lost) |
| `49a75abad4` | R-RAW browser evidence, committed before it was interpreted |

## Assignments (expected.json; each keeps its former feature in `was`)
| row | was | now |
|---|---|---|
| C1-023 Shift+L | chartView | chartKey "Toggle log scale (Shift+L)" |
| C1-033 Alt+G | goToDate | chartKey "Go to date (Alt+G)" |
| C1-114 Alt+N | chartMenu | chartKey "Price alert at cursor (Alt+N)" |
| C1-171 Alt+Q | chartView | chartKey "Add ticker to watchlist (Alt+Q)" |
| C1-172 Alt+Shift+A | chartView | chartKey "Add indicator (settings) (Alt+Shift+A)" |
| C1-174 ? | none | chartKey "Show this help overlay (?)" |

C1-114 differs from the plan, which assigned it to chartView "A price alert at the cursor". The inventory's own words name
Alt+N ("Price alert at the cursor (Alt+N)"), and the key card answers that. A plain "how do I set a price alert" still
reaches alertPrice.

## Evidence (LOCAL / SIMULATED)
- **Held-out test:** 9/9 in jsdom (0/9 before).
- **Rails:** 68 tests in `agentGuideKeysRails.test.js`.
- **Guide tests:** all 31 `agentGuide*` files pass, 1135 tests.
- **Real browser:** headless Chrome on vite 5302, real composer and real mouse input. The raw records are in
  `docs/agent/program/evidence/teach-keys/`.
  - `run1-inventory`: 6/6 new cases pass, from a frozen copy of the cases file.
  - `run1-heldout`: 9/9 held-out phrasings pass (`heldout.cases.json`).
  - In every record the card text names the declared key, the ring is on the primary control (`chart.plot`), and there
    are 0 console errors.
- **Bytes:** `bytes.notebook_first_open` is 2,254,173 B on both this branch and master `dfc645ccb3`. The delta is 0 and the
  budget is 2,260,793 B.
- **Full suite:** see the PR body (one locked run on the head handed to AUDIT).

## Findings: not taught
- **C3-223 Ctrl+Alt+J.** This is a raw keydown listener (`ChartsWorkspace.jsx` ~2843, `ChartWidget.jsx` ~591) that
  captures the hovered chart to the Journal.
  - It is in neither registry.
  - What it does contradicts the inventory's "toggle the journal shortcut".
  - It now reaches no walkthrough. Before the whole-chord fix it reached Alt+J.
- **C1-123 "Add indicator from menu".** The desktop /charts right-click menu (`ChartWidget.jsx` data-menu-ids) has no Add
  indicator row. It exists only in StockChart's region menu, on other surfaces. Not taught on desktop.
  - Alt+Shift+A (C1-172) is the desktop key for the indicator library.
- **C1-175 Esc.** The inventory's words, "Escape to cursor / cancel", do not say they are about a key, so they are not
  matched. Matching them would mean writing a rule for that one sentence.
  - The Esc card is reached by asking about a key: held-out HK-9 "what key cancels the drawing tool I picked" passes in
    the browser.
  - The row stays NO WALKTHROUGH in the inventory.

## Not changed
- No data-guide attribute was added.
- `CHARTS_TEACH_STATUS.md` is not regenerated here. That happens on the next full runner pass.
