import { useState, useEffect } from 'react'

export default function useKeyboardVisible() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Use visualViewport API (best support on iOS/Android)
    const vv = window.visualViewport
    if (!vv) return

    const threshold = 150 // keyboard is at least 150px
    const fullHeight = window.innerHeight

    const handleResize = () => {
      const keyboardOpen = (fullHeight - vv.height) > threshold
      setVisible(keyboardOpen)
    }

    vv.addEventListener('resize', handleResize)
    return () => vv.removeEventListener('resize', handleResize)
  }, [])

  return visible
}
