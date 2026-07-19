// app/src/components/chart/chartScreenshot.js
import compassSrc from '../intro/assets/compass-mark.png';

// Load the compass mark once (cached promise). Resolves null on failure so a
// missing asset never blocks the screenshot.
let _compassPromise = null;
function loadCompass() {
  if (!_compassPromise) {
    _compassPromise = new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = compassSrc;
    });
  }
  return _compassPromise;
}

// Compact formatters for the redrawn legend / volume text.
function _fmtNum(v) {
  return (v != null && Number.isFinite(+v)) ? (+v).toFixed(2) : '—';
}
function _fmtVol(v) {
  if (v == null || !Number.isFinite(+v)) return '—';
  const n = Math.abs(+v);
  if (n >= 1e9) return `${(+v / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(+v / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(+v / 1e3).toFixed(1)}K`;
  return `${+v}`;
}
function _fmtNotional(v) {
  if (v == null || !Number.isFinite(+v)) return '—';
  return '$' + _fmtVol(v);
}


/**
 * URL-safe base64 encoding (no +, /, = chars).
 * Used to embed chart state in shareable URLs.
 */
function urlSafeEncode(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}


function urlSafeDecode(encoded) {
  // Re-pad to multiple of 4
  let padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return atob(padded);
}


/**
 * Encode a chart state object into a URL-safe string.
 * Returns empty string for null/undefined input.
 */
export function chartStateToUrl(state) {
  if (!state) return '';
  try {
    const json = JSON.stringify(state);
    return urlSafeEncode(json);
  } catch {
    return '';
  }
}


/**
 * Decode a URL-safe string back to a chart state object.
 * Returns null on any parse error.
 */
export function urlToChartState(encoded) {
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    const json = urlSafeDecode(encoded);
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}


/**
 * Compose a branded screenshot from a Lightweight Charts instance.
 * Returns a Blob (PNG).
 *
 * Layout:
 *   - 40px header strip at top with SYM • TF • Price • UCT logo
 *   - Chart canvas (from chart.takeScreenshot())
 *   - 20px footer strip with timestamp + uctintelligence.com
 *
 * @param {object} chart - Lightweight Charts instance
 * @param {object} opts - {sym, tf, price, change, changePct}
 * @returns {Promise<Blob>} PNG blob
 */
export async function composeScreenshot(chart, opts = {}) {
  if (!chart) throw new Error('No chart instance');
  const {
    sym, tf, price, changePct, companyName,
    container, crosshairData, volPos,
    bgColor = '#0e0f0d', swingLabels, swingStyle,
  } = opts;

  // LWC's takeScreenshot() = ONLY the chart canvases (candles, axes, MAs, volume
  // bars, watermark). It never includes the DOM toolbar, the drawing-overlay
  // canvas, or the DOM legend/vol text — so those are composited/redrawn below.
  const chartCanvas = chart.takeScreenshot();
  const cw = chartCanvas.width || chartCanvas.canvas?.width || 1200;
  const ch = chartCanvas.height || chartCanvas.canvas?.height || 600;

  // Everything is in DEVICE pixels (takeScreenshot is DPR-scaled). S maps CSS px
  // → device px, so overlays/text line up regardless of the display's DPR.
  const contRect = container?.getBoundingClientRect?.();
  const S = (contRect && contRect.width) ? cw / contRect.width : 1;
  const px = (n) => n * S;

  const HEADER_H = Math.round(px(40));
  const FOOTER_H = Math.round(px(20));
  const totalW = cw;
  const totalH = HEADER_H + ch + FOOTER_H;

  const out = document.createElement('canvas');
  out.width = totalW;
  out.height = totalH;
  const ctx = out.getContext('2d');
  const FONT = '"Instrument Sans", -apple-system, sans-serif';

  // Fill EVERYTHING with the chart's own background. The LWC canvas is
  // transparent (its bg is the container's CSS color), so painting the whole
  // output with bgColor makes the header/footer blend seamlessly with the chart
  // area instead of the old darker strips.
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, totalW, totalH);

  // ── Chart canvas (toolbar-free) ──
  ctx.drawImage(chartCanvas, 0, HEADER_H);

  // ── Composite the OVERLAY canvases (drawings / callouts / patterns) ──
  // The chart div (`container`) is a LEAF that LWC mounts its own canvases into;
  // the drawing/callout/pattern overlays are SIBLING canvases in the parent
  // wrapper. So scan the WRAPPER, skip anything inside the chart div (LWC's base
  // canvases, already in takeScreenshot), and map each overlay from its CSS
  // bounds into the device-pixel chart space (origin = the chart div).
  if (container && contRect) {
    try {
      const root = container.parentElement || container;
      for (const cvs of root.querySelectorAll('canvas')) {
        if (!cvs.width || !cvs.height) continue;
        if (container.contains(cvs)) continue;  // LWC's own canvases — already captured
        const r = cvs.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        ctx.drawImage(
          cvs,
          px(r.left - contRect.left), px(r.top - contRect.top) + HEADER_H,
          px(r.width), px(r.height),
        );
      }
    } catch { /* overlays are best-effort */ }
  }

  // ── Redraw the $Vol / Avg-vol legend on the volume pane ──
  if (crosshairData && (crosshairData.dollarVol != null || crosshairData.volAvg != null)) {
    let vx = px((volPos?.x ?? 12));
    const vy = px((volPos?.y ?? (contRect ? contRect.height * 0.78 : 500))) + HEADER_H + px(12);
    ctx.textAlign = 'left';
    ctx.font = `600 ${px(12)}px ${FONT}`;
    const chip = (label, val) => {
      ctx.fillStyle = '#8f897a'; ctx.fillText(label, vx, vy);
      vx += ctx.measureText(label).width + px(4);
      ctx.fillStyle = '#c9c3b0'; ctx.fillText(val, vx, vy);
      vx += ctx.measureText(val).width + px(14);
    };
    if (crosshairData.dollarVol != null) chip('$ Vol', _fmtNotional(crosshairData.dollarVol));
    if (crosshairData.volAvg != null && crosshairData.volMaPeriod) {
      chip(`Avg ${crosshairData.volMaPeriod}D`, _fmtVol(crosshairData.volAvg));
    }
  }

  // ── Redraw swing-high/low price labels (a top-zOrder primitive takeScreenshot
  //    misses). Mirrors swingLabelsPrimitive: box above a high / below a low. ──
  if (Array.isArray(swingLabels) && swingLabels.length) {
    const st = swingStyle || {};
    const fpx = px(st.fontPx || 11);
    const GAP = px(10), PADX = px(3), PADY = px(2);
    ctx.font = `600 ${fpx}px ${FONT}`;
    ctx.textAlign = 'center';
    for (const s of swingLabels) {
      const x = px(s.x);
      const y = px(s.y) + HEADER_H;
      const isHigh = s.type === 'high';
      const ty = isHigh ? y - GAP : y + GAP;
      const w = ctx.measureText(s.label).width;
      if (st.showBg) {
        ctx.fillStyle = st.bg || bgColor;  // plate = chart bg (hides candles, blends), like the live chart
        const boxY = isHigh ? ty - fpx : ty;
        const rx = x - w / 2 - PADX, ry = boxY - PADY, rw = w + PADX * 2, rh = fpx + PADY * 2;
        if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, px(3)); ctx.fill(); }
        else ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.textBaseline = isHigh ? 'bottom' : 'top';
      ctx.fillStyle = st.tintByType
        ? (isHigh ? (st.upColor || '#4ade80') : (st.downColor || '#f87171'))
        : (st.color || '#d4d0c4');
      ctx.fillText(s.label, x, ty);
    }
  }

  // ── Header: left = ticker (company) · tf · price · change ──
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let hx = px(14);
  const hy = HEADER_H / 2;
  const TICKER_PX = 15;
  ctx.font = `800 ${px(TICKER_PX)}px ${FONT}`;
  ctx.fillStyle = '#c9a84c';
  ctx.fillText(sym || '', hx, hy);
  hx += ctx.measureText(sym || '').width + px(8);
  if (companyName) {
    // Same size + same gold as the ticker (per request).
    ctx.font = `700 ${px(TICKER_PX)}px ${FONT}`;
    ctx.fillStyle = '#c9a84c';
    ctx.fillText(`(${companyName})`, hx, hy);
    hx += ctx.measureText(`(${companyName})`).width + px(12);
  }
  ctx.font = `700 ${px(12)}px ${FONT}`;
  ctx.fillStyle = '#a8a290';
  if (tf) { ctx.fillText(tf, hx, hy); hx += ctx.measureText(tf).width + px(10); }
  if (Number.isFinite(price)) {
    ctx.fillStyle = '#e6e6e8';
    const p = `$${price.toFixed(2)}`;
    ctx.fillText(p, hx, hy); hx += ctx.measureText(p).width + px(10);
  }
  if (Number.isFinite(changePct)) {
    ctx.fillStyle = changePct >= 0 ? '#1ae51a' : '#c41f2d';
    ctx.fillText(`${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`, hx, hy);
  }

  // ── Header: center = compass + UCT INTELLIGENCE ──
  const compass = await loadCompass();
  const brandFont = `800 ${px(16)}px ${FONT}`;
  ctx.font = brandFont;
  const brandText = 'UCT INTELLIGENCE';
  const brandW = ctx.measureText(brandText).width;
  const logoH = px(22);
  const logoW = compass ? logoH * (compass.width / compass.height) : 0;
  const gap = compass ? px(12) : 0;
  const groupW = logoW + gap + brandW;
  let gx = (totalW - groupW) / 2;
  if (compass) { ctx.drawImage(compass, gx, hy - logoH / 2, logoW, logoH); gx += logoW + gap; }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = brandFont;
  ctx.fillStyle = '#c9a84c';
  ctx.fillText(brandText, gx, hy);

  // ── Footer (bg already painted with bgColor) ──
  ctx.fillStyle = '#8f897a';
  ctx.font = `${px(11)}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', px(16), HEADER_H + ch + FOOTER_H / 2);
  ctx.textAlign = 'right';
  ctx.fillText('uctintelligence.com', totalW - px(16), HEADER_H + ch + FOOTER_H / 2);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob returned null'));
      },
      'image/png'
    );
  });
}


/**
 * Download a Blob as a file.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


/**
 * Copy a Blob (PNG) to the clipboard using the Clipboard API.
 * Returns true on success, false on failure.
 */
export async function copyBlobToClipboard(blob) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.write) return false;
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob }),
    ]);
    return true;
  } catch (err) {
    console.warn('Clipboard write failed:', err);
    return false;
  }
}
