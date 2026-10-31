# Bars report for the bars owner (Study found these; not Study's to fix)

Written 2026-10-30 from a READ-ONLY scan of the pod's daily store (`bars_sqlite.get_bars_before`, tf `D`) and the
Study bank. Nothing was changed on the pod. Study already keeps every approved chart off these bars; this note
exists so the firm's own charts (Terminal, pattern review, Compass) get fixed at the source.

## 1. SPY daily store carries six impossible bars (and one more that is plainly wrong)

Scan rule: a low under half the candle body, a high over double the body, high under low, or a non-positive
price. SPY has 8019 daily rows back to 1994-12-20. NVDA (6987 rows from 1999-01-22) and QQQ (6459 rows from
1999-03-10) are clean under the same rule.

| session | open | high | low | close | what is wrong |
| --- | --- | --- | --- | --- | --- |
| 2004-03-16 | 111.78 | 112.06 | **11.70** | 111.79 | low is a tenth of the price (a dropped digit) |
| 2004-08-18 | 108.52 | **1107.07** | 108.49 | 110.03 | high is ten times the price |
| 2004-12-21 | 119.60 | 120.48 | **52.67** | 120.39 | low is less than half the price |
| 2005-05-27 | 120.06 | **1120.20** | 119.80 | 120.25 | high is ten times the price |
| 2006-01-26 | 127.28 | 127.67 | **57.29** | 127.36 | low is less than half the price |
| 2008-09-29 | 119.18 | 121.18 | **11.85** | 111.38 | low is a tenth of the price (Yahoo low that day 110.97) |
| 2008-11-07 | 91.65 | 94.00 | **53.15** | 93.86 | low is far under the day (Yahoo low 90.50); passes the half-body rule, so a plain "low vs prior close" check is needed too |

The 2008 pair was found on 2026-10-23 while price-checking the Bottoms station (RESUME.md, "bottoms_price_check.md");
the 2004 to 2006 ones came out of the full-store scan today. Any SPY chart or indicator that spans these dates
(2004 to 2008 long-range charts, ATR, range and wick measures, swing lows) reads them. Suggested fix: re-pull the
seven sessions from the vendor and add a store-level sanity rule (low >= 0.5 x min(open, close), high <= 2 x
max(open, close), and |low or high vs prior close| under some cap) on every daily write.

## 2. NVDA 2026-09-09 Gap Support fixture (si_6763b7b65c3f): the store is fine

The owner, 2026-10-24: "Don't have enough price data in that pic" (verdict pending). The pod's NVDA daily store
has no gap: 420 rows to 2026-10-30 with no hole over five calendar days, 383 rows on or before 2026-09-09. The
bank fixture embeds 130 full daily bars 2026-03-05 to 2026-09-09. So the empty chart the owner saw is Study's
own problem (the chart snapshot stored on the pod for that item, or the review screen's window), not the bars
store. Study will re-check the pod snapshot `sb_si_6763b7b65c3f` (the SSH read timed out mid-deploy today) and
re-import or re-show the item; the bars owner needs to do nothing here.

## 3. Hourly history

The pod's intraday store starts 2026-09-28 (hourly bars for anything earlier come from the vendor at build time and
are embedded in the Study items). Not a defect, recorded so nobody looks for older hourly bars in the store.
