# trade-exchange-news-receiver

The single door Trade Exchange's news webhook posts to. **Checkpoint B: built and
tested locally; NOT provisioned, NOT deployed, NOT registered with Trade Exchange.**

```
Trade Exchange ──POST /hook/<secret>──▶ receiver (this service, no volume)
                                          │  1. verify secret (hash, constant-time)
                                          │  2. rate · size · strict parse
                                          ├─ 3. push to web (private net, does not wait)
                                          └─ 4. PUT to R2 journal ── 5. 2xx only after 4
web: /api/trade-exchange-news/internal/ingest ─▶ single writer ─▶ SQLite (seq) ─▶ hub ─▶ subscribers
web: reconciler ── LIST/GET R2 journal after its cursor ─▶ same single writer (boot + every 30 s)
```

## Why this shape
* **No volume on the receiver.** A Railway volume forbids overlapping deploys (web's
  82–119 s dead window). Stateless ⇒ Railway overlaps receiver deploys ⇒ no gap.
* **R2 journal = durable acceptance.** The 2xx is sent only after R2 acknowledges
  the PUT. R2 is already UCT's object store (flow + Notebook backups).
* **Web can be down.** Pushes fail, the receiver keeps acking, and on boot web's
  reconciler ingests everything after its cursor *before* live pushes are let in,
  so receipt order is preserved.

## Environment

| Service | Variable | Meaning |
|---|---|---|
| receiver | `TXN_RECEIVER_ENABLED=1` | arms the hook (else 404 for everything) |
| receiver | `TXN_WEBHOOK_TOKEN_SHA256` | digest(s) of the URL secret, comma-separated during rotation |
| receiver | `TXN_INGEST_TOKEN` | bearer sent to web |
| receiver | `TXN_WEB_INGEST_URL` | default `http://web.railway.internal:8080/api/trade-exchange-news/internal/ingest` |
| receiver | `TXN_JOURNAL=s3` + `TXN_JOURNAL_ENDPOINT_URL`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_BUCKET` | R2, **read+write token scoped to this bucket only** |
| receiver | `TXN_SOURCE_ALLOWLIST` | default `TXNews1` (not authentication) |
| receiver | `TXN_ACK_STATUS` | 200 (default) / 202 / 204 — whatever Trade Exchange treats as success |
| receiver | optional `TXN_SENTRY_DSN`, `TXN_RATE_BURST` (60), `TXN_RATE_PER_SEC` (2), `TXN_MAX_BODY_BYTES` (16384), `TXN_MAX_CONTENT_CHARS` (8000), `TXN_JOURNAL_TIMEOUT_S` (4) | |
| web | `TXN_ENABLED=1` | arms the ingest route + pipeline (dark otherwise) |
| web | `TXN_INGEST_TOKEN_SHA256` | digest(s) of the receiver bearer |
| web | `TXN_JOURNAL=s3` + same `TXN_JOURNAL_*` | **read-only (list+get) token** for recovery |
| web | optional `TXN_DEDUPE_WINDOW_S` (60, 0 = off), `TXN_HISTORY_MAX_AGE_HOURS` (168), `TXN_HISTORY_MAX_ITEMS` (5000), `TXN_RECONCILE_INTERVAL_S` (30), `TXN_RECONCILE_OVERLAP_S` (600), `TXN_BOOT_READY_WAIT_S` (5) | |

Secrets: `python tools/txn_mint_secrets.py --out <file outside the repo>` writes both
secrets to that file and prints only the digests. Nothing secret is ever typed into
chat, committed, or logged.

## Provisioning (needs owner approval — not done)
1. R2 bucket `uct-trade-exchange-news` (or a prefix in an existing bucket), lifecycle
   rule: expire `trade-exchange-news/v1/events/` objects after 8 days (≥ web's 7-day history).
2. Two R2 API tokens: receiver = Object Read & Write on that bucket; web = Object Read only.
3. Railway service `trade-exchange-news-receiver`: root `services/trade_exchange_news_receiver`,
   Dockerfile builder (this `railway.json`), **no volume**, healthcheck `/health`,
   public Railway domain (`*.up.railway.app`) — ⚠️ do NOT put it behind Cloudflare's
   proxy: Cloudflare 1010-blocks non-browser user agents on `uctintelligence.com`.
4. Set the variables above; confirm `/health` = 200 and a synthetic POST round-trips
   with `TXN_ENABLED=1` on a non-production environment first.
5. Only then: owner pastes `https://<receiver-domain>/hook/<webhook_token>` into the
   Trade Exchange dashboard as an ADDITIONAL destination (the Discord one is untouched).

## Rotation
Mint a new pair → set `old,new` digests on both services → owner updates the Trade
Exchange URL → remove the old digests. Old URL is dead (404) the moment its digest goes.

## Residual exposures (known, accepted until changed)
* The URL is the credential: anyone holding it can post. Mitigated by 256-bit secret,
  allowlist, rate limit, and rotation; header- or signature-based auth needs Trade
  Exchange support (open question).
* Railway's edge "HTTP Logs" record request paths for anyone with project access.
* A receiver *deploy* is gapless; a receiver *crash* between deploys is restarted by
  Railway (`restartPolicyType: ALWAYS`) — deliveries during that seconds-long window
  depend on Trade Exchange retrying (open question).
