// Tiny module-level arbiter so the Desk video's audio-primary playback and
// the read-aloud voice bar never stomp each other's MediaSession lock-screen
// claim. GlobalVideoLayer sets this true while its <audio> element is the
// active playback clock; AudioPlayerBar's own MediaSession effect checks it
// and early-returns rather than reclaiming the lock screen.
let _videoOwns = false

export function setVideoOwnsMediaSession(v) {
  _videoOwns = !!v
}

export function videoOwnsMediaSession() {
  return _videoOwns
}
