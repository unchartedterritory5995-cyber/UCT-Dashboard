# Trade Exchange News — first real headline test (admin-only): preparation

Status: **PREPARED, NOT EXECUTED** (2026-10-28, after D2 acceptance). Nothing in
production has been created or changed. Every step marked 🔐 needs the owner's go.
Procedure details live in `docs/runbooks/trade-exchange-news-deploy.md`; this file
is the plan, the production values, and the checklist.

## 0. Where the work is

- Branch `feat/trade-exchange-news-b` (worktree `C:/w/txnb`), base `846f9ffc30`,
  **local only — not on GitHub**. Merges cleanly onto `origin/master` (checked
  2026-10-28; master is 79 commits ahead of the base).
- Local backup: `C:/Users/blake/txn-backup/feat-trade-exchange-news-b-<head>.bundle`
  (`git bundle verify` OK).
- Commits: B `d6d0f8c05a` · C `00dbfc9c5f` `d8132c75a5` `d8ef0395cd` `8f07558f9f` ·
  D1 `2c2b990fd4` `de8b4f2ca5` `a5704780f7` `832e824a29` `7c2592d9d8` `4e9c4aab89` ·
  D2 `7cdb1ae4b6` `b77fb10900` `a902b754c9` `1dcb53ed9b` `52c3dd1d59` + this file.
- Staging (kept, ~$1/month): Railway project `uct-txn-news-staging`, R2 bucket
  `uct-trade-exchange-news-staging`. Separate from everything below.

## 1. Production configuration (to be created — nothing exists yet)

| Item | Value | Notes |
|---|---|---|
| R2 bucket | `uct-trade-exchange-news` | owner, dashboard; same lifecycle as staging: `trade-exchange-news/v1/events/` 8 d, `trade-exchange-news/v1/preflight/` 1 d |
| R2 keys | `txn-receiver`, `txn-web` | Account API tokens, Object Read & Write, **this bucket only**; owner pastes into a local file (as `r2.env` in D2) |
| Receiver service | `trade-exchange-news-receiver` in the UCT production project | GitHub repo, branch **`production`** (web deploys from `production` since 2026-09-16 — `deploy-windows.md`), root dir `services/trade_exchange_news_receiver`, watch path that directory only, **no volume**, public `*.up.railway.app` domain (never a `uctintelligence.com` hostname: Cloudflare 1010) |
| Receiver settings (stored on the service, dashboard) | Dockerfile builder, `Dockerfile`, healthcheck `/health` 60 s, overlap 20 s, draining 10 s, restart ALWAYS, 1 replica (2 = later decision) | config-as-code paths are refused by Railway now; then ONE fresh deploy and read back env config + last deployment manifest (runbook R2) |
| Receiver variables | `env.receiver.example`; `TXN_WEB_INGEST_URL=http://web.railway.internal:8080/api/trade-exchange-news/internal/ingest`; `TXN_JOURNAL_BUCKET=uct-trade-exchange-news` | `web.railway.internal:8080` is already how other production services reach web (`api/terminal_next_monitor_main.py`), so the private push path is expected to work |
| Web variables | `env.web.example`; `TXN_JOURNAL_RETENTION_HOURS=192` | set together with `--skip-deploys`, then ONE web deploy (each web deploy is the 82–119 s volume floor) |
| Secrets | `tools/txn_mint_secrets.py --out <file outside repo>` | hook secret (Trade Exchange URL only), ingest bearer; services hold digests where possible |

Switch order (all 🔐): receiver + web with `TXN_SYNTHETIC_ONLY=1` → one synthetic
smoke headline (admin widget shows it; status `push:1`) → after Trade Exchange's
written permission: `TXN_STORAGE_PERMISSION_CONFIRMED=1` on both and remove
`TXN_SYNTHETIC_ONLY` → owner registers the webhook. The synthetic smoke row stays
in admin-only history (labelled SYNTHETIC) and ages out after 7 days — no purge.
`ALERT_NEWS_MATCH_ENABLED` stays **off** for the first test.

The widget stays admin-only: it is in `UNRELEASED_CAPTURE_WIDGETS` and every News
route uses `require_admin`. Members cannot see it whatever the flags say.

## 2. What we need from Trade Exchange (in writing)

Send §5. Minimum answers per stage:

| Topic | First admin-only test | Member rollout |
|---|---|---|
| **Retention** | ⛔ written OK to store headlines up to **8 days** (7-day history + 8-day recovery copy) on UCT's cloud storage, auto-deleted after | same |
| **Redistribution** | confirm internal evaluation by UCT staff is covered | ⛔ OK to show to members in-platform (live feed + on-platform alerts); email/push separately; attribution wording/placement |
| **Webhook registration** | ⛔ can we add a **second** destination without touching the existing Discord one? Who adds it (us in their dashboard / their support)? Custom header, or secret in URL path? | narrow `TXN_AUTH_MODES` to the method used |
| **Retries** | nice to know (the test measures losses we can see) | ⛔ do they retry on 5xx/timeout, how often, for how long; their timeout; any message id |

## 3. Blockers vs later

**Blockers for the first admin-only test**
1. Trade Exchange: written 8-day retention OK (the code will not store real content without `TXN_STORAGE_PERMISSION_CONFIRMED`).
2. Trade Exchange: confirmation a second webhook destination can be added without affecting Discord, and how.
3. 🔐 Push branch + draft PR so CI runs the full regression (deferred from D1), then merge to `master` → `production` promotion (code ships dark). Merge-time note: `tools/flow_worker_watch_coverage.py` reports three changed files flow-worker runs but does not watch (`auth_surface_check.py`, `alert_taxonomy/news_match.py`, `alerts.py`); with `ALERT_NEWS_MATCH_ENABLED` off they ship inert there — record it in the `api/flow_worker_main.py` header as earlier deploys did, no flow-worker restart.
4. 🔐 Production R2 bucket + keys (owner, dashboard), receiver service, variables, preflight READY on both, synthetic smoke `push:1`.

**Can wait until member rollout**
- Redistribution/attribution terms and the attribution UI.
- Retry policy answers; with them, decide 2 receiver replicas.
- Alerting on backlog / coverage gaps / receiver refusals (signals exist in `/api/admin/trade-exchange-news` and logs; nothing pages yet).
- Real delivery-latency method (Trade Exchange's send time is not in the payload).
- Ticker extraction tuning on real samples (`TICKERS_PROVISIONAL`).
- Late-recovered headlines append out of send order (seen in D2); UI treatment.
- The two unexplained status-call failures in D2 run 1 (not reproduced).
- Observe the staging lifecycle canary expire (checks the rule, no action).
- `ALERT_NEWS_MATCH_ENABLED` (news alerts), narrowing `TXN_AUTH_MODES`.
- Railway CLI logout policy on the owner PC.

## 4. Checklist

| # | Who | Step |
|---|---|---|
| 1 | **Owner** | Send §5 to Trade Exchange; forward the written answers |
| 2 | **Owner** 🔐 | Approve: push `feat/trade-exchange-news-b` + draft PR (CI full regression) |
| 3 | Claude | Push, open draft PR, fix anything CI finds, report |
| 4 | **Owner** | Cloudflare dashboard: bucket `uct-trade-exchange-news`, two lifecycle rules (screenshot), keys `txn-receiver` / `txn-web` into a local file |
| 5 | Claude | Scope-test both keys (News bucket only), mint secrets to a local file |
| 6 | **Owner** 🔐 | Approve merge to `master` (dark) in a Tier-1 window |
| 7 | Claude | Merge, watch the gate and promotion, confirm News routes 404 on production |
| 8 | **Owner** 🔐 | Approve creating the receiver service + setting production variables (synthetic-only) |
| 9 | Claude | Create service, store settings, fresh deploy, read back, set vars, one web deploy, preflight ×2, synthetic smoke, report |
| 10 | **Owner** 🔐 | With Trade Exchange's written permission: approve the real-content switch |
| 11 | Claude | Set `TXN_STORAGE_PERMISSION_CONFIRMED=1`, remove `TXN_SYNTHETIC_ONLY`, preflight |
| 12 | **Owner** | Register the webhook in Trade Exchange (URL from the local secrets file, never in chat) |
| 13 | Claude | Watch one session: refusals, backlog, gaps, push-vs-reconcile, counts only; report |
| 14 | **Owner** | Review in the admin News widget; decide on member-rollout items |

Rollback at any point: runbook §9 (remove the destination in Trade Exchange; unset
`TXN_RECEIVER_ENABLED` / `TXN_ENABLED`; nothing deleted).

## 5. Message to Trade Exchange (ready to send)

> Hi — we'd like to receive your breaking-news webhook in our platform, starting
> with an internal staff-only test. Could you confirm in writing:
>
> 1. **Retention:** may we store headlines for up to 8 days (a 7-day history plus an
>    8-day recovery copy on our cloud storage), automatically deleted after that?
> 2. **Internal test:** is viewing the feed by our own staff during evaluation covered?
> 3. **Members (later):** may we show headlines to our paying members inside our
>    platform (a live feed and on-platform alerts)? Any attribution wording or display
>    rules? Separately, email or push notifications?
> 4. **Destinations:** can we add a second webhook destination **in addition to** our
>    existing Discord webhook, without changing it? Do we add it in your dashboard, or
>    do you?
> 5. **Authentication:** can a destination send a custom header (e.g.
>    `Authorization: Bearer …`)? If not, we will use a long secret in the URL path.
> 6. **Retries:** do you retry failed deliveries (5xx, 429, timeouts)? How many times,
>    over what period? What is your request timeout, and does any 2xx count as success?
> 7. Is there a message id we can use to recognise a retried delivery?
>
> The full technical list is attached if useful. Thank you!

(Attach `docs/trade-exchange-news/provider-questions.md` if they want detail.)
