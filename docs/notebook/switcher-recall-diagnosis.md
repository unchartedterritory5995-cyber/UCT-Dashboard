# Note switcher recall: why each labelled query missed (wave 10, follow-up F6)

Recorded BEFORE any code change (ruling R-RAW), on tree `3c2356270` (branch
`feat/notebook-w10-f6`, base `origin/feat/notebook-w10-l1c`), 2026-09-27.

Instrument: `python tools/notebook_search_recall.py` over `docs/notebook/search-recall-set.json`
(100 synthetic notes, 43 queries, k = 10).

| reader | recall@10 | MRR@10 | zero-recall queries |
|---|---:|---:|---:|
| search box (`list_and_count_notes`, sort=relevance) | 0.8837 | 0.8837 | 5 / 43 |
| switcher (`switcher_search`) | 0.4147 | 0.4651 | 23 / 43 |

## Step 0: did lane 10A's candidate read narrow what the switcher can find?

No. Measured three ways on the same labelled set, same process:

| switcher implementation | recall@10 | MRR@10 | queries whose top 10 differ from today's |
|---|---:|---:|---:|
| today (`f5f95e383`'s candidate read) | 0.4147 | 0.4651 | n/a |
| the frozen pre-wave-10 oracle (`tests/test_journal_two_switcher_equivalence.py::_reference_switcher_search`) | 0.4147 | 0.4651 | 0 / 43 |
| `notes.py` as it stood at `f5f95e383^`, loaded as a module | 0.4147 | 0.4651 | 0 / 43 |

The candidate read is a superset test and it holds on this set: every answer is identical.

## Step 1: every miss, and why

A "miss" is a relevant note absent from the switcher's first ten. The cause was classified by
reading where the query's words sit in the missed note (title / body / tags / ticker), and by
re-asking the switcher with `limit=50` to separate "never found" from "found but ranked out".
"Search box rank" is where the search box places the same note.

| query | kind | missed note (title) | cause | search box rank |
|---|---|---|---|---:|
| data center revenue | body phrase | NVDA earnings preview Q3 | title-only: every word is in the body only | 1 |
| CUDA moat | rare body term | Nvidia long thesis | title-only: body only | 1 |
| MI300 | rare token | AMD earnings preview | title-only: body only | 1 |
| volume dried up on the pullback | body phrase | VCP setup checklist | title-only: some words only in the body | 1 |
| never widen a stop | body phrase | Stop loss discipline rules | title-only: some words only in the body | 1 |
| dot plot | body phrase | FOMC minutes reaction | title-only: body only | 1 |
| core inflation | body phrase | CPI print prep | title-only: body only | 1 |
| breakout | title and body word, several | Earnings gap up plan CRM | title-only: body only | 3 |
| breako | prefix while typing | Earnings gap up plan CRM | title-only: body only | 3 |
| opening range breakout | body phrase | Earnings gap up plan CRM | title-only: body only | 1 |
| rotation | word in title and body | Dividend stocks watch | title-only: body only | 2 |
| relative strength | body phrase | Sector rotation notes | title-only: body only | 1 |
| META | ticker named in title and body | Daily note 2026-09-25 | title-only: body only (ranked 2nd slot went to a title holding "meta" as a substring) | 2 |
| ad pricing | body phrase | META long thesis | title-only: body only | 1 |
| 200 day average | number phrase | AAPL short idea | title-only: body only | 1 |
| trim | stem across trim/trimmed | Daily note 2026-09-24 | title-only: the body holds "trimmed" | 2 |
| climax volume | body phrase | When I trim a winner | title-only: body only | 1 |
| prior day high | body phrase | Pre-market routine | title-only: body only | 1 |
| breadth divergence | body phrase | Market breadth dashboard read | title-only: some words only in the body | 1 |
| puts hedge | words from title and body | Options hedge plan | title-only: some words only in the body | 1 |
| revenge trading | body phrase | Trading psychology notes | title-only: some words only in the body | 1 |
| inventory draw | body phrase | Crude oil inventory note | title-only: some words only in the body | 1 |
| net interest income | body phrase | Bank earnings season | title-only: body only | 1 |
| patience paid off | body phrase | Daily note 2026-09-25 | title-only: body only | 1 |
| contractions shallower | body words | VCP setup checklist | title-only: body only | 1 |
| graphics chip maker moat | paraphrase | Nvidia long thesis | paraphrase: no lexical signal | miss |
| rules for cutting losses | paraphrase | Stop loss discipline rules | paraphrase: no lexical signal | miss |
| interest rate decision | paraphrase | FOMC minutes reaction | paraphrase: no lexical signal | miss |

## Counts by cause (28 missed note-query pairs)

| cause from the brief's list | pairs |
|---|---:|
| title-only matching (the words, or some of them, are only in the body) | 25 |
| paraphrase, which the search box misses too (no lexical reader can find it) | 3 |
| a prefix-only match | 0 (the one prefix query, "breako", finds both titles; its miss is a body-only note) |
| candidate pre-filtering (10A's `f5f95e383`) | 0 (Step 0) |
| no fuzzy or typo tolerance | 0 (the switcher scores 1.0 on both typo queries, where the search box scores 0) |
| no tag / ticker signal on its own | 0 (every ticker / cashtag query finds its title note; the misses are body mentions) |
| ordering | 0 (no missed note is in the switcher's `limit=50` answer) |
| the limit | 0 (every miss was an answer shorter than ten rows) |

Every one of the 25 title-only misses is a note the search box ranks in its top 3, and in every
one the switcher returned fewer than ten rows, so there was room on the page. That is the fix the
brief ranks second: a ranked fallback from the search box's own relevance pass, below every title
match, when title matching leaves room.
