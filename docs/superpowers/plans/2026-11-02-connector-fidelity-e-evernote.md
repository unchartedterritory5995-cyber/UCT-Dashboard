# Plan E: Evernote live sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dark, flag-gated Evernote connector that keeps a member's paid Evernote account synced one way into the UCT Notebook through Evernote's hosted MCP server. It uses the shared note-connector engine, adopts notes the member imported earlier from `.enex`, and never overwrites a member's edit.

**Architecture:** `providers/evernote.py` sits behind `registry.py`, the only door to a provider, and speaks to `https://mcp.evernote.com/mcp` through a small JSON-RPC client (`evernote_mcp.py`). That client can call only an explicit allow-list of read tools. OAuth is a public client: PKCE S256, `resource=https://mcp.evernote.com`, scope `read`, and a rotating refresh token persisted by compare-and-swap (`evernote_oauth.py`). ENML is converted server-side by `convert/enml.py`, a pre-pass into the existing `mddoc.html_to_tiptap` walker. A cross-lane parity rail pins it against the client `.enex` adapter. Attachments go through the existing Plan A media path (`fetch_media` → `normalize_media`/`store_media`, the 25 MB cap, the member cap, `importNotice`).

**Tech Stack:** Python 3 / FastAPI / httpx 0.28.1 (already pinned) / stdlib `html.parser`; React + vitest for the tile and the JS half of the parity rail. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-11-01-connector-fidelity-and-evernote-design.md`, sections 6 (E1), 7, 12 and 15 Q3. Measured API facts come from `docs/notebook-connectors/evernote-mcp-probe.md` and `docs/notebook-connectors/evernote-probe-2026-11-02/tools_list.json`, the raw schemas. Read both before Task 1.

**Amended (pre-flight):** this plan was amended on 2026-11-02 after the pre-flight scan in `.superpowers/sdd/2026-11-02-connector-fidelity-e-evernote/progress.md` ("## Pre-flight scan", section (d)). Every changed passage starts with "Amended (pre-flight):". Where an amended passage and an older sentence disagree, the amended passage wins.

## Global Constraints

- Branch off `origin/master` (Plans A, B and D are merged there: `media_policy.normalize_media`, `import_provenance.edited_since_import`, `import_notice`, the Plan D removal check). Use worktree `uct-worktrees/connector-evernote`. Run one implementer at a time and focused test files only, never whole directories (PC load rule).
- Amended (pre-flight): **Branches and PRs.** There is one working branch, `feat/connector-fidelity-e-evernote`, and two PRs:
  - **PR E1 (server, dark)** is opened from `feat/connector-fidelity-e-evernote`. It carries Tasks 1-9 and 11.
  - **PR E2 (tile)** is opened from `feat/connector-fidelity-e-evernote-tile`, a follow-up branch cut from `feat/connector-fidelity-e-evernote` after E1 merges. It carries Task 10 only. Task 10 is never committed on the E1 branch.
- Amended (pre-flight): **Plan C lands first.** Plan C (branch `feat/connector-fidelity-c-server`) merges to master before E1. Before E1's PR is opened, rebase `feat/connector-fidelity-e-evernote` onto master after Plan C merges (Task 11, Step 0). Six files are edited by both plans; the resolutions are listed in Task 11, Step 0. Task 4's parity rail runs through Plan C's `convert.js::htmlToNote`, so Task 4 does not commit until Plan C's `convert.js` is on the base. If Plan C has not merged when Task 4 starts, rebase onto `feat/connector-fidelity-c-server` first and regenerate the fixtures after the final rebase.
- MCP endpoint `https://mcp.evernote.com/mcp`. Auth server `https://accounts.evernote.com`: `/auth/register`, `/auth/authorize`, `/auth/token`. `resource=https://mcp.evernote.com`, `scope=read`, `token_endpoint_auth_method: none`, `code_challenge_method=S256`. Header `MCP-Protocol-Version: 2025-06-18`.
- Production callback: `https://uctintelligence.com/api/j2/notes/connectors/evernote/callback`. It is derived by the existing `oauth._redirect_uri("evernote")`, never typed a second time.
- Measured tool shapes, used verbatim:
  - `search_notes{query, clientTimeZone, maxResults 1-100, startIndex, sortBy ∈ updated|created|relevance|title, ascending}` returns `structuredContent {hits[{noteId,title,snippet,createdAt,updatedAt,score}], totalResultCount, startIndex, isLastPage}`. An empty `query` returns active notes only; `intrash:true` returns trash only.
  - `get_note{noteId}` returns `structuredContent.content` (ENML) and `structuredContent.resources[] {id, hash, mime, name, sizeBytes}`. `noteId` also accepts an `evernote:///view/…` link.
  - Amended (pre-flight): the measured `get_note.structuredContent` keys are `id, title, version, updateSequenceNumber, notebookId, content, created, updated, active, deleted, tasks, tags, resources, attributes`. The plan reads exactly these names: `notebookId`, `tags`, `created`, `updated`, `attributes`, `resources`. **`resources` is `null`, not `[]`, on a note without attachments**, and every consumer treats `null` as an empty list. Not measured: the element type of `tags` and the keys inside `attributes`. Code accepts both a string and an object carrying a name or guid there, and the live gate records the real shapes (Task 11).
  - `get_attachment{noteId, hash /^[0-9a-f]{32}$/}` returns `{downloadUrl, expiresAt, mimeType, filename, sizeBytes}`. `downloadUrl` is a pre-signed `storage.googleapis.com` link that needs no auth header.
  - Amended (pre-flight): the measured `get_attachment.structuredContent` keys are `downloadUrl, expiresAt (epoch ms), noteId, resourceGuid, hash, mimeType, filename, sizeBytes`. The plan uses `downloadUrl, expiresAt, mimeType, filename, sizeBytes`. The download host is exactly `storage.googleapis.com` (path-style, as measured). **Every redirect hop** must stay on that host, not only the first request.
  - Amended (pre-flight): `search_notebooks{query, maxResults, sortBy, defaultOnly}` returns `hits[{notebookId,label,stack,…}]`. It has **no `startIndex`** and `maxResults` is at most 100, so it cannot page. One call with `maxResults: 100` is the whole listing.
  - Amended (pre-flight): `search_tags{query, maxResults, sortBy}` returns `hits[{tagId,label,…}]`. It has **no `startIndex`** and `maxResults` is at most 100, so it cannot page. One call with `maxResults: 100` is the whole listing.
  - Amended (pre-flight): when either listing returns exactly 100 hits, the provider logs a warning (`evernote notebooks listing hit the 100 cap` or `evernote tags listing hit the 100 cap`) and falls back to discovering notebooks and tags from the notes' own `notebookId` and `tags` (Task 5).
  - Amended (pre-flight): `search_notes` hits carry `createdAt` and `updatedAt` as `string or null`. A null is handled by a stated rule (Task 5), never a crash.
- Read tools only. `READ_TOOLS = {"search_notes","get_note","get_attachment","search_notebooks","search_tags"}`. Every tool in `tools_list.json` whose `annotations.readOnlyHint` is false must be refused before it reaches the network.
- Access tokens last 3600 s. **The refresh token rotates on every refresh**: persist the new one atomically, encrypted with `crypto_box.NoteBox` exactly like every other connector token.
- Flag `NOTE_SYNC_EVERNOTE_ENABLED`: unset/`0` = off, `admin` = admins only (the owner), `1` = every paid member. It is recorded `dark` in `docs/feature_flags.json` and defaults OFF.
- The 2-strike delete rule, the <50% enumeration refuse guard and the 20%/pass cap are unchanged. Trashed notes are tagged `source-deleted` and never erased.
- One predicate decides "edited since import": `import_provenance.edited_since_import`. No new copy of it.
- Amended (pre-flight): one ISO timestamp parser. `git grep` finds `import_provenance._instant(value) -> datetime | None` (ISO string, any offset, `Z`, naive read as UTC). Task 5 makes it public as `import_provenance.instant` and every new ISO parse in this plan (Task 5 `_iso`, Task 8 adoption matching) calls it. No second ISO parser is written. Epoch milliseconds are converted at the provider boundary the way `providers/roam.py::_epoch_ms_to_iso` does.
- Amended (pre-flight): **sync-log outcomes.** The engine persists per-pass counts in `j2_note_sync_log` through `engine._finish_log` (`notes_created`, `notes_updated`, `notes_skipped`, `media_uploaded`, `conflicts`, `source_deleted`, `failures_json`). The router's `_ZERO_COUNTS` (`api/routers/note_sync.py:309`, not engine.py) feeds `/status` `counts`, whose exact key set is pinned by `tests/test_note_sync_router.py:1239`. So the adopted count follows the `source_deleted` precedent: a new nullable `adopted INTEGER` log column, written by `_finish_log` and returned by `GET /sources/{id}/log` (Task 8). `_ZERO_COUNTS` and `/status` `counts` do not change. Per-note Evernote failures reach `failures_json` in Plan D's shape `{noteTitle, reason, name}` (Task 5 and Task 8), as well as the `failures` strings of the sync result and the log row's `error`.
- Engine bookkeeping writes stay timestamp-neutral: they never bump `updated_at`.
- Copy rules: no emoji (UIcon only). Wherever a sentence in the UI sits next to a provider name, the provider label comes from `NOTE_CONNECTOR_PROVIDERS`.
- `requirements.txt` does not change, so no `UCT_FLOW_OVERRIDE` step is needed and a merge is allowed at any hour. Still run `python tools/flow_worker_watch_coverage.py` on the PR and classify any red (note sync runs on `web` only).

## Review Focus

1. **An Evernote edit while the full listing pages.** `sortBy:"updated"` offsets shift when a note is edited mid-enumeration, so a note can be skipped and then struck as "missing". Expected: the listing notices the count mismatch, re-enumerates once, and otherwise raises, so the engine runs no removal check that pass. Test: Task 5 `test_present_refs_reenumerates_once_when_ids_do_not_match_total`.
2. **An expired pre-signed URL on a media retry.** `downloadUrl` is short-lived, and a retry must never reuse a stored one. Expected: every `fetch_media` call asks `get_attachment` again. Test: Task 5 `test_fetch_media_asks_for_a_fresh_url_every_attempt`.
3. **The member reconnects while a background refresh is in flight.** Expected: the reconnect's tokens win, and the refresher never writes over them. Test: Task 2 `test_refresh_never_overwrites_a_reconnect`.
4. **A `.enex` note the member trashed in UCT.** Adoption must not resurrect it. Expected: a trashed note is never a candidate, and the live note imports as new. Test: Task 8 `test_trashed_file_note_is_never_adopted`.
5. **Titles with surrounding whitespace, and created times in different zone spellings** (`Z` in the `.enex`, an offset or milliseconds in MCP). Expected: titles are matched after a Python `.strip()` (the client already stores `pyStrip`), and times are compared as UTC instants floored to the minute. Test: Task 8 `test_adoption_matches_stripped_title_and_zone_spellings`.

---

## File map

| File | Responsibility |
|---|---|
| `api/services/journal_two/note_connectors/evernote_mcp.py` (new) | Streamable-HTTP JSON-RPC client: session, SSE, retries and backoff, read allow-list |
| `api/services/journal_two/note_connectors/evernote_oauth.py` (new) | DCR helper, PKCE, code exchange, rotating refresh with compare-and-swap |
| `api/services/journal_two/note_connectors/connections.py` (modify) | `swap_token_if_unchanged`, plus one private encrypt helper shared with `upsert_connector` |
| `tools/evernote_register_client.py` (new) | One-time DCR at deploy; prints `EVERNOTE_CLIENT_ID` |
| `api/services/journal_two/note_connectors/convert/enml.py` (new) | ENML → normalized HTML pre-pass → `mddoc.html_to_tiptap`; note-link keys |
| `api/services/journal_two/note_connectors/convert/enml_fixtures_in/` (new) | Shared ENML parity inputs (`*.enml` + `*.note.json`) |
| `api/services/journal_two/note_connectors/convert/enml_parity_fixtures_gen.py` (new) | Writes `app/.../__fixtures__/enml_parity/*.json` |
| `app/src/pages/journal-2-0/lib/importer/enmlParity.contract.test.js` (new) | JS half of the parity rail |
| `api/services/journal_two/note_connectors/providers/evernote.py` (new) | `EvernoteProvider` |
| `api/services/journal_two/note_connectors/registry.py` (modify) | Evernote entry, flag modes, optional `refresh` hook |
| `api/services/journal_two/note_connectors/engine.py` (modify) | `_resolve_credentials` uses the registry `refresh` hook; the adoption seam; the `adopted` count |
| `api/services/journal_two/note_connectors/adoption.py` (new) | `.enex` → live adoption (spec 15 Q3) |
| `api/routers/note_sync.py` (modify) | Evernote connect/callback (PKCE), per-user flag gate, plan-required reason |
| `docs/feature_flags.json` (modify) | `NOTE_SYNC_EVERNOTE_ENABLED` dark |
| `api/services/journal_two/note_connectors/corpora/evernote_live_messy.json` + `corpora_gen.py` (modify) | Messy live corpus through the real engine |
| `app/src/pages/journal-2-0/hooks/useNoteConnectors.js`, `components/connectors/{ConnectedAppsCard,ConnectConsentPanel}.jsx`, new `evernoteCopy.js`, `tabs/NotebookTab.jsx` | The honest tile |
| `docs/notebook-connectors/evernote-live-gate.md` (new) | Owner gate runbook + support email |
| Amended (pre-flight): `app/src/pages/journal-2-0/lib/importer/adapters/evernote.js` (modify, Task 4) | Client code-block rule matching the server's rule 9 |
| Amended (pre-flight): `api/services/journal_two/note_connectors/providers/base.py` (modify, Task 5) | Optional `allowed_host` on `guarded_media_get`/`guarded_media_stream`, checked before every hop |
| Amended (pre-flight): `api/services/journal_two/import_provenance.py` (modify, Task 5) | `_instant` made public as `instant`, the one ISO parser |
| Amended (pre-flight): `api/services/journal_two/db.py` (modify, Task 8) | Nullable `j2_note_sync_log.adopted` column (both CREATE blocks + the ALTER list) |
| Amended (pre-flight): `api/routers/note_sync.py` (modify, Tasks 7 and 8) | Task 8 adds `adopted` to `GET /sources/{id}/log` rows only |
| Amended (pre-flight): `docs/notebook-connectors/RESUME-connector-fidelity.md` (create or append, Task 11) | Plan E state + owner click points |

---

### Task 1: MCP client with a read-only allow-list

**Files:**
- Create: `api/services/journal_two/note_connectors/evernote_mcp.py`
- Test: `api/services/journal_two/test_note_connectors_evernote_mcp.py`

**Interfaces:**
- Produces:
  - `MCP_URL = "https://mcp.evernote.com/mcp"`, `PROTOCOL_VERSION = "2025-06-18"`
  - `READ_TOOLS: frozenset[str]` (the five names in Global Constraints)
  - `RETRY_DELAYS_S = (1.0, 2.0, 4.0, 8.0, 16.0)`, `MAX_RETRY_AFTER_S = 60.0`, `MIN_CALL_INTERVAL_S = 0.2`, `MAX_RESPONSE_BYTES = 16 * 1024 * 1024`, `TIMEOUT = httpx.Timeout(60.0, connect=10.0)`
  - `class WriteToolRefused(errors.NoteConnUnsupported)`
  - `class EvernoteMcpClient`:
    - `__init__(self, access_token: str, *, http: httpx.AsyncClient | None = None, on_unauthorized: Callable[[], Awaitable[str]] | None = None, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep, clock: Callable[[], float] = time.monotonic)`
    - `async call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]`, which returns `result.structuredContent`
    - `async aclose(self) -> None`
    - `tool_calls: list[str]`, the name of every `tools/call` actually sent, kept for rails

- [ ] **Step 1: Write the failing tests.** Every test uses `httpx.MockTransport` with no network.

```python
def test_every_write_tool_in_the_probed_schema_is_refused_before_the_network():
    tools = json.loads(PROBE_TOOLS.read_text(encoding="utf-8"))["result"]["tools"]
    writes = {t["name"] for t in tools if not t["annotations"]["readOnlyHint"]}
    assert writes >= {"create_note", "edit_note", "delete_note", "update_note_tags", "move_notes"}
    assert not (writes & evernote_mcp.READ_TOOLS)
    sent = []
    client = _client(handler=lambda req: sent.append(req) or _ok({}))
    for name in sorted(writes):
        with pytest.raises(evernote_mcp.WriteToolRefused):
            asyncio.run(client.call_tool(name, {}))
    assert sent == [] and client.tool_calls == []

def test_every_read_tool_is_annotated_read_only_in_the_probed_schema(): ...
    # each READ_TOOLS name exists in tools_list.json with readOnlyHint True
def test_unknown_tool_name_is_refused(): ...          # "semantic_search" is read-only but NOT allow-listed -> refused
def test_initialize_then_initialized_then_call_carries_session_id(): ...
    # request 1 = initialize (no Mcp-Session-Id), request 2 = notifications/initialized (has it, no "id"),
    # request 3 = tools/call with the same Mcp-Session-Id and MCP-Protocol-Version: 2025-06-18
def test_sse_response_is_parsed_by_matching_jsonrpc_id(): ...  # text/event-stream with a notification line before the result
def test_429_honours_retry_after_then_succeeds(): ...           # sleeps == [5.0]
def test_5xx_backs_off_on_the_ladder_then_raises_transient(): ... # 6 attempts; sleeps == RETRY_DELAYS_S (jitter injected as 1.0)
def test_429_exhausted_raises_rate_limited_with_retry_after(): ...
def test_401_calls_on_unauthorized_once_and_retries_with_the_new_token(): ...
def test_second_401_raises_auth_error(): ...
def test_404_on_a_session_reinitialises_once(): ...
def test_is_error_result_raises_unsupported_with_the_tool_text(): ...
def test_response_over_cap_raises_too_large(): ...
def test_calls_are_paced_by_min_interval(): ...                # fake clock: second call sleeps 0.2 - elapsed
```

`PROBE_TOOLS` is `REPO / "docs/notebook-connectors/evernote-probe-2026-11-02/tools_list.json"`. The test reads the measured file rather than a typed copy.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_mcp.py -q`
Expected: FAIL with `ModuleNotFoundError: ... evernote_mcp`

- [ ] **Step 3: Implement `evernote_mcp.py`.** The allow-list check is the first statement of `call_tool` and runs before any I/O; `tools/call` is the only place a tool name is sent. Session setup is lazy: the first `call_tool` sends `initialize` (`clientInfo {"name":"uct-notebook-sync","version":"1.0"}`, `capabilities {}`) and then `notifications/initialized`. Body reads are streamed and capped at `MAX_RESPONSE_BYTES`. Backoff is `RETRY_DELAYS_S[i] * jitter`, where jitter is injectable and defaults to `random.uniform(0.5, 1.5)`. A `Retry-After` value is capped at `MAX_RETRY_AFTER_S`. Error mapping:
  - transport error or 5xx exhausted → `NoteConnTransient`
  - 429 exhausted → `NoteConnRateLimited(retry_after=…)`
  - 401 after one `on_unauthorized` retry → `NoteConnAuthError`
  - 403 → `NoteConnAuthError(code="evernote_forbidden")`, which Task 7 maps to the plan message
  - `result.isError` → `NoteConnUnsupported` carrying the first text block

  The token is never logged, and error strings never contain it.

  Ruling: retry 5 times on the doubling ladder and pace calls 0.2 s apart. Evernote publishes no limits, and the probe saw none in 80+ calls (slowest 2.5 s). A 215-note pass is about 300 calls, roughly 1 to 2 minutes at this pace.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_mcp.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/note_connectors/evernote_mcp.py api/services/journal_two/test_note_connectors_evernote_mcp.py
git commit -m "feat(evernote): MCP streamable-HTTP client with a read-only tool allow-list"
```

---

### Task 2: OAuth (DCR at deploy, PKCE, rotating refresh with compare-and-swap)

**Files:**
- Create: `api/services/journal_two/note_connectors/evernote_oauth.py`
- Create: `tools/evernote_register_client.py`
- Modify: `api/services/journal_two/note_connectors/connections.py` (add `swap_token_if_unchanged`; factor `_encrypt_token` out of `upsert_connector`)
- Test: `api/services/journal_two/test_note_connectors_evernote_oauth.py`

**Interfaces:**
- Consumes: `connections.get_token`, `connections.upsert_connector`, `oauth._redirect_uri`, `errors.*`
- Produces:
  - `AUTH_BASE`, `REGISTER_URL`, `AUTHORIZE_URL`, `TOKEN_URL`, `RESOURCE = "https://mcp.evernote.com"`, `SCOPE = "read"`
  - `def client_id() -> str | None`, which reads env `EVERNOTE_CLIENT_ID` live
  - `def pkce_verifier(state: str, secret: bytes) -> str`, defined as `base64url(HMAC-SHA256(secret, b"evernote-pkce:" + state))` with no padding (43 chars)
  - `def pkce_challenge(verifier: str) -> str`
  - `def authorize_url(state: str, secret: bytes) -> str`
  - `async def exchange_code(code: str, state: str, secret: bytes, *, client: httpx.AsyncClient | None = None) -> dict`, which returns creds `{accessToken, refreshToken, expiresAt, clientId}`
  - `async def refresh_if_needed(user_id: str, *, force: bool = False, client: httpx.AsyncClient | None = None) -> dict | None`
  - `async def register_client(redirect_uri: str, *, client: httpx.AsyncClient | None = None) -> dict`
  - `connections.swap_token_if_unchanged(user_id: str, provider: str, expected_refresh_token: str, new_token: dict) -> bool`

Ruling: register the client **once at deploy**, not at runtime. `tools/evernote_register_client.py` posts the DCR body the probe used (`client_name "UCT Notebook Sync"`, `redirect_uris [<production callback>]`, `grant_types ["authorization_code","refresh_token"]`, `response_types ["code"]`, `token_endpoint_auth_method "none"`, `scope "read"`) and prints the `client_id`, which the owner sets as `EVERNOTE_CLIENT_ID` on `web`. A public client has no secret, so the id is not sensitive. Runtime DCR would mint one client per connect with nothing to clean them up. Every stored credential also carries the `clientId` that issued it, and refresh uses that one, so rotating the env var later never strands an existing member.

Ruling: derive the PKCE verifier from the signed state with the server's state secret instead of storing it. The state is already HMAC-signed, single-use and time-bounded, so derivation survives a restart and needs no table. Someone who knows the state but not `PUSH_SECRET` still cannot compute the verifier.

Ruling: guard refresh with a **`threading.Lock` per user plus a DB compare-and-swap**, not `oauth._refresh_locks`. Those are `asyncio.Lock`s, and the engine runs on the uvicorn loop and on a fresh loop for each scheduler job (see `engine._inflight_lock`'s note); a loop-bound lock raises across loops. The lock is held only around the token POST plus the swap, and that work runs in `asyncio.to_thread` with a synchronous httpx client. So a waiter blocks a worker thread, never an event loop.

- [ ] **Step 1: Write the failing tests**

```python
def test_authorize_url_carries_pkce_resource_scope_and_production_callback(monkeypatch):
    monkeypatch.setenv("EVERNOTE_CLIENT_ID", "cid-1")
    q = parse_qs(urlsplit(evernote_oauth.authorize_url("st", b"k")).query)
    assert q["code_challenge_method"] == ["S256"] and q["resource"] == ["https://mcp.evernote.com"]
    assert q["scope"] == ["read"] and q["client_id"] == ["cid-1"]
    assert q["redirect_uri"] == ["https://uctintelligence.com/api/j2/notes/connectors/evernote/callback"]
    assert q["code_challenge"] == [evernote_oauth.pkce_challenge(evernote_oauth.pkce_verifier("st", b"k"))]

def test_verifier_needs_the_secret():  # same state, different secret -> different verifier; length 43..128
def test_exchange_posts_form_with_verifier_and_no_client_secret(): ...
    # body has grant_type=authorization_code, code, redirect_uri, client_id, code_verifier, resource; no Authorization header
def test_exchange_stores_client_id_in_creds(): ...
def test_refresh_rotates_and_persists_the_new_refresh_token_encrypted(tmp_db): ...
    # stored rt0, expired -> POST refresh_token=rt0 -> response rt1 -> get_token(...)["refreshToken"] == "rt1";
    # raw token_enc column does not contain "rt1"
def test_refresh_not_needed_makes_no_post(tmp_db): ...
def test_force_refresh_posts_even_when_not_expired(tmp_db): ...
def test_two_threads_racing_one_expired_token_post_once(tmp_db): ...
    # two asyncio.run(refresh_if_needed(u)) in two threads; transport counts POSTs == 1; both return rt1 creds
def test_lost_race_invalid_grant_returns_the_winners_tokens(tmp_db): ...
    # stored rt0; the POST returns 400 invalid_grant, but by then the DB holds rt1 written by another process
    # -> returns rt1 creds, no raise
def test_invalid_grant_with_unchanged_store_raises_token_expired(tmp_db): ...
def test_refresh_never_overwrites_a_reconnect(tmp_db): ...   # Review Focus 3
    # refresher reads rt0; before its swap, upsert_connector writes a reconnect (rtR);
    # swap_token_if_unchanged(..., expected "rt0") returns False; stored stays rtR
def test_swap_token_if_unchanged_is_atomic_and_encrypted(tmp_db): ...
def test_register_client_body_matches_the_probe(): ...
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_oauth.py -q`
Expected: FAIL with `ModuleNotFoundError: ... evernote_oauth`

- [ ] **Step 3: Implement.**
  - `swap_token_if_unchanged` runs `BEGIN IMMEDIATE`, reads and decrypts the current blob, compares `refreshToken` to `expected_refresh_token`, and only then writes `_encrypt_token(new_token)` and commits. It returns `True` when it wrote.
  - `upsert_connector` now calls `_encrypt_token` too. The module docstring's "exactly ONE write site" becomes "exactly one encrypt helper".
  - `refresh_if_needed` takes the lock, re-reads, returns the stored creds if they are not near expiry (`expiresAt` within 60 s, same skew as `oauth.py`) and not `force`, then POSTs and swaps. If the swap fails, it returns the freshly stored creds. On `invalid_grant` it re-reads: a different stored `refreshToken` means another refresher won, so it returns that; otherwise it raises `NoteConnTokenExpired`.
  - The crash window between a successful POST and the swap is the same accepted gap `oauth.py` documents. Copy that comment and do not restate it.
  - The tool's `main()` prints only `client_id` and the redirect URI and writes nothing to disk.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_oauth.py api/services/journal_two/test_note_connectors_connections.py -q`
Expected: PASS (the existing connections tests stay green)

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/note_connectors/evernote_oauth.py api/services/journal_two/note_connectors/connections.py tools/evernote_register_client.py api/services/journal_two/test_note_connectors_evernote_oauth.py
git commit -m "feat(evernote): public-client OAuth with PKCE and a rotating refresh token persisted by compare-and-swap"
```

---

### Task 3: ENML → TipTap server converter

**Files:**
- Create: `api/services/journal_two/note_connectors/convert/enml.py`
- Test: `api/services/journal_two/test_note_convert_enml.py`

**Interfaces:**
- Consumes: `mddoc.html_to_tiptap(html) -> {"doc","media","links"}` (shape as `onenote_html.onenote_html_to_tiptap`), `REF_PREFIX`, `LINK_PREFIX`, `ATTACHMENT_REF_PREFIX` from `convert/__init__.py`, `import_notice.notice_node`
- Produces:
  - `EVERNOTE_RES_SCHEME = "evernote-res://"`; a media ref is `evernote-res://{noteGuid}/{md5hash}`
  - `LIVE_KEY_PREFIX = "evernote:guid:"`; `def live_import_key(guid: str) -> str`
  - `def note_guid_from_href(href: str) -> str | None` handles `evernote:///view/{uid}/{shard}/{guid}/{guid}/` and `https://www.evernote.com/shard/{s}/nl/{uid}/{guid}/`; `/l/…` and `share…/note/…` return `None`
  - `def enml_to_tiptap(enml: str, resources: list[dict], *, note_guid: str, source_url: str | None = None) -> dict` returns `{"doc","media","links"}`
  - Amended (pre-flight): the signature is `resources: list[dict] | None`. `None` is read as `[]` on the first line (`resources = resources or []`), because `get_note` returns `resources: null` for a note without attachments.

Ruling: the live import key is `evernote:guid:{guid}`. A `.enex` key is always `evernote:{notebook}/{title}/{created}`, which contains two `/`, and a GUID contains none, so the two key spaces cannot collide. `link_keys.EVERNOTE_SOURCE` matching keeps working unchanged.

The rules port `adapters/evernote.js` one for one, in this order:
1. Strip the prolog (`<?xml …?><!DOCTYPE …>`) and work inside `<en-note>`.
2. `<en-crypt>` becomes `<p>[encrypted content — cannot be imported]</p>`.
3. Mark note links.
   - A guid href becomes `LINK_PREFIX + live_import_key(guid)` and keeps every child.
   - A `/l/` or share href becomes `LINK_PREFIX + "evernote-title:" + <link text, stripped>`. This is the key `link_keys` already heals.
   - A note link with no text keeps its content.
4. `<en-media hash type>` is matched against `resources` by `hash`.
   - An `image/*` match becomes `<img src="{REF_PREFIX}evernote-res://{guid}/{hash}">` with media `{ref, kind:"image", name, mime}`.
   - Any other match becomes `<a href="{ATTACHMENT_REF_PREFIX}evernote-res://{guid}/{hash}">{name}</a>`, kind `file`, after which the attachment name is patched onto the chip as `onenote_html._apply_attachment_names` does.
   - A hash with no resource becomes an `importNotice` `missing_resource` in place. Never a silent drop.
   - Content the HTML parser nested inside a self-closing `<en-media/>` is unwrapped back out after it (the client's `unwrapInPlace`).
5. `<en-todo checked>` lines are grouped into `<ul><li data-uct-task="0|1">`, the marker `mddoc._html_list_or_tasklist` already reads. Siblings nested inside an `<en-todo/>` are unwrapped too.
6. Resources no `<en-media>` cited are appended at the end. Duplicate hashes collapse first-wins.
7. When `source_url` is http(s), a first line `Source: <a href>` is added.
8. Media is lifted out of links (`mediaRefs.liftMediaOutOfLinks` semantics).
9. `<div style="…-en-codeblock:true…">` becomes `<pre><code>` with its text verbatim.

Amended (pre-flight): the outcome is decided up front, replacing the earlier "server-only unless the rail shows otherwise" ruling. `git grep` finds no code-block rule in the client `adapters/evernote.js`, so 07-codeblock would go red. Rule 9 therefore exists on **both** sides. Task 4 adds the matching client rule to `adapters/evernote.js`, and fixture `07-codeblock` pins it in both the Python and JS halves of the parity rail.

- [ ] **Step 1: Write the failing tests**

```python
def test_live_key_and_file_key_spaces_cannot_collide():
    assert enml.live_import_key("0a1b-…") == "evernote:guid:0a1b-…" and "/" not in enml.live_import_key("0a1b-…")

@pytest.mark.parametrize("href,guid", [
    ("evernote:///view/123/s1/aaaa-bb/aaaa-bb/", "aaaa-bb"),
    ("https://www.evernote.com/shard/s1/nl/123/aaaa-bb/", "aaaa-bb"),
    ("https://www.evernote.com/l/AbCd", None),
    ("https://share.evernote.com/note/xyz", None)])
def test_note_guid_from_href(href, guid): ...

def test_image_media_becomes_import_ref_with_declared_mime(): ...
def test_pdf_media_becomes_attachment_chip_named_from_resource(): ...
def test_missing_resource_is_a_notice_in_place_never_dropped(): ...
def test_unreferenced_resource_is_appended(): ...
def test_duplicate_hash_resources_collapse_first_wins(): ...
def test_text_after_self_closing_en_media_is_kept(): ...
def test_en_todo_lines_group_into_one_task_list_with_checked_state(): ...
def test_en_crypt_becomes_visible_placeholder(): ...
def test_guid_note_link_resolves_to_live_key_and_keeps_bold_child(): ...
def test_share_link_falls_back_to_evernote_title_key(): ...
def test_image_inside_a_note_link_is_lifted_not_erased(): ...
def test_source_url_line_only_for_http_urls(): ...
def test_codeblock_div_becomes_code_block_verbatim(): ...
def test_table_and_nested_lists_survive(): ...
def test_entities_like_nbsp_do_not_crash(): ...
def test_null_resources_is_read_as_no_resources(): ...   # Amended (pre-flight): enml_to_tiptap(enml, None, ...) == enml_to_tiptap(enml, [], ...); an <en-media> then becomes a missing_resource notice
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_note_convert_enml.py -q`
Expected: FAIL with `ModuleNotFoundError: ... convert.enml`

- [ ] **Step 3: Implement `enml.py`.** It is a string or `html.parser`-level pre-pass, the same pattern as `onenote_html.py`, followed by `mddoc.html_to_tiptap`. It must not parse with `xml.etree`: ENML carries XHTML entities that a strict XML parser rejects.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest api/services/journal_two/test_note_convert_enml.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/note_connectors/convert/enml.py api/services/journal_two/test_note_convert_enml.py
git commit -m "feat(evernote): server-side ENML to TipTap converter porting the .enex adapter's rules"
```

---

### Task 4: ENML parity rail (one behaviour, two implementations)

**Files:**
- Create: `api/services/journal_two/note_connectors/convert/enml_fixtures_in/{01-todo,02-media-mixed,03-missing-and-unreferenced,04-note-links,05-crypt,06-table-nested-lists,07-codeblock,08-link-around-image,09-web-clip-source-url}.enml`, each with a sidecar `<stem>.note.json` = `{guid, title, created, notebook, sourceUrl?, resources:[{hash,mime,name,data_b64}], notes:{<guid>: <title>}}`
- Create: `api/services/journal_two/note_connectors/convert/enml_parity_fixtures_gen.py`
- Create: `app/src/pages/journal-2-0/lib/importer/__fixtures__/enml_parity/*.json` (generated)
- Create: `app/src/pages/journal-2-0/lib/importer/enmlParity.contract.test.js`
- Modify: `api/services/journal_two/note_connectors/convert/fixtures_gen.py` (the `.enml` branch, Step 4)
- Amended (pre-flight): Modify: `api/services/journal_two/note_connectors/convert/enml.py` (Task 3's file: any server-lane fix the rail finds lands here)
- Amended (pre-flight): Modify: `app/src/pages/journal-2-0/lib/importer/adapters/evernote.js` (the client code-block rule, plus any client-lane fix the rail finds)
- Test: `api/services/journal_two/test_enml_parity_fixtures.py`

Amended (pre-flight): **the client code-block rule.** In `adapters/evernote.js`, a `<div>` whose `style` contains `-en-codeblock:true` (ignore whitespace and case around the colon, as the server's rule 9 does) becomes `<pre><code>` holding its text verbatim. Each child `<div>` and each `<br>` becomes one `\n`, and nothing is trimmed inside the block. This mirrors rule 9 in `enml.py` exactly, so `07-codeblock` produces one `codeBlock` in both summaries. Do not edit `lib/importer/evernote.test.js`: Plan C edits it. The parity fixture is the pin on both sides.

**Interfaces:**
- Consumes: `enml.enml_to_tiptap` (Task 3); on the client, `adapters/evernote.js::evernoteAdapter.parse`, `postParse.parseImport` and `convert.js::htmlToNote` (the production path, as in `obsidianParity.contract.test.js`)
- Produces: `semantic_summary(doc) -> dict`, mirrored in JS as `semanticSummary(doc)`. It returns the ordered block types; the text of each block; task checked flags; image refs reduced to the bare md5 hash; attachment chip names; notice reasons; and link targets normalized as follows. A note link becomes `note:<target title>`: the server maps guid → title through the sidecar's `notes`, the client gets the title from the `.enex` it resolved by title. A web link becomes its href.

The shape mirrors `obsidian_parity_fixtures_gen.py`. Python is the authority and writes a summary. The JS test wraps the same ENML plus base64 resources into a synthetic `.enex` (`<en-export><note><title/><created/><content><![CDATA[…]]></content><resource><data encoding="base64"/><mime/><resource-attributes><file-name/></resource-attributes></resource></note></en-export>`, with every target note in `notes` included as its own `<note>`). It then runs the client path and asserts that the summaries are equal. Nothing is URL-decoded or otherwise normalized beyond the identity encodings named above: the anti-goal in spec section 4 forbids it.

- [ ] **Step 1: Write the failing tests**

```python
def test_enml_parity_fixtures_are_current():
    assert enml_parity_fixtures_gen.render_all() == _committed()          # byte-equal, all stems

def test_every_fixture_resource_hash_is_the_md5_of_its_bytes(): ...      # client matches by computed MD5, server by declared hash
def test_every_stem_has_a_sidecar_and_a_committed_summary(): ...
```

```js
it('found at least one committed fixture', () => expect(fixtures.length).toBeGreaterThan(0))
it.each(fixtures)('%s: the client .enex path means the same as the server ENML path', async ({ file, fixture }) => {
  expect(await clientSummary(fixture)).toEqual(fixture.summary)
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_enml_parity_fixtures.py -q` → FAIL (no generator module)
Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/enmlParity.contract.test.js` → FAIL on `found at least one committed fixture`

- [ ] **Step 3: Write the generator and the fixtures, then run `python -m api.services.journal_two.note_connectors.convert.enml_parity_fixtures_gen`.** For each red stem, find which lane is wrong. The client is the reference for every construct except one it loses content on. Then fix that lane and record the decision in the generator docstring. Amended (pre-flight): code blocks are that exception and are already decided: add the client code-block rule above to `adapters/evernote.js` in this step, and confirm `07-codeblock` goes green in both halves. Prove the rail can fail: temporarily skip `en-todo` grouping in `enml.py`, regenerate, watch the JS test go red on `01-todo`, revert, and quote that red/green in the commit message.

- [ ] **Step 4: Run both halves and confirm they pass**

Run: `python -m pytest api/services/journal_two/test_enml_parity_fixtures.py -q` and `cd app && npx vitest run src/pages/journal-2-0/lib/importer/enmlParity.contract.test.js src/pages/journal-2-0/lib/importer/serverConvert.contract.test.js`
Expected: PASS. Add the 9 enml docs to the `server_convert` schema rail inputs too (`fixtures_gen.py` gains an `.enml` branch), so every emitted node passes the real editor schema.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/note_connectors/convert/enml_fixtures_in api/services/journal_two/note_connectors/convert/enml_parity_fixtures_gen.py api/services/journal_two/note_connectors/convert/fixtures_gen.py api/services/journal_two/note_connectors/convert/enml.py app/src/pages/journal-2-0/lib/importer/adapters/evernote.js app/src/pages/journal-2-0/lib/importer/__fixtures__/enml_parity app/src/pages/journal-2-0/lib/importer/__fixtures__/server_convert app/src/pages/journal-2-0/lib/importer/enmlParity.contract.test.js api/services/journal_two/test_enml_parity_fixtures.py
git commit -m "test(evernote): ENML parity rail pinning the server converter to the .enex adapter"
```

Amended (pre-flight): the `git add` now includes `convert/enml.py` and `adapters/evernote.js`. Run `cd app && npx vitest run src/pages/journal-2-0/lib/importer/evernote.test.js src/pages/journal-2-0/lib/importer/evernoteLinks.test.js src/pages/journal-2-0/lib/importer/corpora.evernote.test.js` before committing, so the existing client tests stay green with the new rule.

---

### Task 5: `EvernoteProvider`

**Files:**
- Create: `api/services/journal_two/note_connectors/providers/evernote.py`
- Amended (pre-flight): Modify: `api/services/journal_two/note_connectors/providers/base.py` (optional `allowed_host` keyword on `guarded_media_get` and `guarded_media_stream`)
- Amended (pre-flight): Modify: `api/services/journal_two/import_provenance.py` (rename `_instant` to public `instant`; update the module's own callers; no behaviour change)
- Test: `api/services/journal_two/test_note_connectors_evernote_provider.py`
- Amended (pre-flight): Test: `api/services/journal_two/test_note_connectors_media_host_pin.py` (the per-hop host pin in `base.py`)

**Interfaces:**
- Consumes: `EvernoteMcpClient` (Task 1), `evernote_oauth.refresh_if_needed(user_id, force=True)` as `on_unauthorized` (Task 2), `enml.enml_to_tiptap` and `enml.live_import_key` (Task 3), `base.guarded_media_get` and `base.media_http_client`, `import_provenance.instant`
- Amended (pre-flight): `on_unauthorized` contract (scan a4): the coroutine calls `refresh_if_needed(self._user_id, force=True)`. A `None` result (no connector row) raises `NoteConnAuthError`; otherwise it returns `creds["accessToken"]`. A provider built with `user_id=None` has no `on_unauthorized` at all, so a 401 surfaces as `NoteConnAuthError` from Task 1.
- Amended (pre-flight): Produces, in `base.py`: `guarded_media_get(..., allowed_host: str | None = None)` and the same keyword on `guarded_media_stream`. When set, the hop loop checks `urlsplit(url).hostname == allowed_host` (exact, lowercase compare) **before every request, the first and every redirect hop**, next to the unchanged `assert_public_https`. A mismatch raises `NoteConnUnsafeAddress` before that hop's request is sent. The default `None` leaves the five existing callers byte-identical.
- Amended (pre-flight): Produces, on `EvernoteProvider`: `drain_item_failures() -> list[dict]`, which returns and clears the `{noteTitle, reason, name}` entries (Plan D's `failures_json` shape, `name` is `None`) for every per-note problem this instance recorded since the last drain. Task 8 wires the engine to read it.
- Produces: `class EvernoteProvider(NoteProvider)` with
  - `name = "evernote"`, `adopt_import_source = "evernote"` (read by Task 8)
  - `PAGE_SIZE = 100`, `CURSOR_OVERLAP_S = 120`, `ATTACHMENT_HOST = "storage.googleapis.com"`
  - `__init__(self, *, user_id: str | None = None, mcp_factory: Callable[[dict], EvernoteMcpClient] | None = None, http: httpx.AsyncClient | None = None)`
  - `import_key(self, source_remote_id, remote_id) -> str`, which returns `live_import_key(remote_id)`
  - `async validate(creds) -> AccountInfo(label="Evernote", raw={"noteCount": int})`
  - `async list_changed(creds, cursor=None) -> list[RemoteRef]`
  - `async list_present_refs(creds) -> list[RemoteRef]`
  - `async list_deleted(creds) -> list[RemoteRef]`
  - `async fetch(creds, ref) -> RemoteNote`
  - `async fetch_media(creds, ref) -> tuple[bytes, str]`
  - `async aclose()`

Behaviour:
- **Timestamps:** `_iso(value)` turns an ISO string (any offset) or epoch milliseconds into `datetime.astimezone(utc).isoformat(timespec="milliseconds")`. Every `RemoteRef.updated_at` and every `RemoteNote.created_at`/`updated_at` goes through it, so the engine's string comparisons stay sound.
  - Amended (pre-flight): the ISO branch calls `import_provenance.instant` (the repo's existing parser, made public in this task). The epoch-ms branch (`int`/`float`, or an all-digit string) uses `datetime.fromtimestamp(ms / 1000, tz=timezone.utc)`, as `providers/roam.py::_epoch_ms_to_iso` does. `None` or an unreadable value returns `None`; it never raises.
- Amended (pre-flight): **Null `createdAt`/`updatedAt` on a search hit** (both are `string or null`). A hit's ref time is `updatedAt`, else `createdAt`. When both are null, `RemoteRef.updated_at` is the floor: the cursor passed in, or `"1970-01-01T00:00:00.000+00:00"` when there is none. So the hit is always listed and fetched (an unchanged note is a skip in `import_confirm`), it never counts as "older than the bound" for stopping a page, and it can never advance the engine's `max(ref.updated_at)` cursor past a real timestamp. `RemoteNote.created_at`/`updated_at` come from `get_note` `created`/`updated` instead; a null there stays `None`.
- **`list_changed`:** `search_notes{query:"", sortBy:"updated", ascending:false, maxResults:100, startIndex}` pages newest first. With a cursor, paging stops at the first page that contains a hit older than `cursor - CURSOR_OVERLAP_S`, and hits at or after that bound are returned. Ruling: re-fetching inside a 120 s overlap is cheap, because `import_confirm`'s hash check makes an unchanged note a skip, and a strict `>` against a timestamp of unknown precision would lose same-second edits. With `cursor=None` it enumerates everything.
- **`list_present_refs`:** the full active enumeration. It requires `len(unique noteIds) == totalResultCount` and the last page `isLastPage`. On a mismatch it re-enumerates once; if the second pass mismatches too it raises `NoteConnTransient`, so the engine skips the removal check (Review Focus 1). Ruling: implement the hook so a nightly full pass keeps the stored cursor and fetches only changed notes, instead of 215 `get_note` calls every night.
- **`list_deleted`:** `query:"intrash:true"`, enumerated the same way. Trash is an explicit, certain signal (spec section 7, Notion's shape), and notes the member never synced are untouched because the engine acts only on tracked keys. A note purged from trash disappears from both listings and falls to the 2-strike miss streak.
- **`fetch`:** Amended (pre-flight): `get_note{noteId}` → `enml_to_tiptap(sc["content"], sc.get("resources") or [], note_guid=…, source_url=…)`. `resources` is `null` on a note without attachments, and **every** read of it in this provider (the converter call, unreferenced-resource handling, any count) goes through `sc.get("resources") or []`.
  - Folders: `folder_path = [stack, notebook label]` when a stack exists, else `[notebook label]`. Amended (pre-flight): the notebook map comes from **one** `search_notebooks{query:"", maxResults:100}` call per provider instance. There is no paging: the tool has no `startIndex`.
  - Tags: labels. Amended (pre-flight): the tag-id map comes from **one** `search_tags{query:"", maxResults:100}` call per provider instance, made only when some note's `tags` holds an element that needs an id lookup. There is no paging: a call returns at most 100.
  - Amended (pre-flight): **cap fallback.** When either call returns exactly 100 hits, log one warning per instance (`evernote notebooks listing hit the 100 cap` / `evernote tags listing hit the 100 cap`) and treat the map as partial. The provider then discovers notebooks and tags from the notes' own fields. A `tags` element that carries its own name is used directly and needs no map. A tag id the map does not hold is dropped, and recorded once per id per instance as `evernote tag not listed: <id>`. A `notebookId` the map does not hold puts the note at the source root, recorded once per id as `evernote notebook not listed: <id>`. Neither ever crashes the note.
  - The title comes from `get_note`, falling back to the hit title.
- **`get_note` keys:** Amended (pre-flight): the probe measured every key this provider reads ("Measured field names" in `evernote-mcp-probe.md`). `_NOTE_KEYS` holds **only the measured names**: `notebook → "notebookId"`, `tags → "tags"`, `created → "created"`, `updated → "updated"`, `attributes → "attributes"`, `resources → "resources"`, `content → "content"`, `title → "title"`. The guessed names (`notebookGuid`, `tagIds`, `createdAt`, `updatedAt`, `sourceUrl`) are deleted. The one lookup helper `_note_field(sc, field)` keeps its fallback branch **only as drift protection**: when a measured key is absent from a payload, it returns `None` and records `evernote note shape: missing <key>` once per key per instance. It never tries another name. A missing `notebookId` puts the note at the source root. The live gate (Task 11) must see zero `evernote note shape:` strings, and a non-zero count stops the gate before members.
- Amended (pre-flight): **Unmeasured element shapes.** The element type of `tags` and the keys inside `attributes` were not measured (`get_note` has `outputSchema: null`). The code accepts both forms:
  - A `tags` element that is a **string** is looked up in the tag map as an id; if the map does not hold it, the string itself is the label. A `tags` element that is an **object** uses `name` or `label` as the label when present, else `guid` or `id` through the tag map. Any other element is skipped and recorded as `evernote note shape: tag element <type name>`.
  - `attributes` is read only when it is a dict. The source URL is `attributes["sourceURL"]` (the Evernote `NoteAttributes` field name), accepted when it is a string, or an object carrying a string `name`; it is used only when it is http(s). Any other shape means no source URL, with no failure string.
  - Shape sample for the live gate: the first `fetch` per provider instance logs one INFO line, `evernote note shape sample: tags=<type name of the first element, or none> tag_keys=<sorted keys if it is a dict> attributes_keys=<sorted keys of attributes>`. It logs key names and type names only, never values or note content. The first `fetch_media` per instance also logs `evernote attachment host sample: <hostname of downloadUrl>`, the host only, never the path or the signed query. Task 11 reads both lines to record the real shapes.
- Amended (pre-flight): **Where failures go.** Every per-note string above (`evernote note shape: …`, `evernote tag not listed: …`, `evernote notebook not listed: …`) is recorded as `{noteTitle: <note title>, reason: <the string>, name: None}` in the list `drain_item_failures()` returns. Task 8 wires the engine to put those entries in `failures_json` and their `reason` in the pass's `item_failures`.
- **`fetch_media`:** parses `evernote-res://{guid}/{hash}` and calls `get_attachment{noteId:guid, hash}` **on every call**.
  - It refuses `sizeBytes > base.MEDIA_MAX_BYTES` (`NoteConnTooLarge`) before downloading.
  - It requires `urlsplit(downloadUrl)` to be `https` with host exactly `ATTACHMENT_HOST`; anything else is `NoteConnUnsafeAddress`. It then downloads through `guarded_media_get(self._media_http, url, what=filename)` with no Authorization header ever set.
  - Amended (pre-flight): the download call is `guarded_media_get(self._media_http, url, what=filename, allowed_host=ATTACHMENT_HOST)`. The pin is the exact host `storage.googleapis.com` (path-style, as measured; `bucket.storage.googleapis.com` is refused) and it is checked on **every redirect hop**, not only the first URL. A redirect to any other host is refused before that hop's request is sent.
  - It returns `(content, mimeType or the response content type)`.
  - Ruling: the URL comes from Evernote, not from note content, so the narrow host pin is added **on top of** the unchanged public-address guard. `storage.googleapis.com` resolves to public addresses, so `assert_public_https` needs no allowance.

- [ ] **Step 1: Write the failing tests.** They use a fake MCP built from recorded `structuredContent` shapes, with the hosts patched to public addresses as in `corpora_gen`.

```python
def test_import_key_is_the_live_key(): ...
def test_list_changed_without_cursor_pages_every_hit(): ...                    # 215 hits over 3 pages
def test_list_changed_with_cursor_stops_past_the_overlap_window(): ...
def test_updated_at_is_normalised_to_utc_milliseconds(): ...                    # "2026-11-02T10:00:00-04:00" -> "2026-11-02T14:00:00.000+00:00"
def test_present_refs_reenumerates_once_when_ids_do_not_match_total(): ...     # Review Focus 1
def test_present_refs_raises_transient_after_two_mismatches(): ...
def test_list_deleted_queries_intrash_true(): ...
def test_fetch_maps_stack_and_notebook_to_folder_path(): ...
def test_fetch_maps_tag_ids_to_labels(): ...
def test_fetch_missing_notebook_key_is_named_not_crashed(): ...
def test_fetch_media_asks_for_a_fresh_url_every_attempt(): ...                  # Review Focus 2: two calls -> two get_attachment calls
def test_fetch_media_refuses_a_non_gcs_host(): ...
def test_fetch_media_refuses_oversize_before_downloading(): ...
def test_fetch_media_sends_no_authorization_header(): ...
def test_provider_only_ever_calls_read_tools(): ...                             # whole provider surface; mcp.tool_calls ⊆ READ_TOOLS
# Amended (pre-flight):
def test_fetch_reads_the_measured_keys(): ...                                   # payload with notebookId/tags/created/updated/attributes only -> all mapped, no failure strings
def test_guessed_key_names_are_not_read(): ...                                  # payload with notebookGuid/tagIds/createdAt/updatedAt/sourceUrl only -> treated as missing: "evernote note shape: missing notebookId" etc., never used
def test_null_resources_is_an_empty_list_everywhere(): ...                      # resources: None -> fetch ok, no media, no crash; ENML <en-media> becomes a missing_resource notice
def test_tags_accept_strings_and_objects(): ...                                 # ["id-1", "Plain label", {"name": "Obj"}, {"guid": "id-2"}] -> labels via map / as-is / name / map
def test_attributes_source_url_accepts_string_or_named_object(): ...            # {"sourceURL": "https://x"} and {"sourceURL": {"name": "https://x"}}; non-dict attributes -> no source line, no failure
def test_notebooks_and_tags_are_one_call_each_with_max_100(): ...               # exactly one search_notebooks and at most one search_tags, maxResults 100, no startIndex argument sent
def test_cap_of_100_logs_a_warning_and_falls_back_to_note_fields(caplog): ...   # 100 notebook hits; note's notebookId not among them -> root + "evernote notebook not listed: <id>"; tag object with name still labelled
def test_null_hit_timestamps_are_listed_and_never_move_the_cursor(): ...        # hit {createdAt: None, updatedAt: None} -> listed; updated_at == cursor floor; max(updated_at) unchanged
def test_null_updated_at_falls_back_to_created_at(): ...
def test_shape_sample_is_logged_once_with_keys_only(caplog): ...                # one INFO line per instance; contains no note title, content or attribute value
def test_drain_item_failures_returns_plan_d_shape_and_clears(): ...             # [{noteTitle, reason, name: None}], second drain == []
def test_on_unauthorized_none_refresh_raises_auth_error(): ...                  # refresh_if_needed -> None => NoteConnAuthError
def test_fetch_media_passes_the_host_pin_to_every_hop(): ...                    # guarded_media_get called with allowed_host="storage.googleapis.com"
```

Amended (pre-flight): `test_note_connectors_media_host_pin.py` (the `base.py` change):

```python
def test_redirect_hop_to_another_host_is_refused_before_it_is_requested(): ...  # storage.googleapis.com 302 -> evil.example: NoteConnUnsafeAddress, transport saw ONE request
def test_redirect_hop_on_the_same_host_is_followed(): ...                       # storage.googleapis.com 302 -> storage.googleapis.com/other: 200 returned
def test_virtual_host_style_bucket_host_is_refused(): ...                       # bucket.storage.googleapis.com, first request: refused
def test_second_of_three_hops_off_host_is_refused(): ...                        # pin holds past the first redirect, not only on it
def test_allowed_host_none_keeps_existing_callers_unchanged(): ...              # no pin: a redirect to another public host is followed, as today
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_provider.py api/services/journal_two/test_note_connectors_media_host_pin.py -q`
Expected: FAIL with `ModuleNotFoundError: ... providers.evernote`, and `TypeError: ... unexpected keyword argument 'allowed_host'`

- [ ] **Step 3: Implement `providers/evernote.py`** to the behaviour above. The MCP client is built lazily from `creds["accessToken"]`, with `on_unauthorized` set to a coroutine that calls `evernote_oauth.refresh_if_needed(self._user_id, force=True)` and returns the new access token. Amended (pre-flight): also add `allowed_host` to the hop loop in `base.guarded_media_stream` (and pass it through `guarded_media_get`), and rename `import_provenance._instant` to `instant` (update its in-module callers; `git grep -n "_instant" api/` must show no remaining caller of the old name).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_provider.py api/services/journal_two/test_note_connectors_media_host_pin.py -q`, then the existing callers of the two changed modules, found by name first: `git grep -ln "guarded_media_get\|guarded_media_stream\|import_provenance" -- 'api/**/test_*.py' 'tests/test_*.py'` and run exactly those files.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/note_connectors/providers/evernote.py api/services/journal_two/note_connectors/providers/base.py api/services/journal_two/import_provenance.py api/services/journal_two/test_note_connectors_evernote_provider.py api/services/journal_two/test_note_connectors_media_host_pin.py
git commit -m "feat(evernote): EvernoteProvider over MCP: watermark listing, trash sweep, notebooks to folders, pre-signed attachments"
```

---

### Task 6: Registry entry, flag modes, refresh hook, ledger

**Files:**
- Modify: `api/services/journal_two/note_connectors/registry.py`
- Modify: `api/services/journal_two/note_connectors/engine.py` (`_resolve_credentials`)
- Modify: `docs/feature_flags.json`
- Modify: `api/services/journal_two/test_note_connectors_registry.py` (its "evernote is unknown" assertions become a different unknown name, `"evernote-legacy"`)
- Test: `api/services/journal_two/test_note_connectors_evernote_registry.py`
- Amended (pre-flight): Test: `api/services/journal_two/test_note_connectors_evernote_token_cas.py` (the `BEGIN IMMEDIATE` concurrency check, Step 4b)
- Amended (pre-flight): Modify, only if Step 4b finds a defect: `api/services/journal_two/note_connectors/connections.py` (`swap_token_if_unchanged` only)

**Interfaces:**
- Consumes: Task 2 `evernote_oauth.client_id`, `refresh_if_needed`; Task 5 `EvernoteProvider`
- Produces:
  - `ProviderEntry.refresh: Callable[[str], Awaitable[dict | None]] | None = None`, a new trailing field with a default, so no existing entry changes
  - `def evernote_flag_mode() -> Literal["off", "admin", "on"]`, read live from `NOTE_SYNC_EVERNOTE_ENABLED` (`"1"` → on, `"admin"` → admin, anything else → off)
  - `def provider_allowed_for(provider: str, user: dict) -> bool`. It returns `True` for every provider except `evernote`, which needs mode `on`, or mode `admin` with `user.get("role") == "admin"`
  - `_REGISTRY["evernote"] = ProviderEntry("evernote", "Evernote", "oauth", _evernote_configured, _build_evernote, refresh=_evernote_refresh)`
  - `_evernote_configured()` is `mode != "off" and evernote_oauth.client_id() and NoteBox.is_configured()`
  - `_build_evernote(source)` raises `NoteConnNotConfigured` when the mode is `off`. Ruling: turning the flag off stops scheduled syncs of existing sources too, not only new connects, so the flag is a real kill switch with no delete involved.
  - Amended (pre-flight): otherwise `_build_evernote(source)` returns `EvernoteProvider(user_id=(source or {}).get("userId"))`, passing `source["userId"]` exactly as `_build_obsidian` does. Without it the provider has no user for `on_unauthorized`, and a mid-sync 401 could not refresh. A `None` source (a probe) gets `user_id=None`.
  - In `engine._resolve_credentials`: `entry.refresh` wins when set; otherwise the existing `oauth.is_registered` path runs, then `get_token`.

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.parametrize("val,mode", [(None, "off"), ("0", "off"), ("admin", "admin"), ("1", "on"), ("true", "off")])
def test_flag_modes(monkeypatch, val, mode): ...
def test_evernote_not_configured_without_client_id_or_key(monkeypatch): ...
def test_admin_mode_allows_admins_only(monkeypatch): ...
def test_build_raises_not_configured_when_flag_off(monkeypatch): ...
def test_build_passes_the_source_user_id_to_the_provider(monkeypatch): ...      # Amended (pre-flight): _build_evernote({"userId": "u1", ...})._user_id == "u1"
def test_resolve_credentials_routes_evernote_through_its_refresh_hook(monkeypatch): ...
def test_resolve_credentials_unchanged_for_notion_and_dropbox(monkeypatch): ...
def test_flag_is_in_the_ledger_as_dark():
    entry = json.loads(LEDGER.read_text(encoding="utf-8"))["flags"]["NOTE_SYNC_EVERNOTE_ENABLED"]
    assert entry["status"] == "dark" and entry["since"] == "2026-11-02" and "live gate" in entry["note"]
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_registry.py tests/test_feature_flag_ledger.py -q`
Expected: FAIL (no evernote entry, no `evernote_flag_mode`, ledger key missing)

- [ ] **Step 3: Implement, then add the ledger entry** `{"status":"dark","since":"2026-11-02","where":["web"],"note":"DARK until the live gate against the owner's real Evernote account passes (215 active notes, 73 in trash, 6 with images; docs/notebook-connectors/evernote-live-gate.md). Values: unset/0 off (also stops syncs of existing sources), admin = admins only, 1 = every paid member. Also needs EVERNOTE_CLIENT_ID (tools/evernote_register_client.py) and NOTE_ENCRYPTION_KEY. Evernote's terms on unattended sync of the MCP beta are an open question to Evernote support; do not set 1 before the answer."}`. Add `EVERNOTE_CLIENT_ID` to the ledger's `knobs` if `test_feature_flag_ledger.py` classifies it as a gate. Let the test decide; never guess.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_registry.py api/services/journal_two/test_note_connectors_registry.py api/services/journal_two/test_note_connectors_engine_oauth_refresh.py tests/test_feature_flag_ledger.py -q`
Expected: PASS

- [ ] **Step 4b: Amended (pre-flight): verify that `get_connection()` honours `BEGIN IMMEDIATE` for the refresh-token compare-and-swap.** Task 2's `swap_token_if_unchanged` runs `BEGIN IMMEDIATE` on a connection from `api.services.auth_db.get_connection()`. That function returns a pooled connection (`factory=_PooledConnection`, `timeout=3`, default `isolation_level`). Two things could silently defeat the swap: a pooled connection handed out with a transaction already open (then `BEGIN IMMEDIATE` raises "cannot start a transaction within a transaction", or the read runs outside the write lock), and an isolation mode that turns the explicit `BEGIN` into a no-op. Read `get_connection` and `_PooledConnection` first, then write `test_note_connectors_evernote_token_cas.py` against a real temp `auth.db` file (not `:memory:`, which is per-connection):

```python
def test_two_threads_swapping_the_same_expected_token_exactly_one_wins(tmp_db): ...
    # stored rt0; two threads, a threading.Barrier before the call, each swap_token_if_unchanged(u, "evernote", "rt0", {...rtA}) / {...rtB}
    # -> exactly one True, one False; stored refreshToken is the winner's; never a mix
def test_swap_holds_the_write_lock_between_read_and_write(tmp_db): ...
    # a second connection that runs BEGIN IMMEDIATE while the swap is between its read and its write
    # (monkeypatch the decrypt step to wait on an Event) gets "database is locked" or waits; it never writes in between
def test_swap_under_a_held_write_lock_times_out_without_writing(tmp_db): ...
    # another connection holds BEGIN IMMEDIATE; the swap raises sqlite3.OperationalError after timeout=3 and stored stays rt0
def test_swap_on_a_pooled_connection_starts_its_own_transaction(tmp_db): ...
    # conn.in_transaction is False right before BEGIN IMMEDIATE; after the swap returns, in_transaction is False again (committed or rolled back)
```

  If a test fails, fix `swap_token_if_unchanged` only (for example, take a connection with `isolation_level=None`, or roll back a stray open transaction before `BEGIN IMMEDIATE`), and record the cause in its docstring. Do not change `get_connection()`: every auth request uses it.

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_token_cas.py api/services/journal_two/test_note_connectors_evernote_oauth.py api/services/journal_two/test_note_connectors_connections.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/note_connectors/registry.py api/services/journal_two/note_connectors/engine.py docs/feature_flags.json api/services/journal_two/test_note_connectors_registry.py api/services/journal_two/test_note_connectors_evernote_registry.py api/services/journal_two/test_note_connectors_evernote_token_cas.py
# Amended (pre-flight): add api/services/journal_two/note_connectors/connections.py too, only if Step 4b changed it
git commit -m "feat(evernote): registry entry behind NOTE_SYNC_EVERNOTE_ENABLED (off|admin|1), dark in the ledger"
```

---

### Task 7: Router (connect, callback, per-user gate, plan-required reason)

**Files:**
- Modify: `api/routers/note_sync.py` (`get_status`, `connect`, `_start_oauth`, `oauth_callback`, `disconnect`)

Amended (pre-flight): **the per-user flag gate goes in `connect()`** (note_sync.py, the `POST /{provider}/connect` handler), before it dispatches to `_start_oauth(provider, user_id)`. `_start_oauth` receives only `user_id` and gates on `entry.configured()` with no user, so it cannot apply the admin gate. In `connect()`: `if provider == "evernote" and not registry.provider_allowed_for("evernote", user): raise HTTPException(503, "Evernote is not configured on this server.")`, using the same 503 text as the unconfigured case so a member cannot tell "admin-only" from "off". The callback needs no gate: its state is signed and was minted only by a gated `connect()`. Confirm the auth user dict carries `role` (`get_current_user`) before relying on it (scan a15).
- Test: `tests/test_note_sync_router_evernote.py`

**Interfaces:**
- Consumes: `registry.provider_allowed_for`, `evernote_oauth.authorize_url/exchange_code`, `_state_secret()`, `_sign_state`, `_verify_state`, `EvernoteProvider.validate`
- Produces:
  - In `GET /status`, `providers.evernote.configured` is `registry.configured("evernote") and provider_allowed_for("evernote", user)`
  - `POST /evernote/connect` answers 503 `"Evernote is not configured on this server."` when `configured` is false for this user. Otherwise it returns `{"redirectUrl": evernote_oauth.authorize_url(state, _state_secret())}`.
  - `GET /evernote/callback` verifies the state and the session user exactly as today, then `exchange_code(code, state, _state_secret())`. It then runs `EvernoteProvider(user_id=…).validate(creds)`, upserts with `account_label="Evernote"`, creates one whole-account source with `remote_id="account"` and `display_name="Evernote"`, and calls `_start_initial_sync`.
  - The constant `EVERNOTE_PLAN_REASON = "evernote_plan"`: a validate failure with `NoteConnAuthError` code `evernote_forbidden`, or an OAuth `error=access_denied` that carries a plan-related `error_description`, redirects with `reason=evernote_plan`.
  - Disconnect deletes the connector exactly as for Notion. The probe found no revoke endpoint, so there is no revoke call.

Ruling: `remote_id="account"`. A member has one Evernote connector (`j2_note_connectors` is keyed `(user_id, provider)`), and the token response carries no account id worth keying on. The live import keys do not include it.

Ruling: any 403 at `validate` reads as "this account cannot use the MCP server", which is the plan message. Read scope was already granted at that point, so a plan restriction is the likely cause, and the message still offers the `.enex` path if the cause was something else.

Evernote joins `_start_oauth` and `oauth_callback` as an **explicit `elif provider == "evernote"` branch placed before the Dropbox `else`**. Today that `else` assumes "not in `oauth._PROVIDERS`" means Dropbox, so Evernote would fall into it.

- [ ] **Step 1: Write the failing tests**

```python
def test_status_hides_evernote_from_members_in_admin_mode(client_member, monkeypatch): ...
def test_status_shows_evernote_to_admin_in_admin_mode(client_admin, monkeypatch): ...
def test_connect_returns_pkce_authorize_url(client_admin, monkeypatch): ...
def test_connect_503_for_member_in_admin_mode(client_member, monkeypatch): ...
def test_callback_exchanges_with_verifier_from_state_and_creates_one_source(client_admin, monkeypatch): ...
def test_callback_state_of_other_user_gets_the_same_failure_page(client_admin, monkeypatch): ...
def test_callback_403_on_validate_redirects_with_evernote_plan_reason(client_admin, monkeypatch): ...
def test_callback_never_falls_into_the_dropbox_branch(client_admin, monkeypatch): ...
def test_disconnect_evernote_deletes_connector_and_keeps_notes(client_admin, monkeypatch): ...
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest tests/test_note_sync_router_evernote.py -q`
Expected: FAIL (evernote falls into the Dropbox branch, and the status ignores the user gate)

- [ ] **Step 3: Implement** the branches and the per-user gate in `get_status` and `connect`. Amended (pre-flight): the `connect` gate sits in `connect()` itself, before the `connect_kind == "oauth"` dispatch to `_start_oauth`, never inside `_start_oauth`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest tests/test_note_sync_router_evernote.py tests/test_note_sync_router.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/routers/note_sync.py tests/test_note_sync_router_evernote.py
git commit -m "feat(evernote): connect and callback with PKCE, admin-first gate, plan-required reason"
```

---

### Task 8: Adopt notes imported earlier from `.enex` (spec 15 Q3)

**Files:**
- Create: `api/services/journal_two/note_connectors/adoption.py`
- Modify: `api/services/journal_two/note_connectors/engine.py` (`_import_remote_notes`: call the seam before `_bulk_existing_note_meta`; `counts["adopted"]` in `_do_sync` and `_finish_log`)
- Amended (pre-flight): Modify: `api/services/journal_two/db.py` (nullable `adopted INTEGER` on `j2_note_sync_log`: the `_J2_SCHEMA` CREATE near L749, the second CREATE near L3040, and the ALTER list right after `"ALTER TABLE j2_note_sync_log ADD COLUMN failures_json TEXT"`)
- Amended (pre-flight): Modify: `api/routers/note_sync.py` (`source_log` only: each row gains `"adopted": r["adopted"] or 0`)
- Test: `api/services/journal_two/test_note_connectors_adoption.py`
- Amended (pre-flight): Modify: `api/services/journal_two/test_note_connectors_db.py` (the older-DB ALTER test also asserts `adopted` is added)

**Interfaces:**
- Consumes: `RemoteNote`, `provider.import_key`, `getattr(provider, "adopt_import_source", None)`, `notes_svc` plain-text extraction (`body_plain` is already stored), Amended (pre-flight): `import_provenance.instant` (Task 5) and `getattr(provider, "drain_item_failures", None)` (Task 5)
- Produces: `def adopt_file_imports(conn: sqlite3.Connection, user_id: str, import_source: str, candidates: list[tuple[str, RemoteNote]]) -> list[dict]`, which returns `[{"fromKey", "toKey", "noteId"}]`. `candidates` are `(live_key, rn)` pairs for which no non-trashed row holds `live_key`.
  - Amended (pre-flight): the return type is `tuple[list[dict], list[dict]]`: `(adopted, failures)`. `adopted` is the `[{"fromKey", "toKey", "noteId"}]` list above. `failures` holds `{noteTitle, reason, name: None}` entries (Plan D's `failures_json` shape), one per ambiguous title, with `reason = 'adoption ambiguous: "<title>"'`.

Amended (pre-flight): **where the adopted count and the failures go** (engine.py, `_ZERO_COUNTS`, the sync-log writer):
- `_do_sync`'s `counts` dict (engine.py L533) gains `"adopted": 0`, and the seam adds `len(adopted)` to it. The sync result spreads `**counts`, so the Sync now response carries `adopted`.
- `_finish_log` writes `adopted = int(counts.get("adopted", 0))` into the new `j2_note_sync_log.adopted` column, in the same `UPDATE` as the other counts. A NULL in older rows reads as 0.
- `GET /sources/{id}/log` rows gain `"adopted"`. If an existing test pins that row's exact key set, update it in this task.
- **Not changed:** `_ZERO_COUNTS` and `_latest_sync_counts` in `api/routers/note_sync.py`, and so `/status` `counts`. Its key set is pinned by `tests/test_note_sync_router.py:1239`, and Plan D chose not to widen it. An adopted note is also counted as `updated` or `skipped` by `import_confirm`, as any synced note is; `adopted` is the extra fact "this one was a `.enex` row".
- **Failures, as Plan D designed:** `failures_json` holds `{noteTitle, reason, name}` entries. After `_fetch_remote_notes`, and again after the adoption seam, the engine calls `getattr(provider, "drain_item_failures", None)` when present and appends each entry to `notice_failures` (so it reaches `failures_json` through `_finish_log`) and its `reason` to `item_failures` (so it reaches the result's `failures` and the log row's `error`). The adoption seam's `failures` go to the same two places. Providers without the method are byte-identical. `FAILURES_JSON_CAP` (50) still applies.

Rules, from the spec, with the builder's calls:
- **Candidates:** a candidate row is a `j2_notes` row with `user_id` matching, `deleted_at IS NULL`, `lower(import_source) = import_source`, and an `import_key` that does not start with `enml.LIVE_KEY_PREFIX`.
- **Matching:** a candidate matches when `title.strip() == rn.title.strip()` and both `created_at` values parse to the same UTC minute. Amended (pre-flight): "parse" means `import_provenance.instant(value)` floored to the minute (`.replace(second=0, microsecond=0)`), and the "same UTC second" check below uses the same call floored to the second. `adoption.py` writes no timestamp parser of its own. An unreadable `created_at` on either side is a non-match. If several match, the tie-break is `sha256` of whitespace-collapsed plain text, stored `body_plain` against the converted remote doc. Exactly one survivor is adopted. Zero or two or more means not adopted: the note imports as new, and the pair is named in a failure string `adoption ambiguous: "<title>"`. A file row can be adopted at most once per pass.
- **Re-keying:** adoption is one timestamp-neutral `UPDATE j2_notes SET import_key=? WHERE id=? AND user_id=? AND import_key=?`, which never touches `updated_at` or `imported_at`. That keeps `edited_since_import` true for an edited note, so the existing conflict rules apply unchanged: remote changed ⇒ `(synced copy)` sibling, unchanged ⇒ left alone.
- Ruling: in the same `UPDATE`, set `import_remote_rev = rn.updated_at`, but only when the stored rev parses to the same UTC second as `rn.updated_at`. A `.enex` exported from the same unchanged Evernote note then reads "remote unchanged" instead of "changed" merely because the two sources spell the time differently. When they differ, the stored rev is kept and the remote counts as changed, which is the conservative branch.
- An unedited adopted note is then updated in place by `import_confirm` like any synced note. No duplicate is ever created for a matched note.
- The seam runs on every pass, not only the first, because a later `.enex` import can add candidates. It runs only for providers that set `adopt_import_source`, so every other provider is byte-identical.

- [ ] **Step 1: Write the failing tests**

```python
def test_unedited_enex_note_is_adopted_and_updated_in_place_no_duplicate(tmp_db): ...
    # one row before, one row after, import_key == "evernote:guid:G", counts adopted == 1, created == 0
def test_edited_enex_note_remote_unchanged_is_left_alone(tmp_db): ...         # body and updated_at unchanged
def test_edited_enex_note_remote_changed_gets_synced_copy_sibling(tmp_db): ...
def test_two_file_notes_same_title_and_minute_are_not_adopted(tmp_db): ...      # both untouched; live note created; failure names the title
def test_plain_text_tie_break_adopts_the_single_match(tmp_db): ...
def test_trashed_file_note_is_never_adopted(tmp_db): ...                        # Review Focus 4
def test_adoption_matches_stripped_title_and_zone_spellings(tmp_db): ...         # Review Focus 5: "  Plan  " / "Plan"; "…Z" vs "…-05:00", ms
def test_adoption_does_not_touch_updated_at_or_imported_at(tmp_db): ...
def test_adoption_sets_remote_rev_only_when_same_instant(tmp_db): ...
def test_providers_without_the_attribute_are_unaffected(tmp_db): ...             # notion fake: zero adoption queries
def test_second_pass_adopts_nothing_and_changes_nothing(tmp_db): ...
# Amended (pre-flight):
def test_adopted_count_is_written_to_the_sync_log_row(tmp_db): ...              # j2_note_sync_log.adopted == 1 on the adopting pass, 0 on the next
def test_source_log_rows_carry_adopted(tmp_db): ...                             # GET /sources/{id}/log row has "adopted"
def test_status_counts_shape_is_unchanged(tmp_db): ...                          # /status counts keys == _ZERO_COUNTS keys (no "adopted")
def test_ambiguous_adoption_reaches_failures_json_in_plan_d_shape(tmp_db): ...  # failures_json == [{"noteTitle": "Plan", "reason": 'adoption ambiguous: "Plan"', "name": None}]
def test_provider_item_failures_reach_failures_json_and_error(tmp_db): ...      # fake provider with drain_item_failures -> entries in failures_json, reasons in the log row's error and result["failures"]
def test_adoption_uses_the_shared_instant_parser(tmp_db, monkeypatch): ...      # monkeypatch import_provenance.instant to a spy -> called for both created_at values
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_note_connectors_adoption.py -q`
Expected: FAIL with `ModuleNotFoundError: ... adoption`

- [ ] **Step 3: Implement `adoption.py` and the engine seam** (one `getattr`, one call, one count). Amended (pre-flight): also add the `adopted` column (three places in `db.py`), the `_finish_log` write, the `source_log` field, and the `drain_item_failures` read, as described above.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest api/services/journal_two/test_note_connectors_adoption.py api/services/journal_two/test_note_connectors_engine.py api/services/journal_two/test_note_connectors_db.py tests/test_note_sync_router.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/note_connectors/adoption.py api/services/journal_two/note_connectors/engine.py api/services/journal_two/db.py api/routers/note_sync.py api/services/journal_two/test_note_connectors_adoption.py api/services/journal_two/test_note_connectors_db.py
# Amended (pre-flight): add tests/test_note_sync_router.py too, only if a pinned /log key set had to change
git commit -m "feat(evernote): adopt .enex-imported notes into live sync by title and created minute, never duplicating or overwriting"
```

---

### Task 9: Messy live corpus and engine rails

**Files:**
- Create: `api/services/journal_two/note_connectors/corpora/evernote_live_messy.json`. This is a fake MCP dump: `search_notes` pages, `intrash:true` hits, `get_note` payloads, notebooks, tags and attachment specs.
- Modify: `api/services/journal_two/note_connectors/corpora/corpora_gen.py` (`CORPORA += ("evernote_live_messy",)`, `_run_evernote`)
- Create: `app/src/pages/journal-2-0/lib/importer/__fixtures__/connector_corpora/evernote_live_messy.json` (generated)
- Modify: `api/services/journal_two/note_connectors/test_connector_corpora.py`, `app/src/pages/journal-2-0/lib/connectorCorpora.dom.test.js` (`CORPORA` gains the third corpus)
- Test: `api/services/journal_two/test_note_connectors_evernote_engine.py`

**Interfaces:**
- Consumes: everything above, through `engine.sync_source` with the real `EvernoteProvider`. The MCP and the `storage.googleapis.com` downloads are served by `httpx.MockTransport` under the existing `no_network()` guard, and `base._resolve_host` is patched to `PUBLIC_TEST_ADDRESS`.
- Produces: corpus constructs used as test ids.

The corpus contains, at minimum:
- a table with a merged-looking header row
- an `en-todo` checklist with checked and unchecked items and text nested after `<en-todo/>`
- a `-en-codeblock` div
- nested ordered and unordered lists three levels deep
- `en-crypt`
- guid note links in both URL forms, with one target appearing only in pass 2
- a `/l/` share link to a note that exists, so it is title-healed
- web links, plus `javascript:` and relative hrefs
- attachments as PNG, JPEG, HEIC (`tests/fixtures/media/rotated_32x16_orient6.heic`), PDF, SVG, octet-stream PNG and a 26 MB declared `sizeBytes`
- an attachment whose first download answers 403 (expired) and second succeeds
- a missing-resource `en-media` and an unreferenced resource
- an image inside a note link
- a web clip with a source URL
- a 600 KB note, and an oversize note over the 1 MB body limit
- two notebooks in one stack plus one unstacked notebook
- 3 trashed notes, one of which was synced in pass 1
- one `.enex`-imported note seeded before pass 1, for adoption
- Amended (pre-flight): the dump uses the **measured** key names only (`notebookId`, `tags`, `created`, `updated`, `attributes`, `resources`; `get_attachment` `downloadUrl`, `expiresAt`, `mimeType`, `filename`, `sizeBytes`). It includes a note with `resources: null`, a search hit with `createdAt: null, updatedAt: null`, `tags` elements in both string and object form, and one attachment whose download 302-redirects off `storage.googleapis.com` (refused, named notice).
- Amended (pre-flight): `corpora_gen._run_evernote` emits `toolCalls` (the provider's `mcp.tool_calls` over every pass) and, per pass, `adopted` from the sync result, so the tests below read them.

Between passes, the member edits one note in UCT and the remote edits it too. The member also edits a second note whose remote stays unchanged.

- [ ] **Step 1: Write the failing tests**

```python
def test_evernote_corpus_fixture_is_current(run): ...                         # byte-equal, as the other corpora
def test_resync_is_idempotent(run):
    p = run["evernote_live_messy"]["members"]["u-evernote"]["passes"]
    assert p[2]["created"] == p[2]["updated"] == p[2]["mediaUploaded"] == 0   # pass 3 = no remote change
def test_edited_and_remote_changed_gets_synced_copy(run): ...
def test_edited_and_remote_unchanged_untouched(run): ...                      # updated_at equal before/after
def test_trashed_synced_note_is_tagged_source_deleted_not_erased(run): ...
def test_purged_note_needs_two_full_passes(run): ...
def test_token_rotation_mid_corpus(run): ...                                  # expired at pass 2 -> one refresh POST, rt rotated in store, pass 2 ok
def test_only_read_tools_were_called_in_any_pass(run):
    assert set(run["evernote_live_messy"]["toolCalls"]) <= evernote_mcp.READ_TOOLS
def test_oversize_attachment_is_a_too_large_notice(run): ...
def test_expired_attachment_url_recovers_on_retry(run): ...
def test_off_host_redirect_is_refused_and_named(run): ...                      # Amended (pre-flight)
def test_null_resources_note_imports_with_no_media(run): ...                   # Amended (pre-flight)
def test_no_evernote_note_shape_failures_on_measured_payloads(run): ...        # Amended (pre-flight): the gate criterion, proven on the corpus first
def test_oversize_note_is_isolated_and_named(run): ...
def test_enex_note_adopted_once_no_duplicate(run): ...
def test_nothing_is_left_as_an_import_placeholder(run): ...                   # already parametrized over CORPORA
```

The DOM rail (`connectorCorpora.dom.test.js`) runs over the third corpus unchanged: every stored body mounts in the real editor, every link is a clickable `<a href>`, and every image decodes.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_engine.py -q`
Expected: FAIL (no `evernote_live_messy` corpus)

- [ ] **Step 3: Build the dump, run `python -m api.services.journal_two.note_connectors.corpora.corpora_gen`, and inspect the stored notes.** Fix product code where a construct fails. Never fix the corpus to make a test pass.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest api/services/journal_two/test_note_connectors_evernote_engine.py api/services/journal_two/note_connectors/test_connector_corpora.py -q` and `cd app && npx vitest run src/pages/journal-2-0/lib/connectorCorpora.dom.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/note_connectors/corpora app/src/pages/journal-2-0/lib/importer/__fixtures__/connector_corpora/evernote_live_messy.json api/services/journal_two/note_connectors/test_connector_corpora.py app/src/pages/journal-2-0/lib/connectorCorpora.dom.test.js api/services/journal_two/test_note_connectors_evernote_engine.py
git commit -m "test(evernote): messy live corpus through the real engine: idempotence, conflict, delete, rotation, read-only"
```

---

### Task 10: The honest tile

Amended (pre-flight): **Branch.** This task is PR E2. Do it only after PR E1 has merged. Cut `feat/connector-fidelity-e-evernote-tile` from `feat/connector-fidelity-e-evernote` (`git switch -c feat/connector-fidelity-e-evernote-tile feat/connector-fidelity-e-evernote`), then `git rebase origin/master` so it sits on the merged E1. Commit and push only on that branch, and open PR E2 from it. Nothing from this task is committed on `feat/connector-fidelity-e-evernote`.

**Files:**
- Create: `app/src/pages/journal-2-0/components/connectors/evernoteCopy.js`
- Modify: `app/src/pages/journal-2-0/hooks/useNoteConnectors.js` (`NOTE_CONNECTOR_PROVIDERS` gains `{ key: 'evernote', label: 'Evernote', tokenKind: 'oauth', beta: true }`)
- Modify: `app/src/pages/journal-2-0/components/connectors/ConnectConsentPanel.jsx` (optional `notes` prop: `string[]`, rendered as a list above the checkbox)
- Modify: `app/src/pages/journal-2-0/components/connectors/ConnectedAppsCard.jsx`
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (`?import=evernote` opens the `ImportWizard` once and strips the param)
- Test: `ConnectedAppsCard.test.jsx`, `ConnectConsentPanel` cases in the same file, `ConnectTilesCompact.test.jsx`, `NotebookTab` import-param test

**Interfaces:**
- Produces, in `evernoteCopy.js`:
  - `EVERNOTE_CONNECT_NOTES = ["Live sync needs a paid Evernote plan (Personal or above). Evernote does not allow it on the Free plan.", "Beta: Evernote's connection for apps is in beta, so things may change.", "Notes you imported earlier from an .enex file are matched by title and created time and kept up to date, never duplicated. Notes you have edited here are never overwritten."]`
  - `EVERNOTE_ENEX_OFFER = "On Evernote Free? Import an .enex export instead."`
  - `EVERNOTE_PLAN_RETURN = "Evernote did not let us read this account. Live sync needs a paid Evernote plan. You can import an .enex export instead."`
  - `ENEX_IMPORT_HREF = "/journal/notebook?import=evernote"`

Tile behaviour:
- The tile shows a "Beta" pill (text, no emoji) next to the label whenever `p.beta`.
- When not configured for this member, the Evernote tile shows the `.enex` offer link **instead of** "Coming soon". The `.enex` import is the product they can use today.
- When configured, Connect opens `ConnectConsentPanel` with `notes={EVERNOTE_CONNECT_NOTES}`, and the `.enex` offer line sits under the panel.
- An OAuth return with `reason=evernote_plan` shows `EVERNOTE_PLAN_RETURN` plus the `.enex` link, never the raw reason.
- `ConnectTilesCompact` gets the same entry from the shared array, with no second list.

- [ ] **Step 1: Write the failing tests**

```js
it('evernote tile offers the .enex import instead of Coming soon when not configured', ...)
it('evernote consent panel lists the paid-plan, beta and adoption notes', ...)
it('evernote_plan return reason shows the plan sentence and the .enex link', ...)
it('evernote tile carries a Beta pill and no other tile does', ...)
it('notebook opens the import wizard once for ?import=evernote and strips the param', ...)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/connectors/ConnectedAppsCard.test.jsx src/pages/journal-2-0/components/connectors/ConnectTilesCompact.test.jsx`
Expected: FAIL (no evernote tile)

- [ ] **Step 3: Implement.** The `NotebookTab` param read uses `setImportOpen(true)`. It must not add a new key listener, so the key-listener census rail stays green. Amended (pre-flight): there is no single "existing mount effect" in `NotebookTab.jsx`. Copy the `?styles=1` effect pattern (`NotebookTab.jsx` near L447-453: `useState(() => searchParams.get('styles') === '1')` plus a `useEffect` on `[searchParams, setSearchParams]` that returns early unless the param is set, opens, then deletes the param with `setSearchParams(prev => …, { replace: true })`). The new effect reads `searchParams.get('import') === 'evernote'`, calls `setImportOpen(true)`, and deletes `import` the same way. It sits next to the `?styles=1` effect.

- [ ] **Step 4: Run the tests and confirm they pass,** including the census and first-open byte budget rails named in spec section 11.

Run: `cd app && npx vitest run src/pages/journal-2-0/components/connectors src/pages/journal-2-0/tabs/NotebookTab` (list the census and byte-budget test files by name from `app/src` before running; never run a whole directory you have not listed)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/connectors app/src/pages/journal-2-0/hooks/useNoteConnectors.js app/src/pages/journal-2-0/tabs/NotebookTab.jsx
git commit -m "feat(evernote): honest Evernote tile: beta, paid-plan notice, .enex offer, adoption note"
```

---

### Task 11: Live gate runbook, support email, deploy

**Files:**
- Create: `docs/notebook-connectors/evernote-live-gate.md`
- Modify: `docs/notebook-connectors/RESUME-connector-fidelity.md` (Plan E state + owner click points)
- Amended (pre-flight): `RESUME-connector-fidelity.md` does not exist on this branch today (`git ls-files` is empty); Plan A/B/D's copy may arrive with the rebase in Step 0. Check after Step 0 with `git ls-files docs/notebook-connectors/RESUME-connector-fidelity.md`: **create** it if absent, with a `# Connector fidelity: resume here` heading and a `## Plan E (Evernote live sync)` section; **append** a `## Plan E (Evernote live sync)` section at the end if it exists, never rewriting earlier sections.

No code. The runbook carries the steps below verbatim. Gate results are appended to `docs/notebook-connectors/60-user-reliability-certification.md` after the gate, never by rewriting earlier sections.

**Deploy shape**
- Amended (pre-flight): **PR E1, from branch `feat/connector-fidelity-e-evernote` (server, dark):** Tasks 1-9 and 11. Title: `feat(notebook): Evernote live sync, dark (NOTE_SYNC_EVERNOTE_ENABLED)`.
- Amended (pre-flight): **PR E2, from branch `feat/connector-fidelity-e-evernote-tile`:** Task 10 only. That branch is cut from `feat/connector-fidelity-e-evernote` after E1 merges and rebased onto master (Task 10's Branch note). While dark, the tile shows the `.enex` offer for everyone, which is true today.
- `requirements.txt` is unchanged, so neither PR needs `UCT_FLOW_OVERRIDE`, and either can merge at any hour. Paste the classification from `tools/flow_worker_watch_coverage.py` into the PR body.

**Owner click points, in order**
1. Amended (pre-flight): Merge PR E1 once it is green. The agent then cuts `feat/connector-fidelity-e-evernote-tile` (Task 10), opens PR E2, and asks again once E2 is green. Steps 2-5 below need only E1; the tile is not needed for the gate.
2. The agent runs `python tools/evernote_register_client.py` (no account needed) and hands over the printed id. The owner sets it on `web`: `railway variables --service web --set EVERNOTE_CLIENT_ID=<id> --set NOTE_SYNC_EVERNOTE_ENABLED=admin`. The agent then confirms a real boot (uptime reset) and checks that `GET /api/j2/notes/connectors/status`, read as the owner, shows `evernote.configured: true`. Owner only: the flag is `admin`.
   - Amended (Task 6 review m6): **never set `NOTE_SYNC_EVERNOTE_ENABLED` (admin or 1) on a build that does not contain Task 7.** Before Task 7 the connect door has no per-member gate and `_start_oauth` falls into the Dropbox branch for `evernote`. Confirm Task 7's commit is an ancestor of the deployed SHA first.
3. Optional but recommended for adoption: in Evernote desktop, export ONE notebook to `.enex`, then import it in UCT (Notebook → Import).
4. In UCT Settings → Connections → Evernote → Connect → approve Evernote's read-access consent page (one sign-in).
5. In Evernote: create a note `UCT gate probe` with one image and one link, then press Sync now in UCT. Edit that note in Evernote and press Sync now. Trash it and press Sync now.

**Gate criteria** (the agent reads them; the owner does not re-measure)

Amended (pre-flight): every criterion names where it is read, and reads only something that exists after Tasks 1-9. "Log" means `GET /api/j2/notes/connectors/sources/{id}/log` read as the owner; "Sync now response" means the JSON `POST /api/j2/notes/connectors/sources/{id}/sync` returns.
- Created = 215 active notes, with no duplicates of adopted `.enex` notes. Read: the first pass's log row `created` plus `adopted` (Task 8's column) accounts for 215, and `adopted` = the step 3 notebook's note count.
- 0 trashed notes imported (73 in trash). Read: the same totals match the 215 active notes exactly, and no Notebook note carries a title that only exists in Evernote's trash (spot-check three).
- All 6 image notes render every image from UCT storage. Read: open each in the Notebook.
- Zero `evernote note shape:` failure strings. Read: every log row's `failures` (from `failures_json`, Task 8) and the Sync now response's `failures`.
- A second Sync now with no remote change gives created 0, updated 0, mediaUploaded 0. Read: the Sync now response (`created`, `updated`, `mediaUploaded`; the log rows do not carry `mediaUploaded`).
- The probe note: created, then updated, then tagged `source-deleted` (not erased). Read: log rows `created`/`updated`/`sourceDeleted` per pass, and the note itself.
- Every link in the probe note is clickable. Read: open the note.
- Only read tools are ever called. Read: nothing at the gate. No log stores tool names, so this criterion rests on the rails (Task 1 allow-list tests, Task 5 `test_provider_only_ever_calls_read_tools`, Task 9 `test_only_read_tools_were_called_in_any_pass`), which must be green on the merged SHA.
- Amended (pre-flight): **Record the unmeasured shapes.** Read the `evernote note shape sample:` INFO line (Task 5) from `railway logs --service web` after the first pass, and copy it into `evernote-live-gate.md` and `docs/notebook-connectors/evernote-mcp-probe.md` under "Measured field names" (append only): the `tags` element type and keys, and the `attributes` keys. Also record whether either `search_notebooks` or `search_tags` hit the 100 cap (the warning lines), and record one real `downloadUrl` **host** (host only, never the signed query). If the `tags` or `attributes` shape differs from what Task 5 accepts, or the host is not exactly `storage.googleapis.com`, the gate stops and the plan is amended before members.

- Amended (Task 6 review R2): **The complete listing succeeds on the owner's account.** Read: after the first nightly full pass (or a member Sync now), the log row's `error` carries NO `list_present_refs sweep failed`, the Sync now response's `removalCheck.ran` is true, and `j2_note_sources.removal_skips` for the Evernote source is 0. A skipped removal check means real deletions cannot propagate; three in a row turn the source amber ("Couldn't check which notes were deleted in Evernote for 3 nights — retrying"). If the count check (`totalResultCount` vs unique ids) never matches on the real account, the gate stops.

**Assumption the gate relies on: one process refreshes a member's Evernote credential** (Task 2 review m3). The per-user refresh lock in `evernote_oauth` is a `threading.Lock`, so it is process-local; only the DB compare-and-swap spans processes. The CAS stops one process overwriting another's newer token, but it cannot stop two processes from both POSTing the same refresh token. Many rotating-token servers treat a replayed (spent) refresh token as theft and revoke the whole token family (OAuth 2.1 section 4.3.1); whether Evernote does this is not measured. Today the `web` pod is one uvicorn process, so this cannot happen in production. Therefore: no local tool, script, second replica or second `web` instance may refresh a member's Evernote credential while this holds. Anything that scales `web` past one process, or adds a second refresher, re-opens this point first. Record this assumption in `evernote-live-gate.md`.

A failing criterion means the flag returns to `0` with a redeploy, and the cause is recorded in the runbook.

6. The owner sends the support email below, and waits for the answer before step 7.
7. The owner decides on members: `NOTE_SYNC_EVERNOTE_ENABLED=1`, or keep `admin`. The ledger entry becomes `armed` in the same change.

**Rollback:** `railway variables --service web --set NOTE_SYNC_EVERNOTE_ENABLED=0`. A `--set` redeploys; still confirm a real boot from the pod. Because `_build_evernote` refuses when the flag is off, syncs stop, and imported notes stay. A `delete` of the variable needs `railway redeploy --service web --yes` afterwards (see CLAUDE.md, "`--set` REDEPLOYS, `delete` DOES NOT").

**Draft email to Evernote support (owner sends from their account)**

> Subject: Third-party read-only sync over the Evernote MCP server (beta): is scheduled use allowed?
>
> Hello,
>
> I run UCT Intelligence (uctintelligence.com), a trading journal with a notebook. I'm an Evernote Advanced subscriber. We'd like to let our members who are on paid Evernote plans keep their notes synced one way into our notebook, using your hosted MCP server at mcp.evernote.com with OAuth (dynamic client registration, PKCE, read scope only).
>
> How it would work: after a member signs in and consents, our server would call only read tools (search_notes, get_note, get_attachment, search_notebooks, search_tags) on a schedule. That would be about every 30 minutes, plus a nightly full listing to notice deleted notes, with no person present. It never writes to Evernote, and it backs off on any 429.
>
> Before we offer this to anyone but me, could you confirm:
> 1. Whether scheduled, unattended read access like this is permitted for a third-party app on the MCP beta.
> 2. Whether there are rate limits we should stay under (per user or per client).
> 3. Whether the registered client could be removed when the beta ends, and how we would hear about changes.
>
> Thank you,
> Patrick, UCT Intelligence

- [ ] **Step 0: Amended (pre-flight): rebase onto master after Plan C merges, before E1's PR is opened.** Plan C (`feat/connector-fidelity-c-server`) lands first. Wait until it is on `origin/master`, then `git fetch origin && git rebase origin/master` on `feat/connector-fidelity-e-evernote`. Six files are edited by both plans. Resolve each by hand, never with "ours" or "theirs":
  1. `api/routers/note_sync.py` (HIGH: same import block, same `get_status` provider loop). Keep all of Plan C's imports and Obsidian routes; put E's imports (`evernote_oauth`, `EvernoteProvider`) on new lines after C's; add E's `get_status` change as one call to `registry.provider_allowed_for` on its own line inside C's loop. Then run `tests/test_note_sync_router.py`, `tests/test_note_sync_router_evernote.py` and the Obsidian router tests (list them by name with `git ls-files 'tests/test_note_sync_router*' 'tests/*obsidian*'`).
  2. `app/src/pages/journal-2-0/hooks/useNoteConnectors.js`. Keep C's `normalizeSource` change. Note: E's `NOTE_CONNECTOR_PROVIDERS` entry is Task 10, so on the E1 rebase this file should not conflict; it matters again when E2 is cut.
  3. `app/src/pages/journal-2-0/hooks/useNoteConnectors.test.js`. Keep both changes, and derive the expected provider-key list from `NOTE_CONNECTOR_PROVIDERS` so neither plan retypes it (also E2-relevant).
  4. `api/services/journal_two/note_connectors/test_connector_corpora.py`. Keep C's edits (L295, L649, L742 on C's base); add E's `CORPORA`-driven tests and `_run_evernote` wiring by hand.
  5. `app/src/pages/journal-2-0/lib/connectorCorpora.dom.test.js`. Keep C's `CONSTRUCTS` change; add `evernote_live_messy` to `CORPORA`/`ALL` by hand.
  6. `docs/feature_flags.json`. Keep both entries (`NOTE_SYNC_OBSIDIAN_ENABLED` from C, `NOTE_SYNC_EVERNOTE_ENABLED` from E) in alphabetical order; run `tests/test_feature_flag_ledger.py` (duplicate-key rail).

  Also, not a file conflict: E's ENML parity rail runs through C's `convert.js::htmlToNote`. After the rebase, regenerate (`python -m api.services.journal_two.note_connectors.convert.enml_parity_fixtures_gen` and `python -m api.services.journal_two.note_connectors.corpora.corpora_gen`), commit any change, and rerun Task 4's and Task 9's test commands. The connector component files (`components/connectors/*`) do not overlap by file; rerun the connector component tests once both are on master. After Steps 1-3 below, push `feat/connector-fidelity-e-evernote` (a rebased branch that was pushed before needs `--force-with-lease`, on this feature branch only, never on master) and open PR E1.
- [ ] **Step 1: Write `evernote-live-gate.md`** with the deploy shape, click points, gate criteria, rollback and email above.
- [ ] **Step 2: Update the RESUME file** with Plan E's PRs and click points. Amended (pre-flight): create it if absent or append a section if present, as stated under Files above.
- [ ] **Step 3: Commit**

```bash
git add docs/notebook-connectors/evernote-live-gate.md docs/notebook-connectors/RESUME-connector-fidelity.md
git commit -m "docs(evernote): live gate runbook, rollback and Evernote support email"
```
