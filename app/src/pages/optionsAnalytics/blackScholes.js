// FT-016 — Black-Scholes, for the contract pricer. COMPUTED, and every surface that shows a value
// from here labels it so, beside the vendor's own price and greeks.
//
// ⛔ Assumptions are stated, never hidden: European exercise, no dividends, a zero risk-free rate
//    (the pricer says so). American early exercise and dividends make listed prices differ.
// Pure; no React.

const SQRT2PI = Math.sqrt(2 * Math.PI)

/** Standard normal density. */
export function pdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT2PI
}

/** Standard normal CDF (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8). */
export function cdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const upper = pdf(x) * poly
  return x >= 0 ? 1 - upper : upper
}

/**
 * {price, delta, gamma, theta, vega} for one option.
 * type 'call'|'put'; S spot; K strike; iv as a decimal; days to expiry (calendar).
 * theta is per calendar day, vega per 1 vol point. At or past expiry: intrinsic, greeks 0
 * except delta (0/1 or -1/0).
 */
export function price({ type, S, K, iv, days }) {
  const t = Math.max(0, days) / 365
  const isCall = type === 'call'
  if (!(S > 0) || !(K > 0)) return null
  if (t === 0 || !(iv > 0)) {
    const intrinsic = isCall ? Math.max(0, S - K) : Math.max(0, K - S)
    const itm = isCall ? S > K : K > S
    return { price: intrinsic, delta: itm ? (isCall ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 }
  }
  const st = iv * Math.sqrt(t)
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * t) / st
  const d2 = d1 - st
  const value = isCall ? S * cdf(d1) - K * cdf(d2) : K * cdf(-d2) - S * cdf(-d1)
  return {
    price: value,
    delta: isCall ? cdf(d1) : cdf(d1) - 1,
    gamma: pdf(d1) / (S * st),
    theta: -(S * pdf(d1) * iv) / (2 * Math.sqrt(t)) / 365,
    vega: (S * pdf(d1) * Math.sqrt(t)) / 100,
  }
}
