// Best-effort Document Picture-in-Picture: pops the video into a separate
// always-on-top OS window (Chrome/Edge) the user can drag to another monitor.
//
// Error 153 ("video player configuration error", debug code
// `embedder.identity.missing.referrer`) means YouTube's embed got no valid HTTP
// Referer. The PiP window's document is `about:blank`, which has NO URL — so a
// YouTube /embed iframe placed directly in it sends no referrer and 153s, and
// `referrerPolicy` can't help (there's no document URL to derive a referrer
// from). The fix: don't point the PiP iframe at YouTube at all — point it at a
// tiny SAME-ORIGIN shim page on our domain (`/pip-embed`, served by the
// backend) which then embeds YouTube. That shim has a real https URL, so the
// nested embed gets a valid referrer and plays. The iframe src MUST be absolute
// (about:blank can't resolve a relative `/pip-embed`).
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
  // Absolute same-origin shim URL — about:blank can't resolve a relative path.
  const shim = new URL('/pip-embed', window.location.origin)
  shim.searchParams.set('v', videoId)
  if (start) shim.searchParams.set('t', String(start))

  const iframe = pip.document.createElement('iframe')
  iframe.src = shim.toString()
  iframe.style.cssText = 'width:100%;height:100vh;border:0;display:block;'
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
  iframe.setAttribute('allowfullscreen', '')
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
