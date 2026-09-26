/**
 * Wave 5 fix round 1 — the Notebook's ONE answer to "is this a Mac?", and the
 * chord labels that depend on it.
 *
 * ⛔ One helper, because the answer decides what a key DOES, not only what a
 * tooltip says: on a Mac, Ctrl+H in a note is ProseMirror's delete-backward
 * (prosemirror-commands `macBaseKeymap`), so a tooltip advertising Ctrl+H there
 * tells the member to delete a character. The code block's picker title, the
 * find bar's replace tooltip, the page's replace chord and the shortcut sheet
 * all ask here; two copies of the test had already started to be written.
 *
 * ProseMirror's own `Mod` resolves by the same platform test
 * (prosemirror-keymap: /Mac|iP(hone|[oa]d)/ on navigator.platform), so a label
 * built here names the key the keymap will actually bind.
 */
export function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '')
}

/** The `Mod` key as a member reads it: "Cmd" on a Mac, "Ctrl" elsewhere. */
export function modKeyLabel() {
  return isMacPlatform() ? 'Cmd' : 'Ctrl'
}

/** The `Alt` key as a member reads it: "Option" on a Mac, "Alt" elsewhere. */
export function altKeyLabel() {
  return isMacPlatform() ? 'Option' : 'Alt'
}

/**
 * Find-and-replace opens on Ctrl+H — except on a Mac, where Cmd+H hides the
 * app and Ctrl+H deletes a character, so it is Cmd+Option+F. Returned as key
 * names (for the shortcut sheet) and joined by `chordText`.
 */
export function replaceChordKeys() {
  return isMacPlatform() ? ['Cmd', 'Option', 'F'] : ['Ctrl', 'H']
}

export const chordText = (keys) => keys.join('+')

/**
 * Wave 8 (lane 8A): Home and End as a member presses them. A Mac keyboard has
 * neither key; Fn+Left and Fn+Right send the same `Home` / `End` key events a
 * browser hands the page, so that is what the shortcut sheet shows there.
 */
export function homeEndKeys() {
  return isMacPlatform()
    ? { home: ['Fn', '←'], end: ['Fn', '→'] }
    : { home: ['Home'], end: ['End'] }
}

/** True for the platform's replace chord on a keydown event. */
export function isReplaceChord(e) {
  const key = String(e.key || '').toLowerCase()
  return isMacPlatform()
    ? Boolean(e.metaKey && e.altKey && e.code === 'KeyF')
    : Boolean(e.ctrlKey && !e.metaKey && !e.altKey && (key === 'h' || e.code === 'KeyH'))
}
