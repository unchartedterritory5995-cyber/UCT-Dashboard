// ── UCT Agent PRODUCT GUIDE: the NAMED-CONTROL CATALOG ───────────────────────────────────────────────────────────
//
// registry.js and actions.js teach features and families, each with its own words. This file teaches the long tail the
// same way for every control: an entry is a control the product already NAMES (its data-guide anchor, accessible name,
// tooltip or on-screen label), WHERE it lives (a place), and the concepts that describe it (guide/words.js). Nothing here
// is a phrase: a request reaches an entry when it carries every concept the entry needs, and the place it lives in.
//
//   { place, need, also?, any?, target, name, say, open?, alt? }
//     place   'w:<widget type>' a board widget (added from Widgets ▾ first if absent) · 'chart' on the chart talked about ·
//             'drawing' a drawing's own menu · 'settings:<tab>' a Chart Settings tab · 'list' a watchlist's own list ·
//             'picker' a Watchlist widget's list picker · 'library' the layout library · 'bar' a layout's menu on the bar
//     need    the concepts the words must carry ("delete list")
//     also    concepts that may be there too and make it a better fit (an object it acts on, its widget's name)
//     any     one of these must be there as well (a verb several words can say)
//     open    the steps that bring the control on screen, before the place's own opening
//
// ⛔ NEVER GUESS. A request that names an object this control does not act on is not about it. Two controls that fit the
// words equally are ASKED about (readControl → { ask }), never chosen between, and a control whose place the words do not
// name is only ever asked about — and only when no other walkthrough claimed the words (capabilities/guide.js).
// ⛔ NEVER INVENT A CONTROL. agentGuideControls.test.js rails every name and anchor against the product's source.

import { conceptsOf, describe, OBJECTS } from './words'
import { GEAR, onBoard } from './actions'
import { SLOTS, DRAWING_TOOLS } from './slots'
import { labelMap, menuGroups } from '../../widgets/registry'
import { CONTROLS as DRAW_CONTROLS, SCHEMA as DRAW_SCHEMA } from '../../components/chart/drawingSettingsSchema'

let labels = {}
try { labels = labelMap('menu') } catch { labels = {} }
const widgetLabel = (type) => String(labels[type] || type)
let menu = []
try { menu = menuGroups('workspace').flatMap(g => g.items) } catch { menu = [] }
const inMenu = (type) => menu.includes(type)

// a widget's own names: the words that say which widget a control is in
const PLACE_WORDS = {
  alerts: ['alert'], news: ['news', '~catalyst'], tradeExchangeNews: ['news', 'headline'], calendar: ['calendar', 'list', '~day', '~today'],
  breadth: ['breadth'], fundamentals: ['financials'], indexes: ['index'], marketcontext: ['context'], aisearch: ['ai', 'answer', 'conversation', 'search'],
  themes: ['theme', 'ranking'], watchlist: ['list'], volumescan: ['surge', '~scope'], scatter: ['map'], notebook: ['notebook', 'note', 'folder'],
  scanner: ['scan'], profile: ['~profile', '~peer'], optionsflow: ['~flow', '~option', '~options'],
}
const placeWords = (place) => {
  if (place.startsWith('w:')) return PLACE_WORDS[place.slice(2)] || []
  if (place === 'list' || place === 'picker') return ['list']
  if (place === 'library' || place === 'bar') return ['layout']
  return null   // on the chart: the chart is where every request is, so it needs no naming
}

// ── the openings each place starts with ──
const WL = 'watchlist'
const PICKER = { widgetType: WL, attr: 'data-guide', value: 'watchlist.picker' }
const OPEN_LIST = { widgetType: WL, guide: 'watchlist.lists' }
const LAYOUT_TAB = { within: 'workspace.layouts', attr: 'data-layout-pin' }
const DRAW_MENU = (label) => ({ within: 'chart.drawingMenu', label })
function opening(place, row) {
  if (place.startsWith('w:')) {
    const type = place.slice(2)
    // a widget the Widgets menu does not offer here (Indexes, Market Context) is shown only where a board already has it
    return inMenu(type) ? onBoard(type, widgetLabel(type), [{ widgetType: type }]) : []
  }
  // a list open in the widget: its ‹ Lists button is how the widget shows it (the list's own header is hidden in pick mode)
  if (place === 'list') {
    return [
      ...onBoard(WL, widgetLabel(WL), [OPEN_LIST, PICKER]),
      { target: PICKER, name: 'your lists', text: 'Click one of your own lists to open it.', waitFor: OPEN_LIST, optional: true, late: true },
    ]
  }
  // the widget's list picker: on a widget showing a list, ‹ Lists brings it back
  if (place === 'picker') {
    return [
      ...onBoard(WL, widgetLabel(WL), [OPEN_LIST, PICKER]),
      { target: OPEN_LIST, name: '‹ Lists', text: 'Click ‹ Lists to open the list picker.', waitFor: PICKER, optional: true },
    ]
  }
  if (place === 'library') return [{ target: 'workspace.layoutLibrary', name: 'the layout library', text: 'Open the layout library.', waitFor: 'workspace.layoutLibraryMenu' }]
  if (place === 'bar') return [{ target: LAYOUT_TAB, name: 'a layout on the bar', text: 'Right-click one of your layouts on the bar.', waitFor: { within: 'workspace.layoutMenu', lead: '← Move left' } }]
  if (place === 'drawing') return [{ target: 'chart.plot', name: 'the chart', text: `Right-click ${row.on || 'a drawing'} on the chart. If this chart has none yet, draw one first.`, waitFor: row.target }]
  if (place.startsWith('settings:')) {
    const tab = place.slice(9)
    return [GEAR, { target: `chartSettings.tab.${tab}`, name: `the ${row.tabLabel || tab} tab`, text: `Open ${row.tabLabel || tab}.`, waitFor: { id: `chartSettings.tab.${tab}`, on: true } }]
  }
  return []
}

// ── the catalog ──
const w = (type, need, target, name, say, more = {}) => ({ place: `w:${type}`, need, target: typeof target === 'string' ? { widgetType: type, aria: target } : { widgetType: type, ...target }, name, say, ...more })
const title = (value) => ({ attr: 'title', value })
const JOURNAL = '^Send (?!to Journal).+ to Journal$'
const SEND = ['send', 'save', 'copy', '~add', '~get']
// every widget whose own header carries "Send … to Journal" (the scan's has its own walkthrough: actions.js scanJournal)
// with what each one's button says it sends (its accessible name: "Send this snapshot to Journal")
const JOURNAL_WIDGETS = { alerts: 'these alerts', news: 'this feed', calendar: 'this day', breadth: 'this snapshot', fundamentals: 'these financials', indexes: 'these index levels', marketcontext: 'this market context', aisearch: 'this conversation', themes: 'this ranking' }

const ROWS = [
  ...Object.entries(JOURNAL_WIDGETS).map(([type, what]) => w(type, 'journal', { nameRe: JOURNAL }, `Send ${what} to Journal`, `This sends the ${widgetLabel(type)} widget to your Journal. The arrow beside it chooses where it goes.`, { id: `journal.${type}`, any: SEND, alt: 'Send to Journal shows in this widget’s top bar once it has something to send.', label: `Sending ${widgetLabel(type)} to the Journal` })),

  // ── a watchlist's own lists, in the Charts Watchlist widget. ⛔ The widget shows a list in PICK MODE, which hides the list's
  // header (Watchlists.module.css .pickMode .wlHeader { display: none }): its Delete, Share, Prebuilt, Send to Journal buttons and
  // its right-click menu (rename, copy, export, import, history, remove starred) are NOT reachable here, so they are not taught.
  // What the widget does show: the picker, with a bin on each of your lists (WatchlistPicker.jsx).
  { id: 'list.delete', place: 'picker', need: 'delete list', target: { within: 'watchlist.picker', nameRe: '^Delete (?!watchlist)' }, name: 'the list’s bin', say: 'Click the bin beside a list to delete it. It asks before anything is lost.', alt: 'Only your own lists have a bin. Make one with ＋ New, and it shows here.', fallback: [PICKER], label: 'Deleting a watchlist' },
  { id: 'list.back', place: 'list', need: 'list', any: ['~picker', '~other', '~different', '~another'], also: 'choose', target: { widgetType: WL, guide: 'watchlist.lists' }, name: '‹ Lists', say: 'Click ‹ Lists to go back to the list picker and open another list.', label: 'Going back to the list picker' },

  // ── layouts: the library (the + on the bar) and a layout's own menu on the bar (pages/charts/LayoutDock.jsx) ──
  { id: 'library.delete', place: 'library', need: 'delete layout', not: ['~bar', 'pin', '~prebuilt', '~template', '~global'], target: { within: 'workspace.layoutLibraryMenu', nameRe: '^Delete .+ permanently$' }, name: 'the bin', say: 'This bin deletes that layout permanently. It asks first.', alt: 'Only your own layouts can be deleted. They are listed here once you save one.', label: 'Deleting a layout' },
  { id: 'library.pin', place: 'library', need: 'pin layout', target: { within: 'workspace.layoutLibraryMenu', nameRe: '^Add .+ to the bar$' }, name: 'Add to the bar', say: 'Click this to put that layout on the bar.', alt: 'Every layout is already on the bar.', label: 'Putting a layout on the bar' },
  { id: 'bar.moveLeft', place: 'bar', need: 'move layout', also: 'left', target: { within: 'workspace.layoutMenu', lead: '← Move left' }, name: 'Move left', say: 'Move left and Move right shift the layout one place along the bar.', label: 'Moving a layout along the bar' },

  // ── tabs (pages/charts/widgets/ChartTabStrip.jsx; a widget's own tabs in WidgetHeader) ──
  { id: 'tab.renameChart', place: 'chart', need: 'rename chart tab', target: ['chart.tabs', 'chart.addTab'], name: 'the chart’s tabs', say: 'Double-click a tab’s name, type the new one and press Enter.', alt: 'This chart has one tab. This + adds another; then double-click its name to rename it.', label: 'Renaming a chart tab' },
  { id: 'tab.linkChart', place: 'chart', need: 'chart tab', any: ['colour', '~group', '~link', 'follow'], target: [{ within: 'chart.tabs', aria: "Change tab's linked color group" }, 'chart.addTab'], name: 'the tab’s dot', say: 'Click the dot on a tab to change the colour group it follows.', alt: 'This chart has one tab. This + adds another, and each tab gets its own dot.', label: 'A chart tab’s link colour' },
  { id: 'tab.renameWidget', place: 'chart', need: 'rename widget tab', target: ['workspace.widgetTabs', 'widget.addTab'], name: 'the widget’s tabs', say: 'Double-click a tab’s name, type the new one and press Enter.', alt: 'This widget has one tab. This + adds another; then double-click its name to rename it.', label: 'Renaming a widget tab' },

  // ── the chart's toolbar and the panels it opens (components/chart/ChartToolbar.jsx, ScreenshotPopover, TracingsPanel) ──
  { id: 'chart.magnet', place: 'chart', need: 'snap drawing', also: 'tool', target: { within: '@chart', nameRe: '^Magnet' }, name: 'the magnet', say: 'This magnet snaps your drawing points to a candle’s open, high, low or close. Click it to turn it on or off.', label: 'The drawing magnet' },
  { id: 'chart.repeat', place: 'chart', need: 'repeat drawing', also: 'tool', target: { within: '@chart', nameRe: '^Repeat drawing' }, name: 'Repeat drawing', say: 'With this on, the drawing tool stays armed after you place one. Click it to turn it on or off.', label: 'Repeat drawing' },
  { id: 'chart.customizeTools', place: 'chart', need: 'choose tool', also: 'drawing pin', target: 'chart.customizeTools', name: 'Customize', say: 'This chooses which drawing tools show on the toolbar, and which are your favourites.', label: 'Choosing your drawing tools' },
  ...[
    ['new', 'New board', { label: 'New board' }, 'board', ['~new', '~start', '~create', '~fresh', '~another'], 'Click New board. You draw on the board marked active.'],
    ['rename', 'Rename', { nameRe: '^Rename (?!chart tab)' }, 'rename board', null, 'Click the pencil, type the new name and press Enter. Double-clicking the name does the same.'],
    ['delete', 'Delete', { nameRe: '^Delete (?!Drawing)' }, 'delete board', null, 'Click this bin, then confirm. You always keep at least one board.'],
    ['switch', 'a board', { nameRe: '^(Draw on this board|Active board)' }, 'board', ['~switch', '~change', '~another', 'move', 'choose', '~other'], 'Click a board to draw on it. Each board keeps its own drawings.'],
  ].map(([id, name, t, need, any, say]) => ({
    id: `boards.${id}`, place: 'chart', need, any, also: 'drawing', name, say, label: `Drawing boards: ${name}`,
    open: [{ target: { within: '@chart', aria: 'Drawing Boards' }, name: 'Drawing Boards', text: 'Click Drawing Boards, at the end of the drawing tools.', waitFor: { within: '@chart', label: 'New board' } }],
    target: { within: '@chart', ...t },
  })),
  ...[
    ['png', 'Download PNG', 'image', ['export', 'save'], 'Click Download PNG to save the chart as an image file.'],
    ['copy', 'Copy to Clipboard', 'copy image', null, 'Click Copy to Clipboard, then paste the picture wherever you want it.'],
    ['url', 'Copy Share URL', 'link', ['share', 'copy', '~get'], 'Click Copy Share URL to copy a link to this chart.'],
  ].map(([id, label, need, any, say]) => ({
    id: `share.${id}`, place: 'chart', need, any, not: ['~install', '~open'], also: 'chart share image copy', name: label, say, label: `Sharing: ${label}`,
    open: [{ target: 'chart.share', name: 'Share', text: 'Click Share.', waitFor: { within: '@chart', label: 'Download PNG' } }],
    target: { within: '@chart', label },
  })),

  // ── Chart Settings rows the settings table does not carry (components/chart/ChartSettingsModal.jsx) ──
  { id: 'settings.wmAlign', place: 'settings:canvas', tabLabel: 'Canvas', need: 'watermark', any: ['left', '~right', 'center', '~align', '~alignment'], target: { within: 'chartSettings', label: 'Alignment' }, alt: 'The watermark is off on this chart: turn on Watermark on this tab first, and its settings show below it.', fallback: [{ within: 'chartSettings', label: 'Watermark' }, 'chartSettings.tab.canvas'], name: 'Alignment', say: 'Alignment sets the watermark to the left, the centre or the right. It shows while the watermark is on.', label: 'Aligning the watermark' },
  { id: 'settings.wmMove', place: 'settings:canvas', tabLabel: 'Canvas', need: 'watermark move', target: { within: 'chartSettings', label: 'Move watermark' }, alt: 'The watermark is off on this chart: turn on Watermark on this tab first, and its settings show below it.', fallback: [{ within: 'chartSettings', label: 'Watermark' }, 'chartSettings.tab.canvas'], name: 'Move watermark', say: 'Click Move watermark, then drag it on the chart. Reset to center beside it puts it back.', label: 'Moving the watermark' },
  { id: 'settings.wmReset', place: 'settings:canvas', tabLabel: 'Canvas', need: 'watermark', any: ['reset', 'center'], target: { within: 'chartSettings', label: 'Reset to center' }, alt: 'Reset to center shows here once you have moved this chart’s watermark: it is where it started now. Move watermark places it.', fallback: [{ within: 'chartSettings', label: 'Move watermark' }, 'chartSettings.tab.canvas'], name: 'Reset to center', say: 'Click Reset to center to put the watermark back in the middle.', label: 'Centring the watermark' },
  { id: 'settings.barInfo', place: 'settings:header', tabLabel: 'Header', need: 'legend', any: ['~bar', '~value', '~field', '~ohlc', '~volume', 'choose'], target: { within: 'chartSettings', label: 'Bar info' }, name: 'Bar info', say: 'Bar info chooses which of the bar’s values the legend shows.', label: 'The legend’s bar values' },

  // ── widgets' own controls ──
  ...[
    ['implied', 'Sort by implied move', '~impli'], ['eps', 'Sort by EPS surprise', '~eps'], ['revenue', 'Sort by revenue surprise', '~revenue'],
  ].map(([id, t, word]) => w('calendar', `sort ${word}`, title(t), t, 'Click this column title to sort by it. Click it again to reverse the order.', { id: `calendar.sort.${id}`, label: `Sorting earnings: ${t.replace('Sort by ', '')}` })),
  w('calendar', 'sort', { nameRe: '^Sorted by market cap' }, 'Market cap', 'The list is sorted by market cap. Click this to reverse it, or another column title to sort by that.', { id: 'calendar.sort.cap', any: ['~cap', '~market'], label: 'Sorting earnings by market cap' }),
  w('tradeExchangeNews', 'save headline', { nameRe: '^(Save headline|Remove bookmark)$' }, 'the bookmark', 'Click the bookmark on a headline to save it, and again to unsave it.', { id: 'te.save', label: 'Saving a headline', alt: 'This shows on each headline once the feed has loaded.' }),
  ...[
    ['list', 'list ticker', 'Click ⋯ on a headline: Add to watchlist puts its ticker on one of your lists.'],
    ['notebook', '~notebook', 'Click ⋯ on a headline: it sends the headline to your Notebook.'],
    ['collection', 'collection', 'Click ⋯ on a headline: it puts the headline in one of your collections.'],
  ].map(([id, need, say]) => w('tradeExchangeNews', `headline ${need}`, 'More actions for this headline', '⋯', say, { id: `te.more.${id}`, also: 'send save', label: `A headline’s actions: ${id}`, alt: 'This shows on each headline once the feed has loaded.' })),
  w('tradeExchangeNews', 'news', { nameRe: 'live feed$' }, 'Live', 'Click this to go back to today’s newest headlines and the live feed.', { id: 'te.live', any: ['live', '~back'], label: 'Back to the live feed' }),
  w('tradeExchangeNews', 'news', 'Choose a date', 'the date', 'Click the date to browse the headlines of a past day.', { id: 'te.pastDay', any: ['~past', '~earlier', '~day', '~date', 'history'], label: 'Browsing a past day’s news' }),
  w('tradeExchangeNews', 'manage collection', 'Manage collections', 'Manage collections', 'This creates, renames and deletes your collections.', { id: 'te.collections', also: 'news headline', label: 'Managing collections', alt: 'Collections are in the saved headlines view of this widget: open it from the widget, then this button shows.' }),
  w('aisearch', 'stop', 'Stop search', 'Stop', 'This stops the search that is running.', { id: 'ai.stop', label: 'Stopping a search', alt: 'Nothing is running now. Stop shows here while a search runs.' }),
  w('aisearch', 'save answer', title('Save this answer (reopen it later)'), 'Save', 'This saves the answer so you can reopen it later from Saved answers.', { id: 'ai.save', label: 'Saving an answer', alt: 'Ask something first: this shows under each answer.' }),
  w('aisearch', 'copy answer', title('Copy answer text'), 'Copy', 'This copies the answer’s text.', { id: 'ai.copy', also: '~text', label: 'Copying an answer', alt: 'Ask something first: this shows under each answer.' }),
  w('aisearch', 'answer', 'Saved answers', 'Saved answers', 'Your saved answers: reopen one, or remove it.', { id: 'ai.saved', any: ['~saved', '~reopen', 'delete'], label: 'Your saved answers' }),
  w('aisearch', 'ai', 'Ask mode', 'Ask mode', 'This chooses how deep the search goes.', { id: 'ai.mode', any: ['~mode', '~deep', '~quick'], label: 'The ask mode' }),
  w('notebook', 'note', 'Note title', 'the title', 'Click the title or the text and type: the note saves as you go.', { id: 'note.edit', any: ['rename', '~edit', '~rewrite', '~title', '~change'], label: 'Editing a note', alt: 'Open a note from the list first.' }),
  w('indexes', 'hide index', { nameRe: '^Hide ' }, 'Hide', 'Click this to hide that index from the widget.', { id: 'indexes.hide', label: 'Hiding an index' }),
  w('scanner', 'refresh scan', 'Refresh scan', 'Refresh scan', 'This runs the scan again now.', { id: 'scanner.refresh', label: 'Refreshing a scan', alt: 'Pick a scan first: this button shows on its results.' }),
  w('scatter', 'zoom map', 'Zoom in', 'Zoom', 'These zoom the map in and out, and reset it.', { id: 'map.zoom', label: 'Zooming the Market Map', alt: 'These show on the map once it has a universe and its data.' }),
  w('scatter', 'map label', { nameRe: '^Cycle ticker labels' }, 'Labels', 'This cycles the ticker labels: spotlight, all, or off.', { id: 'map.labels', also: 'ticker hide', label: 'The Market Map’s labels', alt: 'These show on the map once it has a universe and its data.' }),
  w('scatter', 'map follow', 'Follow the linked list', 'Follow', 'This makes the map follow the linked watchlist.', { id: 'map.follow', also: 'list', label: 'Following the linked list', alt: 'These show on the map once it has a universe and its data.' }),
  w('volumescan', 'delete list', title('Delete list'), 'Delete list', 'This deletes the list. It asks first.', { id: 'surge.delete', label: 'Deleting a Volume Surge list', alt: 'You have no lists of your own here yet.' }),
  w('volumescan', 'rename list', title('Rename'), 'Rename', 'Click this, type the new name and press Enter.', { id: 'surge.rename', label: 'Renaming a Volume Surge list', alt: 'You have no lists of your own here yet.' }),
  w('volumescan', 'ticker list', 'Add a ticker to this list', 'Add a ticker', 'Type a ticker here to add it to the list.', { id: 'surge.add', any: ['~add', '~put'], label: 'Adding a ticker to a Volume Surge list', alt: 'Open one of your lists first.' }),
  // ── round 7: the Options Flow widget's own filters (the funnel's strip: OptionsFlowWidget.jsx) ──
  w('optionsflow', '', { guide: 'flow.filter.min' }, 'Min', 'Pick the smallest premium a print must have to show.', { id: 'flow.min', any: ['~premium', '~minimum', '~min', '~size', '~big', '~large', '~dollar'], label: 'Options Flow: minimum premium', open: [{ target: { widgetType: 'optionsflow', guide: 'flow.filters' }, name: 'the funnel', text: 'Click the funnel to open the filters.', waitFor: { widgetType: 'optionsflow', guide: 'flow.filterStrip' } }] }),
  w('optionsflow', '', { guide: 'flow.filter.cp' }, 'Calls / Puts', 'All, Calls or Puts: which side of the tape shows.', { id: 'flow.cp', any: ['~call', '~put'], label: 'Options Flow: calls or puts', open: [{ target: { widgetType: 'optionsflow', guide: 'flow.filters' }, name: 'the funnel', text: 'Click the funnel to open the filters.', waitFor: { widgetType: 'optionsflow', guide: 'flow.filterStrip' } }] }),
  w('optionsflow', '', { guide: 'flow.filter.type' }, 'Sweep / Block', 'Any, Sweep or Block: which kind of print shows.', { id: 'flow.type', any: ['~sweep', '~block'], label: 'Options Flow: sweeps or blocks', open: [{ target: { widgetType: 'optionsflow', guide: 'flow.filters' }, name: 'the funnel', text: 'Click the funnel to open the filters.', waitFor: { widgetType: 'optionsflow', guide: 'flow.filterStrip' } }] }),
  w('optionsflow', '', { guide: 'flow.filter.dir' }, 'Bull / Bear', 'All, Bull or Bear: which direction shows.', { id: 'flow.dir', any: ['~bull', '~bear', '~bullish', '~bearish'], label: 'Options Flow: bullish or bearish', open: [{ target: { widgetType: 'optionsflow', guide: 'flow.filters' }, name: 'the funnel', text: 'Click the funnel to open the filters.', waitFor: { widgetType: 'optionsflow', guide: 'flow.filterStrip' } }] }),
  // ── cov-5: the background's own control on the Canvas tab (ChartSettingsModal: Background, Solid / Gradient and its swatch) ──
  { id: 'settings.background', place: 'settings:canvas', tabLabel: 'Canvas', need: 'background', not: ['~gradient', '~swing', '~label', '~text', '~note', '~font', '~logo', '~logos', '~widget', '~watchlist', '~signal', '~palette', '~intensity'], target: { within: 'chartSettings', label: 'Background' }, name: 'Background', say: 'Background sets the chart’s colour: Solid and its swatch for one colour, or Gradient for two.', label: 'The chart’s background' },
  // ── round 3: a list's columns, the Scanner's picker, nudging a drawing, Volume Surge logos, a headline on the chart ──
  { id: 'list.colResize', place: 'list', need: 'column', also: 'ticker', any: ['~resize', '~wider', '~widen', '~narrow', '~narrower', '~stretch', '~width', 'size'], target: { widgetType: WL, attr: 'title', value: 'Drag to resize column' }, name: 'the column’s edge', say: 'Drag this edge between two column titles to make the column wider or narrower.', label: 'Resizing a list’s column' },
  { id: 'list.colReset', place: 'list', need: 'reset column', also: 'ticker', open: [{ target: { widgetType: WL, nameRe: '^Sort by ' }, name: 'the column titles', text: 'Right-click any column title.', waitFor: 'watchlist.colMenu' }], target: { within: 'watchlist.colMenu', label: 'Reset columns' }, name: 'Reset columns', say: 'Click Reset columns to go back to the default columns.', label: 'Resetting a list’s columns' },
  w('scanner', 'search scan', { aria: 'Search' }, 'the search box', 'Type part of a scan’s name here: the list of scans narrows as you type.', { id: 'scanner.search', also: 'choose ticker', label: 'Searching the scans', alt: 'A scan is open in this widget: ‹ goes back to the list of scans, where the search box is.' }),
  w('scanner', 'scan', { guide: 'watchlist.lists' }, '‹', 'Click ‹ to leave this scan and go back to the list of scans.', { id: 'scanner.back', also: 'list', any: ['~back', '~picker', '~leave', '~exit', '~other', '~another', '~different', 'choose'], label: 'Back to the list of scans', alt: 'The list of scans is already showing: click one to open it.' }),
  { id: 'chart.nudge', place: 'chart', need: 'drawing', also: 'move', any: ['~nudge', '~keyboard', '~key'], target: 'chart.plot', name: 'the chart', say: 'Click a drawing to select it, then press the arrow keys: each press nudges it a little.', label: 'Nudging a drawing from the keyboard' },
  w('volumescan', '~logo', { guide: 'widget.settings' }, 'its gear', 'This gear opens the Volume Surge widget’s settings: Show logos puts the company logos beside the tickers.', { id: 'surge.logos', any: ['~show', '~turn', '~hide', '~company'], label: 'Logos on Volume Surge' }),
  w('news', 'headline chart', 'Place headline on chart', 'Place on chart', 'Click this on a headline to place it on the chart at its date.', { id: 'news.place', any: ['pin', '~place', '~put', '~add', '~show', '~onto'], label: 'A headline on the chart', alt: 'This shows on each headline once the feed has loaded.' }),
]

// ── a drawing's menu, from the product's own schema (components/chart/drawingSettingsSchema.js): every control a drawing
// type offers, under its own label, on the drawings that have it. Colour, levels, alert, lock, hide and delete have their own
// walkthroughs (actions.js DRAWING_ACTIONS).
const TAKEN = new Set(['color', 'fibLevels', 'setAlert', 'positionAlerts', 'lock', 'hide', 'remove', 'adjustAnchors'])
const toolLabel = Object.fromEntries(DRAWING_TOOLS.map(t => [t.id, t.label]))
const byLabel = new Map()
for (const [type, sections] of Object.entries(DRAW_SCHEMA)) {
  if (!toolLabel[type]) continue
  for (const id of Object.values(sections).flat()) {
    const c = DRAW_CONTROLS[id]
    if (!c || TAKEN.has(id) || typeof c.label !== 'function' && !c.label) continue
    const label = typeof c.label === 'string' ? c.label : null
    if (!label) continue
    const row = byLabel.get(label) || { id: `draw.${id}`, label, tools: [] }
    row.tools.push(type)
    byLabel.set(label, row)
  }
}
const SAY = { 'Make horizontal': 'Click Make horizontal to flatten the line at its price.', Duplicate: 'Click Duplicate to add a copy of this drawing.', 'Save as default': 'Click Save as default: new drawings of this kind start with this style.', 'Reset levels': 'Click Reset levels to put the Fibonacci levels back to their defaults.', 'Set level…': 'Click Set level… and type the exact price.' }
// a label that does not say what it does in a member's words: what it does, as the need (Save as default keeps a style)
const DOES = {
  'Save as default': { need: 'save drawing', any: ['reset', '~setting', '~style', '~next', '~new'] },
  // it sets an exact price: "flatten it" is Make horizontal
  'Set level…': { need: 'drawing', any: ['~exact', '~exactly', '~number'], also: 'flatten' },
  // cov-5: a drawing has no clipboard copy, so "copy that line" is Duplicate
  Duplicate: { need: 'drawing', any: ['duplicate', 'copy'] },
  // cov-5: "show the price on my line" is the price label, said without the word label
  'Show price label': { need: 'price drawing', any: ['label', '~show', '~display', '~see'] },
}
// cov-5: a control only the Text Note has: "the note" is that drawing (a note is an object; here it is the one it acts on)
const textOnly = (tools) => tools.length > 0 && tools.every(t => t === 'text')
const a = (tools) => tools.map(t => toolLabel[t]).filter(Boolean)
const listOf = (xs) => (xs.length <= 2 ? xs.join(' or ') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`)
for (const row of byLabel.values()) {
  const names = a(row.tools)
  const every = names.length >= DRAWING_TOOLS.length - 3
  // the label's own words, less "show" (a toggle's verb); "Set level…" reads as the level itself
  const need = String(row.label).replace(/^Show /, '').replace(/…$/, '')
  const onText = textOnly(row.tools) ? { need, any: ['drawing', '~note'], also: `hide colour note ${names.join(' ')}` } : {}
  ROWS.push({
    id: row.id, place: 'drawing', need: `${need} drawing`, also: `hide colour ${names.join(' ')}`, tools: row.tools, ...onText, ...DOES[row.label],
    on: every ? 'a drawing' : `a ${listOf(names)}`,
    target: DRAW_MENU(row.label), name: row.label, label: `A drawing’s ${row.label.replace(/…$/, '')}`,
    say: SAY[row.label] || `${row.label.replace(/…$/, '')} is here, on this drawing’s menu.`,
  })
}

const ownName = (r) => [r.name, ...[].concat(r.target).flatMap(t => (typeof t === 'object' ? [t.aria, t.label, t.lead, t.value] : []))].filter(Boolean).join(' ')
// a word list read as concepts the way a request is ('~day' is the word, 'list' the concept)
const norm = (xs) => new Set(xs.flatMap(x => (x.startsWith('~') ? [...conceptsOf(x.slice(1))] : [x])))
// each row, read once: its concepts and its steps
export const CONTROL_ROWS = ROWS.map(r => {
  const need = describe(r.need)
  // the words of the control's own name count too: what it says it is is what it is about
  const also = new Set([...(r.also ? describe(r.also) : []), ...describe(ownName(r))])
  const pw = placeWords(r.place)
  // with `alt`: when the control itself is not there yet, the place it appears in (its widget, or `fallback`) is rung, and `alt` says why
  const finalStep = { target: r.alt ? [].concat(r.target, r.fallback || [], r.place.startsWith('w:') ? [{ widgetType: r.place.slice(2) }] : []) : r.target, name: r.name, text: r.say, altText: r.alt }
  const opener = [...opening(r.place, r), ...(r.open || [])]
  return { ...r, needSet: need, alsoSet: also, anySet: r.any ? norm(r.any) : null, notSet: r.not ? norm(r.not) : null, placeSet: pw ? norm(pw) : null, steps: [...opener, finalStep] }
})

const has = (q, c) => q.has(c)
/** How well one row fits these concepts → null (not this control) | { score, placed }. */
function fit(row, q, weak = false) {
  // weak: only what the control DOES must be said ("rename it"): never shown, only asked about
  for (const c of row.needSet) if (!has(q, c) && !(weak && OBJECTS.has(c))) return null
  if (weak && ![...row.needSet].some(c => has(q, c))) return null
  if (row.anySet && ![...row.anySet].some(c => has(q, c))) return null
  if (row.notSet && [...row.notSet].some(c => has(q, c))) return null
  // an object the words name that this control does not act on: it is about something else
  const own = new Set([...row.needSet, ...row.alsoSet, ...(row.placeSet || []), ...(row.anySet || [])])
  for (const c of q) if (OBJECTS.has(c) && !own.has(c) && !(row.place === 'drawing' && c === 'chart') && !(c === 'widget' && row.place.startsWith('w:'))) return null
  const full = [...row.needSet].every(c => has(q, c))
  const placed = full && (!row.placeSet || [...row.placeSet].some(c => has(q, c)))
  // every word of the control's own that the request also says makes it a better fit
  let score = [...row.needSet].filter(c => has(q, c)).length + (row.anySet ? [...row.anySet].filter(c => has(q, c)).length : 0)
  for (const c of row.alsoSet) if (has(q, c)) score += 0.5
  if (row.placeSet) for (const c of row.placeSet) if (has(q, c) && !row.needSet.has(c)) score += 1
  return { score, placed }
}
const toolNamed = (text) => SLOTS.tool.read(text)

/**
 * The control these words describe → null | { row } | { ask: rows } | { say }.
 * `weak`: also offer the controls whose place the words did not name (asked about, never shown straight away).
 */
export function readControl(text, { weak = false } = {}) {
  const q = conceptsOf(text)
  // a weak read (only ever a question) only when every word is one the catalog understands: "position sizing" is not a layout
  if (weak && [...q].some(c => c.startsWith("~"))) weak = false
  const hits = []
  for (const row of CONTROL_ROWS) {
    const f = fit(row, q, weak)
    if (f && (f.placed || weak)) hits.push({ row, ...f })
  }
  if (!hits.length) return null
  const best = Math.max(...hits.map(h => h.score))
  const top = hits.filter(h => h.score === best)
  const placedTop = top.filter(h => h.placed)
  if (placedTop.length === 1) return finish(placedTop[0].row, text)
  return { ask: (placedTop.length ? placedTop : top).map(h => h.row) }
}
// a drawing control asked about on a drawing that has no such control: said, never swapped for another
function finish(row, text) {
  if (row.place !== 'drawing') return { row }
  const tool = toolNamed(text)
  if (tool && !row.tools.includes(tool.id)) return { say: `A ${tool.label} has no ${row.name.replace(/…$/, '')}. That’s on the menu of a ${listOf(a(row.tools))}.` }
  return { row }
}

const where = (row) => (row.place.startsWith('w:') ? `the ${widgetLabel(row.place.slice(2))} widget`
  : row.place === 'list' || row.place === 'picker' ? 'a watchlist' : row.place === 'library' || row.place === 'bar' ? 'the layouts bar'
    : row.place === 'drawing' ? 'a drawing’s menu' : row.place.startsWith('settings:') ? 'Chart Settings' : 'the chart')
/** The question for words several controls fit. */
export function askWhich(rows) {
  const seen = new Set()
  const opts = rows.filter(r => { const k = `${r.label}|${where(r)}`; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 6)
  const say = (r) => `${r.label.replace(/^Sending (.+) to the Journal$/, '$1')} (${where(r)})`
  // one candidate whose place the words did not name: still a question, never a walkthrough on a guess
  if (opts.length === 1) return `Do you mean ${say(opts[0])}? If so, ask me again naming it; if not, tell me where you saw the control.`
  return `Which one do you mean: ${opts.map(say).join('; ')}? Ask me again with its name.`
}

/** The catalog as one guide feature (registry.js puts it ahead of the broad features whose words it would otherwise lose). */
export const CONTROL_FEATURE = {
  id: 'control', slots: ['ctrl'], terms: [], words: [], control: 'that control', title: '{ctrl.label}', titleAny: 'Finding a control', topic: 'charts', caps: [],
  explain: 'That control is on its widget, its panel or the chart. Add the widget from Widgets ▾ if it isn’t on your board.',
  // a drawing without the control ("say") is only said when no other walkthrough took the words (capabilities/guide.js)
  match: (q) => { const r = readControl(q); return !!(r?.row || r?.ask) },
  steps: [{ each: 'ctrl' }],
}
SLOTS.ctrl = { read: (text) => readControl(text)?.row || null, rows: CONTROL_ROWS }
