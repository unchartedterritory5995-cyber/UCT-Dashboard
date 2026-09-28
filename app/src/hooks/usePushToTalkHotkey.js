import { useEffect } from 'react'
import useRealtimeSession from './useRealtimeSession'
import { registerShortcuts } from '../pages/command/shortcutRegistry'

/**
 * Cmd/Ctrl+Shift+V: starts/ends a normal Realtime conversation.
 * Cmd/Ctrl+Shift+T: starts/ends a Train Me session (restricted to memory tools).
 *
 * TERM-063: both chords are declared in pages/command/shortcutRegistry.js
 * ('voice.talk', 'voice.trainMe') — physical key (`e.code`), Cmd on a Mac / Ctrl
 * elsewhere (read from navigator.platform per keystroke, as before), window bubble
 * phase, fires inside text fields and on auto-repeat, exactly as the raw listener did.
 */
export default function usePushToTalkHotkey({ context = 'global' } = {}) {
  const { connect, disconnect, isConnected } = useRealtimeSession()

  useEffect(() => registerShortcuts({
    'voice.talk': (e) => {
      e.preventDefault()
      if (isConnected) disconnect(); else connect(context)
    },
    'voice.trainMe': (e) => {
      e.preventDefault()
      if (isConnected) disconnect(); else connect('train_me')
    },
  }), [connect, disconnect, isConnected, context])
}
