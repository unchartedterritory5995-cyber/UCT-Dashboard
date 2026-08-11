/**
 * Notion adapter — DETECTION ONLY for now. Real `parse()` lands in Task 10.
 *
 * Detection scores (per plan):
 *  - 0.9 when >= 30% of filenames match ` <32-hex>.(md|html|csv)` — Notion
 *    appends a 32-char hex page id to every exported filename.
 *  - 0.7 when an `index.html` sits beside a hex-suffixed directory (a
 *    single-page HTML export with an asset/sub-page folder named the same way).
 */

export const notionAdapter = {
  id: 'notion',
  label: 'Notion',
  detect,
  async parse() {
    throw new Error('not implemented')
  },
}

const HEX32 = '[0-9a-f]{32}'
const NOTION_FILE_RE = new RegExp(` ${HEX32}\\.(md|html|csv)$`, 'i')
const NOTION_DIR_RE = new RegExp(` ${HEX32}$`, 'i')

function basename(path) {
  return path.split('/').pop()
}

function detect(vfiles) {
  if (!vfiles.length) return 0

  const basenames = vfiles.map((v) => basename(v.path))
  const matchCount = basenames.filter((n) => NOTION_FILE_RE.test(n)).length
  if (matchCount / vfiles.length >= 0.3) return 0.9

  const hasIndexHtml = basenames.some((n) => n.toLowerCase() === 'index.html')
  if (hasIndexHtml) {
    const dirNames = new Set()
    vfiles.forEach((v) => {
      const parts = v.path.split('/')
      parts.slice(0, -1).forEach((p) => dirNames.add(p))
    })
    if ([...dirNames].some((d) => NOTION_DIR_RE.test(d))) return 0.7
  }

  return 0
}
