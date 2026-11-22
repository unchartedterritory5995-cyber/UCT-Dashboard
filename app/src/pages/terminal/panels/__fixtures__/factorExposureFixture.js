// FCTX's sample answer: EVERY value is INVENTED (invented random walks for the seven factor funds and for
// a stock under the name NVDA, run through the real server code, api/services/factor_exposure.py, so the
// shape is the route's own). Not a real stock's or fund's prices; the loadings are the invented walk's.
//
// Made by scratch/fex_make_fixture.py: 620 invented weekday sessions to Nov 20, 2026; the stock was built
// with a larger market loading and a momentum tilt in its newest year, a quality tilt in the year before.
const BASE = {
  "status": "ok",
  "symbol": "NVDA",
  "session": "2026-11-20",
  "data_through": "2026-11-20",
  "read_from": "2024-09-25",
  "sessions_read": 563,
  "built_at": "2026-11-21T01:30:00+00:00",
  "source": "UCT's stored daily prices (split-adjusted, price only)",
  "basis": "daily close, split-adjusted, not dividend-adjusted (price return)",
  "suspect_jump_pct": 40,
  "method": {
    "window": 252,
    "min": 200,
    "t_bar": 2.0,
    "vif_unstable": 5.0,
    "fund_min_closes": 201,
    "fund_full_closes": 505,
    "index": "S&P 500",
    "annualise_days": 252,
    "max_lag_days": 10
  },
  "factors": [
    {
      "key": "market",
      "name": "Market",
      "state": "ok",
      "funds": [
        "SPY"
      ],
      "primary": [
        "SPY"
      ],
      "alternative": [
        "IVV"
      ],
      "positive": "moves with the market",
      "negative": "moves against the market"
    },
    {
      "key": "size",
      "name": "Size",
      "state": "ok",
      "funds": [
        "IWM",
        "SPY"
      ],
      "primary": [
        "IWM"
      ],
      "alternative": [
        "VTWO"
      ],
      "positive": "small caps",
      "negative": "large caps"
    },
    {
      "key": "growth",
      "name": "Growth vs value",
      "state": "ok",
      "funds": [
        "IWF",
        "IWD"
      ],
      "primary": [
        "IWF",
        "IWD"
      ],
      "alternative": [
        "VUG",
        "VTV"
      ],
      "positive": "growth",
      "negative": "value"
    },
    {
      "key": "momentum",
      "name": "Momentum",
      "state": "ok",
      "funds": [
        "MTUM",
        "SPY"
      ],
      "primary": [
        "MTUM"
      ],
      "alternative": [
        "SPMO"
      ],
      "positive": "recent winners",
      "negative": "recent losers"
    },
    {
      "key": "quality",
      "name": "Quality",
      "state": "ok",
      "funds": [
        "QUAL",
        "SPY"
      ],
      "primary": [
        "QUAL"
      ],
      "alternative": [
        "SPHQ"
      ],
      "positive": "high quality",
      "negative": "low quality"
    },
    {
      "key": "lowvol",
      "name": "Low volatility",
      "state": "ok",
      "funds": [
        "USMV",
        "SPY"
      ],
      "primary": [
        "USMV"
      ],
      "alternative": [
        "SPLV"
      ],
      "positive": "low volatility",
      "negative": "high volatility"
    }
  ],
  "fund_checks": [
    {
      "symbol": "SPY",
      "closes": 564,
      "first": "2024-09-24",
      "last": "2026-11-20",
      "full": true,
      "state": "ok"
    },
    {
      "symbol": "IWM",
      "closes": 564,
      "first": "2024-09-24",
      "last": "2026-11-20",
      "full": true,
      "state": "ok"
    },
    {
      "symbol": "IWF",
      "closes": 564,
      "first": "2024-09-24",
      "last": "2026-11-20",
      "full": true,
      "state": "ok"
    },
    {
      "symbol": "IWD",
      "closes": 564,
      "first": "2024-09-24",
      "last": "2026-11-20",
      "full": true,
      "state": "ok"
    },
    {
      "symbol": "MTUM",
      "closes": 564,
      "first": "2024-09-24",
      "last": "2026-11-20",
      "full": true,
      "state": "ok"
    },
    {
      "symbol": "QUAL",
      "closes": 564,
      "first": "2024-09-24",
      "last": "2026-11-20",
      "full": true,
      "state": "ok"
    },
    {
      "symbol": "USMV",
      "closes": 564,
      "first": "2024-09-24",
      "last": "2026-11-20",
      "full": true,
      "state": "ok"
    }
  ],
  "common_returns": 562,
  "common_from": "2024-09-26",
  "common_to": "2026-11-20",
  "now": {
    "state": "ok",
    "returns": 252,
    "from": "2025-12-04",
    "to": "2026-11-20",
    "full": true,
    "exact": false,
    "loadings": [
      {
        "key": "market",
        "loading": 1.528,
        "se": 0.104,
        "t": 14.7,
        "clears": true,
        "correlation": 0.629,
        "vif": 1.02,
        "t_vs_one": 5.08,
        "side": "more"
      },
      {
        "key": "size",
        "loading": -0.104,
        "se": 0.173,
        "t": -0.6,
        "clears": false,
        "correlation": 0.034,
        "vif": 1.04
      },
      {
        "key": "growth",
        "loading": 1.296,
        "se": 0.167,
        "t": 7.75,
        "clears": true,
        "correlation": 0.365,
        "vif": 1.05
      },
      {
        "key": "momentum",
        "loading": 0.97,
        "se": 0.157,
        "t": 6.19,
        "clears": true,
        "correlation": 0.222,
        "vif": 1.01
      },
      {
        "key": "quality",
        "loading": 0.125,
        "se": 0.173,
        "t": 0.72,
        "clears": false,
        "correlation": 0.066,
        "vif": 1.06
      },
      {
        "key": "lowvol",
        "loading": -0.098,
        "se": 0.178,
        "t": -0.55,
        "clears": false,
        "correlation": -0.024,
        "vif": 1.03
      }
    ],
    "constant": {
      "daily_pct": 0.121,
      "yearly_pct": 30.6,
      "t": 1.22,
      "clears": false
    },
    "r2": 0.571,
    "adj_r2": 0.561,
    "explained_pct": 57.1,
    "own_pct": 42.9,
    "volatility": {
      "total_pct": 37.6,
      "factors_pct": 28.4,
      "own_pct": 24.6
    },
    "market_beta_alone": 1.55,
    "max_vif": {
      "key": "quality",
      "value": 1.06
    },
    "unstable": false,
    "check": []
  },
  "then": {
    "state": "ok",
    "returns": 252,
    "from": "2024-12-17",
    "to": "2025-12-03",
    "full": true,
    "exact": false,
    "loadings": [
      {
        "key": "market",
        "loading": 1.213,
        "se": 0.103,
        "t": 11.77,
        "clears": true,
        "correlation": 0.554,
        "vif": 1.04,
        "t_vs_one": 2.07,
        "side": "more"
      },
      {
        "key": "size",
        "loading": -0.231,
        "se": 0.156,
        "t": -1.48,
        "clears": false,
        "correlation": -0.069,
        "vif": 1.03
      },
      {
        "key": "growth",
        "loading": 1.117,
        "se": 0.161,
        "t": 6.96,
        "clears": true,
        "correlation": 0.281,
        "vif": 1.02
      },
      {
        "key": "momentum",
        "loading": 0.255,
        "se": 0.159,
        "t": 1.61,
        "clears": false,
        "correlation": 0.059,
        "vif": 1.05
      },
      {
        "key": "quality",
        "loading": 0.82,
        "se": 0.152,
        "t": 5.39,
        "clears": true,
        "correlation": 0.299,
        "vif": 1.04
      },
      {
        "key": "lowvol",
        "loading": -0.116,
        "se": 0.161,
        "t": -0.72,
        "clears": false,
        "correlation": -0.063,
        "vif": 1.02
      }
    ],
    "constant": {
      "daily_pct": 0.164,
      "yearly_pct": 41.4,
      "t": 1.77,
      "clears": false
    },
    "r2": 0.483,
    "adj_r2": 0.47,
    "explained_pct": 48.3,
    "own_pct": 51.7,
    "volatility": {
      "total_pct": 32.1,
      "factors_pct": 22.3,
      "own_pct": 23.1
    },
    "market_beta_alone": 1.218,
    "max_vif": {
      "key": "momentum",
      "value": 1.05
    },
    "unstable": false,
    "check": []
  },
  "change": [
    {
      "key": "market",
      "change": 0.315,
      "t": 2.15,
      "clears": true
    },
    {
      "key": "size",
      "change": 0.126,
      "t": 0.54,
      "clears": false
    },
    {
      "key": "growth",
      "change": 0.178,
      "t": 0.77,
      "clears": false
    },
    {
      "key": "momentum",
      "change": 0.714,
      "t": 3.2,
      "clears": true
    },
    {
      "key": "quality",
      "change": -0.695,
      "t": -3.02,
      "clears": true
    },
    {
      "key": "lowvol",
      "change": 0.018,
      "t": 0.08,
      "clears": false
    }
  ],
  "reading": {
    "text": "NVDA trades like a high-momentum growth stock with more market sensitivity than the S&P 500.",
    "basis": [
      {
        "key": "market",
        "side": "more",
        "loading": 1.528,
        "t": 14.7
      },
      {
        "key": "growth",
        "side": "positive",
        "loading": 1.296,
        "t": 7.75
      },
      {
        "key": "momentum",
        "side": "positive",
        "loading": 0.97,
        "t": 6.19
      }
    ],
    "uncertain": [
      "size",
      "quality",
      "lowvol"
    ],
    "exact": false
  },
  "reading_then": {
    "text": "NVDA trades like a high-quality growth stock with more market sensitivity than the S&P 500.",
    "basis": [
      {
        "key": "market",
        "side": "more",
        "loading": 1.213,
        "t": 11.77
      },
      {
        "key": "growth",
        "side": "positive",
        "loading": 1.117,
        "t": 6.96
      },
      {
        "key": "quality",
        "side": "positive",
        "loading": 0.82,
        "t": 5.39
      }
    ],
    "uncertain": [
      "size",
      "momentum",
      "lowvol"
    ],
    "exact": false
  }
}

/** A fresh deep copy of the sample answer (a test may change it freely). */
export function fctxAnswer() {
  return JSON.parse(JSON.stringify(BASE))
}
