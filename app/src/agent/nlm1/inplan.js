// ── NLM-1 · the IN-PLAN key (a THIRD key, default OFF) ───────────────────────────────────────────────────────────────
//
//   localStorage `uct.agent.nlm1.inplan = '1'`   (window.__uctAgentNlm1Inplan(true | false | null))
//
// AUDIT decision (11-04, after the sealed trace tally — no texts shared): the rules NO sealed pass ever took are dark
// behind this key, on top of NLM-1's own two keys. Off (the default), NLM-1 = D1 routing + the cross-turn mechanisms and
// the in-plan rules sealed passes DID use. Gated (each checks `inplanOn()` where it would fire):
//   followups.js     multi-ticker-create · same-on-new-chart · the `structure` rewrite (preNormalise) · borrow-verb ·
//                    it-is-named-chart · same-for-ticker (as a follow-up of its own; in-message-repeat, which was used,
//                    still reads its "same for <ticker>" internally)
//   followupOps.js   back-to-before · swap-places · swap-tickers · style-last-added · ordinal-of-created (and with it the
//                    whole nlm1:ordinal path, main and runCompound)
// NOT gated (AUDIT 11-04): remove-on-charts — cross-turn, and indicator.remove is always a proposal the member approves —
// with remove-not-there / remove-ambiguous (an honest refusal, a question; never a guess).
// The rules stay in the code (deletion is a later, separate step).
export const INPLAN_KEY = 'uct.agent.nlm1.inplan'

export function inplanOn() {
  try { return globalThis.localStorage?.getItem(INPLAN_KEY) === '1' } catch { return false }
}

export function setInplan(on) {
  try {
    if (on === true) localStorage.setItem(INPLAN_KEY, '1')
    else if (on === false) localStorage.setItem(INPLAN_KEY, '0')
    else localStorage.removeItem(INPLAN_KEY)
  } catch { /* storage unavailable: stays off */ }
  return inplanOn()
}
if (typeof window !== 'undefined') window.__uctAgentNlm1Inplan = setInplan
