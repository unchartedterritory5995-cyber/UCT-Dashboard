# COV-04 blackline heading coverage: after

Measured 2026-10-01 22:01:07 Central Daylight Time with `tools/blackline_coverage.py` at commit `703e93f599`.
42 tickers in 8 cohorts. SEC requests: 0 over the network, 212 from the scratch cache.

Found = located in BOTH filings of the pair. `unread` tickers never reached the extractor and are outside the denominator; they are listed by name.

## 10-K

| Section | n (pairs read) | found | of which both sides only refer back | omitted by both filings | not_found | parse_error | found rate | found+omitted rate | end-to-end (found / all tickers) | reflowed pairs |
|---|---|---|---|---|---|---|---|---|---|---|
| risk_factors | 40 | 39 | 2 | 0 | 1 | 0 | 97.5% | 97.5% | 39/42 = 92.9% | 2 |
| mdna | 40 | 39 | 3 | 0 | 1 | 0 | 97.5% | 97.5% | 39/42 = 92.9% | 2 |

Unread (2): XOM, EQR

| Ticker | Cohort | risk_factors | mdna |
|---|---|---|---|
| AAPL | megacap | found 115->106 | found 131->135 |
| MSFT | megacap | found 124->136 | found 461->557 |
| AMZN | megacap | found 143->143 | found 200->175 |
| GOOGL | megacap | found 182->183 | found 383->348 |
| META | megacap | found 334->336 | found 263->258 |
| NVDA | megacap | found 212->227 | found 202->194 |
| BRK-B | megacap | found 44->46 | found 1507->1475 |
| XOM | megacap | unread | unread |
| JNJ | megacap | found 74->83 | found 410->407 |
| WMT | megacap | found 109->106 | found 295->292 |
| JPM | bank | found 649->618 | found 1->1 (ref only) |
| BAC | bank | found 164->169 | found 2146->2173 |
| WFC | bank | found 1->1 (ref only) | found 1->1 (ref only) |
| C | bank | not_found (newer/older) | not_found (newer/older) |
| GS | bank | found 281->277 | found 2250->2263 |
| USB | bank | found 1->1 (ref only) | found 1->1 (ref only) |
| O | reit | found 174->170 | found 446->483 |
| PLD | reit | found 126->128 | found 861->825 |
| AMT | reit | found 112->137 | found 654->559 |
| SPG | reit | found 190->191 | found 648->630 |
| EQR | reit | unread | unread |
| VRTX | biotech | found 382->175 | found 339->143 |
| REGN | biotech | found 302->311 | found 317->327 |
| MRNA | biotech | found 434->439 | found 248->248 |
| ALNY | biotech | found 415->438 | found 200->204 |
| SRPT | biotech | found 504->533 | found 680->708 |
| PLUG | small_cap | found 183->205 | found 768->789 |
| BOOT | small_cap | found 242->256 | found 325->325 |
| SHAK | small_cap | found 345->321 | found 396->411 |
| AAON | small_cap | found 58->64 | found 243->253 |
| CALM | small_cap | found 117->137 | found 129->103 |
| ACN | foreign_10k_filer | found 123->123 | found 270->272 |
| MDT | foreign_10k_filer | found 142->145 | found 384->362 |
| LIN | foreign_10k_filer | found 70->71 | found 515->524 |
| CB | foreign_10k_filer | found 118->117 | found 1120->1067 |
| RCL | foreign_10k_filer | found 109->111 | found 334->323 |
| CAVA | recent_ipo | found 280->273 | found 309->261 |
| KVUE | recent_ipo | found 298->358 | found 332->314 |
| CART | recent_ipo | found 396->390 | found 516->921 |
| RDDT | recent_ipo | found 312->310 | found 283->265 |
| ALAB | recent_ipo | found 329->328 | found 237->223 |
| GE | cross_reference_index | found 28->27 | found 370->323 |

### Reasons

- **XOM** unread: 0 original 10-K in the newest index pages
- **C** risk_factors newer (0000831001-26-000011): not_found: no 'Item 1A. Risk Factors' heading in the document; a section title for it was found but no item heading ends it, and the next item title is 8461 of the filing's 10459 blocks later
- **C** risk_factors older (0000831001-25-000067): not_found: no 'Item 1A. Risk Factors' heading in the document; a section title for it was found but no item heading ends it, and the next item title is 8504 of the filing's 10583 blocks later
- **C** mdna newer (0000831001-26-000011): not_found: no 'Item 7. Management's Discussion and Analysis' heading in the document; a section title for it bounds no prose
- **C** mdna older (0000831001-25-000067): not_found: no 'Item 7. Management's Discussion and Analysis' heading in the document; a section title for it bounds no prose
- **EQR** unread: no CIK for this ticker in SEC's company_tickers.json

## 10-Q

| Section | n (pairs read) | found | of which both sides only refer back | omitted by both filings | not_found | parse_error | found rate | found+omitted rate | end-to-end (found / all tickers) | reflowed pairs |
|---|---|---|---|---|---|---|---|---|---|---|
| mdna | 40 | 37 | 0 | 0 | 3 | 0 | 92.5% | 92.5% | 37/42 = 88.1% | 2 |
| risk_factors | 40 | 34 | 21 | 4 | 2 | 0 | 85.0% | 95.0% | 34/42 = 81.0% | 1 |

Unread (2): XOM, EQR

| Ticker | Cohort | mdna | risk_factors |
|---|---|---|---|
| AAPL | megacap | found 122->115 | found 27->23 |
| MSFT | megacap | found 729->724 | found 127->129 |
| AMZN | megacap | found 167->179 | found 144->144 |
| GOOGL | megacap | found 306->318 | found 12->30 |
| META | megacap | found 226->230 | found 335->337 |
| NVDA | megacap | found 184->190 | found 67->48 |
| BRK-B | megacap | found 772->1231 | found 1->1 (ref only) |
| XOM | megacap | unread | unread |
| JNJ | megacap | found 301->503 | omitted (newer/older) |
| WMT | megacap | found 262->262 | found 1->1 (ref only) |
| JPM | bank | not_found (newer/older) | found 3->3 (ref only) |
| BAC | bank | found 1725->1857 | found 1->1 (ref only) |
| WFC | bank | not_found (newer/older) | found 1->1 (ref only) |
| C | bank | not_found (newer/older) | not_found (newer/older) |
| GS | bank | found 2157->2277 | omitted (newer/older) |
| USB | bank | found 2178->2553 | not_found (newer/older) |
| O | reit | found 603->1539 | found 1->2 (ref only) |
| PLD | reit | found 700->757 | found 1->1 (ref only) |
| AMT | reit | found 397->500 | found 1->1 (ref only) |
| SPG | reit | found 470->665 | found 1->1 (ref only) |
| EQR | reit | unread | unread |
| VRTX | biotech | found 106->115 | found 24->27 |
| REGN | biotech | found 594->648 | found 314->321 |
| MRNA | biotech | found 156->176 | found 1->1 (ref only) |
| ALNY | biotech | found 204->206 | found 445->443 |
| SRPT | biotech | found 658->1091 | found 492->497 |
| PLUG | small_cap | found 383->546 | found 4->7 |
| BOOT | small_cap | found 306->220 | found 1->1 (ref only) |
| SHAK | small_cap | found 395->444 | found 1->1 (ref only) |
| AAON | small_cap | found 224->284 | found 1->1 (ref only) |
| CALM | small_cap | found 123->96 | found 1->1 (ref only) |
| ACN | foreign_10k_filer | found 319->319 | found 1->1 (ref only) |
| MDT | foreign_10k_filer | found 422->371 | omitted (newer/older) |
| LIN | foreign_10k_filer | found 389->392 | found 1->1 (ref only) |
| CB | foreign_10k_filer | found 823->951 | found 1->1 (ref only) |
| RCL | foreign_10k_filer | found 246->301 | found 1->1 (ref only) |
| CAVA | recent_ipo | found 184->267 | found 1->1 (ref only) |
| KVUE | recent_ipo | found 217->355 | found 1->1 (ref only) |
| CART | recent_ipo | found 690->1015 | found 398->398 |
| RDDT | recent_ipo | found 259->265 | found 312->312 |
| ALAB | recent_ipo | found 165->182 | found 1->1 (ref only) |
| GE | cross_reference_index | found 231->247 | omitted (newer/older) |

### Reasons

- **XOM** unread: 1 original 10-Q in the newest index pages
- **JNJ** risk_factors newer (0000200406-26-000153): omitted: the filing has no 'Part II, Item 1A. Risk Factors' text: it goes straight to the next item, which a 10-Q may do when the risk factors in the last annual report have not materially changed
- **JNJ** risk_factors older (0000200406-26-000087): omitted: the filing has no 'Part II, Item 1A. Risk Factors' text: it goes straight to the next item, which a 10-Q may do when the risk factors in the last annual report have not materially changed
- **JPM** mdna newer (0001628280-26-054343): not_found: 'Part I, Item 2. Management's Discussion and Analysis' heading bounds only short lines (an index of where the section is, not the section); a section title for it bounds no prose
- **JPM** mdna older (0001628280-26-029344): not_found: 'Part I, Item 2. Management's Discussion and Analysis' heading bounds only short lines (an index of where the section is, not the section); a section title for it bounds no prose
- **WFC** mdna newer (0000072971-26-000302): not_found: 'Part I, Item 2. Management's Discussion and Analysis' heading bounds only short lines (an index of where the section is, not the section)
- **WFC** mdna older (0000072971-26-000217): not_found: 'Part I, Item 2. Management's Discussion and Analysis' heading bounds only short lines (an index of where the section is, not the section)
- **C** mdna newer (0000831001-26-000045): not_found: no 'Part I, Item 2. Management's Discussion and Analysis' heading in the document; a section title for it bounds no prose
- **C** mdna older (0000831001-26-000019): not_found: no 'Part I, Item 2. Management's Discussion and Analysis' heading in the document; a section title for it bounds no prose
- **C** risk_factors newer (0000831001-26-000045): not_found: no 'Part II, Item 1A. Risk Factors' heading in the document
- **C** risk_factors older (0000831001-26-000019): not_found: no 'Part II, Item 1A. Risk Factors' heading in the document
- **GS** risk_factors newer (0000886982-26-000297): omitted: the filing has no 'Part II, Item 1A. Risk Factors' text: it goes straight to the next item, which a 10-Q may do when the risk factors in the last annual report have not materially changed
- **GS** risk_factors older (0000886982-26-000118): omitted: the filing has no 'Part II, Item 1A. Risk Factors' text: it goes straight to the next item, which a 10-Q may do when the risk factors in the last annual report have not materially changed
- **USB** risk_factors newer (0000036104-26-000044): not_found: no 'Part II, Item 1A. Risk Factors' heading in the document
- **USB** risk_factors older (0000036104-26-000024): not_found: no 'Part II, Item 1A. Risk Factors' heading in the document
- **EQR** unread: no CIK for this ticker in SEC's company_tickers.json
- **MDT** risk_factors newer (0001628280-26-060473): omitted: the filing has no 'Part II, Item 1A. Risk Factors' text: it goes straight to the next item, which a 10-Q may do when the risk factors in the last annual report have not materially changed
- **MDT** risk_factors older (0001628280-26-011107): omitted: the filing has no 'Part II, Item 1A. Risk Factors' text: it goes straight to the next item, which a 10-Q may do when the risk factors in the last annual report have not materially changed
- **GE** risk_factors newer (0000040545-26-000049): omitted: the filing has no 'Part II, Item 1A. Risk Factors' text: it marks it 'Not applicable', which a 10-Q may do when the risk factors in the last annual report have not materially changed
- **GE** risk_factors older (0000040545-26-000027): omitted: the filing has no 'Part II, Item 1A. Risk Factors' text: it marks it 'Not applicable', which a 10-Q may do when the risk factors in the last annual report have not materially changed
