// Best-effort Document Picture-in-Picture: pops the video into a separate
// always-on-top OS window (Chrome/Edge) the user can drag to another monitor.
//
// Caveat: a YouTube <iframe> reloads when re-parented into another document, so
// we spin up a FRESH player in the PiP window at the saved timestamp — i.e. a
// brief restart-then-resume rather than a perfectly seamless handoff. The PiP
// window uses YouTube's native controls (we don't re-render our React chrome
// into a second document).

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

// Opens the PiP window and starts a fresh YT player at `startSeconds`.
// Returns { pip, player } or null if unsupported / blocked.
export async function openPip({ videoId, startSeconds = 0, width = 440, height = 248 }) {
  if (!pipSupported() || !window.YT || !window.YT.Player) return null
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
  const mount = pip.document.createElement('div')
  mount.style.cssText = 'width:100%;height:100vh;'
  b.appendChild(mount)
  const player = new window.YT.Player(mount, {
    // The Document-PiP window is an `about:blank` document, so a YouTube embed
    // mounted in it sends no valid referrer → YouTube rejects with Error 153
    // ("video player configuration error"). Declaring origin + widget_referrer
    // (our real https origin) gives the embed a valid identity regardless of the
    // blank host document, which clears 153 + the embed-restriction check.
    host: 'https://www.youtube.com',
    videoId,
    playerVars: {
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      autoplay: 1,
      enablejsapi: 1,
      origin: window.location.origin,
      widget_referrer: window.location.href,
      start: Math.floor(startSeconds) || undefined,
    },
  })
  return { pip, player }
}
