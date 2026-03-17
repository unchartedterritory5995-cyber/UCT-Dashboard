// app/src/hooks/useTileCapture.js
import { useRef, useState, useCallback } from 'react'

/**
 * Shared tile screenshot hook.
 * Attach tileRef to a TileCard, then call capture() to download a PNG.
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
      const width = tileEl.offsetWidth

      const clone = tileEl.cloneNode(true)
      clone.style.overflow = 'visible'
      clone.style.height = 'auto'

      // TileCard structure: .tile > .header (children[0]) + .body (children[1])
      // .body has flex:1 + min-height:0 — collapses when parent has height:auto.
      // Fix: remove flex/height constraints so it sizes from content.
      const bodyEl = clone.children[1]
      if (bodyEl) {
        bodyEl.style.overflow = 'visible'
        bodyEl.style.height = 'auto'
        bodyEl.style.flex = 'none'
        bodyEl.style.minHeight = '0'
      }

      // Remove overflow caps and max-height limits from all nested elements
      // so scroll containers expand to show full content in the screenshot.
      clone.querySelectorAll('*').forEach(el => {
        el.style.overflow = 'visible'
        el.style.maxHeight = 'none'
      })

      const wrapper = document.createElement('div')
      wrapper.style.cssText = `position:fixed;top:-99999px;left:0;width:${width}px;overflow:visible;`
      wrapper.appendChild(clone)
      document.body.appendChild(wrapper)

      const bgColor = getComputedStyle(tileEl).backgroundColor
      const canvas = await html2canvas(clone, {
        backgroundColor: bgColor || '#0d0d0f',
        scale: 2,
        useCORS: true,
        logging: false,
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
