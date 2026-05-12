import { useEffect } from 'react'
import useRealtimeSession from './useRealtimeSession'

/**
 * Cmd/Ctrl+Shift+V: starts/ends a normal Realtime conversation.
 * Cmd/Ctrl+Shift+T: starts/ends a Train Me session (restricted to memory tools).
 */
export default function usePushToTalkHotkey({ context = 'global' } = {}) {
  const { connect, disconnect, isConnected } = useRealtimeSession()

  useEffect(() => {
    const onKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const modifier = isMac ? e.metaKey : e.ctrlKey
      if (modifier && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault()
        if (isConnected) disconnect(); else connect(context)
      } else if (modifier && e.shiftKey && e.code === 'KeyT') {
        e.preventDefault()
        if (isConnected) disconnect(); else connect('train_me')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [connect, disconnect, isConnected, context])
}
