---
id: E-05
title: Data and infrastructure cost model — six member scenarios, labeled assumptions
role: Cost modeller (Group E) — data vendors, exchange fees, Railway, storage/R2, streaming, observability
wave: 2
group: E
category: licensing
scope: uct-dashboard (terminal-research worktree, 5 Railway services) as inherited by TERMINAL-NEXT; vendor public price pages read 2026-09-02
confidence: 🟡 medium overall (public list prices 🟢 where fetched today; the plan UCT actually holds 🔴; Railway resource sizes 🔴; every per-member take-rate is an ASSUMPTION)
evidence_ceiling: "No invoice, vendor console, Railway usage page, order form or contract was seen. Nothing in this file is a measured spend; every dollar is a public list price (dated) or a labeled assumption. Two owner facts (OI-03(a) Massive tier; OI-10 spend baseline) and one vendor reply (Massive options/business quote incl. whether OPRA and SIP fees are absorbed) would convert most of the fixed block from assumption to fact."
sources: 02-data-providers/provider-ledger.md (F-03b), 09-security-licensing-cost/data-use-classification.md (E-02), realtime-and-exchange-classification.md (E-03), vendor-terms-evidence.md (E-01), licensing-register.md (F-04 §1C), 02-data-providers/railway-flag-state.md (ORCH-RAILWAY-01), 01-existing-system/database-and-infrastructure.md (D-04), 07-technical-architecture/current-performance-and-realtime.md (D-05), 08-ai/existing-ai-systems.md (D-12 §5), 03-competitive-research/{unusual-whales,koyfin,tradingview,benzinga-pro}/dossier.md §L, 00-program-control/OWNER_INPUTS_REQUESTED.md, charter/OWNER_SEED_FACTS.md §5–6; public pages fetched 2026-09-02: massive.com/pricing, massive.com/business, massive.com/options, railway.com/pricing, developers.cloudflare.com/r2/pricing, finviz.com/elite, snaptrade.com/pricing, resend.com/pricing, sentry.io/pricing, stripe.com/pricing, twitterapi.io/pricing, cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf, ctaplan.com/pricing; app/src/pages/Pricing.jsx:6 (list price)
uct_relevance: high
status: draft
date: 2026-09-02
---

# E-05 — Data and infrastructure cost model (six scenarios)

**Vocabulary.** TERMINAL-CURRENT = the `/calendar` surface display-named "UCT Terminal". TERMINAL-NEXT = the product this program designs. UT is the parent brand; UCT Intelligence is the product.

**How to read every number in this file.** Each figure carries one of four labels: **PUBLIC (date)** = a vendor list price read from a public page on the stated date (a fact about the page, not about UCT's contract); **LEAF** = a figure carried from a named leaf report with its own label; **CLAIM** = a comment, doc or memory statement never confirmed by an artifact; **ASSUMPTION** = a modelling input with no source, stated so the owner can overwrite it. Nothing here is a measured spend (OI-10: the spend baseline is unknown). AI inference (Anthropic, OpenAI, Perplexity) is **E-06's model** and is deliberately excluded from every total below so the two files can be added, not double-counted.

**Member definition.** "Member" = an account entitled to TERMINAL-NEXT, paid or not. The paid fraction is unknown (OI-01); §3 shows break-even as a function of it. The internal-only scenario is modelled at 5 users (OI-02 default 2–5).

---

## 1. THE SCENARIO TABLE (Deliverable 1)

Four licensing branches, because the licensing leaves settled that the branch — not the member count — is the first-order driver:

* **S0 — Status quo stack** (individual-tier Massive + FMP Premium, as the ledger implies). Shown for reference only: E-02 §3.1 classes every member-facing surface **R** on this branch, and Massive's own page says *"for … customer-facing display, or 200+ users, you'll need a Business plan"* (PUBLIC 2026-09-02, per E-03 §3.1). Not available at ≥ 500 by the vendor's own gate.
* **A-lite — Massive Stocks Business, delayed price + live volume + live breadth (E-03 Part 5), options data NOT in TERMINAL-NEXT** (the existing `/live-massive` surface keeps its individual options plan pending the owner's tape decision). The floor.
* **A-full — A-lite + options served to members on a delayed/historical basis** (Massive options business product + OPRA redistribution floor if UCT is the vendor of record). No per-member exchange fees.
* **B — A-full + real-time single-symbol quotes and real-time options tape to members** (per-member exchange non-professional fees pass through).

Monthly USD, rounded. Railway, storage, email and broker-sync lines are common to all branches and scale as §2 describes. **AI excluded (E-06).**

| Line (label) | S0 · 5 | S0 · 100 | A-lite · 5 | A-lite · 100 | A-lite · 500 | A-lite · 1,000 | A-lite · 5,000 | A-lite · 10,000 |
|---|---|---|---|---|---|---|---|---|
| Massive stocks plan (PUBLIC 09-02: Advanced $199 · Business $2,499) | 199 | 199 | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 |
| Massive options plan (PUBLIC 09-02: Options Advanced $199; ASSUMPTION that the live OPRA `T.*` stream needs the real-time individual tier today) | 199 | 199 | 199 | 199 | 199 | 199 | 199 | 199 |
| OPRA redistribution floor (PUBLIC 09-02 PDF: $1,500/mo, "current or delayed"; not applicable when options are not redistributed) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Fundamentals / estimates licence (S0: FMP Premium $49 PUBLIC per E-01 09-02; A/B: stand-in **$699** = Massive "Financials & Ratios, business use" PUBLIC 09-02 — an FMP DDLA quote is NOT DETERMINED and replaces this cell) | 49 | 49 | 699 | 699 | 699 | 699 | 699 | 699 |
| Finviz Elite (PUBLIC 09-02: $39.50/mo) | 40 | 40 | 40 | 40 | 40 | 40 | 40 | 40 |
| twitterapi.io (PUBLIC 09-02: $0.15/1K tweets; CLAIM forecast $13–22 + $10–20/mo) | 35 | 35 | 35 | 35 | 35 | 35 | 35 | 35 |
| Finnhub · AlphaVantage · yfinance · EW · RSS · CFTC · EDGAR (free tiers / public; retirement candidates) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Railway compute + volumes (ASSUMPTION build-up §2.6: ~$290 today; steps at the 300-concurrent-browser envelope) | 290 | 290 | 290 | 290 | 290 | 330 | 740 | 1,190 |
| Cloudflare R2 (PUBLIC 09-02: $0.015/GB-mo, egress free; ASSUMPTION ≤1 TB retained) | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 |
| Observability (Sentry dormant today; PUBLIC 09-02 Team $26 annual → Business $80 at 5k+) | 0 | 0 | 26 | 26 | 26 | 26 | 80 | 80 |
| SnapTrade broker mirror (PUBLIC 09-02: 5 accounts free, then **$2/connected user/mo**; ASSUMPTION 25 % of members connect) | 0 | 40 | 0 | 40 | 240 | 490 | 2,490 | 4,990 |
| Resend email (PUBLIC 09-02: 3,000/mo free → Pro $20 → Scale; ASSUMPTION 30 emails/member/mo) | 0 | 20 | 0 | 20 | 20 | 20 | 135 | 270 |
| Railway egress (PUBLIC 09-02: $0.05/GB; ASSUMPTION 0.5 GB/member/mo) | 0 | 3 | 0 | 3 | 13 | 25 | 125 | 250 |
| Per-member exchange fees (none on this branch) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL data + infra (ex-AI)** | **827** | **890** | **3,803** | **3,866** | **4,076** | **4,378** | **7,057** | **10,268** |
| **Per member** | 165 | 8.90 | 761 | 38.7 | 8.15 | 4.38 | 1.41 | 1.03 |

| Line (label) | A-full · 5 | A-full · 100 | A-full · 500 | A-full · 1,000 | A-full · 5,000 | A-full · 10,000 | B · 5 | B · 100 | B · 500 | B · 1,000 | B · 5,000 | B · 10,000 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Massive Stocks Business (PUBLIC 09-02) | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 | 2,499 |
| Massive options business product (**NOT DETERMINED** — no price on massive.com/business or /options 09-02; **ASSUMPTION placeholder $1,999** = the page's "Full Market" expansion price, used only to size the cell) | 1,999 | 1,999 | 1,999 | 1,999 | 1,999 | 1,999 | 1,999 | 1,999 | 1,999 | 1,999 | 1,999 | 1,999 |
| OPRA redistribution floor (PUBLIC 09-02 PDF $1,500; **U** whether Massive-as-vendor-of-record absorbs it — E-03 Part 6 Q2) | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 |
| Licensed fundamentals stand-in (PUBLIC 09-02 $699; FMP DDLA quote pending) | 699 | 699 | 699 | 699 | 699 | 699 | 699 | 699 | 699 | 699 | 699 | 699 |
| Finviz + twitterapi.io | 75 | 75 | 75 | 75 | 75 | 75 | 75 | 75 | 75 | 75 | 75 | 75 |
| Railway + R2 + observability (as A-lite) | 331 | 331 | 331 | 371 | 835 | 1,285 | 331 | 331 | 331 | 371 | 835 | 1,285 |
| SnapTrade + Resend + egress (as A-lite) | 0 | 63 | 273 | 535 | 2,750 | 5,510 | 0 | 63 | 273 | 535 | 2,750 | 5,510 |
| Real-time equity non-pro fees (LEAF E-03 §2.2: CTA A $1.00 + B $1.00; UTP Tape C **NOT DETERMINED**, ASSUMPTION $1.00 ⇒ $3.00/subscriber; counted on the 60 % of members ASSUMED to touch real-time data in a month) | 0 | 0 | 0 | 0 | 0 | 0 | 13† | 180 | 900 | 1,800 | 9,000 | 18,000 |
| Real-time options non-pro fees (PUBLIC 09-02 PDF: $1.25/nonpro/mo up to 75,000; same 60 % basis) | 0 | 0 | 0 | 0 | 0 | 0 | 0† | 75 | 375 | 750 | 3,750 | 7,500 |
| **TOTAL data + infra (ex-AI)** | **7,104** | **7,167** | **7,376** | **7,679** | **10,358** | **13,568** | **7,117** | **7,422** | **8,651** | **10,229** | **23,108** | **39,068** |
| **Per member** | 1,421 | 71.7 | 14.8 | 7.68 | 2.07 | 1.36 | 1,423 | 74.2 | 17.3 | 10.2 | 4.62 | 3.91 |

† Internal-only under B: the desk's 2–5 users are very likely **professional** subscribers under the plan definitions (E-03 §2.1; a trading business is a business purpose). Professional device rates are CTA A $45 + B $23 (LEAF E-03 §2.2, schedule effective 2015-01-01 per ctaplan.com/pricing 09-02) + OPRA $31.50/device (PUBLIC 09-02 PDF, effective 2018-01-01) ≈ **$100/device/mo**, i.e. ~$500/mo for five desk seats instead of the $13 shown. Row values for "5" therefore understate B by ~$490 if the desk is rated professional.

**Not in any total, shown for context:** Stripe 2.9 % + $0.30 per successful transaction (PUBLIC 09-02) = **$6.10 per paid member per month at the $200/mo list price** the app itself displays (`app/src/pages/Pricing.jsx:6`, `Landing.jsx:704,1318`, `Subscribe.jsx:71` — CLAIM about the intended price; conversion and discounts unknown, OI-01/OI-12). Server-side price alerting as CTA/OPRA **non-display** use — $2,000/mo per category on CTA Network A and again on OPRA (LEAF E-03 §4.4B; **U** whether a member-configured alert is display or non-display) — would add **+$4,000/mo fixed** to branch B and is carried as sensitivity S-4, not as a line. Zoom, YouTube, Discord, Substack, Whop, Buffer: distribution/commerce, not terminal data; NOT DETERMINED and excluded.

**What the table says in one sentence.** The fixed block — one Massive business contract plus whatever the options tape and fundamentals licences turn out to cost — is **$3.5k–7k/mo** and dominates every scenario below ~1,000 members; the per-member variable cost is **~$0.55/member/mo** on a delayed-price design and **~$3.10/member/mo** with real-time pass-through, and the first infrastructure step lands between 1,000 and 5,000 members when concurrent browsers exceed the single pod's 300-subscriber stream cap.

---

## 2. LINE-BY-LINE BUILD — sources, labels, and what scales

### 2.1 Current fixed vendor cost (the plans the ledger implies)

**OBSERVATION.** The provider ledger (F-03b §1B) records no measured spend for any vendor; it carries public list prices and CLAUDE.md forecasts. Re-read today:

| Vendor (ledger row) | Plan the ledger implies | Public price (label) | Evidence | Scales with members? |
|---|---|---|---|---|
| Massive REST/WS stocks (1–2) | Advanced (real-time, individual) — `polygon_options.py:5` comment "Polygon Advanced tier, $200/mo" (CLAIM) | **$199/mo** Advanced; Starter $29 / Developer $79 (15-min delayed); Basic free EOD (PUBLIC 2026-09-02, massive.com/pricing, "Individual use") | WebFetch this pass; E-01 §1a, E-03 §3.1 same day | Fixed until the vendor's own **200+ users** gate, then Business |
| Massive options (2–3) | The `T.*` wildcard OPRA WebSocket on flow-worker (`massive_ws_worker.py:74`, partner-owned) is a real-time full-tape consumption; only Options Advanced is real-time on the individual ladder | **$199/mo** Options Advanced; Developer $79 / Starter $29 delayed; Basic free (PUBLIC 2026-09-02, massive.com/options, "Individual use") | WebFetch this pass | Fixed (ASSUMPTION that the tape is on Advanced; the plan is NOT DETERMINED) |
| Massive flat files (3) | included in plan (CLAIM, ledger) | "Access via Flat Files, WebSockets, and API" on every options tier (PUBLIC 09-02) | WebFetch this pass | Fixed |
| FMP (4) | "Premium" (seed §6 VERIFY) | **$49/mo billed annually**, 750 calls/min, 50 GB/30 d (PUBLIC per E-01 §2 read 2026-09-02; **both FMP pricing URLs returned 403 to this pass**) | E-01 §2 | Fixed; bandwidth cap 50 GB/30 d is the only member-linked limit |
| Finviz Elite (5) | Elite | **$39.50/mo or $299.50/yr** (PUBLIC 2026-09-02) | WebFetch this pass; E-01 §3 | Fixed |
| Finnhub (6) | free tier (code tell `MAX_SSE_TICKERS = 50  # Finnhub free tier cap`) | $0 (NOT DETERMINED — pricing page is a JS shell, E-01 §6) | ledger | Fixed; retirement candidate |
| AlphaVantage (7) | free tier (25/day bucket in code) | $0; premium "$50/mo" (CLAIM, CLAUDE.md) | ledger | Fixed; retirement candidate |
| twitterapi.io (10) | pay-as-you-go | **$0.15 / 1K tweets, $0.18 / 1K users, min $0.00015/call, no minimum spend** (PUBLIC 2026-09-02); forecast **$13–22 + $10–20/mo** (CLAIM, CLAUDE.md) | WebFetch this pass; ledger | Scales with poll cadence and catalyst refreshes, **not** with members |
| SnapTrade (14) | pay-as-you-go | **5 connected accounts free; real-time $2 per connected user/mo; daily-data $1 + $0.05/manual sync** (PUBLIC 2026-09-02) | WebFetch this pass | **Scales with members who connect a broker** — already live (`BROKER_SYNC_ENABLED=1`, ORCH); today's connected count NOT DETERMINED |
| Resend (26) | NOT DETERMINED | Free 3,000/mo (100/day) · Pro $20 (50k) / $35 (100k) · Scale $90 (100k) → $1,150 (2.5M) · overage $0.90→$0.46 per 1k (PUBLIC 2026-09-02) | WebFetch this pass | **Scales with members** (digests, alerts, verification) |
| Bullflow (15), Unusual Whales (16), Polygon-direct (17) | keys present, no runtime evidence | NOT DETERMINED whether billed (OI-04). If `UW_API_KEY` is a paid API seat, the public ladder is $150/mo Basic · $375/mo Advanced (PUBLIC 2026-09-02, UW dossier §L) — an unaccounted line of $0–375 | ledger; UW dossier §L | Fixed |
| yfinance, EarningsWhispers, RSS, CFTC, SEC EDGAR, openinsider, Stocktwits, ForexFactory | none | $0 | ledger | — |
| Railway (33) · R2 (32) · Cloudflare (34) · chart-renderer (35) · Sentry (27, dormant) | see §2.6–2.8 | ASSUMPTION ~$290 + ~$15 + $0 + (in Railway) + $0 | this pass | Railway steps with concurrency; the rest fixed |

**Sum of the as-is stack, public list prices, ex-AI:** $199 + $199 + $49 + $39.50 + ~$35 + ~$290 + ~$15 ≈ **$830/mo** (range $650–1,200 depending on the Massive options plan, the UW key, Railway actuals). AI lanes (Anthropic, OpenAI, Perplexity ~$60–70 CLAIM) are E-06's.

**EVIDENCE.** Every cell names its page and date or its leaf section; the ledger's cost column (F-03b §1B) was the starting point and nothing in it was contradicted by today's pages except that the Massive individual ladder now lists **unlimited** API calls on paid tiers (the page today) where E-01 recorded per-minute limits for Basic only — consistent.

**INTERPRETATION.** The status quo is cheap because it sits on individual-use tiers whose terms forbid the product (E-02 §3.1). That is the whole reason the cost model has branches rather than a single column.

**RELEVANCE TO UCT.** The seed's escalation rule (B §34, seed §6) is *new* recurring spend above $250/mo, any contract regardless of amount, and any member-scaling cost regardless of amount. The as-is stack already contains one member-scaling line (SnapTrade) and one contract-shaped line (Massive) — neither is new, but TERMINAL-NEXT's first purchase in any branch trips all three.

**CONFIDENCE.** 🟢 on the public prices fetched today; 🟡 on which plan each key is on; 🔴 on the sum (no invoice). **EVIDENCE CEILING:** one month of vendor invoices (OI-10).

**RECOMMENDATION.** Before modelling further, have the owner paste the last Massive, FMP, Railway and SnapTrade invoices into OI-10; four numbers replace half of §2.1.

**OPEN QUESTION.** Is the OPRA tape today on Options Advanced ($199) or on a business options product already? The flow-worker's wildcard subscription is the one line whose *current* cost could be off by an order of magnitude.

### 2.2 Incremental data cost by class — real-time quotes per user (E-03's fee evidence)

**OBSERVATION.** Three fee stacks apply to a real-time single-symbol quote shown to a member, and each has a per-subscriber non-professional rate plus fixed vendor machinery:

| Plan | Non-pro per subscriber/mo | Professional per device/mo | Fixed redistribution | Delayed | Source (label) |
|---|---|---|---|---|---|
| CTA Network A (NYSE-listed) | **$1.00** | $45 (1–2 devices) … $19 (10k+) | **$1,000/mo** | delay ≥15 min + conspicuous notice; per-member delayed fee NOT DETERMINED (ASSUMPTION $0) | LEAF E-03 §2.2, from the Schedule of Market Data Charges; ctaplan.com/pricing (PUBLIC 2026-09-02) dates it **effective 1 Jan 2015** — the PDF itself was not re-parsed this pass |
| CTA Network B (NYSE American/regional) | **$1.00** | $23 | **$1,000/mo** | as A | same |
| UTP Tape C (Nasdaq-listed) | **NOT DETERMINED** — nasdaqtrader.com links a "UTP LEVEL 1 SERVICE FEES 1.2015" PDF that returned 404 this pass; utpplan.com/fees is a navigation shell | NOT DETERMINED | external delayed redistributor $250/yr + $250/mo (LEAF E-03 §2.3, secondary) | **free on a controlled product** with a prominent delay message; real-time **volume** alongside delayed price free (LEAF E-03 §2.3, primary) | E-03 §2.3; two fetches this pass |
| OPRA (options) | **$1.25** up to 75,000 nonpros; $1.15 / $1.00 / $0.75 / $0.60 at higher bands | $31.50 (from 2018-01-01) | **$1,500/mo**, "whether on a current or delayed basis", historical-only exempt; $650 query-only | per-member $0 when delayed; floor still owed | **PUBLIC 2026-09-02** — the PDF was fetched and its text extracted this pass; newest effective date printed **January 1, 2018** |

**Modelled per-member real-time cost:** CTA A + B = $2.00 (LEAF) + UTP ASSUMPTION $1.00 = **$3.00 per real-time subscriber/mo**; options **+$1.25**. Counting basis per CTA Exhibit A is subscribers who accessed real-time data **at least once in the month** — a DAU-shaped count, not the member roll. ASSUMPTION: 60 % of members in a month. Hence branch B carries $2.55/member/mo of exchange fees on top of branch A.

**EVIDENCE.** OPRA figures: extracted text of `cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf` (this pass, 325 non-empty lines; the professional, nonpro band, redistribution, direct/indirect access, non-display $2,000 × 3 categories and hosted-solution lines all read as E-03 recorded). CTA: E-03 §2.2 verbatim extract; the ctaplan pricing page read today states the schedule's effective date. UTP: E-03 §2.3 (primary plan policy) plus two failed fetches.

**INTERPRETATION.** Per-member exchange money is small; the machinery is not. Under Massive Stocks Business (*"No Exchange Fees or Approvals"* — PUBLIC 2026-09-02, massive.com/business) the equity per-member line may be **$0 to UCT** because Massive is the vendor of record and its price is the pass-through — but that is exactly the question E-03 Part 6 Q2 asks and nobody has answered. The table therefore models pass-through explicitly (branch B) so the owner can see what "no exchange fees" is worth: **$1,800/mo at 1,000 members, $18,000/mo at 10,000** for equities alone.

**RELEVANCE TO UCT.** E-03 Part 5's "delayed price, live volume, live breadth" design zeroes this entire line on Tape C by plan rule and, per this model, saves $2.55/member/mo plus the OPRA per-member fee; it does **not** remove the OPRA $1,500 floor or the Massive tier requirement.

**CONFIDENCE.** 🟢 OPRA (re-read today, though the schedule's newest printed date is 2018); 🟡 CTA (leaf extract; schedule dated 2015 by the plan's own page; PDF not re-parsed); 🔴 UTP Tape C per-subscriber (never obtained by any leaf). **EVIDENCE CEILING:** the UTP Level 1 fee schedule PDF (a working link, or the plan administrator) and a written answer from Massive on who pays the nonpro fees for Edge Users.

**RECOMMENDATION.** Do not budget real-time equities until Massive answers "who is the vendor of record and who pays the per-subscriber fee" in writing; the model's B column is an upper bound built on pass-through.

**OPEN QUESTION.** Does Massive's "no exchange fees" on the Stocks Business plan extend to non-professional display fees for Edge Users, or only to the vendor's own access fees?

### 2.3 Options / OPRA

**OBSERVATION.** Four tiers, step-shaped (E-03 §2.4, re-confirmed against the PDF text today):

| Options tier for TERMINAL-NEXT | Massive product (PUBLIC 09-02) | OPRA fixed | OPRA per member | Modelled in |
|---|---|---|---|---|
| Retired from member surfaces / desk-only pending decision | Options Advanced $199 (individual; still **R** for a business per E-02 §3.1) | $0 | $0 | A-lite |
| Historical-only (T+1 flat files; `/by-contract` history) | business options product — **price not published**; placeholder $1,999 (ASSUMPTION) | $0 (historical exempt) | $0 | (A-full without the $1,500 → $5,600 fixed) |
| Delayed ≥15 min | as above | **$1,500/mo** | $0 | A-full |
| Real-time | as above | $1,500/mo | **$1.25** per nonpro | B |

**EVIDENCE.** massive.com/options (PUBLIC 2026-09-02) shows only individual tiers and a link to business pricing; massive.com/business (same day) lists no options business price; its expansions page prices "Full Market" at $1,999/mo and "Full Market Delayed" at $499/mo (meaning NOT DETERMINED — likely equities feed expansions, not options), plus *"Additional exchange fees apply to these products. Our experts will help you understand their fees and guide you through exchange approval."*

**INTERPRETATION.** The $1,999 placeholder is the single most arbitrary cell in the table; it exists so the table has a shape. A Massive sales quote replaces it and simultaneously answers whether the $1,500 OPRA floor is inside or outside the price. Whether the stored full tape in `flow.db` served as `/by-contract` history is "historical" (exempt) or ongoing redistribution is, per E-03 §2.4, a vendor-agreement question.

**RELEVANCE TO UCT.** The options tape is the only surface where the fixed cost is a product decision (E-03 §2.4): historical-only is free of OPRA money; delayed is $1,500/mo; real-time adds ~$0.75/member at the 60 % basis.

**CONFIDENCE.** 🟢 on the OPRA lines; 🔴 on the Massive options business price. **EVIDENCE CEILING:** one Massive quote.

**RECOMMENDATION.** Decide the tape's tier before the Massive conversation, so the quote request is for one product, not four.

**OPEN QUESTION.** Is "Full Market Delayed $499/mo" a business-licensed delayed equities feed — i.e. a cheaper legal home for the delayed-price design than the $2,499 plan? NOT DETERMINED; worth one question to Massive sales.

### 2.4 Fundamentals / estimates upgrade, transcripts, news

**OBSERVATION.**

| Class | Today | Compliant shape | Price (label) | Scales? |
|---|---|---|---|---|
| Fundamentals / estimates / calendar | FMP Premium $49/mo (individual-use plan; **R** without a DDLA — E-02 §3.2) | FMP Data Display and Licensing Agreement | **NOT DETERMINED** (FMP sells it; no public price; both FMP pricing URLs 403 this pass). Stand-in used in the table: Massive "Financials & Ratios" at **$699/mo business use** vs $29 individual (PUBLIC 2026-09-02, massive.com/business and /pricing) — a public price for a licensed fundamentals feed from the vendor already in the stack; whether it covers estimates, grades, calendars and transcripts is NOT DETERMINED | Fixed; FMP's 50 GB/30-day bandwidth cap is the only member-linked limit |
| Transcripts | FMP `stable/earning-call-transcript*` (in plan, CLAIM); AV free 25/day; earningscall.biz / Quartr dormant, unpriced | FMP DDLA + a written answer on summarising/storing bodies (E-02 §5); or a transcript vendor contract | NOT DETERMINED; excluded from totals | Fixed |
| News | AV free (R) → RSS → Massive `/v2/reference/news` (in plan) → FMP | Retire AV onto RSS + Massive news (E-02 §7.2) — $0 delta; Benzinga via Massive partner data $99/mo per dataset (individual, PUBLIC 09-02; business "contact") | $0 modelled; optional $99+ | Fixed |
| Social | twitterapi.io $0.15/1K tweets (PUBLIC) | UI/deletion fixes (E-02 §2.7), not a price change | ~$35/mo CLAIM | Cadence-scaled |
| Short-interest history, analyst-level estimates, corporate-actions calendar, Level 2 | **NO PROVIDER** (F-03b §3.2) | new vendors, unpriced by any leaf | excluded; named as gaps | — |

**EVIDENCE.** F-03b §1B rows 4, 7, 40–41; E-01 §2 (FMP Premium ceilings and the DDLA footnote read 2026-09-02); massive.com pages this pass.

**INTERPRETATION.** The fundamentals licence is the cheapest large conversion in the register (E-02 §3.2 — 19 rows) and the one with no public price. Using a public sibling price ($699) as the stand-in is more honest than a guessed FMP number, but it may over- or under-state by several hundred dollars.

**RELEVANCE TO UCT.** At ≥ 500 members the fundamentals line is ≤ 10 % of the fixed block; its importance is licensing, not cost.

**CONFIDENCE.** 🟡. **EVIDENCE CEILING:** an FMP quote (one email).

**RECOMMENDATION.** Ask FMP for the DDLA quote and Massive whether Financials & Ratios (business) covers estimates; pick the cheaper compliant one.

**OPEN QUESTION.** Does an FMP DDLA price scale with "number of end users" (many display licences do)? If so this line moves from fixed to member-scaling.

### 2.5 Broker mirror, email, egress — the member-scaling lines that already exist

**OBSERVATION.** Three lines in production today scale with members and none appears in any leaf's cost column:

* **SnapTrade** — $2 per connected user/mo after 5 free (PUBLIC 2026-09-02). `BROKER_SYNC_ENABLED=1` on web (ORCH). Connected-user count today NOT DETERMINED (a `j2_broker_accounts` row count on the production volume — not read). ASSUMPTION 25 % of members connect ⇒ **$0.50/member/mo**; at 10,000 members ≈ **$5,000/mo**, the largest variable line in branch A. SnapTrade's "Custom plan, volume-based pricing" would reduce it (amount NOT DETERMINED).
* **Resend** — free 3,000/mo and 100/day (PUBLIC 2026-09-02). Armed senders: verification, resets, `COMPASS_WEEKLY_DIGEST_ENABLED=1`, `CALENDAR_ALERTS_ENABLED=1`, watchlist digests, catalyst alerts (ORCH; D-04 §8 job families). ASSUMPTION 30 emails/member/mo ⇒ free to ~100 members, Pro $20 to ~1,600, Scale beyond. **The 100/day free-tier cap is a silent failure mode at ~100 members with daily digests** (CLAIM from the public tier shape; whether the account is on the free tier NOT DETERMINED).
* **Railway egress** — $0.05/GB (PUBLIC 2026-09-02). D-05 measured `/api/flow/data?days=1` at **12.4 MB gzipped per Options Flow mount** with `cf-cache-status: DYNAMIC` (Cloudflare caches nothing), deep-bar payloads ~1.4 MB, and the shared live-price poll at 2 s desktop / 4 s mobile (D-05 §2.1). ASSUMPTION 0.5 GB/member/mo ⇒ **$0.025/member/mo** — negligible in dollars, material only as event-loop load.
* **Stripe** — 2.9 % + $0.30 (PUBLIC 2026-09-02) on paid revenue; $6.10 per paid member at the $200 list price (code CLAIM). Revenue-linked, excluded from the data/infra total.

**EVIDENCE.** WebFetch this pass (four pages); ORCH flag table; D-05 §2.1, §4.3.

**INTERPRETATION.** The seed's rule that *any* member-scaling cost escalates regardless of amount is already engaged by SnapTrade in production. That is a governance observation, not a defect.

**RELEVANCE TO UCT.** TERMINAL-NEXT inherits these lines whether or not it adds a data vendor; the broker mirror is the one whose take-rate a product decision (making the mirror a headline feature) can double.

**CONFIDENCE.** 🟢 prices; 🔴 take-rates. **EVIDENCE CEILING:** SnapTrade and Resend dashboards (owner-present read).

**RECOMMENDATION.** Read the SnapTrade connected-user count and the Resend monthly volume once; both are one-screen reads and convert two ASSUMPTIONS to facts.

**OPEN QUESTION.** Is the Resend account on the free tier today, and has the 100/day cap ever been hit?

### 2.6 Railway compute per service (public pricing × D-04/D-05 resource claims)

**OBSERVATION.** Railway bills usage: **$10 per GB RAM per month, $20 per vCPU per month (approximate monthly equivalents of the per-second rates), volumes $0.15 per GB-month, egress $0.05/GB; Pro plan $20/mo per workspace with $20 of credit; Hobby caps volumes at 5 GB, Pro at 1,000 GB** (PUBLIC 2026-09-02). The bars-api header names **32 GB RAM / 50 GB volume** for that service (D-04 §5.2, CLAIM); the web pod's limits are NOT DETERMINED (D-04 §8). Measured RSS: web **1,490 → 1,277 MB** after `malloc_trim` on 2026-08-29 (D-04 §8, CONFIRMED in-code record), "toward ~2.4 GB" unbounded (CLAIM), 11.7 GB once observed on a long-lived pod (D-05 §6.2); worker **3–23 GB sawtooth** during prewarm (D-05 §6.2, code comment). Five services (ORCH). A 50 GB volume alone forces the **Pro plan** (Hobby max 5 GB).

| Service | ASSUMED average RAM | ASSUMED average vCPU | Volume (ASSUMED used) | Monthly (ASSUMPTION) |
|---|---|---|---|---|
| web (uvicorn, 144 scheduler jobs, SSE) | 2.0 GB → $20 | 1.0 → $20 | 50 GB → $7.50 | ~$48 |
| worker (prewarm, reconciliation, R2 snapshots) | 8.0 GB → $80 | 1.5 → $30 | 60 GB → $9 | ~$119 |
| flow-worker (OPRA consumer, flow.db, 8 GB spool) | 2.0 GB → $20 | 0.75 → $15 | 46 GB → $7 | ~$42 |
| bars-api (R2-synced bars.db) | 3.0 GB → $30 | 0.5 → $10 | 50 GB → $7.50 | ~$48 |
| chart-renderer (Playwright) | 1.0 GB → $10 | 0.25 → $5 | — | ~$15 |
| Pro plan base (net of credit) | | | | ~$0–20 |
| egress baseline (~40 GB) | | | | ~$2 |
| **Total** | | | | **~$290/mo** (range $200–450) |

**Scaling.** Railway usage does not scale with member count until concurrency exceeds the pod's envelope. D-05 §6: one uvicorn process, **64** anyio threads, **`STREAM_MAX_SUBSCRIBERS = 300` per stream** (prices and bars in separate registries), pooled clients so a 12-widget board is ~2 connections per browser — i.e. the binding constraint is **~300 concurrent browsers**. ASSUMPTION peak concurrency 15 % of members ⇒ 15 / 75 / 150 / 750 / 1,500 concurrent browsers for the six scenarios. The step therefore lands between 1,000 and 5,000 members, and it is not a bigger pod: multi-instance web requires `auth.db` → Postgres first (D-04 §5.6, §8), a durable home for the per-process state CLAUDE.md lists (locks, poll timers, dedup dicts), and either a dedicated stream tier or a pooled broker for SSE. Modelled steps (ASSUMPTION): 1,000 members +$40 (larger web pod); 5,000 +$450 (Postgres service ~$60, two web replicas ~$100, a stream tier ~$150, worker growth, Pro plan headroom); 10,000 +$900.

**EVIDENCE.** railway.com/pricing (this pass); D-04 §5.1–5.2, §8; D-05 §1.1, §6.1–6.4.

**INTERPRETATION.** Compute is the cheapest line in the model and the hardest to scale: the money is trivial, the engineering step (Postgres + multi-instance) is the real cost and is out of this file's scope (ARCH).

**RELEVANCE TO UCT.** A separate TERMINAL-NEXT service is "one more env-var branch in the dispatcher" (D-04 §5.1) at ~$40–60/mo; that is cheaper than any data line and avoids the 144-job pod entirely.

**CONFIDENCE.** 🟢 prices; 🔴 sizes (no Railway usage page). **EVIDENCE CEILING:** the Railway usage/billing page (OI-10) — one screenshot replaces this whole table.

**RECOMMENDATION.** Budget TERMINAL-NEXT's serving tier as its own service from day one; the marginal Railway cost is noise next to the data lines.

**OPEN QUESTION.** What does Railway actually bill today for the five services? The worker's 3–23 GB sawtooth alone could move the table by ±$100/mo.

### 2.7 Storage and R2

**OBSERVATION.** R2: **$0.015/GB-month standard, Class A $4.50/M, Class B $0.36/M, egress free, 10 GB + 1M/10M ops free** (PUBLIC 2026-09-02). Rails writing to it (D-04 §4): bars snapshots every `SNAPSHOT_INTERVAL_SECONDS` (default 20 min, weekdays 04:00–20:00 ET) with `SNAPSHOT_KEEP` retention, deltas, brain packs (newest 5), `auth.db` 6-hourly + nightly (keep 14), `flow.db` nightly (60 d on flow-worker per ORCH), J2 attachments nightly. The ledger notes bar snapshots were **not observed pruned** (F-03b row 32). The bars base is ~20 GB (D-05 §6.2, the 2026-08-31 OOM record). Volumes: ~50 GB each on bars-api and (implied) web/worker, 46 GB on flow-worker (D-04 §1.4's 33 GB backup incident).

**Modelled:** R2 **~$15/mo** at ≤1 TB retained (ASSUMPTION; ~48 snapshots/weekday × a compressed multi-GB tarball would exceed 1 TB within weeks if truly unpruned, and then this line grows ~$0.015/GB-mo with no member link); Railway volumes ~$30/mo inside §2.6. Per-member storage (auth rows, attachments, journal) ASSUMPTION 20 MB/member ⇒ **$0.006/member/mo** — negligible.

**EVIDENCE.** developers.cloudflare.com/r2/pricing (this pass); D-04 §3–4; F-03b row 32.

**INTERPRETATION.** Storage is fixed and small; the only way it becomes material is unbounded snapshot retention, which is a hygiene question, not a member question.

**RELEVANCE TO UCT.** R2's free egress is what makes the "own service reads a replicated snapshot" pattern (bars-api) cheap to copy for TERMINAL-NEXT.

**CONFIDENCE.** 🟢 prices; 🔴 retained volume. **EVIDENCE CEILING:** one R2 bucket listing.

**RECOMMENDATION.** Confirm `SNAPSHOT_KEEP` is set and finite before the bucket becomes the largest storage line.

**OPEN QUESTION.** Is the R2 bucket UCT's own account (E-02 §4's storage-vs-redistribution question)? Cost is unaffected; licensing is.

### 2.8 Streaming fan-out (D-05's envelope) and observability

**OBSERVATION — fan-out.** Costs are capacity, not dollars: per open SSE connection one coroutine at 4 Hz on the shared loop; 50 tickers or 50 `SYM:TF` pairs per connection; per-`(sym,tf)` queues of 64 drop-oldest; the flow tailer does "one cheap query/sec total, independent of client count" (D-05 §1.1). The number that converts to money is the **300-subscriber cap per stream**: past it, clients get a 503 `at_capacity` and fall back to polling — which is *more* expensive per member (request-path work on the 64-thread pool). The infrastructure step in §2.6 is the dollar form of this line.

**OBSERVATION — observability.** Sentry is dormant (DSN absent on every service, ORCH); Railway log retention is 30 days on Pro (PUBLIC). Sentry **Developer free (5k errors), Team $26/mo annual (50k errors, 5M spans), Business $80/mo** (PUBLIC 2026-09-02). Modelled $0 today, $26 in branches A/B, $80 at ≥ 5,000. An uptime monitor is ASSUMED $0–20 and not summed. Vendor-side observability that already exists at $0: `/api/admin/provider-coverage`, `/api/admin/bars-stream-status`, `/api/admin/twitter-stats`, `/api/voice/cost`, the `[mem]` and `[thread-burst]` log lines (D-05 §6).

**EVIDENCE.** D-05 §1.1, §6.1–6.4; sentry.io/pricing and railway.com/pricing this pass; ORCH variable lists.

**INTERPRETATION.** Observability is the one line where spend is a choice, not a consequence: the pod already emits what a 24-hour log export would need (D-05 §6 RECOMMENDATION).

**RELEVANCE TO UCT.** A multi-panel TERMINAL-NEXT client is cheaper than many tabs **only if every panel joins the existing pools** (D-05 §1.1 RELEVANCE); a panel that opens its own stream spends the 300 budget N times faster.

**CONFIDENCE.** 🟢 on the envelope numbers (code-read by D-05); 🟡 on where the step lands (concurrency is an ASSUMPTION).

**RECOMMENDATION.** Make "joins the pool" a review question; it is worth more than any observability subscription.

**OPEN QUESTION.** What is the real concurrent-browser distribution at the open? D-05 could not measure it; a week of `WATCHDOG_OBSERVE=1` plus the subscriber counters would.

---

## 3. THE PER-MEMBER COST CURVE (Deliverable 2)

**OBSERVATION.** Every branch has the same shape: `cost per member = F / N + v`, with

| Branch | F (fixed, ex-AI, ex-infra-steps) | v (variable per member/mo) | Asymptote |
|---|---|---|---|
| S0 (reference; not licensable) | ~$540 + Railway ~$290 = **~$830** | ~$0.58 | $0.58 |
| A-lite | ~$3,510 + ~$290 = **~$3,800** | ~$0.58 (SnapTrade $0.50 + egress $0.025 + Resend ~$0.03 + storage $0.006) | $0.58 |
| A-full | ~$6,810 + ~$290 = **~$7,100** | ~$0.58 | $0.58 |
| B | **~$7,100** (+$4,000 if non-display alerting applies) | ~$3.13 ($0.58 + $2.55 exchange pass-through) | $3.13 |

plus the infrastructure steps (+$40 at 1,000; +$450 at 5,000; +$900 at 10,000 — ASSUMPTION) and the observability step.

**The curve, A-full (per member/mo):** 5 → $1,421 · 100 → $71.7 · 500 → $14.8 · 1,000 → $7.68 · 5,000 → $2.07 · 10,000 → $1.36. **A-lite:** $761 · $38.7 · $8.15 · $4.38 · $1.41 · $1.03. **B:** $1,423 · $74.2 · $17.3 · $10.2 · $4.62 · $3.91.

**Break-even against ARPU (data + infra only; add E-06's AI line).** The app displays one plan at **$200/mo or $2,000/yr** (`app/src/pages/Pricing.jsx:6` — CLAIM about intent; OI-12 says proceed on the code) and the wire promo is $7 for one **week** (`morning-wire/substack/promo.py:68`). With paid fraction *p* and ARPU-per-member = 200·*p* (ignoring annual discount and promo), the member count at which data + infra is covered is N\* = F / (200·p − v):

| Paid fraction p | A-lite (F 3,800, v 0.58) | A-full (F 7,100, v 0.58) | B (F 7,100, v 3.13) |
|---|---|---|---|
| 100 % | 19 | 36 | 36 |
| 50 % | 38 | 71 | 73 |
| 20 % | 96 | 180 | 193 |
| 10 % | 196 | 366 | 421 |
| 5 % | 403 | 754 | 1,034 |

**EVIDENCE.** §1 table; price strings grep'd in `app/src/pages/{Pricing,Landing,Subscribe,Settings,Admin}.jsx` this pass (the admin MRR popover multiplies "× $200/mo subscribers", `Admin.jsx:222`); OI-01 (mix unknown; "under ~750 community members").

**INTERPRETATION.** At the code's list price the data+infra block is covered by a few dozen paying members in every branch; the risk is not the asymptote (≤ $3.13/member) but the **fixed block landing before the members do** — F is ~$3.8k–7.1k/mo from the first month of any compliant branch, against a community the seed says is under 750 total with an unknown paid share. The sensitivity that matters at small N is F; at large N it is v (and E-06's AI line, which is per-member by construction).

**RELEVANCE TO UCT.** The owner's "desk first, members second" default (D-001) means the internal-only column is the one that will be paid first: **$3.8k–7.1k/mo for five users** in a compliant branch, versus ~$830 today. That gap is the price of the licence, not of the terminal.

**CONFIDENCE.** 🟡 on the curve's shape (arithmetic over labeled inputs); 🔴 on F's absolute level (two unpriced cells) and on p.

**RECOMMENDATION.** Present the owner with F as three numbers (A-lite / A-full / B) and one question — which tape tier — rather than with the six-column table; the columns follow from F.

**OPEN QUESTION.** What is p today? One `subscriptions` table count (owner-present, not this program) sets the whole break-even row.

---

## 4. WHAT SCALES WITH MEMBERS AND WHAT IS FIXED — the escalation map

**OBSERVATION.** Against the seed's three triggers (new recurring > $250/mo · any contract · any member-scaling cost):

| Line | Fixed / scales | Escalates? | Note |
|---|---|---|---|
| Massive Stocks Business $2,499 | fixed (vendor gate at 200+ users) | **yes — all three** | the one purchase that converts 38 register rows (F-04 §1C) |
| Massive options business + OPRA floor | fixed; per-member only if real-time | yes | tier decision first |
| FMP DDLA / licensed fundamentals | fixed (unless priced per end user — NOT DETERMINED) | yes (contract) | cheapest large conversion |
| Exchange non-pro fees (CTA/UTP/OPRA) | **scales** ($2.55/member at 60 % basis) | yes (member-scaling, regardless of amount) | $0 on the delayed design (Tape C by plan rule; CTA delayed ASSUMED $0) |
| Non-display alerting $2,000 × 2 | fixed | yes | **U**; the line most likely to be missed (E-03 §4.4B) |
| SnapTrade | **scales** ($2/connected user) | already engaged in production | largest variable line in branch A |
| Resend | **scales** (tiered) | already engaged | free-tier 100/day cap is the near-term tripwire |
| Railway compute | step at ~300 concurrent browsers | no until the step (then the Postgres precondition is the real cost) | |
| Railway egress | scales, negligible | technically yes ($0.025/member) | |
| R2, volumes | fixed (hygiene-driven) | no | |
| Observability | fixed (chosen) | no (< $250) | |
| Finviz, twitterapi.io, Finnhub/AV/yfinance | fixed / cadence-scaled | no | retirements save ~$0 in dollars, much in licensing |
| Stripe | scales with paid revenue | revenue-linked | outside the data/infra total |
| AI lanes | per-member by construction | E-06 | population reserve exists on one lane only (D-12 §5d) |

**INTERPRETATION.** Two of the three member-scaling data lines (SnapTrade, Resend) are already live and were never in a cost column; the third (exchange fees) is avoidable by design on equities and unavoidable on real-time options. The Massive tier is the only line that is simultaneously fixed, contract-shaped and above the threshold — it is the escalation.

**RECOMMENDATION.** Route the whole model to the owner as one escalation packet (B §34) rather than line by line; every compliant branch trips the rule on its first invoice.

---

## 5. THE THREE LARGEST SENSITIVITIES (Deliverable 3)

| # | Sensitivity | Low → High | Swing | What settles it |
|---|---|---|---|---|
| **S-1** | **Massive tier and vendor-of-record shape** — Advanced $199 vs Stocks Business $2,499 (PUBLIC), and whether "No Exchange Fees or Approvals" absorbs the non-pro per-subscriber fees for Edge Users (or leaves $2.55/member pass-through) | fixed **$199 → $2,499**; variable **$0 → $2.55/member** | **±$2,300/mo fixed; ±$2,550/mo per 1,000 members** | OI-03(a) + one written Massive answer (E-03 Part 6 Q1–Q2) |
| **S-2** | **Options tape tier** — retire/historical-only ($0 OPRA) vs delayed ($1,500 floor) vs real-time (+$1.25/nonpro), on top of an unpriced Massive options business product (placeholder $1,999) | **$199 → $3,500+ fixed; $0 → $0.75/member** | **±$3,300/mo fixed; ±$750/mo per 1,000 members** | the owner's tape decision (E-03 §2.4) + a Massive options quote |
| **S-3** | **Member-scaling lines nobody priced** — SnapTrade take-rate (10 % → 50 % of members ⇒ $0.20 → $1.00/member; $2k → $10k/mo at 10,000) and the infrastructure step (Postgres + multi-instance; ASSUMED +$450 at 5,000, could be ±$300 and is mostly engineering time) | | **±$8,000/mo at 10,000 members** | one SnapTrade dashboard read today; a concurrency measurement (D-05 §6) |

Honourable mentions, each smaller in dollars but binary: **S-4** non-display alerting (+$4,000/mo fixed if Category 1 applies to member alerts — **U**); **S-5** the FMP DDLA price (stand-in $699; if per-end-user it becomes a fourth scaling line); **S-6** UTP Tape C non-pro rate (ASSUMED $1.00 — NOT DETERMINED); **S-7** whether the desk's own seats are professional-rated (~$100/device vs $4.25).

**INTERPRETATION.** S-1 and S-2 are the same conversation with the same vendor. Everything else in this file is second-order until that conversation has happened.

---

## 6. OWNER QUESTIONS THAT BOUND THE RANGES (Deliverable 4) → `OWNER_INPUTS_REQUESTED.md`

| # | Question | Cell(s) it replaces | Existing OI |
|---|---|---|---|
| Q-1 | Which Massive plan(s) are billed today — stocks tier, options tier, flat files — and at what monthly amount? (Paste the invoice.) | §2.1 rows 1–3; the whole S0 column | OI-03(a), OI-10 |
| Q-2 | From Massive in writing: for Stocks Business, does "No Exchange Fees or Approvals" cover non-professional display fees for Edge Users, or does UCT owe CTA/UTP per-subscriber fees and its own vendor agreements? Who is vendor of record? | §2.2 pass-through ($0 vs $2.55/member) | OI-09; E-03 Part 6 Q2 |
| Q-3 | A Massive quote for the options business product, stating whether the OPRA $1,500 redistribution fee and the $1.25 nonpro fee are inside or outside the price, and whether historical-only `/by-contract` from the stored tape counts as exempt | §2.3 placeholder $1,999 + $1,500 | new |
| Q-4 | The tape tier decision itself: retire / historical-only / delayed / real-time | S-2 | new (product) |
| Q-5 | An FMP DDLA quote (and whether it is priced per end user); alternatively whether Massive "Financials & Ratios (business)" covers estimates and calendars | §2.4 stand-in $699 | OI-03(b) |
| Q-6 | Member count and paid fraction today; the Stripe/Whop price actually charged (the code says $200/mo; the wire promo is $7/week) | §3 break-even row | OI-01, OI-12 |
| Q-7 | Railway billing page for the last full month (per-service usage) | §2.6 whole table | OI-10 |
| Q-8 | SnapTrade connected-user count and plan; Resend plan and last-month volume | §2.5 take-rates | new |
| Q-9 | Is server-side price alerting inside the Massive display licence, or Category 1 non-display ($2,000 CTA A + $2,000 OPRA)? | S-4 | E-03 Part 6 Q9 |
| Q-10 | Are Bullflow, Unusual Whales (retail $50–120 / API $150–375 public) and Polygon-direct still billed? | §2.1 unaccounted $0–375 | OI-04 |
| Q-11 | Does the owner accept a 15-minute-delayed price with live volume and live breadth on TERMINAL-NEXT's equity surfaces? (Sets branch A vs B.) | the A/B split | E-03 Part 5 |
| Q-12 | Are the desk's own users professional subscribers under the plan definitions? | the † footnote (~$500/mo for five seats) | E-03 §2.1 |

---

## 7. OBSERVATIONS THAT DID NOT FIT A LINE

* **Comparable retail price points (dossiers §L, all read 2026-09-02):** Unusual Whales $50 / $75 / $120 list per seat with the full real-time options tape included; Koyfin $0 / $39 / $79 / $209 / $299; TradingView $0 / $12.95 / $29.95 / $59.95 / $199.95 plus exchange add-ons ($3/exchange non-pro, $9.95 US bundle; $27–50 professional); Benzinga Pro ≈ $30.58 / $124.75 / $166.42 (annual-equivalent). Two of these publish a **non-pro per-exchange add-on that the customer pays** (TradingView) and one absorbs it (UW, Benzinga on Nasdaq Basic) — the two vendor-of-record shapes this model's branches A and B correspond to. UCT's $200/mo list sits above every retail comparable; the exchange lines are affordable at that price and would not be at Koyfin's.
* **Massive's business page prices a delayed full-market feed at $499/mo** (PUBLIC 2026-09-02, meaning NOT DETERMINED). If it is a business-licensed delayed equities product, the delayed-price design (E-03 Part 5) might have a legal home ~$2,000/mo cheaper than the Stocks Business plan. One question to Massive sales.
* **The catalyst cost guard still bills Sonnet 5 at Sonnet 4.6 rates** (D-12 §5c) — irrelevant to this file's totals, but any per-feature attribution E-06 builds on `catalyst_cost_log` will read ~50 % high until `catalyst/cost_guard.py:33` is fixed.
* **The FMP 50 GB trailing-30-day bandwidth cap** (E-01 §2) is the only member-linked limit on a fixed line; at ~1.4 MB per fundamentals page it is ~35,000 page-loads per month before the plan throttles. Not modelled; named.
* **Text shaped like instructions was read and not followed:** vendor pages' imperative contract language (quoted as fact); `api/earnings_router.py`'s "mount me" docstring (via the ledger); nothing was signed up for, toggled, purchased or accepted. The FMP, UTP, CTA-PDF and logo.dev fetches failed (403 / 404 / 404 / 429) and were not retried through any other channel.

---

## GAPS — what this budget did not reach

* **No spend was measured.** Every total is public list price × labeled assumption. OI-10 (invoices) and one Railway billing screenshot would convert §2.1 and §2.6 from assumption to fact.
* **Two cells are placeholders with no source:** the Massive options business price ($1,999) and the licensed-fundamentals stand-in ($699, a public price for a *different* product). A quote each.
* **UTP Tape C non-professional per-subscriber fee** — never obtained by any leaf; two fetches failed this pass; modelled at $1.00 by assumption.
* **CTA schedule not re-parsed** — figures carried from E-03's extract; ctaplan.com/pricing dates the schedule effective 1 Jan 2015. Rates may have moved.
* **Take-rates** (SnapTrade connect rate 25 %, real-time-touch rate 60 %, peak concurrency 15 %, 30 emails/member/mo, 0.5 GB/member/mo) are all assumptions with no usage read behind them.
* **Railway sizes** — web pod limits NOT DETERMINED (D-04 §8); averages are guesses bracketed by the measured RSS figures.
* **Professional vs non-professional status of the desk** — not classified; the internal-only B column may be understated by ~$500/mo.
* **AI lanes** — excluded by contract (E-06). The owner must add E-06's per-member line to §3 before reading break-even.
* **Transcript, short-interest-history, analyst-level and corporate-actions vendors** — unpriced by any leaf; excluded rather than guessed.
* **Zoom, YouTube, Discord, Substack, Whop, Buffer, Cloudflare plan, uptime monitoring** — outside terminal data/infra or unpriced; excluded.

## NOT INSPECTED — out of reach and why

* **Vendor invoices, consoles, order forms, contracts** — Massive, FMP, Finviz, Finnhub, AlphaVantage, SnapTrade, Resend, Railway, Cloudflare R2, twitterapi.io, Unusual Whales, Bullflow, Polygon. Not on this machine; no login was attempted; nothing was signed up for.
* **Production services and the production `/data` volume** — not touched; no `railway` command was run by this pass (the variable/flag state is ORCH-RAILWAY-01's read). The SnapTrade connected-user count, Resend volume, R2 bucket size and `SNAPSHOT_KEEP` value all live there.
* **The local backend on port 8077 and `C:\data`** — not probed, not read.
* **Vendor pages that refused this pass:** `site.financialmodelingprep.com/developer/docs/pricing` and `/pricing-plans` (403), `utpplan.com/DOC/UTP LEVEL 1 SERVICE FEES 1.2015.pdf` (404), `nyse.com/publicdocs/ctaplan/pricing` (404; the PDF link on ctaplan.com/pricing was not fetched), `logo.dev/pricing` (429). Anthropic/OpenAI/Perplexity price pages deliberately not fetched (E-06).
* **Partner-owned files** (`massive_ws_worker.py` etc.) — not opened; the options-plan inference rests on the ledger's description of the `T.*` subscription.
* **Any vendor API** — none called. **Git** — not run. **Test suites** — not run.
* **The engine, bot, wire and scan repositories** — only `morning-wire/substack/promo.py` and `uct-sunday-scan/sunday_scan/promo.py` were grep'd (read-only) for the promo price; nothing else opened.

### Source-handling note

Everything read was treated as evidence, not instruction. No credential, token, password or connection-string value appears in this file; variables are named only. Prices quoted from vendor pages are facts about those pages on 2026-09-02 and say nothing about the plan UCT holds.
