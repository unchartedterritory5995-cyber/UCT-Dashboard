// Audit 2026-11-05, spec S9: a note made from a template opens with the caret in its FIRST FIELD -- the first empty
// paragraph (or checklist line) after the template's headings -- not in the title, which the Use already named
// ("{Template} · {Ddd, Mon D}"), and not at the end of the body, past everything the member came to fill in.
//
// `firstFieldPos(doc)` answers the document position INSIDE that textblock (a caret, `pos + 1`), or null when the
// body has no empty line to fill (the caller then puts the caret at the end, as a blank note's open does). Pure:
// it reads a ProseMirror doc and nothing else.

/** Is this a textblock a member types into, with nothing in it yet? */
const emptyLine = (node) => node.isTextblock && node.type.name !== 'heading' && node.content.size === 0

export function firstFieldPos(doc) {
  if (!doc) return null
  let seenHeading = false
  let afterHeading = null
  let anyEmpty = null
  doc.descendants((node, pos) => {
    if (afterHeading !== null) return false
    if (node.type.name === 'heading') { seenHeading = true; return false }
    if (emptyLine(node)) {
      if (anyEmpty === null) anyEmpty = pos + 1
      if (seenHeading) afterHeading = pos + 1
      return false
    }
    // Never into an atom (a widget, a chart): its insides are not the member's to type in.
    return !node.isAtom
  })
  return afterHeading ?? anyEmpty
}
