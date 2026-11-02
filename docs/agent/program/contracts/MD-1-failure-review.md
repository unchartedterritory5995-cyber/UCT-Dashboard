# MD-1 failure review: where the Agent understands a market-data question but does not deliver (owner: agent-md)

**Status:** read-only review, Sprint 2. It fixes nothing by itself.

**Sources:**
- agent-qa's quote findings (F-19, F-20, F-23, O-1) and its held-out set (`quote-heldout.json`, H01–H44);
- my own tests and measurements;
- MD-1 §4.5–§4.7.

**"Now"** means the state after #664 (MD-1 §4.7), unless a row says otherwise. The categories are the owner's
seven, verbatim.

**How to read the columns:**
- **Expected?** says whether the behaviour is intended, or a defect.
- **Smallest safe improvement** is the least change that would help without widening what can execute. Nothing
  here is approved work.

## Refusals and misses, by kind

| kind | examples (detail below) |
|---|---|
| **Legitimate safety refusal or limit**, keep | isolated kinds refused for research (5.2); the turn's read budget used up (5.1); an index or crypto word getting the stated limit (3.3); "Did you mean NVDA?" for a lowercase or company-name word (1.5); a cold symbol index (6.4) |
| **Unnecessary refusal or miss**, improve | "amd vs nvda price" goes to the model (4.4); "how much is a share of apple" goes to the model (1.4); the same lowercase ticker is asked about again in one conversation (7.2); a vague budget-refusal sentence (5.1) |
| **Technical failure** | wall-clock trading day (F-19, 6.1); a note with a number echoed to the member (F-20, 4.3); a half-day completed session skipped 13:00–16:00 (F-23, 6.2); half-day extended hours (O-1, 6.3); news ingest-health cost (6.5) |

## 1. Natural-language interpretation failures

| # | user asked | Agent understood | capability (selected → should be) | where it stopped | expected? | smallest safe improvement |
|---|---|---|---|---|---|---|
| 1.1 | "btc price" (H26) | **before #664:** a quote of ticker BTC, the Grayscale ETF | stock.quote → an ask | it **executed** a wrong-instrument price at 0 model calls | no, defect | **done in #664:** a lowercase word is never assumed to be a symbol; the server classifies it from the index, and the member is asked "Did you mean BTC (Grayscale Bitcoin Mini Trust)?" |
| 1.2 | "how's the s&p doing" (H37) | **before:** tickers S and P | stock.quote → the model | executed a two-symbol quote | no, defect | **done:** `&` anywhere means the sentence is not claimed |
| 1.3 | "nvda close on friday" (H40), "nvda price history" (H19) | **before:** the latest close / today's quote | stock.dailyBars / stock.quote → the model | answered a different time than the one asked | no, defect | **done:** a time the parser cannot resolve without a clock vetoes the claim (§4.7.1) |
| 1.4 | "how much is a share of apple" (H04) | now: no price intent (no price word) | none → stock.quote, then an ask for AAPL | the model takes it (a safe miss) | yes, conservative | add "how much is", "share of" and "worth" to the quote intent grammar. Resolution still asks before any price |
| 1.5 | "what's the price of gold" (H28) | now: a quote of the candidate `gold` | stock.quote → an ask (or the model) | it asks "Did you mean GOLD (Barrick Gold Corporation)?" | yes, the legitimate ask | none needed. The answer never prices gold the commodity, because no kind can (see 3.3) |

## 2. Incorrect capability discovery or routing

| # | user asked | Agent understood | capability | where it stopped | expected? | smallest safe improvement |
|---|---|---|---|---|---|---|
| 2.1 | any price question while the gateway is dark | a price question | stock.profile (today's path) | it answers, with a price from `/api/live-prices` | yes, agent-lead decision (flags-off byte identity) | **flag:** that route can run the alert checker. When quote is activated, price questions route to stock.quote; changing stock.profile is a separate, lead-owned decision |
| 2.2 | a sentence two capabilities could both claim | — | both → the model | `matchWhole` takes a single claimant only, so it goes to the model | yes, the safety design | none. The rival-claimant test pins it |
| 2.3 | "nvda" alone (H34) | no intent | none | the model | yes | none (a bare word is not a request) |

## 3. Missing capability coverage

| # | user asked | Agent understood | capability | where it stopped | expected? | smallest safe improvement |
|---|---|---|---|---|---|---|
| 3.1 | "what was aapl's high today" (H20), "tsla premarket price and volume" (H24) | the intraday high or volume | none: §4.5 answers price and change only | vetoed → the model | yes, not a v1 field | the `quote` rows **already carry** day open / high / low / volume. Add them to stock.quote's answer, with the same freshness wording. No new read |
| 3.2 | "pltr 1 month change" (H12), "how much is tsla up this week" (P21), "aapl all time high" (H21), "amzn last price before earnings" (H44) | a period or an anchor date | stock.dailyBars could, with `to` / sizing | vetoed → the model | yes, no clock in the parser | carry the relative period as a parameter, and let the server resolve it against `bars_fetch`'s calendar. `bars.daily` already supports `to`. "All-time" needs more than 500 bars, so it stays out |
| 3.3 | "SPX price", "bitcoin price", "es futures" (H27) | an index, crypto or futures | none: no MD-1 kind prices them | the stated limit / the model | yes, out of scope | none for v1. A future `index.quote` kind would be a new data path, needing its own approval |
| 3.4 | multi-word company names ("bank of america price") | single-word candidates | stock.quote → an ask for BAC | each word resolves alone, so it fails closed (unknown / limit) | yes, safe | resolve one multi-word phrase as a single candidate, using the index's own name search. It still asks before pricing |

## 4. Argument extraction or validation failures

| # | user asked | Agent understood | capability | where it stopped | expected? | smallest safe improvement |
|---|---|---|---|---|---|---|
| 4.1 | "price of apple and microsoft" (H29) | **before:** APPLE only (MSFT dropped) | stock.quote | a partial, wrong set | no, defect | **done:** all or nothing; one unresolved word blocks the compound |
| 4.2 | "nvdia price" (H30) | **before:** ticker NVDIA | stock.quote | an attempted read of a non-symbol | no, defect | **done:** `unknown` gets the stated limit. A "did you mean" is offered only when the index gives a single clear candidate; it has no fuzzy search, so none is offered |
| 4.3 | a budget-refused read (agent-qa F-20) | the gateway's note was echoed | stock.quote | the answer stated "8 data reads" | no, defect | **done (#638):** fixed sentences keyed on status only |
| 4.4 | "amd vs nvda price" (H06) | two candidates without and / `,` | stock.quote | not claimed → the model | yes, conservative | accept "vs" / "versus" as a list separator. Each word still resolves |
| 4.5 | "brk.b" vs "BRK-B" | a share class | stock.quote | — | handled | none (the index canonicalises; tested) |

## 5. Permission or approval restrictions

| # | user asked | Agent understood | capability | where it stopped | expected? | smallest safe improvement |
|---|---|---|---|---|---|---|
| 5.1 | a 9th data read in one turn | right | any | gateway budget refusal: "…that request wasn't allowed for this question…" | the refusal is legitimate; the wording is vague | have the gateway return a refusal **code**, so the answer can say "this turn already used its data reads; ask again." That's a gateway (lead-owned) change, keeping the closed list |
| 5.2 | breadth or ratings for planning (research purpose) | right | breadth.current / ratings | refused (model-isolated; dormant by default) | yes, legitimate | none |
| 5.3 | any price question with `data_kinds` lacking a kind | right | not registered | today's path / the model | yes, the activation gate | none |

## 6. Execution or canonical API integration failures

| # | user asked | Agent understood | capability | where it stopped | expected? | smallest safe improvement |
|---|---|---|---|---|---|---|
| 6.1 | any quote at a frozen clock (agent-qa F-19) | right | stock.quote | session label from today's wall clock | no, defect (latent) | **done (#638):** every input comes from `now` |
| 6.2 | "AAPL close" on 2026-11-27, 13:00–16:00 ET (agent-qa F-23) | right | stock.dailyBars | `bars_fetch._last_closed_session_yyyymmdd` waits for 16:00, so the half day's completed session is skipped and the answer gives the day before | no, defect (dark) | **in my adapter:** treat the day as completed once `_session_close_minutes(day)` has passed. No change to bars_fetch. Queued after #664 |
| 6.3 | after-hours quotes on a half day (O-1) | right | stock.quote | after-hours ran to 20:00 | no, defect | **done (#638):** after-hours ends at 17:00 on a half day |
| 6.4 | a quote just after a web boot | right | stock.quote | a cold symbol index: "I can't check ticker symbols right now…" | yes, legitimate (fail closed) | none. The index loads from its disk snapshot within seconds |
| 6.5 | company news (`news.company`) | right | news.company | ingest-health check up to ~0.45 s per read at 1–2M rows (measured) | yes, a known limitation; kept dark | an O(1) `MAX(last_ok)` read from the news owner (routed by agent-lead) |
| 6.6 | a theme read before the overlay is warm | right | themes | `unavailable` ("warming"), 0 provider calls | yes, by design | none |

## 7. State synchronization, stale-state, or UI feedback failures

| # | user asked | Agent understood | capability | where it stopped | expected? | smallest safe improvement |
|---|---|---|---|---|---|---|
| 7.1 | the server goes dark while a tab is open | — | stock.quote stays registered | `match()` re-checks the gate; the answer falls back to stock.profile | handled | none (tested) |
| 7.2 | "nvda price" → "Did you mean NVDA…?", then later "nvda close" in the same conversation | right | stock.quote / stock.dailyBars | asked again: each turn resolves afresh | yes (ruling b: plain-text confirm in v1) | remember a symbol the member CONFIRMED (typed in capitals after an ask) for that conversation only, in client state. It is still resolved on every read |
| 7.3 | an extended-hours quote | right | stock.quote | — | handled | none. "Live, extended hours (thin trading)" within 15 min; otherwise the last print with its time |
| 7.4 | a quote whose row is priced from a close | right | stock.quote | — | handled | none (partial plus plain wording) |
