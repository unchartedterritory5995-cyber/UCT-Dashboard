# COV-04 blackline heading coverage: before

Measured 2026-10-01 21:14:16 Central Daylight Time with `tools/blackline_coverage.py` at commit `ee17bc1652`.
42 tickers in 8 cohorts. SEC requests: 112 over the network, 0 from the scratch cache.

Found = located in BOTH filings of the pair. `unread` tickers never reached the extractor and are outside the denominator; they are listed by name.

## 10-K

| Section | n | found | not_found | parse_error | found rate |
|---|---|---|---|---|---|
| risk_factors | 35 | 33 | 2 | 0 | 94.3% |
| mdna | 35 | 33 | 2 | 0 | 94.3% |

Unread (7): XOM, JPM, BAC, WFC, C, GS, EQR

| Ticker | Cohort | risk_factors | mdna |
|---|---|---|---|
| AAPL | megacap | found 115->106 | found 131->135 |
| MSFT | megacap | found 149->169 | found 508->608 |
| AMZN | megacap | found 149->148 | found 211->184 |
| GOOGL | megacap | found 186->187 | found 395->359 |
| META | megacap | found 354->354 | found 278->272 |
| NVDA | megacap | found 222->235 | found 203->194 |
| BRK-B | megacap | found 44->46 | found 1603->1554 |
| XOM | megacap | unread | unread |
| JNJ | megacap | found 77->83 | found 426->421 |
| WMT | megacap | found 121->115 | found 314->307 |
| JPM | bank | unread | unread |
| BAC | bank | unread | unread |
| WFC | bank | unread | unread |
| C | bank | unread | unread |
| GS | bank | unread | unread |
| USB | bank | found 1->1 | found 1->1 |
| O | reit | found 181->174 | found 461->496 |
| PLD | reit | found 170->176 | found 1013->964 |
| AMT | reit | found 122->145 | found 672->573 |
| SPG | reit | found 202->206 | found 1394->1379 |
| EQR | reit | unread | unread |
| VRTX | biotech | found 395->672 | found 341->912 |
| REGN | biotech | found 321->329 | found 330->342 |
| MRNA | biotech | found 446->440 | found 262->260 |
| ALNY | biotech | found 435->452 | found 210->211 |
| SRPT | biotech | found 733->769 | found 811->882 |
| PLUG | small_cap | found 352->402 | found 1648->1715 |
| BOOT | small_cap | found 257->273 | found 611->622 |
| SHAK | small_cap | found 349->325 | found 396->411 |
| AAON | small_cap | found 60->68 | found 248->261 |
| CALM | small_cap | not_found (newer/older) | not_found (newer) |
| ACN | foreign_10k_filer | found 161->160 | found 297->297 |
| MDT | foreign_10k_filer | found 157->154 | found 388->368 |
| LIN | foreign_10k_filer | found 71->74 | found 525->530 |
| CB | foreign_10k_filer | found 126->123 | found 1133->1078 |
| RCL | foreign_10k_filer | found 112->116 | found 344->335 |
| CAVA | recent_ipo | found 291->285 | found 312->263 |
| KVUE | recent_ipo | found 318->378 | found 339->321 |
| CART | recent_ipo | found 428->420 | found 534->944 |
| RDDT | recent_ipo | found 333->332 | found 299->281 |
| ALAB | recent_ipo | found 343->350 | found 251->236 |
| GE | cross_reference_index | not_found (newer/older) | not_found (newer/older) |

### Reasons

- **XOM** unread: 0 original 10-K in the recent block
- **JPM** unread: 1 original 10-K in the recent block
- **BAC** unread: 1 original 10-K in the recent block
- **WFC** unread: 1 original 10-K in the recent block
- **C** unread: 1 original 10-K in the recent block
- **GS** unread: 1 original 10-K in the recent block
- **EQR** unread: no CIK for this ticker in SEC's company_tickers.json
- **CALM** risk_factors newer (0001562762-26-000080): not_found: 'Item 1A. Risk Factors' heading found but no following item heading ends it
- **CALM** risk_factors older (0001562762-25-000170): not_found: 'Item 1A. Risk Factors' heading found but no following item heading ends it
- **CALM** mdna newer (0001562762-26-000080): not_found: no 'Item 7. Management's Discussion and Analysis' heading in the document
- **GE** risk_factors newer (0000040545-26-000008): not_found: 'Item 1A. Risk Factors' located but has no text
- **GE** risk_factors older (0000040545-25-000015): not_found: 'Item 1A. Risk Factors' located but has no text
- **GE** mdna newer (0000040545-26-000008): not_found: 'Item 7. Management's Discussion and Analysis' located but has no text
- **GE** mdna older (0000040545-25-000015): not_found: 'Item 7. Management's Discussion and Analysis' located but has no text
