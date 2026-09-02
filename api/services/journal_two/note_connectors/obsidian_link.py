"""Connect codes and device tokens for the Obsidian ingest push transport
(Task 2 of the 2026-09-02-obsidian-ingest-server plan).

Obsidian is a desktop app -- a plugin cannot run an OAuth browser-redirect
flow inside it (`note_connectors/oauth.py` exists for exactly that class of
flow and cannot be reused here, for the SAME reason it exists: there is no
browser to redirect). The shortest honest substitute: the member copies a
short-lived CONNECT CODE from the dashboard once, pastes it into the
Obsidian plugin, and the plugin exchanges it for a long-lived DEVICE TOKEN
it stores locally and sends on every subsequent push.

Three entry points (task brief, verbatim signatures):
  - `mint_connect_code(user_id) -> str` -- an opaque, signed, time-bounded,
    single-use code identifying the connecting user.
  - `redeem_connect_code(code, vault_id, label) -> (device_id, raw_token)`
    -- verifies the code (exactly once), then mints or ROTATES a device
    row in `j2_obsidian_devices` and returns the plaintext token the
    plugin will store. This is the ONLY place a raw device token is ever
    computed and handed out.
  - `authenticate_device(raw_token) -> dict | None` -- the read side every
    later request (Task 3's ingest endpoint) calls on every push. Returns
    `None` for anything that isn't a currently-valid token for SOME
    device; never raises for a bad/garbage token.

Reuse vs. mirror -- read before changing either side:
  `note_connectors/oauth.py` implements OAuth *token exchange* (client
  credentials against a provider's own token endpoint) -- it has no
  connect-code analogue to call directly; a connect code authenticates
  nothing external and mints nothing from a third party. The HMAC-signed,
  TTL-bounded, single-use STATE VALUE this module's connect code actually
  resembles lives in `api/routers/note_sync.py` as `_state_secret` /
  `_sign_state` / `_verify_state` -- private to that router, not exported,
  and out of THIS task's file scope to touch (this task may only create
  `obsidian_link.py` and append to `test_obsidian_link.py`), so it cannot
  be called directly either. This module therefore follows that shape
  exactly rather than inventing a second scheme: HMAC-SHA256 over a
  `PUSH_SECRET`/`VOICE_ACTION_SECRET` signing secret, an embedded
  timestamp + random nonce, single-use enforcement via a process-local
  used-nonce set (same accepted single-process-pod shape as
  `oauth._refresh_locks` / `note_sync._used_state_nonces`), and the SAME
  fail-closed discipline: no signing secret configured raises
  `errors.NoteConnNotConfigured` (never signs/verifies against a
  hardcoded, source-visible fallback). A forgeable code would let anyone
  who can read this repo mint a connect code for an ARBITRARY user_id --
  a cross-tenant WRITE (a device that can push notes into someone else's
  vault-side notebook), which is the same class of harm `note_sync.py`'s
  own `_state_secret` docstring calls out, not a milder one.

Encryption at rest: the device's secret half is encrypted with
`crypto_box.NoteBox` (`NOTE_ENCRYPTION_KEY` family -- the SAME key family
`note_connectors/connections.py` uses for every OAuth/token-paste
connector's stored credential), never the broker family.
`j2_obsidian_devices.token_enc` never holds plaintext.

Lookup without decrypting every row: Task 1's schema
(`j2_obsidian_devices`) has no separate lookup-hash column -- but `id`
(the device's own primary key) already IS a unique lookup value, so the
raw token this module hands out is `"{device_id}:{secret}"`.
`authenticate_device` splits on the first `:` and does an indexed
primary-key lookup by `device_id` BEFORE ever touching `crypto_box` --
decryption happens for at most the one candidate row, never a table scan.
The `device_id` half is not secret (it is a lookup key, the same shape as
a Stripe/GitHub token's visible prefix); only the half after the colon is
compared, constant-time, against the decrypted stored secret.

Re-connect behaviour (a member reinstalls the plugin, or reconnects the
same vault -- `UNIQUE(user_id, vault_id)` from Task 1 WILL collide):
chosen behaviour is ROTATE, not refuse. `redeem_connect_code` finds the
existing device row for (user_id, vault_id) and issues it a brand-new
secret (the old raw token stops working the moment the new one is
written) while keeping the same `device_id` and, unless a new one is
supplied, the same label. A reinstall is a normal thing a member will do
(new machine, vault moved, plugin data cleared) and refusing it would
dead-end them with no recovery path short of manual admin intervention;
rotating is exactly what `note_connectors/connections.py::
upsert_connector` already does for every OAuth/token-paste reconnect
("supplying a fresh token is exactly the reconnect action that should
clear a prior state") -- same idiom, applied to a primary-key row instead
of a (user_id, provider) row.

Spec: .superpowers/sdd/2026-09-02-obsidian-ingest-server/task-2-brief.md
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services import crypto_box
from api.services.auth_db import get_connection

from . import errors

# 15 minutes: wide enough for a member to alt-tab into Obsidian and paste
# by hand -- a slower human copy/paste hop than note_sync.py's 10-minute
# OAuth state TTL, which only has to survive an automated browser redirect
# that completes in seconds once the user clicks through.
_CONNECT_CODE_TTL_SECONDS = 900

# Process-local single-use tracking -- mirrors note_sync.py's
# `_used_state_nonces` exactly (same comment applies here): a leaked code
# (screen share, clipboard sync, shoulder surf) would otherwise be valid
# and replayable for its whole TTL. Lost on process restart -- an
# accepted, bounded gap for a value that already requires the signing
# secret to forge. Collision risk between two tests/processes is
# effectively zero (each nonce is a fresh `secrets.token_urlsafe(16)`).
_used_connect_code_nonces: dict[str, float] = {}

# I6 (2026-09-02 review): "a pre-disconnect code redeems afterward into a
# full reconnection (device + connector + source)" -- single-use nonce
# tracking alone does nothing for a code that was minted but never yet
# redeemed at disconnect time. Process-local per-user epoch counter (same
# accepted single-pod shape as `_used_connect_code_nonces` above): every
# mint embeds the user's CURRENT epoch in the signed payload;
# `invalidate_outstanding_codes` (called from `revoke_devices` below, on
# every disconnect) bumps it. A code minted under an epoch that has since
# been bumped fails `_verify_connect_code`'s epoch check even though its
# HMAC/TTL/single-use checks all still pass on their own. Embedding the
# epoch IN the signed payload (rather than comparing the code's mint
# timestamp against a separately-tracked "disconnected at" wall-clock
# value) makes this tamper-evident for free and immune to same-second
# wall-clock ties a timestamp comparison would have to reason about.
_connect_code_epoch: dict[str, int] = {}


def _current_epoch(user_id: str) -> int:
    return _connect_code_epoch.get(user_id, 0)


def invalidate_outstanding_codes(user_id: str) -> None:
    """Bumps `user_id`'s connect-code epoch so every code minted *before*
    this call fails `_verify_connect_code`'s epoch check from now on, while
    a code minted *after* this call (a genuine post-disconnect reconnect)
    embeds the new epoch and verifies normally -- this closes the
    redeem/revoke race without touching the redeem/reconnect path at all.
    Idempotent-safe to call repeatedly (each call moves the epoch strictly
    forward, so calling it twice in a row is harmless, just extra-safe)."""
    _connect_code_epoch[user_id] = _current_epoch(user_id) + 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _signing_secret() -> bytes:
    """FAILS CLOSED -- mirrors `note_sync.py::_state_secret` byte for
    byte, including its env-var precedence (the same one used by every
    other HMAC-signed, time-bounded value in this codebase: calendar.py's
    export-token, note_sync.py's OAuth state). Raises
    `errors.NoteConnNotConfigured` rather than signing or verifying
    against a constant, source-visible fallback -- a forged connect code
    would mint a device token that WRITES notes under an arbitrary
    user_id, a cross-tenant write."""
    s = os.environ.get("PUSH_SECRET", "") or os.environ.get("VOICE_ACTION_SECRET", "")
    if not s:
        raise errors.NoteConnNotConfigured(
            "Obsidian connect-code signing is not configured (set PUSH_SECRET)"
        )
    return s.encode("utf-8")


def _prune_used_nonces() -> None:
    now = time.time()
    expired = [n for n, exp in _used_connect_code_nonces.items() if exp <= now]
    for n in expired:
        _used_connect_code_nonces.pop(n, None)


def mint_connect_code(user_id: str) -> str:
    """An opaque, signed, time-bounded, single-use code identifying
    `user_id`. Shown to the member once; they paste it into the Obsidian
    plugin. Raises `errors.NoteConnNotConfigured` (fail closed) if no
    signing secret is configured -- never returns a code an attacker with
    read access to this repo's source could forge.

    Embeds `user_id`'s CURRENT connect-code epoch (I6, 2026-09-02 review) --
    see `invalidate_outstanding_codes`'s docstring for why a disconnect
    bumping this epoch makes every code minted before it permanently
    unredeemable, with no wire-format ambiguity and no wall-clock race."""
    secret = _signing_secret()
    ts = str(int(time.time()))
    nonce = secrets.token_urlsafe(16)
    epoch = _current_epoch(user_id)
    payload = f"{user_id}:{ts}:{nonce}:{epoch}"
    sig = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    raw = f"{payload}:{sig}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")


def _verify_connect_code(code: str) -> str:
    """Returns the embedded `user_id` on success. Raises
    `errors.NoteConnAuthError` on ANY failure -- malformed, bad signature,
    expired, already-used, or minted under an epoch a disconnect has since
    invalidated (I6) -- a single generic message so a probing caller learns
    nothing about which check failed (mirrors `note_sync.py::_verify_state`'s
    generic-failure discipline). Raises `errors.NoteConnNotConfigured` when
    no signing secret is configured at all -- a distinct, server-side-only
    signal, never confused with a client-supplied bad code."""
    bad = errors.NoteConnAuthError("invalid or expired connect code")
    try:
        raw = base64.urlsafe_b64decode(code.encode("utf-8")).decode("utf-8")
        user_id, ts_str, nonce, epoch_str, sig = raw.split(":", 4)
    except Exception:
        raise bad
    if not user_id or not nonce:
        raise bad
    secret = _signing_secret()  # NoteConnNotConfigured propagates uncaught
    payload = f"{user_id}:{ts_str}:{nonce}:{epoch_str}"
    expected = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    # BYTES, not str: `sig` was decoded from an attacker-controlled base64
    # blob via .decode("utf-8"), so it can legally contain non-ASCII
    # characters. hmac.compare_digest raises TypeError (not a False result)
    # when handed two `str` and either contains a non-ASCII character --
    # measured, not assumed (see authenticate_device's fix below for the
    # reproduction). Encoding both sides first makes a garbage `sig` compare
    # false like any other mismatch, never crash the caller.
    if not hmac.compare_digest(expected.encode("utf-8"), sig.encode("utf-8")):
        raise bad
    try:
        ts = int(ts_str)
        epoch = int(epoch_str)
    except ValueError:
        raise bad
    if time.time() - ts > _CONNECT_CODE_TTL_SECONDS:
        raise bad
    if epoch != _current_epoch(user_id):
        # I6: minted under an epoch a disconnect has since bumped past --
        # dead on arrival, even though every other check above would have
        # passed. A code minted AFTER the disconnect carries the new epoch
        # and is unaffected.
        raise bad
    _prune_used_nonces()
    if nonce in _used_connect_code_nonces:
        raise bad  # already redeemed -- single-use
    _used_connect_code_nonces[nonce] = time.time() + _CONNECT_CODE_TTL_SECONDS + 5
    return user_id


def redeem_connect_code(
    code: str, vault_id: str, label: str | None = None,
) -> tuple[str, str]:
    """Verifies `code` (exactly once -- see `_verify_connect_code`), then
    mints or ROTATES the (user_id, vault_id) device row and returns
    `(device_id, raw_token)`. `raw_token` is the ONLY point the plaintext
    secret exists outside this call's stack frame -- it is handed back to
    the caller and never stored; `j2_obsidian_devices.token_enc` holds
    only its encrypted form.

    Re-connect: a second redemption for the SAME (user_id, vault_id) --
    the `UNIQUE(user_id, vault_id)` constraint from Task 1 -- ROTATES the
    existing row's secret rather than refusing (see module docstring). A
    `None` label leaves an existing label untouched (mirrors
    `connections.upsert_connector`'s `account_label` handling), so a
    reinstall that doesn't resend a label never blanks a user-set name.
    """
    user_id = _verify_connect_code(code)
    secret_part = secrets.token_urlsafe(32)
    try:
        token_enc = crypto_box.NoteBox.encrypt(secret_part)
    except crypto_box.CryptoBoxError as e:
        raise errors.NoteConnNotConfigured(
            f"Obsidian device-token encryption is not configured: {e}"
        )
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM j2_obsidian_devices WHERE user_id = ? AND vault_id = ?",
            (user_id, vault_id),
        ).fetchone()
        if existing is not None:
            device_id = existing["id"]
            conn.execute(
                "UPDATE j2_obsidian_devices "
                "SET token_enc = ?, label = COALESCE(?, label), last_seen_at = NULL "
                "WHERE id = ?",
                (token_enc, label, device_id),
            )
        else:
            device_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO j2_obsidian_devices "
                "(id, user_id, vault_id, token_enc, label, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (device_id, user_id, vault_id, token_enc, label, _now_iso()),
            )
        conn.commit()
    finally:
        conn.close()
    return device_id, f"{device_id}:{secret_part}"


def get_device(device_id: str) -> dict[str, Any] | None:
    """Read-only device metadata lookup by id -- `{device_id, user_id,
    vault_id, label}`, or `None` if no such row exists. Unlike
    `authenticate_device`, this never touches the encrypted secret, never
    updates `last_seen_at`, and is NOT an authentication check: it is meant
    for a caller that already trusts `device_id` some other way -- Task 5b's
    redeem endpoint calls this immediately after `redeem_connect_code`
    returns, with the `device_id` THAT SAME CALL just wrote/rotated (our own
    server-produced value at that point, not attacker input), purely to
    recover `user_id`/`label` for creating the vault's `j2_note_sources`
    row. Comparing a secret here would be pointless work against a value
    nothing supplied from outside this request."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, user_id, vault_id, label FROM j2_obsidian_devices WHERE id = ?",
            (device_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return {
        "device_id": row["id"],
        "user_id": row["user_id"],
        "vault_id": row["vault_id"],
        "label": row["label"],
    }


def revoke_devices(user_id: str) -> int:
    """Deletes every `j2_obsidian_devices` row for `user_id` -- the fix for
    the gap the disconnect flow used to have: `authenticate_device` (below)
    authenticates a push purely off THIS table, looked up by the
    `device_id` half of the bearer token, INDEPENDENTLY of the
    `j2_note_connectors` row `note_sync.py::disconnect` otherwise purges
    alone via `connections.delete_connector`. A `DELETE /obsidian` that
    only removed the connector row left every device token this member
    ever redeemed still valid -- a member who disconnects Obsidian in the
    UI, believing they cut the plugin off, still had a plugin able to push
    notes into staging. Called from `note_sync.py::disconnect` before
    `connections.delete_connector` runs (mirrors that function's Dropbox
    best-effort-revoke-before-purge shape, generalized to whichever
    provider owns an out-of-band credential store of its own).

    ⛔ Extended twice more, 2026-09-02 review, on the SAME call site rather
    than adding a parallel disconnect-time cleanup:

      - **I5** — this used to stop at the device row. No code anywhere ever
        ran `DELETE FROM j2_obsidian_staging`, so every markdown body a
        member ever pushed sat in the shared DB forever after they
        disconnected, and reconnecting the same `vault_id` silently
        resurrected it (`ObsidianProvider._known_paths`/`list_changed`/
        `list_present_refs` all read straight off these tables with no
        concept of "was this vault ever disconnected"). Now purges
        `j2_obsidian_staging` AND `j2_obsidian_manifest` for `user_id`
        first, in the SAME transaction as the device-row delete below --
        one commit, so a crash between the two can never leave staging
        purged with devices still live or vice versa.
      - **I6** — see `invalidate_outstanding_codes`: bumping the connect-
        code epoch here means disconnect kills outstanding codes too, not
        just already-issued devices, closing the redeem/revoke race where a
        code minted moments before disconnect could still redeem into a
        full reconnection afterward.

    Scoped to `user_id` alone, no `vault_id`/`device_id` filter: a member
    disconnecting Obsidian from Settings disconnects the WHOLE provider for
    their account -- exactly like every other provider's disconnect, not
    one vault -- so every device, staged body, manifest row, and
    outstanding code for this user (across every vault they ever connected)
    is revoked in one call. A second user's rows are a disjoint set
    (`user_id` is part of every row) and are never touched.

    Returns the number of DEVICE rows removed (0 if none existed -- a safe,
    idempotent no-op, matching `connections.delete_connector`'s own
    "nothing to disconnect" case) -- unchanged return contract, existing
    callers/tests key off this count alone. Raises whatever the underlying
    DB call raises rather than swallowing it: unlike Dropbox's best-effort
    revoke of a THIRD PARTY's grant (harmless to leave dangling since it
    grants nothing back to us), a failure here means the vulnerability this
    function exists to close would still be open -- it must never look
    like it succeeded when it didn't."""
    invalidate_outstanding_codes(user_id)  # I6 -- in-memory, never fails; do first
    conn = get_connection()
    try:
        conn.execute("DELETE FROM j2_obsidian_staging WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM j2_obsidian_manifest WHERE user_id = ?", (user_id,))
        cur = conn.execute("DELETE FROM j2_obsidian_devices WHERE user_id = ?", (user_id,))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def authenticate_device(raw_token: str) -> dict[str, Any] | None:
    """Returns `{device_id, user_id, vault_id, label}` for a currently
    valid device token, or `None` for anything else -- malformed input, an
    unknown device_id, or a secret that doesn't match. NEVER raises for a
    bad/garbage token (a malicious or malfunctioning plugin push must not
    be able to crash the ingest path) -- ⛔ this was FALSE until the fix
    below: `hmac.compare_digest` on two `str` raises `TypeError` (not a
    False result) the moment either side contains a non-ASCII character,
    and the Authorization header is latin-1 decoded upstream, so a single
    raw byte >= 0x80 in the device's secret half reached here as a
    non-ASCII `str` and turned into a 500 on the live ingest auth path
    (measured, not assumed). Comparing BYTES instead -- `.encode("utf-8")`
    on both sides right before `compare_digest` -- makes that same input
    compare false like any other mismatch. A genuine server misconfiguration
    (`NOTE_ENCRYPTION_KEY` unset, so no stored secret can be decrypted) is
    indistinguishable from "no valid device" here BY DESIGN -- failing
    closed (nothing authenticates) is the safe direction, the read-side
    mirror of `mint_connect_code` refusing to mint without a signing
    secret.

    Cross-tenant safety is structural, not a bolted-on check: the returned
    `user_id` is read from the SAME row the token's device_id half looked
    up by primary key. A token cannot cause a different user's identity to
    come back, because nothing about the request selects which row to read
    except that primary-key lookup -- there is no code path that reads one
    device's row and returns another's user_id."""
    if not raw_token or ":" not in raw_token:
        return None
    device_id, _, secret_part = raw_token.partition(":")
    if not device_id or not secret_part:
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, user_id, vault_id, label, token_enc "
            "FROM j2_obsidian_devices WHERE id = ?",
            (device_id,),
        ).fetchone()
        if row is None:
            return None
        try:
            stored_secret = crypto_box.NoteBox.decrypt(row["token_enc"])
        except crypto_box.CryptoBoxError:
            return None
        # BYTES, not str -- see the docstring above. A non-ASCII secret_part
        # (one raw header byte >= 0x80, latin-1 decoded upstream) must
        # compare false here, never raise TypeError into the ingest path.
        if not hmac.compare_digest(stored_secret.encode("utf-8"), secret_part.encode("utf-8")):
            return None
        conn.execute(
            "UPDATE j2_obsidian_devices SET last_seen_at = ? WHERE id = ?",
            (_now_iso(), device_id),
        )
        conn.commit()
        return {
            "device_id": row["id"],
            "user_id": row["user_id"],
            "vault_id": row["vault_id"],
            "label": row["label"],
        }
    finally:
        conn.close()
