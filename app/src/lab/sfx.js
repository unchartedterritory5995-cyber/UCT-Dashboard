// THE SOUND MAP and the voice-line player. One place for every sound the Study makes, so the whole app sounds like
// one product: soft, short, mutable. Voice lines are the owner's own recordings (docs/study/VOICE_LINES.md) served
// from /study/voice/<key>.mp3; when a file is missing the player is silent and only the caption shows.
let actx = null
let muted = false
try { muted = localStorage.getItem('study.sfx.muted') === '1' } catch { /* no storage */ }
export const isMuted = () => muted
export function setMuted(v) { muted = !!v; try { localStorage.setItem('study.sfx.muted', muted ? '1' : '0') } catch { /* no storage */ } }

function ctx() { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); return actx }
function note(f, at, dur, vol = 0.1, type = 'triangle') {
  const c = ctx(); const o = c.createOscillator(); const g = c.createGain()
  o.type = type; o.frequency.value = f
  g.gain.setValueAtTime(0.0001, c.currentTime + at)
  g.gain.exponentialRampToValueAtTime(vol, c.currentTime + at + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur)
  o.connect(g).connect(c.destination); o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.05)
}
const MAP = {
  right: () => [523, 659, 784].forEach((f, i) => note(f, i * 0.08, 0.18)),
  wrong: () => [220, 175].forEach((f, i) => note(f, i * 0.12, 0.2, 0.08, 'square')),
  combo: () => [659, 784, 988, 1175].forEach((f, i) => note(f, i * 0.06, 0.16, 0.09)),
  levelup: () => [523, 659, 784, 1047, 1319].forEach((f, i) => note(f, i * 0.1, 0.35, 0.1)),
  chest: () => [392, 523, 659, 784].forEach((f, i) => note(f, i * 0.09, 0.3, 0.08, 'sine')),
  streak: () => [440, 554, 659].forEach((f, i) => note(f, i * 0.1, 0.25, 0.09, 'sine')),
  tick: () => note(1200, 0, 0.03, 0.02, 'sine'),
  buy: () => [784, 1047].forEach((f, i) => note(f, i * 0.05, 0.12, 0.1)),
}
export function sfx(name) { if (muted) return; try { MAP[name]?.() } catch { /* no audio */ } }

const LINES = {
  welcome: "Let's find a setup.", right: "That's it.", right_combo: "You're on a run.", wrong: 'Not that one. Look again.',
  red_day: 'Sellers finished the day in charge.', kicker: 'Opens above the red body, closes strong. Sellers are trapped.',
  line: 'That low is the line.', entry: "Over the previous day's high, or the opening range break.",
  buy_perfect: 'Right on the trigger.', buy_early: 'Too early. Nothing has triggered.', buy_late: 'Late. The move was already on.',
  lesson_done: 'Lesson done. See you tomorrow.', level_up: 'Level up.', streak: 'Streak alive.', chest: 'Open it.',
  boss_win: "That's a trader.", boss_fail: 'Not yet. Review and come back.',
}
export const voiceCaption = (key) => LINES[key] || ''
let current = null
/** Play the owner's recorded line if the file exists; resolve with { played } either way. */
export function voice(key) {
  const caption = LINES[key] || ''
  if (muted) return Promise.resolve({ played: false, caption })
  try {
    if (current) { current.pause(); current = null }
    const a = new Audio(`/study/voice/${key}.mp3`)
    current = a
    return a.play().then(() => ({ played: true, caption })).catch(() => ({ played: false, caption }))
  } catch { return Promise.resolve({ played: false, caption }) }
}
