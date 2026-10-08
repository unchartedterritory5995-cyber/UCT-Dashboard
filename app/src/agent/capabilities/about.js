// ── agent.capabilities: "can you…?" answered from the registry, never from the model ──
//
// A READ-ONLY query. The model may route a capability QUESTION here (and the fast path does for
// obvious ones), and the answer text comes from agent/discovery.js — the live capability
// registry plus the product's own registries plus the roadmap — so the member gets the same
// truthful answer every time, and a planned feature is never described as working.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { TOPIC_IDS, answerFor, fastDiscovery } from '../discovery'

let registered = false
export function registerAboutCapabilities() {
  if (registered) return
  registered = true
  // A read-only target that always exists (no host binding needed): nothing is ever committed.
  const self = { ref: 'self', label: 'UCT Agent (ask what I can and cannot do)' }
  registerTargetKind({
    name: 'about', boardScoped: false, selfDescribing: true, undoable: false,
    list: () => [self], read: (host, ref) => (ref === 'self' ? self : null), stateOf: (s) => s,
    patch: () => null, commit: async () => true, landed: () => true, undoPatch: () => null, fingerprint: () => 'about',
  })
  registerContextProvider({ key: 'agent', build: (host, refFor) => [{ ref: refFor('about', 'self'), label: self.label }] })
  registerCapability({
    name: 'agent.capabilities',
    surfaces: ['charts'],
    target: 'about',
    query: true,
    fastWhole: true,
    summary: 'Answer what UCT Agent can and cannot do (now, partly, not yet, planned) about a topic — from UCT\'s own capability list, never from memory.',
    hints: 'target = the ref of the agent entry. Use ONLY for a question ABOUT abilities ("can you draw trendlines?", "what can you do with layouts?", "can you backtest?"). '
      + 'A polite request to DO something you can do ("can you switch this to weekly?") is a command: plan it, do not use this. '
      + 'topic: overview for "what can you do?"; other when no topic fits.',
    args: { type: 'object', properties: { topic: { type: 'string', enum: TOPIC_IDS } }, required: ['topic'], additionalProperties: false },
    fast: ({ raw }) => fastDiscovery(raw),
    answer: (_snap, { topic }) => answerFor(topic).text,
  })
}
