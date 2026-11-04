# KN-1 Retention Verification: production providers, Railway storage, Sentry (2026-11-04)

**Status:** read-only verification for the Brain activation HOLD. Nothing was changed: no Railway variable or setting changes, no deploys, no paid calls. No user content, secrets or market values were read or printed. Variables are reported as **names with set/unset only**.
**Builds on:** `RETENTION-IMPACT.md` and `RETENTION-PROPOSAL.md` (this PR, #748). It does not repeat them. It replaces their [U] items where this pass could verify them.
**Method:**
- Railway CLI 4.66.0, from the linked `UCT-Dashboard` checkout (project `luminous-recreation`, environment `production`).
- Railway public GraphQL, read-only queries only, authenticated with the CLI's own session.
- Code at `origin/master` @ `3d3d444d4f`.
- Official public documentation, fetched 2026-11-03/04.

**Correction to the earlier docs:** production `web` is running **`3d3d444d4f`**, which is `origin/master` HEAD (merge of #754, "UCT Agent release train 2 — Brain dark ..."). The Brain code (`api/services/uct_agent/knowledge/`) is therefore **deployed to production, dark**. `RETENTION-IMPACT.md` said master had 0 knowledge files at `ac28a3f20c`, which was true then. `UCT_AGENT_KNOWLEDGE` is **unset** on web, so the Brain stays off.

Legend: **[V]** = verified, with the evidence named. **[U]** = cannot be verified without the owner's console or contract access. Exact steps are in §6.

---

## 1. Railway (production)

### 1.1 Services and volumes [V]

`railway status --json` lists 11 services: `web`, `worker`, `bars-api`, `flow-worker`, `breadth-v2-runner`, `fundamentals-v5-runner`, `econ-ingest`, `tx-recap`, `chart-renderer`, `terminal-next-monitor`, `trade-exchange-news-receiver`.

| Service | Volume | Mount | Deployed commit | Runs Agent code? |
|---|---|---|---|---|
| **web** | `web-volume` (80 GB) | `/data` | `3d3d444d4f` | **Yes.** `api/main.py:10528` includes the `uct_agent` router. It is the only service with `UCT_AGENT_*`, `ANTHROPIC_API_KEY` and `PERPLEXITY_API_KEY` set together. |
| worker | `worker-volume` | `/data` | `3d3d444d4f` | No. `api/worker_main.py` has no `uct_agent` import, and there are no `UCT_AGENT_*` vars. |
| bars-api | `bars-api-volume-KVD-` | `/data` | `3d3d444d4f` | No |
| flow-worker | `flow-worker-volume` | `/data` | `99da7e07cc` | No |
| tx-recap | `tx-recap-volume` | `/data` | — | No Agent code, but it has its own `ANTHROPIC_API_KEY` (set), likely the same Anthropic org [U] |
| others | — | — | — | No |

### 1.2 Is `uct_agent.db` on a persistent volume? **Yes** [V]

- **Path:** `store.py:32` reads `_DB_PATH = os.environ.get("UCT_AGENT_DB_PATH", "/data/uct_agent.db")`. `UCT_AGENT_DB_PATH` is **unset** on web, so the default `/data/uct_agent.db` applies.
- **Volume:** web's `/data` is `web-volume`.
- **File present:** `railway volume files --volume web-volume list /` (file names only, no content read) shows `/uct_agent.db`, about 1.9 MB.
- **Sidecar files:** the store runs `PRAGMA journal_mode=WAL` (`store.py:95`), so `-wal` and `-shm` sidecar files can also exist on the volume. None was present at listing time.
- **Effect:** transcripts survive redeploys and restarts and have no TTL.

### 1.3 Volume backups (Railway snapshots) [V]

Read-only GraphQL queries `volumeInstanceBackupScheduleList` and `volumeInstanceBackupList`:

| Volume | Backup schedules | Existing backups |
|---|---|---|
| **web-volume** | **none** | 1 backup: "Online resize to 80000MB", created **2026-07-02**, `expiresAt: null` |
| worker-volume | none | 2 resize backups (2026-09-01, 2026-09-04), no expiry |
| bars-api | none | 1 resize backup (2026-09-04), no expiry |
| flow-worker | none | 1 resize backup (2026-09-04), no expiry |

What this means:
- **No scheduled backups exist.** Railway's daily, weekly and monthly schedules (kept 6, 27 and 89 days) are **off** for every volume checked.
- **The one web-volume backup cannot contain Agent transcripts.** It is dated 2026-07-02, but `api/services/uct_agent/store.py` was first committed **2026-10-06** (`81cfb46fd9`).
- **Side finding (not Agent):** Railway took automatic backups when the volumes were resized, and they **never expire**. The web one holds whatever `/data` held on 2026-07-02, including account and member stores. This matters for the general Privacy page ("backups ≈7 days"), and the owner may want to delete it (Railway → web → Backups). I changed nothing.
- **Future risk:** any future resize of `web-volume` creates a new non-expiring backup, and that one **would** contain `uct_agent.db`. Phase 3 of the proposal must cover this. Either avoid resizing, or delete the resize backup after verifying the new volume.

### 1.4 App-level backups [V]

- `uct_agent.db` is not covered by any app backup.
- It is not in `store_backup.STORES` or `COVERED_ELSEWHERE` (`api/services/store_backup.py:91-125`).
- No `/backups` or `/flow_backups` entry on web-volume has "agent" in its name: `/backups` has 11 entries (auth, breadth, user_definitions), and `/flow_backups` is empty.
- `STORE_BACKUP_ENABLED`, `AUTHDB_BACKUP_ENABLED`, `FLOW_BACKUP_ENABLED`, `J2_ATTACHMENT_BACKUP_ENABLED` and `BACKUP_PUBLIC_KEY` are **set** on web. They back up other stores only.
- Outside the Agent package, only three read-only tools reference the DB: `tools/agent_eval_report.py`, `tools/agent_latency_telemetry.py` and `tools/agent_live_chain.py`. None copies it anywhere.

### 1.5 Plan and log retention [V]

- **Plan:** GraphQL `me.workspaces` and `project.workspace` return `plan: "PRO"`, `subscriptionModel: "TEAM"`, `subscriptionType: "pro"`.
- **Log retention:** Railway documents **30 days** for Pro (<https://docs.railway.com/observability/logs>). The same page also says "Upgrading plans will immediately restore logs that were previously outside of the retention period." So the underlying storage may last longer than 30 days, and that is not documented [U].
- **What the app logs:** no request URLs. `uvicorn.access` is set to WARNING (`api/main.py:40`, `api/logging_redaction.py:1-10`). Agent logs are content-free (see `RETENTION-IMPACT.md` §A2).
- **One exposure to check:** `GET /api/agent/search?q=…` (`routers/uct_agent.py:811-814`) carries the member's search text **in the URL query string**. The app does not log it. **Whether Railway's edge HTTP logs keep query strings was not verified.** I did not read HTTP logs (§6, step R2). Any Cloudflare edge logging in front of the app is also [U].

### 1.6 Variable names on web, filtered to SENTRY|ANTHROPIC|PERPLEXITY|LOG|BACKUP|RETENTION (plus Agent-relevant names) [V]

Web has 555 variables in total. Names only, values never read into output:

| Name | State |
|---|---|
| `ANTHROPIC_API_KEY` | set |
| `ANTHROPIC_BASE_URL` | **unset** |
| `PERPLEXITY_API_KEY` | set |
| `SENTRY_DSN` | **unset** (no variable matching `SENTRY` exists on **any** of the 11 services, including `TXN_SENTRY_DSN`) |
| `AUTHDB_BACKUP_ENABLED`, `STORE_BACKUP_ENABLED`, `FLOW_BACKUP_ENABLED`, `J2_ATTACHMENT_BACKUP_ENABLED`, `BACKUP_PUBLIC_KEY` | set |
| `TWEET_RETENTION_DAYS` | set (unrelated) |
| `SCREENER_LOGIC_ENABLED`, `SMOKE_LOGIN_LINK_ENABLED` | set (regex match on "LOG", unrelated) |
| `UCT_AGENT_DAILY_CAP`, `_DATA`, `_DATA_KINDS`, `_NEWS`, `_NL1`, `_SCAN`, `_STREAM` | set |
| `UCT_AGENT_MODEL`, `_PLANNER`, `_DB_PATH`, `_KNOWLEDGE`, `_RESEARCH`, `_TIMEOUT_S`, `AI_SEARCH_DOMAIN_FILTER` | **unset** |

The flow-worker service has `FLOW_BACKUP_RETAIN_DAYS` and `FLOW_TAPE_SPOOL_RETENTION_HOURS` set. Both are unrelated to the Agent.

---

## 2. Sentry

**Production state: Sentry is NOT initialised on web** [V]:
- `api/main.py:282` reads `SENTRY_DSN`, and `:329` calls `sentry_sdk.init` only `if _SENTRY_DSN`.
- `SENTRY_DSN` is unset on web (§1.6). No `SENTRY*` variable exists on any service.
- No frontend Sentry exists: no `@sentry/*` or `Sentry.init` anywhere in `app/`.
- The only other init is the Trade Exchange News receiver, which reads `TXN_SENTRY_DSN`. That is unset too.

**So today, no Agent request data reaches Sentry.**

**If a DSN were set later** (code as deployed, `sentry-sdk[fastapi]==2.23.1`), these settings would apply:

| Setting | Value | Effect on `/api/agent/*` |
|---|---|---|
| `send_default_pii` | not passed (SDK default: off) | Cookies, `Authorization` and IP are not sent. User id is not attached. |
| `include_local_variables` | not passed (SDK default **True**) | Stack-frame locals are sent. An exception in `turn.py` or `store.add_turn` would carry `msg`, `messages`, `text` and outcome strings. |
| `max_request_body_size` | not passed (SDK default **"medium"**, ≤ 10,000 bytes) | The JSON body of `POST /api/agent/turn`, `/turn/stream`, `/record` and `/data` would be attached to error events. That is the member's message, history excerpts and outcome text. |
| `before_send` / `before_send_transaction` | `api/sentry_redaction.py` | It redacts **URL credentials only**: `/api/inbound-alerts/hook/…` and credential-named query keys. "Nothing else in an event is touched" (`sentry_redaction.py:16-18`). |
| `traces_sample_rate` | 0.1 | 10% of requests become transactions carrying the URL, so `/api/agent/search?q=…` query text would land in spans. |
| Anthropic integration | auto-enabled in sentry-sdk 2.x when `anthropic` is installed | It records prompts and outputs only when `send_default_pii` is on (it is off here). |

SDK defaults are from <https://docs.sentry.io/platforms/python/configuration/options/>.

**Recommendation (unchanged from IMPACT Phase 1.3):** add the `/api/agent/*` body, locals and query scrub before anyone sets `SENTRY_DSN`.

**[U]:** whether a Sentry org or project exists and still holds **historical** events from a period when a DSN was set. Sentry's own retention depends on the plan. See §6, step S1.

---

## 3. Anthropic

### 3.1 What the code sends (deployed `3d3d444d4f`) [V]

- **Client:** `anthropic.Anthropic(api_key=ANTHROPIC_API_KEY, timeout=60.0)` (`api/services/engine.py:86`). There is no `base_url` in code, and `ANTHROPIC_BASE_URL` is **unset** on web, so requests go to the SDK default **`https://api.anthropic.com/v1/messages`**. No proxy or gateway sits in the path.
- **Per-call options:** `with_options(max_retries=0, timeout=UCT_AGENT_TIMEOUT_S or default)` (`turn.py:1389-1406`).
- **Headers:** the SDK defaults only: `x-api-key`, `anthropic-version`, and SDK user-agent / `x-stainless-*`. There are **no** `default_headers`, `extra_headers` or `anthropic-beta` headers in `api/services/uct_agent/`.
- **Metadata:** **no** `metadata` is sent on Agent calls. No `metadata.user_id` and no member identifier. (`engine.py:1641` and `:2041` send `metadata.user_id` with constant strings for the earnings features, not the Agent.)
- **Model:** `UCT_AGENT_MODEL` is unset, so `claude-haiku-4-5` (`turn.py:83`).
- **Calls:**
  - **Turn (v1):** `messages.create` or `messages.stream`, with `system` blocks marked `cache_control: ephemeral` (prompt caching) and `output_config` with a JSON-schema format (structured outputs). Messages carry history, the member message and context (`turn.py:2304-2330`).
  - **Title:** max_tokens 64, structured output (`turn.py:1694-1700`).
  - **Planner v2** (`turn_v2.py:361`): adds `tools` with `cache_control`. It is **off**: `UCT_AGENT_PLANNER` is unset.
- **Features not used:** Files API, Batch API, code execution and message threads.

### 3.2 Official retention terms [V public documents]

**Default (no ZDR):**
- "We automatically delete inputs and outputs on our backend within **30 days** of receipt or generation."
- Usage Policy-flagged content is kept **up to 2 years**, and trust and safety classification scores **up to 7 years**.
- Source: <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data>

**Training:**
- "By default, we will not use your inputs or outputs from our commercial products" to train models.
- The exceptions are explicit feedback, or the customer opting in.
- Source: <https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training>
- The opt-in is the Development Partner Program. It is a Console setting ("Join" or "Leave"), and per its support article it covers Claude Code traffic only. Data already shared is kept up to 2 years. Source: <https://support.claude.com/en/articles/11174108-about-the-development-partner-program>

**ZDR:**
- "Under a ZDR arrangement, Anthropic does not store customer prompts or responses at rest after the API response is returned."
- "To request ZDR for your organization, contact the Anthropic sales team." ZDR "is enabled per organization."
- "How do I know if my organization has ZDR arrangements? Check your contract terms or contact your Anthropic account representative."
- Feature eligibility for what this code uses:
  - Messages API: **Yes**.
  - Prompt caching: **Yes**.
  - Structured outputs: **"Yes (qualified)"**. The JSON **schema** (not the prompts) is cached up to 24 hours.
- Even with ZDR, flagged or legally required data may be kept up to 2 years.
- The Console has a **Data retention** page at `platform.claude.com/settings/privacy`.
- Source: <https://platform.claude.com/docs/en/manage-claude/api-and-data-retention>

### 3.3 Verified vs. unverifiable

**[V]:**
- Endpoint, headers, absence of metadata, model, and the ZDR eligibility of the features used.
- The repo's Privacy page states "we … do not have a separate zero-data-retention agreement" (`app/src/pages/Privacy.jsx:110-114`).

**[U]:**
- Whether the org behind the production `ANTHROPIC_API_KEY` has ZDR, or any non-default retention or DPP setting.
- Which org or workspace that key belongs to.

The API exposes neither without the owner's Console or contract access, and I made no API call. **Until confirmed, assume 30 days by default, up to 2 years if flagged.**

---

## 4. Perplexity

### 4.1 What the code sends [V]

- **Endpoint:** `POST https://api.perplexity.ai/chat/completions` (`api/services/perplexity_search.py:26`).
- **Headers:** `Authorization: Bearer $PERPLEXITY_API_KEY` and `Content-Type: application/json` only (`:546-552`).
- **Agent call** (`turn.py:1370-1374`): `web_search(query=query[:400], max_tokens=600, mode="fast", recency, domain_pack="finance", cost_surface="uct_agent")`.
- **Payload** (`:530-540`):

  ```json
  {
    "model": "sonar-pro",
    "messages": ["<system: finance prompt>", "<user: query ≤ 400 chars>"],
    "max_tokens": "<effective cap>",
    "search_recency_filter": "<only if a recency is chosen>"
  }
  ```

- **Fields not sent:**
  - `search_domain_filter`: **not sent**, because `AI_SEARCH_DOMAIN_FILTER` is unset (`:48-57`).
  - `return_related_questions`: not requested by the Agent.
  - No user id, no history and no metadata.
- **Local copies:** an in-process 15-minute `TTLCache` and a content-free cost ledger.

### 4.2 Official terms [V public documents]

- **Training:**
  - API Terms §2.3.3: "Perplexity shall not use (or authorize third parties to use) Customer Content to train, retrain, fine-tune or otherwise improve any generative artificial intelligence models." Last updated January 23, 2026: <https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service>
  - The FAQ says the same: "Perplexity does not use Customer Content to train generative AI models." <https://docs.perplexity.ai/docs/resources/faq>
- **Retention:**
  - "Retention depends on the API, model, and account configuration, and Zero Data Retention (ZDR) is not the default." (FAQ)
  - "If ZDR has not been enabled for your account, do not assume that Perplexity or its model providers apply zero data retention to your requests."
  - ZDR is account-level, for eligible customers, under a written agreement. <https://docs.perplexity.ai/docs/resources/privacy-security>
  - **No default retention period is published.** The Terms set no fixed period either. They mention backups being "deleted in accordance with … standard deletion procedures" on termination, §10.5.
- **Other documents:** the DPA is at <https://www.perplexity.ai/hub/legal/dpa>, and compliance documentation is in the Trust Center at <https://trust.perplexity.ai/>. Contact for account-specific questions: `api@perplexity.ai`.

### 4.3 Verified vs. unverifiable

**[V]:** what is sent, and the no-training term.

**[U]:**
- The actual retention period that applies to this account.
- Whether any ZDR or written agreement exists.
- Whether `sonar-pro` (a Perplexity first-party model) involves any third-party provider retention.

The public pages explicitly defer all three to the account's configuration or agreement.

---

## 5. Transcript storage (code at `3d3d444d4f`) [V]

- **Where:** SQLite file `/data/uct_agent.db` on `web-volume` (§1.2), in tables:
  - `agent_conversations`, `agent_turns` (`text`, `data_json`, citations), `agent_conversation_state` and `agent_telemetry` (`store.py:40-76`);
  - `agent_spend` and `agent_requests` (`budget.py:109-128`);
  - `agent_rate_events` and `agent_inflight` (`limits.py:55-62`).
- **Persistent:** yes. It is on the volume, with no TTL. The only delete path is a member deleting one conversation (`store.py:261-269`).
- **Backups:** no app backup copies it (§1.4), and no Railway backup schedule exists (§1.3). The only Railway snapshot of `web-volume` predates the Agent store.
- **Account deletion:** **does not purge it.**
  - All seven Agent tables are registered as `"UNPURGED member data: uct_agent store"` in `tests/test_alert_erasure.py:487-493`.
  - No purge module (`journal_two/account_purge.py`, `alert_erasure.py`, `account_tombstones.py`, `routers/auth.py`) references the Agent tables.
  - `docs/account-deletion-manifest.md:341` lists "agent" among the unpurged stores.

---

## 6. Owner actions: exact steps for what could not be verified

**Anthropic (A1–A3).** Sign in at <https://platform.claude.com> with the org that owns the production key.
1. **A1. Which org and workspace owns the key.** Go to **Settings → API keys** and find the key used for production web: match the key's name or hint (the last 4 characters shown in the Console) against what was pasted into Railway. Note its **workspace**.
2. **A2. Retention and ZDR.** Go to **Settings → Data retention** (`platform.claude.com/settings/privacy`) and select **Organization**, then that workspace, from the dropdown at the top. Record:
   - (a) whether any zero-data-retention or custom retention is shown;
   - (b) whether a HIPAA card is enabled (not expected);
   - (c) the **Development Partner Program** state. It should be **not joined**. If it shows "Leave", the org has opted in.
3. **A3. Contract.** If the page shows nothing about ZDR, ZDR is **not** in place (it is contract-only). Check the commercial agreement or email the account representative. To request ZDR: <https://claude.com/contact-sales>.
4. **Repeat** A1–A2 for the `tx-recap` service's key if it belongs to a different org.

**Perplexity (P1–P3).**
1. **P1.** Sign in at <https://www.perplexity.ai/account/api> (API settings / API Groups). Note which API group the production key belongs to, and whether any "data retention" or ZDR indicator is shown. Public docs describe ZDR only as account-level under a written agreement, so no toggle is expected.
2. **P2.** Check for a signed order form, DPA or written agreement with Perplexity. If there is none, the account runs on the default API Terms: no training, but an **unspecified** retention period.
3. **P3.** Email `api@perplexity.ai` from the account owner's address and ask: "What is the retention period for API inputs and outputs on our account/API group for `sonar-pro` chat completions, and is ZDR available to us?" Keep the reply with PR #748.

**Railway (R1–R3).**
1. **R1. Optional cleanup.** Go to **Railway → luminous-recreation → web → Backups** (and worker, bars-api, flow-worker). Decide whether to delete the non-expiring "Online resize" backups (§1.3). Before deleting, confirm the live volume is healthy. Deletion cannot be undone.
2. **R2. Do HTTP logs keep query strings?** In **web → Observability → HTTP Logs**, filter on path `/api/agent/search` and check whether the shown path includes `?q=`. Only look at the shape. If it does, the search text sits in Railway logs for 30 days (Pro). The fix is to move search to `POST` (a code change, not done).
3. **R3.** If Cloudflare proxies the domain, check **Cloudflare → Analytics/Logs → Logpush**. If no Logpush job exists, nothing is retained beyond aggregate analytics.

**Sentry (S1).**
1. If a Sentry organization exists for UCT, open **Settings → Projects** and check whether any project has events.
2. Check **Settings → Subscription** for the plan's event retention.
3. If old events exist from a period when a DSN was set, delete them or let them age out.
4. **Do not set `SENTRY_DSN` on web** until the `/api/agent/*` scrub (IMPACT Phase 1.3) ships.

---

## 7. Summary for the HOLD

| Item | Result |
|---|---|
| Anthropic endpoint and headers | [V] direct `api.anthropic.com`, SDK default headers, no metadata, model `claude-haiku-4-5` |
| Anthropic retention | [V] public default is 30 days (2 years if flagged) and no training by default. **ZDR status [U]** (A1–A3). The Privacy page says no ZDR. |
| Perplexity payload | [V] `sonar-pro`, system + query ≤ 400 chars, no user id or history |
| Perplexity retention | [V] no training. **Period [U]**: not published, not ZDR by default (P1–P3) |
| Transcript store | [V] `/data/uct_agent.db` on `web-volume`, persistent, no TTL, not purged on account deletion |
| Railway backups | [V] no schedules. One non-expiring 2026-07-02 web snapshot that predates the Agent store. A future resize would capture transcripts. |
| Railway logs | [V] Pro plan, 30 days. The app logs no URLs or content. **HTTP-log query strings for `/api/agent/search` [U]** (R2) |
| Sentry | [V] **not initialised** in production (no DSN on any service). If enabled as coded, it would capture Agent bodies and locals. |
