"""Thin async wrapper around the SnapTrade Python SDK.

ALL SnapTrade-specific surface is isolated here. The rest of the broker
package speaks plain dicts and our own exception types, so if SnapTrade's
API shifts (or we ever swap aggregators) only this file changes.

Design:
  • Partner credentials (SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY) come
    from env, server-side only.
  • We call the SDK's *synchronous* methods inside `asyncio.to_thread` so
    the event loop never blocks. (The SDK's native async path needs aiohttp;
    to_thread keeps deps minimal and behavior predictable.)
  • Every outbound call passes through a process-global token-bucket limiter
    so we stay under SnapTrade's *partner-wide* rate ceiling no matter how
    many users sync at once.
  • SDK/HTTP errors are mapped to a small structured exception family:
      SnapNotConfigured  — env creds missing
      SnapAuthError      — 401/403 (partner creds or scope problem)
      SnapUserSecretInvalid (⊂ SnapAuthError) — this user's secret is stale
                            → caller should drive a reconnect/re-register
      SnapRateLimited    — 429 (carries retry_after when present)
      SnapTransient      — 5xx / network / timeout (safe to retry w/ backoff)
      SnapError          — anything else
  • Response bodies (frozendict / tuple / Decimal from the generated SDK)
    are converted to plain JSON-safe Python via `_to_plain`.

Method names + signatures verified against snaptrade-python-sdk 11.0.x.
"""

from __future__ import annotations

import asyncio
import os
from decimal import Decimal
from datetime import date
from typing import Any, Callable

# Rate-limit knobs (env-tunable). Conservative defaults; raise once we know
# the real partner ceiling from SnapTrade.
_RL_RATE = float(os.getenv("SNAPTRADE_RATE_PER_SEC", "4"))
_RL_BURST = float(os.getenv("SNAPTRADE_RATE_BURST", "8"))


# ── Exceptions ───────────────────────────────────────────────────────────────

class SnapError(Exception):
    """Base for all SnapTrade wrapper errors."""

    def __init__(self, message: str, *, status: int | None = None,
                 code: str | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.body = body


class SnapNotConfigured(SnapError):
    """SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY not set."""


class SnapAuthError(SnapError):
    """401/403 — partner credentials or requested scope rejected."""


class SnapUserSecretInvalid(SnapAuthError):
    """This user's stored userSecret is no longer valid (rotated / revoked).
    Caller should mark the connection broken and re-register/reconnect."""


class SnapRateLimited(SnapError):
    """429 — back off and retry."""

    def __init__(self, message: str, *, retry_after: float | None = None, **kw):
        super().__init__(message, **kw)
        self.retry_after = retry_after


class SnapTransient(SnapError):
    """5xx / network / timeout — transient, safe to retry."""


# ── SDK client (lazy singleton, injectable for tests) ────────────────────────

_sdk_client: Any = None  # cached real client
_sdk_override: Any = None  # test injection


def configure(client: Any) -> None:
    """Inject a (fake) SDK client. Tests use this; production never does."""
    global _sdk_override
    _sdk_override = client


def reset() -> None:
    """Clear injected + cached clients (test teardown)."""
    global _sdk_override, _sdk_client
    _sdk_override = None
    _sdk_client = None


def is_configured() -> bool:
    return bool(os.getenv("SNAPTRADE_CLIENT_ID") and os.getenv("SNAPTRADE_CONSUMER_KEY"))


def _sdk() -> Any:
    global _sdk_client
    if _sdk_override is not None:
        return _sdk_override
    if _sdk_client is not None:
        return _sdk_client
    client_id = os.getenv("SNAPTRADE_CLIENT_ID")
    consumer_key = os.getenv("SNAPTRADE_CONSUMER_KEY")
    if not client_id or not consumer_key:
        raise SnapNotConfigured(
            "SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY not set"
        )
    from snaptrade_client import SnapTrade
    client = SnapTrade(consumer_key=consumer_key, client_id=client_id)
    _assert_credentials_applied(client)
    _sdk_client = client
    return _sdk_client


def _sdk_configuration(client: Any) -> Any | None:
    """Best-effort reach for the SDK's Configuration object. Returns None when
    the SDK's internals don't look the way we expect — callers must treat that
    as 'can't tell', never as 'broken'."""
    for sub in ("authentication", "api_status", "connections"):
        api = getattr(client, sub, None)
        cfg = getattr(getattr(api, "api_client", None), "configuration", None)
        if cfg is not None:
            return cfg
    return getattr(getattr(client, "api_client", None), "configuration", None)


def _assert_credentials_applied(client: Any) -> None:
    """Fail LOUDLY when the constructed SDK client carries no credentials.

    The SnapTrade SDK takes its credentials as keyword arguments, and 12.0.0
    changed `SnapTrade.__init__` to `(configuration=None, **kwargs)` — so our
    kwargs were silently swallowed and every signed request went out with NO
    auth at all (401 code 0000 "Authentication credentials were not provided").
    Nothing raised; the whole broker fleet just got marked broken overnight
    (prod 2026-07-23). requirements.txt now pins <12, and this is the belt to
    that suspenders: any future SDK bump that stops honoring our constructor
    call fails immediately and legibly instead of silently deauthenticating
    every member.

    Deliberately conservative: if we can't introspect the SDK's configuration
    we do NOT raise (an internals change must not take broker sync down)."""
    cfg = _sdk_configuration(client)
    if cfg is None:
        return  # can't tell — never block on introspection alone
    consumer_key = getattr(cfg, "consumer_key", None)
    api_key = getattr(cfg, "api_key", None) or {}
    client_id = api_key.get("PartnerClientId") if hasattr(api_key, "get") else None
    if not consumer_key or not client_id:
        raise SnapNotConfigured(
            "SnapTrade SDK ignored our credentials — the installed "
            "snaptrade-python-sdk does not accept "
            "SnapTrade(consumer_key=..., client_id=...). Every request would "
            "go out unauthenticated. Pin snaptrade-python-sdk<12 or migrate "
            "_sdk() to the installed SDK's auth model."
        )


# Lazily-created so tests can swap clock/sleep before first use if needed.
_limiter = None


def _get_limiter():
    global _limiter
    if _limiter is None:
        from api.services.journal_two.broker.rate_limit import AsyncRateLimiter
        _limiter = AsyncRateLimiter(_RL_RATE, _RL_BURST)
    return _limiter


def set_limiter(limiter) -> None:
    """Override the global limiter (tests)."""
    global _limiter
    _limiter = limiter


# ── Plain-Python conversion ──────────────────────────────────────────────────

def _to_plain(obj: Any) -> Any:
    """Recursively convert SDK response bodies (frozendict / tuple / Decimal)
    into JSON-safe plain Python so we can store + reason about them."""
    # dict (frozendict is a dict subclass)
    if isinstance(obj, dict):
        return {str(k): _to_plain(v) for k, v in obj.items()}
    # list / tuple (SDK list bodies are tuple-based)
    if isinstance(obj, (list, tuple)):
        return [_to_plain(v) for v in obj]
    if isinstance(obj, Decimal):
        # Preserve integers as int, else float.
        return int(obj) if obj == obj.to_integral_value() else float(obj)
    if isinstance(obj, (bytes, bytearray)):
        try:
            return obj.decode("utf-8")
        except Exception:
            return obj.hex()
    return obj


# ── Error mapping ────────────────────────────────────────────────────────────

def _body_code(body: Any) -> str | None:
    if isinstance(body, dict):
        c = body.get("code")
        return str(c) if c is not None else None
    return None


def _looks_like_bad_user_secret(status: int | None, body: Any) -> bool:
    """Heuristic: SnapTrade returns 401 with code '1076' (and a message
    mentioning the user secret) when a stored userSecret is invalid.
    Conservative — only fires on the known signal. Verify exact codes
    against SnapTrade docs/sandbox before relying on it for auto-reconnect."""
    if status not in (401, 403):
        return False
    code = _body_code(body)
    if code in ("1076", "1083"):  # invalid user secret / user not found
        return True
    if isinstance(body, dict):
        msg = str(body.get("detail") or body.get("message") or "").lower()
        if "user secret" in msg or "usersecret" in msg:
            return True
    return False


def _map_api_exception(e: Any) -> SnapError:
    status = getattr(e, "status", None)
    raw_body = getattr(e, "body", None)
    body = _to_plain(raw_body) if raw_body is not None else None
    code = _body_code(body)
    msg = f"SnapTrade API error {status}: {getattr(e, 'reason', '') or ''}".strip()
    # Carry the response body's code/detail into the message — a bare
    # "401: Unauthorized" in sync_log is undiagnosable (prod 2026-07-14).
    if code is not None:
        msg += f" (code {code})"
    if isinstance(body, dict):
        detail = body.get("detail") or body.get("message")
        if detail:
            msg += f" — {str(detail)[:200]}"

    if status == 429:
        retry_after = None
        headers = getattr(e, "headers", None) or {}
        try:
            ra = headers.get("Retry-After") if hasattr(headers, "get") else None
            retry_after = float(ra) if ra is not None else None
        except (TypeError, ValueError):
            retry_after = None
        return SnapRateLimited(msg, retry_after=retry_after, status=status, code=code, body=body)
    if status in (401, 403):
        if _looks_like_bad_user_secret(status, body):
            return SnapUserSecretInvalid(msg, status=status, code=code, body=body)
        return SnapAuthError(msg, status=status, code=code, body=body)
    if status is not None and status >= 500:
        return SnapTransient(msg, status=status, code=code, body=body)
    return SnapError(msg, status=status, code=code, body=body)


# Retry config (env-tunable). Injectable sleep so tests don't actually wait.
_MAX_RETRIES = int(os.getenv("SNAPTRADE_MAX_RETRIES", "3"))
_RETRY_BASE_DELAY = float(os.getenv("SNAPTRADE_RETRY_BASE_DELAY", "0.5"))
_RETRY_MAX_DELAY = float(os.getenv("SNAPTRADE_RETRY_MAX_DELAY", "30"))
_retry_sleep = asyncio.sleep


def set_retry_sleep(fn) -> None:
    """Override the retry sleep (tests use a no-op to avoid real delays)."""
    global _retry_sleep
    _retry_sleep = fn


async def _call(fn: Callable[..., Any], **kwargs) -> Any:
    """Run a blocking SDK call in a thread, throttled, with error mapping +
    bounded retry/backoff on rate-limit (honoring Retry-After) and transient
    errors. Auth/secret/other errors are NOT retried. Returns the plain body."""
    from snaptrade_client.exceptions import ApiException, OpenApiException

    attempts = max(1, _MAX_RETRIES)
    delay = _RETRY_BASE_DELAY

    def _blocking():
        return fn(**kwargs)

    for i in range(attempts):
        await _get_limiter().acquire(1)
        try:
            resp = await asyncio.to_thread(_blocking)
            return _to_plain(getattr(resp, "body", resp))
        except ApiException as e:
            err: SnapError = _map_api_exception(e)
        except OpenApiException as e:  # schema/client-config issues — not retryable
            raise SnapError(f"SnapTrade client error: {e}") from e
        except (TimeoutError, ConnectionError, OSError) as e:
            err = SnapTransient(f"SnapTrade network error: {e}")

        retryable = isinstance(err, (SnapRateLimited, SnapTransient))
        if not retryable or i == attempts - 1:
            raise err
        wait = err.retry_after if (isinstance(err, SnapRateLimited) and err.retry_after) else delay
        await _retry_sleep(min(wait, _RETRY_MAX_DELAY))
        delay *= 2


# ── Public API ───────────────────────────────────────────────────────────────

async def register_user(uct_user_id: str) -> dict[str, str]:
    """Register a SnapTrade user keyed by our UCT user id. Returns
    {snaptrade_user_id, user_secret}. The user_secret must be stored
    encrypted — it's the credential for all future calls."""
    sdk = _sdk()
    body = await _call(sdk.authentication.register_snap_trade_user, user_id=uct_user_id)
    uid = body.get("userId") if isinstance(body, dict) else None
    secret = body.get("userSecret") if isinstance(body, dict) else None
    if not uid or not secret:
        # Don't repr the body — register/reset bodies contain the userSecret.
        raise SnapError(f"register returned unexpected body (keys: {sorted(body.keys()) if isinstance(body, dict) else type(body).__name__})")
    return {"snaptrade_user_id": uid, "user_secret": secret}


async def login_redirect_uri(
    snaptrade_user_id: str,
    user_secret: str,
    *,
    custom_redirect: str | None = None,
    reconnect: str | None = None,
    broker: str | None = None,
    connection_type: str | None = None,
) -> str:
    """Get the SnapTrade Connection-Portal redirect URL for this user.
    `custom_redirect` is the URL SnapTrade returns the browser to after the
    user finishes. `reconnect` is a brokerage-authorization id when fixing a
    broken connection. `broker` pins the portal to one brokerage slug (e.g.
    'SANDBOX' on non-prod keys for the synthetic test brokerage).
    `connection_type` is 'read' (our default posture) or 'trade'."""
    sdk = _sdk()
    kwargs: dict[str, Any] = {"user_id": snaptrade_user_id, "user_secret": user_secret}
    if custom_redirect:
        kwargs["custom_redirect"] = custom_redirect
    if reconnect:
        kwargs["reconnect"] = reconnect
    if broker:
        kwargs["broker"] = broker
    if connection_type:
        kwargs["connection_type"] = connection_type
    body = await _call(sdk.authentication.login_snap_trade_user, **kwargs)
    uri = body.get("redirectURI") if isinstance(body, dict) else None
    if not uri:
        raise SnapError(f"login returned no redirectURI: {body!r}")
    return uri


async def delete_user(snaptrade_user_id: str) -> None:
    """Delete the SnapTrade user (revokes all connections). Idempotent on
    their side for an already-deleted user."""
    sdk = _sdk()
    await _call(sdk.authentication.delete_snap_trade_user, user_id=snaptrade_user_id)


async def reset_user_secret(snaptrade_user_id: str, user_secret: str) -> str:
    """Rotate the userSecret. Returns the new secret (store encrypted)."""
    sdk = _sdk()
    body = await _call(
        sdk.authentication.reset_snap_trade_user_secret,
        user_id=snaptrade_user_id,
        user_secret=user_secret,
    )
    secret = body.get("userSecret") if isinstance(body, dict) else None
    if not secret:
        raise SnapError(f"reset secret returned unexpected body (keys: {sorted(body.keys()) if isinstance(body, dict) else type(body).__name__})")
    return secret


async def api_status() -> dict:
    """Partner-level SnapTrade heartbeat: provider up + our key valid.
    Raises the mapped Snap* error on failure."""
    sdk = _sdk()
    body = await _call(sdk.api_status.check)
    return body if isinstance(body, dict) else {"online": bool(body)}


async def list_users() -> list[str]:
    """Partner-level: every SnapTrade userId registered under our key.
    Admin-diagnostic use (is this member registered SnapTrade-side at all?)."""
    sdk = _sdk()
    body = await _call(sdk.authentication.list_snap_trade_users)
    return [str(u) for u in body] if isinstance(body, list) else []


async def list_authorizations(user_id: str, user_secret: str) -> list[dict]:
    """The user's brokerage authorizations (connection objects). The
    `disabled` flag here is the ground truth for 'connected but nothing
    syncs' — a portal flow can complete while the authorization is dead."""
    sdk = _sdk()
    body = await _call(
        sdk.connections.list_brokerage_authorizations,
        user_id=user_id, user_secret=user_secret,
    )
    return body if isinstance(body, list) else []


async def get_balance_history(user_id: str, user_secret: str,
                              account_id: str) -> list[dict]:
    """Estimated historical total account value per day (positions MV +
    cash). BETA: disabled by default (SnapTrade must enable it for the
    client), max 1-year lookback, broker-limited, values are estimates —
    used only as a cross-check oracle for our own equity reconstruction."""
    sdk = _sdk()
    body = await _call(
        sdk.account_information.get_account_balance_history,
        user_id=user_id, user_secret=user_secret, account_id=account_id,
    )
    return body if isinstance(body, list) else []


async def get_partner_info() -> dict:
    """Client-level entitlements + per-broker health: capability flags
    (can_access_holdings/trades/…) and each brokerage's enabled /
    maintenance_mode / is_degraded / allows_trading flags. No user creds —
    keyed by the API client itself."""
    sdk = _sdk()
    body = await _call(sdk.reference_data.get_partner_info)
    return body if isinstance(body, dict) else {}


async def refresh_authorization(user_id: str, user_secret: str,
                                authorization_id: str) -> dict:
    """Ask SnapTrade to pull fresh holdings/transactions from the brokerage
    for one authorization (their scheduled refresh is only ~nightly). The
    pull is async on SnapTrade's side — completion arrives later as an
    ACCOUNT_HOLDINGS_UPDATED / ACCOUNT_TRANSACTIONS_UPDATED webhook, which
    triggers our sync. May be billed per call on some plans — call sites
    must budget (see manual_refresh.py)."""
    sdk = _sdk()
    body = await _call(
        sdk.connections.refresh_brokerage_authorization,
        authorization_id=authorization_id,
        user_id=user_id, user_secret=user_secret,
    )
    return body if isinstance(body, dict) else {"status": body}


async def list_accounts(user_id: str, user_secret: str) -> list[dict]:
    """All brokerage accounts the user has connected. Returns a list of
    account dicts (id, name, number, institution_name, ...)."""
    sdk = _sdk()
    body = await _call(
        sdk.account_information.list_user_accounts,
        user_id=user_id, user_secret=user_secret,
    )
    return body if isinstance(body, list) else []


async def get_balances(user_id: str, user_secret: str, account_id: str) -> list[dict]:
    """Per-currency cash/equity balances for one account."""
    sdk = _sdk()
    body = await _call(
        sdk.account_information.get_user_account_balance,
        user_id=user_id, user_secret=user_secret, account_id=account_id,
    )
    if isinstance(body, list):
        return body
    return [body] if isinstance(body, dict) else []


async def get_positions(user_id: str, user_secret: str, account_id: str) -> list[dict]:
    """Current holdings (with average purchase price / cost basis) for one
    account — the source of truth for open positions."""
    sdk = _sdk()
    body = await _call(
        sdk.account_information.get_user_account_positions,
        user_id=user_id, user_secret=user_secret, account_id=account_id,
    )
    return body if isinstance(body, list) else []


async def get_recent_orders(user_id: str, user_secret: str, account_id: str,
                            *, only_executed: bool = True) -> list[dict]:
    """Orders from the last ~24h. ALWAYS real-time (never cached) and the
    calls are included free on pay-as-you-go plans — SnapTrade's documented
    free alternative to the paid TRADE_DETECTION webhook. Contractual cap:
    poll at most once per 5 minutes per account, market hours only."""
    sdk = _sdk()
    body = await _call(
        sdk.account_information.get_user_account_recent_orders,
        user_id=user_id, user_secret=user_secret, account_id=account_id,
        only_executed=only_executed,
    )
    if isinstance(body, dict):
        orders = body.get("orders") or body.get("data") or []
        return orders if isinstance(orders, list) else []
    return body if isinstance(body, list) else []


async def get_option_holdings(user_id: str, user_secret: str, account_id: str) -> list[dict]:
    """Current OPTION contract holdings for one account. Separate endpoint from
    get_positions (which returns equities only) — this is the source of truth
    for open-option market value in the account's net-liquidation equity.

    Each holding: {units (contracts), price (per-share premium), currency,
    average_purchase_price, symbol: {option_symbol: {strike_price,
    expiration_date, is_mini_option, underlying_symbol, ...}}}."""
    sdk = _sdk()
    body = await _call(
        sdk.options.list_option_holdings,
        user_id=user_id, user_secret=user_secret, account_id=account_id,
    )
    return body if isinstance(body, list) else []


async def get_activities(
    user_id: str,
    user_secret: str,
    account_id: str,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = 0,
    limit: int | None = None,
    type: str | None = None,
) -> dict:
    """One page of account activities (trades, dividends, transfers, option
    events). Returns {"data": [...], "pagination": {...}} normalized — the
    SDK may return either a bare list or a paginated envelope depending on
    endpoint version, so we normalize to the envelope shape here."""
    sdk = _sdk()
    kwargs: dict[str, Any] = {
        "account_id": account_id,
        "user_id": user_id,
        "user_secret": user_secret,
        "offset": offset,
    }
    if start_date is not None:
        kwargs["start_date"] = start_date
    if end_date is not None:
        kwargs["end_date"] = end_date
    if limit is not None:
        kwargs["limit"] = limit
    if type is not None:
        kwargs["type"] = type
    body = await _call(sdk.account_information.get_account_activities, **kwargs)
    if isinstance(body, dict) and "data" in body:
        return {
            "data": body.get("data") or [],
            "pagination": body.get("pagination") or {},
        }
    if isinstance(body, list):
        return {"data": body, "pagination": {}}
    return {"data": [], "pagination": {}}
