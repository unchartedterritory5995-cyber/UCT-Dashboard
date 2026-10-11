// TERM-056 (lane N): a terminal command pasted into a note becomes a link to the terminal.
// Kept out of NoteEditorPage so it can be tested against a real editor without the page.

/**
 * TERM-056: paste a terminal command as a link that opens the terminal at it. `interchange` is
 * the lazily loaded `pages/terminal/commandInterchange` module (null until it arrives, and then
 * the paste is plain text as before). True when it handled the paste.
 *
 * Only plain text that IS a command, never inside code, and the link ends with the pasted
 * command: typing on after it writes plain text, not more link.
 */
export function pasteTerminalCommand(view, event, interchange) {
  if (!interchange || !view || !event) return false
  const command = interchange.asTerminalCommand(event.clipboardData?.getData?.('text/plain'))
  if (!command) return false
  const { state } = view
  const link = state.schema.marks.link
  if (!link || state.selection.$from.parent.type.spec.code) return false
  event.preventDefault?.()
  const text = state.schema.text(command, [link.create({ href: interchange.terminalCommandHref(command) })])
  view.dispatch(state.tr.replaceSelectionWith(text, false).setStoredMarks([]).scrollIntoView())
  return true
}
