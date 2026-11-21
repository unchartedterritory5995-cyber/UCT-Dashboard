// app/src/components/chart/builder/memberPane/useMemberDoor.js
//
// ⭐⭐ THE PASTE WORKER (2026-11-20) — a component's read of the member door: the page's shared, off-thread
// build of one script (`memberDoorAsync.js::memberDoorService`), as React state.
//
// `args` is `{source, id?, name?}` or null (nothing to build). `refresh` is any value whose change asks again
// (a list or a library landed): a build made in the same page state is read again, not rebuilt; a state that
// moved builds anew. Returns the LAST answer this component was handed (`landed`, for `key` and the `args` it was
// asked with, with a `seq` that grows per answer) and `pending`: no answer for the current args has landed yet, or
// a newer build of them runs. ⛔ A consumer reading `landed` while `pending` reads a build of what it asked for
// BEFORE (`key` says which script; while it is another script's, it is no answer for this one).
import { useEffect, useRef, useState } from 'react'
import { memberDoorService, memberDoorKeyOf } from './memberDoorAsync'

export function useMemberDoor(args, refresh) {
  const key = args ? memberDoorKeyOf(args) : null
  const [state, setState] = useState({ key: null, args: null, landed: null, seq: 0 })
  const [waiting, setWaiting] = useState(null)
  const seqRef = useRef(0)
  useEffect(() => {
    if (!key) return undefined
    let delivered = false
    const release = memberDoorService().subscribe(args, (landed) => {
      delivered = true
      seqRef.current += 1
      setState({ key, args, landed, seq: seqRef.current })
      setWaiting((w) => (w === key ? null : w))
    })
    if (!delivered) setWaiting(key)
    return release
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `args` is read through its key; `refresh` asks again
  }, [key, refresh])
  return { key: state.key, args: state.args, landed: state.landed, seq: state.seq,
    pending: !!key && (waiting === key || state.key !== key) }
}
