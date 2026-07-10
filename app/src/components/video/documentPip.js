// Best-effort Document Picture-in-Picture: pops the video into a separate
// always-on-top OS window (Chrome/Edge) the user can drag to another monitor.
//
// We load a PLAIN YouTube embed iframe (native controls) in the PiP window —
// NOT the JS IFrame API (whose cross-window postMessage handshake can't be
// verified once its iframe lives in the detached PiP document).
//
// Error 153 ("video player configuration error", debug code
// `embedder.identity.missing.referrer`) means YouTube's embed got no valid HTTP
// Referer. The PiP window's document is `about:blank`, which by default sends NO
// referrer for the cross-origin embed request — so a bare iframe still 153s. The
// fix is YouTube's documented remedy: set referrerPolicy = strict-origin-when-
// cross-origin, which makes Chrome send our origin (inherited from the opener —
// Document PiP is same-origin) as the Referer. See openPip() below.
//
// Caveat: a plain embed exposes no playback API, so we can't read the exact
// PiP position on close. We estimate it from wall-clock elapsed (assumes ~1x
// continuous playback) — a close-enough resume rather than a perfect handoff.

export function pipSupported() {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window
}

function copyStyles(pip) {
  try {
    for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
      pip.document.head.appendChild(node.cloneNode(true))
    }
  } catch { /* ignore */ }
}

// Opens the PiP window with a plain YouTube embed at `startSeconds`.
// Returns { pip, player } (player is a lightweight shim exposing
// getCurrentTime()/destroy() so callers stay API-compatible) or null if
// unsupported / blocked.
export async function openPip({ videoId, startSeconds = 0, width = 440, height = 248 }) {
  if (!pipSupported() || !videoId) return null
  let pip
  try {
    pip = await window.documentPictureInPicture.requestWindow({ width, height })
  } catch {
    return null
  }
  copyStyles(pip)
  const b = pip.document.body
  b.style.margin = '0'
  b.style.background = '#000'
  b.style.overflow = 'hidden'

  const start = Math.max(0, Math.floor(startSeconds) || 0)
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    fs: '1',
  })
  if (start) params.set('start', String(start))

  const iframe = pip.document.createElement('iframe')
  iframe.src = `https://www.youtube.com/embed/${videoId}?${params.toString()}`
  iframe.style.cssText = 'width:100%;height:100vh;border:0;display:block;'
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
  iframe.setAttribute('allowfullscreen', '')
  // REQUIRED in the about:blank PiP document — without an explicit policy Chrome
  // sends no Referer here, and YouTube rejects the embed with Error 153
  // (embedder.identity.missing.referrer). strict-origin-when-cross-origin makes
  // Chrome send our origin (same-origin with the opener) as the Referer.
  iframe.referrerPolicy = 'strict-origin-when-cross-origin'
  b.appendChild(iframe)

  // No playback API on a plain embed → estimate elapsed from wall-clock so the
  // in-page player can resume near where PiP left off.
  const openedAt = Date.now()
  const player = {
    getCurrentTime: () => start + (Date.now() - openedAt) / 1000,
    destroy: () => { try { iframe.remove() } catch { /* ignore */ } },
  }
  return { pip, player }
}
