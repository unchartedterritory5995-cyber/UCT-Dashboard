// Loads the YouTube IFrame Player API once and reports when it's ready.
// The API enables us to detect when a video ends (→ "Next up" card) and switch
// videos in-place — so users navigate our library instead of YouTube's
// off-site end-screen suggestions.
import { useEffect, useState } from 'react'

let loadPromise = null

function loadApi() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.YT && window.YT.Player) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      try { prev && prev() } catch { /* ignore */ }
      resolve()
    }
    if (!document.getElementById('yt-iframe-api')) {
      const s = document.createElement('script')
      s.id = 'yt-iframe-api'
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  })
  return loadPromise
}

export function useYouTubeApi() {
  const [ready, setReady] = useState(
    () => typeof window !== 'undefined' && !!(window.YT && window.YT.Player),
  )
  useEffect(() => {
    let alive = true
    loadApi().then(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [])
  return ready
}
