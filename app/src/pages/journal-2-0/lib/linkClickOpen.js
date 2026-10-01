/**
 * Ruling 165 — Ctrl/Cmd+click (and a touch re-tap) to open a link in the
 * note editor; a controller ruling on this file's own FYI 2 extends that to
 * a plain click/tap on a READ-ONLY rendering.
 *
 * `tiptap.js`'s `Link.configure` sets `openOnClick: false` (and disables
 * StarterKit's own unconfigured copy of Link for the same reason — see that
 * file's header comment): a plain click inside a contentEditable region must
 * place the caret, never navigate the member away from unsaved words. But
 * with BOTH `openOnClick` and the extension's own `enableClickSelection` off,
 * nothing opens a link at all — not even Ctrl/Cmd+click, which an ordinary
 * web page honors natively. This extension adds exactly the doors ruling 165
 * asks for, and nothing else:
 *
 * EDITABLE editor (`view.editable`, e.g. NoteEditorPage.jsx):
 *   - a PLAIN click is UNTOUCHED — this extension returns `false` for one, so
 *     whatever already places the caret today keeps doing exactly that;
 *   - Ctrl+click (Cmd on a Mac) opens the link in a new tab
 *     (`noopener,noreferrer`);
 *   - a TOUCH tap on a link the caret is ALREADY inside — i.e. a SECOND tap,
 *     not the one that just placed it there — opens it too. A touch device
 *     has no Ctrl key, so it needs its own door;
 *   - hovering a link shows a native tooltip naming the gesture ("Ctrl+click
 *     to open" / "Cmd+click to open" on a Mac — platform.js's `modKeyLabel`,
 *     the Notebook's one existing answer to "is this a Mac").
 *
 * READ-ONLY editor (`!view.editable`: the public share/publish pages, or any
 * other surface that mounts this SAME `buildExtensions()` roster with
 * `editable: false`, e.g. a locked note) — controller ruling on this file's
 * own FYI 2, 2026-09-30:
 *   - there is no caret to protect, so a PLAIN click or tap on a link opens
 *     it directly (new tab, `noopener,noreferrer`), under the same
 *     `openableLinkHref` safety rule (http(s) and mailto only);
 *   - a touch reader can never satisfy "the caret is already inside the
 *     link" — there is no caret to be inside — so the editable branch's
 *     touch-reopen distinction does not apply here: ANY click opens;
 *   - the hover hint is NOT shown — `mouseover` is a no-op on a read-only
 *     view, since there is no second gesture left to name (the plain click
 *     already opens).
 *
 * ⛔ Only an http(s) or `mailto:` href ever opens, in EITHER branch.
 * `openableLinkHref` reuses `webLinkNodes.js`'s `safeLinkHref` — the SAME
 * rule already applied to a pasted link-preview card's target — for the
 * http(s) half, and adds `mailto:` itself. A `javascript:` href, the import
 * pipeline's temporary `import-link://` placeholder, or an internal
 * `/journal...` path (the Link mark's `isAllowedUri` lets all three past the
 * schema, same file) all answer null here — never opened, never hinted,
 * regardless of `view.editable`.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { safeLinkHref } from './webLinkNodes'
import { modKeyLabel } from './platform'

export const linkClickOpenKey = new PluginKey('uctLinkClickOpen')

const MAILTO_RE = /^mailto:/i

/**
 * The href this click/tap may actually open, or null.
 *   - http(s): delegates to `safeLinkHref` (webLinkNodes.js) — the Notebook's
 *     existing answer to "is this a safe web address".
 *   - mailto:: accepted when it carries an "@" and no whitespace after the
 *     scheme — loose on purpose (multiple recipients, a `?subject=` query are
 *     all legal), just enough to refuse a bare "mailto:" or garbage.
 *   - anything else (javascript:, data:, a relative/internal path, …): null.
 */
export function openableLinkHref(href) {
  if (typeof href !== 'string') return null
  const trimmed = href.trim()
  if (MAILTO_RE.test(trimmed)) {
    const rest = trimmed.slice('mailto:'.length)
    return rest && rest.includes('@') && !/\s/.test(rest) ? trimmed : null
  }
  return safeLinkHref(trimmed)
}

/** The hover hint's text — reuses platform.js's one answer to "is this a Mac". */
export function linkOpenHint() {
  return `${modKeyLabel()}+click to open`
}

/** The nearest real anchor under `target`, if any, and only when it is
 *  actually inside this editor's own DOM (never a chip rendered by a
 *  different node type that merely happens to be an `<a>`, e.g. AttachmentChip
 *  — those carry their own click handling in NoteEditorPage.jsx). */
function linkElementAt(target, root) {
  const a = target?.closest?.('a[href]')
  return a && root.contains(a) ? a : null
}

/**
 * The href of the Link MARK active at the current, COLLAPSED selection — "the
 * caret is inside it", read exactly as the ruling says it. A non-empty (range)
 * selection never counts: this is a caret test, not a "touches a link" test.
 */
function hrefAtCaret(state) {
  const { $from, empty } = state.selection
  if (!empty) return null
  const linkType = state.schema.marks.link
  if (!linkType) return null
  const mark = $from.marks().find((m) => m.type === linkType)
  return mark ? (mark.attrs.href || null) : null
}

export const LinkClickOpen = Extension.create({
  name: 'linkClickOpen',
  addProseMirrorPlugins() {
    // Per-editor-instance, not document state: which link (if any) the caret
    // was ALREADY inside when this gesture started, and what began it. Set on
    // `pointerdown` — which fires before the browser's own `mousedown` (and
    // so before ProseMirror's selection update) moves the caret to wherever
    // this tap landed — and consumed once, by the `click` that follows.
    let pending = null
    return [new Plugin({
      key: linkClickOpenKey,
      props: {
        handleDOMEvents: {
          pointerdown: (view, event) => {
            const a = linkElementAt(event.target, view.dom)
            pending = a
              ? { href: a.getAttribute('href'), pointerType: event.pointerType, caretWasAt: hrefAtCaret(view.state) }
              : null
            return false
          },
          mouseover: (view, event) => {
            // Read-only: a plain click already opens the link, so there is
            // no second gesture to hint at.
            if (!view.editable) return false
            const a = linkElementAt(event.target, view.dom)
            if (a && openableLinkHref(a.getAttribute('href'))) a.title = linkOpenHint()
            return false
          },
          click: (view, event) => {
            const a = linkElementAt(event.target, view.dom)
            const prior = pending
            pending = null
            if (!a) return false
            const href = a.getAttribute('href')
            // Read-only view (public share/publish pages, a locked note):
            // no caret to protect, and a touch reader can never satisfy
            // "the caret is already inside the link" — there is no caret.
            // ANY click opens an openable link.
            if (!view.editable) {
              const url = openableLinkHref(href)
              if (!url) return false
              event.preventDefault()
              window.open(url, '_blank', 'noopener,noreferrer')
              return true
            }
            const modClick = !!(event.ctrlKey || event.metaKey)
            // The SAME link, by href, the caret was already inside — on a
            // TOUCH-originated gesture only (a mouse re-click must keep
            // placing the caret; it always has Ctrl available instead).
            const touchReopen = !!prior && prior.pointerType === 'touch'
              && prior.href === href && prior.caretWasAt === href
            if (!modClick && !touchReopen) return false
            const url = openableLinkHref(href)
            if (!url) return false
            event.preventDefault()
            window.open(url, '_blank', 'noopener,noreferrer')
            return true
          },
        },
      },
    })]
  },
})
