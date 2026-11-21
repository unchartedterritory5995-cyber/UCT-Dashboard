// app/src/components/chart/builder/memberPane/memberDoorWorker.js
//
// ⭐⭐ THE PASTE WORKER (2026-11-20) — the member door's Web Worker entry (`memberDoorAsync.js` spawns it). The
// whole job is `memberDoorWorkerCore.answerJobOfKind` (a chart door build or PasteBox's report); this file only wires it
// to the worker's own messages, so the handler stays importable (and testable) without a worker.
//
// ⛔ AN ANSWER THAT CANNOT BE POSTED IS SAID, NEVER DROPPED: a structured clone refuses a function, and a
// door answer that grew one would otherwise leave the page waiting for its watchdog. The page refuses the
// script by name with the reason (`memberDoorAsync.js`).
import { answerJobOfKind, setPeer, setPagePost, acceptPageMessage } from './memberDoorWorkerCore.js'

// ⭐ THE HUB (`memberDoorWorkerCore.js`): the status this worker makes reaches the page unasked
setPagePost((m) => self.postMessage(m))

self.onmessage = (event) => {
  const data = event.data
  // the page's MessageChannel to the other worker (the door's and the report's), and a door answer the page made
  if (data && data.kind === 'peer') { setPeer(event.ports && event.ports[0], data.role); return }
  if (data && typeof data.type === 'string') { acceptPageMessage(data); return }
  const reply = answerJobOfKind(data)
  try {
    self.postMessage(reply)
  } catch (err) {
    self.postMessage({
      id: reply && reply.id, ok: false,
      error: { name: (err && err.name) || 'Error', message: `the answer could not leave the worker (${String((err && err.message) || err)})` },
      consults: (reply && reply.consults) || [], ms: (reply && reply.ms) || 0,
    })
  }
}
