/**
 * Lane KEYS3 (Q2): does this template ask for a ticker? DERIVED from the template's own title:
 * it does when a known ticker changes the title ("Investment Thesis" becomes "NVDA Thesis").
 * No second list beside the catalog. A note made from such a template with no ticker known
 * opens with focus in its Ticker field (tabs/NotebookTab.jsx).
 *
 * Task 7.2: moved out of `notebookTemplates.js` (byte-for-byte the same function) so the Notebook's
 * entry code can ask it WITHOUT pulling the whole template catalog. `notebookTemplates.js`
 * re-exports it, so every other importer is unchanged.
 */
export function templateWantsTicker(tpl) {
  if (!tpl || typeof tpl.defaultTitle !== 'function') return false
  try {
    return tpl.defaultTitle({ ticker: 'ZZZZ' }) !== tpl.defaultTitle({})
  } catch {
    return false
  }
}
