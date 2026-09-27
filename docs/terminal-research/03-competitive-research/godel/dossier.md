---
id: B-POD-GDL
title: Gödel Terminal — Dossier
role: Gödel Pod Synthesis
wave: 2
group: B
category: competitor
scope: Gödel Terminal (DL Software Inc.)
confidence: 🟡 overall
evidence_ceiling: DEMONSTRATED is structurally unreachable for this product from permitted sources (no official video channel exists; every located product video is affiliate-`?via=`-tagged or on the founder's personal channel, both barred by the external preamble). No trial seat has been taken — OI-18 is open, owner action pending, and the OWNER_INPUTS_REQUESTED ledger records "No trials; ceilings recorded" as of this synthesis. Everything below the VERIFIED line rests on official documentation describing shipped software, never on observed running software, measured latency, or data quality.
sources: 17 primary (official godelterminal.com pages, all fetched 2026-09-02); 20 secondary (Reddit, X/Twitter, YouTube listings, LinkedIn, GitHub, Google search snippets), deduplicated and tiered below
uct_relevance: high
status: draft
date: 2026-09-02
---

## How this dossier was built

This is a POD SYNTHESIS task, not new field research. It reconciles three leaf reports —
`01-evidence.md` (B-GDL-01, identity/positioning/pricing/capability catalogue from the
homepage, pricing page, and docs index), `02-verification.md` (B-GDL-02, a deeper pass
through the individual per-command docs pages that added ~30 commands and assigned an
explicit VERIFIED/DEMONSTRATED/CLAIMED/REPORTED/SPECULATED class to each capability), and
`03-ideas.md` (B-GDL-03, seven transferable-idea write-ups plus a REPORTED-tier
practitioner-complaint sweep) — against the Gödel rows of `benchmark-universe.md` and
OI-18 in `OWNER_INPUTS_REQUESTED.md`. No new web research was performed for this
synthesis; the one permitted re-check (a cited page on a conflict) was judged unnecessary
because B-GDL-02 had already independently re-fetched both sides of the one live
API-availability conflict on the same day the earlier report found it (see Reconciliation
§2). All dates below are 2026-09-02 unless stated otherwise.

**The Part IX directive** (`00-program-control/charter/C-master-directive.md`) asks this
research to "distinguish: proven functionality, demonstrated prototypes, conceptual ideas,
marketing claims, speculation" — the spine below implements that instruction as the
five-way VERIFIED / DEMONSTRATED / CLAIMED / REPORTED / SPECULATED ladder B-GDL-02 defined
and applied. **The single most important fact in this dossier is about that ladder, not
any individual cell in it: DEMONSTRATED is empty by construction.** No official Gödel
Terminal video channel exists. Every capability that looks real in this document is real
only in the sense that Gödel's own documentation says so in specific, operational detail —
never that anyone outside the company has watched it run.

---

## Evidence-Class Spine (Part IX separation)

The full class ladder, and what artifact each class requires:

| Class | Means | Artifact required here |
|---|---|---|
| **VERIFIED** | Official docs/product page describes it as shipped | dated godelterminal.com page |
| **DEMONSTRATED** | Official video/stream transcript or dated screenshot shows it running | — **empty; see ceiling above** |
| **CLAIMED** | Founder or marketing statement, no artifact | tweet, homepage banner, sales-page prose |
| **REPORTED** | Third party says so | Reddit thread, GitHub repo, LinkedIn profile |
| **SPECULATED** | Inference only, flagged as such | this dossier's own interpretive links |

### VERIFIED (official godelterminal.com documentation describes it as shipped)

*Command grammar and window manager*
- Positional `TICKER COUNTRY ASSETCLASS CMD` grammar (e.g. `AAPL US EQ G`) — `/docs/commands/g`
- Bloomberg-alias rewriting: `GIP`/`GP`→`G`, `OPT`/`CALL`/`PUT`→`OMON`, `CN`/`NH`→`N` — `/docs/commands/g`, `/docs/commands/omon`, `/docs/commands/n`
- Resolution/argument modifiers (e.g. `AAPL US EQ G 1m`) — `/docs/commands/g`
- Full keyboard shortcut table (focus/close/cycle/move/snap/resize/undo-close/help) — `/docs`
- Per-window settings persisted per account across sessions — `/docs/commands/g`
- Colour-linked windows (🔗 chain icon ties tickers across windows of the same colour) — `/docs/commands/g`
- Command strings as embeds: `{AAPL EQ G}` in chat, `{COMMAND}`/`[EXPR]` pills in the changelog, `{ERR}` opens bug report — `/docs/commands/chat`, `/docs/commands/change`
- Instance limits (30 `G` windows/screen all tiers; `CHANGE`/`CHAT`/`BROK`/`ENT` single-instance) — `/docs/commands/g`

*Market data & surveillance (48-command index, measured 2026-09-02, re-derive rather than trust)*
- `QM` Quote Monitor — 400 tickers/list, batch import, real-time bid/ask/change/volume — homepage
- `N` News — two-layer filter model, tri-state source selection, 20 include/20 exclude keywords, class-action filter, "Set to Recommended" curated defaults, inline match-explanation snippets, an audit Info panel, breaking-news banner, paid-only TTS, six documented workflows — `/docs/commands/n`
- `TREND` — most-searched tickers across all users, 1H/24H/WEEK/MONTH tabs, sparkline, 30s auto-refresh — `/docs/commands/trend`
- `WJI` Wojak Index — 10-state sentiment gauge (MANIA→ANNIHILATION) from `#general` chat emoji usage — `/docs/commands/wji`
- `WEI`/`WEIF`/`GLCO`/`FX` global index/futures/commodity/forex coverage by region — homepage, `/docs`
- `HALT`, `MOST`, `ALLQ`, `TAS`, `SECF`, `FOCUS`, `HCP` — existence and naming only — `/docs` index
- `IMAP`/`HMAP` heat maps — shipped, tagged BETA on the index itself — `/docs`

*Charting*
- Charting is TradingView, licensed wholesale, not in-house — `/docs/commands/g`: "everything below [the chrome] is TradingView"
- 11 chart styles (Candles, Bars, Line, Area, Baseline, Heikin Ashi, Hollow, Renko, Kagi, Point & Figure, Line Break), TradingView's indicator/strategy library, drawing tools, resolutions 1m–1d+, range presets, log/percent/indexed scales, alerts from the chart — `/docs/commands/g`
- Chart data gated on `AGGREGATE_RTH` feed; missing entitlement renders an **empty** chart, not an error — `/docs/commands/g` Notes
- No popout to a native OS window — `/docs/commands/g` Notes

*Fundamentals, filings, options*
- `FA` standardised financials with claimed line-item→filing provenance; `CF` EDGAR filings (10-K/10-Q/8-K/S-1/proxies/13F); `EM` forward EPS/revenue matrix + analyst ratings/targets — homepage
- `HDS`/`HMS`/`ERN`/`SI`/`GR`/`ANR`/`DVD`/`IPO`/`TRAN` — existence — `/docs` index, `/pricing`
- `EVT` Company Events — **not shipped**, COMING SOON pill — `/docs` index
- `OMON` option chain: every strike/expiration, live bid/ask/last/volume/IV, full Greeks including Rho/Lambda/Epsilon, websocket streaming, wired drill-through (contract → `FOCUS`/`G`/`OVME`) — `/docs/commands/omon`
- `OVME` Black-Scholes calculator — `/docs` index

*Screening*
- `EQS` Equity Screener, BETA, "more filters are coming soon" — `/docs/commands/eqs`
- Filter set: range filters on Market Cap, P/E/P/S/P/B/P/CF (Fwd+TTM), Fwd EPS, Fwd Rev; list filters on Venue/HQ Country/Sector/Sub-Sector; toggles + currency selector; CSV/JSON export — `/docs/commands/eqs`
- **No price, volume, moving-average, RS, ADR, gap, range, or pattern filter of any kind** — same page, confirmed absent by enumeration

*AI*
- **Zero AI/LLM/natural-language/agent/copilot/semantic-search capability anywhere in the 48-command index or homepage strip** — `/docs` index, homepage
- Parent company (DL Software) ships three AI products (Neets TTS, Dr. Gupta "an AI physician," Shoggoth image generation) alongside the non-AI terminal — `/press/pre-seed-round`

*Community*
- `CHAT`: public channels, auto-created `$TICKER` symbol rooms, DMs, group chats, search, mentions, reactions, reply/quote, edit-last-message, moderation — `/docs/commands/chat`
- Permission tiers: `public_read`/`public_write`/`user_write`/`user_only`/`admin_write` — `/docs/commands/chat`
- Account tiers named: anonymous → "piker" (free) → paid subscriber → admin; free tier capped at 2 News windows/screen — `/docs/commands/chat`, `/docs/commands/n`, `/docs/commands/brok`
- Market objects inside messages: `$TICKER` live quote pill, `{AAPL EQ G}` inline chart, `@user`, emotes, optional YouTube embed — `/docs/commands/chat`
- `#general` chat feed directly powers `WJI` — `/docs/commands/chat`, `/docs/commands/wji`

*Brokerage, pricing, entitlements*
- `BROK` read-only brokerage connection **via SnapTrade** — same 15-broker roster, same read-only posture, same IBKR Flex-Query special case as UCT's own Journal 2.0 broker sync; BETA — `/docs/commands/brok`
- `$118/mo`, `from $996/yr` (~30% off), 14-day free trial, `+$30/mo` FINRA surcharge, Team/Enterprise tier with compliance/audit tools, self-service cancellation via in-terminal `ACM` — `/pricing`
- `ENT` à-la-carte exchange entitlements, self-service subscribe/unsubscribe, shows Retail vs Professional rate per feed, prorated billing, BETA — `/docs/commands/ent`
- `CHANGE` in-terminal changelog with `{COMMAND}`/`[EXPR]` pills — no public web changelog exists (`/changelog`, `/docs/change` both 404); release history is behind the login — `/docs/commands/change`
- `{ERR}` bug-report dialog is itself a command — `/docs/commands/change`
- Trading/order entry **VERIFIED ABSENT** — `/docs/commands/brok`: "Access is read-only"
- Backtesting **VERIFIED ABSENT** — no such command in the 48-command index
- Public self-serve API **VERIFIED ABSENT today** — `/pricing` FAQ: "Coming soon."
- Company founding, funding ($2M pre-seed Jul 2024 + $5M seed Jan 2026 = $7M total), team size implied single-digit-to-low-double-digit engineering — `/careers`, `/news`

### CLAIMED (marketing/founder statement, no artifact)

- "News in milliseconds" latency — homepage, no methodology
- ">$2,000 in media subscriptions consolidated" — homepage, unsourced arithmetic
- Multi-asset coverage (equities, ETFs, indices, FX, futures, options, bonds) — `/traders` meta description only; **downgraded from VERIFIED (B-GDL-01) to CLAIMED (B-GDL-02)** when the page itself rendered as an empty shell under text extraction on re-fetch — see Reconciliation §1
- "USED TODAY BY: Hedge funds, Family offices, RIAs, Banks, Fortune 500 companies" — homepage banner, no named logos
- DARP ETF customer story, "saved ~$28,000/yr per analyst" — one attributed quote, one named customer, unverified independently
- Competitor price comparison (Bloomberg ~$27k, LSEG ~$22k+, FactSet $12–24k) — `/pricing` FAQ, Gödel's own characterization of third parties
- Enterprise REST/WebSocket API "on a case-by-case basis" — `/docs` footer; **contradicts** the `/pricing` FAQ's "Coming soon" — see Reconciliation §2
- `{SPLC}`/Atlas 3D supply-chain visualization ("flight mode") — founder's X post, ~Aug 2026; corroborates the feature is real but the only source is a tweet, not a docs page
- Brand-voice social content (`@GodelTerminal` CDS/LeBron riff post) — engagement tone only, no product claim

### REPORTED (third-party account)

- No self-serve/backtesting API exists as of ~Aug 2026 — X user (~Dec 2025) and r/GodelTerminal (~Aug 2026, unanswered), ~9 months apart, same unresolved ask
- Community programmatic access exists via unofficial means — `Hayden1629/algobot_v2` GitHub repo, mechanism unconfirmed (could be scraping)
- DL Software is a multi-product holding company (Godel + Dr. Gupta + Druglike) — Martin Shkreli LinkedIn profile via Google snippet
- Small in-house engineering team — Daniel Dietzel LinkedIn ("Frontend Lead @ Godel Terminal") corroborating the 3-4 open roles on `/careers`
- Value-vs-incumbent hesitation: "$80/mo for something I don't really need... when I can get the same thing with thinkorswim" — r/MartinShkreli, "Open Gödel?"
- Perceived overlap with an open-source alternative: "why I choose openBB over Gödel" — r/openBB thread title, plus a `GODEL30` referral code circulating
- A "Is Godel Terminal Safe?" question asked inside its own subreddit, 28 answers, mildly-positive top answer — r/GodelTerminal
- Founder reputational drag surfacing unprompted in unrelated threads — r/ValueInvesting ("owned by Martin Shkreli. Same guy that jacked up [drug prices]..."), r/Coffeezilla_gg (contagion from sibling product "Dr. Gupta")
- Independent outside-builder characterization matching the AI-absence finding: "Godel Terminal is more focused on live quote data and real-time [data]... review AI output the rest" — r/SideProject launch post, ~4mo old
- Historical ~$60/month price point implied by a ~1-year-old Reddit thread title, unconfirmed by thread body or Wayback snapshot
- No official GitHub org/repo confirmed to exist; a personal `martinshkreli` account (26 repos) referenced only via a third-party Linktree bio, not opened

### DEMONSTRATED

**Empty by construction.** See "How this dossier was built" and Section P. Video titles
exist and are catalogued in NOT INSPECTED, but every located video is excluded as evidence
under the preamble's affiliate-content ban (`?via=shkreliplanet`, `?via=theshkrelipill`,
`?via=HARDWARE` referral tags) or is on the founder's personal channel. Their **existence**
is REPORTED-tier corroboration that demo content exists somewhere; their **content** is
not cited anywhere in this dossier.

### SPECULATED (interpretive links this synthesis draws, flagged as such)

- That Gödel's paid-only TTS headline reader is powered by DL Software's own sibling
  product Neets ("a generative AI API for text-to-speech") — plausible given the shared
  parent company, never stated by either product's documentation
- That the AI omission from the terminal is a deliberate positioning choice rather than an
  unfinished roadmap item — B-GDL-02 names three candidate reasons (data licensing,
  hallucination risk in a regulated-adjacent context, focus) and settles none; this
  dossier settles none either
- That the tension between the homepage's institutional-audience banner and the one
  located third-party review's retail framing reflects a real dual-audience strategy
  rather than inconsistent marketing copy — unresolved, flagged as an open question below

---

## Section A — Executive Summary

**Godel Terminal** (site copy: plain "Godel"; external references often stylize "Gödel")
is a browser-based financial data terminal built by **DL Software Inc.**, a small,
venture-backed (**$7M** total across a $2M pre-seed round, Jul 2024, and a $5M seed round,
Jan 2026) New York startup co-founded by **Martin Shkreli**. It is explicitly labeled
"public beta" on its own homepage as of the fetch date. It positions itself as a
per-seat-priced alternative to Bloomberg/LSEG/FactSet — "**From $996 a seat**" against a
"$30,000 terminal [that] can't go on every desk" — and, distinctively among the products
this program is benchmarking, it **copies Bloomberg's command grammar deliberately**
(`AAPL US EQ G` mirrors `AAPL US Equity <GO>`; legacy Bloomberg mnemonics like `GIP`,
`GP`, `OPT`, `PDF` are accepted and rewritten internally). `benchmark-universe.md` frames
this as the program's single most instructive pairing: "Bloomberg · Gödel Terminal... same
interaction model, 30× price difference, one built by a giant and one by a small team...
the single most program-relevant comparison available." Stripped to what its own
documentation can support, Gödel is a keyboard-driven equities-and-options research
terminal whose deepest capability is news filtering, whose charting is bought wholesale
from TradingView, and whose two most distinctive assets (`TREND`, `WJI`) are datasets
manufactured from its own userbase at zero vendor cost. It ships **no AI capability of any
kind**, despite three of its four sibling products under the same parent company being AI
products. **CONFIDENCE:** 🟢 on identity, funding, and the shape of what's shipped
(unusually specific official documentation); 🔴 on quality, real usage, and shipping
velocity — see Section P.

## Section B — User Types

The evidence contains a genuine, unresolved tension rather than a settled persona set.

- **Institutional / professional, per Gödel's own homepage banner (CLAIMED):** "USED
  TODAY BY: Hedge funds, Family offices, RIAs, Banks, Fortune 500 companies" — no named
  logos shown in extracted text.
- **The one named, attributed customer (CLAIMED):** Thomas George, Portfolio Manager,
  DARP ETF (managed by Grizzle) — an institutional persona, consistent with the banner.
- **Retail / prosumer, per third-party framing (REPORTED):** the one independent review
  video located titles itself "...a promising new alternative to the Bloomberg Terminal
  for **retail investors**" (19.1K views, title only, not watched per the DEMONSTRATED
  ceiling); a Reddit poster explicitly compares it to ThinkOrSwim, a retail/brokerage-free
  platform, not an institutional one.
- **FINRA-registered professionals as a distinct billing class:** the pricing page's
  $30/month FINRA surcharge implies the company has built compliance-tier billing logic
  around at least some registered-professional users, whatever the marketing banner says.

**OPEN QUESTION (inherited from B-GDL-01, unresolved through all three leaves):** is Gödel
actually targeting institutional desks, prosumer/retail traders, or genuinely both, and
does the product differ by audience? Nothing in the evidence base settles this.

## Section C — Navigation

Command-grammar-first, not menu-first. The positional grammar
`<TICKER> <COUNTRY> <ASSETCLASS> <CMD>` (e.g. `AAPL US EQ G`) is the primary navigation
method; Bloomberg mnemonics are accepted and rewritten internally so a user's prior
Bloomberg muscle memory transfers without retraining. A full keyboard shortcut layer sits
alongside it: `` ` `` focuses the terminal, double-Esc closes a window, Tab/Shift+Tab
cycles windows, Shift+arrows moves, Ctrl+Shift+arrows snaps, Option+arrows resizes,
Option+Shift+arrows resizes-to-edge, ⌘Z undoes the last window close, F1 opens help.
Windows can be colour-linked (four documented colours implied by the "🔗 chain icon")
so switching a ticker in one window propagates to every other window sharing its colour —
functionally identical to UCT's own Charts-workspace colour groups A–D, arrived at
independently. The same grammar resolves inside chat messages and changelog entries as an
embeddable, clickable string (see Section D, Idea 1 in Section M) — navigation and
content-authoring share one addressing scheme.

## Section D — Capability Map

Condensed from the Evidence-Class Spine above, organized by the `/docs` index's own six
groupings (48 mnemonics total, measured 2026-09-02 — re-derive rather than trust this
count, it will drift):

| Group | Count (per index) | Shipped highlights | Documented gaps |
|---|---|---|---|
| Company & security analysis | 9 | `DES`, `FA`, `EM`, `SI`, `GR`, `ANR`, `DVD` | `EVT` COMING SOON |
| Market data & surveillance | 19 | `QM`, `N`, `TREND`, `WJI`, `WEI`/`WEIF`/`GLCO`/`FX`, `IMAP`/`HMAP` (BETA) | — |
| Portfolio & risk | 6 | `OMON`, `OVME`, `CALC`, `BROK` (BETA), `AUM` | `EQS` BETA, thin |
| Charting & technicals | 3 | `G` (TradingView-powered), `HMS`, `HP` | no native OS popout |
| Fundamentals & filings | 3 | `CF` (EDGAR), `IPO`, `TRAN` | US filings only, no other regulator named |
| Utilities & system | 8 | `CHAT`, `ACM`, `AL`, `NOTE`, `ENT` (BETA), `CHANGE` | no public changelog page |

The most consequential absences, each **VERIFIED ABSENT** by enumeration of the full
48-command index rather than by silence: **no AI/LLM/NL capability of any kind; no
technical/price/volume/momentum screening (EQS is fundamentals/valuation-only); no
options-flow/sweep/GEX/dark-pool/vol-surface analytics beyond a chain and a
Black-Scholes pricer; no backtesting; no self-serve API today; no live Excel add-in (file
export only); no order entry; no non-US filings coverage.**

## Section E — Workflows

The deepest documented workflow content in the product is in `N` (News), which ships **six
named setup workflows** in its own docs: breaking-news-only, watchlist-only, deep
single-company research, thematic/macro, noise-floor control, and a two-window
monitor-plus-discovery pattern. This is the one place Gödel's documentation teaches
*workflow*, not just controls. The other documented workflow is the options
**drill-through**: click a contract in `OMON` → launch directly into `FOCUS`, `G` (as an
option chart), or `OVME` (Black-Scholes), carrying the contract's price and Greeks forward
automatically — "chain → chart → pricer is a wired path, not a copy-paste." Onboarding is
a 14-day, no-card, self-serve trial that per `/pricing` opens "most of Godel: real-time
Nasdaq quotes, news in milliseconds, SEC filings, financials, charting, and the full
command set." No other end-to-end workflow (a full day's session, an earnings-day routine,
a screening-to-trade-plan pipeline) is documented publicly.

## Section F — Data

- **Charting:** TradingView, licensed wholesale — Gödel builds the chrome, buys the chart.
- **Filings:** EDGAR (US) only. No non-US regulator is named anywhere in the evidence base.
- **Global markets:** `WEI`/`WEIF`/`GLCO`/`FX` claim coverage "across Americas, EMEA, and
  Asia/Pacific" by region, not by named venue count.
- **Multi-asset breadth** (equities, ETFs, indices, FX, futures, options, bonds): **CLAIMED
  only**, surviving in a meta description on a page (`/traders`) that renders as an empty
  shell under text extraction — see Reconciliation §1.
- **Brokerage data:** via SnapTrade, read-only, same 15-broker roster UCT's own Journal 2.0
  broker sync uses.
- **Entitlement gating is real and disclosed:** chart data is gated on the `AGGREGATE_RTH`
  feed; a security missing that feed renders an **empty chart, not an error** — a candid
  failure-mode admission and a genuine product wart in the same sentence.
- **Community-generated data:** `TREND` (search-count aggregation across all Gödel users)
  and `WJI` (chat-emoji sentiment) are proprietary datasets sourced from Gödel's own
  userbase at zero vendor cost — not bought from anyone.
- **Vendor/provenance transparency:** `FA` claims line-item→filing provenance on every
  financial-statement figure; not independently checkable from outside the product.

## Section G — Customization

Per-window settings persisted per account across sessions (`G`); colour-linked windows (up
to some number of named colours, tied by the 🔗 chain icon); `PDF` (Personal Defaults,
Bloomberg's own mnemonic reused) governs table animations (Fade/Flip
Board/Left Slide/Lightning/Red Alert/None), font sizes, ticker-click behaviour, and
TradingView focus-capture toggling; per-window instance caps are tier-aware (30 `G`
windows per screen on every tier; single-instance for `CHANGE`/`CHAT`/`BROK`/`ENT`); `N`'s
two-layer filter model (per-window vs global/account-wide) is itself a customization
architecture, not just a feature. No evidence of shareable/exportable workspace templates
was located (contrast UCT's own Charts-workspace named-layout system).

## Section H — Search / Commands

Covered in depth under Section C and the Evidence-Class Spine. The single most
distinctive fact: the command grammar is **reused as an embed/link format** across
subsystems that would otherwise need separate mechanisms — `{AAPL EQ G}` inside a chat
message, `{COMMAND}`/`[EXPR]` pills inside changelog entries, `{ERR}` opening a bug-report
dialog. One resolvable string, addressable from chat, release notes, and (by construction)
anywhere else in the product that renders text. See Idea 1 in Section M.

## Section I — AI

**None.** Verified absent by exhaustive enumeration of the 48-command index and the
homepage capability strip — no AI, LLM, natural-language, chat-with-your-data, agent,
copilot, or semantic-search surface of any kind. `CHAT` is human-to-human only. This
absence sits in explicit contrast with DL Software's other three disclosed products
(Neets generative-TTS API, Dr. Gupta "an AI physician," Shoggoth image generation), which
are all AI products. See Section D of the Design Principles below (P7) and Section M,
Idea 7.

## Section J — UX

**Strengths, per documentation depth:** a genuinely deep, two-layer News filter with an
audit panel that explains its own matches; a real window manager with colour-linking and
undo-close; a wired drill-through from options chain to chart to pricer; disclosed
failure modes stated in plain language rather than buried.

**Weaknesses, verified or reported:** a missing chart entitlement renders **blank, not an
error** — a "renders failure as fact" defect class UCT's own memory has hit before, now
independently observed in a competitor's own documentation; no native-OS chart popout;
persona landing pages (`/traders`, `/wealth-teams-family-offices`) render as empty shells
under text extraction, meaning even Gödel's own marketing pages have an accessibility/
renderability gap for anyone (human or tool) not using a full browser; `EQS` is thin and
beta while simultaneously being the only answer to "does it screen?"; two official pages
disagree about API availability on the same day (Reconciliation §2).

## Section K — Performance

**NOT DETERMINED.** No latency, load-time, or density measurement was collected or is
collectable without a trial seat or a running instance. The only performance-adjacent
claim in evidence is "News in milliseconds" (CLAIMED, homepage marketing copy, no
methodology or comparison basis) and "debounced into the window props (≈300ms)" language
in `OMON`'s own docs describing its own navigation-control implementation detail (VERIFIED
as *documented behaviour*, not as *measured* responsiveness). What would determine this: a
trial seat with a stopwatch against a known catalyst, per Section P item 6.

## Section L — Pricing / Business Model

| Item | Value | Class |
|---|---|---|
| Monthly | $118/mo | VERIFIED |
| Annual | from $996/yr (~30% off, ≈$83/mo equivalent) | VERIFIED |
| FINRA surcharge | +$30/mo (+$360/yr on Annual) | VERIFIED |
| Free trial | 14 days, no card required, "most of Godel" | VERIFIED |
| Team/Enterprise | custom quote, multi-seat, compliance/audit tools, dedicated rep | VERIFIED |
| Self-service cancellation | in-terminal `ACM` → Manage Billing | VERIFIED |
| Named competitor prices (Bloomberg ~$27k, LSEG ~$22k+, FactSet $12–24k) | company's own characterization | CLAIMED |
| Historical ~$60/mo price point | implied by a ~1yr-old Reddit thread title | REPORTED, unresolved |
| Entitlement à-la-carte pricing (`ENT`) | per-feed Retail vs Professional rate, prorated | VERIFIED as BETA |

**Business model:** per-seat SaaS subscription, explicitly positioned as democratizing
access ("everyone gets their own [terminal]" instead of a shared/rationed Bloomberg seat),
plus a regulatory-surcharge line item and an enterprise upsell tier that bundles
compliance tooling. The only disclosed capital is $7M across two rounds (pre-seed +
seed) — this is a small, still seed-stage company by venture standards, not a scaled
challenger.

## Section M — Best Ideas for UCT (transferable ideas, VERIFIED tier only)

All seven ideas below rest on Gödel capabilities that are VERIFIED (official documentation
describes them as shipped), per B-GDL-03. None is a requirement; each is a hypothesis for
synthesis to weigh, with its own cost-to-try estimate (this dossier's own
order-of-magnitude judgement, not sourced from Gödel) and cargo-cult risk.

**1. The command string as a universal hyperlink, not just an input.** `{AAPL EQ G}`
resolves identically as a chat embed, a changelog pill, and a bug-report launcher — one
grammar reused as the interchange format across subsystems. **UCT relevance:** a canonical
`{TICKER TF WIDGET}` string that resolves the same way in the Discord bot, the wire's
`rundown_html`, and Journal 2.0 notes would unify several ad hoc "reference this ticker"
conventions UCT already has separately. **Cost:** ~1–2 engineer-weeks for a v1 scoped to
one surface (Journal 2.0 notes, which already has a WYSIWYG editor and a
`SaveQuoteButton` precedent for embedding structured content). **Risk:** Gödel controls
every rendering surface inside its own terminal; UCT's candidate surfaces span a
third-party Discord bot, a `dangerouslySetInnerHTML` wire fragment, and a React app —
three different rendering/security models. Scope v1 to surfaces UCT fully controls; treat
Discord/wire resolution as a gated second phase.

**2. Explain the filter, not just the result ("why am I seeing this").** `N`'s Info panel
enumerates every active filter and shows inline snippets of *why* an article matched.
**UCT relevance:** this is the idea B-GDL-02 flagged as most independently convergent with
UCT's own `CoverageLine` idiom on `/screener` (evaluated · answered · dropped · not
computable) — the same instinct, arrived at independently, applied to a feed instead of a
screen. Direct candidates: the Catalyst Table's 8-source composite score (currently
invisible to the member which sources fired), `grade_ticker`'s already-typed `sources`
field (server-side data exists; this could be a frontend-only audit panel), and the News
feed's own AlphaVantage-vs-RSS fallback split. **Cost:** ~3–5 days for the `grade_ticker`
instance (frontend-only, data already computed); ~1–2 weeks for a Catalyst Table version
(needs a schema change to store per-source attribution). **Risk:** low — but building a
*third*, differently-shaped "why" idiom alongside `CoverageLine` risks the same
second-authority-over-one-value problem UCT's own lessons flag elsewhere; factor toward
one shared component if this is pursued.

**3. Manufacture proprietary datasets from the userbase, at zero vendor cost.** `TREND`
and `WJI` cost nothing per month and cannot be bought by a competitor without a comparable
userbase. **UCT relevance:** direct, independent validation of the `/buzz` thesis already
live in production (counting ticker mentions in Discord `#main-chat`) — Gödel arrived at
the same category of idea independently and ships it as a first-class command with a
sparkline and multiple lookback windows. **Cost:** near-zero — this validates in-flight
work rather than proposing new work; ~2–4 days if `/buzz` lacks the multi-window sparkline
presentation. **Risk:** low for the `TREND` analogue (already validated); higher for a
`WJI`-style sentiment-from-emoji derivative, since UCT's community lives on a third-party
platform (Discord) rather than an in-app chat Gödel fully controls, and `/buzz`'s own
build history already had to purge junk collisions once — an emoji-sentiment signal is
plausibly noisier still.

**4. Buy the commodity, build the chrome — and the same broker-vendor choice as UCT, once.**
Charting is bought wholesale from TradingView; brokerage connectivity is bought from
SnapTrade — the same vendor, same read-only posture, same 15-broker roster, same IBKR
special case as UCT's own Journal 2.0 broker sync. **UCT relevance:** the SnapTrade
finding is strategic reassurance, not a new build — a comparably-resourced, differently-
constrained competitor independently reached the identical vendor call. The charting call
is the opposite fork (UCT built Lightweight Charts in-house with years of accumulated
correctness work); Gödel's example is evidence the buy-side is *viable*, not evidence UCT
chose wrong. **Cost:** $0 — an architecture-decision input, not a build. **Risk:** it would
be cargo-culting to read "Gödel bought its chart, so UCT's investment was wrong" — the
comparison would need to weigh what UCT's charting differentiates on (options overlays,
drawing persistence, colour-linked workspace) against maintenance cost, which is out of
scope here.

**5. Beta/status labels placed at the point of use, not buried in a changelog.** `EQS`/
`IMAP`/`HMAP` carry BETA pills directly on the `/docs` index; `/pricing` runs a
two-column "In Godel today / Working on" strip a prospect sees before paying. **UCT
relevance:** the member-facing analogue of UCT's own internal `feature_flag_ledger` work
("off-and-unset is indistinguishable from off-on-purpose"). **Cost:** ~1–2 days for a
reusable `<StatusPill>` component consuming the existing flag ledger — the hard part is a
product decision (which surfaces to label), not engineering. **Risk:** Gödel's own beta
surface is wider than its pills admit (`BROK`/`ENT` are called beta only in prose); the
anti-pattern to avoid is letting "beta" become a permanent state that exempts a thin
surface from judgement — see Section N.

**6. Wired drill-through: one click carries context across surfaces.** `OMON` → click a
contract → launches into `FOCUS`/`G`/`OVME` pre-filled with that contract's data, not a
copy-paste. **UCT relevance:** narrow and specific — not "build an options chain" (UCT's
OptionsFlow is already ahead of Gödel's chain-plus-pricer-only offering) but the
interaction pattern of a pre-filled handoff. Whether OptionsFlow already does this is not
established by this evidence base. **Cost:** a few days if target surfaces already exist —
**but this touches `OptionsFlow.jsx`, partner-owned code (Ravi co-edits it); do not treat
"a few days" as license to touch it without the standing coordination step.** **Risk:**
moderate, entirely in the "don't touch partner-owned files without ack" direction, not in
the idea itself.

**7. The AI absence as a strategic contrast, not a capability to copy.** Zero AI anywhere
in the terminal, despite three of DL Software's other four products being AI products.
**UCT relevance:** the sharpest available contrast in the whole benchmark set — UCT's own
differentiation (Compass's 10 coaching surfaces, `grade_ticker`, the Brain Pack bridge, AI
Search, the report-card eval harness) sits precisely on the axis a comparably-resourced
competitor has visibly chosen not to compete on. **Cost:** N/A — an observation, not a
build. **Risk:** the risk runs backward from every other idea here: it would be
cargo-culting Gödel's *absence* to conclude UCT should de-prioritize its own AI
investment because a competitor skipped it — one competitor's non-investment is not
evidence against UCT's different bet.

## Section N — Bad Ideas for UCT (anti-patterns)

1. **Letting "beta" become a permanent, permission-granting label rather than a temporary
   one.** `EQS` is simultaneously the terminal's only answer to "does it screen?" and a
   thin, beta-tagged fundamentals-only filter set with zero technical/price/volume
   criteria. The label lets it stay unfinished without being judged as unfinished.
2. **Rendering a missing entitlement as a blank surface instead of an explicit error.**
   `G`'s own docs admit a security missing the `AGGREGATE_RTH` feed produces an **empty
   chart** — the "renders failure as fact" defect class, independently observed in a
   competitor's own documentation.
3. **Leaving a publicly promised, front-page capability unresolved for many months with no
   dated commitment.** The self-serve/backtesting API has been "Coming soon" across at
   least two independent public asks roughly nine months apart (Dec 2025 → Aug 2026),
   unanswered both times. At some point "coming soon" stops functioning as a roadmap.
4. **A single-founder-personality-dependent marketing/demo channel, with no official video
   channel.** Every located product video is either affiliate-tagged or on the founder's
   personal account. This is the direct cause of this dossier's own DEMONSTRATED-tier
   ceiling, and REPORTED-tier evidence shows the founder's own controversial public history
   surfaces unprompted in unrelated community discussion, i.e. it is a real reputational
   drag on the product, not merely an evidence-access inconvenience for outside research.
5. **A growth channel built on affiliate/referral-coded video rather than an owned
   channel.** Undermines any outside party's — evaluator or prospect alike — ability to
   verify product claims independently, and is itself the mechanism that produced the
   evidence ceiling above.
6. **Marketing copy claiming broad institutional usage with zero named-logo proof.**
   "Hedge funds, Family offices, RIAs, Banks, Fortune 500 companies" sits on the homepage
   with no verifiable names behind it, alongside exactly one named, attributed customer.
7. **Two official pages giving contradictory answers to the same question.** `/pricing`'s
   FAQ says the API is "Coming soon"; `/docs`'s footer says enterprise REST/WebSocket
   access exists today "on a case-by-case basis" — both live, same day, unreconciled. A
   second authority over one value, visible to any careful prospect. See Reconciliation §2.

## Section O — Screenshots / Evidence

**No screenshot or video evidence exists in this dossier.** Per the evidence-class spine,
DEMONSTRATED is structurally empty: the docs pages reference "the screenshot above" in
prose (e.g. `/docs/commands/g`: "Checked items in the screenshot above are the defaults")
but no image element was found exposed in the accessibility tree of the pages fetched, and
no visual screenshot was taken to settle whether images render as CSS backgrounds or are
simply absent — B-GDL-02 makes **no claim** either way, only that no citable dated
screenshot artifact was obtained. Every citation in this dossier is a text artifact: an
official docs/pricing/homepage page, a search-result snippet, or a thread title. The
program's evidence index (see SOURCES) is therefore the closest thing to an "evidence
gallery" this dossier can offer.

## Section P — Confidence, and the structural ceiling

**Per-section confidence:**

| Section | Confidence | Why |
|---|---|---|
| A (Executive Summary), L (Pricing) | 🟢 | Directly sourced from official pages, re-confirmed across two independent fetches (B-GDL-01, B-GDL-02) the same day |
| D (Capability Map), Evidence-Class Spine | 🟢 existence/shape · 🔴 quality | Documentation depth is unusual and specific; nothing establishes whether any of it works well |
| B (User Types) | 🟡 | Genuine, unresolved tension in the evidence itself (institutional banner vs. retail review framing) |
| I (AI) | 🟡 | Absence is exhaustively documented but could theoretically be an undocumented in-terminal feature reachable only via `CHANGE` |
| K (Performance) | 🔴 NOT DETERMINED | No measurement collected or collectable without a trial seat |
| N (Anti-patterns) | 🟢 | Each is a direct quote or enumeration from official documentation, not inference |

**The structural ceiling, restated:** DEMONSTRATED is unreachable from any permitted
source for this product. No official Gödel video channel exists; the only located video
content is affiliate-`?via=`-tagged or on the founder's personal channel, both excluded by
the external preamble's ban on affiliate content as evidence. `WebSearch` was exhausted
before this pod began (shared 200/200 session cap, per the external preamble); every
browser fact in the three leaves was gathered via one-tab Google/Reddit browsing, closed
on completion. `WebFetch` against `godelterminal.com` itself returns HTTP 403
(bot-blocking) — every official-page citation in this dossier was captured via the browser
tool's `get_page_text`, never a direct fetch.

**What a trial seat (OI-18) would settle, ranked by value:**

1. **Open `CHANGE` and photograph the whole changelog.** Highest value per minute —
   converts every "Working on"/"coming soon" item into a measured shipping cadence, and is
   the *only* way to see release history (no public changelog exists).
2. **Is the AI absence real?** Type obvious probes into the command bar and check `HELP`.
   Section I's finding rests entirely on absence-of-evidence in public docs.
3. **How good is the news feed, actually?** The one thing worth genuinely envying on paper.
   Measure wall-clock latency of a known catalyst against UCT's own tape; test whether the
   include/exclude and class-action filters hold on a noisy pre-market session.
4. **Is `EQS` usable for a momentum desk?** Section D says no on the documented field
   list. Confirm by trying to express one real UCT screen (price > 20EMA, ADR > 4%, volume
   at an N-week low). Expect failure; confirm it.
5. **Options depth beyond the chain.** Confirm there is no flow/sweep/GEX/IV-rank surface
   anywhere; check whether Rho/Lambda/Epsilon suggest a real pricing model or a passthrough.
6. **Does the command grammar actually feel fast?** The whole thesis of the "hyperlink
   grammar" idea is ergonomic and cannot be read off a page. Time a realistic sequence
   (open a name → chart → chain → news → alert) against TERMINAL-CURRENT.
7. **What is really in `ENT`?** The entitlement list with Retail vs Professional prices is
   the actual market-data cost structure of a competitor, visible nowhere else publicly.
8. **Data coverage at the edges.** Small caps, ETFs, non-US names, options on ETFs/indices.
9. **Photograph the docs-screenshot question.** Confirm whether the product visually
   matches its own documentation — trivial once inside, impossible outside.

**What a trial would still NOT settle:** enterprise API terms and pricing (sales-gated);
`PORT` and other unshipped roadmap items; real customer count or churn; whether the "USED
TODAY BY" institutional claims are true; whether the DARP ETF saving is representative.
Those need a sales conversation or practitioner interviews, not a seat.

**Owner action required (OI-18, unresolved as of this synthesis):** the
`OWNER_INPUTS_REQUESTED.md` ledger records the current disposition as "No trials;
ceilings recorded" — the owner has not yet opened the 14-day, no-card, self-serve trial
that would raise this dossier's evidence ceiling. `benchmark-universe.md` independently
flags this as "the single most instructive benchmark from 🟡 to 🟢... the single most
program-relevant comparison available," and its own source table already flags "⚠️
affiliate-source hazard" for anyone attempting to reach the trial via a search result
rather than the direct URL. **Recommendation to the program: if the owner opens the
trial, item 1 above (`CHANGE`) should be the first screenshot taken.**

---

## What is real today

Strip out everything unverifiable and Gödel is a **keyboard-driven, browser-hosted
research terminal for equities**, whose centre of gravity is **news**, whose charting is
**licensed from TradingView**, and whose most distinctive assets are **generated by its
own users rather than bought from a data vendor**. Concretely, load-bearing because the
documentation behind each item is unusually specific:

1. A Bloomberg-compatible command grammar with a real window manager — positional
   `TICKER COUNTRY ASSETCLASS CMD`, Bloomberg aliases rewritten internally, resolution
   arguments, colour-linked windows, ⌘Z to undo a window close, 30 charts per screen. This
   is the part of Bloomberg Gödel actually clones: the *interaction model*, not the data.
2. News as the flagship, and it is genuinely deep — a two-layer filter model, tri-state
   source selection, 20 includes and 20 excludes, a dedicated class-action spam filter,
   curated one-click defaults, TTS headline reading, a breaking-news banner, and an audit
   panel that explains why a given article did or did not reach you. The one named
   customer's quote is about exactly this capability.
3. Options: a competent chain and a pricer — full Greeks including Rho, Lambda and
   Epsilon, websocket streaming, per-mode column layouts, a wired drill-through from
   contract → `FOCUS`/chart/Black-Scholes. Nothing beyond that.
4. Fundamentals and filings — standardised three-statement financials with claimed
   line-item→filing provenance, EDGAR filings rendered in-product, a forward-estimate
   matrix with analyst ratings and targets.
5. Two datasets nobody else has, made from its own community — `TREND` and `WJI`. Both
   cost nothing to source and cannot be replicated by a competitor without a comparable
   userbase.
6. A real social layer, not a support widget — auto-created per-ticker rooms, DMs,
   groups, permission tiers, moderation, live quote pills and embedded charts inside
   messages.
7. Read-only brokerage connection via SnapTrade, paid-only, in beta.
8. A working commercial spine — self-service entitlements with Retail/Professional rates,
   in-terminal billing management, a named free tier ("piker") with specific caps.

**Equally real, and equally important: what is verifiably NOT there.** No AI or
natural-language layer of any kind. No technical/price/volume screening. No options flow,
gamma, or dark-pool analytics. No backtesting. No portfolio analytics. No self-serve API.
No live Excel add-in — only CSV/JSON download. No order entry. No non-US filings.

**For Terminal-Next's desk persona** (equities and options, momentum/swing workflow), the
honest read is that Gödel is **strong exactly where UCT is weak** (news filtering, command
grammar, window management, breadth of fundamental reference data) **and absent exactly
where UCT is strong** (options flow, technical screening, setup/pattern work, AI
coaching). It is a reference for *interaction design*, not a competitor for the desk's
actual daily job. Stated as observation, not a requirement.

## What is promised

Gödel's roadmap is unusually legible because it is published in three places at three
levels of commitment:

| Where | Mechanism | Content |
|---|---|---|
| `/pricing` | "✓ In Godel today / … Working on" two-column strip | **Working on:** `PORT` Portfolio analytics · `MEMB` Index membership · `EQS` deeper screening (v2/v3) · `GF`/`EQRV` time series · deeper ETF/mutual-fund coverage · more private-company data · Podcasts |
| `/docs` index | Per-command status pills | `EVT` COMING SOON; `EQS`/`IMAP`/`HMAP` BETA |
| Individual docs pages | Prose status | `BROK` "currently in beta"; `ENT` "in beta"; `EQS` "under active development" |
| `/pricing` FAQ | | API: "Coming soon. If you'd like to beta test it or join the waitlist, talk to us." |
| Homepage | | "Godel is currently in public beta and many commands are under development." |

**In Gödel's favour:** the beta labelling is placed at the point of use, not buried in a
footer — a prospect sees BETA on the screener pill before clicking, and the pricing page
voluntarily prints its own gaps beside its own strengths. That is a deliberate,
commercially costly transparency choice.

**Against:** the beta surface is wider than the pills admit (`BROK`/`ENT` are beta only in
prose; the whole product is "public beta" per the homepage), and the API has been "coming
soon" across at least two public asks nine months apart with no dated commitment. At some
point "coming soon" stops being a roadmap and becomes a way of not answering.

**No dated commitment exists for any roadmap item, and no public changelog exists to
measure historical shipping velocity against** — `CHANGE` holds that history behind the
login, which is item 1 in Section P's ranked trial-seat list.

---

## Design principles the product actually embodies

Derived from the docs and the product's own structure — explicitly not from tweets,
marketing copy, or the founder's videos, per contract.

**P1 — Inherit the muscle memory; do not ask for retraining.** Bloomberg's grammar is
copied, not merely echoed. The wedge is not a better interface — it is the same interface
at 3% of the price. **UCT relevance:** UCT's members come from TradingView, ThinkOrSwim,
and Discord, not Bloomberg. The principle transfers; the specific vocabulary does not —
copying Bloomberg mnemonics into Terminal-Next would import muscle memory nobody on this
desk has.

**P2 — The command string is a hyperlink, not just an input.** One grammar, addressable
from chat, release notes, and (by construction) anywhere else in the product that renders
text. The most architecturally interesting thing Gödel has done. **UCT relevance:** high
and cheap to trial — see Section M, Idea 1.

**P3 — Explain the filter, not just the result.** `N`'s audit panel treats "why am I
seeing this / why am I not" as a first-class question. **UCT relevance:** the same
instinct as UCT's own `CoverageLine`, arrived at independently — see Section M, Idea 2.

**P4 — Manufacture data from the userbase.** `TREND` and `WJI` cost nothing per month and
cannot be bought by a competitor without a comparable userbase. **UCT relevance:** directly
validates the `/buzz` thesis already in production — see Section M, Idea 3.

**P5 — Buy the commodity, build the chrome.** Charting is TradingView, wholesale;
brokerage is SnapTrade; filings are EDGAR passthrough. Gödel spends its engineering on the
command grammar, the window manager, the news filter, and the community datasets — the
parts that differentiate. **UCT relevance:** a genuine strategic fork against UCT's
in-house charting investment — see Section M, Idea 4. Gödel's example is evidence the
buy-side is viable, not evidence UCT chose wrong.

**P6 — Disclose the failure modes.** "Chart data is gated on the AGGREGATE_RTH feed; if a
security is missing that feed, the chart area will render empty." "G does not popout to a
native OS window." "EQS is in beta." "Access is read-only." Vendor documentation that
names its own blank states and limitations is rare and is a real signal about the team.
**Caveat:** it also reveals a genuine wart — a missing entitlement produces a blank chart,
not an error message, the "renders failure as fact" defect class UCT has hit before. See
Section N, anti-pattern 2.

**P7 — Deliberately not an AI product.** The strongest negative principle. The parent
company ships a generative-TTS API, an AI physician, and an image-generation app; the
terminal ships no AI at all. **UCT relevance:** the clearest contrast in the benchmark set
and the sharpest strategic question it raises — UCT's differentiation is precisely the
axis Gödel has abandoned. That is either UCT's moat or a warning the axis is harder to
monetise than it looks. Nothing in this evidence base settles which. See Section M, Idea 7.

---

## Practitioner complaints (REPORTED tier only)

Per contract, explicitly REPORTED-tier — third-party accounts, not this dossier's own
judgement, gathered via unauthenticated Reddit/Google browsing (title + visible snippet
only; no thread was read past its first answer). None of these are mechanical
product-quality complaints in the Bloomberg-benchmark sense (nobody in the visible
snippets says "the chart is buggy" or "the news feed is slow") — every REPORTED complaint
located is about **trust, price-justification, or differentiation**, which may reflect
what's easy to find in a short unauthenticated pass rather than the true complaint
distribution.

- **Value-vs-incumbent objection** (r/MartinShkreli, "Open Gödel?", ~1yr old): *"I want to
  join Gödel, but 80$ a month for something I dont really need is a little steep,
  especially if I can get the same thing with thinkorswim."*
- **Perceived overlap with an open-source alternative** (r/openBB, "why I choose openBB
  over Gödel", ~1yr old): thread title states a practitioner chose the open-source
  competitor; a `GODEL30` referral code circulates in the same discussion.
- **A trust/safety question asked inside the product's own community** (r/GodelTerminal,
  "Your Experience: Is Godel Terminal Safe? Worth $60/Month?", ~1yr old, 28 answers): the
  fact the question needed asking is itself the signal, independent of the top answer
  being mildly positive.
- **Reputational drag from the founder, surfacing unprompted** (r/ValueInvesting,
  "Bloomberg Terminal Alternatives", ~1yr old): *"I believe Godel is owned by Martin
  Shkreli. Same guy that jacked up [drug prices]..."* — corroborated by a second signal,
  r/Coffeezilla_gg community investigative attention linking Gödel to sibling product "Dr.
  Gupta"'s own controversy (reputational contagion from the shared parent, not Gödel-
  specific conduct).
- **Recurring, unresolved API demand** — spanning ~9 months across two independent public
  channels (X, ~Dec 2025; r/GodelTerminal, ~Aug 2026, unanswered at fetch), the same unmet
  need recurs.
- **An outside builder's characterization corroborates the AI-absence finding from a
  second vantage point** (r/SideProject, ~4mo old, competing solo-built tool's launch
  post): *"Godel Terminal is more focused on live quote data and real-time [data]...
  review AI output the rest, same as most of the industry."*

**CONFIDENCE:** 🟡 — each item is a single thread title plus a short visible snippet
(unauthenticated Reddit access), not a read comment thread. Directionally consistent
across independent subreddits and one outside builder, which is why they are reported
together rather than individually, but none was read in full.

---

## Reconciliation — disagreement among the three leaf reports

### §1. Multi-asset coverage claim: VERIFIED (B-GDL-01) vs. downgraded to CLAIMED (B-GDL-02)

**Position A (B-GDL-01):** "Multi-asset coverage claimed on `/traders` page (Google-cached
meta description, not independently re-verified by direct page read due to a rendering
miss in this session): 'equities, ETFs, indices, FX, futures, options, and bonds.'" Listed
in the "Shipped, per official docs/pricing pages (VERIFIED)" bucket, with a caveat about
the rendering miss already flagged inline.

**Position B (B-GDL-02):** Re-fetched `/traders` (and `/wealth-teams-family-offices`) in
the browser directly: "**both render as empty shells** under text extraction (only a
'Related' link block)." Explicitly downgraded the claim from VERIFIED to CLAIMED: "Persona
landing pages are JS/animation-driven and yield no extractable body copy. B-GDL-01 hit the
same wall. Downgraded from VERIFIED — the claim survives only in a meta description."

**Evidence:** Both roles attempted the same URL (`/traders`) on the same day and got the
same result — an unreadable page body, with the multi-asset claim surviving only in a
search-engine-cached meta description, never in content either role could extract
directly.

**Resolution:** **CLAIMED**, not VERIFIED — B-GDL-02's classification stands, adopted
throughout this dossier (see Evidence-Class Spine, Section F). This is not a genuine
disagreement between the two roles' *observations* (both got the same empty page); it is
a correction of B-GDL-01's initial classification once the specific rendering failure was
confirmed rather than merely suspected. The underlying fact — Gödel's own persona pages
are not readable by text extraction, meaning even the company's own marketing surface has
an accessibility gap — is itself folded into Section J (UX weaknesses).

### §2. DEMONSTRATED-tier reachability: catalogued as evidence (B-GDL-01) vs. declared structurally unreachable and excluded (B-GDL-02)

**Position A (B-GDL-01):** Catalogued four Shkreli-hosted demo videos and one third-party
review video by title/channel/date as "DEMONSTRATED (existence only — no transcript
read)" — treating the *existence* of video content, cited by title, as a legitimate
evidence-tier entry in the source table (source #12).

**Position B (B-GDL-02):** Investigated further and found every located video is either
on an affiliate channel carrying a `?via=` referral/discount code (`shkreliplanet`,
`theshkrelipill`, `HARDWARE`) or on the founder's personal channel — both categories
explicitly barred as evidence by the external preamble's ban on affiliate content.
Concluded: "**DEMONSTRATED is unreachable from permitted sources**... There is no official
Gödel Terminal YouTube channel." B-GDL-02's own source list downgrades the same video
listings to "establishes **absence** of an official channel and the affiliate `?via=`
referral pattern... — 2026-09-02," i.e. cites them only to prove the ceiling exists, never
to support any capability claim.

**Evidence:** Both roles looked at the same YouTube search results; B-GDL-02 went one step
further and checked each channel's description/monetization pattern, which B-GDL-01's
budget did not reach.

**Resolution:** **B-GDL-02's tighter application of the preamble governs this dossier.**
DEMONSTRATED is treated as structurally empty throughout (see Evidence-Class Spine). The
video titles are preserved only as REPORTED-tier corroboration that demo content exists
somewhere and as the explanation for the evidence ceiling itself (Section P, NOT
INSPECTED) — never as support for any specific capability claim. This is not a factual
disagreement (B-GDL-01 never claimed to have watched anything either) but a
classification tightening this synthesis adopts as more faithful to the preamble's
affiliate-content ban.

**No other disagreement rising to the level of contradictory factual claims was found
between the three leaves.** B-GDL-02's deeper pass through individual command docs pages
added roughly 30 commands B-GDL-01 never opened and refined several classifications (e.g.
`EQS`'s screening gap, `BROK`'s SnapTrade wiring) — these are depth additions, not
disagreements, and are folded into the Evidence-Class Spine and Section D without a
separate reconciliation entry. B-GDL-03 introduced no new capability claims by design
(explicitly scoped to work only from B-GDL-02's VERIFIED/DEMONSTRATED table) and
introduced no conflicting classification.

---

## GAPS

- **Search channel used throughout the underlying research:** WebFetch first (returned
  HTTP 403 against `godelterminal.com` — bot-blocking), then browser-based Google search
  in one tab per role, closed on completion, per the external preamble's mandated fallback
  order. `WebSearch` was not attempted in any of the three leaves — the preamble recorded
  the shared session cap as exhausted (200/200) before this pod began.
- **This synthesis performed no new web research.** The contract permits re-checking one
  cited page on a conflict; this was judged unnecessary because B-GDL-02 had already
  independently re-fetched both sides of the one live factual conflict (the API-
  availability contradiction, Reconciliation §2 as originally scoped, now folded into the
  Evidence-Class Spine's CLAIMED section) on the same day B-GDL-01 first found it, and
  explicitly confirmed neither page was a stale cache.
- **DEMONSTRATED unreached, structurally** — this dossier's headline ceiling. No official
  Gödel video channel exists; all located product video is affiliate-tagged or on the
  founder's personal channel. No transcript was pulled and none is cited anywhere in this
  document. *What would raise this:* the owner opening the 14-day trial and taking dated
  screenshots — OI-18 itself, unresolved as of this synthesis.
- **Docs-screenshot question unresolved.** `/docs/commands/g` prose references "the
  screenshot above" but no image element was found in the accessibility tree of the pages
  read; no visual screenshot was taken to settle whether images render as CSS backgrounds
  or are genuinely absent. No claim is made either way.
- **Persona/marketing pages are unreadable by text extraction** — `/traders` and
  `/wealth-teams-family-offices` render as empty shells (a "Related" link block only)
  under both roles' attempts. Other unopened persona pages:
  `/corporates-investor-relations`, `/equity-research`, `/real-time-market-news`,
  `/financial-terminal`, `/sec-filings`.
- **~30 of the 48 command docs pages were never opened** within any role's budget. Opened
  in full across the three leaves: `g`, `omon`, `eqs`, `n`, `chat`, `wji`, `trend`, `brok`,
  `ent`, `change`. Everything else is VERIFIED at existence/naming level only, from the
  `/docs` index. Individually cheap to open (one navigate + one text extract each) —
  would firm up `DES`, `FA`, `EM`, `QM`, `AL`, `TAS`, `HMS`, `TRAN`, `SECF`, `AUM`, `PDF`
  in particular.
- **No public changelog exists.** `/changelog` and `/docs/change` both 404; release
  history lives behind the login in `CHANGE`. Shipping velocity is unmeasurable from
  outside — a real ceiling on any "are they executing?" judgement, and the top-ranked item
  in Section P's trial-seat priority list.
- **No Reddit thread was read past its title + top visible snippet** in any of the three
  leaves — `old.reddit.com` login-walled, `www.reddit.com`'s search JSON endpoint returned
  empty or login-walled results, and click-through navigation attempts failed against a
  stale element reference. The "28 answers" community sentiment referenced in one thread
  was never read directly.
- **X/Twitter accessed unauthenticated throughout** — both `@GodelTerminal` and
  `@MartinShkreli` profile pages, viewed logged-out, surfaced only the single latest/
  pinned post each; no scrollable timeline was reached at any point across the three
  leaves.
- **No official GitHub org/repo confirmed to exist.** A personal `martinshkreli` account
  (26 repositories, per a third-party Linktree bio) was never opened.
- **Historical ~$60/month pricing claim remains unresolved** — a Wayback Machine snapshot
  of `/pricing` or the original Reddit thread body would settle whether this reflects real
  historical pricing drift or a misremembering; neither was attempted.
- **Practitioner-complaint sample is small and possibly skewed toward trust/price
  objections**, because those are what surface in short, unauthenticated search snippets —
  a full-thread read (28–35 answers per thread, per Google's own counts) would likely
  surface mechanical/UX complaints this evidence base could not see.
- **Cost-to-try estimates throughout Section M** are this program's own order-of-magnitude
  judgement against known UCT architecture (CLAUDE.md, session memory), not sourced from
  Gödel or independently estimated by anyone else — flag as such in further synthesis, do
  not treat as a quoted engineering estimate.
- Two SEO/affiliate domains (`godeldiscount.com`, `godelguide.com`) were identified and
  correctly excluded as evidence throughout — noted here only as an observation of the
  affiliate/SEO ecosystem around this product, which any future pass should also avoid
  citing.

## SOURCES

Merged and deduplicated from all three leaf reports plus the Gödel rows of
`benchmark-universe.md`. All official-page fetches below are dated **2026-09-02**.

**Official primary — godelterminal.com (VERIFIED):**

1. `https://godelterminal.com` — homepage: capability strip, positioning, DARP customer story, public-beta admission
2. `https://godelterminal.com/pricing` — pricing table, FAQ, "In Godel today / Working on" roadmap strip
3. `https://godelterminal.com/docs` — 48-command index, keyboard-shortcut table, API footer statement
4. `https://godelterminal.com/careers` — founding story, funding, team size/roles, hiring process
5. `https://godelterminal.com/news` — press releases (pre-seed, seed rounds) with dates and investor names
6. `https://godelterminal.com/press/pre-seed-round` — DL Software's full product portfolio (Godel, Neets, Dr. Gupta, Shoggoth)
7. `https://atlas.godelterminal.com` — "Atlas" 3D supply-chain visualization subdomain (existence + login gate only)
8. `https://godelterminal.com/docs/commands/g` — Chart: TradingView attribution, window linking, alerts, scale menu, instance limits
9. `https://godelterminal.com/docs/commands/omon` — Option chain: Greeks, modes, streaming, drill-through
10. `https://godelterminal.com/docs/commands/eqs` — Equity screener: full filter enumeration, beta status
11. `https://godelterminal.com/docs/commands/n` — News: two-layer filters, tri-state sources, TTS, six workflows
12. `https://godelterminal.com/docs/commands/chat` — Chat: channel types, permission tiers, tier names, market-object syntax, WJI wiring
13. `https://godelterminal.com/docs/commands/wji` — Wojak Index: ten sentiment states, emote-count source
14. `https://godelterminal.com/docs/commands/trend` — Trending: search-count aggregation across all users
15. `https://godelterminal.com/docs/commands/brok` — Brokerage: SnapTrade, 15 brokers, read-only, IBKR flow, beta
16. `https://godelterminal.com/docs/commands/ent` — Entitlements: Retail/Professional rates, self-service, beta
17. `https://godelterminal.com/docs/commands/change` — Changelog: `{COMMAND}` and `[EXPR]` inline pills

**Official — attempted, unreadable or 404 (recorded as ceiling evidence, not capability evidence):**

18. `https://godelterminal.com/traders` — rendered as an empty shell under text extraction
19. `https://godelterminal.com/wealth-teams-family-offices` — same
20. `https://godelterminal.com/changelog` — 404
21. `https://godelterminal.com/docs/change` — 404

**Secondary — social (CLAIMED/REPORTED tier):**

22. `https://x.com/GodelTerminal` — CLAIMED, single latest post (brand-voice engagement content), unauthenticated view
23. `https://x.com/MartinShkreli` — CLAIMED, single pinned post (recovered via Google snippet: {SPLC}/Atlas announcement, ~Aug 2026), unauthenticated view
24. `https://x.com/MarkDavidLamb/...` (via Google snippet) — REPORTED, "where's the API" question, ~Dec 2025
25. `https://www.reddit.com/r/GodelTerminal/` — REPORTED, top post (backtesting API question, unanswered), unauthenticated
26. r/MartinShkreli, "Open Gödel?" — REPORTED, value-vs-incumbent objection
27. r/openBB, "why I choose openBB over Gödel" — REPORTED, competitor-comparison thread
28. r/ValueInvesting, "Bloomberg Terminal Alternatives" — REPORTED, founder-reputation mention
29. r/Coffeezilla_gg — REPORTED, sibling-product controversy contagion
30. r/SideProject, solo-builder launch post (~4mo old) — REPORTED, independent AI-absence corroboration
31. r/bloomberg, "What do you think of Martin Shkrelis Gödel Terminal?" — REPORTED, title/vote-count only, content not read
32. LinkedIn — Martin Shkreli profile (via Google snippet) — REPORTED, DL Software multi-product confirmation
33. LinkedIn — Daniel Dietzel, "Frontend Lead @ Godel Terminal" (via Google snippet) — REPORTED, engineering-team corroboration
34. GitHub — `Hayden1629/algobot_v2` — REPORTED, unofficial programmatic interface, mechanism unconfirmed
35. GitHub — `Jera-Value/awesome-investing-tools-and-software-directory` — REPORTED, third-party product listing
36. YouTube search listings (titles/channels/dates only, no transcripts) — existence-only; all excluded as capability evidence per the affiliate-content ban (Reconciliation §2)
37. Google search result pages (multiple queries, aggregator only) — used solely to locate and tier the primary/secondary sources above

**Internal program sources:**

38. `docs/terminal-research/03-competitive-research/benchmark-universe.md` — Gödel rows (§13, Cluster C Bloomberg pairing, source table row, OPEN QUESTION on the trial), cross-checked against this dossier's findings, no contradiction found
39. `docs/terminal-research/00-program-control/OWNER_INPUTS_REQUESTED.md` — OI-18 (trial-access request, status: "No trials; ceilings recorded")
40. `docs/terminal-research/00-program-control/charter/C-master-directive.md` — Part IX (Gödel-specific research directive, source of the evidence-class spine instruction) and Part LX (dossier template, sections A–P)

**Explicitly excluded as evidence throughout** (preamble ban on SEO/affiliate content):
`godeldiscount.com`, `godelguide.com` — both read only in Google snippets as programmatic
SEO/affiliate content; any channel or page carrying an `app.godelterminal.com/?via=`
referral link or discount code (Shkreli Planet, The Shkreli Pill, and one `HARDWARE`-coded
channel).

## NOT INSPECTED

- **`app.godelterminal.com`** — the live product itself, login-gated. No account was
  created by any role (prohibited by contract); this is the single largest gap in the
  entire evidence base and the reason DEMONSTRATED is empty.
- **The 14-day free trial (OI-18)** — not opened by any role; account creation is
  prohibited to every research role. Owner action pending.
- **`docs.godelterminal.com` and `start.godelterminal.com`** — named as distinct URLs in
  `benchmark-universe.md`'s source table (row 22) but never independently visited by
  B-GDL-01/02/03, which instead reached command documentation at `godelterminal.com/docs`.
  Whether these are alternate subdomains serving the same content or something distinct
  was not resolved.
- **~30 of the 48 individual command docs pages** — see GAPS for the full list of what was
  and was not opened.
- **Any Reddit thread body or comment beyond the title and first visible snippet** —
  `old.reddit.com` is login-walled; `www.reddit.com`'s rendered search results yielded
  only top-post extracts.
- **X/Twitter timelines beyond a single latest/pinned post per account** — no logged-in
  session was available to any role.
- **Video transcripts** — none pulled from any source, per the structural DEMONSTRATED
  ceiling.
- **A Wayback Machine snapshot of `/pricing`** — would resolve the ~$60/month historical
  pricing question; not attempted by any role.
- **`martinshkreli`'s personal GitHub account (26 repos, per a Linktree bio)** — not opened.
- **Any sales conversation, enterprise pricing sheet, or direct company contact** — out of
  scope for every role in this pod; the enterprise API's real terms remain sales-gated and
  unknowable from public sources.
- **Independent verification of the DARP ETF customer relationship or the "~$28,000/yr
  saved" claim** — no attempt to contact the customer or verify the relationship
  independently; the claim rests entirely on Gödel's own homepage attribution.
- **Comparison to Bloomberg's or any other benchmark product's equivalent functions** —
  explicitly out of scope for this pod; owned by the C-group cross-product synthesis and
  the Bloomberg dossier (`03-competitive-research/bloomberg/dossier.md`).
