# Study research: cited external definitions

This directory holds the research lane's output for the Study education feature: cited external definitions for the 28-setup catalog, the glossary terms the units lean on, the candle catalog bias check and the market-bottoms check. Run on 2026-10-17. Nothing here is a market fact on its own; every entry is a verbatim quote from a named page plus a plain summary, and the owner reviews each item one by one before any of it reaches a reveal.

Files:

- `definitions.json`: one record per term (`term`, `kind`, `house_name`, `nearest_standard`, `sources[]`, `summary`, `conventions{entry, stop, target}`, `mistakes[]`, `conflicts`). Sorted by term, indent 1, UTF-8, LF.
- `coverage.md`: the candle and bottoms coverage tables and findings.
- `README.md`: this file.

## Source policy

Reliable sources only, in this order of preference: Investopedia; StockCharts ChartSchool; Thomas Bulkowski's thepatternsite.com; Investors.com / IBD (O'Neil); minervini.com or Minervini's published text as quoted by reputable sites; CMT Association; Edwards & Magee / Murphy as quoted by reputable sites. No forums, no Reddit, no random blogs, no AI content farms. At most three sources per term; at most 60 words quoted verbatim per source; every source carries its exact URL and the access date.

Two originators' own sites were used where the brief named them as the standard for a house term: Stockbee (Pradeep Bonde) for Episodic Pivot and Virtue of Selfish Investing (Morales and Kacher) for Undercut & Rally. Van Tharp's institute site was used for R-multiples, and the Stocks & Commodities store abstract (Seykota and Druz, 1993) for portfolio heat. Each is flagged in the entry's `conflicts` field.

Quote handling: quotes were copied from the fetched page text. Two normalisations were applied so the text reads as the page renders it: spacing artifacts around chart labels left by stripping links (for example "( C )" becomes "(C)") and curly quotation marks kept as the page prints them. One quote (the IBD distribution-day definition on the Nasdaq-syndicated article) came from the search-result excerpt because the page fetch timed out; its entry says so.

## What could and could not be fetched

- Investopedia: blocked for the fetch tool, readable with plain curl; all Investopedia pages were read in full.
- Bulkowski (thepatternsite.com): read in full.
- investors.com: blocks the search crawler; the article pages are readable but paywalled, so only the lead paragraph (about 60 words) of each IBD article is served. IBD quotes stop where the paywall starts and the entries say so.
- StockCharts ChartSchool: unreachable from this machine (TLS handshake failure in both tools). No StockCharts quotes anywhere in this set; the StockCharts half of the candle check is open.
- TraderLion (Oliver Kell's Wedge Pop / Wedge Drop, Ross Haber's Launchpad) and technical.traders.com (Larry Williams Oops, Sperandeo 2B articles): HTTP 403 / Cloudflare. Those entries cite the nearest classical pattern instead and say so.
- minervini.com: the home and blog pages contained no definition text; VCP and progressive exposure have no primary quote.
- CMT Association: one relative-strength page used; its search returned nothing for Weinstein.

## How the bank uses it

Each bank item's `reveal_json.depth` is `{summary, sources}`: the entry's `summary` becomes the deeper paragraph under the reveal, and `sources` (name, url, quote, accessed) render as the citations beneath it. `conventions` and `mistakes` feed the lesson text where a unit teaches entry, stop and target. `conflicts` is for the owner only and never renders. Entries with `house_name: true` must keep the house wording in the reveal and may show the `nearest_standard` line as "closest textbook idea". An entry with zero sources renders no depth block.

## Counts

| Kind | Terms |
|---|---|
| setup | 28 |
| glossary | 27 (the 25 requested plus Red to Green, Wick Play and News Failure, which the brief named as house terms) |
| candle | 16 (the bias-check patterns) |
| bottom | 6 (the Model Book signposts) |
| total | 77 |

Sources per term: 3 sources on 20 terms, 2 on 15, 1 on 38, 0 on 4. Distinct source URLs: 70. Pages fetched this run: about 95 (Investopedia 28, Bulkowski 40, IBD 17, other 10), plus 24 web searches.

Terms with no reliable external definition (0 sources): Go Signal (house procedure, no external concept), VCP (Minervini; no policy site defines it and minervini.com had no text), Volatility Peak signpost, Breadth Washout signpost.

Terms with only a nearest-standard stand-in (house name, 1 source): Launchpad, Slingshot, 30-Minute Pivot, High Volume Edge / HVC, Gap Support, Red to Green, Wick Play, News Failure, ADR%, Oops Reversal (Larry Williams; originator text unreachable), Progressive exposure (Minervini; IBD exposure ladder stands in), Stage 2 (Weinstein; Investopedia uptrend and moving-average pages stand in).

## Not yet covered

- StockCharts ChartSchool quotes for every term (site unreachable).
- The full IBD article text behind each paywalled lead paragraph: flat base depth and length rules, IPO base rules, follow-through day percent and day-count rules, the 5 percent buy zone and 7 to 8 percent sell rule, climax-top rules.
- Minervini's own wording for VCP and progressive exposure.
- Weinstein's Stage 2 from a policy source.
- Larry Williams's Oops and Sperandeo's 2B from their own or a magazine text.
- The remaining candle patterns in the catalog's "20 of 77 disagree" note that were not re-tested this run (only 16 pages were read).
- Verified dates for the 1990 and 1998 market lows and a fetched page for the April 2025 low.
