/**
 * Tier 2 part A, item 9 -- the door that MAKES a /plan note. Through createNoteViaApi (the one
 * network path every creation uses) as a styled create of the member's default Trade plan style;
 * the server adds the member's own levels, a dated price and a source link in the SAME insert
 * (api/services/journal_two/plan_prefill.py). The answer is landed with settleNoteWrite before any
 * editor can meet it.
 */
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'

const SYMBOL_RE = /^[A-Za-z][A-Za-z.\-]{0,9}$/

export function planTitle(symbol) {
  return `${String(symbol).toUpperCase()} trade plan`
}

export async function createPlanNote({ symbol, folderId } = {}) {
  const raw = String(symbol || '').trim().replace(/^\$/, '')
  if (!SYMBOL_RE.test(raw)) throw new Error('not a symbol')
  const ticker = raw.toUpperCase()
  const created = await createNoteViaApi({
    title: planTitle(ticker), kindId: 'trade_plan', ticker, planPrefill: true,
    ...(folderId ? { folderId } : {}),
  })
  await settleNoteWrite(created?.id ?? null, created)
  return created
}
