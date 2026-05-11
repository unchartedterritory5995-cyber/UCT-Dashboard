import { useEffect } from 'react'
import useRealtimeSession from './useRealtimeSession'

/**
 * Cmd/Ctrl+Shift+V global hotkey: starts (or ends) a Realtime conversation.
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
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [connect, disconnect, isConnected, context])
}
