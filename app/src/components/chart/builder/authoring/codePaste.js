// ⭐ C (2026-11-25) — the browser's mirror of the code-paste import door (`api/services/code_paste.py`). The SERVER
// decides; this only lets the composer count a pasted indicator against the cap it will really meet. Both detectors
// read the same cases (`tests/fixtures/authoring/code_paste_cases.json`), so they cannot drift apart; the cap is the
// engine's own script limit, held equal to the server's by `tests/test_code_paste_door_client.py`.

export const IMPORT_MAX_CHARS = 24000
export const PINE = 'pine'
export const DEEPVUE = 'deepvue'

const PINE_MARK = /^\s*\/\/\s*@version\s*=\s*\d|^\s*(?:indicator|study|strategy)\s*\(/m
const DEEPVUE_MARK = /globalThis\.indicator\s*=|\bcompute\s*\(\s*bar\s*\)|\bbar\.ta\./
const CODE_LINE = /[{}[\]();,]\s*$|[^=!<>]=[^=]|=>|:=/
const MIN_CODE_LINES = 5

function codeShaped(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < MIN_CODE_LINES) return false
  return lines.filter((l) => CODE_LINE.test(l)).length * 2 >= lines.length
}

/** 'deepvue' | 'pine' when the message IS pasted code of that platform, else null (chat). */
export function codeKindOf(message) {
  if (typeof message !== 'string' || !codeShaped(message)) return null
  if (DEEPVUE_MARK.test(message)) return DEEPVUE
  if (PINE_MARK.test(message)) return PINE
  return null
}
