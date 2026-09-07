/**
 * ⚠️ DEMO / MOCK DATA — NOT REAL FINANCIALS.
 * ============================================================================
 * This module exists ONLY so the Company panel's UX can be evaluated when the
 * local/test backend returns thin data (e.g. no FMP key → no earnings history).
 * It is NEVER used on the production data path: a panel falls back to demo data
 * only when real data is insufficient AND it renders a visible "DEMO DATA" badge
 * so a mock number can never be mistaken for a reported one.
 *
 * To remove: delete this file and the `demo` fallbacks in DockEarnings.jsx.
 * ============================================================================
 */

// A plausible ~12-quarter earnings sequence in the SAME shape useEarningsTable
// returns (oldest→newest), with steady growth and small beats/misses. The last
// two quarters are forward estimates (unreported).
export function demoEarningsQuarterly() {
  const TOTAL = 12
  const FORWARD = 2
  const now = new Date()
  // current fiscal quarter index (0-based) from today
  let y = now.getFullYear()
  let q = Math.floor(now.getMonth() / 3) + 1   // 1..4
  // advance to the last (most-forward) quarter = current + FORWARD
  for (let i = 0; i < FORWARD; i++) { q += 1; if (q > 4) { q = 1; y += 1 } }
  // build newest→oldest, then reverse
  const rows = []
  for (let i = 0; i < TOTAL; i++) {
    const stepsFromOldest = (TOTAL - 1) - i        // 0 = oldest
    const eps = 0.28 * Math.pow(1.19, stepsFromOldest)
    const rev = 9.4e9 * Math.pow(1.17, stepsFromOldest)
    const reported = i >= FORWARD                  // the two most-forward are estimates
    const surpr = reported ? +(((Math.sin(stepsFromOldest * 1.7) * 6) + 2).toFixed(1)) : null
    const epsEst = +(eps / (1 + (surpr || 0) / 100)).toFixed(2)
    const revEst = Math.round(rev / (1 + ((surpr || 0) * 0.4) / 100))
    rows.push({
      label: `${y} Q${q}`,
      reported,
      eps_actual: reported ? +eps.toFixed(2) : null,
      eps_estimate: epsEst,
      eps_surprise_pct: surpr,
      rev_actual: reported ? Math.round(rev) : null,
      rev_estimate: revEst,
      rev_surprise_pct: reported ? +(((rev - revEst) / revEst) * 100).toFixed(1) : null,
      report_date: `${y}-${String(((q - 1) * 3) + 2).padStart(2, '0')}-15`,
    })
    // step one quarter back
    q -= 1; if (q < 1) { q = 4; y -= 1 }
  }
  return rows.reverse()   // oldest → newest
}

// ⚠️ DEMO: a plausible 5-year average for a valuation multiple, derived
// deterministically from the current value so the "current vs history" layout can
// be evaluated. NOT a real historical average — surfaced only behind a visible
// "Demo history" badge. Real bands (price × historical EPS) are a planned follow-up.
const _DEMO_VAL_FACTOR = {
  pe_trailing: 0.83, pe_forward: 0.9, peg: 1.06, ps: 0.86, pb: 0.88,
  ev_to_ebitda: 0.87, ev_to_revenue: 0.85,
}
export function demoValAvg(key, current) {
  if (current == null || Number.isNaN(Number(current))) return null
  return +(Number(current) * (_DEMO_VAL_FACTOR[key] || 0.88)).toFixed(2)
}

// ⚠️ DEMO NARRATIVES — illustrative only, for evaluating the Business/Story UX
// while the local backend can't reach Anthropic. On production these come from the
// AI stock-brief (company_desc + run_story). Shown behind a visible "Illustrative"
// tag; only for a handful of well-known names — never fabricated for arbitrary
// tickers (unknown → the honest "generates on the live product" note is shown).
export const DEMO_PROFILES = {
  NVDA: {
    company_desc: 'NVIDIA designs the GPUs and networking that power AI training and inference, and sells the CUDA software stack that keeps developers on its hardware.',
    run_story: 'NVDA has been the primary beneficiary of the AI infrastructure buildout, with hyperscaler capex driving data-center revenue to record levels and repeated earnings beats. Gross margins expanded as demand outstripped supply for its latest accelerators, and forward estimates were revised steadily higher. The debate now is how long the buildout lasts and whether competition or a capex digestion phase eventually slows the growth.',
  },
  MU: {
    company_desc: 'Micron makes DRAM and NAND memory and storage chips used across data centers, PCs, phones, autos and AI accelerators.',
    run_story: 'Micron re-rated sharply as the memory cycle turned up, with AI servers driving demand for high-bandwidth memory (HBM) and pricing recovering off cycle lows. Guidance and estimates inflected higher as the company sold out HBM capacity and margins recovered from trough levels. The key risk is memory’s historical cyclicality — the operating leverage that drove the move cuts both ways when pricing normalizes.',
  },
  AAPL: {
    company_desc: 'Apple designs consumer hardware (iPhone, Mac, iPad, Watch) and monetizes its large installed base through a high-margin Services business.',
    run_story: 'Apple’s move has been driven less by unit growth than by Services margin expansion, buybacks steadily shrinking the share count, and optimism around an on-device AI upgrade cycle. Investors are weighing a maturing iPhone franchise against a durable, growing Services annuity.',
  },
  AMD: {
    company_desc: 'AMD designs CPUs and GPUs for data centers, PCs and gaming, competing directly with Intel and NVIDIA.',
    run_story: 'AMD has re-rated on data-center momentum, with its MI-series accelerators positioned as the leading alternative to NVIDIA and continued server-CPU share gains from Intel. Estimates moved higher on AI-GPU traction; the debate is how much of that market it can realistically capture.',
  },
  TSLA: {
    company_desc: 'Tesla makes electric vehicles and energy-storage systems and is investing heavily in autonomy (FSD) and robotics.',
    run_story: 'Tesla’s stock is driven as much by the autonomy and robotics narrative as by the auto business, which has faced pricing pressure and margin compression. The move reflects shifting expectations around FSD/robotaxi timing and energy-storage growth more than near-term vehicle deliveries.',
  },
  PLTR: {
    company_desc: 'Palantir sells data-analytics and AI software platforms (Gotham, Foundry, AIP) to government and commercial customers.',
    run_story: 'Palantir’s move has been driven by accelerating US commercial growth, rapid adoption of its AIP platform, and a swing to consistent GAAP profitability. It trades at a premium multiple, so the debate centers on whether growth can sustain the valuation.',
  },
}
export function demoProfile(sym) { return DEMO_PROFILES[(sym || '').toUpperCase()] || null }
