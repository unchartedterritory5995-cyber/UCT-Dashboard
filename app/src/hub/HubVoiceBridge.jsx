// Joystick hub — the Voice action's one wire into the existing realtime session.
//
// ⛔ WHY A BRIDGE COMPONENT AND NOT A HOOK CALL IN HubRoot.
//
// `useRealtimeSession()` calls `useVoice()`, which THROWS outside a `VoiceProvider`. The hub
// mounts on every route, including ones where no provider is present, and a hook cannot be
// called conditionally. `CompassAssistButton` solves the same problem the same way — read
// `VoiceContext` with `useContext` (null-safe), and only mount the component that uses the
// hook when a provider is actually there.
//
// ⭐ IT RENDERS NOTHING. It exists to hand `connect` back to `HubRoot` through a ref, so the
// Voice fan action can start a session without `HubRoot` taking a hard dependency on the voice
// stack. When there is no provider the ref stays null and the action no-ops — which is correct
// on a route with no voice, and is why the ref is cleared on unmount rather than left dangling.

import { useContext, useEffect } from 'react'
import { VoiceContext } from '../context/VoiceContext'
import useRealtimeSession from '../hooks/useRealtimeSession'

/** Inner — only ever mounted inside a provider, so the hook is safe here. */
function Bridge({ connectRef }) {
  const { connect } = useRealtimeSession()
  useEffect(() => {
    connectRef.current = connect
    return () => { connectRef.current = null }
  }, [connect, connectRef])
  return null
}

/**
 * @param {{connectRef: {current: ((context?: string) => void)|null}}} props
 */
export default function HubVoiceBridge({ connectRef }) {
  const voice = useContext(VoiceContext)
  if (!voice) return null
  return <Bridge connectRef={connectRef} />
}
