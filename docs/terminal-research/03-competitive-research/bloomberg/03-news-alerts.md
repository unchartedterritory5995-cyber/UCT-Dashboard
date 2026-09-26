---
id: B-BBG-03
title: Bloomberg Terminal — News and Alerts Workflow
role: B-BBG-03 (Bloomberg: news and alerts)
wave: 1b
group: B
category: competitor
scope: Bloomberg Terminal — news discovery, news search grammar, topic/source tagging, alert creation and delivery, noise control, news↔price linkage, latency posture
confidence: 🟡
evidence_ceiling: No Terminal access. bloomberg.com help center, press releases and "Pro Tips" insights pages are CAPTCHA-walled (I did not attempt to solve them), so ALRT's price/technical alert builder, the BLRT Alert Catcher UI, and current mobile-push behaviour are reconstructed from Bloomberg-authored PDFs and university guides rather than seen. Bloomberg-authored function guides used here are mirrored copies of undated/dated-2015–2024 material.
sources: 6 primary (Bloomberg-authored); 15 secondary (university library guides, practitioner deck, trade press)
uct_relevance: high
status: draft
date: 2026-09-02
---

# B-BBG-03 — News and Alerts on the Bloomberg Terminal

**Framing note.** This is a workflow study, not a feature list. The question behind every
section is *how does a professional get from "something happened" to "I know what it was and
I was told about it"*, and what structural choices Bloomberg made to keep that loop inside
one product. Benchmarks are sources of learning: nothing here says UCT should build any of it.

**A note on my strongest source.** Two of the documents below (`News Searches`, `Bloomberg
Terminal: Quick Start`) are Bloomberg-authored training material — the Quick Start is
explicitly badged "A Bloomberg Professional Services Offering" — mirrored on a university
journalism course site. They are the closest thing to a public Bloomberg function manual I
could reach, and they carry the operational detail that marketing pages do not. Caveat on
currency: the `News Searches` doc contains a stale internal inconsistency (one example line
says `TWEETS BY JOSEPH BIDEN <GO>` "displays President Trump's tweets"), which tells me the
examples have been edited over years without a full pass. I treat **function names and
grammar** from it as reliable (they corroborate across five independent university guides)
and **screen-level UI detail** as dated-but-directionally-true.

---

## 1. Where a news session begins: TOP, N, READ, MYN

**OBSERVATION.** Bloomberg does not open the user on "all news". It opens them on a
*curated* page (`TOP`), and treats "everything" as a deliberate click away. `TOP <GO>` is
the day's editorially-ranked page; `N <GO>` is the search/filter surface; `READ <GO>` is
most-read; `MYN <GO>` is the user's own assembled page. `TOP` also takes a tail —
`TOP OIL`, `TOP CHINA`, `TOP STOCKS`, `TOP GOOGLE`, `TOP JAMIE DIMON` — so the *same
mnemonic* serves market-wide, sector, company and person.

**EVIDENCE.**
- Bloomberg, *Bloomberg Terminal: Quick Start* PDF, p.4 (Tier 2, official function guide; fetched 2026-09-02): TOP "curates the best of Bloomberg News, Bloomberg Intelligence, Economics, QuickTakes and Opinion"; the page instructs "Click **All Stories** on the red toolbar to see every bit of news" — i.e. unfiltered is opt-in. Also documents `MYN` (My News), and per-source pages `WSJ`, `NYT`, `WPT`, `TEL`, `OPIN`, `QUIC`, `BIZW`, `TWEE`. **Verified.**
- Bloomberg, *News Searches* PDF, p.5 (Tier 2): TOP-by-topic, TOP-by-company, TOP-by-person, each filterable further in the yellow box. **Verified.**
- Bloomberg, *Getting started on the Bloomberg Terminal* (student guide) PDF, p.24 (Tier 2): `TOP` "Get the day's top worldwide news stories in one place"; `CN` "See top news on a specific company"; `FIRS` "Read summarized news stories to track market-moving news"; `BRIE` "Read Bloomberg newsletters". **Verified.**
- Corroboration across independent university guides (Tier 9): JHU Sheridan (upd. 2026-05-20) — `N`, `NSE`, `TOP`, `READ`, `LIVE`; Pace (upd. 2026-05-11) — `N`, `TOP`, `READ`, `CN`; NYIT (upd. 2026-08-03) — `N` "The Main News menu", `TOP`, `READ`, `CN`; Chicago Booth reference guide p.18 — `N`, `NSE`, `TNI`, `NI`, `TOP`, `NI READ`, `NH NYT`. **Verified (multi-source).**

**INTERPRETATION.** The default is *editorial*, not *algorithmic* and not *chronological*.
The firehose exists but you have to ask for it. And the "one mnemonic, many scopes" pattern
(`TOP` + anything) means the user learns **one** verb and re-aims it, instead of learning a
different screen for each scope. That is a navigation-cost decision, not a content decision.

**RELEVANCE TO UCT.** UCT's Dashboard already has the curated-first instinct — the Stock
Catalysts tile is a forced 10/5/3/2 quota mix rather than a raw feed, and the wire is an
edited brief. The transferable observation is the *escape hatch*: Bloomberg pairs every
curated page with an explicit "All Stories" control, so a user who suspects curation missed
something can check without leaving the surface. UCT's catalyst tile has a "🔎 Why isn't X
here" widget, which is the same instinct answered at ticker granularity rather than feed
granularity.

**CONFIDENCE.** 🟢 on function names, scoping grammar and the curated-first default —
Bloomberg-authored plus five independent corroborations. Ceiling: I have not seen the live
`TOP` page, so section layout and the current position of "All Stories" are dated.

**RECOMMENDATION (hypothesis).** A curated feed earns trust from the control that lets a
user *disprove* it, not from the curation. If UCT ever narrows a feed further, the paired
"show me everything you filtered out" affordance is probably what makes the narrowing
acceptable rather than suspicious.

**OPEN QUESTION.** Does `TOP`'s editorial ranking ever get overridden intraday by a
velocity/breaking signal, or is the ordering purely human until a `FIRST WORD` item
pre-empts it?

---

## 2. The search grammar: `N` as a natural-language query language

**OBSERVATION.** Bloomberg's news search is a *typed query language wearing natural-language
clothes*. `N <GO>` (aliases `NSE`, `NEWS ON`) accepts a single command-line string that mixes
entity, source, date, language, boolean, proximity and wildcard operators. Documented forms:

| Intent | Documented form |
|---|---|
| entity + source + time | `N JOSEPH BIDEN IN NYT LAST WEEK <GO>` |
| boolean | `N APPLE AND SAMSUNG BUT NOT IPHONE <GO>` (also `OR`, `AND NOT`) |
| keyword vs. tag | `N "APPLE" <GO>` (quotes = literal keyword) vs `N APPLE <GO>` (tag) |
| field scoping | `N "EXXON" IN HEADLINES <GO>` |
| proximity | `N TSMC N/5 APPLE <GO>` = within 5 words (also `NEAR/`, `WITHIN 10 WORDS OF`) |
| wildcard | `N HOUS* <GO>` |
| date range | `N MYANMAR SINCE OCT 1`, `BETWEEN FEB. 15 AND FEB. 28`, `8/2/2016-9/15/2016` |
| language | `N XI JINPING IN CHINESE <GO>` |
| media type | `N UBER ON BTV <GO>`, `N ZARA WITH CHARTS <GO>`, `TWEETS ON UBER`, `TWEETS BY <person>` |

**EVIDENCE.** Bloomberg, *News Searches* PDF, pp.1–3 (Tier 2, official; fetched 2026-09-02) —
all rows above are verbatim documented examples. **Verified.** Corroborated at lower detail:
US Dept of Commerce Library (Tier 9, upd. 2026-06-11); Corporate Finance Institute (Tier 11)
documents pre-constrained `NSE` tails — `NSE MNA`, `NSE BBEA`, `NSE US COS`, `NSE OPN`,
`NSE CNS`, `NSE USS`. **Reported.**

**INTERPRETATION — the single most transferable design decision in this whole report.**
The system **resolves ambiguity toward the tag, not the keyword, and says so.** Bloomberg's
own doc: the Terminal "favors ticker, people, source and topic or subject codes over the
specific keywords you type" — `N APPLE` returns news *coded to Apple Inc.*, and if you meant
the fruit you must explicitly choose keyword search. The doc then explains the *cost* of that
default in plain terms: a story with a passing "China" mention in the last paragraph will not
be coded to the China topic, so the tag search misses it and only the keyword search finds it.

That is a vendor telling users where its own precision/recall tradeoff breaks, inside the help
text, with a worked example. It is also a **two-mode search with an explicit switch** rather
than one blended relevance score — the user chooses precision (tag) or recall (keyword), and
the disambiguation lives in a dropdown at query time.

**RELEVANCE TO UCT.** This lands directly on two live UCT surfaces. (a) The `/buzz` Discord
ticker-counter tuned its gate from 35% → 10% on the explicit owner principle that **recall
beats precision** for this population — Bloomberg made the *opposite* default choice (tag-first
= precision) but neutralised it by making the other mode one dropdown away and documenting
when to reach for it. (b) UCT's cashtag extraction is regex-only over `\$[A-Z]{1,5}\b` with a
forex exclude list, which is structurally the "keyword" mode with no "tag" mode beside it. The
Bloomberg pattern suggests the interesting question is not *which* mode is right, but whether
a user can tell which mode they're in and switch.

**CONFIDENCE.** 🟢 on the grammar and the tag-over-keyword default (Bloomberg-authored, with
its own worked counter-example). 🟡 on whether every documented operator still parses in the
current build.

**RECOMMENDATION (hypothesis).** Where a matcher has a known precision/recall tradeoff, the
transferable move is not picking the better default — it is *naming the mode in the UI and
documenting the failure case of the default*. A gate tuned to 10% that never tells the reader
it is tuned for recall is one bad week from being read as a bug.

**OPEN QUESTION.** Does the amber-box "Did You Mean" suggestion layer learn per-user, or is it
a static disambiguation table over the tag dictionary?

---

## 3. The tagging spine: NI (topics), NH (sources), CN (security), TNI (intersection)

**OBSERVATION.** Every story entering the Terminal is classified against two orthogonal
dictionaries — **topics** (`NI` codes) and **sources/wires** (`NH` codes) — plus security
tickers and person BIO codes. The mnemonics are the dictionaries made addressable:

- `NI <topic>` — `NI US`, `NI UK`, `NI JP`, `NI ECO`, `NI FX`, `NI TEC`, `NI MNA`, `NI OIL`, `NI POL`, `NI CRA`
- `NH <wire>` — `NH BN` (Bloomberg News), `NH BFW`, `NH APW` (AP), `NH NYT`, `NH WPT`, `NH BUS` (Business Wire), `NH EDG` (EDGAR), `NH BBG` (all Bloomberg wires blended)
- `TNI <a> <b>` — intersection of two topic codes: `TNI UK AUT <GO>`
- **Topic × source, source always second**: `NI ECO BN <GO>`, `NI AFGHAN AFP <GO>`, `MSFT US EQUITY CN NYT <GO>`
- `<TICKER> <EQUITY> CN <GO>` — news tagged to the loaded security; `CN BN` narrows to Bloomberg-sourced only
- `NI UK 12/31/14 <GO>` — an NI search bounded by end-date
- `PEOP` / BIO codes — news coded to a *person*, reachable from a country profile (`COUN US`) by clicking an official's name

**EVIDENCE.** Bloomberg, *News Searches* PDF, pp.6–7 (Tier 2): NI/NH/TNI grammar, the
"always put the source second" rule, end-date limits, `NI <GO>` drill-down through
Topics → Business News → Industries → Technology, and BIO/PEOP. **Verified.** Bloomberg,
*Quick Start* p.11 (Tier 2): `CN <GO> | News — Get the latest news tagged to this security`,
with in-page controls to "Edit the news sources, date range and language". **Verified.**
Practitioner corroboration with lived detail: journalism-course deck, pp.5–7, 10 (Tier 10) —
`NH` as an always-on screen with a news ticker pinned to the bottom of whatever the user is
doing; the same NI country/topic code list; `CN BN`. **Reported.** Chicago Booth p.18–19
(Tier 9) independently lists `NI`, `TNI`, `NSE`, `NH NYT`, `INTC <EQUITY> CN`. **Verified.**

**INTERPRETATION.** The tag spine is what makes everything downstream cheap. Search, the
security news tab, the topic page, the alert, the Launchpad feed and the machine-readable
enterprise feed are all *the same filter expression* pointed at different renderers. Bloomberg
states the scale directly: content is tagged "to millions of securities and thousands of
subject or topic codes."

Note also the **composability rule with a fixed argument order** (`NI ECO BN`, source second).
That is a deliberate grammar decision: it makes topic×source expressible without a UI, and it
means the command line can express a filter that would otherwise require a form.

**RELEVANCE TO UCT.** UCT has three unconnected news-ish classification systems: the catalyst
engine's deterministic tagger (`Earnings > Catalyst > Gapper > News`), the theme taxonomy
(`themes_taxonomy.json`, 112 themes / 2,029 holdings + the engine overlay), and cashtag
extraction on tweets. Bloomberg's structure is the observation that **one tag spine feeding
many renderers** is what makes a news surface cheap to extend — but the honest caveat is that
Bloomberg pays for that spine with 2,700 journalists and a classification department, which is
precisely the kind of thing a small desk cannot copy. The *shape* transfers; the *cost base*
does not.

**CONFIDENCE.** 🟢 on the grammar and the two-dictionary structure (Bloomberg-authored +
practitioner + two university guides). 🔴 on how the classifier actually decides — no public
evidence on model, thresholds, or human-in-the-loop.

**RECOMMENDATION (hypothesis).** If UCT ever unifies its taxonomies, the Bloomberg lesson is
that the win comes from *one filter expression rendered many ways*, not from a bigger taxonomy.
The anti-pattern to avoid is what UCT has already been bitten by elsewhere: a second authority
over one value (three classifiers that each independently decide "what is this story about").

**OPEN QUESTION.** How are `NI` codes retired or merged when an industry taxonomy changes, and
does a saved search referencing a dead code fail loudly or silently return nothing? (UCT has
the exact analogue: a dangling-theme filter in `theme_db`'s merged reads.)

---

## 4. The promotion path: a search becomes a code becomes an alert

**OBSERVATION.** This is the mechanism I'd most want a synthesis task to notice. Bloomberg
makes a *saved search indistinguishable from a built-in topic code*, and makes an alert a
*delivery setting on a saved search* rather than a separate object.

Documented sequence:
1. Type a search: `N WARREN BUFFETT AND "BASEBALL" <GO>`
2. `Actions > Save Search > Save`, and give it a short name
3. **The saved search now IS an NI code.** Bloomberg's own tip: "Give it a short, easy to type
   name as once it's saved, it becomes an NI code for you." Named `Buffball`, it runs as
   `NI BUFFBALL <GO>`.
4. `Actions > Set Alert Delivery…` turns the same saved criteria into a standing alert.
5. `NLRT <GO>` lists your news alerts; click one to edit **either** the search criteria **or**
   the delivery options; `Suspend Alert` / `Activate Alert` pause and resume **without
   destroying the search**.
6. The same saved search can be dropped into a Launchpad window
   (`Actions > Open News in Launchpad`), and multiple searches become **tabs in one window**.
7. Or dropped into `MYN` as a section (`Use Saved Search`), with a per-section story count.

**EVIDENCE.** Bloomberg, *News Searches* PDF, pp.3–4, 7 (Tier 2) — save→NI-code promotion,
alert delivery, NLRT edit/suspend/activate, Launchpad tabs. **Verified.** Bloomberg, *Quick
Start* p.5 (Tier 2) — MYN sections built from Saved Searches, `Add Section`, `Reorder Sections`,
`Manage Saved Pages`. **Verified.** NYU Law LibGuide (Tier 9, upd. 2026-08-03) and US Dept of
Commerce Library (Tier 9, upd. 2026-06-11) independently document `NLRT` as the view/edit/delete
surface. **Verified (multi-source).**

**INTERPRETATION.** Four things are one thing: a query, a named topic code, a live page
section, and an alert rule. A user does not "build an alert" — they *find something once*, name
it, and then choose how loudly it should reach them. The promotion is one click at each step and
each step is reversible (suspend ≠ delete).

The naming tip is a small detail with a large consequence: because the saved search becomes a
*typed* mnemonic, the user's personal filters live in the same namespace and the same muscle
memory as Bloomberg's own. There is no "my stuff" section to navigate to.

**RELEVANCE TO UCT.** UCT's alert model is currently **object-first**: a `watchlist_alerts` row
is `(sym, target_price, direction)` created from a bell icon, and it has no relationship to any
saved query. The Screener has saved screens (`SavedScreensPanel` → `ScanResults`) and the nightly
`scan_evaluator` sweep, and those are *also* standing filter expressions — but they are a
separate system from alerts, and neither is addressable as a first-class name the way
`NI BUFFBALL` is. Bloomberg's structure suggests the missing edge is between *saved definition*
and *notification channel*: UCT already has both halves (`user_definitions`, `starter_library`,
and a five-channel `watchlist_alert_service`) and no promotion path between them.

**CONFIDENCE.** 🟢 on the promotion path and NLRT semantics — Bloomberg-authored with two
independent institutional corroborations of the NLRT half. 🟡 on the exact current menu labels.

**RECOMMENDATION (hypothesis).** The transferable idea is *suspend, not delete*, plus *one
object with two faces*. An alert that can be silenced without losing its definition is the thing
that survives a noisy week; an alert that must be deleted to be quieted is the thing users
delete and never rebuild. UCT's `watchlist_alerts.is_active` column already permits this — the
open question is whether the UI exposes pause as distinct from remove.

**OPEN QUESTION.** Is there a collision namespace problem — what happens when a user names a
saved search the same as a real `NI` code, and which wins?

---

## 5. Alert delivery: a fan-out with an escalation ladder, and an email bridge that is a *message rule*

**OBSERVATION.** Bloomberg offers five delivery options on one alert, and they are ordered by
intrusiveness rather than by channel type:

1. **Deliver to Alert Catcher** — `BLRT <GO>`, the consolidated inbox where news alerts land
   *alongside price and economic alerts*
2. **Show a Popup Window** — the doc's framing: "This option is more noticeable"
3. **Play an Audio Alert** — a range of tones, "or having the machine speak out the headline"
4. **Send me a message** — a Bloomberg MSG, real-time or periodic, carrying the results
5. **Phone Notifications** — "Alerts show as notifications to your mobile phone screen even
   when you aren't in the Bloomberg App"

**Email is not on that list, and that is the interesting part.** Email delivery is achieved by
routing option 4 through the terminal's *own messaging system* and then applying a **message
rule**: `MRUL <GO>` → Create Rule → check MSG type → choose **ALERT** from the dropdown → check
"Forward the MSG to" → enter your external address.

**EVIDENCE.**
- Bloomberg, *News Searches* PDF, p.3 (Tier 2) — the five options verbatim, including BLRT and the phone-notification wording. **Verified.**
- Bloomberg, *Getting started* student guide p.24 (Tier 2) — `MSG` "Send and manage email communications through your Bloomberg.net email account"; `MRUL` "Manage message rules, including forwarding emails to your Bloomberg.net email to your personal email account (Gmail, Yahoo, etc.)"; and separately `SALT` — "Set up email alerts for news on the companies you follow." **Verified.**
- NYU Law LibGuide (Tier 9, upd. 2026-08-03) — the MRUL steps, verbatim: "Check MSG type and choose ALERT from the drop-down", "Check 'Forward the MSG to' and input your NYU email", and the caution "We do NOT recommend real-time alerts because…you could potentially be inundated with email". **Verified.**
- US Dept of Commerce Library (Tier 9, upd. 2026-06-11) — the *same* MRUL sequence and the *same* real-time caution, independently written. **Verified (multi-source).**

**INTERPRETATION.** Two structural observations.

**(a) One inbox, many creators.** `BLRT` is a single destination for alerts created by
*different* functions — news alerts from `NLRT`-managed saved searches, price alerts, economic
alerts. The creation surfaces are specialised; the consumption surface is unified. That is the
opposite of the common pattern (one alerts page that can create everything, but notifications
scattered per-feature).

**(b) External delivery is a rule on the message stream, not a per-alert setting.** Because
every alert can become a MSG, and MSGs are subject to `MRUL` rules, the user configures
"where alerts leave the building" **once**, in one place, for all alert types — instead of
re-choosing email/no-email on every alert they ever create. Adding a new alert *type* costs
nothing in delivery plumbing: emit a MSG and it inherits the routing.

The fact that two institutions independently wrote down the *same warning* about real-time email
volume is itself evidence: the fan-out's failure mode is well-known enough to be standard
training content.

**RELEVANCE TO UCT.** UCT's `watchlist_alert_service.deliver_alert_payload` already fans out to
AlertBell (in-app) + email (Resend) + Discord webhook + browser Notification API + one of ten
synthesized sounds — a *wider* channel set than Bloomberg's documented list, and the awareness
engine reuses it for importance ≥ 8. The structural difference is that UCT's fan-out is decided
**per-call inside the service**, whereas Bloomberg's is decided **per-alert by the user** for
in-terminal loudness and **once, globally, by a message rule** for anything leaving the terminal.
UCT's Settings page has sound on/off and browser-notification enable, so the per-user layer
partly exists; there is no MRUL-equivalent single place that says "and here is where my alerts
go when I'm away from the app" across every alert-producing subsystem (watchlist alerts,
catalyst alerts, calendar pre-report alerts, awareness insights, broker stale notices).

**CONFIDENCE.** 🟢 on the five delivery options and the MRUL email bridge — Bloomberg-authored
for the options, two independent institutional guides for the MRUL steps with matching wording.
🟡 on current mobile-push behaviour (the phone-notification line is from a mirrored doc; the
live help page describing push is CAPTCHA-blocked). 🔴 on whether BLRT does any prioritisation
or grouping *within* the catcher — I found no evidence either way.

**RECOMMENDATION (hypothesis).** Two separable ideas. First, *one consumption inbox, many
creation surfaces* — worth testing against UCT's current state where AlertBell, the "Compass
noticed" tile and Discord each hold a different slice of the same "things you should know" set.
Second, and more strongly: *make away-delivery a routing rule, not a per-alert checkbox.* UCT
already pays for the absence of this — every new alert-producing subsystem re-implements its own
delivery decision, and each one re-derives its own dedup ledger.

**OPEN QUESTION.** Does BLRT rank or group its contents (by importance, by symbol, by recency),
or is it strictly chronological? This matters: UCT's awareness engine deliberately clamps a
near-stop warning and an actual stop breach to the same importance 10, with a note that
consumers should key severity off `kind` rather than `importance` — the same problem Bloomberg
would face merging news, price and eco alerts into one list.

---

## 6. Noise control is a first-class workflow, not a setting

**OBSERVATION.** Bloomberg's news training spends more space on *reducing* results than on
finding them, and gives the user a measurable feedback loop while doing it. The
`Actions > Use Advanced Editor` surface shows **stories per hour** for the current filter, with
a preview of recent results, so the user can see whether a search is survivable before saving it.

Documented noise-reduction moves, in the order the doc teaches them:
- **Exclude topic codes** via a "None of these" box — with a *named list* of the specific codes
  that generate volume without substance: `HEADS` (headlines), `TABLE` (tabular material),
  `GLOBEWRP` (global market wraps), `CMP` (computer-generated stories), `BBNAUTO` (automated
  news story), `DAYBOOK`, `NIM` (new issuance tables), `WRP`, `USSBN`, `AV`, `HLT` (trading
  halts/imbalances), `RED` (bond redemptions), `EXCLDERIVE` (exclude derived codes)
- **Learn the code for a story type you don't want** by opening one such story and typing
  `2 <GO>` to reveal its topic codes, then adding that code to the exclusion box. Worked
  example in the doc: open a bond-auction story, find `AUC`, exclude it.
- **Exclude by source** — described as "the cleanest way to exclude some items", e.g. drop the
  `MNS | Market News International` wire
- **Iterate against the frequency readout** until the search is clean
- **Change your defaults globally** — `NZPD <GO>` sets the default TOP category, default news
  sources, language, and can **colour headlines based on keywords**

**EVIDENCE.** Bloomberg, *News Searches* PDF, pp.4–5, 7 (Tier 2; fetched 2026-09-02) — all of
the above verbatim including the full exclusion-code list and the `2 <GO>` code-discovery trick.
**Verified.** Bloomberg, *Quick Start* p.4 (Tier 2) — `NZPD <GO>` to change the region default
page. **Verified.** Bloomberg, *Quick Start* p.4 (Tier 2) — Advanced Editor operators "Any of
These or None of These" and manual editing of "your complete search expression", plus "Preview
Results to refine your criteria before saving your filter or alert". **Verified.**

**INTERPRETATION.** Three things stand out, and they are all *process*, not features.

1. **The vendor publishes its own noise list.** Bloomberg names, by code, the thirteen-odd
   categories of its own output that are structurally low-signal — automated stories,
   computer-generated stories, tables, wraps, daybooks. A vendor telling you which of its
   content to filter out is a trust move that costs it nothing and buys a great deal.
2. **The filter is measured before it ships.** Stories-per-hour turns "is this search too
   broad?" from a judgement into a number, *at authoring time*. The user is not asked to
   estimate; they are shown.
3. **Noise reduction is taught as a loop with a discovery step.** `2 <GO>` on an offending
   story is the mechanism that lets a user go from "I don't want *this kind* of thing" to a
   code they can exclude — without knowing the taxonomy in advance. The taxonomy is discoverable
   *from an instance*, backwards.

**RELEVANCE TO UCT.** The stories-per-hour readout is the closest external analogue I found to
`CoverageLine`'s four counts on the Screener — both are "show the user the shape of the result
set, at the moment it matters, rather than letting a short answer read as a quiet market". The
`2 <GO>` backwards-discovery move has no UCT analogue I'm aware of: UCT's taxonomies (themes,
setups, catalyst tags) are browsed forwards from a list, never derived from an example the user
is looking at. For the Discord `/buzz` collision work — where 7.7% junk was purged by
re-deriving against real `#main-chat` traffic — the Bloomberg pattern is that the *user*, not
the maintainer, performs the exclusion, continuously, and each user's exclusions are theirs.

**CONFIDENCE.** 🟢 — this is the most detailed and most internally-consistent section of the
Bloomberg-authored doc, and the exclusion-code list is too specific to be marketing. 🟡 on
whether the current Advanced Editor still shows stories-per-hour in that exact form.

**RECOMMENDATION (hypothesis).** Two candidates, in order of strength. **(a)** Any UCT surface
where a user authors a standing filter (saved screens, scan definitions, watchlist alerts,
`/buzz` gates) probably wants a *volume forecast at authoring time* — "this would have fired N
times last week" — because that converts a tuning argument into a measurement. **(b)** The
backwards path from an item to its classification ("why is this here, and what would I exclude
to stop seeing things like it?") is a cheap, high-trust affordance that UCT's catalyst tile
half-has already via its ⓘ citations popover.

**OPEN QUESTION.** Does the stories-per-hour figure derive from a live backtest over recent
history, or is it a rate estimate? The difference decides whether the analogous UCT feature is
cheap (rate) or expensive (replay).

---

## 7. Prioritisation and dedupe: editorial ranking, relevancy scores, and read-attention

**OBSERVATION.** Bloomberg runs at least three distinct prioritisation signals, and does not
blend them into one score:

- **Editorial rank** — TOP pages are "ranked based on criteria including the news judgment of
  the editors who curate the highest-ranked stories, breadth of readership, relevance and time."
  Note that this is a *stated* composite that puts human judgement first and time last.
- **Relevancy scores on tags** — in the machine-readable feed, tags are "tied to relevancy
  indicators" and "Relevancy scores determine correlation of tags to news." So the same story
  can be *strongly* about one ticker and *weakly* about another, and that strength is a number.
- **Read attention as a ranked surface in its own right** — `READ <GO>` (most-read, with an
  adjustable time period), `<TICKER> <EQUITY> MCN <GO>` (most-read on a company),
  `MNI <topic> <GO>` (most-read on a topic), each with time tails `1H` / `1W` / `1M` / `1Y`
  (e.g. `MNI OIL 1W`, `VOD LN EQUITY MCN 1Y`). Plus `RECE <GO>` for *your own* last ~200 opened
  stories and `BKMK <GO>` for bookmarks with tags.

On **dedupe** specifically: I found no evidence of automated near-duplicate collapsing in the
Terminal UI. What exists instead is *user-driven* suppression (§6) plus source blending
(`NH BBG` explicitly described as "a blend of all Bloomberg wires").

**EVIDENCE.** Bloomberg, *News Searches* PDF, pp.5–6 (Tier 2) — TOP ranking criteria (quoted
above, 24 words), READ/MCN/MNI with the four time tails, RECE, BKMK. **Verified.** Bloomberg,
*Event-Driven Feeds — Textual News* fact sheet, p.1 (Tier 4, official product doc, ©2015) —
"Tags covering 75,000 securities and 10,000 topics", "Relevancy scores determine correlation of
tags to news", classification "tied to relevancy indicators". **Verified but dated.** Bloomberg
News product page (Tier 3, fetched 2026-09-02) — News Trends "lets you scan the companies and
topics receiving the most media and reader attention, as well as social media sentiment and
velocity". **Claimed.**

**INTERPRETATION.** The separation is the point. *What editors think matters*, *how strongly a
story is about X*, and *what people actually read* are three different questions, and Bloomberg
gives each its own surface rather than fusing them into a single "score". The time-tail grammar
on most-read (`1H`/`1W`/`1M`/`1Y`) is a small but sharp idea: attention over one hour and
attention over one year answer completely different questions, and the same mnemonic serves both.

The absence of visible dedupe is worth recording honestly rather than assumed away. With 1,000+
external providers, the same event necessarily arrives many times; Bloomberg's public answer
appears to be *ranking and suppression*, not *merging*. I could not confirm whether a
near-duplicate collapse exists behind the scenes.

**RELEVANCE TO UCT.** UCT's catalyst engine composites everything into one score
(`gap_pct + log(vol_x)*15 + tweets*5 + rss*8 + earnings_reported*20 + scanner_setup*12 + …`) and
then applies a forced category quota on top. Bloomberg's structure is the alternative: keep the
signals *separate and separately addressable*, and let the user pick which question they're
asking. The quota mix is arguably UCT's version of refusing to let one signal dominate — but it
operates on the output, whereas Bloomberg's operates on the surfaces. The relevancy-score idea
(a story is 0.9-about NVDA and 0.2-about AMD) has a direct UCT analogue that does not exist
today: the cashtag extractor treats every `$TICKER` in a tweet as equally about that ticker.

**CONFIDENCE.** 🟡 overall. 🟢 on the surfaces and the TOP ranking statement (Bloomberg-authored).
🟡 on relevancy scores (official but from a 2015 enterprise fact sheet — the mechanism is
near-certainly still there; the numbers are stale). 🔴 on dedupe: **absence of evidence, and I
am not treating it as evidence of absence.**

**RECOMMENDATION (hypothesis).** Signals that answer different questions probably shouldn't be
summed. Where UCT does sum them (catalyst score), the quota mix is doing the work that
separation would do more legibly — worth revisiting only if the score ever needs explaining to a
member. The stronger candidate is **relevance-weighted tagging**: a ticker mentioned in a
headline is not the same signal as a ticker mentioned in a list of nine peers, and treating them
identically is a known source of the junk `/buzz` already had to purge.

**OPEN QUESTION.** Does Bloomberg collapse near-duplicate wire copies of the same press release,
and if so is it visible to the user (a "12 similar stories" affordance) or silent?

---

## 8. News ↔ price: the link is bidirectional and has three separate mechanisms

**OBSERVATION.** Bloomberg wires news to price in at least three distinct ways, none of which is
"a news column next to a chart":

1. **Events and news plotted *on* the chart.** On `GP`, a checkbox in the Security/Study panel
   turns on corporate events, news and earnings announcements as chart flags.
2. **News Trends Graph — `NT <GO>`** — inverts the relationship: it "Charts the number of
   stories including specified keywords against an index or the price of a security". This is
   attention-as-a-time-series *plotted against* price, i.e. news volume treated as an indicator
   rather than as context.
3. **Trending / velocity — `TREN <GO>`** — "stories that are trending on news feeds or social
   media", and the product page's News Trends framing adds "social media sentiment and velocity".
4. (Related, marketing-tier) **Automated Intelligence on Demand** — claimed to provide "instant
   summaries on the status and drivers of securities, indices, currencies and other instruments",
   i.e. an auto-generated answer to "why is this moving".

**EVIDENCE.**
- University of Scranton KSOM, *Technical Analysis / Equity Charting* PDF, p.8 (Tier 9, professional/course tutorial; fetched 2026-09-02): "Checking the flag allows the user to show corporate events, news, earnings announcements etc. onto the chart", with an Under Armour example using Earnings Announcements. **Demonstrated (screenshot-based tutorial).**
- Bloomberg, *News Searches* PDF, p.6 (Tier 2): `TREN <GO>` and `NT <GO>` with the quoted description of NT. **Verified.**
- Bloomberg News product page (Tier 3, fetched 2026-09-02): "News is integrated across Terminal charts and visualizations"; News Trends and Automated Intelligence on Demand as quoted. **Claimed (marketing).**
- Bloomberg *Quick Start* p.11 (Tier 2): `GP` framed as charting "so you can detect trends and figure out why prices changed" — the intent is stated in the function's own description. **Verified.**

**INTERPRETATION.** Direction 1 (news → chart) answers *"what happened on that candle?"*.
Direction 2 (`NT`, news → indicator) answers *"is attention building before the move?"* and is
the genuinely unusual one: it treats story count as a plottable series alongside price, which
converts news from qualitative context into something a chartist can pattern-match. Direction 3
(`TREN`, velocity) is the earliest-warning layer.

The consequential design choice is that **all three are chart-native**. A trader never leaves
the price surface to ask a news question.

**RELEVANCE TO UCT.** Highly relevant and partially built. UCT's `StockChart` already supports
`markers`, `priceLines`, `highlightBarTime` and — in Model Book — `ChartCalloutOverlay`,
leader-line callouts that place catalyst labels in blank space with a diagonal line back to the
candle rather than covering it. That is mechanism 1, already shipped, for curated historical
catalysts. Mechanism 2 (`NT`-style news-count-vs-price) has a latent UCT dataset: `/data/tweets.db`
holds 7 days of cashtag-linked tweets with timestamps, and the catalyst store keeps `catalyst_at`
(earliest source-signal time) — so "story/tweet count vs price" is derivable from data already on
disk, for a 7-day window. I am *not* proposing it; I'm recording that the ingredient exists.

**CONFIDENCE.** 🟡. 🟢 on `NT` and `TREN` existing and what they do (Bloomberg-authored). 🟡 on
the GP news-flag mechanism — one university tutorial with screenshots, corroborated only by
Bloomberg marketing language. 🔴 on "News Themes" (a feature name that surfaced in search-result
summaries describing a news icon on the chart that opens themed bullet lists per day) — **I could
not reach a primary or expert source for it and am recording it as unverified.** Do not treat
News Themes as established.

**RECOMMENDATION (hypothesis).** The chart-native principle — *never make the user leave price
to ask a news question* — is the transferable part, and it is cheap relative to the tagging
spine it usually rides on. The anti-pattern it warns against is a news panel that lives beside
the chart but is not *addressed by* the chart's time axis: at that point it is a second surface,
not an annotation.

**OPEN QUESTION.** On the GP flag, does clicking a plotted news marker open the story, or only
label the bar? The difference is the whole workflow.

---

## 9. First Word and the digest layer: FIRS, Daybreak, Morning Report, BRIE

**OBSERVATION.** Bloomberg operates a **separate editorial product for speed-with-compression**,
distinct from both the wire and the curated TOP page. `FIRS <GO>` — First Word — is described by
Bloomberg's own cheat sheet as "First Word (breaking news for market professionals)" and in the
student guide as "Read summarized news stories to track market-moving news." The product page
frames it as taking "breaking news to a new level, condensing need-to-know information into
bullet point digests that convey vital information, instantly."

Around it sits a scheduled-digest family:
- **Daybreak** — "curates overnight developments and upcoming events into one indispensable a.m. briefing"
- **Morning Report** — "generates a daily report customized to your security list"
- **BRIE** — "Read Bloomberg newsletters on markets, economics and industries"
- **SALT** — "Set up email alerts for news on the companies you follow"
- First Word content is also surfaced *inside* TOP: the Quick Start notes the TOP side panel's
  "lower section displays the most important First Word breaking news."

**EVIDENCE.** Bloomberg, *Quick Start* cheat sheet p.41 (Tier 2) — `FIRS` glossed as "First Word
(breaking news for market professionals)", listed beside `TOP` "Top Bloomberg News", `READ`
"Most-Read News", `N` "News Search", `NLRT` "News Alerts", `NI` "News Categories". **Verified.**
Bloomberg, *Quick Start* p.4 (Tier 2) — First Word in the TOP side panel. **Verified.**
Bloomberg, *Getting started* student guide p.24 (Tier 2) — `FIRS`, `BRIE`, `SALT`, `TWTR`, `CN`
glosses. **Verified.** Bloomberg News product page (Tier 3) — First Word / Daybreak / Morning
Report descriptions as quoted. **Claimed (marketing).** Variant spelling note: several secondary
sources say users type `FIRST`; Bloomberg's own cheat sheet says `FIRS`. Both plausibly resolve
via autocomplete; I have not verified.

**INTERPRETATION.** The layering is: **wire (raw) → First Word (compressed, fast, for
professionals) → TOP (curated, editorial) → Daybreak/Morning Report (scheduled, personalised)**.
Four different products over one content pool, differentiated by *how much time the reader has
and when*. First Word specifically optimises a tradeoff most news products refuse to make: it
gives up narrative for scan-speed, in bullets, deliberately.

**Morning Report is the one most relevant to UCT** and the least documented: a daily report
generated *against the user's own security list*. That is the wire-for-one-portfolio pattern.

**RELEVANCE TO UCT.** UCT's Morning Wire is the direct analogue of Daybreak — one edited
pre-market brief, human-voiced, on a schedule, with an explicit AUTO-SEND goal and a gate stack
that is itself the review. What UCT does *not* have is the First Word tier: a compressed,
bulleted, intraday breaking layer between the raw feed and the edited brief. UCT's nearest
approach is the Stock Catalysts tile (Opus-synthesized 2–3 sentence theses, refreshed every 5
min pre-market) — which is closer to First Word than to Daybreak in cadence, but closer to
Daybreak in prose density. And `Morning Report`'s "customized to your security list" is
structurally what UCT's calendar "My Stocks" set (`/api/calendar/my-sets` — union of watchlists +
flagged + J2 positions + UCT20) already computes, without a report attached to it.

**CONFIDENCE.** 🟡. 🟢 that FIRS/First Word, Daybreak, Morning Report, BRIE and SALT exist and
their one-line purposes. 🔴 on how First Word is *produced* (dedicated desk? templated from the
wire? latency target vs the wire?) — the Bloomberg press releases that would answer this are
CAPTCHA-blocked.

**RECOMMENDATION (hypothesis).** The layering by *reader time budget* rather than by *topic* is
the transferable idea. A desk that already ships one edited brief per day may find that the
missing tier is not more coverage but a **compressed intraday tier with a different prose
contract** — bullets, no narrative, explicitly not the wire's voice. The anti-pattern would be
making the intraday tier a shorter version of the brief; First Word's value appears to come from
being a *different format*, not a smaller one.

**OPEN QUESTION.** Is First Word written by a dedicated desk against a latency target, or
generated/templated from the wire with editorial review? This decides whether the tier is
copyable at small scale at all.

---

## 10. Latency posture: the Terminal is not where Bloomberg competes on speed

**OBSERVATION.** Bloomberg's explicit millisecond claims attach to the **enterprise
machine-readable** product, not the Terminal UI. Event-Driven Feeds textual news is positioned
for "prop desks, market makers, quants, high frequency event-driven traders who rely on
non-display trading applications (black boxes)", is "designed to help firms act on news within
milliseconds", and is "available only for black box applications." Stated attributes: 100,000+
sources, "151 global bureaus generating 10,000 headlines and stories per day", tags covering
75,000 securities and 10,000 topics, relevancy scores, and a **historical archive back to 1992
for backtesting**.

The Terminal-facing claims are about *breadth and curation*, not speed: 2,700 journalists,
1,000+ external news providers, 146 global bureaus, 40+ languages, 5,000+ stories daily,
90,000+ online & social sources. A 2026 trade-press account puts the ASKB-visible pool at
"5,000 original stories and over 1.1 million curated stories daily."

**EVIDENCE.** Bloomberg, *EDF — Textual News* fact sheet pp.1–2 (Tier 4, official; ©2015;
fetched 2026-09-02) — all quotes above. **Verified but explicitly dated.** Bloomberg News
product page (Tier 3, fetched 2026-09-02) — the Terminal-side counts. **Claimed.** MarketsMedia,
2026-02-23 (Tier 11, trade press) — the 5,000 / 1.1M daily figures. **Reported.**

Note the internal inconsistency across Bloomberg's own materials: 146 bureaus (2026 product page)
vs 151 (2015 fact sheet); "90,000+ online & social sources" vs "more than 100,000 sources". These
are different counting definitions across a decade, not a contradiction to resolve — but it means
**no single one of these numbers should be quoted as *the* figure.**

**INTERPRETATION.** Bloomberg segments *the same newsroom* into two products with two different
value propositions: to a human at a Terminal it sells **breadth, classification and curation**;
to a black box it sells **milliseconds and a 30-year backtestable archive**. The Terminal user's
speed advantage is not sub-second delivery — it is that the *right* story reaches them at all,
because it was tagged, ranked and routed to an alert they configured once.

That is a genuinely useful correction to the folk belief that the Terminal's news edge is
latency. For a discretionary desk, the edge on offer is **routing**, not **speed**.

**RELEVANCE TO UCT.** UCT's desk is discretionary swing/options, not HFT, so the Terminal-side
proposition (breadth + classification + routing) is the relevant one and the millisecond
proposition is not. This also reframes UCT's existing news latency work: the Twitter poller's
2-minute burst cadence pre-market is, by this framing, plenty — the binding constraint on a
discretionary desk is whether the right item is surfaced and routed, not whether it arrived 8ms
sooner. The archive point is the one worth flagging: Bloomberg sells a 1992-onward news archive
*specifically* as a backtesting asset, while UCT's tweet store runs a 7-day rolling retention.
Those are opposite decisions about the same kind of data, made for different purposes.

**CONFIDENCE.** 🟡 overall — 🟢 that the segmentation exists and what each side claims;
🔴 on any *current* latency number, since the only figure I could reach is from a 2015 sheet and
the specific "8 to 11 milliseconds faster" figure appeared only in a search-result summary I
could not trace to a primary page.

**RECOMMENDATION (hypothesis).** For a small discretionary desk, news latency is likely the
wrong axis to invest in; routing and classification are where the leverage is. The archive
observation is a separate, quieter hypothesis: **news retention as a research asset** is a real
product line for Bloomberg, and a 7-day window forecloses it by construction.

**OPEN QUESTION.** What is Bloomberg's *Terminal* (not EDF) delivery latency target for a
breaking First Word item, and is it published anywhere?

---

## 11. The 2026 AI layer: summaries and grounded answers over the same tag spine

**OBSERVATION.** As of 2026 Bloomberg has layered generative AI onto news in two places:
**AI News Summaries** ("Cut straight to the news that matters to you with AI-powered summaries
on stories from more than 30,000 sources", synthesising volume into themes for a company) and
**ASKB**, a conversational/agentic interface in beta that "grounds every response in
high-quality, trusted data and includes transparent attribution to original research documents
and news sources." ASKB Workflows let a user describe multi-step tasks (earnings preparation,
post-event analysis, meeting preparation). It was extended to mobile in 2026 with mid-thread
continuity between desktop and phone. A related document-search feature (announced 2025-06) does
natural-language querying across transcripts, sell-side research and news, and connects the user
to the report's analyst via Instant Bloomberg chat.

**EVIDENCE.** Bloomberg Professional Services, *AI on Bloomberg* product page (Tier 3; fetched
2026-09-02) — the AI News Summaries and attribution quotes above. **Claimed.** MarketsMedia,
2026-02-23 (Tier 11) — ASKB beta status, CTO Shawn Edwards quote, the daily story counts.
**Reported.** The DESK / fi-desk.com, 2025-06-16 (Tier 11) — document search & analysis feature,
rollout to all Terminal users expected by end-2025, IB-chat connection to analysts. **Reported.**

**INTERPRETATION.** Two things worth recording. First, **attribution is the headline feature**,
not fluency — Bloomberg leads with grounding and citation, which is what makes an AI summary
usable in a context where being confidently wrong has a price. Second, the AI sits *on top of*
the same tag spine described in §3: it summarises "stories from more than 30,000 sources" that
were already classified, so the AI layer inherits the filtering, not replaces it. The generative
layer is a **renderer**, like `MYN` and Launchpad and the alert — one more consumer of the same
filter expression.

**RELEVANCE TO UCT.** UCT's Compass/AI-search stack made the same architectural bet and learned
the same lesson the hard way: `cot_narrative.py` gates generated prose behind a **grounding
check** where every number in the output must appear in the supplied facts, or nothing is
stored and the templated read is served instead. `cotFacts.js` is explicitly "the ONLY numbers
the LLM may cite". That is Bloomberg's "transparent attribution" claim implemented as a hard
gate rather than a promise — and UCT arguably has the stronger version, because it fails closed.

**CONFIDENCE.** 🟡 — product pages and trade press only; no primary technical documentation and
no demonstration. Beta status means today's behaviour may differ from either.

**RECOMMENDATION (hypothesis).** The layering — *AI as one more renderer over a classified
corpus, with citation as the load-bearing feature* — is what makes the AI layer additive rather
than a second authority. UCT's grounding-gate pattern already encodes this; the transferable
observation is that the biggest vendor in the space is *marketing* on attribution, which
suggests the market has priced fluency at zero and provenance at a premium.

**OPEN QUESTION.** Does ASKB cite the specific *story* or the *source*, and can a user click
through from a generated claim to the exact paragraph that supports it?

---

## 12. What practitioners actually rely on daily

**OBSERVATION.** The evidence here is thin and I want to be explicit about that. What I can
support:

- **TOP is the reflexive first stop, and stays that way for decades.** A journalism instructor
  with two decades of Terminal use, teaching a data bootcamp: "TOP; 23 years after I first used
  the terminal, I still automatically go to Top first."
- **An always-on ambient news lane.** The same source describes keeping one screen permanently
  on `NH` (news, all sources) and trying "to have the NH ticker at the bottom of whatever screen
  I'm using" — i.e. a persistent peripheral feed underneath whatever the actual task is.
- **Discovery by walking the code list.** `NH` and `NI` typed *without* `<GO>`, then "More
  Functions", is described as the way to enumerate what exists — the taxonomy is browsable from
  the command line without leaving it.
- **Bloomberg's own claim about the daily loop**: reporters and editors "can be contacted
  directly through the Terminal" — the news product ends in a person, not a document.

**EVIDENCE.** *How to Use the Bloomberg Terminal* data-bootcamp deck, pp.4–6, 10, 19 (Tier 10,
practitioner commentary; fetched 2026-09-02) — all quotes above. **Reported.** Bloomberg News
product page (Tier 3) — the contact-the-reporter claim. **Claimed.**

**INTERPRETATION.** Two habits, both about *place* rather than features: a fixed starting point
(TOP) and a fixed ambient lane (NH ticker). Neither is a capability; both are consequences of
the surface being always-present and always in the same spot. That is what "home base" means
operationally — not that the product does more, but that the user's eyes know where to go
without deciding.

**RELEVANCE TO UCT.** UCT's Dashboard already has both shapes: the Stock Catalysts tile pinned
full-width at the top (the fixed starting point) and `TapeFeed` (the ambient lane). The evidence
here suggests the value is in **positional stability over time** — the instructor's point is not
that TOP is good, it's that it has been in the same place for 23 years. Every layout change
spends that.

**CONFIDENCE.** 🔴 → 🟡. This is a single practitioner source plus vendor marketing. **The
community and practitioner evidence this question really needs — Reddit/WSO threads on daily
news habits — I could not reach**: the session's web-search budget was exhausted before I could
gather them, and I do not have URLs for them. Treat this section as directional only.

**RECOMMENDATION (hypothesis).** Positional stability may be worth more than feature parity for
a daily-use surface. The corollary anti-pattern: relocating or restyling a habitual entry point
imposes a cost that does not show up in any test and is invisible to the person making the
change.

**OPEN QUESTION.** For a *trader* rather than a *journalist*, is the ambient lane still news, or
is it price/flow with news pulled only on a move? My one practitioner source is a journalist,
and the two personas may have opposite defaults.

---

## GAPS (budget not reached / evidence unreachable)

1. **`ALRT`'s alert-builder is unverified.** Multiple secondary guides gloss `ALRT` as
   "configure alerts for specific stocks, economic events, or news stories" (Stanford) and "to
   have Bloomberg alert you of price movements" (U. Delaware), but **no source I reached
   documents the condition grammar** — whether it supports absolute price, % move, volume,
   technical-study crossings, or compound conditions. The Bloomberg "Pro Tips: Create trade
   signal alerts on the Terminal" page, which almost certainly answers this, is CAPTCHA-walled.
2. **`BLRT` Alert Catcher internals.** Whether it prioritises, groups, dedupes or is purely
   chronological. No evidence either direction.
3. **Mobile push behaviour, current.** The Bloomberg help-centre pages on push notifications
   (browser and device) are CAPTCHA-walled. My only evidence is one line in a mirrored training
   doc.
4. **News dedupe.** No public evidence that Bloomberg collapses near-duplicate wire copies.
   Recorded as unknown, not as absent.
5. **"News Themes" on charts.** Surfaced only in search-result summaries; no primary or expert
   source reached. **Do not treat as established.**
6. **Current Terminal-side news latency figures.** Only a 2015 enterprise fact sheet was
   reachable.
7. **Practitioner/community evidence (Tier 10–12).** The session-wide WebSearch budget (200
   calls) was exhausted by concurrent roles partway through my run, so I could not gather the
   Reddit / Wall Street Oasis / practitioner-blog corpus the "what they rely on daily" question
   asks for. §12 rests on one source.
8. **First Word production model** — desk-written vs templated, and its latency target.
9. **Screenshots / live UI.** I have no Terminal access and used no screenshots; every screen
   description here is textual and may be dated.

**What would raise confidence, and whether the owner could supply it.** (a) A single hour on a
live Terminal — a university library Terminal is publicly bookable at many of the institutions
cited here, which would settle items 1, 2, 5 and 9 outright. (b) A practitioner interview with
anyone on the desk who has used a Terminal professionally — settles 7 and part of 12, and the
owner may well know such a person. (c) Bloomberg's own `HELP ALRT <GO>` / `HELP NZPD <GO>`
pages, which are Terminal-internal and unreachable from the open web at any budget. Items 4, 6
and 8 may not be publicly answerable at all.

---

## SOURCES

**Primary — Bloomberg-authored**

1. Bloomberg, *News Searches* (newsroom function guide, PDF). Tier 2 (official manual/function guide). `https://sites.ohio.edu/korte/wp-content/uploads/2024/03/News%20Searches.pdf` — fetched 2026-09-02. 7pp. Mirrored on a university journalism course site; upload path dated 2024-03; contains at least one stale example line (noted in the framing note above). **The single densest source in this report.**
2. Bloomberg, *Bloomberg Terminal: Quick Start — A Bloomberg Professional Services Offering* (PDF, 44pp). Tier 2. `https://sites.ohio.edu/korte/wp-content/uploads/2024/03/Top%20Newsroom%20Functions%20for%20the%20Terminal.pdf` — fetched 2026-09-02. Includes the official cheat sheet (p.41) glossing `TOP`/`READ`/`N`/`NLRT`/`NI`/`FIRS`.
3. Bloomberg, *Getting started on the Bloomberg Terminal* (student guide, PDF, 28pp). Tier 2. `https://data.bloomberglp.com/professional/sites/10/Getting-Started-Guide-for-Students-English.pdf` — fetched 2026-09-02. Source for `FIRS`, `SALT`, `BRIE`, `MSG`, `MRUL`, `CN`, `TWTR`, `PRTU`/`PORT`.
4. Bloomberg Professional Services, *News* product page. Tier 3 (official product page). `https://professional.bloomberg.com/products/bloomberg-terminal/news/` — fetched 2026-09-02. Source counts, Top News / First Word / Daybreak / Morning Report / News Trends / Automated Intelligence descriptions.
5. Bloomberg Professional Services, *AI on Bloomberg*. Tier 3. `https://professional.bloomberg.com/products/bloomberg-terminal/ai/` — fetched 2026-09-02. AI News Summaries, ASKB grounding/attribution.
6. Bloomberg, *Textual news provides unmatched coverage, classification, depth and speed* — Event-Driven Feeds fact sheet (PDF, 2pp, ©2015). Tier 4 (official enterprise/data product doc). `https://assets.bbhub.io/professional/sites/41/Fact-Sheet-EDF-Textual-News.pdf` — fetched 2026-09-02. **Dated 2015 — treat figures as historical.**

**Secondary — university library guides (Tier 9)**

7. NYU Law Library, *Bloomberg Terminal — Common Searches*, upd. 2026-08-03. `https://nyulaw.libguides.com/c.php?g=1342741&p=9900975` — fetched 2026-09-02. `MRUL` + `NLRT` alert-to-email steps.
8. U.S. Dept of Commerce, Commerce Research Library, *Getting Started — The Bloomberg Terminal*, upd. 2026-06-11. `https://library.doc.gov/bloomberg/using-the-bloomberg-terminal` — fetched 2026-09-02. Independent corroboration of the same MRUL sequence and real-time-email caution.
9. Stanford Libraries, *Bloomberg Terminal Guide — Tips and Tricks*, upd. 2025-06-12. `https://guides.library.stanford.edu/bloomberg_terminal/tips_tricks` — fetched 2026-09-02. `TOP`, `N`, `NI`, `ALRT`.
10. Johns Hopkins Sheridan Libraries, *Bloomberg — News*, upd. 2026-05-20. `https://guides.library.jhu.edu/bloomberg/news` — fetched 2026-09-02. `N`, `NSE`, `TOP`, `READ`, `LIVE`.
11. New York Institute of Technology, *Bloomberg Terminal — The Keys*, upd. 2026-08-03. `https://libguides.nyit.edu/c.php?amp=&g=1054896&p=7662441` — fetched 2026-09-02. Yellow/green/red key roles; `N`, `TOP`, `READ`, `CN`.
12. Pace University Library, *Bloomberg — Mnemonics*, upd. 2026-05-11. `https://libguides.pace.edu/c.php?g=63952&p=410850` — fetched 2026-09-02.
13. University of Delaware (Lerner), *Bloomberg Functions List*. `https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list/` — fetched 2026-09-02. `ALRT`, `N`/`TOP`, `CN`, `BBEA`, `MSGM`.
14. Chicago Booth, *Bloomberg Station Reference Guide* (PDF, 20pp). `https://research.chicagobooth.edu/-/media/research/famamiller/docs/bloomberg.pdf` — fetched 2026-09-02. p.18 news function block: `N`, `NSE`, `TNI`, `NI`, `TOP`, `NI READ`, `NH NYT`, `NI MAG`; p.19 `INTC <EQUITY> CN`.
15. University of Scranton (KSOM), *Technical Analysis / Equity Charting* (PDF, 9pp). `https://www.scranton.edu/academics/ksom/alperin/Equity-%20Charting.pdf` — fetched 2026-09-02. p.8: news/events/earnings flags plotted on the chart. **Only source reached for news-on-chart mechanics.**
16. Georgia State University Library, *Bloomberg — Help & Training*, upd. 2026-08-03. `https://research.library.gsu.edu/bloomberg/help` — fetched 2026-09-02. `HELP` (×1 / ×2), `CHEAT`, `BU`, `BESS`, `BMC`.
17. University of Baltimore Law Library, *Bloomberg Law — Alerts and Current Awareness*, upd. 2026-07-15. `https://law.ubalt.libguides.com/c.php?g=518238&p=3543958` — fetched 2026-09-02. **Used only as a contrast/negative**: this documents Bloomberg *Law*, a different product with a different alert model (frequency dropdown: hourly/daily/weekly, Alerts Inbox) and **no Terminal mnemonics**. Recorded to prevent a synthesis task from conflating the two.

**Practitioner and trade press (Tier 10–11)**

18. *How to Use the Bloomberg Terminal* — journalism data-bootcamp deck (PDF, 45pp). Tier 10 (practitioner commentary; an instructor with ~23 years of Terminal use). `https://multimedia.report/images/classes/data-bootcamp/pdfs/bloomberg-terminal.pdf` — fetched 2026-09-02. TOP-first habit, `NH` ambient ticker, NI code list, `TNI`, `CN BN`, `OTOP`, `BIO`.
19. MarketsMedia, *Bloomberg Introduces Agentic AI to the Terminal*, pub. 2026-02-23. Tier 11 (trade press). `https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/` — fetched 2026-09-02. ASKB beta, 5,000 original / 1.1M curated stories daily, CTO quote.
20. The DESK (fi-desk.com), *Bloomberg Terminal releases document search and analysis feature*, pub. 2025-06-16. Tier 11. `https://www.fi-desk.com/bloomberg-terminal-releases-document-search-and-analysis-feature/` — fetched 2026-09-02.
21. Corporate Finance Institute, *Bloomberg Functions List*. Tier 11 (professional tutorial; **lowest-trust source used**, cited only for the `NSE` constraint tails which no higher-tier source enumerated). `https://corporatefinanceinstitute.com/resources/equities/bloomberg-functions-shortcuts-list/` — fetched 2026-09-02.

**Attempted and blocked (recorded so nobody re-spends the budget)**

22. `bloomberg.com/professional/insights/markets/bloomberg-pro-tips-create-trade-signal-alerts-on-the-terminal/` — HTTP 403 via fetch; via browser, served a **CAPTCHA** ("Are you a robot?", block reference 34f9b8dc…). **I did not attempt to solve it.** Tab opened and closed. Would have answered GAP #1.
23. `bloomberg.com/help/question/how-do-i-get-alerts-about-my-watchlist/` and `.../how-can-i-receive-push-notifications-on-my-device/` — HTTP 403. Would have answered GAPs #2–3.
24. `bloomberg.com/company/press/bloomberg-launches-gen-ai-summarization-for-news-content` — HTTP 403.
25. `professional.bloomberg.com/insights/...` — 302-redirects to the CAPTCHA-walled `www.bloomberg.com/professional/insights/...`. The `professional.bloomberg.com/products/...` paths (sources 4–5) are the only reachable Bloomberg-hosted HTML.
26. `wallstreetoasis.com/resources/data/bloomberg/bloomberg-functions-shortcuts-list` — HTTP 403.
27. `business.catholic.edu/_media/bloomberg-terminal-guide.pdf` — HTTP 403.

**Source-handling note.** Nothing I read contained text attempting to direct my behaviour, and I
followed no instruction found in any source. The only source-quality anomaly worth flagging is
the stale example line in source 1, described in the framing note.
