# Coverage checks: candles and market bottoms

Research lane for Study, run 2026-10-17. Sources: Bulkowski's candlestick visual index (https://thepatternsite.com/CandleVisual.html, 103 names) and the individual pattern pages on thepatternsite.com; Investopedia (capitulation, bear market); Investor's Business Daily (follow-through day, market bottoms). StockCharts ChartSchool could not be reached from this machine (TLS handshake failure in both fetch tools), so the StockCharts half of the candle comparison is not done. Nothing here changes the catalog; the owner reviews each line.

## Candle catalog versus Bulkowski's list

`api/services/screener/candle_catalog.py` holds 66 `Pattern(...)` records (the brief said about 77; the count on 2026-10-17 is 66: 22 single-bar shapes, 44 multi-bar relations).

| Check | Result |
|---|---|
| Our names also on Bulkowski's list | 58 of 66 match a Bulkowski name directly (spelling differences only: Thrusting Line = Thrusting, On-Neck Line = On neck, Tweezer = Tweezers, Long White = Long day, white, Short Black = Candle, short black, and so on). |
| (a) Bulkowski names our catalog lacks | Above the Stomach; Below the Stomach; Breakaway (bullish, bearish); Concealing Baby Swallow; Doji star (bullish, bearish); Collapsing doji star; Doji, gapping up; Doji, gapping down; Doji, northern; Doji, southern; Downside gap three methods; Upside gap three methods; In neck; Ladder bottom; Mat hold; Meeting lines (bullish, bearish); Marubozu, closing white/black; Marubozu, opening white/black; Rickshaw man; Shooting star (2 lines); Side by side white lines (bullish, bearish); Takuri line; Three line strike (bullish, bearish); Three stars in the South; Two black gapping; Unique three-river bottom; Upside gap two crows; Window, rising; Window, falling; 8, 10, 12 and 13 new price lines. Bulkowski also splits Harami cross, Tri-star and Separating lines into bullish and bearish forms and Spinning top into black and white; ours carries one neutral record for each. |
| (b) Our names Bulkowski does not list | Umbrella and Inverted Umbrella (Nison's generic shape names; Bulkowski files them as hammer, hanging man, inverted hammer, shooting star, dragonfly and gravestone); Hikkake (Bull), Hikkake (Bear), Hikkake Confirmed (Bull), Hikkake Confirmed (Bear) (Dan Chesler's bar pattern, not on Bulkowski's candle list); plain Doji (Bulkowski names only the specific dojis). StockCharts not checked. |
| (c) Textbook bias versus Bulkowski's measured behaviour | Bias flipped in his tests: Hanging Man (ours bearish reversal; acts bullish continuation 59%), Inverted Hammer (ours bullish reversal; bearish continuation 65%), Tweezer Top (ours bearish reversal; bullish continuation 56%), Tweezer Bottom (ours bullish reversal; bearish continuation 52%), Deliberation (ours bearish reversal; bullish continuation 77%), Advance Block (ours bearish reversal; bullish continuation 64%), Stick Sandwich (ours bullish reversal; bearish continuation 62%), Matching Low (ours bullish reversal; bearish continuation 61%), Homing Pigeon (ours bullish reversal; bearish continuation 56%), Thrusting Line (ours bearish continuation; bullish reversal 57%). Same direction but near random: Kicking (Bull) 53%, Tri-Star (bull form) 60%, Shooting Star 59%, Hammer 60%. The catalog keeps the classical bias on purpose (owner decision 2026-08-24); this is a report only. The other patterns in the catalog's "20 of 77" note were not re-checked this run. |

## Market bottoms versus the standard list

`app/src/pages/modelbook/bottomsCatalog.js` BOTTOMS holds nine entries: 1974, 1987, 2002, 2009, 2011, 2016, 2018, 2020, 2022.

| Standard bottom | In BOTTOMS? | Note |
|---|---|---|
| 1987 Oct (Black Monday) | yes (`1987-crash`) | |
| 1990 Oct (Gulf War bear, S&P low 11 Oct 1990) | no | Missing. Date from the brief's standard list; not verified against a fetched page this run. |
| 1998 Oct (Russia / LTCM, S&P low 8 Oct 1998) | no | Missing. Same caveat. |
| 2002 Oct to 2003 Mar (dot-com) | partly (`2002-dotcom`) | Entry covers the Oct 2002 low; the Mar 2003 retest that started the bull is only implied. |
| 2009 Mar (GFC) | yes (`2009-gfc`) | |
| 2011 Oct (debt downgrade / euro crisis) | yes (`2011-summer`) | Investopedia's crash timeline lists the Aug 2011 episode. |
| 2016 Feb (double bottom) | yes (`2016-feb`) | Investopedia's timeline lists the 2015 to 2016 sell-off. |
| 2018 Dec 24 | yes (`2018-christmas`) | |
| 2020 Mar 23 (COVID) | yes (`2020-covid`) | |
| 2022 Oct 13 (rate bear) | yes (`2022-bear`) | |
| 2023 Oct 27 (10% correction low) | no | A correction, not a bear; optional. |
| 2025 Apr 7 to 8 (tariff crash) | no | Missing. S&P Dow Jones Indices commentary (seen in search results, not fetched) puts the intraday low at 4,835.04 on 7 Apr 2025, 21.35% off the 19 Feb high, with no bear-market close; the 9 Apr tariff pause produced the largest one-day gain since 2008. |
| 1974 Dec (secular low) | yes (`1974-secular`) | Extra versus the standard list; keep. |

## Signposts versus the reputable descriptions

| Signpost | Source checked | Verdict |
|---|---|---|
| 1 Capitulation | Investopedia capitulation | Matches: heavy volume with sharp declines, the rebound as the tell, "running out of sellers". Add Investopedia's caveat that bear markets throw repeat plunges and premature calls, and capitulation is confirmed only in hindsight. |
| 2 Volatility Peak | none fetched | No Investopedia, IBD or Bulkowski page on a VIX spike as a bottom signal was fetched; the description stays a house claim. |
| 3 Breadth Washout | none fetched | Same; no policy source fetched. |
| 4 News Failure | Investopedia capitulation (nearest) | House concept with no external definition; the hindsight caveat applies. |
| 5 Follow-Through Day | IBD "How To Identify Stock Market Bottoms", "What Is A Follow-Through Day?" | Matches IBD: first up day off the low starts the rally attempt; the follow-through confirms. Our line "no bottom of consequence has ever happened without one" is O'Neil's claim and is not on the fetched (paywalled) page; the percent threshold and "day four or later" rule are not visible either. |
| 6 Leadership Emerges | IBD bottoms article (lead paragraph only) | Consistent with IBD's method (buy leaders after the follow-through) but the fetched page stops before any leadership text, so it is consistent, not quoted. |

## Findings

- 66 candle records, not about 77; 58 map to Bulkowski names, 8 are ours only (Umbrella, Inverted Umbrella, four Hikkake forms, plain Doji, and the single neutral Harami Cross / Tri-Star / Separating Lines records that Bulkowski splits).
- Bulkowski lists about 35 candle names we do not carry; the ones most likely to matter for a swing desk are Breakaway, Mat hold, Three line strike, Meeting lines, Doji star, Window (rising/falling) and the opening/closing Marubozu variants.
- Ten of our textbook biases flip in Bulkowski's tests and four more are near random; the catalog keeps the classical bias on purpose, so this is for the owner's awareness and for the reveal text, not for the detector.
- BOTTOMS is missing 1990, 1998 and the April 2025 tariff low; 2002 could note the March 2003 retest.
- Signposts 1 and 5 match the reputable descriptions; 2, 3, 4 and 6 are house descriptions with no fetched external definition. The IBD "never without one" claim should be marked as O'Neil's claim rather than fact.
- StockCharts ChartSchool was unreachable, so the StockCharts half of the candle check is still open.
