// app/src/components/chart/builder/memberPane/memberDoorWorker.js
//
// ⭐⭐ THE PASTE WORKER (2026-11-20) — the member door's Web Worker entry (`memberDoorAsync.js` spawns it). The
// whole job is `memberDoorWorkerCore.answerMemberDoorJob`; this file only wires it to the worker's own
// messages, so the handler stays importable (and testable) without a worker.
//
// ⛔ AN ANSWER THAT CANNOT BE POSTED IS SAID, NEVER DROPPED: a structured clone refuses a function, and a
// door answer that grew one would otherwise leave the page waiting for its watchdog. The page refuses the
// script by name with the reason (`memberDoorAsync.js`).
import { answerMemberDoorJob } from './memberDoorWorkerCore.js'

self.onmessage = (event) => {
  const reply = answerMemberDoorJob(event.data)
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
