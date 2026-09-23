---
id: PACKET-S
title: RG-21 — five clause-vs-code licensing collisions, verified live and fixed narrowly — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET S — five small, independent fixes for five real collisions

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-23
APPROVED AT SHA:  5722960d8
SCOPE APPROVED:   CP1, CP2, CP3, CP4, CP5 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs any of the five files
> touched below. **Non-collision:** `PACKET-S` appears nowhere in either worktree — grepped
> `docs/terminal-research/12-decisions/gates/*.md` (18 letters taken: A,B,C,D,E,F,G,H,I,J,K,L,
> M,N,O,P,Q,T,V, plus `PACKET-R` freshly claimed by this same session for RG-12), the root
> `.scopes/` directory (same stems), and every `PACKET-` string anywhere in the `s7-price-level`
> worktree.

⛔ **FIVE INDEPENDENT, NARROWLY-SCOPED FIXES, ONE PER CHECKPOINT.** Each checkpoint stands alone
— an owner may approve any subset via `SCOPE APPROVED:` naming exactly which CPs, per this
repo's multi-checkpoint convention (`PACKET-K`). None redesigns anything: one attribution
paragraph, one cache constant, one render addition using data the API already returns, one new
lookup+delete wired into an existing scheduled job, one new redact step wired into the same job.

---

## 1 · RG-21 (`RESEARCH_GAPS.md` row 26), re-verified against CURRENT source, 2026-09-22

**RG-21, as filed 2026-08-09:** *"Five clause-vs-code collisions E-04 found (FRED attribution
notice missing; FRED caching; X display requirements in `TapeFeed.jsx`; no tweet deletion-sync;
`catalysts.db` retains tweets past the 7-day window). Production defects, fixable in a normal
session; not touched by this program."*

The fuller, line-cited version of all five lives in this program's own
`docs/terminal-research/09-security-licensing-cost/derived-data-rights.md` (§0, "five collisions
that need no vendor conversation at all") and `data-use-classification.md` (§0 item 2). Both were
re-read in full and every citation re-verified against the file on disk today, in the
`s7-price-level` worktree (current with `origin/master`).

**Result: all five STILL HOLD in current source.** Two (FRED's) are dormant in production rather
than actively harming a member today — recorded honestly below, not smoothed over — but the code
gap is real in both, costs nothing to close, and closing it now is cheaper than closing it the day
someone sets the key. The other three are live and unconditional.

### 1a · FRED attribution notice — STILL MISSING, code confirmed empty, feature confirmed DORMANT

`fred_economic.py` (92 lines) contains no attribution string. A repo-wide search for the required
sentence and its constituent phrases —

```
grep -rn "Federal Reserve Bank of St. Louis\|FRED®\|not endorsed or certified" app/src api
```

— returns **zero matches** anywhere in `app/src` or `api`. FRED's own Terms of Use (quoted
verbatim in `vendor-terms-evidence.md` §4) requires: *"Place the following notice prominently on
your application: 'This product uses the FRED® API but is not endorsed or certified by the
Federal Reserve Bank of St. Louis.'"*, plus a link to the Terms of Use and a clause in UCT's own
terms binding its users to them.

⚰️ **Corrected from this program's own prior note, live-reverified today.** `data-use-classification.md`
recorded (as of ORCH-RAILWAY-01's read) that `FRED_API_KEY` is absent on every Railway service, so
this code path "currently returns nothing." **Re-checked live, 2026-09-22**
(`railway variables --service web --kv`, 271 variables enumerated): `FRED_API_KEY` is still absent
from the `web` service today. `fred_economic.get_series()` (`:105-111`) short-circuits to
`{"error": "FRED_API_KEY not configured"}` before any request is made, so no FRED content is
currently fetched, cached, or shown to any member. **The finding holds as a code gap, not as a
live exposure** — worth closing because it is free and because the two consumers
(`voice_tool_impls.py:442-454`, Compass's `get_fred_series`/`list_fred_series` tools; and
`options_chain.py:32-33`, an internal risk-free-rate input) start working the moment the key is
set, with no further review of this gap at that time.

### 1b · FRED caching — STILL PRESENT, same dormancy caveat as 1a

```
23:  _CACHE = TTLCache()
24:  _CACHE_TTL = 1800  # 30 min
...
100:  cache_key = f"fred::{series_id}::{periods}"
101:  cached = _CACHE.get(cache_key)
102:  if cached is not None:
103:      return dict(cached)
...
158:  _CACHE.set(cache_key, dict(result), _CACHE_TTL)
```

An in-memory, process-local 30-minute TTL cache of FRED response bodies, matching the exact two
citations (`:24,158`) `derived-data-rights.md` gave for this collision. Same dormancy fact as
§1a: with no key configured, `get_series()` never reaches line 113's `requests.get` call, so this
cache is never actually populated in production today. The code itself is unchanged and would
begin caching FRED content the moment a key is set.

### 1c · X's display requirements in `TapeFeed.jsx` — STILL UNMET, EXACTLY, live and unconditional

Current file (73 lines), read in full:

```
20:  // Style cashtags ($AAPL) in brand gold while keeping plain text intact.
21:  // Author handles are intentionally NOT rendered — content only.
22:  function renderTweetText(text) {
```

```
48:      {tweets.map((t) => (
49:        <div
50:          key={t.id}
...
53:          <div className={styles.text}>
54:            {renderTweetText(t.text)}
55:          </div>
56:          <div className={styles.meta}>
57:            {isRecent(t.created_at) && <span className={styles.newDot} title="New" />}
58:            <span className={styles.time}>{timeAgo(t.created_at)}</span>
59:            <a
60:              className={styles.link}
61:              href={t.url}
62:              target="_blank"
63:              rel="noopener noreferrer"
64:              title="open on X"
65:            >↗</a>
66:          </div>
67:        </div>
68:      ))}
```

Rendered today: tweet **text** (yes), a relative **timestamp** (yes), and a **permalink** (yes,
the `↗` icon at `:59-65`). **Missing, confirmed by reading the file and its stylesheet**: author
display name, author `@handle` (line 21's comment says this is deliberate — "intentionally NOT
rendered"), an avatar, and the X logo. `grep -n "avatar\|display_name\|author_handle\|logo"
TapeFeed.jsx TapeFeed.module.css` returns zero matches in either file. This is the same shape RG-21
named, at the same lines (`:53-68` cited originally; the render block is unchanged at `:48-68`
today). **Live and unconditional** — `TWITTERAPI_IO_ENABLED` gates the ingestion pipeline, not
this rendering; whenever the pipeline has any tweets at all, this gap is showing.

**The missing fields already flow through the API and need no backend change.** `tweet_store.py`'s
schema (`:41-54`) stores `author_handle` and `author_name` on every row; `feed()` (`:330-373`)
`SELECT * FROM tweets` and returns every column, unfiltered, to `GET /api/tweets/feed`
(`api/routers/tweets.py:50-58`), which `useTweetFeed.js` fetches verbatim. `t.author_name` and
`t.author_handle` are present on every object `TapeFeed.jsx` already holds — simply not rendered.

### 1d · No tweet deletion-sync — STILL TRUE, confirmed by absence

`api/services/tweet_cleanup.py` (15 lines, read in full) is the **only** cleanup mechanism for
`tweets.db`, and it is purely age-based:

```
10:  def run_cleanup() -> int:
11:      days = int(os.environ.get("TWEET_RETENTION_DAYS", "7"))
12:      deleted = tweet_store.delete_tweets_older_than(days=days)
```

A repo-wide search for any tweet-existence / deletion-status check (`is_deleted`, `check_deleted`,
`deleted_at`, `verify_tweet`, `tweet_exists`) returns no hits anywhere under `api/`, and
`api/services/twitterapi_io.py`'s function list (`get_user_last_tweets`, `search_tweets`,
`get_user_profile_image`, plus their private helpers) contains no tweet-lookup-by-id or
existence-check call. X's Developer Agreement (`vendor-terms-evidence.md` §7, `§IV.B`) imposes a
**24-hour** delete-if-deleted-on-X duty — a materially tighter window than the 7-day age sweep,
and one the age sweep cannot satisfy: a tweet ingested on day 1 and deleted on X on day 2 stays in
`tweets.db` (and can still be quoted into a catalyst's `raw_signals`, see §1e) for up to 6 more
days under the current sweep alone.

### 1e · `catalysts.db` retains tweet/RSS bodies past the 7-day window — STILL TRUE, verified in the schema and the write path

`api/services/catalyst/store.py`'s schema (`:26-50`) has no retention logic of any kind for the
`catalysts` table (its only comparable code, `:883-899`'s `log_rejection`, prunes the unrelated
`catalyst_gate_rejections` table by age — nothing analogous exists for `catalysts` itself). CLAUDE.md
states the design intent plainly: *"Primary DB: `/data/catalysts.db` … **Indefinite retention.**"*

The `raw_signals` column is where vendor content actually lands. `catalyst/engine.py:1253-1255`:

```
1253:  "raw_signals": json.dumps({
1254:      "tweets": c.get("tweets", []),
1255:      "rss": c.get("rss", []),
```

`c["tweets"]` are the exact dicts sourced from `tweet_store.tape()` / `twitterapi_io.search_tweets()`
— each one carrying the tweet's full `text` field (`engine.py:126-129` reads `t.get("created_at")`
off the same objects that also carry `text`, per `tweet_store.py`'s `_normalize`/schema shape) — and
`c["rss"]` items carry full headline/summary bodies (`engine.py:458,583,640` append `{"title":
..., "url": ..., ...}` RSS dicts into this same list). `store.upsert_catalyst` (`:338-373`) writes
`raw_signals` verbatim, keyed `PRIMARY KEY (market_date, ticker)`, and nothing ever deletes or
trims it. So a tweet quoted into a catalyst's `raw_signals` on day 1 is still sitting in
`catalysts.db`, full text intact, on day 3,000 — long after `tweets.db`'s own 7-day sweep has
removed the same tweet from its source-of-truth table, and long after a deletion-sync (§1d, once
built) would have removed it there too.

**Verdict: all five sub-findings STILL HOLD.** (a) and (b) are code gaps currently shielded from
live consequence by `FRED_API_KEY` being unset — recorded honestly, fixed anyway because it is
free. (c), (d) and (e) are live, unconditional, and exactly as RG-21 described.

---

## 2 · Proposed checkpoints

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | FRED mandatory attribution notice + Terms-of-Use link, added to `Terms.jsx` | none | **S** |
| **CP2** | FRED cache TTL tightened in `fred_economic.py` | none | **S** |
| **CP3** | X display requirements (author name/@handle + X mark) added to `TapeFeed.jsx`, using fields the API already returns | none | **S** |
| **CP4** | One tweet-existence lookup + one delete-by-id wired into the existing nightly `tweet_cleanup` job | none | **S** |
| **CP5** | One redact-stale-vendor-text step, wired into the same existing nightly job, for `catalysts.raw_signals` | none | **S** |

Each CP is independently approvable — `SCOPE APPROVED:` may name any subset (e.g. *"CP1, CP2, CP3
ONLY"*), per this repo's multi-checkpoint convention (`PACKET-K`, `SCOPE APPROVED: CP1, CP2
ONLY`).

### CP1 — FRED attribution notice

**MUST-BUILD, exactly:**
1. `app/src/pages/Terms.jsx`: add one new numbered section, **after** the existing final section
   (`12. Contact`, `:119`) so no existing heading is renumbered — e.g. `13. Third-Party Data —
   FRED® API`. Its body contains, verbatim: *"This product uses the FRED® API but is not endorsed
   or certified by the Federal Reserve Bank of St. Louis."*, a link to
   `https://fred.stlouisfed.org/docs/api/terms_of_use.html`, and one sentence stating that use of
   any FRED-derived feature is subject to those terms (the "downstream terms" requirement quoted
   in §1a). Same `styles.prose` / `<h2>`/`<p>` shape every other section already uses — no new
   component, no new stylesheet rule.
2. Nothing else on the page changes.

**Explicitly deferred:** the per-series copyright check `vendor-terms-evidence.md` §4 also
recommends ("contact the data owner" for any FRED series whose notes contain the word
"Copyright") — a one-time `fred/series/search` audit against the ~26 series in
`fred_economic.py`'s `_SERIES_CATALOG`, not a code change, and out of this packet's scope.

### CP2 — FRED caching

**MUST-BUILD, exactly:**
1. `api/services/fred_economic.py` line 24: change `_CACHE_TTL = 1800  # 30 min` to a materially
   shorter value — `_CACHE_TTL = 300  # 5 min` — tightening the window during which FRED response
   content is held in the process cache rather than re-fetched.
2. Add one dated comment above the constant citing this packet and the FRED clause it responds
   to, in the style `narrative_cost_guard.py:57-63` already uses for its own compliance-driven
   constants.
3. Nothing else in the file changes — the cache mechanism itself, `TTLCache`, and every call site
   are untouched.

**Explicitly deferred:** removing the cache entirely. This packet tightens it (per the task's own
minimal-fix framing); the underlying "any portion" characterization of FRED's restriction is
`derived-data-rights.md`'s synthesis, not a clause this packet re-derives from FRED's site, and a
fuller resolution (cache removal, or a written FRED confirmation that a short TTL is acceptable)
is the integrating session's or the owner's call once the key is actually armed.

### CP3 — X display requirements in `TapeFeed.jsx`

**MUST-BUILD, exactly:**
1. `app/src/components/tiles/TapeFeed.jsx`: inside the per-tweet `<div className={styles.item}>`
   block (`:49-68`), add one line rendering `t.author_name` and `t.author_handle` (both already
   present on every object `useTweetFeed` returns — no backend change) as a small byline, e.g.
   above or beside the existing `.text` block. Remove or update the `:21` comment ("Author handles
   are intentionally NOT rendered — content only") to reflect the new behavior — a comment
   asserting the opposite of what the code now does is worse than no comment
   (`lesson_a_comment_claiming_agreement_is_not_agreement`).
2. Add one small "X" wordmark glyph next to the existing permalink icon (`:59-65`), per X's brand
   display requirements. Per this repo's own icon convention (CLAUDE.md, "UI Icons — `UIcon`"),
   add it as one new named glyph in `app/src/components/ui/UIcon.jsx`'s registry rather than an
   inline SVG or an emoji — the smallest change consistent with the codebase's existing pattern
   for a new icon.
3. `app/src/components/tiles/TapeFeed.module.css`: add the minimum styling needed for the new
   byline + glyph to sit legibly in the existing `.meta`/`.item` layout — no restructuring of the
   existing flex layout.
4. Nothing else changes — `renderTweetText`, the retweet dimming, the `isRecent` pulse dot, and
   every other existing behavior stay as they are.

**Explicitly deferred:** an avatar image. `tweet_store.py` does not currently store or serve a
per-tweet avatar URL (`api/services/twitterapi_io.py:239`'s `get_user_profile_image` exists but is
not wired into the tweet-ingestion write path), so adding one is a backend change larger than this
narrow packet takes on — a real follow-up, not authorized here.

### CP4 — tweet deletion-sync

**MUST-BUILD, exactly:**
1. `api/services/twitterapi_io.py`: add ONE new function, alongside the existing
   `get_user_last_tweets`/`search_tweets`, that checks a batch of tweet ids against
   TwitterAPI.io's own tweet-lookup capability and reports which ids no longer resolve (deleted,
   protected, or suspended-account). Follow the exact defensive shape `_extract_tweets` already
   uses for tolerating response-shape variation, and the same `TwitterApi*` exception classes for
   error handling — no new exception taxonomy.
   ⚠️ The exact TwitterAPI.io endpoint path for this lookup is a build-time detail to confirm
   against their current docs — not invented here, per this repo's own rule that a citation
   nobody can quote is struck rather than guessed at.
2. `api/services/tweet_store.py`: add ONE new function, `delete_tweets_by_ids(ids: list[str]) ->
   int`, mirroring `delete_tweets_older_than`'s shape (same `_WRITE_LOCK` + `contextlib.closing`
   pattern, cascades to `tweet_tickers` the same way).
3. `api/services/tweet_cleanup.py`: add ONE new step to the existing `run_cleanup()` — before or
   after the existing age sweep, select tweet ids ingested within X's 24-hour window (a query
   against `tweets.ingested_at` or `created_at`, not a new table), batch-check them via step 1,
   and call step 2's delete function on whatever comes back gone. **No new scheduler entry** — this
   rides the existing 3am ET `tweet_cleanup` job (`main.py`'s existing registration), so no
   scheduling change is needed.
4. Nothing else changes. The existing age-based sweep (`delete_tweets_older_than`) stays exactly
   as it is — this adds a second, faster-acting check, it does not replace the first.

### CP5 — `catalysts.db` retention of tweet/RSS bodies

**MUST-BUILD, exactly:**
1. `api/services/catalyst/store.py`: add ONE new function, e.g. `redact_stale_raw_signals(days:
   int = 7) -> int`, that selects `catalysts` rows whose `market_date` is older than the cutoff
   and whose `raw_signals` still contains tweet/RSS text bodies, and `UPDATE`s `raw_signals` to a
   stripped form that keeps structural fields (ticker counts, source counts, timestamps used by
   `_compute_catalyst_at`) but drops the verbatim `text`/`title`/`url` bodies sourced from
   `tweets`/`rss`. **This does not touch `thesis_text`, `score`, `grade`, `tag`, or any other
   column** — those are UCT's own synthesized output, not vendor content, and this program's own
   design intent (CLAUDE.md's "Indefinite retention") is preserved for exactly those fields.
2. `api/services/tweet_cleanup.py`: add ONE call to the new function from the existing
   `run_cleanup()`, using the same `TWEET_RETENTION_DAYS` env var (default 7) so the two retention
   windows — the tweet's own table and its echo inside a catalyst row — cannot drift apart the way
   this finding shows they already have. **No new scheduler entry.**
3. Nothing else changes — no change to `upsert_catalyst`, no change to what gets written at
   synthesis time, no change to `/catalysts/history`'s read path (which reads `thesis_text` and
   the structured columns, not `raw_signals`, for display).

### Explicitly deferred, NOT authorized by this packet (all checkpoints)

- Any change to `TWEET_RETENTION_DAYS`'s default value, or to `CATALYST_COST_CAP_DAILY`-style env
  defaults.
- The FRED per-series copyright audit (§CP1) and the AlphaVantage/FMP/Finnhub collisions named
  elsewhere in `derived-data-rights.md` — separate findings, separate program rows, not RG-21.
  `RG-21` is explicitly five collisions "found by reading the clauses against the code," and this
  packet closes exactly those five, and no others.
- Any redesign of the tweet ingestion pipeline, the catalyst engine's source-pulling, or the
  Twitter UI beyond the one byline + one glyph named in CP3.

### Risk

**Low, per checkpoint, independently.** CP1 is a static text addition to a legal page nothing else
reads programmatically. CP2 is a single-constant reduction with no behavior change beyond more
frequent FRED re-fetches (currently zero, since the key is unset — §1a/1b). CP3 renders two fields
the API already returns and adds one icon glyph; no data model change. CP4 and CP5 both add one
new function each plus one new call from an *existing* scheduled job — no new scheduler
registration, no change to the job's cadence, and both are purely deletion/redaction paths that
cannot make a member-facing read path return anything it didn't already return (worst case: a
tweet or a raw_signals body disappears slightly earlier than the current 7-day floor, never
later). None of the five touches `api/main.py`'s scheduler wiring, any endpoint contract, or any
frontend route.
