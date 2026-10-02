// Per-SETUP feedback on the Morning Wire board (owner 2026-10-02: "train the
// brain and system to give good setups"). Admin only. Each board card gets the
// same 👍 / 👎 / ✎ controls the brief's segments carry, keyed `setup:<SYM>`, and
// a "Missed a setup?" box under the board records `missed:<SYM>` with a note.
// The rundown is dangerouslySetInnerHTML, so these are injected into its DOM,
// exactly like the segment controls in MorningWire.jsx.

export const SETUP_SYM_RE = /^[A-Z][A-Z0-9.]{0,9}$/

export const MISSED_HTML =
  '<div class="rd-missed-fb">' +
  '<span class="rd-missed-label">Missed a setup?</span>' +
  '<input class="rd-missed-sym" maxlength="10" placeholder="TICKER" aria-label="ticker the board missed" autocapitalize="characters" />' +
  '<input class="rd-missed-note" maxlength="2000" placeholder="What made it a good setup?" aria-label="why it was a good setup" />' +
  '<button class="rd-note-save" data-fb-missed="1">Save</button>' +
  '<span class="rd-missed-status" aria-live="polite"></span>' +
  '</div>'

/** The card's ticker: `data-sym` when the engine stamped it, else its header text. */
export function cardSym(card) {
  const raw = card?.dataset?.sym || card?.querySelector('.rd-pick-sym')?.textContent || ''
  const sym = raw.trim().toUpperCase()
  return SETUP_SYM_RE.test(sym) ? sym : ''
}

/** A typed ticker, cleaned ('$skhy ' -> 'SKHY'); '' when it is not a ticker. */
export function missedSymFrom(text) {
  const sym = String(text || '').trim().toUpperCase().replace(/^\$/, '')
  return SETUP_SYM_RE.test(sym) ? sym : ''
}

/** Tickers already logged as missed today, from the hydrated feedback map. */
export function loggedMisses(hydrated) {
  return Object.keys(hydrated || {})
    .filter((k) => k.startsWith('missed:'))
    .map((k) => k.slice('missed:'.length))
    .sort()
}

/** Inject the per-card controls and the missed-setup box (idempotent). */
export function injectSetupControls(root, ctrlHtml) {
  if (!root) return
  root.querySelectorAll('.rd-pick').forEach((card) => {
    if (card.querySelector('.rd-setup-fb')) return
    const sym = cardSym(card)
    if (!sym) return
    card.dataset.fbSym = sym
    const header = card.querySelector('.rd-pick-header')
    const bar = '<div class="rd-setup-fb"><span class="rd-setup-fb-label">Rate this setup</span>' +
      ctrlHtml(`setup:${sym}`) + '</div>'
    if (header) header.insertAdjacentHTML('afterend', bar)
    else card.insertAdjacentHTML('afterbegin', bar)
  })
  const grid = root.querySelector('.rd-top-picks-grid')
  if (grid && !root.querySelector('.rd-missed-fb')) grid.insertAdjacentHTML('afterend', MISSED_HTML)
}

/** Where a `setup:<SYM>` note panel opens: right under that card's controls. */
export function setupAnchor(root, seg) {
  if (!root || !String(seg).startsWith('setup:')) return null
  const sym = String(seg).slice('setup:'.length)
  return root.querySelector(`.rd-pick[data-fb-sym="${sym}"] .rd-setup-fb`)
}
