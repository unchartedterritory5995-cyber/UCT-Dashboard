# Transcript retention as code, switched OFF (Track C safeguards c and d)

Status: 2026-11-04, branch `agent/kn/retention-flag`. **Transcript retention is not approved (owner 2026-11-03).**
This is code ready for the owner's decision. Both switches default OFF, and with them unset `store.add_turn` writes
exactly what it wrote before (tested). Brain (`UCT_AGENT_KNOWLEDGE`) stays OFF. Design: PR #748
(`RETENTION-PROPOSAL.md`).

## What is implemented (`api/services/uct_agent/retention.py`, one hook in `store.add_turn`)

| #748 item | Switch | Behaviour when ON |
|---|---|---|
| P2: citations, not text | `UCT_AGENT_KN_RETENTION=1` | A Trading Brain answer row (an outcome row whose `actions` include `playbook.*`) is stored as one citation line, e.g. "Answered from UCT's approved knowledge base (UCT KB #2, #12).", plus `{kind, actions, kn: {kb_ids, templates, setups, policy_version, stored: "citation_only"}}`. The answer text, its views and lines, and any record figures are never written, so they are not kept, not found by `/api/agent/search`, and not re-sent. Enforced on the server for every writer, old browsers included. |
| P7: transcript age limit | `UCT_AGENT_TRANSCRIPT_DAYS=N` (**30**–3650; review #794 B2: a lower value is refused, logged, and the switch stays off) | Unpinned transcript rows older than N days are deleted at most once an hour. A write starts the prune, but it runs on a **background thread**, in batches of 500 rows, each batch under the store's write lock and committed on its own (no long lock, no request waiting on it). It runs with `secure_delete`, an index on `created_at` and a `wal_checkpoint(TRUNCATE)` afterwards; both run under the store's write lock (review #794). The index is created by the prune, never by the store schema, so nothing changes while the switch is off; the checkpoint runs afterwards so deleted text does not linger in the `-wal` file. Empty unpinned conversations older than N days and their state rows go too. **Pinned chats are exempt** (review #794 B3, an owner decision; the default keeps them). With the switch off nothing runs and no connection is opened. |
| P3: no text in replay | (already true) | History replay never re-sends knowledge text (`turn.KNOWLEDGE_REPLAY`, `frame.REPLAY_STUB`). A citation row replays the same way (tested). |
| P5: no passage text in logs | (test rail) | `test_no_passage_text_reaches_a_log_record`: a sentinel in an answer never appears in any log record (DEBUG), with the switches on and off. |

**Not retroactive:** `UCT_AGENT_KN_RETENTION` changes only rows written after it is switched on. Rows written before keep
their text until the age limit (P7) or a one-shot scrub (#748 P8c, not built) removes them.

**Owner decision B3:** should pinned chats be pruned too? The code exempts them until the owner decides.

**Not implemented (owner decisions, #748 Q5 / P8):**
- telemetry and spend retention periods;
- purging the Agent store on account deletion (that is shared account-purge code, `KNOWN_UNPURGED`);
- the browser "Show again" re-read after a reload (P6).

**Recommendation when the owner decides:** `UCT_AGENT_KN_RETENTION=1` before Brain is ever on; `UCT_AGENT_TRANSCRIPT_DAYS=30`
if the owner approves a 30-day transcript period.

## Tests
`tests/test_uct_agent_retention.py` (26):
- off-by-default identity;
- switch parsing;
- citation rows for a passage answer, a template answer and a setup record (no figures);
- other rows untouched;
- search finds no passage text;
- citation-row replay;
- a bounded citation line;
- the prune (off by default; deletes only old rows and empty old chats; at most once an hour; a failure never fails the write);
- the log rail.

## Owner-only provider and retention checks (safeguard d; status 2026-11-04)
The steps are in `RETENTION-VERIFICATION-2026-11-04.md` §6 (PR #748). They need the owner's own accounts; no session has
done them.

| Check | What | Status |
|---|---|---|
| A1 | Which Anthropic org / workspace owns the production key | OPEN (owner) |
| A2 | Console data-retention settings: ZDR / custom retention, HIPAA card, Development Partner Program not joined | OPEN (owner) |
| A3 | ZDR in the contract (contract-only) | OPEN (owner) |
| P1 | Perplexity API group and any retention indicator | OPEN (owner) |
| P2 | Any signed order form / DPA with Perplexity | OPEN (owner) |
| P3 | Ask `api@perplexity.ai` for the retention period and ZDR | OPEN (owner) |
| R1 | Railway non-expiring "Online resize" backups: keep or delete | OPEN (owner) |
| R2 | Railway HTTP logs: does `/api/agent/search` keep `?q=`? | OPEN (owner) |
| R3 | Cloudflare Logpush jobs | OPEN (owner) |
| S1 | Sentry org / historical events; do not set `SENTRY_DSN` on web until the scrub ships | OPEN (owner) |

Activation of Brain stays blocked on these together with the source-rights and calculation-date safeguards.

Concurrency (review #794): writers running during a batched prune all succeed and nothing they write is lost (`test_review794_concurrent_writes_during_a_prune_all_succeed`); the index and the checkpoint run under the write lock; with the switch off no schema changes.
