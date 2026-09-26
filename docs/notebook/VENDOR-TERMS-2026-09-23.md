# Vendor terms and data flows — record, 2026-09-23

What member data leaves the product, where it goes, and what each data vendor's terms
require. Written while clearing the owner's to-do list; every row says whether it was
**checked** (with the evidence) or **not checked**.

## 1. Market-data vendors — licensing

| Vendor | What we use (from the code) | Terms question | Status |
|---|---|---|---|
| **FMP** (`FMP_API_KEY`) | `/stable/earnings`, earnings calendar and surprises, analyst estimates, income statement, profile, ratios, splits, grades, price targets, stock news, institutional ownership | FMP's terms of service require a **Data Display and Licensing Agreement** to show data to users of a commercial product | **APPROVED** -- the owner arranged licensing directly with FMP (confirmed 2026-09-25). ⚰️ This row said "inquiry drafted, not sent": that described the agent's Gmail draft, not the state of the licence, which the owner had already settled; the draft is obsolete |
| **Finnhub** (`FINNHUB_API_KEY`) | WebSocket real-time trades (`realtime_stream.py`); `/calendar/earnings`, `/stock/earnings`, `/stock/recommendation`, `/stock/price-target`, `/stock/upgrade-downgrade`, `/stock/metric`, `/stock/profile2`, `/stock/insider-transactions`, `/calendar/ipo`, `/stock/transcripts*` | Finnhub's FAQ says commercial use needs **written approval** | **APPROVED** -- the owner arranged licensing directly with Finnhub (confirmed 2026-09-25). The 2026-09-23 draft is obsolete |
| Massive (Polygon-compatible, `MASSIVE_API_KEY`) | bars, snapshots, OPRA options tape | redistribution / display terms | not checked |
| AlphaVantage (`ALPHAVANTAGE_API_KEY`) | news sentiment, earnings-call transcripts | commercial use on the key's tier | not checked |
| logo.dev (`LOGODEV_TOKEN`) | ticker logos | attribution requirement on the plan in use | not checked |
| TwitterAPI.io, Perplexity | catalyst research and news | no member data sent (Perplexity: see §2) | not checked |
| SEC EDGAR, FRED | filings; economic data | FRED attribution is in Terms §13; EDGAR is public (User-Agent rules) | FRED checked (Terms.test.jsx) |

Both inquiries describe display as **logged-in paying members only, no redistribution, no
data API, no resale**. They ask three things: which plan or agreement covers that, what it
costs at our size, and what attribution is required.

## 2. Where member data goes — traced in code 2026-09-23

| Provider | Member data it receives | Evidence |
|---|---|---|
| Anthropic | Ask Notebook: question + retrieved note excerpts; Compass coaching, verdicts, trade reviews: journal data | `note_ask._SYNTH_MODEL` = `claude-sonnet-5`; `journal_two/coach*.py`, `trade_review.py`, `pre_trade_verdict.py` |
| OpenAI | dictation audio (Whisper), transcript cleanup, Realtime voice, voice-history embeddings, chart vision | `voice_openai.py`, `voice_embeddings_service.py`, `voice_chart_vision.py`, `routers/voice.py` |
| Perplexity | the research **question** only (Compass deep research) | `voice_deep_research._web` → `perplexity_search.web_search(question, …)` |
| SnapTrade | broker connection (user id); returns positions, balances, activities | `journal_two/broker/*` |
| Cloudflare R2 | gzipped `auth.db` snapshots (users, all Journal 2.0 incl. notes) | `authdb_backup.py`; `AUTHDB_BACKUP_ENABLED` is `armed` on web in `docs/feature_flags.json` |
| Resend | email address + alert/digest content | `email_service.py` |

**Published terms relied on, not a signed agreement:** Anthropic and OpenAI do not train on
API data under their commercial terms. OpenAI keeps API data for up to 30 days for abuse
monitoring (OpenAI "your data" guide). Anthropic's retention is in its API data-retention docs.
**Zero-data-retention** needs a sales agreement with each company. Decision D7 still stands:
features already live keep running under the published terms, and **semantic search over
member notes stays dark until ZDR is confirmed in writing**.

⚠️ **The voice-history embeddings are already live** and already send member content to
OpenAI under the default retention (`risk_voice_embeddings_default_retention` in memory). As of
this commit the privacy policy discloses that; it does not change the flow.

## 3. Privacy policy and terms — changed in `24db02b9e`

- `Privacy.jsx` now names every provider in §2 and says what each one receives.
- **Two false claims removed.** First, *"usage data … is not tied to your identity"*:
  `page_views` stores `user_id` (`auth_db.py:164-168`) and `activity_log` stores `ip_address`
  (`auth_db.py:120-126`). Second, *"individual records purged after 90 days"*: no purge exists.
- Backup window stated as **up to 7 days**. `authdb_backup.RETAIN` is the 14 newest
  **snapshots**, taken every 6h plus nightly, which is about 3 days. ⚰️ Plan D15 said "14-day
  retention" and is corrected in the same commit as this file.
- `Terms.jsx` adds Your Content, Sharing and AI-Generated Content as subsections of §5 and §6,
  so `Terms.test.jsx`'s "no renumber, exactly 13" rail holds.
- **Legal sign-off stays with the owner** (decision D8). These pages ship with the next deploy,
  so read them first.

## 4. Found while doing this, and owner-only

1. **Anthropic API credits are exhausted.** Email "[Action needed] Your Claude API access is
   turned off" (org "Patrick's Individual Org"), 2026-09-23 07:36 CT. Production confirms it:
   138 `credit balance is too low` errors in the web pod's last 4,000 log lines. Catalyst
   synthesis failed on Opus **and** the Haiku fallback, and the catalyst curator fell back to
   its mechanical quota. Every Claude feature on that key is down until credits are added
   (console → Billing).
2. **Resend daily quota exhausted.** It hit 100% on 09-22 and 09-23, 200% on 09-22, and 80% of
   the monthly quota on 09-22. Production logs show per-ticker alert emails
   ("Earnings Today: $X", "Catalyst: $U", pattern alerts) to the owner's address, **and to
   `smoke@uctintelligence.internal`**. That address is unroutable by design, so every send
   bounces, still counts against the quota and costs domain reputation. Once the quota runs out,
   password-reset and verification emails fail too.
3. **Railway: the web volume is 81% full** (alert 09-22 23:50). Sizing it needs a production
   read that the permission system blocks for an agent.
4. Railway "Build failed" 09-23 08:23 is **resolved**: the same commit `4d31451ad2` deployed
   SUCCESS 17 minutes later, and production serves `51a61a8b8` healthy.

## 5. Owner legal sign-off -- 2026-09-25

The owner was sent ten items (L1-L10) and approved all ten as sent, verbatim:
*"LEGAL, we are OKAT on L1-L10 yes it is verified and accpeted and pproved."* Each item
resolves to the recommendation it was sent with. This section records decision D8's sign-off;
it changes no flag by itself.

| Item | What was approved | Consequence |
|---|---|---|
| L1 | The Privacy + Terms rewrite in `24db02b9e` (section 3 above) | ships with PR #186 |
| L2 | ⚰️ SUPERSEDED: FMP and Finnhub licensing is APPROVED -- the owner arranged it directly and the drafts are obsolete | no inquiry to send |
| L3 | Share links: FMP-sourced figures may show; Massive-sourced chart images (bars) are replaced by a neutral line, because Massive was not named in the licensing approval | `J2_SHARE_LINKS_ENABLED` flips after wave 8 ships that reducer |
| L4 | The "Published notes and folders" Privacy sentence, as sent | lands with wave 8's publish lane; `NOTEBOOK_PUBLISH_ENABLED` flips after |
| L5 | Analyst-consensus storage (G-062): UNBLOCKED -- the FMP approval covers it | the conditional fact type is activated in a later lane |
| L6 | The Cloudflare Privacy line for email-in, WITHOUT the draft's "only to deliver them to UCT" clause (no Cloudflare document found says it) | in `Privacy.jsx` on this branch; email-in may flip once live and the Cloudflare setup is done |
| L7 | Meaning search stays dark until OpenAI confirms zero retention in writing | decision D7 unchanged |
| L8 | Writing help and the Compass notes tool may flip after wave 7 is live; "writing help" named in the Anthropic line | in `Privacy.jsx` on this branch |
| L9 | Voice-history embeddings accepted as disclosed; one zero-retention request to OpenAI covers them and L7 | no code change |
| L10 | Benchmark results stay internal | wave 9A |

Not approved by this, and still separate: Cloudflare Email Routing adds MX records to the domain, so
the domain's existing MX records are checked before email-in is enabled.
