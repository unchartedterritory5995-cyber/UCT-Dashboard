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

      const clone = tileEl.cloneNode(true)

      // Start with max-content so the clone is not artificially capped.
      // We'll measure the true rendered width AFTER DOM insertion.
      clone.style.overflow = 'visible'
      clone.style.height   = 'auto'
      clone.style.width    = 'max-content'

      // TileCard structure: .tile > .header (children[0]) + .body (children[1])
      // .body has flex:1 + min-height:0 — collapses when parent has height:auto.
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

      // Insert into DOM so getComputedStyle works for the sticky-fix pass.
      // Wrapper uses max-content too so it doesn't clip the clone.
      const wrapper = document.createElement('div')
      wrapper.style.cssText =
        'position:fixed;top:-99999px;left:0;width:max-content;overflow:visible;'
      wrapper.appendChild(clone)
      document.body.appendChild(wrapper)

      // Fix sticky positioning AFTER insertion so getComputedStyle works.
      // Must set top:'0'/left:'0' — clearing to '' leaves CSS class values
      // active (e.g. .colLabel has top:32px which creates a gap and hides
      // the first data row beneath the displaced column-label row).
      clone.querySelectorAll('*').forEach(el => {
        if (window.getComputedStyle(el).position === 'sticky') {
          el.style.position = 'relative'
          el.style.top      = '0'
          el.style.left     = '0'
          el.style.zIndex   = ''
        }
      })

      // Measure AFTER all modifications so we get the true rendered dimensions
      // (not the original constrained dimensions from the live DOM element).
      const captureWidth  = clone.offsetWidth
      const captureHeight = clone.offsetHeight

      // Give the wrapper a concrete width so html2canvas knows the canvas size.
      wrapper.style.width = `${captureWidth}px`

      const bgColor = getComputedStyle(tileEl).backgroundColor
      const canvas = await html2canvas(clone, {
        backgroundColor: bgColor || '#0d0d0f',
        scale: 2,
        useCORS: true,
        logging: false,
        // Let html2canvas auto-detect dimensions from the element —
        // do NOT pass width/height/windowWidth/windowHeight as they
        // can cause html2canvas to crop at the original viewport size.
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
