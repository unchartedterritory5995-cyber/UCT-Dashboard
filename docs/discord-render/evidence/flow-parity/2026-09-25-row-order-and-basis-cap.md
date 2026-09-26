# `/flow` page-derived card: row order and the basis cap (2026-09-25, after the close)

Measured in the production flow-worker pod and through production, 19:00–20:30 CT, on
`1cccade38`. Every number below comes from a probe run in this session; the scripts were
one-off and are described inline.

## 1. The end-to-end run that prompted this (`1cccade38`, card vs the page's own product, 9/25)

Cold is about 4 minutes after a flow-worker boot; warm is about 12 minutes later.

| name | cold card | warm card | page | verdict |
|---|---|---|---|---|
| RKLB, COIN, GME, IWM | basis complete | same | same | EXACT |
| ASTS | basis 45 sessions, `complete=False` | same | same | EXACT (its older sessions carry nothing that moves 9/25) |
| HOOD, SOFI, MSTR, CRWV | basis 33–55 sessions, `complete=False` | the SAME truncated product | differs by $13K–$146K | same direction |
| DELL | basis 14 sessions | the SAME, served warm | BULL $3.54M / $1.19M vs card $7.56M / $1.24M | same direction |
| SMH | basis complete (140) | same | $2,208,183 bull vs card $2,129,183 | same direction |
| **AMD** | basis 37 | same | **BEAR** $948K / $1.53M vs card **BULL** $8.25M / $2.69M | **DIFFERS** |

Three separate defects were found under this table:

## 2. Row order (SMH's residual on a complete basis)

`processFlowData`'s ML/ volume match (`app/src/pages/optionsFlow/flowCompute.js`, the
`mlMatched` block) removes the FIRST unmatched non-ML print with the same
symbol/CP/strike/expiry/volume. The key has no date, so which print is removed depends on the
order the rows arrive in.

The page's Search product streams one symbol with no date filter. Measured in the pod
(`sha256` of the CSV bytes, first 16 hex):

| symbol | page stream (no filter) | `ORDER BY CreatedDate, rowid` | card basis, chronological | card basis, `sorted()` dates |
|---|---|---|---|---|
| SMH (140 sessions, 6.88 MB) | `ae12e6eb4e173815` | `ae12e6eb4e173815` | `490efd34a0b67798` | `ae12e6eb4e173815` |
| DELL (152 sessions, 8.97 MB) | `ddc0cbcda3c1a7d1` | `ddc0cbcda3c1a7d1` | `cd673e8d4243a0d4` | `ddc0cbcda3c1a7d1` |
| AMD (181 sessions, 30.8 MB) | `91344cc0411cfa0e` | `91344cc0411cfa0e` | `854bbcb53818724f` | `91344cc0411cfa0e` |

Plan for both the unfiltered and the explicit-order query: `SEARCH flow USING INDEX
idx_flow_symbol_created (Symbol=?)`, no temp B-tree. So the page's order was always
CreatedDate as TEXT, then rowid. That is not chronological: '10/1/2026' sorts before
'9/30/2026'. The card reassembled chronologically: same bytes, different order.

Effect on AMD 9/25, same rows, page bundle run in the pod:

| basis | order | 9/25 net | bull | bear | contracts |
|---|---|---|---|---|---|
| full history (224,505 rows) | store (= the page) | BEAR | 948,000 | 1,530,486 | 7 |
| full history | chronological | BEAR | 948,000 | 1,747,710 | 8 |

**Fix:** `flow_db.store_date_order()` defines the order once. Both symbol streams now state it
(`ORDER BY CreatedDate, rowid` and `ORDER BY rowid` per date, same plans, byte-identical
output). The card's basis read reassembles in it. A complete basis is now byte-identical to the
page's input.

## 3. The 150K row cap (AMD's wrong direction)

Same bundle and same day, store order throughout:

| basis | rows | 9/25 net | bull | bear | node time |
|---|---|---|---|---|---|
| full, 181 sessions | 224,505 | **BEAR** | 948,000 | 1,530,486 | 15.2 s |
| newest 37 (the 150K cap) | 143,688 | **BULL** | 9,202,765 | 2,685,598 | 6.8 s |
| newest 60 | 220,478 | BEAR | 948,000 | 1,685,186 | 13.8 s |
| newest 90 | 222,749 | BEAR | 948,000 | 1,685,186 | 20.2 s |
| newest 120 | 223,870 | BEAR | 948,000 | 1,530,486 | 25.0 s |

A partial basis can flip the day. Sessions 38–60 carry 77K rows, and the contract-level totals
in them decide today's direction.

Rows per symbol, top 25, whole store (4.0 s covering scan):

SPXW 1262K · SPY 956K · QQQ 791K · MU 609K · SPX 549K · SNDK 452K · NVDA 386K · TSLA 377K ·
META 238K · AMD 224K · AMZN 196K · AAPL 170K · SPCX 155K · MSFT 150K · INTC 120K · NDXP 97K ·
GOOGL 90K · PLTR 86K · AVGO 80K · SOXL 80K · IWM 77K · NBIS 76K · MSTR 72K · ORCL 72K · GLD 66K

14 names are over 150K rows and 8 are over 250K.

Production end-to-end basis builds (member session through web, cold cache, versions stable after
the close) with a 400K cap:

| name | rows | sessions | complete | seconds |
|---|---|---|---|---|
| AMD | 224,505 | 181/181 | yes | 19.9 |
| PLTR | 86,775 | 181/181 | yes | 6.4 |
| MSTR | 72,448 | 179/179 | yes | 5.7 |
| CRWV | 43,630 | 174/174 | yes | 4.0 |
| HOOD | 34,294 | 176/176 | yes | 3.3 |
| SOFI | 19,073 | 181/181 | yes | 2.0 |
| SPY (indexes) | 348,968 | 19/142 | no | 27.3 |
| QQQ (indexes) | 392,781 | 26/142 | no | 22.2 |
| NVDA | 400K cap | — | declined: over the page's 48 MB budget | 7.3 |

**Fix:** `BASIS_ROWS` 150K → **250K**. META, AMD, AMZN, AAPL and MSFT now get their full history.
AMD, the slowest of them, is about 20 s end to end inside the job's 30 s budget.

## 4. Time-truncated products cached as if final (HOOD/SOFI/MSTR/CRWV/PLTR/DELL)

None of those names is near any cap (19K–87K rows). Their short bases in §1 were cold reads cut
off by the 12 s newest-first budget. They were then cached under
`(sym, src, version, "r150000")`. After the close the version only moves when the symbol trades,
so the truncated answer was served all night. A warm read takes 2–6 s and is complete.

**Fix:** a product whose read stopped on the time budget (`basis_cut: "time"`) is served for 60 s
(`FLOW_CARD_BASIS_PARTIAL_TTL_S`) and then rebuilt. A row-capped or complete product is cached as
before. The body now says which cut applied: `basis_cut` is `"time"`, `"rows"` or `null`.

## Rails

`tests/test_flow_card_from_page.py`:

- the text-order vs calendar fixture;
- per-date stream == unfiltered stream, byte for byte;
- full basis read == the page's own stream, with a control that the old chronological assembly
  differs;
- both queries state their order;
- a truncated read is marked and expires;
- a complete or row-capped read is cached.

Mutation-proved five ways, each red and each restored byte-exact:

- chronological reassembly;
- per-date stream in caller order;
- no ORDER BY on the unfiltered query;
- truncated read never marked;
- expiry never fires.

The ORDER BY mutation is caught only by the structural rail, because the test database's planner
happens to choose the same index. That is the reason the order is now stated instead of left to
the planner.
