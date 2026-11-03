# KN-1 Retention Impact: scope, effects, provider facts, phased plan, web-research separation

**Status:** design and analysis only. There are no code, flag or data changes and no destructive operations. Owner approval is required for every phase in §C.
**Owner decision (2026-11-03, on #748):** the current behaviour is NOT approved for Brain activation. That behaviour is: raw excerpts stored indefinitely, replayed to the model, and kept after account deletion.
**Trees read:**
- `origin/agent/kn/knowledge-poc` @ `16b1a97839`. Line numbers below refer to this tree unless marked.
- `origin/master` @ `ac28a3f20c`. I have **not** verified whether this exact commit is what production runs.

**Data handling:** no real user content or market values were read or printed. Counts only.

Legend: **[V]** = verified (code, a document or a read-only count). **[U]** = unknown or needs owner/account confirmation.

---

## A. Scope and impact

### A1. General Agent behaviour or Brain-only?

**Answer: the indefinite-storage behaviour is GENERAL.** It applies to every UCT Agent conversation today, not only to the inactive Brain path.
- The Agent itself is admin-only and dark: `require_admin_dark` (`api/routers/uct_agent.py:91-93`).
- The Brain path exists only on this branch. `origin/master` contains **0** files under `api/services/uct_agent/knowledge/` [V].
- `store.py`, the router, `present.js` and `useAgent.js` are byte-identical between master and the branch. `turn.py` differs by 3 added lines: the Brain framing [V].

| Behaviour | General (every Agent chat, on master today) | Brain-only (inactive; branch only) |
|---|---|---|
| Transcript text stored | `store.add_turn` stores `text` ≤ 4,000 chars for member, agent and outcome rows (`store.py:36`, `:195-207`); router writes at `routers/uct_agent.py:284`, `:538`, `:597`, `:677-679` [V] | What the text *contains* for playbook.*: excerpts and template fields (`app/src/agent/capabilities/knowledge.js:43-94`) [V] |
| `data_json` views | Every query answer stores its presented view, ≤ 9,000×1.5/n chars (`useAgent.js:684-690`, `present.js:149-165`); row cap 20,000 (`store.py:155-192`) [V] | The view for playbook.* carries the excerpts [V] |
| Search | `/api/agent/search` runs a LIKE search over every row's `text` (`store.py:322-338`, `routers/uct_agent.py:768-771`) [V] | Makes passage text searchable [V] |
| Replay to the model | `history_messages` replays the last 36 rows; outcome rows go through `outcome_for_model` (`turn.py:939-990`) [V]. **Local-only** breadth rows are already replayed as a note, not values (`turn.py:871-883`, `:943-945`). | Framing of playbook.* rows (`turn.py:950-952`, `knowledge/frame.py`); v2 step framing (`turn_v2.py:216-218`) [V] |
| No TTL / no prune | No delete except a member deleting a chat (`store.py:261-271`); no scheduler job in `api/services/uct_agent/` [V] | — |
| Survives account deletion | Agent tables are listed `UNPURGED` (`tests/test_alert_erasure.py:487-493`) [V] | — |
| Knowledge reads | — | Kinds registered only on the branch; `gateway.py:77` removes them unless enabled; `UCT_AGENT_KNOWLEDGE` gate (`knowledge/index.py:163`) [V] |

The fix therefore has two layers:
- **General:** the 30-day policy, account purge and Sentry body scrubbing. This is a general Agent privacy decision.
- **Brain-specific:** citation-only rows and citation replay.

The owner may approve them separately (see Q1 in §E).

### A2. Effect of a 30-day prune plus citation-only storage

| Area | Today | Effect of the change | Status |
|---|---|---|---|
| **Existing Agent conversations: production** | Unknown. Production `/data/uct_agent.db` was not read (no prod read in this task). | All rows older than 30 days would be deleted. Count and age profile: **unknown**. They need an owner-run dry-run count (§C, Phase 3). | [U] |
| **Existing Agent conversations: local dev copy** | `C:/data/uct_agent.db`, read-only, mtime 2026-10-12. Counts: 390 conversations, 2 user ids; turns 790 member and 4,547 outcome, dated 2026-10-08 to 2026-10-12; 0 rows older than 30 days today (they cross 30 days from about 2026-11-07); 0 playbook.* rows; 0 rows with `views`; 4,572 telemetry rows; no `agent_spend` table (an older schema). This is a dev and test DB, **not** production. | A prune after about 11-12 would empty it. No impact on production. | [V] (local only) |
| **History replay** | Replays the last 36 rows of the chat in full | Chats idle for more than 30 days lose their history, so a follow-up starts fresh: the model sees nothing older. playbook.* rows replay as a citation line only (`[UCT answered from playbook: "Title"…]`). Member and agent rows are unchanged within 30 days. A restored chat in the panel shows citations with "Show again" for knowledge rows. | [V] design |
| **User / account deletion** | Agent rows survive account deletion (`KNOWN_UNPURGED`). The Privacy page says "Your content … retained until you delete it or your account is deleted" (`app/src/pages/Privacy.jsx:163`). Agent chats are not listed there, but once Agent opens to members, survival after deletion conflicts with that promise. | Add the Agent tables to the account purge (`account_purge`), remove them from `KNOWN_UNPURGED`, and add tombstone replay if a backup is ever added. | [V] code / [U] legal reading |
| **App logs** | Agent and knowledge logs are content-free (shapes, counts, exception types): `turn.py:1228`, `:1349`, `:1357`; `knowledge/index.py:117-169`; `gateway.py:205-227`. Perplexity logs carry surface, model and tokens only (`perplexity_search.py:376-384`). One unaudited line: `perplexity_search.py:574` logs the requests exception string, which can hold the URL but not the body. | No change needed. Add the sentinel log rail (§C, Phase 1). | [V] |
| **Railway logs** | Retention is plan-dependent: Hobby 7 days, Pro 30 days, Enterprise up to 90 (<https://docs.railway.com/observability/logs>). This project's plan was not verified. | Logs carry no passage text, so the prune does not affect them. | [U] plan |
| **Sentry (backend)** | When `SENTRY_DSN` is set, `sentry_sdk.init` runs with default options plus URL redaction only (`api/main.py:329-340`, `api/sentry_redaction.py:1-20`: "Nothing else in an event is touched"). The SDK's defaults can attach request bodies and stack-frame locals to an error event. An exception inside `/api/agent/record` could therefore carry the outcome text. Whether a DSN is set in production, and Sentry's retention, are unknown. Sentry is listed as a subprocessor "when enabled" (`Privacy.jsx:107`). | Add a `before_send` rule for `/api/agent/*` that drops `request.data` and frame vars, or set `max_request_body_size="never"` and `include_local_variables=False` for these routes. | [V] code / [U] DSN and retention |
| **Volume snapshots (Railway)** | Railway volume backups are opt-in schedules: daily kept 6 days, weekly 27 days, monthly 89 days. Pro plans also back up volumes automatically before an update (<https://docs.railway.com/volumes/backups>). Whether any schedule is on for the web volume is **unknown**. | A pruned row survives in any snapshot for up to that snapshot's retention. Document the worst case: 30 days plus snapshot retention. | [U] |
| **App backups** | `uct_agent.db` is not in `store_backup.STORES` or `COVERED_ELSEWHERE` (`api/services/store_backup.py:91-119`). The Privacy backup sentence covers the account database only (`Privacy.jsx:166-168`). | Nothing to change. Keep it out of the app backups. | [V] |
| **Spend ledger** (`agent_spend`, `agent_requests`) | Content-free. `agent_requests` is pruned after 24 h (`budget.py:202`). `agent_spend` has no TTL and drives the daily caps and `/api/agent/budget`. `tools/agent_eval_report.py:148` reads spend and telemetry. | **Not pruned** by the transcript policy, because it holds no content. Optionally prune after 13 months for cost audit. | [V] |
| **Telemetry** (`agent_telemetry`) | Content-free (`store.py:371-394`). Read by `tools/agent_latency_telemetry.py` (default `--days 30`) and `tools/agent_eval_report.py`. | Keep 90 days (longer than the tools' 30-day window). | [V] |
| **Other retention obligations in the repo** | Privacy: activity data 1 year (`Privacy.jsx:164`); account backups about 7 days (`:166-168`); "Data sent to AI providers — kept by the provider only as their terms allow" (`:170`). The Agent and the Brain are **not mentioned**. `docs/account-deletion-manifest.md` records the Agent store as unpurged (`:339-342`). No document requires keeping Agent transcripts. Trade Exchange News "permanent retention" is unrelated (`store_backup.py:108-111`). | A 30-day prune conflicts with nothing found. **The Privacy page needs an Agent entry before member launch.** That is the owner's and counsel's call. | [V] repo / [U] legal |

---

## B. Provider retention: verified from code and public documents

### B1. What the code sends

| Provider | Endpoint | Headers / auth | What is sent | Evidence |
|---|---|---|---|---|
| **Anthropic** | Messages API through the official SDK `anthropic.Anthropic(api_key=…)`. No `base_url` in code, so the SDK default `https://api.anthropic.com` applies unless the `ANTHROPIC_BASE_URL` env is set in production [U]. | SDK defaults: `x-api-key`, `anthropic-version`. No beta headers. No `metadata.user_id`. No `extra_headers`. | System prompt with `cache_control: ephemeral`; history (incl. replayed outcome rows); member message; context; v2 tool definitions and tool results. The model is `UCT_AGENT_MODEL`, default `claude-haiku-4-5`. Title naming call: up to 16 rows × 400 chars. | `api/services/engine.py:73-87`; `turn.py:81`, `:1011-1030`, `:1262-1286`, `:1706`, `:1759`; `turn_v2.py:343`, `:361` [V] |
| **Perplexity** (the Agent's web research; RS-1 is still `todo` on `docs/agent/program/BOARD.md:79` and reuses this) | `POST https://api.perplexity.ai/chat/completions` | `Authorization: Bearer $PERPLEXITY_API_KEY`, `Content-Type: application/json` | `{model: sonar-pro (mode fast), messages: [system (finance prompt), user: query ≤ 400 chars], max_tokens 600, search_domain_filter, search_recency_filter}`. Only the query, never the history. The result is cached **in process** for 15 min, keyed by an md5 of system+query (`TTLCache`). The cost ledger (`narrative_cost_guard.record`) stores surface, model, tokens and USD only. | `perplexity_search.py:26`, `:30-33`, `:90-94`, `:206-220`, `:414-432`, `:524-556`; `turn.py:993-1008` [V] |

### B2. Provider terms (official pages, fetched 2026-11-03)

**Anthropic** [V public documents]:
- API inputs and outputs are deleted within 30 days.
- Usage Policy-flagged content is kept up to 2 years, and trust and safety scores up to 7 years.
- Commercial data is not used for training by default.
- Zero data retention (ZDR) means no storage at rest after the response. It is requested through sales and enabled **per organization**. The Messages API and prompt caching are ZDR-eligible. Flagged or legally required data can still be kept up to 2 years.
- Sources: <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data>, <https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training>, <https://platform.claude.com/docs/en/manage-claude/api-and-data-retention>

**Perplexity** [V public documents]:
- "Perplexity does not use Customer Content to train generative AI models."
- "Retention depends on the API, model, and account configuration, and Zero Data Retention (ZDR) is not the default."
- "ZDR is available only to eligible customers through an account-level configuration under a written agreement."
- "Do not assume that Perplexity or its model providers apply zero data retention."
- No default retention period is published. Note that a 2023 blog post ("deleted after 30 days") and an older FAQ wording ("zero day retention") are superseded by the current FAQ.
- Sources: <https://docs.perplexity.ai/docs/resources/privacy-security>, <https://docs.perplexity.ai/docs/resources/faq>

### B3. What needs owner or account confirmation [U]

1. **Anthropic ZDR.** The repo's own Privacy page states "we … do not have a separate zero-data-retention agreement with either company" (Anthropic, OpenAI) (`app/src/pages/Privacy.jsx:110-114`, last updated 2026-10-09). **So assume no ZDR: 30 days by default, up to 2 years if flagged.** The owner should confirm in the Console data-retention settings or the contract.
2. **Perplexity account retention.** The period is not published and ZDR is not the default. Confirm the account configuration and any written agreement.
3. Whether `ANTHROPIC_BASE_URL` is set in production. If it is, a proxy or gateway sits in the path with its own retention.
4. Whether the Anthropic organization or workspace has any non-default data-retention setting.

---

## C. Phased implementation plan (not implemented)

**Phase 0: decisions (no code).** The owner answers §E. The Privacy page gets an Agent entry drafted for review.

**Phase 1: stop writing raw text for new rows (non-destructive, reversible by revert). About 2.5 days.**
1. **Browser:** in `knowledge.js`, each `answerFrom*` returns `persist: {citation, kn: {pack_ts, schema_version, policy_version, items: [{kb_id|template, title≤140, source, excerpt_sha256_16, chars}]}}`. In `useAgent.js:663-690`, playbook.* answers record `outcome = citation` and `outcomeData.kn`, with **no `views`**. `setup.record` persists labels and n, no figures.
2. **Server door (authoritative):** in `routers/uct_agent.py:668-687`, any `outcomeData.actions` containing `playbook.` → replace `outcome` with a citation built server-side from `kn` (clipped to 200 chars), and drop `views` and `lines`. Mirror this in `store.add_turn` as defence in depth.
3. **Sentry:** a `before_send` rule that drops `request.data` and frame locals for `/api/agent/*`.
4. **Rails:**
   - A pytest that plants a sentinel string in a pack and runs the search, playbook, record, `/record`, `outcome_for_model`, `step_result_text` and `/search` paths. It fails if the sentinel appears in any `agent_turns` column, any caplog record (DEBUG), telemetry, or the Sentry `before_send` output.
   - A vitest that the playbook.* record body has no excerpt.
5. Rollback: revert the commit. Old rows are untouched.

**Phase 2: citation-only replay (non-destructive). About 1 day.**
- `turn.py:950-952`: a playbook.* row replays `[UCT answered from playbook: titles…]` only.
- Optional flag `UCT_AGENT_KN_REPLAY=rebuild`: rebuild from the pack by id when `pack_ts` and the excerpt hash match, otherwise say "superseded".
- `turn_v2` in-turn step results are unchanged: they are needed for the current answer and live in memory ≤ 600 s.
- The restore UI renders citations plus "Show again", which re-reads through `/api/agent/data` with no model call.

**Phase 3: 30-day transcript policy. Destructive, so it needs SEPARATE owner approval. About 2 days.**
1. **Dry run first:** `tools/agent_transcript_prune.py --db /data/uct_agent.db --days 30 --dry-run`.
   - It opens the DB read-only (`mode=ro`) and prints counts only: rows by role and age bucket, conversations that would become empty, and playbook.* rows. It never prints content.
   - The owner runs it, or approves the run.
2. **Backup / export before the first real run:**
   - The owner chooses either (a) an encrypted one-off export of rows to be deleted, held N days in R2 under the existing backup-encryption runbook (`docs/runbooks/backup-encryption.md`), or (b) no export, which is consistent with "retention not approved".
   - Record the choice in the PR.
3. **Prune job** (`api/services/uct_agent/retention.py`, scheduled daily, env `UCT_AGENT_TRANSCRIPT_DAYS=30`, **off by default**):
   - delete `agent_turns` older than N days;
   - delete conversations with no turns, and their `agent_conversation_state`;
   - `PRAGMA secure_delete=ON` for these deletes, then incremental vacuum.
   - Telemetry is kept 90 days. `agent_spend` is not touched.
4. **Rollback:**
   - Before the first run: unset the env (the job is a no-op).
   - After a run: restore from the Phase 3.2 export (if taken), or from a Railway volume backup (if one exists, [U]). Restore means a new volume plus re-mount, per the Railway docs.
   - Otherwise deletion is final, and that is the intended outcome.
5. **Backfill of existing playbook.* rows:** expected **0** rows (the Brain path never ran outside test). If any exist, run `tools/agent_scrub_knowledge_rows.py` with a dry-run count first and the same approval.

**Phase 4: account deletion (destructive for deleted accounts only; owner approval). About 1 day.**
- Purge the Agent tables by `user_id` in the account purge.
- Remove them from `KNOWN_UNPURGED`.
- Update `docs/account-deletion-manifest.md`.
- Add a test.

**Phase 5: documentation.** Add an Agent entry to the Privacy page (Anthropic and Perplexity, 30-day transcripts, no ZDR unless confirmed). This needs owner and legal review.

---

## D. Web research separation: can knowledge text reach Perplexity?

**Finding: yes, indirectly, by model-authored queries. No code path blocks it today [V].** No code path sends passage text to Perplexity directly: `_research` sends only `query[:400]` (`turn.py:993-1008`).

1. **v1, next turn.** A replayed playbook.* outcome row puts the excerpts into the model's history (`turn.py:950-952`). The model then writes `env.research.query` (`turn.py:1800-1822`, sent at `:1857` and `:1889`). Nothing stops it from pasting excerpt text into that query.
   - The existing blocks cover breadth and screener questions only (`turn.py:1806-1813`), plus local-lookup turns (`:1823`).
   - Forced research uses the member's own words (`:1815-1818`), which carry no knowledge text unless the member pasted some.
2. **v2, same turn.** After a playbook.* step, its framed result is in the tool loop (`turn_v2.py:216-218`). A later `research` tool call takes the model's `query` (`turn_v2.py:467-485`) and runs `_research` the same way. There is no knowledge check.
   - Bounds: one research call per turn (`state["researched"]`) and ≤ 400 chars.
3. **Perplexity-side copies of such a query:** the provider (§B2, period unknown), the in-process cache for 15 min (`perplexity_search.py:90-94`, `:626`), and the research answer replayed to the model and stored in the agent row's `citations` (URLs only, `routers/uct_agent.py:284`).
4. **What the builder's block-or-prove test should cover** (no code change here):
   - (a) Any turn whose history or state holds a playbook.* row or step → research refused, **or**
   - (b) the research query is checked against the turn's excerpts and refused on an overlap of ≥ N chars.
   - Cover both v1 (`turn.py:1800-1890`) and v2 (`turn_v2.py:405`, `:467`).
   - Phase 2 (citation-only replay) removes path 1 by construction. Path 2 needs (a) or (b).

---

## E. Questions for the owner

1. Approve the **general** Agent 30-day transcript policy and account purge separately from the **Brain** citation-only storage? (Recommended: yes to both.)
2. Confirm **Anthropic ZDR status.** The Privacy page says there is none. Is 30 days, or up to 2 years if flagged, acceptable for in-turn excerpts?
3. Confirm the **Perplexity account retention** setting or agreement.
4. Confirm the **Railway plan** (log retention) and whether **volume backups** are scheduled for the web volume.
5. Confirm whether **Sentry DSN** is set on web in production, and Sentry's retention.
6. Phase 3 export choice: an encrypted one-off export, or none?
7. Research in knowledge turns: refuse it outright (a), or allow it with an overlap check (b)?
