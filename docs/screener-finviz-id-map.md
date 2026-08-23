# Finviz v152 export `c=` id map — MEASURED, 2026-08-22/23

Live-walked on elite.finviz.com (owner session, screener.ashx page renders — the
export serves FULLER header names for some columns, e.g. page "Outstanding" =
export "Shares Outstanding"; a pinned id's export spelling is adjudicated by the
first pull's `missing_headers` receipt, never guessed silently). Walks where the
returned header count equaled the requested id count are 1:1 POSITIONAL and
trustworthy; the one exception is flagged below.

⛔ Rules that outrank this table (finviz_universe.py docstring): parse BY HEADER
NAME, never id · float_pct stays DERIVED even though c=85 exists (one-writer) ·
shares columns are BARE RAW MILLIONS · %-columns are signed · never re-pin
without a receipt.

| id | page header | | id | page header |
|---|---|---|---|---|
| 0 | No. | | 60 | Change from Open % |
| 1 | Ticker | | 61 | Gap |
| 2 | Company | | 62 | Recom |
| 3 | Sector | | 63 | Avg Volume |
| 4 | Industry | | 64 | Rel Volume |
| 5 | Country | | 65 | Price |
| 6 | Market Cap | | 66 | Change % |
| 7 | P/E | | 67 | Volume |
| 8 | Forward P/E | | 68 | Earnings |
| 9 | PEG | | 69 | Target Price |
| 10 | P/S | | 70 | IPO Date |
| 11 | P/B | | 71 | AH Close |
| 12 | P/C | | 72 | AH Change % |
| 13 | P/FCF | | 73 | Book/sh |
| 14 | Dividend | | 74 | Cash/sh |
| 15 | Payout Ratio | | 75 | Dividend |
| 16 | EPS | | 76 | Employees |
| 17 | EPS This Y | | 77 | EPS next Q |
| 18 | EPS Next Y | | 78 | Income |
| 19 | **EPS Past 5Y** ← parity-2 | | 79 | Index |
| 20 | **EPS Next 5Y** ← parity-2 | | 80 | **Optionable** ← T6 |
| 21 | **Sales Past 5Y** ← parity-2 | | 81 | Prev Close |
| 22 | **EPS Q/Q** ← parity-2 | | 82 | Sales |
| 23 | **Sales Q/Q** ← parity-2 | | 83 | **Shortable** ← T6 |
| 24 | Shares Outstanding ✅shipped | | 84 | Short Interest |
| 25 | Shares Float ✅shipped | | 85 | Float % (⛔ NOT pinned — derived) |
| 26 | Insider Own ✅shipped | | 86 | Open |
| 27 | **Insider Trans** ← T6 | | 87 | High |
| 28 | Inst Own ✅shipped | | 88 | Low |
| 29 | **Inst Trans** ← T6 | | 89 | Trades |
| 30 | Short Float ✅shipped | | 90-94 | Perf 1/2/3/5/10 Min (live-lane, excluded) |
| 31 | Short Ratio ✅shipped | | 95-99 | Perf 15/30 Min, 1/2/4 Hr (live-lane) |
| 32 | ROA | | 100-106 | Asset/ETF Type · Region · Category · Sector/Theme · Tags · Active |
| 33 | ROE | | 107-115 | Expense · Holdings · AUM · NAV · NAV% · Flows 1M/%1M/3M/%3M |
| 34 | ROIC | | 116-124 | ⚠️ NEVER WALKED (ETF-flow continuation presumed) |
| 35 | Curr R | | 125 | All-Time High |
| 36 | Quick R | | 126 | All-Time Low |
| 37 | LTDebt/Eq | | 127 | EPS Surprise |
| 38 | Debt/Eq | | 128 | Revenue Surprise |
| 39 | Gross M | | 129 | Exchange (the ex-float_pct placeholder) |
| 40 | Oper M | | 130 | Dividend TTM |
| 41 | Profit M | | 131 | Dividend Ex Date |
| 42 | Perf Week | | 132 | EPS YoY TTM |
| 43 | Perf Month | | 133 | Sales YoY TTM |
| 44 | Perf Quart | | 134 | 52W Range |
| 45 | Perf Half | | 135 | News Time |
| 46 | Perf Year | | 136 | News URL |
| 47 | Perf YTD | | 137 | News Title |
| 48 | Beta | | 138 | Perf 3Y |
| 49 | ATR | | 139 | Perf 5Y |
| 50 | Volatility W | | 140 | Perf 10Y |
| 51 | Volatility M | | 141-153 | ⚠️ ORDER-ONLY (11 headers came back for 15 requested ids — absent ids collapse positions; VERIFY any id here before pinning): AH Volume · EPS Past 3Y · Sales Past 3Y · Enterprise Value · EV/EBITDA · EV/Sales · Div Gr 1Y · Div Gr 3Y · Div Gr 5Y · Daily Digest · Security Type |
| 52 | SMA20 | | | |
| 53 | SMA50 | | | |
| 54 | SMA200 | | | |
| 55 | 50D High | | | |
| 56 | 50D Low | | | |
| 57 | 52W High | | | |
| 58 | 52W Low | | | |
| 59 | RSI | | | |

Free-for-the-taking, deliberately NOT pulled (recorded so absence reads as
decision): EV family (Wave-6 map lane 3) · Perf 3Y/5Y/10Y · EPS/Rev Surprise ·
Dividend growth family · Volatility W/M · LTDebt/Eq · Security Type. AH data
excluded by snapshot-honesty ruling (live fact in a nightly row).
