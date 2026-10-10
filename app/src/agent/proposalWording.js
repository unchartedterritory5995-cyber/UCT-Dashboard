// ── PROPOSAL WORDING: a proposal never reads as if it had already happened ──────────────────────
//
// A capability's describe() is ONE sentence used twice: as the line on a PROPOSAL card (before the
// member approves anything) and as the RECEIPT line (after the authoritative write). Receipts say what
// happened, so describe() is written in the past tense ("Deleted the layout “Momentum” (permanent)").
// On a proposal card that wording claims a success that has not happened (S6 finding F2).
//
// This module is PRESENTATION ONLY: it rewrites the leading past-tense verb of each proposal line to
// its pending form ("Delete the layout “Momentum” (permanent)"). Execution, receipts, Undo and every
// capability are untouched. agentProposalWording.test.js fails if a capability's describe() starts
// with a past-tense verb this table does not know, so a new capability cannot reintroduce it.

export const PAST_TO_PENDING = Object.freeze({
  Added: 'Add', Removed: 'Remove', Deleted: 'Delete', Saved: 'Save', Created: 'Create', Renamed: 'Rename',
  Changed: 'Change', Switched: 'Switch', Moved: 'Move', Cleared: 'Clear', Hid: 'Hide', Showed: 'Show',
  Opened: 'Open', Closed: 'Close', Set: 'Set', Turned: 'Turn', Applied: 'Apply', Reset: 'Reset',
  Linked: 'Link', Unlinked: 'Unlink', Resized: 'Resize', Arranged: 'Arrange', Drew: 'Draw', Restyled: 'Restyle',
  Selected: 'Select', Updated: 'Update', Restored: 'Restore', Put: 'Put', Made: 'Make', Enabled: 'Enable',
  Disabled: 'Disable', Replaced: 'Replace', Duplicated: 'Duplicate', Copied: 'Copy', Pinned: 'Pin', Undid: 'Undo',
})
// phrases that state a RESULT as already true
const PHRASES = [
  [/\(now open\)/g, '(it becomes the open layout)'],
]
const VERB = new RegExp(`^(${Object.keys(PAST_TO_PENDING).join('|')})\\b`)

/** One proposal line in pending form. A "Label: …" prefix (a chart, "All 4 new") is kept. */
export function pendingLine(line) {
  if (typeof line !== 'string' || !line) return line
  const m = /^([^:—]{1,80}?: )(.*)$/s.exec(line)
  const [prefix, body] = m && VERB.test(m[2]) ? [m[1], m[2]] : ['', line]
  let out = body.replace(VERB, (v) => PAST_TO_PENDING[v])
  for (const [re, to] of PHRASES) out = out.replace(re, to)
  return prefix + out
}

/** Every proposal card's lines go through here. */
export const pendingLines = (lines) => (Array.isArray(lines) ? lines.map(pendingLine) : lines)
