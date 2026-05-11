// app/src/components/chart/chartScreenshot.js


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
  // takeScreenshot returns an HTMLCanvasElement in v5, ImageData-like in older
  const chartCanvas = chart.takeScreenshot();
  const cw = chartCanvas.width || chartCanvas.canvas?.width || 1200;
  const ch = chartCanvas.height || chartCanvas.canvas?.height || 600;

  const HEADER_H = 40;
  const FOOTER_H = 20;
  const totalW = cw;
  const totalH = HEADER_H + ch + FOOTER_H;

  const out = document.createElement('canvas');
  out.width = totalW;
  out.height = totalH;
  const ctx = out.getContext('2d');

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, totalW, totalH);

  // Header
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, 0, totalW, HEADER_H);
  ctx.fillStyle = '#c9a84c';  // UCT gold
  ctx.font = 'bold 18px "IBM Plex Mono", monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(opts.sym || '', 16, HEADER_H / 2);
  ctx.fillStyle = '#888';
  ctx.font = '14px sans-serif';
  ctx.fillText(opts.tf || '', 100, HEADER_H / 2);
  if (Number.isFinite(opts.price)) {
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(`$${opts.price.toFixed(2)}`, 160, HEADER_H / 2);
  }
  if (Number.isFinite(opts.changePct)) {
    ctx.fillStyle = opts.changePct >= 0 ? '#22c55e' : '#ef4444';
    ctx.fillText(`${opts.changePct >= 0 ? '+' : ''}${opts.changePct.toFixed(2)}%`, 240, HEADER_H / 2);
  }
  // UCT brand on right
  ctx.fillStyle = '#c9a84c';
  ctx.font = 'bold 12px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText('UCT INTELLIGENCE', totalW - 16, HEADER_H / 2);
  ctx.textAlign = 'left';

  // Chart canvas
  ctx.drawImage(chartCanvas, 0, HEADER_H);

  // Footer
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, HEADER_H + ch, totalW, FOOTER_H);
  ctx.fillStyle = '#666';
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', 16, HEADER_H + ch + FOOTER_H / 2);
  ctx.textAlign = 'right';
  ctx.fillText('uctintelligence.com', totalW - 16, HEADER_H + ch + FOOTER_H / 2);
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
