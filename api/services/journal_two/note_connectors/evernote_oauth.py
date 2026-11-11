"""Evernote OAuth for the hosted MCP server (Plan E Task 2): public client, PKCE, rotating refresh.

Measured facts (`docs/notebook-connectors/evernote-mcp-probe.md`): dynamic client registration
needs no approval; the client is PUBLIC (`token_endpoint_auth_method: none`, no secret); PKCE
S256; `resource=https://mcp.evernote.com`, `scope=read`; access tokens last 3600 s; the refresh
grant ROTATES the refresh token, so the new one must be stored every time.

Rulings (plan, Task 2):
- The client is registered ONCE at deploy (`tools/evernote_register_client.py`), never at
  runtime; its id is the env var `EVERNOTE_CLIENT_ID`, read live. Every stored credential carries
  the `clientId` that issued it and refresh uses that one, so rotating the env var never strands a
  member.
- The PKCE verifier is DERIVED from the signed OAuth state with the server's state secret
  (`base64url(HMAC-SHA256(secret, b"evernote-pkce:" + state))`), not stored: the state is already
  HMAC-signed, single-use and time-bounded, so derivation survives a restart and needs no table.
  Knowing the state without the secret does not give the verifier.
- Refresh is guarded by a `threading.Lock` per user plus a DB compare-and-swap
  (`connections.swap_token_if_unchanged`), NOT `oauth._refresh_locks`: those are asyncio locks,
  and the engine runs on the uvicorn loop and on a fresh loop per scheduler job, where a
  loop-bound lock raises. The refresh runs in `asyncio.to_thread` with a SYNCHRONOUS httpx client,
  so a waiter blocks a worker thread, never an event loop.

Tokens are never logged and never put in an error string.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import os
import random
import sqlite3
import threading
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from . import connections, errors, oauth
from .providers.base import MEDIA_USER_AGENT

PROVIDER = "evernote"

AUTH_BASE = "https://accounts.evernote.com"
REGISTER_URL = f"{AUTH_BASE}/auth/register"
AUTHORIZE_URL = f"{AUTH_BASE}/auth/authorize"
TOKEN_URL = f"{AUTH_BASE}/auth/token"
#: RFC 7009 token revocation. Published as `revocation_endpoint` in the authorization-server
#: metadata (https://accounts.evernote.com/.well-known/oauth-authorization-server, read 2026-11-03;
#: final review M5). Not yet exercised against a live grant: confirm at the live gate (T11).
REVOKE_URL = f"{AUTH_BASE}/auth/revoke"
#: Final re-review N1: each revoke request is bounded on its own, whoever built the client; the
#: router's `EVERNOTE_REVOKE_BUDGET_S` bounds the whole best-effort revoke on top.
REVOKE_TIMEOUT_S = 5.0
RESOURCE = "https://mcp.evernote.com"
SCOPE = "read"

CLIENT_NAME = "UCT Notebook Sync"
# The only redirect URI the deploy-time registration may carry (`tools/evernote_register_client.py`
# refuses anything else, because `oauth._redirect_uri` honours EVERNOTE_REDIRECT_URI/DASHBOARD_URL).
PRODUCTION_CALLBACK = "https://uctintelligence.com/api/j2/notes/connectors/evernote/callback"

_PKCE_LABEL = b"evernote-pkce:"

# After a successful refresh POST the rotated token exists only in memory until the swap lands, so
# a swap that hits a busy auth.db is RETRIED (the CAS is idempotent) rather than lost (Task 2
# review I1). Total wall-clock budget, jittered doubling backoff between attempts; each attempt
# also waits up to auth.db's own 3 s busy timeout.
SWAP_RETRY_BUDGET_S = 30.0
_SWAP_FIRST_DELAY_S = 0.25
_SWAP_MAX_DELAY_S = 4.0
_swap_sleep = time.sleep  # injectable (tests)
_swap_clock = time.monotonic  # injectable (tests)
_HTTP_TIMEOUT = 30.0
_HEADERS = {"Accept": "application/json", "User-Agent": MEDIA_USER_AGENT}


class RegistrationMismatch(errors.NoteConnError):
    """Evernote's DCR reply does not echo what was requested (the redirect URIs, or a public client
    with `token_endpoint_auth_method: none`). The deploy tool refuses to hand over the client id."""


def client_id() -> str | None:
    """`EVERNOTE_CLIENT_ID`, read live on every call; None when unset or empty."""
    return os.environ.get("EVERNOTE_CLIENT_ID") or None


def _require_client_id() -> str:
    cid = client_id()
    if not cid:
        raise errors.NoteConnNotConfigured(
            "Evernote is not configured: set EVERNOTE_CLIENT_ID "
            "(python tools/evernote_register_client.py)")
    return cid


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def pkce_verifier(state: str, secret: bytes) -> str:
    """43 chars of base64url, no padding (RFC 7636 allows 43-128)."""
    return _b64url(hmac.new(secret, _PKCE_LABEL + state.encode("utf-8"), hashlib.sha256).digest())


def pkce_challenge(verifier: str) -> str:
    """S256: base64url(SHA-256(verifier)), no padding."""
    return _b64url(hashlib.sha256(verifier.encode("ascii")).digest())


def _redirect_uri() -> str:
    return oauth._redirect_uri(PROVIDER)


def authorize_url(state: str, secret: bytes) -> str:
    """The consent URL. `state` is the router's already-signed state; `secret` its state secret."""
    params = {
        "response_type": "code",
        "client_id": _require_client_id(),
        "redirect_uri": _redirect_uri(),
        "scope": SCOPE,
        "state": state,
        "code_challenge": pkce_challenge(pkce_verifier(state, secret)),
        "code_challenge_method": "S256",
        "resource": RESOURCE,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def _creds_from(data: dict[str, Any], cid: str, *, fallback_refresh: str | None = None
                ) -> dict[str, Any]:
    creds: dict[str, Any] = {
        "accessToken": data.get("access_token"),
        "refreshToken": data.get("refresh_token") or fallback_refresh,
        "expiresAt": oauth._compute_expires_at(data.get("expires_in")),
        "clientId": cid,
    }
    return creds


# ── code exchange (async; the callback route) ────────────────────────────────

async def exchange_code(code: str, state: str, secret: bytes, *,
                        client: httpx.AsyncClient | None = None) -> dict:
    """Trade the authorization `code` for creds `{accessToken, refreshToken, expiresAt,
    clientId}`. No DB write: the router persists through `connections.upsert_connector`."""
    cid = _require_client_id()
    body = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _redirect_uri(),
        "client_id": cid,
        "code_verifier": pkce_verifier(state, secret),
        "resource": RESOURCE,
    }
    owns = client is None
    http = client or httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
    try:
        try:
            resp = await http.post(TOKEN_URL, data=body, headers=_HEADERS)
        except httpx.RequestError as exc:
            raise errors.NoteConnTransient(
                f"evernote token exchange failed ({type(exc).__name__})") from None
    finally:
        if owns:
            await http.aclose()
    oauth._raise_for_token_response(PROVIDER, resp, is_refresh=False)
    data = oauth._safe_json(resp)
    if not data.get("access_token"):
        raise errors.NoteConnAuthError("evernote token exchange returned no access_token")
    return _creds_from(data, cid)


# ── revoke (final review M5; the Disconnect door, best-effort) ───────────────

async def revoke_token(creds: dict[str, Any], *, client: httpx.AsyncClient | None = None) -> None:
    """RFC 7009 revocation of the member's grant at Evernote: the refresh token first (revoking it
    ends the grant), then the access token. A public client: `client_id` in the form, no
    Authorization header, no secret. Raises a `NoteConnError` on a refusal or a transport error,
    naming the status or the exception TYPE only, never a token. The router calls this
    best-effort, before the local purge, and never lets it block a disconnect."""
    cid = (creds or {}).get("clientId") or client_id()
    tokens = [(creds.get(key), hint) for key, hint in (("refreshToken", "refresh_token"),
                                                         ("accessToken", "access_token"))
              if isinstance((creds or {}).get(key), str) and creds.get(key)]
    if not tokens:
        return
    owns = client is None
    http = client or httpx.AsyncClient(timeout=REVOKE_TIMEOUT_S)
    try:
        for token, hint in tokens:
            body = {"token": token, "token_type_hint": hint}
            if cid:
                body["client_id"] = cid
            try:
                resp = await http.post(REVOKE_URL, data=body, headers=_HEADERS, timeout=REVOKE_TIMEOUT_S)
            except httpx.RequestError as exc:
                raise errors.NoteConnTransient(
                    f"evernote token revoke failed ({type(exc).__name__})") from None
            if resp.status_code != 200:
                raise errors.NoteConnError(
                    f"evernote token revoke refused ({resp.status_code})", status=resp.status_code)
    finally:
        if owns:
            await http.aclose()


# ── refresh (threading lock + compare-and-swap) ──────────────────────────────

# One lock per user (the provider is fixed). setdefault on a dict is atomic under the GIL, so two
# threads can never get distinct locks for one user. Grows one entry per user ever refreshed and is
# never evicted: the same accepted shape as `oauth._refresh_locks`.
_locks: dict[str, threading.Lock] = {}


def _lock_for(user_id: str) -> threading.Lock:
    return _locks.setdefault(user_id, threading.Lock())


def _post_refresh(refresh_token: str, cid: str, client: httpx.Client | None) -> dict[str, Any]:
    body = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": cid,
        "resource": RESOURCE,
    }
    owns = client is None
    http = client or httpx.Client(timeout=_HTTP_TIMEOUT)
    try:
        try:
            resp = http.post(TOKEN_URL, data=body, headers=_HEADERS)
        except httpx.RequestError as exc:
            raise errors.NoteConnTransient(
                f"evernote token refresh failed ({type(exc).__name__})") from None
    finally:
        if owns:
            http.close()
    oauth._raise_for_token_response(PROVIDER, resp, is_refresh=True)
    data = oauth._safe_json(resp)
    if not data.get("access_token"):
        raise errors.NoteConnTokenExpired("evernote refresh returned no access_token")
    return data


def _is_busy(exc: sqlite3.OperationalError) -> bool:
    text = str(exc).lower()
    return "locked" in text or "busy" in text


def _swap_with_retry(user_id: str, expected_refresh_token: str, new_creds: dict[str, Any]) -> bool:
    """`connections.swap_token_if_unchanged`, retried on a busy/locked auth.db within
    `SWAP_RETRY_BUDGET_S`. Any other error propagates at once. Exhausted -> `NoteConnTransient`
    (the rotated token is then lost: the accepted gap below)."""
    deadline = _swap_clock() + SWAP_RETRY_BUDGET_S
    delay = _SWAP_FIRST_DELAY_S
    while True:
        try:
            return connections.swap_token_if_unchanged(
                user_id, PROVIDER, expected_refresh_token, new_creds)
        except sqlite3.OperationalError as exc:
            if not _is_busy(exc):
                raise
            remaining = deadline - _swap_clock()
            if remaining <= 0:
                raise errors.NoteConnTransient(
                    "evernote refresh: could not store the rotated token (auth.db busy)") from None
            _swap_sleep(min(delay * random.uniform(0.5, 1.5), remaining))
            delay = min(delay * 2, _SWAP_MAX_DELAY_S)


def _refresh_sync(user_id: str, force: bool, client: httpx.Client | None,
                  rejected_access_token: str | None = None) -> dict | None:
    with _lock_for(user_id):
        # Re-read INSIDE the lock: a waiter sees what the first thread through just wrote, finds it
        # fresh, and makes no second POST. The lock serialises; the re-read dedupes.
        creds = connections.get_token(user_id, PROVIDER)
        if creds is None:
            return None
        if not force and not oauth._needs_refresh(creds):
            return creds
        if (force and rejected_access_token is not None
                and creds.get("accessToken") != rejected_access_token):
            # Task 2 review m1: the stored access token is not the one the caller saw rejected, so a
            # concurrent refresher already rotated. Use its tokens; do not rotate again.
            return creds
        refresh_token = creds.get("refreshToken")
        if not refresh_token:
            if force:
                raise errors.NoteConnTokenExpired(
                    "evernote access token rejected and no refresh token is stored")
            return creds
        cid = creds.get("clientId") or _require_client_id()
        try:
            data = _post_refresh(refresh_token, cid, client)
        except errors.NoteConnTokenExpired:
            # Rejected refresh token. If another process already rotated it, the store holds a
            # different one: that refresher won, use its tokens. Otherwise it is really dead.
            current = connections.get_token(user_id, PROVIDER)
            if current and current.get("refreshToken") and current["refreshToken"] != refresh_token:
                return current
            raise
        new_creds = _creds_from(data, cid, fallback_refresh=refresh_token)
        # KNOWN, ACCEPTED gap (deferred, not fixed here): a crash between
        # this POST succeeding (Notion has already rotated the refresh
        # token server-side) and the `upsert_connector` write below landing
        # would strand the OLD refresh_token as permanently invalid with
        # nothing locally recording the NEW one. This is inherent to
        # refresh-token ROTATION itself (any rotating-pair OAuth provider
        # has the identical window) — the connector would surface as
        # 'broken' on its next use and prompt a reconnect, the same
        # recovery path an outright-revoked token already takes.
        # (Copied from oauth.py; here the write is `swap_token_if_unchanged` and the provider
        # Evernote.)
        # A response lost in transit (a read timeout after Evernote processed the POST) reaches the
        # same stranded state and is inherent, like the crash. A busy auth.db is NOT part of the
        # gap: `_swap_with_retry` retries the idempotent swap for up to SWAP_RETRY_BUDGET_S.
        if _swap_with_retry(user_id, refresh_token, new_creds):
            return new_creds
        # The store moved under us (a reconnect, or another process's refresh): never overwrite
        # it, hand back what is stored now.
        return connections.get_token(user_id, PROVIDER)


async def refresh_if_needed(user_id: str, *, force: bool = False,
                            client: httpx.Client | None = None,
                            rejected_access_token: str | None = None) -> dict | None:
    """The member's current Evernote creds, refreshed first when within 60 s of expiry (the
    `oauth.py` skew) or when `force` (the MCP client got a 401). None when there is no connector.

    `rejected_access_token`: on a forced refresh, the access token the caller saw rejected. When
    the stored one already differs, a concurrent refresher won and its creds are returned with no
    POST (no needless rotation).

    `client` is a SYNCHRONOUS `httpx.Client` or None (tests inject a MockTransport one): the work
    runs in a worker thread under a `threading.Lock`, so it cannot share an event-loop-bound
    client."""
    return await asyncio.to_thread(_refresh_sync, user_id, force, client, rejected_access_token)


# ── dynamic client registration (deploy-time only) ───────────────────────────

async def register_client(redirect_uri: str, *, client: httpx.AsyncClient | None = None) -> dict:
    """POST the DCR body the probe used. Called by `tools/evernote_register_client.py` once at
    deploy, never by the running app. Returns the registration response (`client_id`, ...)."""
    body = {
        "client_name": CLIENT_NAME,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": SCOPE,
    }
    owns = client is None
    http = client or httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
    try:
        try:
            resp = await http.post(REGISTER_URL, json=body, headers=_HEADERS)
        except httpx.RequestError as exc:
            raise errors.NoteConnTransient(
                f"evernote client registration failed ({type(exc).__name__})") from None
    finally:
        if owns:
            await http.aclose()
    data = oauth._safe_json(resp)
    if not 200 <= resp.status_code < 300 or not data.get("client_id"):
        raise errors.NoteConnError(
            f"evernote client registration failed: HTTP {resp.status_code} "
            f"{data.get('error') or ''}".strip(), status=resp.status_code, code=data.get("error"))
    # Task 2 review m4: the reply must echo what was asked for, or a silently altered registration
    # would surface only at the first member connect.
    mismatched = []
    if data.get("redirect_uris") != [redirect_uri]:
        mismatched.append(f"redirect_uris={data.get('redirect_uris')!r}")
    if data.get("token_endpoint_auth_method") != "none":
        mismatched.append(
            f"token_endpoint_auth_method={data.get('token_endpoint_auth_method')!r}")
    if mismatched:
        raise RegistrationMismatch(
            "evernote registration reply does not match the request: " + ", ".join(mismatched),
            code="evernote_registration_mismatch")
    return data
