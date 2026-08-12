"""Generic OAuth2 client-credentials-grant module for note connectors.

Notion (this task) is the first consumer; Dropbox (a later task) is a
second, similarly-shaped OAuth2 provider — this module is written generic
enough that adding it later is a `_PROVIDERS` entry, not a redesign. Only
`"notion"` is registered here; a later task registers `"dropbox"`.

Three entry points (task brief, verbatim signatures):
  - `authorize_url(provider, state)` — the URL to redirect the user to.
  - `exchange_code(provider, code)` — trades an authorization code for a
    token pair (async; hits the provider's token endpoint).
  - `refresh_if_needed(user_id, provider)` — returns a non-expired
    credentials dict for (user_id, provider), refreshing first if the
    stored token is at/past its expiry. LOCK-GUARDED per (user_id,
    provider): Notion's refresh grant ROTATES the pair (a new
    refresh_token invalidates the old one), so two concurrent callers
    racing to refresh the SAME expired token must never both POST to the
    token endpoint — the second POST would carry an already-consumed
    refresh_token and fail (or worse, race the first). The lock + a
    re-check of the STORED credential immediately after acquiring it
    ensures at most ONE network refresh happens per expiry, and every
    other concurrent caller simply observes the fresh result.

⚠️ CREDENTIAL-BOUNDARY: the client_id/secret and every bearer/access token
this module handles are sent ONLY to the provider's own token endpoint
(`api.notion.com` for Notion) over https — NEVER anywhere else. Nothing in
this module ever logs a token, code, or client secret (error messages below
carry the provider's own `error`/`message` fields, never request bodies).

Env darkness: reading `NOTION_CLIENT_ID`/`NOTION_CLIENT_SECRET` happens
ONLY inside function bodies (`os.environ.get`, live on every call — never
cached at import or construction), so importing this module with no env
vars set never raises. `configured(provider)` is the query primitive;
every other function raises `errors.NoteConnNotConfigured` (never a bare
KeyError/AttributeError) when called against an unconfigured provider.

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §7 (OAuth
mechanics), §8 (router's callback consumes `authorize_url`/`exchange_code`;
providers consume `refresh_if_needed` before calling into their own API).
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from . import connections, errors

# Notion API version pinned on EVERY request that touches api.notion.com —
# including the OAuth token endpoint itself (research is explicit: "on
# EVERY request", no carve-out for OAuth). `providers/notion.py` imports
# this SAME constant for its own API calls rather than redefining it, so
# there is exactly one place the pinned version lives.
NOTION_VERSION = "2025-09-03"

# A refreshed/exchanged token is treated as needing refresh once we're
# within this many seconds of its own reported expiry — a small safety
# margin against clock skew and in-flight-request latency, not a real
# grace period.
_REFRESH_SKEW_SECONDS = 60


@dataclass(frozen=True)
class _OAuthProviderConfig:
    client_id_env: str
    client_secret_env: str
    authorize_url: str
    token_url: str
    extra_authorize_params: dict[str, str] = field(default_factory=dict)
    extra_token_headers: dict[str, str] = field(default_factory=dict)


_PROVIDERS: dict[str, _OAuthProviderConfig] = {
    "notion": _OAuthProviderConfig(
        client_id_env="NOTION_CLIENT_ID",
        client_secret_env="NOTION_CLIENT_SECRET",
        authorize_url="https://api.notion.com/v1/oauth/authorize",
        token_url="https://api.notion.com/v1/oauth/token",
        extra_authorize_params={"owner": "user"},
        extra_token_headers={"Notion-Version": NOTION_VERSION},
    ),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _safe_json(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


# ── Provider config / configured() ──────────────────────────────────────────

def configured(provider: str) -> bool:
    """True iff `provider` is a KNOWN OAuth provider AND both its client id
    and secret env vars are set. False (never raises) for an unknown
    provider name — this is the primitive a future provider registry (or
    the connect UI) calls to decide "not available yet" vs a live Connect
    button."""
    cfg = _PROVIDERS.get(provider)
    if cfg is None:
        return False
    return bool(os.environ.get(cfg.client_id_env)) and bool(os.environ.get(cfg.client_secret_env))


def _require_configured(provider: str) -> _OAuthProviderConfig:
    cfg = _PROVIDERS.get(provider)
    if cfg is None:
        raise errors.NoteConnNotConfigured(f"{provider!r} has no OAuth configuration registered")
    if not configured(provider):
        raise errors.NoteConnNotConfigured(
            f"{provider} OAuth is not configured — set {cfg.client_id_env} and "
            f"{cfg.client_secret_env}",
        )
    return cfg


def _redirect_uri(provider: str) -> str:
    """Per-provider override (`<PROVIDER>_REDIRECT_URI`) takes priority;
    otherwise derived from `DASHBOARD_URL` (same env var/default the rest
    of the backend uses — `api/routers/calendar.py`,
    `api/services/breadth_history_recon.py`) plus the callback path spec §8
    documents: `GET /api/j2/notes/connectors/{provider}/callback`. Read
    live on every call, never cached — matches this module's whole env-
    darkness posture."""
    override = os.environ.get(f"{provider.upper()}_REDIRECT_URI")
    if override:
        return override
    base = (os.environ.get("DASHBOARD_URL") or "https://uctintelligence.com").rstrip("/")
    return f"{base}/api/j2/notes/connectors/{provider}/callback"


# ── authorize_url ────────────────────────────────────────────────────────────

def authorize_url(provider: str, state: str) -> str:
    """Builds the full URL to redirect the user to for the OAuth consent
    screen. `state` is an opaque, ALREADY-SIGNED string (CSRF protection is
    the caller's job — the router, per its own task brief — this module
    just carries it through untouched)."""
    cfg = _require_configured(provider)
    client_id = os.environ[cfg.client_id_env]
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": _redirect_uri(provider),
        "state": state,
        **cfg.extra_authorize_params,
    }
    return f"{cfg.authorize_url}?{urlencode(params)}"


# ── token endpoint plumbing ──────────────────────────────────────────────────

def _raise_for_token_response(
    provider: str, response: httpx.Response, *, is_refresh: bool,
) -> None:
    if response.status_code == 200:
        return
    body = _safe_json(response)
    code = body.get("error")
    message = body.get("message") or body.get("error_description") or code or (
        f"{provider} token endpoint error {response.status_code}"
    )
    if response.status_code == 429:
        raise errors.NoteConnRateLimited(
            f"{provider} token endpoint rate limited",
            retry_after=_parse_retry_after(response.headers.get("retry-after")),
            status=429, code=code,
        )
    if response.status_code in (400, 401):
        # invalid_grant on a REFRESH means the refresh_token itself was
        # rejected (rotated-out, revoked, expired) — reconnect is required,
        # not a retry, so this is the ⊂ NoteConnAuthError subclass callers
        # can special-case. A rejected initial exchange (bad `code`) is a
        # plain auth error — there is no prior token to have "expired".
        if is_refresh:
            raise errors.NoteConnTokenExpired(
                f"{provider} token refresh failed: {message}",
                status=response.status_code, code=code,
            )
        raise errors.NoteConnAuthError(
            f"{provider} token exchange failed: {message}",
            status=response.status_code, code=code,
        )
    raise errors.NoteConnTransient(
        f"{provider} token endpoint error {response.status_code}", status=response.status_code,
    )


async def _post_token(
    cfg: _OAuthProviderConfig, provider: str, client_id: str, client_secret: str,
    body: dict[str, Any], *, is_refresh: bool, client: httpx.AsyncClient | None,
) -> dict[str, Any]:
    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=30.0)
    try:
        try:
            response = await http_client.post(
                cfg.token_url,
                auth=(client_id, client_secret),
                headers={"Content-Type": "application/json", **cfg.extra_token_headers},
                json=body,
            )
        except httpx.RequestError as exc:
            raise errors.NoteConnTransient(f"{provider} token request failed: {exc}") from exc
    finally:
        if owns_client:
            await http_client.aclose()
    _raise_for_token_response(provider, response, is_refresh=is_refresh)
    return _safe_json(response)


def _compute_expires_at(expires_in: Any) -> str | None:
    if expires_in is None:
        return None
    try:
        seconds = float(expires_in)
    except (TypeError, ValueError):
        return None
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _normalize_token_response(data: dict[str, Any]) -> dict[str, Any]:
    """Shapes a Notion token-endpoint response into the credentials dict
    stored via `connections.upsert_connector` — the SAME shape
    `providers/notion.py` reads back (`accessToken`, etc.). A missing
    `refresh_token` on a refresh response (Notion is documented to always
    rotate the pair) falls back to keeping whatever was already stored —
    handled by the caller, not here, since this function only sees the
    fresh response body."""
    out: dict[str, Any] = {"accessToken": data.get("access_token")}
    if data.get("refresh_token"):
        out["refreshToken"] = data["refresh_token"]
    for src, dest in (
        ("bot_id", "botId"),
        ("workspace_id", "workspaceId"),
        ("workspace_name", "workspaceName"),
        ("workspace_icon", "workspaceIcon"),
    ):
        if data.get(src) is not None:
            out[dest] = data[src]
    expires_at = _compute_expires_at(data.get("expires_in"))
    if expires_at:
        out["expiresAt"] = expires_at
    return out


# ── exchange_code ─────────────────────────────────────────────────────────────

async def exchange_code(
    provider: str, code: str, *, client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Trades an authorization `code` for a token pair. Returns the
    credentials dict shaped for `connections.upsert_connector` — the
    caller (the router, task 11) is responsible for persisting it; this
    function performs no DB writes itself, unlike `refresh_if_needed`."""
    cfg = _require_configured(provider)
    client_id = os.environ[cfg.client_id_env]
    client_secret = os.environ[cfg.client_secret_env]
    data = await _post_token(
        cfg, provider, client_id, client_secret,
        {"grant_type": "authorization_code", "code": code, "redirect_uri": _redirect_uri(provider)},
        is_refresh=False, client=client,
    )
    if not data.get("access_token"):
        raise errors.NoteConnAuthError(f"{provider} token exchange returned no access_token")
    return _normalize_token_response(data)


# ── refresh_if_needed (lock-guarded) ─────────────────────────────────────────

# Per-(user_id, provider) locks, process-local — mirrors engine.py's
# `_locks`/`_lock_for` pattern exactly (setdefault is atomic, no
# lazy-create TOCTOU race between two coroutines getting distinct locks for
# the same key).
_refresh_locks: dict[tuple[str, str], asyncio.Lock] = {}


def _lock_for(user_id: str, provider: str) -> asyncio.Lock:
    return _refresh_locks.setdefault((user_id, provider), asyncio.Lock())


def _needs_refresh(creds: dict[str, Any]) -> bool:
    """No `expiresAt` on the stored credential means the token was issued
    with no reported TTL — treated as non-expiring (nothing to refresh
    against), not as "always stale"."""
    expires_at = _parse_iso(creds.get("expiresAt"))
    if expires_at is None:
        return False
    return datetime.now(timezone.utc) >= expires_at - timedelta(seconds=_REFRESH_SKEW_SECONDS)


async def refresh_if_needed(
    user_id: str, provider: str, *, client: httpx.AsyncClient | None = None,
) -> dict[str, Any] | None:
    """Returns the current credentials dict for (user_id, provider) —
    refreshed first if at/near expiry. `None` if there is no connected
    credential at all (mirrors `connections.get_token`'s own contract; the
    caller decides how to react to "not connected").

    Lock-guarded: acquires the per-(user_id, provider) lock BEFORE doing
    anything else, then re-reads the STORED credential (not a
    caller-supplied snapshot) — so a coroutine that had to wait for the
    lock sees whatever the FIRST coroutine through just wrote, and
    `_needs_refresh` on that fresh read is false, skipping a second network
    call entirely. This is what makes "two concurrent expired-token calls →
    one token POST" hold: the lock alone would only serialize, not
    dedupe — the re-read inside it is what dedupes."""
    async with _lock_for(user_id, provider):
        creds = connections.get_token(user_id, provider)
        if creds is None:
            return None
        if not _needs_refresh(creds):
            return creds
        refresh_token = creds.get("refreshToken")
        if not refresh_token:
            # Nothing to refresh with. The token may simply be non-rotating
            # (no expiresAt would already have short-circuited above, so
            # this only fires if expiresAt was set but refreshToken never
            # was) — hand back what we have; the next real API call raises
            # NoteConnAuthError if it's genuinely rejected.
            return creds
        cfg = _require_configured(provider)
        client_id = os.environ[cfg.client_id_env]
        client_secret = os.environ[cfg.client_secret_env]
        data = await _post_token(
            cfg, provider, client_id, client_secret,
            {"grant_type": "refresh_token", "refresh_token": refresh_token},
            is_refresh=True, client=client,
        )
        if not data.get("access_token"):
            raise errors.NoteConnTokenExpired(f"{provider} refresh returned no access_token")
        new_creds = _normalize_token_response(data)
        if not new_creds.get("refreshToken"):
            # Notion is documented to always rotate the pair, but degrade
            # safely if a response ever omits it rather than losing the
            # ability to refresh again next time.
            new_creds["refreshToken"] = refresh_token
        connections.upsert_connector(user_id, provider, new_creds, record_consent=False)
        return new_creds
