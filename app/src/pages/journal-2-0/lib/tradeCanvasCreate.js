/**
 * Wave 11 lane 11D — the doors that MAKE a trade-plan canvas, and the gate on them.
 * Kept apart from the board's model (`tradeCanvas.js`) so the editor schema never
 * imports the network or the offline layer.
 */
import { notebookFlag } from './offline/notebookFlags'
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import {
  CANVAS_FLAG, CANVAS_TAG, buildCanvasDoc, cleanSymbol, defaultCanvasTitle, starterBoard,
} from './tradeCanvas'

/** The gate, latched per tab like every Notebook capability flag. */
export function tradeCanvasEnabled() {
  return notebookFlag(CANVAS_FLAG) === true
}

/**
 * ⛔ THE CREATE DOOR. Through `createNoteViaApi` (the one network path every
 * creation uses), and the answer is landed with `settleNoteWrite` — the
 * revision is recorded before the editor that opens the note can meet it.
 */
export async function createTradeCanvasNote({ title, ticker, folderId, board } = {}) {
  const sym = cleanSymbol(ticker)
  const created = await createNoteViaApi({
    title: (title || '').trim() || defaultCanvasTitle(sym),
    bodyJson: buildCanvasDoc(board || starterBoard({ ticker: sym })),
    tags: [CANVAS_TAG],
    ...(sym ? { ticker: sym } : {}),
    ...(folderId ? { folderId } : {}),
  })
  await settleNoteWrite(created?.id ?? null, created)
  return created
}
