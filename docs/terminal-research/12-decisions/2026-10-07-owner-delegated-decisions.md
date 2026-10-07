# 2026-10-07 — Every remaining terminal decision, decided under the owner's delegation

**Authority.** The owner delegated every remaining terminal decision on 2026-10-07: *"decide it
all; make it complete, live-ready, world class."* Lane `tf9-decide`, branch
`terminal/fn9-decide` (from `origin/master` `7409b339e`).

**How each one was decided.** I picked what an honest, world-class trading terminal would choose. I
leaned conservative on member safety and cost, and I preferred answers that need no purchase. Where
the consequence is code and small, it is built here with a test. Where it needs a Railway variable,
a purchase, a credential or a device, the exact owner action is written in §8. Areas other lanes
are building today (`tf9-grad` nav/rollout, `tf9-theme` earnings modal / islands / FA-EE currency,
`tf9-s2` alert channels / queue / receipts / transcript search / member API whitelist) were
decided where a decision was open, but their code was not touched.

**Sources swept:** `10-roadmap/backlog.md` (band 0 + register rows marked HELD / ⛔ ACT /
owner), `12-decisions/**`, `05-product-strategy/feature-gaps-2026-10-06.md`,
`00-program-control/terminal-completeness-2026-10-07.md`, `15-accuracy/accuracy-audit-2026-10-06.md`,
`14-visual/a11y-audit-2026-10-06.md`, `14-visual/theme-leftovers.md`, `COMPLETION-LEDGER.md` §2
and §8, `00-program-control/OWNER_DECISIONS.md` (Pending), `docs/feature_flags.json` (pending /
dark terminal flags, read only).

Columns: **item** · **decision** · **reason** · **implemented** (here, or "record only") · **owner
action** (§8 number, or "—").

## 1. Already decided by the integrator today (recorded, not re-decided)

| # | item | decision | reason | implemented | owner action |
|---|---|---|---|---|---|
| I-1 | `RAW_PRICE_VIEW_ENABLED` (TERM-055 M half) | **Arm** on web | integrator | record only | §8 A1 |
| I-2 | `RSS_SERIES_ENABLED` (TERM-014) | **Arm** on web + terminal-next-monitor | integrator | record only | §8 A2 |
| I-3 | `BARS_RAIL_PAGE_ENABLED` (TERM-013) | **Arm** on web | integrator | record only | §8 A3 |
| I-4 | `WHAT_ELSE_OPEN_CAPTURE_ENABLED` (TERM-093) | **Stay off** | integrator | record only | — |
| I-5 | Earnings Research modal theme island | **Follows the theme** | integrator | another lane (tf9-theme) | — |
| I-6 | `--menu-*` menus | **Stay dark on every theme** (the 2026-07-30 ruling stands) | integrator | record only | — |
| I-7 | FA / EE unknown currency | **No symbol + "Currency not reported"** | integrator | another lane (tf9-theme) | — |
| I-8 | ANR price targets / OWN holder values | **Stay `$` (USD)** | integrator | record only | — |
| I-9 | TERM-002 second OPRA connection | **DONE — purchased 2026-10-04.** A flow-worker deploy no longer waits out the old session's max-connections hold, so the tape gap per flow-worker deploy shrinks to the boot gap. No code change (that file belongs to the partner) | integrator | record only | — |
| I-10 | TERM-005 / BRK-02 second whole-market screener universe | **No** | integrator | record only | — |
| I-11 | Terminal nav graduation | **Graduates to `/terminal`; every existing member enrolled** | integrator | another lane (tf9-grad) | — |
| I-12 | `lane/s2-finish` (TERM-047, remeasure D5) | **Finished by another lane** | integrator | another lane | — |

## 2. Terminal backlog decisions (TERM rows)

| # | item | decision | reason | implemented | owner action |
|---|---|---|---|---|---|
| T-1 | TERM-001 board-size bound | **Re-affirmed: `MAX_BOARD_WIDGETS = 16`** (decided 2026-10-02) | Largest board ever measured for cost. ADR-0047 keeps an absolute capacity number out of scope | already built (`12-decisions/2026-10-02-term-001-006-…`) | — |
| T-2 | TERM-003 Confluence Radar extend-or-delete | **Keep it; no delete, no extension** (MOOT since 2026-09-29) | It is a live 8th Options Flow tab that members use. Deleting it removes a working surface, and extending it duplicates one | record only | — |
| T-3 | TERM-006 max displayed age | **Re-affirmed**: twice the class cadence, never under 60 s, never over one trading session | Already built and railed. Nothing new argues against it | already built | — |
| T-4 | TERM-007 quiet measurement window | **Declared:** Wed 2026-10-14, 09:00–11:00 ET (120 min, over the open), no deploys of any service. After that it is a **standing weekly window: every Wednesday 09:00–11:00 ET, no web or flow-worker deploys** | The bar is ≥104 min on one pod across the open plus a heavy job. Both earlier windows started after the open. Wednesday avoids Monday's catch-up jobs and the 2026-10-13 bond-market holiday. A standing window ends the "a scheduling decision nobody has made" state for good | record only (a convention, no code) | §8 B1 |
| T-5 | TERM-008 Cloudflare rule + cache key | **Read it, then set the zone's Browser Cache TTL to "Respect Existing Headers"** | An honest terminal serves what its origin says. The zone-wide 4-hour override is a standing hazard for any route that wants a shorter browser lifetime | record only | §8 B2 |
| T-6 | TERM-009 member call record | **Re-affirmed: opt-in per member, off by default, never "wins"** | Member safety. A published losing call cannot be taken back by a deploy | already built | — |
| T-7 | TERM-010 first-run board | **Re-affirmed: the UCT Default layout** | Already built | already built | — |
| T-8 | TERM-011 ops channel | **Yes. Create `#uct-ops` (admins only) and split ops events off the business channel** | Ops pages were drowning business events. The code is already built and does nothing until the variables are set | record only | §8 B3 |
| T-9 | TERM-017 loop-lag distribution reading | **Read from the T-4 window's histogram.** No other window is needed | The sampler is built. Only the window was missing | record only | (inside §8 B1) |
| T-10 | TERM-018 guard rail as a promotion gate | **Stays `promotion-gate: no` until 10 consecutive green CI runs on master. Then it flips to `yes`** | It has never run on a runner. Gating before that would block a ROLLBACK whose revert deletes a guarded site | record only. The flip is a one-line workflow edit for whoever reads the 10th green run | — |
| T-11 | TERM-025 / FT-034 per-type CP4/FLIP for the 7 shadow trigger types | **No per-type owner ruling. Each type flips when its own shadow log meets ADR-0036's clause (`new_only == 0`, every excluded predicate dispositioned) over ≥10 consecutive trading sessions** | A measured bar beats a ruling per type. Ten sessions matches the TERM-042 bar below (one rule, not two) | record only (alert code is tf9-s2's area) | §8 A8 (per type, when its reading passes) |
| T-12 | TERM-042 EOD breadth source switch | **Switch to `server` after 10 consecutive clean shadow sessions.** A failed, low-coverage or not-comparable session breaks the run and is never skipped | Two trading weeks of clean grades on the real tape. The parity report used to say "how many is the owner's call", and that call is now made | **built:** `breadth_eod_source.SWITCH_CLEAN_SESSIONS = 10`, `switch_readiness()`, `parity_report()["switch"]` (a reading, never an act), 3 rails in `tests/test_breadth_eod_source.py`. Commit `6d2e692bd` | §8 A7 |
| T-13 | TERM-043 figure-to-source link from the SEC PIT store | **Yes, link only.** A statement figure may carry the SEC accession link when the PIT fact matches the shown figure within rounding. The displayed number stays the current source's | Source links are what an honest terminal shows. Swapping in a second number source would be a second authority over one value | record only (follow-up build, M) | — |
| T-14 | TERM-045 13F holders join | **Use the SEC's free Official List of Section 13(f) Securities (it carries CUSIPs). Do not buy the CUSIP master file** | No purchase. The SEC list is exactly the 13F population | record only (follow-up build) | — |
| T-15 | TERM-049 / TERM-051 / TERM-088 | **Already armed. Nothing open** | ledger shows `armed` | — | — |
| T-16 | TERM-061 / BRK-06 / FT-040 skill file + MCP | **Publish `skill.md` + the endpoint whitelist only after `RATE_LIMIT_POLICY=enforce`. No MCP server this programme** | Never hand out a programmatic doorway before per-route limits enforce. MCP adds an always-on surface for a ~26-account product | record only (whitelist code is tf9-s2's) | follows §8 A4 |
| T-17 | TERM-078 AI population cap | **`shadow` now. `enforce` after 5 trading days if no legitimate member request would have been capped, at the default 5,000/day** | Bounds AI spend with no member-visible change until it is proven safe | record only | §8 A5 |
| T-18 | TERM-080 per-route rate limits | **`shadow` now. `enforce` after 5 trading days with zero would-limit of a signed-in member's ordinary use** | Same reasoning as T-17, and T-16 depends on it | record only | §8 A4 |
| T-19 | TERM-081 second toolkit (OI-03 / OI-12) | **MOOT. There is one paid tier (ADR-0009, D-010). The toolkit column stays as-is and no second toolkit is built** | A second toolkit would sell a tier the owner ruled out. The column is harmless, so it is not deleted | record only | — |
| T-20 | TERM-004b engine adapter / bot deletion candidate | **Re-affirmed** (2026-10-02): `/api/calendar` canonical | Already decided | — | — |

## 3. Programme decisions still marked open (COMPLETION-LEDGER §2, OWNER_DECISIONS Pending)

| # | item | decision | reason | implemented | owner action |
|---|---|---|---|---|---|
| P-1 | OD-D-001 desk-first vs member-first | **Closed: (b) members first** | D-007 (phone parity), D-010 (everything paywalled) and today's "enrol every member" all describe a member product. The "desk first" default was overtaken | record only | — |
| P-2 | OD-D-003 decisiveness posture | **(a) One decisive shape for everyone, always with its receipt** (basis, sources, hard flags) | One paid tier, so there is no stranger tier for a softer shape. This is the shipped `grade_ticker` behaviour and costs nothing. The receipt is what keeps a decisive call honest | record only | — |
| P-3 | OD-SEAT seat model | **One person per subscription. No shared logins.** Not enforced in code now | ADR-0014 de-scoped usage metering. A stated rule is enough until two people share a login | record only | §8 C3 (one sentence in the Terms) |
| P-4 | OD-OI04 are Bullflow / UW / Polygon-direct / TheFly still paid | **The default stands: no observed calls in 30 days ⇒ retired** | It is a billing fact, not a judgement | record only | §8 C1 |
| P-5 | OD-NEWS curated vs browsable | **Curated first, browsable one click away**, with "why isn't X here" receipts | A ranked feed with an always-available full view is the honest middle. It is also how CN and the catalyst table already work | record only | — |
| P-6 | OD-U16 desktop wrapper / plugins / scripting / marketplace | **Out of scope this programme** | The phone + browser shell covers it (D-007). Each of these is a separate product with its own support load | record only | — |
| P-7 | OD-CORP CARD 5 corp-actions ledger exclusion | **Keep the exclusion.** The re-open trigger (a consumer PRD) stands | A table with no reader is a second authority waiting to drift. Dividends already route through Massive reference (TERM-036) | record only | — |
| P-8 | OD-FIGI OpenFIGI fallback | **Declined** | No new external source while the entity master resolves from sources already held (ADR-0015, one read per new source) | record only | — |
| P-9 | X-12 `/calendar` retire vs coexist | **Coexist permanently as a URL.** `/calendar` keeps working (bookmarks, ICS links, deep links) and renders the same CAL section. No retirement countdown | Graduation (I-11) moves the nav, not the address. Breaking members' saved links buys nothing | record only | — |
| P-10 | X-13 MG-8 re-census at countdown | **MOOT** (no countdown, per P-9) | follows P-9 | record only | — |
| P-11 | X-14 RM-N05 trial (Ravi) | **Keep the pre-registered trial as written** | An outside subject is the only honest verdict on the MVP. It cannot be simulated | record only | §8 C2 |

## 4. Purchases, keys and new sources

| # | item | decision | reason | owner action |
|---|---|---|---|---|
| S-1 | COV-08 / FT-077 Level II / depth-of-book feed | **No** | Swing trading does not need L2. High recurring cost | — |
| S-2 | COV-07 / FT-071 FMP upgrade for named-analyst EPS | **No for now.** Consensus drift accrues from our own snapshots (`ESTIMATE_HISTORY_ENABLED`, armed) | No purchase. Revisit when drift history has a quarter of depth | — |
| S-3 | FT-037 SMS + 10DLC | **No** | Email, in-app and web push (D-012) cover delivery | — |
| S-4 | FT-038 Telegram bot | **No** | One more channel to support for no member ask. Discord + push cover it | — |
| S-5 | FT-068 api.data.gov key for FEC | **No** | Political-donation data does not change a swing trader's decision | — |
| S-6 | COV-12 / FT-067 congressional trackers | **No, and no scraping fallback** | Legal ambiguity on the eFD/House restriction, low trading value | — |
| S-7 | D-13 PDUFA date source | **No purchase.** Biotech catalysts stay on the existing catalyst feed | No paid source exists that we would trust enough to state a date | — |
| S-8 | D-3 Russell / Nasdaq-100 rebalance dates | **S&P 500 rule-derived only (as built). Others are shown as "not tracked"** | No dated source exists. A guessed date is worse than a stated absence | — |
| S-9 | D-5 call replay beyond AAPL/MSFT | **Use the earningscall.biz key if it is already held. Buy nothing** | No purchase | §8 C4 |
| S-10 | D-6 story retraction feed | **No** | No vendor sends one. The payload already says retraction is not tracked | — |
| S-11 | COV-03 / FT-074 tape for the unusual-volume ranking | **Yes, set the variable** (no purchase) | The code is built and only the tape URL is missing | §8 A6 |

## 5. Shadow / enforce / arming choices on terminal flags (D-009 standing go)

| # | flag | decision | reason | owner action |
|---|---|---|---|---|
| F-1 | `IV_HISTORY_ENABLED`, `OPTIONS_IV_RANK_ENABLED`, `OPTIONS_DAILY_MOVE_ENABLED`, `OPTIONS_IV_CRUSH_ENABLED` | **Arm on web** | Each reads only our own options log and says "N sessions logged, needs 20" instead of guessing. The terminal's IVH / VOL / OHIS panels are blank without them | §8 A9 |
| F-2 | `OPTIONS_MORE_STRATEGY_SCREENS_ENABLED`, `OPTIONS_SIZZLE_ENABLED` | **Arm on web** | Same reasoning (STRS panel). Sizzle states its n until it has 5 sessions | §8 A9 |
| F-3 | `RESEARCH_FMP_DEPTH_ENABLED` | **Arm on web** | /research shows the same FMP depth the terminal's FA/EE panels already show. One cached reader, so no new vendor load | §8 A9 |
| F-4 | `HOW_TO_CHECKLISTS_ENABLED` (FT-046) | **Arm, and keep the copy gate.** Drafts render nothing until approved | Arming is harmless. The copy has to be in the owner's voice, so approving it is the one thing not delegated | §8 C5 |
| F-5 | FT-078 / FT-079 pattern-overlay toggle | **Stay off** | The 9/7 Pattern-Lab pause stands. That family was the cost spike (Pattern Vision). The chart code is another lane's | — |

## 6. Visual and accessibility

| # | item | decision | reason | implemented |
|---|---|---|---|---|
| V-1 | a11y §6.1 app-wide loss/gain text contrast | **(b): sweep text onto `--danger-ink` / `--success-ink` lane by lane**, with the terminal's contrast audit as the rail. Do not lighten `--loss` itself | (a) would also lighten every chart candle and red fill | record only. The terminal half is done (`terminalContrast`, `terminalReachableContrast`) |
| V-2 | a11y §6.2 mounted-panel table names | **Fix at source** (no runtime patch) | **Already executed:** `terminalA11yStatic.test.js` §5 ("mounted surfaces") requires every table the terminal reaches to be named, with only two chart-owned exemptions | record only |
| V-3 | a11y §6.3 10px chart labels | **Raise the chart text floor to 11px** | Legibility. The chart code is another lane's (`components/chart/**`) | handed to the chart lane |
| V-4 | a11y §6.4 screen-reader + device pass | **Do it before the nav graduation is announced** | Nothing local can stand in for it | §8 C6 |
| V-5 | theme-leftovers: Breadth treemap tiles | **Follow the theme. Already executed:** `pages/breadth/heatTiles.contrast.test.js` rails theme ink at WCAG AA on all 21 themes and keeps the heat meaning | the doc entry was stale | record only |
| V-6 | RRG / REL / CORR without a flag (feature-gaps §3) | **No flag** | Read-only arithmetic over bars every paid member already loads | record only |

## 7. Checked and found already closed (no decision was open)

- **accuracy-audit-2026-10-06** "design choices flagged for an owner": all six were resolved on
  2026-10-06 (`terminal/fn5-acc2`). Nothing open.
- **feature-gaps #5** implied-move calibration: deferred by its own doc to ~2027-Q1, when the options
  log holds four earnings per name. Re-affirmed. ERX is the home.
- **12-decisions/gates** items still marked "awaiting" (a12 watchlists CP1, packet-ad `/explain`,
  packet-z delisted-prune cron) are outside the terminal and were left untouched.

## 8. Owner actions — exact commands and text

⚠️ For every `--set`, verify a **new boot** afterwards and read the value in the running process.
`--kv` is not evidence (CLAUDE.md "measured BOTH ways"). Then record the flip in
`docs/feature_flags.json` (status `armed`, service, timestamp).

**A. Railway variables**

- **A1** `railway variables --service web --set "RAW_PRICE_VIEW_ENABLED=1"`
- **A2** `railway variables --service web --set "RSS_SERIES_ENABLED=1"` and
  `railway variables --service terminal-next-monitor --set "RSS_SERIES_ENABLED=1"`
- **A3** `railway variables --service web --set "BARS_RAIL_PAGE_ENABLED=1"`
- **A4** `railway variables --service web --set "RATE_LIMIT_POLICY=shadow"`. After 5 trading days,
  if the shadow log shows no would-limit on a signed-in member's ordinary use:
  `railway variables --service web --set "RATE_LIMIT_POLICY=enforce"`
- **A5** `railway variables --service web --set "AI_POPULATION_CAP_MODE=shadow"`. After 5 trading
  days with no `[ai-population-cap] would-cap` line for a legitimate member:
  `railway variables --service web --set "AI_POPULATION_CAP_MODE=enforce"`
- **A6** Copy web's `WORKER_INTERNAL_URL` value, then
  `railway variables --service terminal-next-monitor --set "OPTIONS_SCREENER_TAPE_URL=<that value>"`
- **A7** When `GET /api/admin/breadth-eod-source` → `parity.switch.ready` is `true`:
  `railway variables --service web --set "BREADTH_EOD_SERVER_FROM=<the next session, YYYY-MM-DD>"`
  then `railway variables --service web --set "BREADTH_EOD_SOURCE=server"`
- **A8** Per shadow trigger type, when its own shadow reading meets T-11: set that type's flip
  variable on web. One type at a time.
- **A9** On web, one `--set` each: `IV_HISTORY_ENABLED=1`, `OPTIONS_IV_RANK_ENABLED=1`,
  `OPTIONS_DAILY_MOVE_ENABLED=1`, `OPTIONS_IV_CRUSH_ENABLED=1`,
  `OPTIONS_MORE_STRATEGY_SCREENS_ENABLED=1`, `OPTIONS_SIZZLE_ENABLED=1`,
  `RESEARCH_FMP_DEPTH_ENABLED=1`, `HOW_TO_CHECKLISTS_ENABLED=1`

**B. Windows, channels, dashboards**

- **B1** Post in `#deploys`: *"Measurement window: Wednesday 2026-10-14, 09:00–11:00 ET. No
  deploys to any service, please. From then on, every Wednesday 09:00–11:00 ET is a standing no-deploy
  window for web and flow-worker."* After the window, an agent reads `/api/watchdog/status`
  `lag_histogram` (TERM-017) and the RSS slope (TERM-014).
- **B2** Cloudflare dashboard → uctintelligence.com → Caching → Cache Rules: screenshot the rule
  matching `/api/flow/*` and its cache key (TERM-008). Then Caching → Configuration → Browser
  Cache TTL → **Respect Existing Headers**.
- **B3** In Discord, create `#uct-ops` (admins only) → Integrations → Webhooks → New → copy the URL. Then
  `railway variables --service web --set "DISCORD_OPS_WEBHOOK_URL=<url>"` and
  `railway variables --service web --set "OPS_ALERT_EMAIL_TO=<your own address>"`. Repeat both
  on flow-worker **after hours** (a flow-worker restart drops the tape).

**C. One-time reads or sentences**

- **C1** Check the last card statement for Bullflow, Unusual Whales, Polygon-direct and TheFly.
  Cancel any still billing. Reply with one sentence.
- **C2** Ask Ravi to start Phase A (5 trading days or 10 occasions), as pre-registered in
  `10-roadmap/2026-09-30-mvp-preregistration-ravi.md`.
- **C3** Add to the Terms: *"A subscription is for one person. Sharing a login is not permitted."*
- **C4** Say whether an `EARNINGS_AUDIO_API_KEY` for earningscall.biz is held. If yes, set it on web.
  If no, nothing.
- **C5** Read the 8 drafts in `app/src/components/howTo/howToChecklists.js`. Approve or rewrite each
  one (`status: 'approved'`, `approved_by`, `approved_on`).
- **C6** One NVDA pass on Windows and one VoiceOver pass on an iPhone, at 390 px and 820 px, over
  CAL, DES, GP and the command line. Use BrowserStack Live with the smoke-login link.

## 9. Reversal

Every decision above is a default, and the owner can overturn any of them with one sentence. The one
code change (T-12) is a reading: reverting commit `6d2e692bd` removes the `switch` key and nothing
else.
