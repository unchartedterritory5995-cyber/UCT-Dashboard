# Trade Exchange News — deployment & rollback runbook

Status: **PREPARED, NOT EXECUTED** (Checkpoint D1, 2026-10-27). Every step below
needs the owner's explicit go at the stage it belongs to (D2 staging-synthetic,
then D3 production). Nothing here has been provisioned.

⛔ Never paste a secret into chat, a commit, a command line or a ticket. Secrets
are minted by `tools/txn_mint_secrets.py` into a file **outside the repo** and
pasted from that file into the Cloudflare / Railway dashboards by the owner.

---

## 0. What gets created

| Item | Name (proposed) | Notes |
|---|---|---|
| R2 bucket | `uct-trade-exchange-news` | journal only; lifecycle 8 days |
| R2 token A | `txn-receiver` | Object Read & Write, **this bucket only** |
| R2 token B | `txn-web` | Object Read & Write, **this bucket only** (recovery + repair pass) |
| Railway service | `trade-exchange-news-receiver` | Dockerfile, **no volume**, public Railway domain |
| Secrets (2) | hook secret, ingest bearer | `tools/txn_mint_secrets.py`; services hold digests where possible |
| Web variables | `TXN_*` (see `services/trade_exchange_news_receiver/env.web.example`) | dark until W3 |

Cost: R2 ≈ one Class A LIST per 30 s per web (~86k/month) + one PUT per headline +
storage of 8 days of small JSON objects — cents/month. Receiver: one small container.

## 1. Secrets (owner, local machine)

```sh
python tools/txn_mint_secrets.py --out "%USERPROFILE%\txn-secrets.json"
```
Prints only two digests:
- `receiver: TXN_WEBHOOK_TOKEN_SHA256=<64 hex>` → receiver service
- `web:      TXN_INGEST_TOKEN_SHA256=<64 hex>` → web service

The file holds `webhook_token` (the URL secret — the Trade Exchange dashboard
only) and `ingest_token` (→ receiver `TXN_INGEST_TOKEN`). Delete the file once
both are stored.

## 2. R2 (owner, Cloudflare dashboard)

1. **R2 → Create bucket** `uct-trade-exchange-news` (default location, Standard class).
2. **Lifecycle**: bucket → Settings → Object lifecycle rules → add
   - prefix `trade-exchange-news/v1/events/` → delete after **8 days**
   - prefix `trade-exchange-news/v1/preflight/` → delete after **1 day**

   (Equivalent machine-readable form: `services/trade_exchange_news_receiver/r2-lifecycle.json`,
   applicable with the S3 API `PutBucketLifecycleConfiguration`.)
   ⛔ 8 days ≥ web's 7-day history + 1: shorter breaks the recovery floor
   (`TXN_JOURNAL_RETENTION_HOURS=192` must match).
3. **R2 → Manage API tokens → Create** twice: `txn-receiver`, `txn-web`; permission
   **Object Read & Write**; **Specify bucket(s): `uct-trade-exchange-news` only**; no TTL
   (rotate manually, §8). Record Access Key ID + Secret + the S3 endpoint
   `https://<account-id>.r2.cloudflarestorage.com` straight into the Railway variables.

## 3. Receiver service (Railway dashboard) — R1–R6

R1. **New → GitHub repo** → this repo → service name `trade-exchange-news-receiver`.
R2. **Settings → Source**: Root Directory `services/trade_exchange_news_receiver`;
    Config-as-code file `services/trade_exchange_news_receiver/railway.json`
    (Dockerfile builder, healthcheck `/health` 60 s, `overlapSeconds` 20,
    `drainingSeconds` 10, restart ALWAYS). Confirm the deploy watch path only
    matches this directory (other merges must NOT redeploy it).
    ⛔ **Do not attach a volume.** A volume disables overlapping deploys.
    ⛔ **VERIFY THE SETTINGS ARE STORED ON THE SERVICE, AND ON THE LAST DEPLOYMENT**
    (D2 findings, staging 2026-10-28):
    - A `railway.json` that arrives only inside an upload (`railway up`) is applied
      to THAT deployment and not saved to the service. Railway now also refuses to
      set a config-as-code path ("Config as Code (railway.json / railway.toml) is
      deprecated. Use Infrastructure as Code (.railway/railway.ts)"), so the
      settings must be stored on the service (dashboard, or the environment config).
    - `railway redeploy` / a restart reuses the build recipe RECORDED ON THE
      PREVIOUS DEPLOYMENT, not the service's current settings. A deployment made
      before the settings were stored keeps the old builder for every redeploy
      (staging web: Railpack, "No start command", twice). Old one kept serving.
      Fix: one fresh deploy after storing the settings; every plain redeploy
      since built with the Dockerfile (8 of 8).
    Read back BOTH before relying on a redeploy:
    `environment(id) { config }` -> `services.<id>.build.builder = DOCKERFILE`,
    `deploy` healthcheck `/health` 60, `overlapSeconds` 20, `drainingSeconds` 10,
    `restartPolicyType` ALWAYS; and `deployments(first:1) { meta }` ->
    `serviceManifest.build.builder = DOCKERFILE`. (`serviceInstance.builder` reads
    RAILPACK regardless; it is not the setting that is used.)
R3. **Variables** (names: `env.receiver.example`) with `TXN_RECEIVER_ENABLED`
    and `TXN_STORAGE_PERMISSION_CONFIRMED` **unset** first.
    ⚠️ `railway variables --set` auto-redeploys; prefer the dashboard raw editor.
R4. **Networking**: Generate Domain (`*.up.railway.app`). ⛔ Do **not** put a
    `uctintelligence.com` hostname in front of it through Cloudflare's proxy —
    Cloudflare 1010-blocks non-browser senders on that zone (CLAUDE.md). Private
    networking stays on (receiver → `web.railway.internal`).
R5. Deploy. Expected: healthcheck **fails** (503 `receiver_disabled`,
    `storage_permission_unconfirmed`) — so the deploy is marked failed and nothing
    serves. That is the dark state working. Then:
    `railway run -s trade-exchange-news-receiver -- python tools/txn_preflight.py --role receiver --lifecycle-confirmed-in-dashboard`
    → must print `READY` apart from the two switches.
R6. Replicas (recommended, owner decision): 2 replicas in one region
    (Settings → Scaling, or `multiRegionConfig` in railway.json). Stateless, so a
    crash of one leaves the other serving; each replica pushes to web and R2
    independently.

## 4. Web (dark code first) — W1–W4

W1. The Trade Exchange code reaches `master` (owner merge approval) — every route
    stays unmatched and nothing starts while `TXN_ENABLED` is unset.
W2. Set web variables from `env.web.example` **except** `TXN_ENABLED`,
    `TXN_STORAGE_PERMISSION_CONFIRMED`, `ALERT_NEWS_MATCH_ENABLED`. Preflight:
    `railway run -s web -- python tools/txn_preflight.py --role web --r2-write-check --lifecycle-confirmed-in-dashboard`
    (a correctly scoped key is refused the lifecycle read: look at the two rules in the
    dashboard first; that flag records that you did. Anything else still fails.)
W3. `TXN_ENABLED=1` + `TXN_SYNTHETIC_ONLY=1` for the synthetic stage
    (`TXN_STORAGE_PERMISSION_CONFIRMED=1` only after Trade Exchange's written
    permission, and then `TXN_SYNTHETIC_ONLY` is removed). One web redeploy (the known 82–119 s web window; receiver keeps
    journaling through it). Check `GET /api/admin/trade-exchange-news`
    → `enabled:true, started:true, ready:true`, journal `s3`, backlog 0.
W4. Optional, separate step: `ALERT_NEWS_MATCH_ENABLED=1` (admin-only alert routes).

## 5. Arm the receiver (synthetic stage) — S1–S4

S1. Receiver: `TXN_RECEIVER_ENABLED=1` + `TXN_SYNTHETIC_ONLY=1` (stores only content
    starting with `SYNTHETIC`; refuses the rest with 422). Healthcheck now passes.
    `TXN_STORAGE_PERMISSION_CONFIRMED` stays UNSET until Trade Exchange's written
    permission — it is the real-content switch, not the synthetic one.
S2. Synthetic POST from the owner's machine (URL from the secrets file, never typed
    into chat): `{"source":"TXNews1","content":"SYNTHETIC ..."}` → 200; the admin
    News widget shows it; admin status shows `push:1` (not `reconcile`) — that
    proves the private network path. A `reconcile` count instead means the push
    failed and recovery delivered it (fix networking before going on).
S3. Availability measurement (the evidence §7 asks for):
    `TXN_PROBE_URL_FILE=<file> python tools/txn_deploy_probe.py --rate 5 --seconds 240 --out probe.json --i-confirm-staging`
    while `railway redeploy -s trade-exchange-news-receiver`. Record the summary
    (longest failure run, statuses). Repeat ≥3 times; also during a **web** redeploy
    (expect 0 receiver failures; pushes fall back to recovery).
S4. Purge synthetic headlines before any real traffic: stop web pipeline
    (`TXN_ENABLED` unset), delete `/data/trade_exchange_news.db` (owner approval),
    and the R2 prefix objects; the epoch changes, so open widgets reload cleanly.

## 6. Real provider traffic (D3, NOT authorized) — P1–P3

Preconditions: written retention + redistribution permission; the provider
questions answered (`docs/trade-exchange-news/provider-questions.md`); S3 evidence
accepted. P1 set `TXN_STORAGE_PERMISSION_CONFIRMED=1` on both services. P2 owner
adds `https://<receiver-domain>/hook/<webhook_token>` (or the header method Trade
Exchange supports) as an **additional** destination — the Discord webhook is not
touched. P3 narrow `TXN_AUTH_MODES` to the method actually used.

## 7. Availability: what is and is not guaranteed

Documented by Railway (fetched 2026-10-27, docs.railway.com/reference/deployments,
/healthchecks, /config-as-code, /scaling):
- the new deployment must pass its healthcheck before the old one is retired;
  "the old version will be stopped and removed with a slight overlap";
- the old deployment then receives **SIGTERM**, and is SIGKILLed after
  `drainingSeconds` (**default 0** — hence our explicit 10);
- healthchecks run **only at deploy time**; there is no continuous monitoring;
- volumes prevent overlapping deployments (why the receiver has none);
- replicas: traffic is randomly distributed across a region's replicas.

Measured locally (`tests/test_trade_exchange_news_receiver_lifecycle.py`): dual-stack
startup in well under 5 s; healthcheck fail-closed; graceful shutdown completes the
in-flight webhook (200, durable) and serves no new one; timeout chain journal 4 s <
uvicorn 5 s < draining 10 s; two overlapping instances both deliver and a
cross-instance retry is one headline.

NOT known until S3 measures it: how Railway's edge routes requests to an instance
that has received SIGTERM during draining (a request may get a 502/connection
error). **There is no zero-downtime guarantee.** Residual risks: that edge window;
a single-replica crash until restart; a Railway platform/edge outage; Trade
Exchange's retry policy (unknown) decides whether any of those loses a headline.
Mitigations: 2 replicas; deploy the receiver rarely (its watch path is its own
directory); ask Trade Exchange to retry on 5xx/timeouts.

## 8. Rotation

Hook secret: mint → set receiver `TXN_WEBHOOK_TOKEN_SHA256=old,new` → owner updates
the Trade Exchange URL → remove `old`. Ingest bearer: set web digest `old,new` →
receiver `TXN_INGEST_TOKEN=new` → remove `old` digest. R2 tokens: create new token
→ swap variables → revoke old token in Cloudflare. Rotate on any staff/access
change to the Railway project (Railway HTTP logs show request paths).

## 9. Rollback (each step independent, nothing deleted)

| Undo | Action | Effect |
|---|---|---|
| Real traffic | owner removes the destination in Trade Exchange | no new headlines; Discord unaffected |
| Receiver | unset `TXN_RECEIVER_ENABLED` | hook 404s for everything; healthcheck 503 (next deploy fails closed, current keeps serving 404) |
| Web feature | unset `TXN_ENABLED` | routes unmatched, pipeline stops; store and journal kept |
| Alerts | unset `ALERT_NEWS_MATCH_ENABLED` | alert routes 404, hook no-op; rules kept (suspended never deleted) |
| Storage | unset `TXN_STORAGE_PERMISSION_CONFIRMED` | receiver 503s (sender retries), web pipeline won't start |
| Code | revert the merge on `master` | web redeploy; receiver service can be paused/removed in Railway |
| Widget | it is in `UNRELEASED_CAPTURE_WIDGETS`; server routes are admin-only | members never see it |
