# UCT RS nightly Discord post - the template, decided 2026-11-07

Status: built dark (engineering map `docs/superpowers/plans/2026-11-06-uct-rs-phase2-engineering-map.md`,
section 2.9 and section 3 rows 2b-07 and 2b-08). The template below is the one the owner's delegated
decisions of 2026-11-07 settled on (rows P1 to P10 of
`docs/research/relative-strength/reviews/2026-11-07-delegated-decisions.md`; section 8 lists each one). The
flag `RS_DISCORD_POST_ENABLED` is declared dark in `docs/feature_flags.json`; the webhook variable
`DISCORD_RS_WEBHOOK_URL` is registered in `api/services/alert_taxonomy/channels.py` and set on no service.
The scheduled job (04:45 ET with a 05:15 ET retry) and the admin door are registered by unit 2b-08, and
nothing posts until the owner creates the webhook in `#uncharted-scanners`, sets the variable and arms the
flag, last of the four RS flags.

Code: `api/services/rs_discord_post.py` (the poster), `api.main._rs_leaders_for` (the real reader),
`api/routers/rs_discord.py` (the admin door). Tests: `tests/test_rs_discord_post.py`,
`tests/test_rs_discord_registrar.py`. Both samples in section 1 are rendered from the fixture in section 2
by the test suite and pinned byte for byte, so this file cannot drift from the code without a red test.

## 1. What a member reads

One plain-text message every settled session, in `#uncharted-scanners`, from the webhook identity
`UCT Intelligence`, every mention disabled. Rendered for session 2026-11-05 (a Thursday), a red day:

<!-- sample:start -->
```text
UCT RS leaders for Thursday, November 5.

RS new highs before price: NVDA (97), ANET (95), CRWD (93)
RS new highs on a red day: NVDA (97), PLTR (96), ANET (95), AVGO (94), CRWD (93), APP (92), VRT (91), GEV (90), and 1 more
Rating 90 and above, with sector:
NVDA (97) Technology
PLTR (96) Technology
ANET (95) Technology
AVGO (94) Technology
CRWD (93) Technology
APP (92) Technology
VRT (91) Industrials
GEV (90) Industrials

Rule: an RS new high is the RS line against SPY closing at its highest level of the last 252 bars. Before price means the stock is still more than 2% below its own high. A red day is SPY closing down 0.5% or more. The rating is IBD-style, 1 to 99, ranked across the cap universe excluding ETFs.
Evidence: no published hit rate exists for these signals and UCT has not measured one yet. A measured number with its sample size and dates replaces this sentence once the nightly backtest reports.
Not a recommendation.
```
<!-- sample:end -->

940 characters; Discord allows 2000. The same names on a session that was NOT a red day, SPY up 0.4%
(the fixture with every `red_day` flag off, and `spy_change_pct` 0.4 from the reader):

<!-- sample-calm:start -->
```text
UCT RS leaders for Thursday, November 5.

RS new highs before price: NVDA (97), ANET (95), CRWD (93)
RS new highs on a red day: SPY was not a red day (+0.4%)
Rating 90 and above, with sector:
NVDA (97) Technology
PLTR (96) Technology
ANET (95) Technology
AVGO (94) Technology
CRWD (93) Technology
APP (92) Technology
VRT (91) Industrials
GEV (90) Industrials

Rule: an RS new high is the RS line against SPY closing at its highest level of the last 252 bars. Before price means the stock is still more than 2% below its own high. A red day is SPY closing down 0.5% or more. The rating is IBD-style, 1 to 99, ranked across the cap universe excluding ETFs.
Evidence: no published hit rate exists for these signals and UCT has not measured one yet. A measured number with its sample size and dates replaces this sentence once the nightly backtest reports.
Not a recommendation.
```
<!-- sample-calm:end -->

The fixture is illustrative: the tickers, ratings, sectors and SPY's change are not measured values.

Line by line:

- Headline: the session as a weekday and date. The session key comes from the snapshot, never from the
  clock, so a stale session is never captioned with today's date.
- RS new highs before price: the names whose RS line made a 252-bar high while price is still more than
  2% below its own high (the large gold dot on the chart), best rating first, the IBD-style rating in
  brackets.
- RS new highs on a red day: the names whose RS line made a 252-bar high on a session where SPY closed
  down 0.5% or more (the Stress test marker). On a session that was not a red day the line says so with
  SPY's own change for the session, `SPY was not a red day (+0.4%)`, so an empty list is never read as
  "no name held up on a down day". It reads `none` only on a red day where no name qualified, or when
  SPY's change for the session is unknown.
- Rating 90 and above, with sector: one name per line, the sector after the rating when the row carries
  one. The sector appears on this list only.
- Rule: the definitions behind the three lists, once, in plain words.
- Evidence: a measured number with its sample size and dates when the nightly backtest has reported one;
  otherwise the honesty sentence. Never a claim without a number (section 5).
- Sign-off: `Not a recommendation.` The username already says who is posting.

A list longer than its cap ends in `and N more`; the cut is always between names, never inside one. An
empty list reads `none`. A name without a rating reads `(unrated)`; a number is never made up. SPY's change
prints with one decimal and a sign (`0.0%` never carries one); when one decimal would round a session that
was not a red day onto the threshold, it prints two (`-0.46%`, never `-0.5%` beside a rule that calls
-0.5% red).

## 2. The fixture the samples are rendered from

| ticker | rating | sector | new_high | before_price | red_day | rs_line_above |
|---|---|---|---|---|---|---|
| NVDA | 97 | Technology | yes | yes | yes | yes |
| PLTR | 96 | Technology | yes | no | yes | yes |
| ANET | 95 | Technology | yes | yes | yes | yes |
| AVGO | 94 | Technology | yes | no | yes | yes |
| CRWD | 93 | Technology | yes | yes | yes | yes |
| APP | 92 | Technology | yes | no | yes | yes |
| VRT | 91 | Industrials | yes | no | yes | yes |
| GEV | 90 | Industrials | yes | no | yes | yes |
| LLY | 88 | Healthcare | yes | no | yes | yes |
| COST | 84 | Consumer Defensive | no | no | yes | yes |

Nine names made an RS new high on the red day, one over the cap of eight, so the second list ends in
`and 1 more` (LLY). COST made no new high and is below 90, so it appears nowhere. The fixture lives in
`tests/test_rs_discord_post.py` as `FIXTURE`; the second sample is the same rows with `red_day` off.

## 3. The seam contract

The poster is built against two injected readers. Unit 2b-08 wires the real ones: `api.main._rs_leaders_for`
over the 2a-05 screener columns (`rs_new_high`, `rs_nh_before_price`, `rs_nh_red_day`, `rs_line_above_ma`)
and the 2a-06 column `rs_rating_ibd`, and `api.main._rs_evidence_for` over the 2b evidence artifact.

`leaders_fn(session)` returns either the rows (a list) or the mapping
`{"leaders": [rows], "spy_change_pct": float or None}` (`rs_discord_post.split_leaders` reads both). The
real reader returns the mapping. `spy_change_pct` is SPY's own screener row's `chg_pct_1d` for the same
session: the close-to-close change of the same settled SPY bars the builder's red-day flag reads, so the
number the red-day line prints is the number the red-day judgement was made on. A missing SPY row or a
NULL change is `None`, which prints `none`, never a guessed change. SPY itself is never one of the leaders:
its RS line against itself is a constant 1.0, which ties its own 252-bar high every session.

One row per candidate name for the settled session. Row keys (`rs_discord_post.normalise_leaders`
enforces this once; `ROW_KEYS` names them):

| key | type | meaning |
|---|---|---|
| `ticker` | str, required | upper-cased; a repeated ticker keeps its first row; a row without one is dropped |
| `name` | str, optional | carried, not rendered |
| `sector` | str, optional | rendered in the rating list when present |
| `rating` | int 1 to 99 or None | the IBD-style rating (`rs_rating_ibd`, `read_fields()[t]["ibd"]`); anything else is None and renders `(unrated)` |
| `new_high` | bool | the RS line closed at a 252-bar high this session |
| `before_price` | bool | that high came while price is still more than 2% below its own high; read only together with `new_high` |
| `red_day` | bool | the session was a red day for the benchmark (SPY closed down 0.5% or more); read only together with `new_high` |
| `rs_line_above` | bool | the RS line is above its 21-bar average; carried, not rendered (decision P5, section 8) |

Rows are sorted rating descending, unrated last, then ticker. A name flagged `red_day` is listed whatever
SPY's change says: the flag is the screener's judgement per name, and the post never drops a name it was
handed. A reader that returns nothing, or raises, produces no post and a receipt that says why.

`evidence_fn(session) -> dict | list[dict] | None`, the nightly backtest's measured numbers (unit 2b
evidence job). Each entry renders only when complete: `n` (int, above 0), `hit_rate_pct` (0 to 100),
`horizon_bars` (int, above 0), `start` and `end` (YYYY-MM-DD, start not after end); optional `signal`
(default `RS new highs`), `outcome` (default `closed higher N bars later`) and `survivorship_corrected`
(False appends `Universe as held, survivorship not yet corrected.`). A failing `evidence_fn` prints the
honesty sentence.

## 4. Limits

`rs_discord_post.LIMITS`, overridable key by key on `build_post` and `post_rs_summary`:

| key | default | what it does |
|---|---|---|
| `before_price` | 8 | names in the before-price list before `and N more` |
| `red_day` | 8 | names in the red-day list before `and N more` |
| `rating` | 10 | lines in the rating list before `and N more` |
| `rating_min` | 90 | the rating list's threshold |
| `floor` | 3 | fewer distinct names than this across the whole post is no post (the plan's three-name floor) |

Discord's own limits, enforced by `validate_post`: 2000 content characters, 80 username characters, 10
embeds, 6000 embed characters in total, 256 title, 4096 description, 25 fields of 256 by 1024, 2048
footer, 256 author. The post uses content only; the embed checks exist so a later embed version cannot
ship outside the limits.

## 5. The evidence rule

Never a claim without a number. The evidence line is one of exactly two things: measured sentences
(sample size, date range, hit rate, horizon) from the nightly backtest, or the honesty sentence that
says no such number exists yet. There is no third form, so the post can never carry a vague claim such
as "these names tend to lead" without the number behind it. The design plan's section 9 wording about
the universe as held is appended only when the evidence itself says survivorship is not corrected.

## 6. The validator

`validate_post(post)` returns every reason the post must not go out, precisely, or an empty list. It
refuses: content over 2000 characters; any embed over its limit; `@everyone` and `@here`; user, role and
channel mentions; any other `@`; emoji, emoji shortcodes and HTML markup; markdown (bold, underline,
code, strike, spoiler, and lines that open a list, quote or heading); exclamation marks; em and en
dashes; the design plan's banned vocabulary (`elite`, `powerful`, `unlock alpha`, `institutional
accumulation`, `leading indicator`, `crystal ball`, `guarantee`) and the verbs `buy` and `sell`; an
`allowed_mentions` that is not `{"parse": []}`; a missing username. Digits, `+` and `-` are allowed:
unlike the close note, this post must carry numbers and SPY's signed change. A refused post is not sent,
even when forced, and the receipt carries the reasons.

## 7. Switches, channel, dedup and failure handling

- Flag: `RS_DISCORD_POST_ENABLED`, read per call by `rs_discord_post.enabled()`; only the literal `1`
  arms it. Off is the reason `not enabled` and nothing else is read.
- Channel: `#uncharted-scanners`, through a webhook. The owner creates the webhook in that channel (the
  bot token is 403 there, so a bot post is not an option) and sets `DISCORD_RS_WEBHOOK_URL` on the web
  service to it. A test room for the admin door is a second webhook in `DISCORD_RS_TEST_WEBHOOK_URL`
  (`POST /api/admin/rs-discord/post?target=test`): a test post goes there, never to the member room, and
  never marks the session.
- Webhook: `DISCORD_RS_WEBHOOK_URL`, read per call, no fallback to any other room. Blank is the reason
  `no webhook configured`.
- Dedup: one post per session through the marker `DATA_DIR/rs_discord_post.json` (`{"last_posted":
  "YYYY-MM-DD"}`), written temp-file-then-replace only after a 2xx, the `discord_index_close` pattern.
  A session already marked is the reason `already posted for this session`. An unreadable marker reads
  as not posted, so the retry pass can post. `dedup=` accepts any object with `posted(session)` and
  `mark(session)`.
- One run at a time across every caller (a module lock); a second caller gets `a run is already in
  flight`.
- Transport: `send(url, body)` is injected; the default is one `requests.post` with a 15 s timeout. A
  2xx lands and marks the session. A 429 is the reason `rate-limited` and is never retried here. A 5xx
  is retried exactly once after `RETRY_PAUSE_S` (5 s, injectable). Any other status, or a transport
  error, is reported once and never retried: a timeout may mean Discord accepted the post, and a
  second send would double-post.
- The receipt: `{posted, reason, session, chars, leaders, spy_change_pct, attempts, marked, dry_run}`.
  `post_rs_summary` never raises. `force=True` is the owner's deliberate one-off (skips the flag, the
  marker and the floor, never the webhook or the validator); `dry_run=True` builds and validates, posts
  nothing and returns the content.

## 8. Owner review - decided 2026-11-07

The owner delegated every open choice on 2026-11-07. Each row below is the decision as recorded in
`docs/research/relative-strength/reviews/2026-11-07-delegated-decisions.md`, and where it lives in the code.

1. P1, every session or red days only: **every session**. On a session that was not a red day the
   red-day line says so with SPY's change, `SPY was not a red day (+0.4%)`, instead of `none`
   (`rs_discord_post.red_day_text`, fed by `spy_change_pct` from the reader).
2. P2, post time: **04:45 ET** with the **05:15 ET** retry, after the 04:15 ET rating job and before the
   premarket read (the two cron registrations in `api.main.register_screener_jobs`).
3. P3, list caps: **8 / 8 / 10**, then `and N more` (`LIMITS`).
4. P4, sectors: **on the rating list only**; the two new-high lists carry the ticker and rating alone.
5. P5, the Mansfield state: **not printed**. The rows carry `rs_line_above`; no Mansfield or average word
   reaches the post.
6. P6, identity: **UCT Intelligence** (`USERNAME`).
7. P7, channel: **#uncharted-scanners**, through a webhook the owner creates there, in
   `DISCORD_RS_WEBHOOK_URL`; the admin door's test room is `DISCORD_RS_TEST_WEBHOOK_URL` (section 7).
8. P8, the floor: **three distinct names** (`LIMITS["floor"]`); fewer posts nothing.
9. P9, the sign-off: **`Not a recommendation.`** (`SIGN_OFF`); the username already says who is posting.
10. P10, the honesty sentence: **approved as written** (`HONESTY_LINE`).

What still needs the owner's hands: creating the webhook in `#uncharted-scanners` and setting
`DISCORD_RS_WEBHOOK_URL` (nothing posts until it exists and the flag is on), then arming
`RS_DISCORD_POST_ENABLED` last, after `RS_V2_ENABLED`, `RS_HISTORY_ENABLED` and `RS_EVIDENCE_ENABLED` are
each verified on the pod (decision D1).

## 9. What the tests cover

`tests/test_rs_discord_post.py`: both samples above equal the rendered fixture; the decided caps,
identity, floor, sign-off, honesty sentence, sectors on the rating list only and no Mansfield word; the
red-day line on a session that was not a red day (sign, one or two decimals, no signed zero, `none` on a
red day or an unknown change, flagged names always listed); the seam's mapping form and the receipt's
`spy_change_pct`; the red-day threshold equal to the screener flag's; caps and `and N more`; `none` and
`(unrated)`; the evidence line both ways; the validator's refusals one by one; flag off, missing webhook,
empty leaders, below the floor, dedup hit, 429 (one send, no retry), 5xx (two sends, one injected sleep),
transport error, success receipt and the exact body the webhook receives; the marker on `DATA_DIR`; the
lock; dry run and force; an AST rail that the module never imports the member alert lane; the webhook
census over the new row; the ledger entry and the file's CRLF; the flag index seeing the gate; and this
file's voice. `tests/test_rs_discord_registrar.py`: the real reader's session rows, SPY's change from its
own row, SPY never among the leaders, the jobs, the retry pass, the boot line and the admin door. The real
webhook is never called by any test.
