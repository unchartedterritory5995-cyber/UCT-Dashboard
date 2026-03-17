// app/src/hooks/useTileCapture.js
import { useRef, useState, useCallback } from 'react'

/**
 * Shared tile screenshot hook.
 * Attach tileRef to any element (TileCard or plain div), then call capture()
 * to download a full-content PNG — including all scroll-hidden content.
 *
 * @param {string} filename  Prefix for the downloaded file, e.g. 'earnings'
 *                           → downloads earnings-2026-03-17.png
 */
export function useTileCapture(filename) {
  const tileRef = useRef(null)
  const [capturing, setCapturing] = useState(false)

  const capture = useCallback(async () => {
    if (!tileRef.current || capturing) return
    setCapturing(true)

    try {
      const { default: html2canvas } = await import('html2canvas')
      const tileEl = tileRef.current

      // Use scrollWidth/scrollHeight so horizontally or vertically scrollable
      // content (e.g. the wide Breadth Monitor table) is fully captured.
      const fullWidth  = tileEl.scrollWidth  || tileEl.offsetWidth
      const fullHeight = tileEl.scrollHeight || tileEl.offsetHeight

      const clone = tileEl.cloneNode(true)
      clone.style.overflow = 'visible'
      clone.style.width    = `${fullWidth}px`
      clone.style.height   = 'auto'

      // TileCard structure: .tile > .header (children[0]) + .body (children[1])
      // .body has flex:1 + min-height:0 — collapses when parent has height:auto.
      // Fix: remove flex/height constraints so it sizes from content.
      // (Safe no-op for non-TileCard elements where children[1] may not exist.)
      const bodyEl = clone.children[1]
      if (bodyEl) {
        bodyEl.style.overflow  = 'visible'
        bodyEl.style.height    = 'auto'
        bodyEl.style.flex      = 'none'
        bodyEl.style.minHeight = '0'
      }

      // Remove overflow/height caps from every nested element so all
      // scroll containers expand to show their full content.
      clone.querySelectorAll('*').forEach(el => {
        el.style.overflow  = 'visible'
        el.style.maxHeight = 'none'
      })

      // Wrapper must be at least fullWidth wide so html2canvas sees all columns.
      const wrapper = document.createElement('div')
      wrapper.style.cssText =
        `position:fixed;top:-99999px;left:0;width:${fullWidth}px;overflow:visible;`
      wrapper.appendChild(clone)
      document.body.appendChild(wrapper)

      // Fix sticky positioning AFTER insertion so getComputedStyle works.
      // With overflow:visible there is no scroll container, so sticky elements
      // lose their scroll reference and get displaced (headers disappear).
      // Reset them to relative so they render in normal document flow.
      clone.querySelectorAll('*').forEach(el => {
        if (window.getComputedStyle(el).position === 'sticky') {
          el.style.position = 'relative'
          el.style.top      = ''
          el.style.left     = ''
          el.style.zIndex   = ''
        }
      })

      const bgColor = getComputedStyle(tileEl).backgroundColor
      const canvas = await html2canvas(clone, {
        backgroundColor: bgColor || '#0d0d0f',
        scale: 2,
        useCORS: true,
        logging: false,
        width:  fullWidth,
        height: fullHeight,
        windowWidth:  fullWidth,
        windowHeight: fullHeight,
      })

      document.body.removeChild(wrapper)

      const date = new Date().toISOString().slice(0, 10)
      const link = document.createElement('a')
      link.download = `${filename}-${date}.png`
      link.href = canvas.toDataURL('image/png')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } finally {
      setCapturing(false)
    }
  }, [capturing, filename])

  return { tileRef, capturing, capture }
}
