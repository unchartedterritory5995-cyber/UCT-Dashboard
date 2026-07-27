import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders `children` into a real, separate browser window the user can drag to
 * another monitor.
 *
 * The window is a PORTAL, not a second app: all the React state, hooks and
 * effects keep running in the opener's JS context and only the DOM nodes live
 * over there. That's deliberate — it means every popped window shares the ONE
 * browser-wide SSE pool (priceStreamManager / barsStreamManager), so ten popped
 * widgets across three monitors cost the backend exactly what one tab costs
 * today. Booting a second app per window instead would multiply the live-price
 * and bars streams per user.
 *
 * The trade-off is that a popped window dies with its opener, which is the
 * agreed behaviour: reloading the main tab closes the popouts.
 */
export default function PopoutWindow({
  title = 'UCT Intelligence',
  width = 1200,
  height = 800,
  onClose,
  onBlocked,
  children,
}) {
  const [container, setContainer] = useState(null)
  // Held in refs so a caller passing inline arrow functions can't retrigger the
  // effect and tear down / reopen the window on every parent render.
  const onCloseRef = useRef(onClose)
  const onBlockedRef = useRef(onBlocked)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { onBlockedRef.current = onBlocked }, [onBlocked])

  useEffect(() => {
    const features = [
      `width=${width}`, `height=${height}`,
      'popup=yes', 'menubar=no', 'toolbar=no',
      'location=no', 'status=no', 'resizable=yes', 'scrollbars=yes',
    ].join(',')

    const win = window.open('', '', features)
    if (!win) {
      // Blocked. This only happens when the call isn't tied to a user gesture,
      // or the user has popups blocked for the site — surface it, don't fail mute.
      onBlockedRef.current?.()
      return
    }

    win.document.title = title
    const mount = win.document.createElement('div')
    mount.className = 'uct-popout-root'
    win.document.body.appendChild(mount)

    const stopSyncing = syncStyles(document, win.document)
    const stopForwardingKeys = forwardKeyboard(win, window)

    let done = false
    const finish = () => {
      if (done) return
      done = true
      onCloseRef.current?.()
    }

    // beforeunload covers the user clicking the window's ✕. The poll is the
    // backstop — beforeunload is not guaranteed to fire for every close path.
    win.addEventListener('beforeunload', finish)
    const poll = setInterval(() => { if (win.closed) finish() }, 400)

    // A popped window with no opener is an orphan the user can't get rid of
    // through the app, so it goes when the main tab does.
    const closeOrphan = () => { try { win.close() } catch { /* already gone */ } }
    window.addEventListener('beforeunload', closeOrphan)

    setContainer(mount)

    return () => {
      done = true          // unmount is an intentional close, not a user close
      clearInterval(poll)
      window.removeEventListener('beforeunload', closeOrphan)
      stopSyncing()
      stopForwardingKeys()
      try { win.removeEventListener('beforeunload', finish) } catch { /* cross-window teardown */ }
      try { if (!win.closed) win.close() } catch { /* already gone */ }
      setContainer(null)
    }
    // Intentionally mount-once: `title`/size are initial window properties, and
    // re-running this would close and reopen the user's window mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the tab label current without reopening the window.
  useEffect(() => {
    if (container) {
      try { container.ownerDocument.title = title } catch { /* window closing */ }
    }
  }, [container, title])

  return container ? createPortal(children, container) : null
}

/**
 * Mirror the opener's CSS into the popup and keep it mirrored.
 *
 * Two forms have to be handled: built <link rel=stylesheet> assets in
 * production, and the <style> tags Vite injects in dev (which HMR replaces on
 * every edit — hence the observer, without which a popped window drifts out of
 * date the moment you touch a stylesheet).
 */
function syncStyles(src, dst) {
  const copyNode = (node) => {
    if (node.tagName === 'LINK' && node.rel === 'stylesheet') {
      const link = dst.createElement('link')
      link.rel = 'stylesheet'
      link.href = node.href
      dst.head.appendChild(link)
      return
    }
    if (node.tagName === 'STYLE') {
      const style = dst.createElement('style')
      style.textContent = readCssText(node)
      dst.head.appendChild(style)
    }
  }

  src.querySelectorAll('link[rel="stylesheet"], style').forEach(copyNode)

  // Theme lives on <html data-theme> / body classes, and the design tokens hang
  // off :root — without these the popup renders unstyled-light against the app's
  // dark canvas.
  dst.documentElement.className = src.documentElement.className
  for (const attr of Array.from(src.documentElement.attributes)) {
    if (attr.name.startsWith('data-')) {
      dst.documentElement.setAttribute(attr.name, attr.value)
    }
  }
  dst.body.className = src.body.className

  const base = dst.createElement('style')
  base.textContent = `
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden;
                 background: var(--bg, #0f0f0f); color: var(--color-text, #cfcfcf); }
    .uct-popout-root { height: 100vh; width: 100vw; display: flex; flex-direction: column; }
  `
  dst.head.appendChild(base)

  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(n => {
        if (n.nodeType === 1 && (n.tagName === 'STYLE' || n.tagName === 'LINK')) copyNode(n)
      })
    }
  })
  observer.observe(src.head, { childList: true })
  return () => observer.disconnect()
}

function readCssText(styleNode) {
  if (styleNode.textContent) return styleNode.textContent
  // Rules inserted via CSSOM leave textContent empty.
  try {
    return Array.from(styleNode.sheet?.cssRules || []).map(r => r.cssText).join('\n')
  } catch {
    return ''   // cross-origin sheet
  }
}

/**
 * Re-fire the popup's key events on the opener's document.
 *
 * Chart hotkeys, the drawing tools' Ctrl+Z / Escape and the type-to-search
 * handlers all bind to the OPENER's document, which popup key events never
 * reach — so without this, typing in a popped-out chart does nothing at all.
 *
 * The editable check is done HERE rather than left to the downstream handlers:
 * once an event is re-dispatched its target is the opener's document, so a
 * handler's own "ignore this if the user is typing in an input" guard can no
 * longer see the real field. Filtering at the source keeps that intent intact.
 */
function forwardKeyboard(fromWin, toWin) {
  const relay = (e) => {
    if (isEditable(fromWin.document.activeElement)) return
    const clone = new toWin.KeyboardEvent(e.type, {
      key: e.key, code: e.code,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
      repeat: e.repeat, location: e.location,
      bubbles: true, cancelable: true,
    })
    // Dispatching on document also runs window-level listeners — both are used.
    const notCancelled = toWin.document.dispatchEvent(clone)
    if (!notCancelled) e.preventDefault()
  }
  fromWin.document.addEventListener('keydown', relay)
  fromWin.document.addEventListener('keyup', relay)
  return () => {
    try {
      fromWin.document.removeEventListener('keydown', relay)
      fromWin.document.removeEventListener('keyup', relay)
    } catch { /* window already torn down */ }
  }
}

function isEditable(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}
