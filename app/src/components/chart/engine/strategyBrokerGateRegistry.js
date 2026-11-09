// W9-T1 - where the strategy broker's build flag is HANDED IN. This module imports nothing, so the server
// compute closure can hold it without reading any VITE_* name (serverBundle.rail, hostNeutralClosure.rail).
// The member door (memberPaneDefinition.js) registers `strategyBrokerGate.js::strategyBrokerEnabled`; the
// server never registers one, so there the broker is dark. Default: off.
let reader = () => false
export function registerStrategyBrokerGate(fn) { reader = typeof fn === 'function' ? fn : () => false }
export const strategyBrokerGateOn = () => reader() === true
