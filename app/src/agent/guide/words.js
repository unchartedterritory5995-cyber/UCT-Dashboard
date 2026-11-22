// ── UCT Agent PRODUCT GUIDE: what a request's words MEAN, as concepts ──────────────────────────────────────────
//
// guide/controls.js describes each control by the concepts its own name carries ("Delete watchlist" → delete + list), and
// a request is read the same way, so "get rid of one of my watchlists" and "delete a list" are the same request. This is a
// lexicon, not a phrase table: a concept is a set of word stems, and any word it does not know is kept as itself (so a
// name the product uses — "heikin", "watermark", "magnet" — still matches only itself).
//
// `OBJECTS` are the things a control acts ON. A request that names an object the control does not account for is not
// about that control ("delete a TICKER from my list" is not "delete a list"): controls.js refuses it rather than guess.

// a stem matches a word that starts with it; `=word` matches only that word; 'two words' matches the phrase
const C = {
  // ── actions ──
  delete: ['delet', 'remov', 'eras', 'trash', 'discard', 'get rid', 'bin', 'drop', '=clear', 'clean out', 'take out', 'throw away'],
  rename: ['renam', 'retitl', 'change the name', 'call it', '=call', 'new name'],
  copy: ['=copy', 'copie', 'copying', 'clipboard'],
  duplicate: ['duplicat', 'clon', 'copy of', 'second one', 'another one like'],
  send: ['send', 'push', '=log', 'post', 'captur', 'into my journal', 'in my journal', 'to my journal', 'to the journal', 'into the journal', 'in the journal'],
  share: ['shar', 'publish', 'public', 'communit', 'everyone'],
  export: ['export', 'download', 'csv', 'excel', 'xlsx', 'spreadsheet', '=file'],
  import: ['import', '=paste', 'bulk', 'upload', 'bunch of', 'lots of', 'at once', 'many tickers'],
  history: ['version', 'history', 'older', 'earlier version', 'previous version', 'yesterday'],
  save: ['=save', 'saving', 'keep', 'bookmark', '=store', 'for later', 'for next time'],
  reset: ['reset', 'default', 'original', 'put back', 'back to its', 'back in the', 'restor'],
  sort: ['sort', 'order by', 'rank', '=flip'],
  refresh: ['refresh', 'rerun', 're-run', 'reload', 'fresh', 'run again', 'update the'],
  zoom: ['zoom', 'magnif', 'closer'],
  hide: ['hide', 'hidden', 'turn off', 'turn the', 'disappear', 'get it off'],
  stop: ['=stop', 'cancel', 'abort', 'halt', 'running'],
  search: ['search', '=find', 'look up', 'look for'],
  manage: ['manag', 'organi', 'edit my'],
  move: ['=move', 'moving', 'shift', 'reorder', 'one spot', 'position'],
  left: ['left'],
  center: ['center', 'centre', 'middle'],
  pin: ['=pin', 'onto the bar', 'on the bar', 'to the bar', 'to my bar', 'to the layouts bar'],
  follow: ['follow', 'track', 'in sync with'],
  snap: ['snap', 'magnet', 'stick to'],
  repeat: ['repeat', 'same drawing tool', 'keep drawing', 'keep the same', 'again and again', 'stay on'],
  choose: ['choos', 'pick', 'which', 'select', 'customi', 'favou?rit'],
  flatten: ['flatten', '=flat', 'is level', 'be level', 'make it level', 'horizontal', 'straighten'],
  live: ['live', 'latest', 'newest', 'right now'],
  // ── looks ──
  colour: ['colou?r', 'tint', 'shade'],
  fill: ['fill', 'shade', 'inside'],
  border: ['border', 'outline', 'edge'],
  italic: ['italic', 'slant'],
  bold: ['bold', 'heavier'],
  font: ['font', 'typeface'],
  size: ['size', 'bigger', 'smaller', 'larger'],
  label: ['label', 'tag'],
  // ── things a control acts on ──
  list: ['watchlist', 'watch list', 'list'],
  ticker: ['ticker', 'symbol', 'stock', '=name', '=names', '=row', '=rows', 'from the list', 'from my list', 'from a list', 'from the watchlist', 'from my watchlist', 'out of the list', 'out of my list'],
  layout: ['layout'],
  chart: ['chart'],
  drawing: ['drawing', 'drawn', '=line', '=lines', 'trendline', 'trend line', 'rectangle', '=box', 'circle', 'fib', 'retracement', 'text note', 'measure', 'ruler', 'arrow', 'channel', 'pitchfork', 'shape', 'ray'],
  board: ['board'],
  tab: ['tab'],
  widget: ['widget'],
  crosshair: ['crosshair'],
  indicator: ['indicator', 'definition', '=study', 'studies', 'formula', 'script'],
  notebook: ['notebook'],
  alert: ['alert'],
  headline: ['headline', 'story', 'stories', 'article'],
  news: ['news', 'feed'],
  note: ['=note', '=notes'],
  collection: ['collection'],
  answer: ['answer', 'reply'],
  scan: ['scan', 'screen'],
  index: ['index', 'indexes', 'indices', '=dow', 'nasdaq', 's&p'],
  journal: ['journal'],
  theme: ['theme'],
  calendar: ['calendar', 'earnings', 'reporters', 'terminal'],
  breadth: ['breadth'],
  map: ['market map', 'scatter', '=map'],
  image: ['image', 'picture', 'screenshot', 'png', 'snapshot'],
  link: ['=link', '=url', 'share url'],
  watermark: ['watermark'],
  legend: ['legend'],
  column: ['column'],
  preset: ['preset'],
  folder: ['folder'],
  tool: ['tool', 'toolbar'],
  conversation: ['conversation', '=chat'],
  ai: ['=ai', 'ai search'],
  surge: ['surge', 'volume scan'],
  ranking: ['ranking', 'leaderboard'],
  context: ['market context'],
  level: ['levels'],
  financials: ['financials', 'fundamentals'],
}
export const OBJECTS = new Set(['list', 'ticker', 'layout', 'drawing', 'board', 'tab', 'alert', 'headline', 'news', 'note', 'collection', 'answer', 'scan', 'index', 'theme', 'calendar', 'breadth', 'map', 'image', 'watermark', 'legend', 'column', 'preset', 'folder', 'conversation', 'surge', 'ranking', 'context', 'financials', 'widget', 'crosshair', 'indicator'])

// how a member asks, never what they ask about
const ASKING = /\b(how (do|can|would|should|could) (i|you|we|one)|show me( how( to)?| where)?|where (do|can|would|should) i|where(?:'s| is| are)|walk me through|guide me (through|to)|teach me( how)?( to)?|help me|i want to|i need to|is there a way to|what do i click to|go about)\b/g
const STOP = new Set('a an the this that these those my your our its it me i to of on in into for from with at by and or is are be do does can could would should how where what so just please one some all any each every there here up out off over go going about again then when while want need using way them their own will via thing things over once all'.split(' '))

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const pieceRe = (p) => (p.startsWith('=') ? `\\b${p.slice(1)}\\b` : /\s/.test(p) ? `\\b${p.split(/\s+/).map(w => (/[?*]/.test(w) ? w : escape(w))).join('\\s+')}\\b` : `\\b${/[?*]/.test(p) ? p : escape(p)}\\w*`)
const CONCEPTS = Object.entries(C).map(([id, pieces]) => ({ id, re: new RegExp(pieces.map(pieceRe).join('|'), 'i') }))
const KNOWN = new RegExp(Object.values(C).flat().map(pieceRe).join('|'), 'gi')

// a plural first, then a tense: "settings" and "setting" are one word, "notes" and "note" too
const stem = (w) => w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1').replace(/(ing|ed)$/, '').replace(/(.)\1$/, '$1')

/** The concepts these words carry → Set of concept ids (and, for a word no concept knows, `~stem`). */
export function conceptsOf(text) {
  // a key chord names keys, not things ("Alt+Shift+W" moves nothing)
  const q = ` ${String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/\b(?:ctrl|alt|shift|cmd|meta)(?:\s*\+\s*[\w-]+)+/g, ' ').replace(ASKING, ' ')} `
  const out = new Set()
  for (const c of CONCEPTS) if (c.re.test(q)) out.add(c.id)
  // the words no concept took: the product's own names ("heikin", "watermark") match only themselves
  for (const w of q.replace(KNOWN, ' ').split(/[^a-z0-9&]+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue
    out.add(`~${stem(w)}`)
  }
  return out
}
/** A description's concepts, for a control: the same reading, minus words that only fill out a name. */
export const describe = (text) => new Set([...conceptsOf(text)].filter(c => !/^~(this|these|choose|where|show|unfiled|more|actions|make|set|put|get|use|turn)$/.test(c)))
