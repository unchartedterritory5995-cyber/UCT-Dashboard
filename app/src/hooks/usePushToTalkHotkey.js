import { useEffect } from 'react'
import useOneShot from './useOneShot'

/**
 * Global Cmd/Ctrl+Shift+V hotkey that triggers a one-shot voice query.
 * Mounted once near the App root.
 */
export default function usePushToTalkHotkey({ context = 'global' } = {}) {
  const { start } = useOneShot()

  useEffect(() => {
    const onKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const modifier = isMac ? e.metaKey : e.ctrlKey
      if (modifier && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault()
        start(context)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [start, context])
}
