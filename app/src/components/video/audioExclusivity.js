// When a Desk video starts, silence any other audio source (read-aloud / voice)
// so the user never hears two streams at once. Deliberately conservative: we
// only pause currently-playing <audio> elements; we never touch the voice state
// machine (a stray reset there caused the past "Read Aloud stuck-on" orphan).
export function pauseOtherAudio() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('audio').forEach((el) => {
    if (el.hasAttribute('data-uct-video-audio')) return  // the Desk video's own audio track
    try { if (!el.paused) el.pause() } catch { /* ignore */ }
  })
  // Browser-native TTS (Compass chat, earnings-call Listen) is a separate audio
  // system that no <audio> pause can reach — without this a Desk video played
  // over the top of it. Cancelling speech is safe here: unlike the voice state
  // machine there is nothing to leave inconsistent.
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel() } catch { /* ignore */ }
  }
}
