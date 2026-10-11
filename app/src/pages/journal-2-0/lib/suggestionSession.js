// Is a TipTap suggestion session still the one a callback was handed? (polish round, H14)
//
// @tiptap/suggestion calls a menu's `onStart` only AFTER it has awaited the menu's `items` -- one
// microtask for a synchronous list (slash, emoji, @ dates), a debounce plus a fetch for the note-link
// search. An update that only ENDS a session awaits nothing, so its `onExit` can run BEFORE the
// earlier session's `onStart`. Without a check, that late `onStart` draws a popup for a session that is
// gone -- nothing removes it -- and a row clicked in it runs the command with the dead session's
// range, deleting whatever text now sits there. Measured: `[[Weekly` deleted inside the note-link
// search delay left its popup on the page (polish review P1).
//
// ONE predicate, asked by all four menus (NoteLinkMenu, DateSuggest, SlashMenu, EmojiMenu), at the
// two places a stale session can do harm: before a popup is drawn (`onStart`) and before a command
// edits the document (`guardedCommand`). A session is "still open" when the editor is alive and the
// menu's own plugin state is active at the SAME start position as the range the callback was handed.
// Only `from` is compared: `to` moves as the member keeps typing, and a live session's command is
// handed the newest range.

/** Whether the session `range` belongs to is still open in `editor`, under `pluginKey`. */
export function sessionStillOpen(pluginKey, editor, range) {
  if (!editor || editor.isDestroyed || !range) return false
  const s = pluginKey.getState(editor.state)
  return Boolean(s?.active && s.range && s.range.from === range.from)
}

/** `fn` as a Suggestion `command` that does nothing for a session that has ended (see the header). */
export function guardedCommand(pluginKey, fn) {
  return (args) => (sessionStillOpen(pluginKey, args?.editor, args?.range) ? fn(args) : undefined)
}
