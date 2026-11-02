# MD-1 phrasings: ordinary price and daily-bars questions (owner: agent-md)

**Status:** draft for Sprint 2, flags off. It goes with MD-1 v1.4 (v1.5 adds the quote `session` field) and
with the `match(text)` export that `app/src/agent/capabilities/marketDataQuote.js` and `marketDataBars.js` will
provide.

**Who reads it:**
- agent-lead and agent-sc, for the fast-path grammar.
- agent-qa, for the acceptance harness.

**What it is:** a list of phrasings with the handling each one must get. It is not a grammar: the matcher may
accept more than this list, but it must handle every row exactly as written.

## 1. Rules the matcher follows

1. **Pure and fail-closed.**
   - `match(text)` returns `{action, params}` or `null`. It does no I/O and reads no clock.
   - `null` means "not mine, or not sure". The sentence then goes to the normal path (the model). The matcher
     never guesses.
2. **Ticker extraction.**
   - A token is a ticker when it is `$`-prefixed, or when it is 1–5 letters and an ordinary word does not claim
     it.
   - It is uppercased, and a leading `$` is removed (`$nvda` → `NVDA`).
   - Class shares keep their separator as typed (`BRK.B`, `BRK-B`). MD-1 validators accept both.
3. **Ambiguous tickers** (agent-lead rule): `CAN`, `ALL`, `NOW`, `LOW`, `IT`, `ON`, `A`, `ARE`, `SO`, `BE`, `GO`,
   `DO`, `FOR`, `ONE`, `REAL`, `OPEN`, `HAS`, `KEY`, `FAST`, `CAR`, `PLAY`, `SEE`, `TRUE`, `WELL`, `LOVE`, and any
   other English word that is also a symbol.
   - Such a word matches **only** when it is `$`-prefixed, or written in UPPERCASE inside a price context
     ("what's NOW trading at").
   - Lowercase `now` / `low` / `all` / `it` / `on` is always a plain word.
   - When in doubt, return `null`.
4. **Price context words:**
   - Price words: price, trading at, quote, at, worth (as "what's X at"), doing, up, down, change, move.
   - Session words: premarket / pre-market / pre mkt / pm, after hours / after-hours / ah / postmarket,
     overnight.
   - Bars words: close / closed, high, low (only as "52-week low" / "year low"), N-day / N-week change.
5. **Session words never change the kind.**
   - "premarket" asks for a `quote`. The ANSWER states the actual session from the read's `session` field.
   - If the user asks "premarket" during the regular session, the answer says it is the regular session. It
     never pretends to be a premarket price.
6. **Typos.** Only the small fixed list in §3 is corrected. Anything else returns `null`; no fuzzy matching.
7. **Not price questions → `null`.** Examples: "why is NVDA up" (research), news, fundamentals (market cap,
   P/E: stock.profile), options/flow/dark pool (out of scope), and alerts ("tell me when NVDA hits 150").
8. **Limits.**
   - `quote` takes 1 symbol; `quotes` takes up to 50.
   - `bars.daily` takes 1 symbol and at most 500 bars.
   - A compound question with more than 5 tickers returns `null` (it is likely a list or a screen).

## 2. Actions

| action | MD-1 read | answer |
|---|---|---|
| `quote.one` | `quote {symbol}` | price, change $ and %, session label, as-of (ET), freshness; stale/partial said plainly |
| `quote.many` | `quotes {symbols}` | one line per symbol, same fields; one read |
| `bars.lastClose` | `bars.daily {symbol, bars: 2}` | last completed session's close and its change vs the prior close |
| `bars.change` | `bars.daily {symbol, bars: n+1}` | close-to-close % change over the last `n` completed sessions |
| `bars.range52w` | `bars.daily {symbol, bars: 252}` | 52-week high/low from completed daily bars (highs/lows), with the dates |

- **What `match()` returns.** The action column is the parser's intent. `match()` in `marketDataQuote.js`
  returns the capability, `{action: 'stock.quote', params: {symbols: [...]}}`, for both `quote.one` (one symbol)
  and `quote.many`. The `bars.*` intents are returned by `marketDataBars.js` (PR C). The parser shared by both
  files is `marketDataPhrases.js`.
- **Completed sessions only** for every `bars.*` answer; today's partial session never counts.
- **Weeks** convert at 5 sessions per week, so "past week" = 5.
- **Not enough sessions:** if `bars.daily` returns fewer sessions than asked, the answer says how many it
  covered and does not extrapolate.

## 3. The phrasings

**Handling column:**
- **fast** = deterministic, zero model turns, the output as listed.
- **model** = `null`; the sentence goes to the model.
- **clarify** = `null` in v1. A future clarify path may take it.

| # | phrasing (verbatim) | handling | action → params | why / note |
|---|---|---|---|---|
| P01 | what's NVDA trading at premarket? | fast | `quote.one` → `{symbol: NVDA}` | the Sprint 2 target sentence; the answer states the real session |
| P02 | nvda price | fast | `quote.one` → `NVDA` | lowercase ticker, not an ambiguous word |
| P03 | $nvda | fast | `quote.one` → `NVDA` | a bare cashtag is a quote request |
| P04 | where's tsla at | fast | `quote.one` → `TSLA` | "at" in price context |
| P05 | how's aapl doing today | fast | `quote.one` → `AAPL` | "doing today" = price and change |
| P06 | NVDA and AMD premarket | fast | `quote.many` → `[NVDA, AMD]` | compound; one `quotes` read, not two `quote` reads |
| P07 | quotes for msft, googl, meta | fast | `quote.many` → `[MSFT, GOOGL, META]` | comma list |
| P08 | wats nvda tradin at | fast | `quote.one` → `NVDA` | fixed typo list: wats→what's, tradin→trading |
| P09 | pirce of amd | fast | `quote.one` → `AMD` | fixed typo list: pirce→price |
| P10 | what's NOW trading at | fast | `quote.one` → `NOW` | ambiguous word in UPPERCASE plus price context |
| P11 | what's now trading at | model | `null` | lowercase "now" is a word, so there is no ticker |
| P12 | $CAN price | fast | `quote.one` → `CAN` | ambiguous word with `$` prefix |
| P13 | can you get me the price of amd | fast | `quote.one` → `AMD` | "can" here is a word, never ticker CAN |
| P14 | is it up after hours | model | `null` | "it" is a pronoun; follow-up resolution belongs to the conversation layer |
| P15 | NVDA after hours | fast | `quote.one` → `NVDA` | the answer states the real session |
| P16 | spy overnight | fast | `quote.one` → `SPY` | the answer reads "closed: last close $X (date)" unless a live session applies; never "live" overnight |
| P17 | brk.b price | fast | `quote.one` → `BRK.B` | class share keeps its separator |
| P18 | how did AAPL close yesterday | fast | `bars.lastClose` → `{symbol: AAPL, bars: 2}` | "yesterday" = the last completed session, even after a weekend |
| P19 | aapl close | fast | `bars.lastClose` → `AAPL` | |
| P20 | NVDA's 5-day change | fast | `bars.change` → `{symbol: NVDA, n: 5}` | |
| P21 | how much is tsla up this week | model | `null` | "this week" is calendar-ambiguous (week-to-date vs 5 sessions), so it is not guessed |
| P22 | amd past 2 weeks | fast | `bars.change` → `{symbol: AMD, n: 10}` | weeks × 5 sessions |
| P23 | NVDA 52-week high | fast | `bars.range52w` → `{symbol: NVDA, bars: 252}` | the answer gives both high and low, with dates |
| P24 | aapl 52w low | fast | `bars.range52w` → `AAPL` | "low" is safe only inside "52w low" / "year low" |
| P25 | what's LOW at | fast | `quote.one` → `LOW` | ambiguous word in UPPERCASE plus price context |
| P26 | what's the low on nvda today | model | `null` | intraday low is not a v1 field; "low" without "52-week" is not matched |
| P27 | why is nvda up | model | `null` | asking for a reason is research, not a price read |
| P28 | nvda market cap | model | `null` | belongs to stock.profile (fundamentals), not stock.quote |
| P29 | tell me when nvda hits 150 | model | `null` | an alert request; price reads never create or trigger alerts |
| P30 | nvda calls premarket | model | `null` | options are out of scope; "calls" vetoes the match |

## 4. Answer obligations (all `fast` rows)

These follow from MD-1 and QA's freshness corpus. Every answer must meet all of them:

1. **Required fields.** The price, change ($ and %), session label, as-of time (ET, with the date when it is not
   today), and freshness are all present.
2. **"Live".** The words "live", "now" or "right now" may appear only when `freshness == "live"` and `stale` is
   false.
3. **Closed market.**
   - Overnight, weekends and holidays read "closed: last close $X (date)".
   - Extended hours past the 15-minute live window read as the last extended print, with its time.
4. **Stale reads.** A stale read says it is stale, in the sentence that carries the price.
5. **Partial reads.** A `partial` read names what is missing (the symbols with no quote, and rows priced from
   a close).
6. **Unavailable or refused reads.** These state no number at all and say the price is not available.
7. **Model-visible output.** Only the text and labelled figures leave the capability, never the envelope.
8. **Flags off.** With the data flag off, price questions keep today's stock.profile path, byte for byte.
