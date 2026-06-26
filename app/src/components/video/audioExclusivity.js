// When a Desk video starts, silence any other audio source (read-aloud / voice)
// so the user never hears two streams at once. Deliberately conservative: we
// only pause currently-playing <audio> elements; we never touch the voice state
// machine (a stray reset there caused the past "Read Aloud stuck-on" orphan).
export function pauseOtherAudio() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('audio').forEach((el) => {
    try { if (!el.paused) el.pause() } catch { /* ignore */ }
  })
}
