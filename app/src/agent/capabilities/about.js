// ── agent.capabilities: "can you…?" answered from the registry, never from the model ──
//
// A READ-ONLY query. The model may route a capability QUESTION here (and the fast path does for
// obvious ones), and the answer text comes from agent/discovery.js — the live capability
// registry plus the product's own registries plus the roadmap — so the member gets the same
// truthful answer every time, and a planned feature is never described as working.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { TOPIC_IDS, answerFor, fastDiscovery } from '../discovery'

// ── agent.undo (hotfix 2026-11-03, live: "Undo the last change you made to my charts" reached the model, which had NO
// undo action and told the member Undo is impossible from the Agent). The SAME Undo the receipt's Undo button runs
// (useAgent doUndo / undoTurn: protected-layout rule, another-board and changed-since checks, the `about` kind check,
// the receipt) — this entry only lets the planner ASK for it. Never executed by the server or by the planner here:
// useAgent intercepts the op (runPlannedUndo), and only doUndo's own receipt says anything was undone.
export const UNDO_ACTION = 'agent.undo'
// what an undo request may say it is about (useAgent UNDO_ABOUT ∪ UNDO_SAYS — checked against the newest change)
export const UNDO_ABOUT_WORDS = ['indicator', 'chart', 'widget', 'drawing', 'layout', 'colour', 'style', 'timeframe', 'symbol', 'pane', 'theme', 'resize', 'size', 'move', 'rename', 'link']

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
    surfaces: ['*'],
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
  registerCapability({
    name: UNDO_ACTION,
    surfaces: ['*'],
    target: 'about',
    query: true,
    undo: 'none',
    summary: 'Undo YOUR OWN most recent change(s) in this conversation — exactly what the Undo on that change’s receipt does. UCT refuses it itself when that change can’t be undone (changed since, another board, a protected layout, a permanent action).',
    hints: 'target = the ref of the agent entry. scope: "last" = the newest change (undo that / undo the last change / revert it); "all" = every change of the previous request (undo all of that). '
      + 'about = what the member says the change was ("undo the timeframe change" → timeframe), else null. '
      + 'In a request that makes a change AND undoes it ("switch to weekly, then undo that"), put the change first and agent.undo LAST. '
      + 'Never tell the member you cannot undo, or to use another Undo: plan this, and UCT reports what it actually undid.',
    args: { type: 'object', properties: {
      scope: { type: 'string', enum: ['last', 'all'] },
      about: { type: ['string', 'null'], enum: [...UNDO_ABOUT_WORDS, null] },
    }, required: ['scope', 'about'], additionalProperties: false },
    coerce: { scope: { latest: 'last', newest: 'last', previous: 'last', one: 'last', everything: 'all', turn: 'all' }, about: { color: 'colour', 'time frame': 'timeframe', ticker: 'symbol', interval: 'timeframe' } },
    defaults: { scope: 'last' },
    // ⛔ never answered here: useAgent runs doUndo for this op (a query answer would claim an undo nothing did)
    answer: () => 'Nothing was undone.',
  })
}
