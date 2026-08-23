// app/src/components/quote/quoteNote.js — the journal note a quote becomes.
// Pure helpers, kept apart from SaveQuoteButton.jsx so that module exports only
// a component (react-refresh rule).

// The note body the journal stores — a TipTap/ProseMirror doc (`type: "doc"` is
// required by the server's validator): the quote as a blockquote, then an italic
// attribution line "— Author · Source".
export function quoteNoteBody(quote) {
  const attribution = `— ${quote.a}${quote.src ? ` · ${quote.src}` : ''}`
  return {
    type: 'doc',
    content: [
      { type: 'blockquote', content: [
        { type: 'paragraph', content: [{ type: 'text', text: `“${quote.t}”` }] },
      ] },
      { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: attribution }] },
    ],
  }
}

export function quoteNoteTitle(quote) {
  return `${quote.a} — Quote of the Day`
}

export const QUOTE_NOTE_TAGS = ['quote']
