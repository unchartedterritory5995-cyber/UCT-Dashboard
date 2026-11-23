// app/src/components/chart/builder/memberPane/useMemberDoor.js
//
// ⭐⭐ THE PASTE WORKER (2026-11-20) — a component's read of a shared, off-thread job of the member door's worker
// (`memberDoorAsync.js::createKeyedWorkerService`), as React state: the chart door's build of one script
// (`useMemberDoor`, `memberDoorService`), or PasteBox's report of one text (`inspectAsync.js`).
//
// `args` is the job's arguments or null (nothing to compute). `refresh` is any value whose change asks again (a list
// or a library landed): an answer made in the same page state is read again, not recomputed; a state that moved
// computes anew. Returns the LAST answer this component was handed (`landed`, for `key` and the `args` it was asked
// with, with a `seq` that grows per answer) and `pending`: no answer for the current args has landed yet, or a newer
// computation of them runs. ⛔ A consumer reading `landed` while `pending` reads an answer to what it asked BEFORE
// (`key` says which; while it is another's, it is no answer for these args).
import { useEffect, useRef, useState } from 'react'
import { memberDoorService } from './memberDoorAsync'

export function useWorkerJob(service, args, refresh) {
  const key = args ? service.keyOf(args) : null
  const [state, setState] = useState({ key: null, args: null, landed: null, seq: 0 })
  const [waiting, setWaiting] = useState(null)
  const seqRef = useRef(0)
  useEffect(() => {
    if (!key) return undefined
    let delivered = false
    const release = service.subscribe(args, (landed) => {
      delivered = true
      seqRef.current += 1
      setState({ key, args, landed, seq: seqRef.current })
      setWaiting((w) => (w === key ? null : w))
    })
    if (!delivered) setWaiting(key)
    return release
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `args` is read through its key; `refresh` asks again
  }, [service, key, refresh])
  return { key: state.key, args: state.args, landed: state.landed, seq: state.seq,
    pending: !!key && (waiting === key || state.key !== key) }
}

/** The chart door's shared build of `args` (`{source, id?, name?}`). */
export function useMemberDoor(args, refresh) {
  return useWorkerJob(memberDoorService(), args, refresh)
}
