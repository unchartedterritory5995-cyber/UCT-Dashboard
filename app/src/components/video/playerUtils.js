// Pure helpers for the custom UCT video player chrome.

// Format seconds as m:ss (or h:mm:ss past an hour). NaN/negative → "0:00".
export function fmtTime(secs) {
  const s = Math.max(0, Math.floor(Number(secs) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const ss = String(sec).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

// Playback-speed ladder for the one-tap speed button.
export const RATES = [1, 1.25, 1.5, 1.75, 2]
export function nextRate(rate) {
  const i = RATES.indexOf(rate)
  if (i === -1) return RATES[0]
  return RATES[(i + 1) % RATES.length]
}

// Clamp a desired top-left so the mini player stays fully on screen, leaving
// `bottomClear` px free at the bottom (mobile tab bar). 8px edge gutter.
export function clampMiniPos(pos, w, h, vw, vh, bottomClear = 0) {
  const maxLeft = Math.max(8, vw - w - 8)
  const maxTop = Math.max(8, vh - h - bottomClear - 8)
  return {
    left: Math.min(Math.max(8, pos.x), maxLeft),
    top: Math.min(Math.max(8, pos.y), maxTop),
  }
}
