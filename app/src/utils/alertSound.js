// Alert sound utility — 10 synthesized notification tones via Web Audio API
// No external audio files — all generated in-browser

let audioCtx = null

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

function tone(ctx, freq, type, start, dur, vol = 0.15) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(vol, ctx.currentTime + start)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime + start)
  osc.stop(ctx.currentTime + start + dur)
}

// ── 10 Sound Definitions ──

function playChime(ctx) {
  tone(ctx, 880, 'sine', 0, 0.3, 0.15)
  tone(ctx, 1047, 'sine', 0.15, 0.35, 0.12)
}

function playBell(ctx) {
  tone(ctx, 1200, 'sine', 0, 0.5, 0.12)
  tone(ctx, 1500, 'sine', 0, 0.5, 0.06)
  tone(ctx, 1800, 'sine', 0, 0.3, 0.03)
}

function playDing(ctx) {
  tone(ctx, 1400, 'sine', 0, 0.15, 0.18)
}

function playDoubleTap(ctx) {
  tone(ctx, 800, 'square', 0, 0.08, 0.08)
  tone(ctx, 1000, 'square', 0.12, 0.08, 0.08)
}

function playTriplePop(ctx) {
  tone(ctx, 600, 'sine', 0, 0.1, 0.12)
  tone(ctx, 800, 'sine', 0.1, 0.1, 0.12)
  tone(ctx, 1000, 'sine', 0.2, 0.15, 0.12)
}

function playRadar(ctx) {
  tone(ctx, 440, 'sine', 0, 0.6, 0.1)
  tone(ctx, 880, 'sine', 0.05, 0.5, 0.05)
}

function playUrgent(ctx) {
  tone(ctx, 900, 'sawtooth', 0, 0.12, 0.06)
  tone(ctx, 1100, 'sawtooth', 0.15, 0.12, 0.06)
  tone(ctx, 900, 'sawtooth', 0.3, 0.12, 0.06)
}

function playSoft(ctx) {
  tone(ctx, 523, 'sine', 0, 0.4, 0.08)
  tone(ctx, 659, 'sine', 0.2, 0.4, 0.08)
  tone(ctx, 784, 'sine', 0.4, 0.5, 0.06)
}

function playPulse(ctx) {
  tone(ctx, 660, 'triangle', 0, 0.15, 0.14)
  tone(ctx, 660, 'triangle', 0.25, 0.15, 0.1)
}

function playMajor(ctx) {
  tone(ctx, 523, 'sine', 0, 0.2, 0.12)    // C5
  tone(ctx, 659, 'sine', 0.15, 0.2, 0.12)  // E5
  tone(ctx, 784, 'sine', 0.3, 0.2, 0.12)   // G5
  tone(ctx, 1047, 'sine', 0.45, 0.35, 0.1) // C6
}

export const ALERT_SOUNDS = [
  { key: 'chime',      label: 'Chime',       play: playChime },
  { key: 'bell',       label: 'Bell',        play: playBell },
  { key: 'ding',       label: 'Ding',        play: playDing },
  { key: 'double_tap', label: 'Double Tap',  play: playDoubleTap },
  { key: 'triple_pop', label: 'Triple Pop',  play: playTriplePop },
  { key: 'radar',      label: 'Radar',       play: playRadar },
  { key: 'urgent',     label: 'Urgent',      play: playUrgent },
  { key: 'soft',       label: 'Soft',        play: playSoft },
  { key: 'pulse',      label: 'Pulse',       play: playPulse },
  { key: 'major',      label: 'Major Chord', play: playMajor },
]

const SOUND_MAP = Object.fromEntries(ALERT_SOUNDS.map(s => [s.key, s.play]))

export function playAlertSound(soundKey = 'chime') {
  try {
    const ctx = getCtx()
    const fn = SOUND_MAP[soundKey] || SOUND_MAP.chime
    fn(ctx)
  } catch {
    // Audio not available
  }
}

export function previewSound(soundKey) {
  playAlertSound(soundKey)
}

export function requestNotificationPermission() {
  if (!('Notification' in window)) return Promise.resolve('denied')
  if (Notification.permission === 'granted') return Promise.resolve('granted')
  if (Notification.permission === 'denied') return Promise.resolve('denied')
  return Notification.requestPermission()
}

export function showBrowserNotification(title, body, icon) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const notification = new Notification(title, {
      body,
      icon: icon || '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'uct-alert',
      requireInteraction: false,
    })
    setTimeout(() => notification.close(), 8000)
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch {
    // Notification API not available
  }
}
