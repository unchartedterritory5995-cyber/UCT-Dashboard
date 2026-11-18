// app/src/components/chart/engine/hostLaneWorker.js
//
// ⭐⭐ HOST WORKER — the host lane's Web Worker entry (`hostLaneAsync.js` spawns it). The whole job is
// `hostLaneWorkerCore.answerHostLaneJob`; this file only wires it to the worker's own messages, so the
// handler stays importable (and testable) without a worker.
import { answerHostLaneJob } from './hostLaneWorkerCore.js'

self.onmessage = (event) => {
  const { reply, transfer } = answerHostLaneJob(event.data)
  self.postMessage(reply, transfer)
}
