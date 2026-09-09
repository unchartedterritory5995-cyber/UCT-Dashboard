/**
 * Wave H — the shared note-creation API calls, extracted out of
 * `NotebookTab.jsx`'s own `createNote`/`createFromTemplate` closures so the
 * Ticker Research Workspace's "New Note"/"New Thesis" actions (checkpoint
 * decision 29/30) call the SAME network path rather than a second creation
 * flow. Deliberately pure — no tree/UI bookkeeping, no local React state.
 * `NotebookTab.jsx` layers its own sidebar-tree/refresh side effects on top
 * of these; a caller with no such tree (the workspace) just navigates to the
 * created note afterward.
 */
import { assembleTemplateContext } from './templateContext'
import { getTemplate } from './notebookTemplates'

/** Create a note. Mirrors NotebookTab's own `createNote` request shape
 * exactly (title/bodyJson/tags/ticker/folderId), plus the same best-effort
 * follow-up properties PATCH a template may need (e.g. Research Type). */
export async function createNoteViaApi({ title = '', bodyJson, tags, ticker, folderId, properties } = {}) {
  const res = await fetch('/api/j2/notes', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      ...(bodyJson ? { bodyJson } : {}),
      ...(tags && tags.length ? { tags } : {}),
      ...(ticker ? { ticker } : {}),
      ...(folderId ? { folderId } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Could not create note (${res.status})`)
  let created = (await res.json()).note
  if (properties && Object.keys(properties).length) {
    try {
      const putRes = await fetch(`/api/j2/notes/${created.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties }),
      })
      if (putRes.ok) created = (await putRes.json()).note
    } catch { /* best-effort -- note creation itself already succeeded */ }
  }
  return created
}

/** Create a note from a template key (e.g. 'thesis'), pre-filling `ticker`
 * through the SAME `assembleTemplateContext`/`build`/`defaultTitle` path
 * every other template-creation entry point already uses. Throws if the
 * template key is unknown. */
export async function createNoteFromTemplateViaApi(templateKey, { ticker } = {}) {
  const tpl = getTemplate(templateKey)
  if (!tpl) throw new Error(`Unknown template: ${templateKey}`)
  let ctx
  try {
    ctx = await assembleTemplateContext({ ticker, needs: tpl.needs })
  } catch {
    ctx = { ticker: ticker || null }
  }
  return createNoteViaApi({
    title: tpl.defaultTitle(ctx),
    bodyJson: tpl.build(ctx),
    tags: tpl.tags,
    ticker: ctx.ticker,
    properties: tpl.properties,
  })
}
