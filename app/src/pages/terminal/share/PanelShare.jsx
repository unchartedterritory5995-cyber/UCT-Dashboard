// UCT Terminal: share a panel. THE BUTTON in the panel frame, and its menu (owner pick
// 2026-11-17: "copy any Terminal list as a clean image or a spreadsheet file, ready to post in
// Discord or send to someone").
//
// ONE control, drawn by the frame for every panel `shareRule.js` allows; no panel carries code
// for it. The menu is the app's own (`ContextPopover`: an anchored menu with arrow keys on a
// desktop, a bottom `Sheet` with 44px rows on a phone or tablet).
//
// ⛔ OFFERED ONLY WHILE THE PANEL SHOWS A LIST. The button is drawn when the panel body holds a
// table with a row in it, and goes away when it does not (loading, an empty state, a panel that
// draws words instead of a table), so it is never a button that can only say "nothing to share".
// The frame learns that by watching its own body for added and removed nodes; each change costs
// one `querySelector`, at most once a frame. It reads no row and loads nothing.
//
// ⛔ NOTHING OF THE FEATURE RUNS UNTIL THE MEMBER OPENS THE MENU. The reader, the picture and the
// file writer are one lazily imported module (`./shareActions`); this file is all the Terminal's
// first load pays. Opening the menu starts that import, so the click that follows finds it
// loaded and can write the clipboard inside the click (Safari allows a picture onto the
// clipboard nowhere else).
//
// ⛔ WHAT IS SHARED IS WHAT IS ON SCREEN. The panel's body is read at the moment an item is
// chosen: the rows drawn then, after the member's filters and sort. No request is made.
//
// What it says: every outcome is a shell notice (`onNotice`), which the shell shows and also
// announces in its polite live region: "Copied ...", "Downloaded ...", or why nothing happened.
import { useCallback, useEffect, useRef, useState } from 'react'
import ContextPopover from '../../../components/mobile/ContextPopover'
import UIcon from '../../../components/ui/UIcon'

const loadShare = () => import('./shareActions')

/**
 * Does the panel body show a table with at least one row of cells? A cheap look that needs no
 * module: a table inside a `hidden` box or a closed `<details>` does not count. The reader makes
 * the full call (a column folded away by CSS, a row hidden by a class) when an item is chosen.
 */
export function holdsList(body) {
  if (!body?.querySelectorAll) return false
  for (const table of body.querySelectorAll('table')) {
    if (table.querySelector('td') && !table.closest('[hidden], details:not([open])')) return true
  }
  return false
}

/** Whether the body holds a list now, kept true to the DOM as the panel draws and redraws. */
function useHoldsList(bodyRef) {
  const [has, setHas] = useState(false)
  useEffect(() => {
    const body = bodyRef?.current
    if (!body) return undefined
    const look = () => setHas(holdsList(body))
    look()
    if (typeof MutationObserver !== 'function') return undefined
    const soon = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16)
    const never = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout
    let frame = 0
    const seen = new MutationObserver(() => { if (!frame) frame = soon(() => { frame = 0; look() }) })
    // Nodes coming and going, and the two attributes that open or hide a section.
    seen.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] })
    return () => { seen.disconnect(); if (frame) never(frame) }
  }, [bodyRef])
  return has
}

const icon = (name) => <UIcon name={name} size={14} gold={false} />

export default function PanelShare({ index, decision, bodyRef, meta, onNotice, className, load = loadShare }) {
  const button = useRef(null)
  const mod = useRef(null)       // the loaded module, so a click can act without waiting
  const loading = useRef(null)   // its import, taken on the first open
  const [anchor, setAnchor] = useState(null)
  const has = useHoldsList(bodyRef)
  const code = meta?.code || 'This panel'

  const take = useCallback(() => {
    if (!loading.current) {
      loading.current = load().then((m) => { mod.current = m; m.warmShare?.(); return m })
      // A failed load must not be remembered: the next open tries again.
      loading.current.catch(() => { loading.current = null })
    }
    return loading.current
  }, [load])

  const open = (e) => {
    e.stopPropagation()
    // The list can go between the last look and this click (a refresh that came back empty).
    if (!holdsList(bodyRef?.current)) {
      onNotice?.({ kind: 'info', text: `${code} shows no list to share right now.` })
      return
    }
    take().catch(() => {})
    const r = e.currentTarget.getBoundingClientRect?.() || { left: 0, bottom: 0 }
    setAnchor({ x: r.left, y: r.bottom + 4 })
  }

  const run = (kind) => () => {
    const failed = () => onNotice?.({ kind: 'error', text: 'Sharing did not work just now, so nothing was copied or downloaded. Try again.' })
    const act = (m) => m.sharePanel(kind, bodyRef?.current, meta)
    let done
    // Loaded already (the usual case: opening the menu loaded it): act inside the click.
    try { done = mod.current ? act(mod.current) : take().then(act) } catch { failed(); return }
    Promise.resolve(done).then((said) => { if (said) onNotice?.(said) }).catch(failed)
  }

  const items = [
    decision.image && { key: 'image', label: 'Copy as image', icon: icon('camera'), onClick: run('image'),
      hint: 'A picture of this list as you see it, with its title, as-of time and source' },
    decision.file && { key: 'csv', label: 'Download spreadsheet (CSV)', icon: icon('download'), onClick: run('csv'),
      hint: 'The rows and columns on screen as a file Excel and Sheets open' },
    decision.file && { key: 'text', label: 'Copy as text', icon: icon('copy'), onClick: run('text'),
      hint: 'The rows and columns on screen as text to paste into a message or a sheet' },
  ].filter(Boolean)

  // No list on screen: no button. An open menu stays until it is closed (its opener may be gone,
  // and the menu then hands focus back to wherever it was).
  if (!has && !anchor) return null
  return (
    <>
      {has && (
        <button ref={button} type="button" className={className} onClick={open}
          aria-haspopup="menu" aria-expanded={anchor ? 'true' : 'false'}
          aria-label={`Share panel ${index + 1}: copy its list as an image or a file`}
          title="Share: copy this list as an image or a file" data-testid={`terminal-share-${index}`}>
          <UIcon name="upload" size={14} gold={false} />
        </button>
      )}
      <ContextPopover
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchor={anchor}
        title={`Share ${code}`}
        items={items}
        returnFocusTo={button}
        signature
      />
    </>
  )
}
