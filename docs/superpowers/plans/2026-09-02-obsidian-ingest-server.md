# Wave 3a — Obsidian Ingest (server side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server half of the Obsidian door — a push transport that lets a vault send its notes to UCT, reusing the existing pull engine wholesale rather than re-implementing any of it.

**Architecture:** The plugin pushes batches into a **staging area**; an `ObsidianProvider` reads staging and satisfies the ordinary `NoteProvider` contract; the existing engine then pulls from that provider exactly as it pulls from Notion. One authority, two transports. The vault's file manifest feeds the engine's existing optional `list_present_refs` hook, so delete detection is inherited, not rebuilt.

**Tech Stack:** Python 3 / FastAPI / sqlite3 (stdlib) / Fernet via the existing `crypto_box` + `NOTE_ENCRYPTION_KEY` family. Frontend: React + vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-notebook-migration-program-design.md` §7

## Scope: why this is 3a and not all of Wave 3

Wave 3 has two artifacts. **This plan is the server half only**, and it lives in this repo. The TypeScript plugin is a *separate public GitHub repo* (Obsidian's directory requires one) and is planned separately as 3b.

That split is deliberate, not a shortcut:
- The server half is the larger and riskier half — auth, tenancy, staging, delete-detection semantics — and it is **fully testable here today**, with no Obsidian vault and no account.
- The plugin half cannot be live-gated without a real vault, which the owner does not yet have.
- A mock plugin (an HTTP client that speaks the ingest protocol) gates the server half completely, and is what Task 6 builds.

⛔ **Do not build the plugin inside this repo.** A plugin submitted to Obsidian's directory must be its own repo with its own release artifacts; embedding it here would have to be undone.

## Global Constraints

- ⛔ **ONE AUTHORITY, TWO TRANSPORTS.** The ingest path must NOT write `j2_notes` directly. It converts pushed payloads into the same `RemoteNote` shape pull providers emit and hands them to the **existing** convert → upsert → conflict → media path in `note_connectors/engine.py`. Duplicating the conflict ratchet, delete detection, media phase or import-hash logic is the defect this whole design exists to avoid — this repo has been burned by "four readers of one envelope, three of them wrong."
- ⛔ **The conflict ratchet is inherited, not re-implemented.** Once a member edits a synced note in UCT, `imported_at` freezes and remote changes fork to `{key}#remote`. That behaviour must arrive for free by going through the engine.
- **Device tokens are encrypted** in the existing `NOTE_ENCRYPTION_KEY` family via `crypto_box` — the same treatment broker and connector tokens get. Never store a raw token.
- **Connect codes mirror `oauth.py`'s state discipline**: HMAC-signed, short TTL, single-use, and **fail closed** (503) when no signing secret is configured. Read `oauth.py` and match it rather than inventing a second scheme.
- **Migrations** are flag-gated in `DATA_DIR`, idempotent by construction, created after prior migrations in `ensure_schema`, each wrapped in try/except that prints so a failure never crashes startup.
- **A new column goes in BOTH** `_J2_SCHEMA` and the ALTER list — `first_image_url` in only one cost 7 suite reds.
- ⛔ **Everything stays behind `NOTE_SYNC_ENABLED`** plus a per-provider gate, like every other connector. Register any new flag in the ledger; a flag defaulting off and set nowhere is indistinguishable from one off on purpose.
- **Tenancy is scoped in SQL, never filtered in Python.** Ingest accepts data from a device token; that token maps to exactly one user and nothing it pushes may land under another.
- Read every test summary line; its absence means the run did not finish.
- Backend tests run from the repo root; vitest runs from `app/`.

## File Structure

| File | Responsibility |
|---|---|
| `api/services/journal_two/db.py` | schema for 3 new tables + `run_notebook_migration_v6` |
| `api/services/journal_two/note_connectors/obsidian_link.py` | **new** — connect-code mint/exchange + device-token lifecycle |
| `api/services/journal_two/note_connectors/obsidian_staging.py` | **new** — staging writes (from ingest) and reads (for the provider) |
| `api/services/journal_two/note_connectors/providers/obsidian.py` | **new** — the `NoteProvider` over staging, incl. `list_present_refs` |
| `api/services/journal_two/note_connectors/registry.py` | register the provider |
| `api/routers/note_sync.py` | connect-code + ingest endpoints |
| `app/src/pages/journal-2-0/components/connectors/` | connect-code UI in the existing tile |

---

## Task 1: Schema and migration v6

**Files:** Modify `api/services/journal_two/db.py`. Test: `api/services/journal_two/test_obsidian_link.py` (create).

**Interfaces:** Produces tables `j2_obsidian_devices`, `j2_obsidian_staging`, `j2_obsidian_manifest`; `run_notebook_migration_v6(conn)`.

- [ ] **Step 1: Write the failing test**

```python
"""Obsidian ingest schema. The staging table is the seam that lets a PUSH
transport reuse the PULL engine: the plugin writes here, the provider reads
here, and the engine never learns there was a difference."""
import sqlite3
from api.services.journal_two.db import ensure_schema


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def test_the_three_tables_exist():
    c = _conn()
    names = {r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'j2_obsidian%'")}
    assert names == {"j2_obsidian_devices", "j2_obsidian_staging", "j2_obsidian_manifest"}


def test_a_device_token_is_unique_per_vault_and_user():
    c = _conn()
    args = ("dev1", "u1", "vault-abc", "enc-token", "My Vault", "2026-09-02T00:00:00Z")
    c.execute("INSERT INTO j2_obsidian_devices (id, user_id, vault_id, token_enc,"
              " label, created_at) VALUES (?,?,?,?,?,?)", args)
    c.commit()
    try:
        c.execute("INSERT INTO j2_obsidian_devices (id, user_id, vault_id, token_enc,"
                  " label, created_at) VALUES (?,?,?,?,?,?)",
                  ("dev2", "u1", "vault-abc", "enc2", "Dup", "2026-09-02T00:00:00Z"))
        raise AssertionError("a second device for the same (user, vault) was allowed")
    except sqlite3.IntegrityError:
        pass


def test_staging_rows_are_scoped_to_a_user_and_keyed_by_vault_path():
    c = _conn()
    c.execute("INSERT INTO j2_obsidian_staging (user_id, vault_id, vault_path,"
              " content_hash, body_md, updated_at, received_at)"
              " VALUES (?,?,?,?,?,?,?)",
              ("u1", "v1", "Notes/idea.md", "h1", "# Idea", "2026-09-02T00:00:00Z",
               "2026-09-02T00:00:01Z"))
    c.commit()
    row = c.execute("SELECT user_id, vault_path FROM j2_obsidian_staging").fetchone()
    assert (row["user_id"], row["vault_path"]) == ("u1", "Notes/idea.md")
```

- [ ] **Step 2: Run to verify it fails** — `python -m pytest api/services/journal_two/test_obsidian_link.py -v`. Expected: no such table.

- [ ] **Step 3: Add the tables to `_J2_SCHEMA`**, beside the existing `j2_note_*` connector tables:

```sql
-- ── Obsidian ingest (Wave 3a) ───────────────────────────────────────────────
-- A PUSH transport that reuses the PULL engine. The plugin writes staging
-- rows; providers/obsidian.py reads them and satisfies the ordinary
-- NoteProvider contract, so the engine's convert/upsert/conflict/media path
-- and its delete detection are INHERITED, never re-implemented.
CREATE TABLE IF NOT EXISTS j2_obsidian_devices (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    vault_id     TEXT NOT NULL,
    token_enc    TEXT NOT NULL,
    label        TEXT,
    last_seen_at TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE(user_id, vault_id)
);
CREATE INDEX IF NOT EXISTS idx_j2_obsidian_devices_user
    ON j2_obsidian_devices(user_id);

-- One row per vault file currently pushed. `content_hash` lets a re-push of
-- an unchanged file be a no-op without re-converting it.
CREATE TABLE IF NOT EXISTS j2_obsidian_staging (
    user_id      TEXT NOT NULL,
    vault_id     TEXT NOT NULL,
    vault_path   TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    body_md      TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    received_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, vault_id, vault_path)
);

-- The vault's COMPLETE file list at the last full push. This is what feeds
-- the engine's existing optional `list_present_refs` hook, so a file deleted
-- in the vault is detected by the SAME machinery that detects a deleted
-- Notion page. Nothing bespoke.
CREATE TABLE IF NOT EXISTS j2_obsidian_manifest (
    user_id     TEXT NOT NULL,
    vault_id    TEXT NOT NULL,
    vault_path  TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (user_id, vault_id, vault_path)
);
```

- [ ] **Step 4: Add `run_notebook_migration_v6`** after v5, following v3's shape exactly (brand-new tables, so table-existence probe plus `CREATE TABLE IF NOT EXISTS`, no ALTERs), flag `.notebook_migration_v6`, and the encoding-safe flag write (`tmp` then `os.replace`) with `flag.parent.mkdir(parents=True, exist_ok=True)`.

- [ ] **Step 5: Call it from `ensure_schema`** after v5, wrapped in the same try/except-and-print used by v1–v5.

- [ ] **Step 6: Run tests, then commit**

```bash
git add api/services/journal_two/db.py api/services/journal_two/test_obsidian_link.py
git commit -m "feat(obsidian): staging + device schema for the push transport"
```

---

## Task 2: Connect codes and device tokens

**Files:** Create `api/services/journal_two/note_connectors/obsidian_link.py`; test in `test_obsidian_link.py`.

**Interfaces:** Produces `mint_connect_code(user_id) -> str`, `redeem_connect_code(code, vault_id, label) -> tuple[str, str]` returning `(device_id, raw_token)`, and `authenticate_device(raw_token) -> dict | None`.

**Why this shape:** the plugin cannot run an OAuth browser flow inside Obsidian. A short-lived code the member copies once, exchanged for a long-lived device token, is the shortest honest path — and it mirrors machinery this repo already trusts.

- [ ] **Step 1: Write the failing tests** — covering: a code redeems exactly once; a second redemption fails; an expired code fails; a tampered code fails; the stored token is NOT the raw token; `authenticate_device` returns the right user for a valid token and `None` for garbage; and **a token belonging to user A never authenticates as user B**.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** Read `note_connectors/oauth.py` FIRST and mirror its state discipline — HMAC over a secret, TTL, single-use, and **fail closed with 503 when the secret is unset**. Encrypt the device token with `crypto_box` in the `NOTE_ENCRYPTION_KEY` family; store only the ciphertext plus a lookup hash. ⛔ Do not invent a second signing scheme; if `oauth.py`'s helper can be reused directly, reuse it.

- [ ] **Step 4: Run tests. Step 5: Commit.**

---

## Task 3: The ingest endpoint

**Files:** Modify `api/routers/note_sync.py`; create `obsidian_staging.py`; test `api/services/journal_two/test_obsidian_ingest.py`.

**Interfaces:** `POST /api/j2/notes/connectors/obsidian/ingest` — device-token auth, body carries a batch of `{vault_path, content_hash, body_md, updated_at}` plus an optional `manifest` (the vault's complete path list) and a `final` flag.

- [ ] **Step 1: Write the failing tests** — an authenticated batch lands in staging; an unauthenticated one is refused; **a batch cannot write under another user** even if it claims a different `user_id`; an unchanged `content_hash` is a no-op; a manifest replaces the prior manifest atomically; an oversized batch is refused with a clean 4xx.

- [ ] **Step 2: Run to verify failure. Step 3: Implement.**

Requirements: the endpoint is **paid-gated and consent-gated** like the other connector endpoints — read how `note_sync.py` does it and match. Body size is capped. The manifest is only replaced when `final` is true, so a partial push never makes the engine think files were deleted. ⛔ **The endpoint writes ONLY to staging tables — never to `j2_notes`.**

- [ ] **Step 4: Run tests. Step 5: Commit.**

---

## Task 4: The provider over staging

**Files:** Create `providers/obsidian.py`; test `api/services/journal_two/test_obsidian_provider.py`.

**Interfaces:** Consumes `providers/base.py`'s `NoteProvider`. Produces a provider implementing `validate`, `list_changed`, `fetch`, `fetch_many`, `fetch_media`, and — critically — `list_present_refs`.

**This is the task that makes the whole design work.** Read `providers/base.py` and `engine.py`'s docstring on `list_present_refs` before writing anything: the hook is checked via `getattr` and supplies the COMPLETE remote set for delete detection while `list_changed` drives content fetch. The manifest table is exactly that complete set.

- [ ] **Step 1: Write the failing tests** — `list_changed` returns refs for staged rows newer than the cursor; the opaque cursor advances and is honoured; `fetch` converts a staged markdown body via the EXISTING server-side markdown→TipTap converter (do not write a second one); `list_present_refs` returns the manifest's complete path set; and **a note staged for user A is never returned for user B**.

- [ ] **Step 2: Run to verify failure. Step 3: Implement.**

⛔ Conversion is already built — `convert/mddoc.py` turns markdown into TipTap, and the file importer's `adapters/obsidian.js` documents the proven Obsidian pre-passes (`[[wikilinks]]`, `==highlight==` → `<mark>`, task lists). If a pre-pass is missing server-side, port it into `convert/` and rail BOTH lanes against shared fixtures — do not hand-copy, and note this repo's lesson about one grammar becoming N hand-written copies.

- [ ] **Step 4: Run tests. Step 5: Commit.**

---

## Task 5: Registry, flag and the connect UI

**Files:** `registry.py`; the connectors components under `app/src/pages/journal-2-0/components/connectors/`.

- [ ] **Step 1:** Register `obsidian` in `registry._REGISTRY` with `connect_kind` reflecting the code flow (neither the existing `"token"` paste nor `"oauth"` redirect — read the registry's own contract and extend it honestly rather than mislabelling).
- [ ] **Step 2:** UI: a tile that mints a connect code, shows it once with copy-to-clipboard, and explains in plain words what the plugin will send. Touch targets >=44px, touch tier <=1024px not <=640px. No generic emoji — use `UIcon`.
- [ ] **Step 3:** Tests both sides; commit.

---

## Task 6: The live gate — a mock plugin over real HTTP

**Files:** a gate script in the session scratchpad (not committed), per this repo's convention for `live_gate_app.py` / `run_connectors_gate.py`.

**This is the task that decides whether Wave 3a is done.** Unit tests do not prove a transport works.

- [ ] **Step 1:** Write a mock plugin: an HTTP client that mints a connect code, redeems it, pushes a small vault in batches with a manifest, and re-pushes with one file changed, one added and one deleted.
- [ ] **Step 2:** Run the full lifecycle against a locally-running backend and assert, **from the database**: notes created; a changed file updates in place; a deleted file is detected via `list_present_refs` and tagged by the ENGINE's existing delete detection; a note edited in UCT is NOT overwritten and its remote change forks to `{key}#remote` — the inherited conflict ratchet.
- [ ] **Step 3:** Record the results in the report. ⛔ A local backend is safe to run (`vendor_socket_guard`); never set `ALLOW_LOCAL_VENDOR_SOCKETS`. Point it at a throwaway data dir — `C:\data` is live production data on this box.

---

## Self-Review

**Spec coverage (§7):** transport (Tasks 1–4) · one-authority rule (Task 4, enforced by construction) · connect code (Task 2) · UI (Task 5) · delete detection via manifest (Tasks 3–4, inherited) · conflict ratchet (inherited, gated in Task 6).

**Deliberately NOT in this plan:** the TypeScript plugin and its Obsidian-directory submission (3b, separate repo, needs a vault to gate); the directory's disclosure/privacy requirements, which belong with the plugin's README.

**Type consistency:** `redeem_connect_code` returns `(device_id, raw_token)` in Task 2 and is consumed under those names in Task 3. `list_present_refs` matches the engine's existing `getattr` hook signature — verify against `engine.py` before implementing, and correct this plan if it has drifted.
