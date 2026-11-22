// STAT's sample answer for the panel and model tests. EVERY number, date and price here is INVENTED
// (worked out by the real server code from an invented, seeded price series; no store, no vendor).
// The symbol is the usual sample ticker; nothing here is that company's data.
export const STAT_OK = Object.freeze({
  "status": "ok",
  "symbol": "NVDA",
  "session": "2026-11-20",
  "data_through": "2026-11-20",
  "first": "2004-01-02",
  "sessions": 5759,
  "built_at": "2026-11-21T01:25:00+00:00",
  "source": "UCT's stored daily prices (split-adjusted, price only)",
  "basis": "daily close, split-adjusted, not dividend-adjusted (price return)",
  "suspect_jumps": [],
  "suspect_jump_pct": 40,
  "volatility": {
    "as_of": "2026-11-20",
    "close": 132.33,
    "sessions": 5759,
    "atr": {
      "state": "ok",
      "period": 14,
      "value": 4.2285,
      "pct": 3.2
    },
    "realized": [
      {
        "state": "ok",
        "sessions": 20,
        "pct": 38.5
      },
      {
        "state": "ok",
        "sessions": 60,
        "pct": 36.3
      }
    ],
    "realized_method": "the sample standard deviation (divisor n-1) of daily log returns, close to close, x sqrt(252)",
    "adr": {
      "state": "ok",
      "sessions": 21,
      "pct": 2.44,
      "dollars": 2.9986
    },
    "range_52w": {
      "state": "ok",
      "high": 181.17,
      "high_date": "2026-02-02",
      "low": 89.32,
      "low_date": "2026-06-23",
      "from_high_pct": -26.96,
      "from_low_pct": 48.15
    },
    "volume": {
      "last": 11100000,
      "last_date": "2026-11-20",
      "avg": {
        "20": 23025000,
        "50": 24348000
      },
      "rel": 0.45,
      "rel_base_sessions": 30
    },
    "days_1y": {
      "state": "ok",
      "from": "2025-11-20",
      "total": 251,
      "up": 127,
      "down": 122,
      "flat": 2,
      "up_pct": 50.6,
      "down_pct": 48.6
    }
  },
  "beta": {
    "as_of": "2026-11-20",
    "window": 252,
    "min": 200,
    "capture_min_days": 20,
    "spy": {
      "symbol": "SPY",
      "state": "ok",
      "returns": 252,
      "from": "2025-11-20",
      "to": "2026-11-20",
      "beta": 1.399,
      "correlation": 0.731,
      "up_capture": 144.6,
      "up_capture_days": 122,
      "down_capture": 125.0,
      "down_capture_days": 130
    },
    "sector": {
      "state": "ok",
      "symbol": "XLK",
      "sector": "Technology",
      "returns": 252,
      "from": "2025-11-20",
      "to": "2026-11-20",
      "beta": 1.225,
      "correlation": 0.685
    }
  },
  "returns": {
    "as_of": "2026-11-20",
    "close": 132.33,
    "periods": [
      {
        "key": "1W",
        "label": "1 week",
        "target": "2026-11-13",
        "state": "ok",
        "from": "2026-11-13",
        "base_close": 126.08,
        "return_pct": 4.96
      },
      {
        "key": "1M",
        "label": "1 month",
        "target": "2026-10-20",
        "state": "ok",
        "from": "2026-10-20",
        "base_close": 117.35,
        "return_pct": 12.77
      },
      {
        "key": "3M",
        "label": "3 months",
        "target": "2026-08-20",
        "state": "ok",
        "from": "2026-08-20",
        "base_close": 111.15,
        "return_pct": 19.06
      },
      {
        "key": "6M",
        "label": "6 months",
        "target": "2026-05-20",
        "state": "ok",
        "from": "2026-05-20",
        "base_close": 108.36,
        "return_pct": 22.12
      },
      {
        "key": "YTD",
        "label": "Year to date",
        "target": "2025-12-31",
        "state": "ok",
        "from": "2025-12-31",
        "base_close": 146.89,
        "return_pct": -9.91
      },
      {
        "key": "1Y",
        "label": "1 year",
        "target": "2025-11-20",
        "state": "ok",
        "from": "2025-11-20",
        "base_close": 138.88,
        "return_pct": -4.72
      },
      {
        "key": "3Y",
        "label": "3 years",
        "target": "2023-11-20",
        "state": "ok",
        "from": "2023-11-20",
        "base_close": 183.23,
        "return_pct": -27.78,
        "yearly_pct": -10.28
      },
      {
        "key": "5Y",
        "label": "5 years",
        "target": "2021-11-20",
        "state": "ok",
        "from": "2021-11-19",
        "base_close": 141.84,
        "return_pct": -6.7,
        "yearly_pct": -1.38
      }
    ],
    "extremes": {
      "all": {
        "state": "ok",
        "from": "2004-01-02",
        "best_day": {
          "date": "2018-12-19",
          "return_pct": 10.65,
          "check": false
        },
        "worst_day": {
          "date": "2007-07-26",
          "return_pct": -8.23,
          "check": false
        },
        "best_week": {
          "date": "2019-12-20",
          "return_pct": 20.36,
          "check": false,
          "from": "2019-12-16"
        },
        "worst_week": {
          "date": "2024-03-15",
          "return_pct": -17.36,
          "check": false,
          "from": "2024-03-11"
        }
      },
      "year": {
        "state": "ok",
        "from": "2025-11-20",
        "best_day": {
          "date": "2026-04-09",
          "return_pct": 6.14,
          "check": false
        },
        "worst_day": {
          "date": "2026-05-20",
          "return_pct": -7.31,
          "check": false
        },
        "best_week": {
          "date": "2026-11-06",
          "return_pct": 10.11,
          "check": false,
          "from": "2026-11-02"
        },
        "worst_week": {
          "date": "2026-05-22",
          "return_pct": -14.88,
          "check": false,
          "from": "2026-05-18"
        }
      }
    },
    "week_complete": true
  },
  "drawdowns": {
    "as_of": "2026-11-20",
    "first": "2004-01-02",
    "min_depth_pct": 20,
    "high": {
      "date": "2017-10-03",
      "close": 310.49,
      "from_high_pct": -57.38
    },
    "total": 12,
    "shown": 12,
    "ongoing": 1,
    "recovered": 11,
    "median_depth_pct": -30.17,
    "median_recovery_sessions": 99,
    "deepest": {
      "id": "NVDA-2017-10-03",
      "peak": {
        "date": "2017-10-03",
        "close": 310.49
      },
      "trough": {
        "date": "2021-03-19",
        "close": 68.24
      },
      "depth_pct": -78.02,
      "sessions_down": 870,
      "recovered": null,
      "sessions_to_recover": null,
      "ongoing": true,
      "peak_at_history_start": false,
      "below_peak_now_pct": -57.38,
      "check": false
    },
    "episodes": [
      {
        "id": "NVDA-2017-10-03",
        "peak": {
          "date": "2017-10-03",
          "close": 310.49
        },
        "trough": {
          "date": "2021-03-19",
          "close": 68.24
        },
        "depth_pct": -78.02,
        "sessions_down": 870,
        "recovered": null,
        "sessions_to_recover": null,
        "ongoing": true,
        "peak_at_history_start": false,
        "below_peak_now_pct": -57.38,
        "check": false
      },
      {
        "id": "NVDA-2016-12-09",
        "peak": {
          "date": "2016-12-09",
          "close": 185.32
        },
        "trough": {
          "date": "2017-02-01",
          "close": 146.99
        },
        "depth_pct": -20.68,
        "sessions_down": 35,
        "recovered": "2017-03-28",
        "sessions_to_recover": 38,
        "ongoing": false,
        "peak_at_history_start": false,
        "below_peak_now_pct": null,
        "check": false
      },
      {
        "id": "NVDA-2016-02-02",
        "peak": {
          "date": "2016-02-02",
          "close": 150.73
        },
        "trough": {
          "date": "2016-05-18",
          "close": 105.56
        },
        "depth_pct": -29.97,
        "sessions_down": 74,
        "recovered": "2016-10-07",
        "sessions_to_recover": 99,
        "ongoing": false,
        "peak_at_history_start": false,
        "below_peak_now_pct": null,
        "check": false
      }
    ]
  },
  "corrections": {
    "index": "S&P 500",
    "first": "2004-01-02",
    "as_of": "2026-11-20",
    "state": "ok",
    "index_first": "2004-01-02",
    "index_through": "2026-11-20",
    "built_at": "2026-11-21T01:20:00+00:00",
    "definition": "A decline counts from a closing high to the lowest close before that high is regained: 10% to 20% is a correction, 20% or more a bear market.",
    "episodes": [
      {
        "id": "SPX-2025-12-02",
        "kind": "bear",
        "peak": {
          "date": "2025-12-02",
          "close": 10034.74
        },
        "trough": {
          "date": "2026-06-23",
          "close": 7070.15
        },
        "depth_pct": -29.54,
        "recovered": null,
        "ongoing": true,
        "stock": {
          "from": "2025-12-02",
          "to": "2026-06-23",
          "drawdown_pct": -48.83,
          "high": {
            "date": "2026-01-30",
            "close": 179.14
          },
          "low": {
            "date": "2026-06-23",
            "close": 91.66
          },
          "window_return_pct": -37.29,
          "vs_index_ratio": 1.65,
          "vs_index_pts": -19.29,
          "new_high": {
            "state": "first",
            "high": 154.29,
            "date": "2026-01-08",
            "index_date": null,
            "lead_sessions": null
          },
          "after": {
            "state": "ok",
            "months": 3,
            "from": "2026-06-23",
            "date": "2026-09-23",
            "return_pct": 34.98,
            "index_return_pct": 7.75,
            "vs_index_pts": 27.23
          }
        }
      },
      {
        "id": "SPX-2025-06-17",
        "kind": "correction",
        "peak": {
          "date": "2025-06-17",
          "close": 8680.91
        },
        "trough": {
          "date": "2025-08-06",
          "close": 7751.25
        },
        "depth_pct": -10.71,
        "recovered": "2025-10-24",
        "ongoing": false,
        "stock": {
          "from": "2025-06-17",
          "to": "2025-08-06",
          "drawdown_pct": -20.29,
          "high": {
            "date": "2025-06-24",
            "close": 145.2
          },
          "low": {
            "date": "2025-08-06",
            "close": 115.74
          },
          "window_return_pct": -18.48,
          "vs_index_ratio": 1.89,
          "vs_index_pts": -9.58,
          "new_high": {
            "state": "index_only",
            "high": 180.06,
            "date": null,
            "index_date": "2025-10-24",
            "lead_sessions": null
          },
          "after": {
            "state": "ok",
            "months": 3,
            "from": "2025-08-06",
            "date": "2025-11-06",
            "return_pct": 20.06,
            "index_return_pct": 17.75,
            "vs_index_pts": 2.31
          }
        }
      },
      {
        "id": "SPX-2024-10-09",
        "kind": "correction",
        "peak": {
          "date": "2024-10-09",
          "close": 8059.32
        },
        "trough": {
          "date": "2024-12-13",
          "close": 6948.51
        },
        "depth_pct": -13.78,
        "recovered": "2025-04-14",
        "ongoing": false,
        "stock": {
          "from": "2024-10-09",
          "to": "2024-12-13",
          "drawdown_pct": -28.71,
          "high": {
            "date": "2024-10-09",
            "close": 166.47
          },
          "low": {
            "date": "2024-12-13",
            "close": 118.67
          },
          "window_return_pct": -28.71,
          "vs_index_ratio": 2.08,
          "vs_index_pts": -14.93,
          "new_high": {
            "state": "index_only",
            "high": 206.2,
            "date": null,
            "index_date": "2025-04-14",
            "lead_sessions": null
          },
          "after": {
            "state": "ok",
            "months": 3,
            "from": "2024-12-13",
            "date": "2025-03-13",
            "return_pct": 20.74,
            "index_return_pct": 9.24,
            "vs_index_pts": 11.5
          }
        }
      },
      {
        "id": "SPX-2019-12-20",
        "kind": "bear",
        "peak": {
          "date": "2019-12-20",
          "close": 7681.17
        },
        "trough": {
          "date": "2022-06-22",
          "close": 5281.34
        },
        "depth_pct": -31.24,
        "recovered": "2024-09-11",
        "ongoing": false,
        "stock": {
          "from": "2019-12-20",
          "to": "2022-06-22",
          "drawdown_pct": -71.86,
          "high": {
            "date": "2019-12-20",
            "close": 242.47
          },
          "low": {
            "date": "2021-03-19",
            "close": 68.24
          },
          "window_return_pct": -65.25,
          "vs_index_ratio": 2.3,
          "vs_index_pts": -40.62,
          "new_high": {
            "state": "index_only",
            "high": 301.6,
            "date": null,
            "index_date": "2024-09-11",
            "lead_sessions": null
          },
          "after": {
            "state": "ok",
            "months": 3,
            "from": "2022-06-22",
            "date": "2022-09-22",
            "return_pct": 36.48,
            "index_return_pct": 14.92,
            "vs_index_pts": 21.56
          }
        }
      }
    ],
    "before_history": 0,
    "summary": {
      "count": 18,
      "fell_less": 0,
      "fell_more": 18,
      "median_ratio": 1.78,
      "new_high_first": 10,
      "new_high_judged": 17,
      "after_beat": 12,
      "after_count": 18,
      "median_after_vs_index_pts": 10.61
    }
  }
})

/** A deep copy to change in one test. */
export const statAnswer = () => JSON.parse(JSON.stringify(STAT_OK))
