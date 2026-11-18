// app/src/components/CommandPaletteGate.jsx
//
// The command palette's stand-in on the app shell. The palette itself is 15 KB of the entry chunk
// and is drawn only after a press, so it loads once the page is idle instead of before first paint.
// Until it arrives this holds Ctrl/Cmd+K and the visible search triggers, and a press made in that
// window opens the palette the moment it lands. Once it is mounted the palette registers its own
// shortcuts, so there is never more than one holder.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { registerShortcuts } from '../pages/command/shortcutRegistry'

const IDLE_FALLBACK_MS = 1500

const CommandPaletteGate = forwardRef(function CommandPaletteGate(_props, ref) {
  const [Palette, setPalette] = useState(null)
  const paletteRef = useRef(null)
  const pendingOpen = useRef(false)
  const loading = useRef(false)

  const load = useCallback(() => {
    if (loading.current) return
    loading.current = true
    import('./CommandPalette').then(
      (mod) => setPalette(() => mod.default),
      // A failed fetch must not take the shell down. The next press asks again.
      () => { loading.current = false },
    )
  }, [])

  const requestOpen = useCallback(() => {
    pendingOpen.current = true
    load()
  }, [load])

  useImperativeHandle(ref, () => ({
    open: () => {
      if (paletteRef.current) paletteRef.current.open()
      else requestOpen()
    },
  }), [requestOpen])

  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(load, { timeout: IDLE_FALLBACK_MS })
      return () => window.cancelIdleCallback?.(id)
    }
    const id = setTimeout(load, IDLE_FALLBACK_MS)
    return () => clearTimeout(id)
  }, [load])

  useEffect(() => {
    if (Palette) return undefined
    return registerShortcuts({
      'palette.toggle': (e) => {
        e.preventDefault()
        e.stopPropagation()
        requestOpen()
      },
    })
  }, [Palette, requestOpen])

  useEffect(() => {
    if (Palette && pendingOpen.current) {
      pendingOpen.current = false
      paletteRef.current?.open()
    }
  }, [Palette])

  return Palette ? <Palette ref={paletteRef} /> : null
})

export default CommandPaletteGate
