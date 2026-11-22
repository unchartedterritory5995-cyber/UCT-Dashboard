// What recovery (lib/recovery.js) acts on, registered by the parts that own it. Kept apart from the
// coordinator so the stream managers and AuthContext can import it without putting the coordinator
// on the page's first-open bytes (AuthContext loads the coordinator lazily after boot).
let _authCheck = null
const _streams = new Set()

/** AuthContext's identity re-check: recovery's first step. */
export function setRecoveryAuthCheck(fn) { _authCheck = fn }
export function recoveryAuthCheck() { return _authCheck }

/** A live stream manager: `{ name, reconnectNow(), isConnected() }`. Returns an unregister. */
export function registerRecoveryStream(stream) { _streams.add(stream); return () => _streams.delete(stream) }
export function recoveryStreams() { return [..._streams] }

export function __resetRecoveryRegistryForTests() { _authCheck = null; _streams.clear() }
