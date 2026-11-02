# MD-1 phrasings: ordinary price and daily-bars questions (owner: agent-md)

**Status:** Sprint 2, flags off. Rewritten for MD-1 v1.5 §4.7 (instrument and intent resolution), after agent-qa's
held-out set found confident wrong answers under the first version.

**Who reads it:**
- agent-lead and agent-sc, for the fast-path grammar.
- agent-qa, for the acceptance harness.

**What it is:** phrasings with the outcome each one must get. It is not a grammar: the parser may claim more than
this list, but it must handle every row exactly as written. The test suites read this table.

## 1. How a sentence is handled (summary of MD-1 §4.7)

1. **Intent, on the client.**
   - The pure parser (`capabilities/marketDataPhrases.js`) decides only what is asked: a current quote, a last
     close, an N-session change, a 52-week range, or nothing.
   - It records every non-grammar word as a **candidate**, exactly as typed: `cashtag` (`$nvda`), `upper` (`NVDA`)
     or `lower` (`nvda`).
   - It never decides what a word refers to.
2. **Instrument, on the server.**
   - Before any price is read, the candidates go to `instrument.resolve`, which checks them against UCT's canonical
     symbol index.
   - Only an exact US stock or ETF symbol typed `$X` or UPPERCASE is priced. Everything else gets a fixed sentence
     with no number and no substitute.
   - All or nothing.
3. **`null` means the model, as today.** Not claimed:
   - a time the parser cannot resolve without a clock: history, a weekday, a date, yesterday, this/last week,
     all-time, …;
   - a different request: why, news, options, futures, alerts, …;
   - `&`;
   - more than 5 candidates;
   - two candidates without `and` / `,` (unless all are `$`);
   - a sentence with no candidate.
4. **Session words never change the kind.** "premarket" asks for a quote, and the answer states the actual
   session.
5. **Typos.** A fixed list, for intent words only (pirce → price). Never for a symbol.

## 2. Outcomes

| outcome | when | what the member gets |
|---|---|---|
| `price` | quote intent, every candidate `symbol` | the §4.5 answer, naming each security: `NVDA (NVIDIA Corporation) $142.10 …` |
| `bars` | bars intent, the candidate `symbol` | the §4.6 answer, naming the security |
| `ask:SYM` | a candidate is `symbol_typed_lowercase` or `name_match` | `Did you mean SYM (Name)? Type the ticker in capitals, like SYM, and I'll get it.` |
| `limit` | a candidate is `non_equity` or `unknown` | `I can quote US-listed stocks and ETFs by ticker. <word> isn't one I can price here.` |
| `model` | the parser does not claim it | the normal path (a safe miss) |

**The reference index for this table:** a standard index where the usual large caps exist as stocks or ETFs.
- `SPX` is typed `index`.
- `BTC` is the Grayscale Bitcoin Mini Trust ETF.
- `GOLD` is Barrick Gold.
- Apple Inc. and Microsoft Corporation are the only exact name matches for "apple" and "microsoft".
- `nvdia` and `bitcoin` match nothing.

## 3. The phrasings

**Candidates** are the words as typed, in the form `text:form`.

| # | phrasing (verbatim) | intent | candidates | outcome |
|---|---|---|---|---|
| P01 | what's NVDA trading at premarket? | quote | `NVDA:upper` | price |
| P02 | nvda price | quote | `nvda:lower` | ask:NVDA |
| P03 | $nvda | quote | `$nvda:cashtag` | price |
| P04 | where's tsla at | quote | `tsla:lower` | ask:TSLA |
| P05 | how's aapl doing today | quote | `aapl:lower` | ask:AAPL |
| P06 | NVDA and AMD premarket | quote | `NVDA:upper AMD:upper` | price |
| P07 | quotes for msft, googl, meta | quote | `msft:lower googl:lower meta:lower` | ask:MSFT |
| P08 | wats nvda tradin at | quote | `nvda:lower` | ask:NVDA |
| P09 | pirce of amd | quote | `amd:lower` | ask:AMD |
| P10 | what's NOW trading at | quote | `NOW:upper` | price |
| P11 | what's now trading at | none | — | model |
| P12 | $CAN price | quote | `$CAN:cashtag` | price |
| P13 | can you get me the price of amd | quote | `amd:lower` | ask:AMD |
| P14 | is it up after hours | none | — | model |
| P15 | NVDA after hours | quote | `NVDA:upper` | price |
| P16 | spy overnight | quote | `spy:lower` | ask:SPY |
| P17 | brk.b price | quote | `brk.b:lower` | ask:BRK-B |
| P18 | how did AAPL close yesterday | none | — | model |
| P19 | aapl close | bars.lastClose | `aapl:lower` | ask:AAPL |
| P20 | NVDA's 5-day change | bars.change n=5 | `NVDA:upper` | bars |
| P21 | how much is tsla up this week | none | — | model |
| P22 | AMD past 2 weeks | bars.change n=10 | `AMD:upper` | bars |
| P23 | NVDA 52-week high | bars.range52w | `NVDA:upper` | bars |
| P24 | aapl 52w low | bars.range52w | `aapl:lower` | ask:AAPL |
| P25 | what's LOW at | quote | `LOW:upper` | price |
| P26 | what's the low on nvda today | none | — | model |
| P27 | why is nvda up | none | — | model |
| P28 | nvda market cap | none | — | model |
| P29 | tell me when nvda hits 150 | none | — | model |
| P30 | nvda calls premarket | none | — | model |
| P31 | btc price | quote | `btc:lower` | ask:BTC |
| P32 | BTC price | quote | `BTC:upper` | price |
| P33 | what's the price of gold | quote | `gold:lower` | ask:GOLD |
| P34 | how's the s&p doing | none | — | model |
| P35 | price of apple and microsoft | quote | `apple:lower microsoft:lower` | ask:AAPL |
| P36 | nvdia price | quote | `nvdia:lower` | limit |
| P37 | SPX price | quote | `SPX:upper` | limit |
| P38 | nvda price history | none | — | model |
| P39 | nvda close on friday | none | — | model |
| P40 | $nvda $amd $tsla | quote | `$nvda:cashtag $amd:cashtag $tsla:cashtag` | price |
| P41 | NVDA and nvdia price | quote | `NVDA:upper nvdia:lower` | limit |
| P42 | WHAT'S NVDA AT | quote | `nvda:lower` | ask:NVDA |

**Notes on the rows:**
- **P35 and P41 (all or nothing):** one unresolved word blocks the whole compound. Nothing is priced, and the
  first problem by precedence is named.
- **P42 (an all-caps sentence):** when the whole sentence is in capitals, capitals carry no evidence, so every
  candidate counts as lowercase.

## 4. Answer obligations (`price` and `bars` rows)

These follow from MD-1 §4.5–§4.7 and agent-qa's freshness corpus.

1. **The security is named** from the symbol index, beside its ticker.
2. **Required fields.** The price, change ($ and %), session label, as-of time (ET, with the date when it is not
   today) and freshness are all present.
3. **"Live".** The words "live", "now" or "right now" appear only when the read is live and not stale.
4. **Closed market.** Overnight, weekends and holidays read "Market closed (…): last close $X (date)".
5. **Stale and partial reads** say so, plainly, in the sentence that carries the price.
6. **No price.** Unavailable, refused, `ask` and `limit` answers state no number at all.
7. **Model-visible output.** Only the text and labelled figures leave the capability, never an envelope.
8. **Activation.** Unless `data_kinds` includes `instrument.resolve` and the capability's own kinds, price
   questions keep today's stock.profile path, byte for byte.
