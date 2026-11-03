# KN-1 Retention Proposal: where Trading Brain knowledge text lands, and the smallest footprint that works

**Status:** DESIGN ONLY. Owner approval is required. Nothing here is implemented, switched on or deployed. No paid calls were made.
**Base:** `origin/agent/kn/knowledge-poc` @ `16b1a97839`. That is the PR #735 review-fix commit `668f9903ed` plus one board-only docs commit. All `file:line` references are to this tree.
**Scope:** the three knowledge kinds `knowledge.search`, `setup.playbook` and `setup.record`, which the browser exposes as the capabilities `playbook.explain`, `playbook.setup` and `playbook.record` (`app/src/agent/capabilities/knowledge.js:18`).

**Owner decisions this design works under (2026-11-03):**
- The model may see minimal, relevant, approved, team-owned excerpts. This is CONDITIONALLY approved for design and testing only: admin-only; provider terms verified; no third-party material; no restricted scores, credentials or private data; passages treated as untrusted data; only the excerpts needed; cost limits enforced.
- **Transcript retention is NOT approved.** Raw passages may not be persisted in transcripts, logs, traces or analytics. Use source IDs, version metadata and citations instead.

---

## 1. Inventory: what is written today when a playbook.* turn runs

### How a knowledge read flows today (both planners)

1. The model plans a `playbook.*` query, as a v1 op or a v2 step.
2. The browser calls `POST /api/agent/data`, which runs `gateway.read` (`api/routers/uct_agent.py:795`, `api/services/uct_agent/marketdata/gateway.py:179-240`). That returns an envelope:
   - `knowledge.search`: up to `k_max` = 3 passages, each `{kb_id, title, category, trader, source, licence, epoch, updated_at, excerpt}`. Each excerpt is at most `excerpt_chars` = 500 characters (`docs/agent/knowledge/policy.json:28`, `kinds.py:146-180`), and the whole passage list is at most `DATA_CHARS` = 1,900 characters (`kinds.py:29`, `:182-187`).
   - `setup.playbook`: up to 10 template fields of at most 600 characters each (`kinds.py:32`, `:340`, `:351-377`).
   - `setup.record`: figures, n, method, label and caution (`kinds.py:401-446`). This is not passage text, but it is restricted-score-adjacent.
3. The browser turns the envelope into text and a table (`knowledge.js:43-94`). `answerFromSearch` puts **every excerpt verbatim** into `text` (`knowledge.js:47-50`).
4. The executor records an `answered` outcome through `POST /api/agent/record` (`useAgent.js:663-690`). The record body is `outcome: text`, plus `outcomeData.views`, which holds the compacted presented view, again carrying the text (`present.js:149-165`).
5. **v1:** the next model request replays that stored outcome row through `outcome_for_model`. The text is framed but kept whole (`turn.py:939-953`; framing in `knowledge/frame.py`).
   **v2:** the same record body becomes the step result posted to `/api/agent/turn/step` (`steps.js:28-43`). The server puts it into the running tool-use loop through `step_result_text` (`turn_v2.py:198-219`). The browser's `record()` **also** posts the outcome row to `/api/agent/record`, because `v2TapRef` collects the body and the post still happens (`useAgent.js:494-504`). So v2 persists the same row as v1.

### Inventory table

| # | Store | What is written today for a playbook.* turn | Who can access | Retention | Evidence |
|---|---|---|---|---|---|
| 1 | **Model request, v1** (Anthropic API, `claude-haiku-4-5` by default) | The current turn holds no passage text: v1 queries run in the browser after the plan. **Later** turns replay the stored outcome row through `history_messages` → `outcome_for_model`. That is the full row text (≤ 4,000 characters) wrapped in `<uct_knowledge>…</uct_knowledge>` plus the RULE, for every playbook.* row within the last `HISTORY_TURNS`×3 = 36 rows. **Passage text is re-sent on every later turn of the chat.** | Provider (see §2) | Provider default: 30 days (§2) | `turn.py:64`, `:939-953`, `:956-990`; history read `routers/uct_agent.py:482-489` |
| 1b | **Model request, v2** | The step result `result: <uct_knowledge>{text}</uct_knowledge>` goes into the same turn's tool loop. Each step is ≤ `MAX_RESULT_CHARS` = 2,000 characters, with ≤ 12 steps and ≤ 8 data reads per turn. Later turns replay the outcome row as in row 1. | Provider | Provider default: 30 days | `turn_v2.py:36-38`, `:194-219`; `gateway.py:52` |
| 1c | **Model request: naming call** | Up to 16 member and agent rows, each ≤ 400 characters. Agent **reply** text can quote excerpts. Outcome rows are not sent. | Provider | 30 days | `turn.py:1262-1286` |
| 1d | **Prompt cache** | System blocks are marked `cache_control: ephemeral`. History rows are not cached blocks. | Provider | KV cache in memory for the cache TTL (§2) | `turn.py:1706`, `:1759` |
| 2 | **`agent_turns`, outcome row** (`/data/uct_agent.db`) | `text`: the full answer text, **all excerpts verbatim** (`• title: excerpt (source · trader · posted …)`), ≤ 4,000 characters (`MAX_TEXT`). `data_json`: `{kind:'answered', actions:['playbook.explain'], views:[…]}`, where `views` holds the same text again (view budget 9,000×1.5/n characters; the row cap is 20,000 characters). For `playbook.setup` it is every template field. For `playbook.record` it is the figures with n, label and method. | The member who owns the chat (`require_admin_dark` = admins only while dark). There is **no** admin cross-user read route. | **Indefinite.** No TTL and no cleanup job. Deleted only when the member deletes the chat. | `store.py:36`, `:48-56`, `:155-207`; `routers/uct_agent.py:668-687`; `useAgent.js:674-690`; `present.js:149-165` |
| 3 | **`agent_turns`, agent row** | The model's reply, ≤ 4,000 characters. **It can quote or paraphrase excerpts.** `data_json` holds the envelope. For v2 that is `steps[{id,action,target,mode,status}]` with **no** results, plus `citations` (web URLs). | Same as row 2 | Indefinite | `routers/uct_agent.py:282-285`, `:597`; `turn_v2.py:263-278` |
| 4 | **`agent_turns`, member row** | The member's own words: the question, not passage text | Same as row 2 | Indefinite | `routers/uct_agent.py:538`, `:677` |
| 5 | **History search** `GET /api/agent/search` | `LIKE` search over `agent_turns.text` across the member's own chats, so **passage text is searchable** and returned in hits | The member (admin while dark) | Same as row 2 | `store.py:322-338`; `routers/uct_agent.py:768-771` |
| 6 | `agent_conversation_state` | Only `lastScreen`, a validated screener state. **No knowledge text.** | Owner | Indefinite | `store.py:76-85`, `:281-301`; `routers/uct_agent.py:745-765` |
| 7 | `agent_telemetry` | Content-free: path, disposition, action **names** (e.g. `playbook.explain`), flags, latency, model and cost. **No text.** | Server code only. `telemetry_rows` has no route in this tree. | Indefinite (no TTL) | `store.py:58-74`, `:371-404` |
| 8 | `agent_spend` / `agent_requests` | Spend ledger: tokens, USD, category and outcome. `agent_requests` holds a `message_hash` of the member's message, **not** knowledge text. | Server; `/api/agent/budget` returns aggregates only | `agent_spend` indefinite; `agent_requests` pruned after 24 h | `budget.py:108-136`, `:202`, `:661-665` |
| 9 | **Server logs** (Railway) | **No passage text found.** Knowledge logs carry counts and exception type names only: `index.py:117`, `:122`, `:125`, `:169`; `kinds.py:474`; `gateway.py:205`, `:223`, `:227`. Turn logs carry shapes and lengths only: `turn.py:1228`, `:1349`, `:1357`, `:1614`. **The one gap:** `gateway.py:227` logs MD-1 envelope validation errors, whose wording is not audited for content. There is also no test rail that fails if passage text reaches a log. | Railway project members | Railway log retention (plan-dependent, not verified) | greps listed |
| 10 | **In-process memory** | v2 paused turn state `_V2_PAUSED`: the whole message list including step results, for ≤ 600 s (`PAUSE_TTL_S`). Also the step queue `_V2_STEPS`, and the index connection. | Process only | ≤ 10 min; lost on restart | `routers/uct_agent.py:206`, `:268-274`; `turn_v2.py:39`, `:444` |
| 11 | **`health.py` report** `/data/agent_knowledge_health.json` | **Counts only:** pack version, index stats, coverage by state, licence, source and category, statistics freshness, source labels. No passage text. | Server / anyone with volume access | Overwritten at every index build | `knowledge/health.py:1-85` |
| 12 | Knowledge **source** stores: the pack `<brain_dir>/data/uct_intelligence.db` and the FTS index `/data/agent_knowledge_index.db` | The approved corpus itself, the system of record. This is not transcript retention. | Server | Replaced at pack install and reindex | `knowledge/pack.py:26-27`; `knowledge/index.py:38-39` |
| 13 | **Browser storage** | `localStorage` holds only the conversation **id** (`uct.agent.conversation`), the open flag, and the in-flight *apply* plan lines (`uct.agent.inflight`; queries are never marked). `sessionStorage` is used only by indicator drafts. **No IndexedDB** in `app/src/agent`. Knowledge text lives in React state and is **re-fetched from the server** (row 2) when a chat is restored. | The member's browser | Tab / page lifetime | `agentFlag.js:16-24`, `:64-68`; `useAgent.js:354`, `:391`, `:833`; `capabilities/indicatorAuthoring.js:55-57` |
| 14 | **Analytics / tracing** | None found in `app/src/agent`: no Sentry, PostHog, gtag or sendBeacon. `trace.js` is in-memory timing only, and `turnOutputMs()` sends one number in telemetry. | n/a | n/a | grep; `app/src/agent/trace.js`; `useAgent.js:498-499` |
| 15 | **Backups** | `uct_agent.db` is **not** in `store_backup.STORES` or `COVERED_ELSEWHERE`, so there is no app-level backup of transcripts. Railway volume snapshots are platform-side and **not verified**. | n/a | n/a | `api/services/store_backup.py:91-119` |
| 16 | **Account deletion** | All agent tables are listed as `UNPURGED member data: uct_agent store`. **Deleting an account does not delete Agent transcripts.** | n/a | n/a | `tests/test_alert_erasure.py:487-493`; `docs/account-deletion-manifest.md:339-342` |
| 17 | Web research (Perplexity) | Only if the model writes a research query (≤ 400 characters, model-authored). Excerpts are not sent by code, but a model could paste one into a query. | Perplexity | Their terms | `turn.py:999-1015` |

**Key findings:**

- Today, raw passage and template text is **persisted** in two places:
  - `agent_turns.text` (outcome row)
  - `agent_turns.data_json.views` (the same text again)
- It can also be persisted, as model quotes or paraphrase, in agent reply rows.
- It is **re-sent to the provider on every later turn of the chat** (history replay), not only on the turn that needed it.
- It is **searchable** through `/api/agent/search`.
- It is kept **indefinitely**: there is no TTL, and account deletion does not purge it.
- Logs, telemetry, health, spend and browser storage are already content-free, but nothing tests that they stay that way.

---

## 2. Provider-side facts (Anthropic API)

**What the official sources say, fetched 2026-11-03:**

- **Default retention:** "For Anthropic API users, we automatically delete inputs and outputs on our backend within 30 days of receipt or generation."
  - Exceptions: longer-retention services under the customer's control (e.g. the Files API); separately agreed terms (e.g. ZDR); Usage Policy enforcement; and legal requirements.
  - Content flagged for a Usage Policy violation: inputs and outputs are kept **up to 2 years**, and trust and safety classification scores **up to 7 years**.
  - Feedback submissions are kept 5 years.
  - Source: <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data>
- **Training:** "By default, we will not use your inputs or outputs from our commercial products" to train models. The exceptions are explicit feedback or bug reports, or an opt-in. Source: <https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training>
- **Zero data retention (ZDR):** "Under a ZDR arrangement, Anthropic does not store customer prompts or responses at rest after the API response is returned."
  - It is requested through the Anthropic sales team and enabled per organization.
  - The Messages API and prompt caching are ZDR-eligible. For prompt caching, "KV cache representations and cryptographic hashes are held in memory for the cache TTL and promptly deleted after expiry."
  - Even under ZDR, data flagged by trust and safety systems or required by law may be kept up to 2 years.
  - Source: <https://platform.claude.com/docs/en/manage-claude/api-and-data-retention>

**What is and is not verified for THIS account:**

- **Verified:** the Agent calls the first-party Anthropic API (`turn.py:81`, default `claude-haiku-4-5`) using the Messages API with prompt caching. Both are ZDR-eligible features.
- **Not verified:** whether this organization has a ZDR agreement or any custom terms. I cannot see the contract or the Console data-retention settings. **Until the owner confirms otherwise, assume the 30-day default:** every excerpt sent to the model is held by Anthropic for up to 30 days, or up to 2 years if flagged.
- This is why minimising what reaches the model, especially the history replay, matters as much as local retention.

---

## 3. Proposed minimal-retention policy

**P1. Model request: only the excerpts needed.**
- `knowledge.search` caps stay as they are: ≤ 3 passages, ≤ 500 characters each, ≤ 1,900 characters per read.
- New cap: **≤ 2 knowledge reads per turn** and **≤ 3,000 knowledge characters per turn** across all playbook.* steps. Template fields stay ≤ 600 characters each; `setup.playbook` is ≤ 1,900 characters in total.
- No knowledge text goes to the naming call. An agent reply that quotes an excerpt is still sent today, so see P2 and Q4.
- **Replay never re-sends a passage by default** (see P3).

**P2. Persisted transcript rows hold citations, not text.** For a playbook.* outcome row:
- `text` is a short citation line only, ≤ 200 characters. Examples: `Answered from UCT's playbook (3 passages): "Title A"; "Title B"; "Title C"`, or `UCT setup template: <name>`.
- `data_json` is `{kind, actions, kn: {pack_ts, schema_version, policy_version, items: [{kb_id | template, title ≤ 140, source label, excerpt_sha256 (first 16 hex), excerpt_chars}]}}`.
- **No `views` holding text.** The view stored for restore is the citation list plus the link.
- `setup.record` stores `{setup, regime, labels, n}` and **no figures**, so that restricted scores do not persist (Q3).

**P3. History replay rebuilds from the pack, or says the content was superseded.** `outcome_for_model` for a playbook.* row:
- **Default:** replay **only the citation line** (`[UCT answered from playbook: titles…]`). No text is re-sent.
- **Optional, behind a flag, only if the owner wants follow-ups to see the text:** rebuild each item from the pack by `kb_id` or template name. Only when the current pack's `pack_ts` matches **and** the rebuilt excerpt's hash matches is the text re-framed in `<uct_knowledge>`. Otherwise replay `(superseded: the pack changed since this answer)`.
- A model that needs the text again simply calls `playbook.explain` again. This is cheaper in retention and keeps the provider copy to a single turn.

**P4. Telemetry: counts only.** Add `kn_reads`, `kn_passages` and `kn_chars` integers to the telemetry row. Never titles or text. `agent_spend` is unchanged.

**P5. Logs: no passage text, enforced by a test rail.**
- Add a pytest that runs `search`, `playbook`, `record`, `outcome_for_model`, `step_result_text` and the `/record` route with a sentinel string in the pack. Using `caplog` at DEBUG, it fails if the sentinel appears in any log record.
- `gateway.py:227` logs the validation error *codes* only.

**P6. Browser: the text is shown in-session only.**
- The live panel renders the full answer from React state. It is never written to local or session storage (already true).
- After a reload, a restored playbook.* turn renders the citation list with **"Show again"**, which re-reads through `/api/agent/data` using a new turn id. That read counts against the read cap and makes no model call.

**P7. Retention period for `agent_turns`.**
- Recommended: **30 days** from `created_at` for all Agent transcript rows while dark. That matches the provider window and the owner's caution. Telemetry and spend: 90 days.
- Implement this as a daily prune: `DELETE FROM agent_turns WHERE created_at < ?`, then delete empty conversations and their state rows, then `PRAGMA incremental_vacuum` or a periodic `VACUUM`. Also set `PRAGMA secure_delete=ON` so freed pages are zeroed.
- Separately, purge any existing playbook.* rows written during testing (one-shot, admin only).

**P8. Deletion path.**
- (a) The member deletes a chat: already a hard delete (`store.py:261-271`). Add secure_delete.
- (b) **Account deletion:** move the agent tables from `KNOWN_UNPURGED` to the purge (`purge_user`-style, keyed on `user_id`).
- (c) An owner-run `tools/agent_purge_knowledge_rows.py` deletes or scrubs rows whose `actions` contain `playbook.`.
- (d) Backups: none exist today. **Keep `uct_agent.db` out of `store_backup`** unless the owner decides otherwise, because a backup would extend retention past P7.

---

## 4. Code changes needed (design only, not implemented)

| Area | File / function | Change | Estimate |
|---|---|---|---|
| Browser answer to stored row | `app/src/agent/capabilities/knowledge.js` (`answerFromSearch`, `answerFromPlaybook`, `answerFromRecord`) | Return `{text (display), persist: {citation, kn}}`. `persist` carries ids, titles, the excerpt hash (Web Crypto SHA-256) and the pack version from `env.coverage`. | 0.5 d |
| Browser record | `app/src/agent/useAgent.js:663-690` | For queries with `persist`, set `outcome` = citation and `outcomeData.kn` = metadata, and drop `views` for those answers. A generic hook: a capability flag such as `persist: 'citation'`. | 0.5 d |
| v2 step result | `app/src/agent/steps.js` `outcomeOf` | Keep sending the display text as the step `result` (in-turn need), but the recorded row uses the citation. The step result still lands in `_V2_PAUSED` memory for ≤ 600 s, which is acceptable. | 0.25 d |
| Restore UI | `app/src/agent/present.js` `itemFromTurn` / `viewsOf` | Render a playbook.* row as a citation list plus a "Show again" re-read. | 0.5 d |
| Server door | `api/routers/uct_agent.py:668-687` `agent_record` | **Server-side enforcement:** if `outcomeData.actions` contains `playbook.*`, replace `outcome` with the citation built from `outcomeData.kn` and drop `views` and `lines`. This defends against old browsers. | 0.5 d |
| Server door | `api/services/uct_agent/store.py` `add_turn` / `_data_json` | A guard used by row writes that strips `views` and `lines` and clips `text` to 200 characters for playbook.* actions. Add `secure_delete` to `_connect`. | 0.25 d |
| Replay | `api/services/uct_agent/turn.py:939-953` `outcome_for_model` | Replay the citation only; with an optional flag, rebuild from the pack plus a hash check (a `knowledge/rebuild.py` helper that uses `index` and `kinds._clean_value`). | 0.5–1 d |
| Per-turn cap | `api/services/uct_agent/marketdata/gateway.py` (`_turn` counters) | A `kn_reads ≤ 2` per turn counter for the three knowledge kinds, plus a `kn_chars` budget. | 0.25 d |
| Telemetry | `store.py:371-394` + schema migration | `kn_reads`, `kn_passages` and `kn_chars` integer columns. | 0.25 d |
| Retention job | new `api/services/uct_agent/retention.py` + scheduler registration | A daily prune (P7), env-tunable `UCT_AGENT_TRANSCRIPT_DAYS=30`, plus incremental vacuum. | 0.5 d |
| Account purge | `api/services/account_purge.py` + `tests/test_alert_erasure.py` `KNOWN_UNPURGED` | Purge the agent tables by `user_id`. | 0.5 d |
| Rails | `tests/test_agent_kn_retention.py` (new) | The sentinel never appears in: an `agent_turns` row, `data_json`, the `/search` results, logs (caplog DEBUG), telemetry, or replay (unless the flag is set and the hash matches). Plus a superseded-pack replay test and a prune test. Browser: a vitest that the record body for playbook.* has no excerpt. | 1 d |
| One-shot scrub | `tools/agent_purge_knowledge_rows.py` | Dry-run by default, owner-run. | 0.25 d |

**Total:** about **5–6 engineer-days**, including rails. It needs no new dependency and no paid calls; tests use fake callers.

---

## 5. Open questions for the owner

1. **Provider terms:** does this Anthropic organization have a ZDR agreement? If not, is the 30-day default (and up to 2 years if flagged) acceptable for the excerpts sent in-turn? This is a precondition of the conditional approval.
2. **Replay:** should follow-up turns see the passage text again (P3 option B, with a pack rebuild and hash check)? Or is the citation-only replay (default A) enough, with the model re-reading when it needs to?
3. **`setup.record` figures:** do win rates, intervals and z-scores count as "restricted scores"? If yes, should they also be withheld from the model, not only from storage?
4. **Agent reply rows:** the model's own reply can quote an excerpt and is stored for ≤ 4,000 characters. Options:
   - (a) accept this, bounded by P7 retention;
   - (b) store a reply that cites knowledge as a hash plus citations only, so the member loses the reply text after reload;
   - (c) a server-side check that elides any ≥ 40-character overlap with the turn's excerpts before storing.
5. **Transcript retention period:** 30 days for all Agent rows, or only for playbook.* rows? Should account deletion purge the Agent store (recommended yes)?
6. **Railway log retention and volume snapshots:** confirm the plan's log retention, and whether volume backups exist for the web volume. Neither is visible from the repo.
7. **Perplexity:** should research be disabled in any turn that already read knowledge, so a model cannot paste an excerpt into a third-party query?
