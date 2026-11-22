# Teaching the 29 watchlist rows inside the Charts Watchlist widget: design note

> LOCAL / SIMULATED. Written 2026-11-09 from source reading only. Nothing here is built yet.
> This supersedes `TEACH-WATCHLISTS-PAGE-DESIGN.md`:
> - no page host and no navigation;
> - `pageWalk.js`'s navigate path stays unused;
> - the `watchlists-page-host` branch stays unmerged.

## How the widget is built
`pages/charts/widgets/WatchlistWidget.jsx` shows one of two things:
- **The picker** (`WatchlistPicker.jsx`, `data-guide="watchlist.picker"`), when no list is chosen.
  - Tabs: Prebuilt, Community, My Lists.
  - Flagged.
  - The create form, with its Template select.
  - Delete on your own lists.
- **One list in pick mode** (`<Watchlists embedded pickList=…>`). It shows:
  - the pick header: `‹ Lists` (`watchlist.lists`), the title, `+` (`watchlist.addSymbol`, own lists only) and ⚙
    (`widget.settings`);
  - the column titles (right-click opens `watchlist.colMenu`);
  - the rows (right-click opens `watchlist.rowMenu`).

**What pick mode hides.** `.pickMode .wlHeader { display: none }` (Watchlists.module.css:700) hides the list's own
header: its name and that name's right-click menu, plus its action buttons. Those are rendered but invisible. Other
things are not rendered at all in pick mode (`!pickList`):
- the tab bar;
- the sub-header with the column presets and `+ New List`;
- the colour-tag groups;
- each list header's `+`.

The only mode switch the widget has is `‹ Lists`, which goes back to the picker. The picker carries none of the
hidden controls.

## The 29 rows: where each control lives
Teach = what a walkthrough would ring. A "step" is something the member does (highlighted). The Agent never changes a
mode itself.

### A. In the widget and reachable today: 13 rows
| Row | Control in the widget | Steps the member performs | Anchor |
|---|---|---|---|
| C3-071 Create a list from a template | Picker → My Lists → create form → Template select | ‹ Lists (if a list is open) → the create form | `watchlist.createList` exists; **the Template select has none** |
| C3-076 Add a symbol | Pick header `+` (own lists only) | open one of your lists | `watchlist.addSymbol` |
| C3-079 Remove a symbol | Row menu → Remove from watchlist | open your list → right-click a row | `watchlist.rowMenu` + `data-menu-id="remove"` |
| C3-083 Show or hide a column | Column titles → right-click → Columns | open a list → right-click a title | `watchlist.colMenu`; titles by `aria-label` "Sort by …" |
| C3-085 Reorder columns by drag | Drag a column title onto another | open a list | titles by `aria-label` (no anchor of their own) |
| C3-086 Resize a column | The divider's `title="Drag to resize column"` | open a list | by `title` (catalog row `list.colResize` exists) |
| C3-087 Reset columns | Column menu → Reset columns | open a list → right-click a title | `watchlist.colMenu` (catalog row `list.colReset` exists) |
| C3-088 Write or edit a ticker note | Row menu → Notes | open your list → right-click a row | `data-menu-id="notes"` |
| C3-102 A row's attention facts | The Attention column's cell (facts in its tooltip) | Column menu → turn Attention on, if it's off | colMenu row by label; **the cell has no anchor** (the row render is pinned byte for byte) |
| C3-103 List appearance (canvas, text, tint) | ⚙ Watchlist settings | open a list → ⚙ | `widget.settings` |
| C3-104 Save or load a watchlist look | ⚙ → Templates | open a list → ⚙ | inside the settings panel; **to verify which anchors it has** |
| C3-105 Track or freeze a linked scan or theme | The empty widget's Subscribe offer (`SubscribeOffer`) | ‹ Lists; a Scanner/Themes widget in the same colour group | **dark** behind `listSubscribeEnabled`; truthful "unavailable" while off; **no anchor** |
| C3-106 Use a saved screen as a list | The empty widget's `ScreenSourceOffer` | ‹ Lists | **dark**, same flag; **no anchor** |

### B. In the widget, but hidden by pick mode with no step that reveals them: 11 rows
These are on the list's own header (hidden by the CSS rule above), on its name's right-click menu, or on its action
buttons:

| Row | Control (Watchlists.jsx) |
|---|---|
| C3-073 Rename a list | list-name menu → Rename |
| C3-074 Rename the Flagged list | the same menu, on Flagged |
| C3-080 Remove all starred | list-name menu → Remove starred (n) |
| C3-094 Copy a list to the clipboard | list-name menu → Copy list to clipboard |
| C3-095 Export CSV or Excel | list-name menu → Export CSV / Export Excel |
| C3-096 Import tickers | list-name menu → Import tickers |
| C3-097 Version history / restore | list-name menu → Version history (needs the server's history store) |
| C3-092 Make a list public | header lock button (`title` "Share with community" / "Make Private") |
| C3-093 Mark a list prebuilt (admin) | header button "Publish to Prebuilt (UCT)" |
| C3-072 Save a community list to My Lists | header button "Save … to My Lists" (TERM-077 dialog) |
| C3-091 Share a tag colour or Flagged | Flagged header's share button; the tag groups are not rendered in pick mode |

**No walkthrough can ring these in the widget today.** Pick mode hides them on purpose (an owner decision). The only
mode switch, `‹ Lists`, leads to the picker, which does not have them. Teaching them in the widget therefore needs a
**product change**, not just anchors. For example: the pick header's title opens the same list-level menu on
right-click, or a `⋯` button beside ⚙ does.
- The menu would be the existing one: same items, same handlers, no new writes.
- That is the Watchlists owner's call, and it is not attribute-only.
- **Needs an owner decision before any teaching work on these 11.**

### C. Not in the widget at all: 5 rows
| Row | Where it is |
|---|---|
| C3-066 Open a colour-tag list | the unscoped page's tag groups only (`!pickList`); the picker has no tag lists |
| C3-084 Apply a column preset | the unscoped sub-header only (`COL_PRESETS`, `!pickList`) |
| C3-089 Expand or collapse a list | the widget shows one list, always open: nothing to collapse. Truthful answer: "a widget shows one list; ‹ Lists switches" |
| C3-090 Tag a symbol with a colour | the ticker action menu (`components/TickerActions.jsx`, via TickerPopup), not the widget |
| C3-081 Reorder symbols by hand | no control in the product: `dragItemId` is never set in Watchlists.jsx, so there is no drag start |

## Anchors the widget lacks (attribute-only; their own commit)
- the create form's **Template** select (`WatchlistPicker.jsx`): `data-guide="watchlist.createTemplate"`;
- the Subscribe and saved-screen offers (`ListSubscription.jsx`): `data-guide="watchlist.subscribe"` and
  `"watchlist.screenSource"`;
- the ⚙ settings panel's Templates section: to verify; anchor it only if nothing it already carries can be used.

Not anchored on purpose: a row's own cells. The row render is pinned byte for byte by `Watchlists.entitykeys.test.jsx`,
so the Attention facts are rung through the column, not the cell.

## How it is built (group A first)
1. **Held-out phrasings first**, in this file's own words, for the 13 group A rows.
2. **Routing for the watchlist family, generalised:**
   - the existing `WATCHLIST_ACTIONS` / catalog `place: 'list' | 'picker'` rows, extended by what a control does;
   - no phrase tables;
   - each walkthrough's steps include the member's own mode steps: ‹ Lists, open your list, right-click.
3. **Rails:**
   - each step rings a real anchor (`agentGuideTargets`);
   - instructions name the member's step;
   - Exit, Escape and a new request cancel;
   - a no-write spy shows no watchlist fetch writes, SWR mutate, prefs or opts writes during a walkthrough.
4. **A browser pass** on the agent harness.
5. **Groups B and C:** truthful answers only, until the owner decides on B.
