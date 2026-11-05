"""Note Connectors HTTP router — `/api/j2/notes/connectors/*` (spec §8).

Thin layer over `note_connectors.{registry,connections,oauth,engine}` — the
router owns NO sync/credential logic of its own; it validates input, maps
provider-taxonomy exceptions to HTTP status, and calls into those modules.

Mounted UNCONDITIONALLY (Global Constraint) — `NOTE_SYNC_ENABLED` gates only
the SCHEDULER (see `api/main.py`'s note-connector scheduler block); every
endpoint here checks configuration PER PROVIDER (`registry.configured`) so
`GET /status` can render an honest "not available yet" tile even with the
scheduler flag off, exactly like the broker-sync router's `snaptradeConfigured`.

Paid gate mirrors `api/routers/broker_sync.py`'s `_paid = require_plan(list(
PAID_PLANS))` idiom verbatim — connect/mutate endpoints are gated, `GET`
status/log endpoints stay open to any logged-in user (so the upsell state
renders for a free user).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac as _hmac
import html
import json
import logging
import os
import secrets
import time
from typing import Any, Literal
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field, ValidationError, model_validator

from api.middleware.auth_middleware import (
    PAID_PLANS,
    get_current_user,
    get_current_user_optional,
    meets_plan_gate,
    require_plan,
)
from api.services import auth_service, crypto_box
from api.services import request_body_cap as body_cap
from api.services.auth_db import get_connection
from api.services.journal_two import widget_request_body
from api.services.journal_two.note_connectors import (
    connections, dest_folder, engine, errors, obsidian_attachments, obsidian_link, obsidian_staging, oauth,
    registry,
)
from api.services.journal_two.note_connectors.providers.craft import parse_capability_url
from api.services.upload_gate import UPLOAD_BUSY_SENTENCE, UploadGate

log = logging.getLogger("note_connectors.router")

router = APIRouter(prefix="/api/j2/notes/connectors", tags=["note-connectors"])

BUSY_DETAIL = "A sync is already running for this source. Its results will appear here when it finishes."

_paid = require_plan(list(PAID_PLANS))

# ⛔ FIN (2026-10-06): no route here declares a JSON body parameter. FastAPI reads a
# declared body BEFORE it solves any dependency -- before the gate or the session,
# and with no size limit. Each door takes its body through `_json(...)`: a
# dependency that runs the session check first and caps the body WHILE it is read.
# Rail: tests/test_notebook_body_census.py.
# A connect body is a token or a capability URL; the rest are ids and a label.
JSON_BODY_MAX_BYTES = 64 * 1024
JSON_TOO_LARGE_SENTENCE = "Request too large"


# ⛔ ON THESE ROUTES THE PLAN GATE PARAMETER COMES BEFORE THE BODY PARAMETER.
# FastAPI solves a route's dependencies in the order its parameters are written,
# so `user: dict = Depends(_paid)` first means a member without a plan is refused
# (403) before the body is read or validated. `after` is the SESSION, not `_paid`,
# on purpose: the plan gate stays in ONE place per route, so removing it still
# opens the route in the eyes of tests/test_exposed_routes_gated.py.
def _json(annotation, *, after=get_current_user):
    return body_cap.capped_json(annotation, lambda: JSON_BODY_MAX_BYTES,
                                lambda: JSON_TOO_LARGE_SENTENCE, after=after)


_STATE_TTL_SECONDS = 600  # 10 minutes -- long enough to complete an OAuth consent screen


# ── request bodies ───────────────────────────────────────────────────────────

class ConnectBody(BaseModel):
    """Field names here are a CONTRACT with the already-shipped frontend
    (Task 12, `ConnectTokenModal.jsx`) — that task committed to its own
    reasonable field names ahead of this router landing (its own hook's
    docstring says as much) since spec §8 only describes the connect body in
    prose. `token/apiUrl/apiKey` below are what the UI actually POSTs;
    aligning here (rather than asking the frontend to change) is what keeps
    Task 12 from being BUILT, TESTED, GREEN, and CONNECTED TO NOTHING."""
    consent: bool = False
    # Roam — ConnectTokenModal sends {graphName, token}.
    graphName: str | None = None
    token: str | None = None
    # Craft — ConnectTokenModal sends {apiUrl, apiKey}.
    apiUrl: str | None = None
    apiKey: str | None = None


class AddSourceBody(BaseModel):
    remoteId: str
    displayName: str | None = None
    destFolderId: str | None = None


class SourceUpdateBody(BaseModel):
    syncEnabled: bool | None = None
    destFolderId: str | None = None


# ── signed, time-bounded, single-use OAuth state (spec §8; repo idiom:
#    calendar.py's export-token HMAC-PUSH_SECRET pattern, widened with an
#    embedded timestamp + nonce so state is TIME-BOUNDED and SINGLE-USE, not
#    just tamper-evident) ───────────────────────────────────────────────────

def _state_secret() -> bytes:
    """FAILS CLOSED (Fix-round-1 Important #3). With neither `PUSH_SECRET`
    nor `VOICE_ACTION_SECRET` set, a constant, source-visible fallback would
    let anyone who can read this repo forge a state that authorizes
    attaching an arbitrary OAuth account to an ARBITRARY user_id — unlike
    calendar.py's `_ics_secret` precedent (read-only blast radius: a forged
    token only grants read access to one user's OWN calendar feed), this
    secret gates a WRITE that crosses accounts. Raises `NoteConnNotConfigured`
    rather than signing/verifying with a known constant; callers (`connect`,
    `oauth_callback`) map it to a 503."""
    s = os.environ.get("PUSH_SECRET", "") or os.environ.get("VOICE_ACTION_SECRET", "")
    if not s:
        raise errors.NoteConnNotConfigured(
            "OAuth state signing is not configured (set PUSH_SECRET)"
        )
    return s.encode("utf-8")


# Single-use nonce tracking (Fix-round-1 Important #2c) — process-local,
# same accepted single-process-pod shape as `engine._inflight_sources` /
# `oauth._refresh_locks` elsewhere in this module family (this repo's own
# CLAUDE.md documents the web pod as ONE uvicorn process). A leaked state
# (logged proxy, shared screen, browser history sync) is otherwise valid and
# replayable for its whole TTL; recording used nonces here closes that
# without a DB table for what is, structurally, a 10-minute-lived value.
# Lost on process restart — worst case a state minted just before a restart
# becomes replayable again for the remainder of its TTL, an acceptable,
# bounded window for a value that already requires PUSH_SECRET to forge.
_used_state_nonces: dict[str, float] = {}


def _prune_used_nonces() -> None:
    now = time.time()
    expired = [n for n, exp in _used_state_nonces.items() if exp <= now]
    for n in expired:
        _used_state_nonces.pop(n, None)


def _sign_state(user_id: str, provider: str) -> str:
    ts = str(int(time.time()))
    nonce = secrets.token_urlsafe(16)
    payload = f"{user_id}:{provider}:{ts}:{nonce}"
    sig = _hmac.new(_state_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    raw = f"{payload}:{sig}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")


def _verify_state(state: str, *, provider: str) -> str:
    """Returns the embedded `user_id` on success. Raises `HTTPException(400)`
    on ANY failure — malformed, wrong provider, bad signature, expired, or
    already-used — a single generic message so a probing attacker learns
    nothing about which check failed. Raises `errors.NoteConnNotConfigured`
    (mapped to 503 by the caller) when no signing secret is configured at
    all — a distinct, server-side-only signal, never confused with a
    client-supplied bad state.

    ⛔ That "on ANY failure" claim was FALSE until the `compare_digest` call
    below was fixed to compare BYTES: `state` arrives as a raw URL query
    value on the Notion/Evernote OAuth callback, and a malformed one
    can decode (base64 + `.decode("utf-8")`) into a `sig` half containing a
    non-ASCII character. `hmac.compare_digest` on two `str` raises
    `TypeError` (not a clean False) the instant either side is non-ASCII --
    that reached this exact comparison uncaught and turned a bad state into
    a 500 on this shared callback path (measured, not assumed -- see
    `tests/test_note_sync_router.py`'s non-ASCII-state test). Encoding both
    sides to bytes right before `compare_digest` makes that same input
    compare false like any other bad signature -- same pre-existing shape,
    same fix, as `obsidian_link.py`'s `_verify_connect_code` /
    `authenticate_device`."""
    bad = HTTPException(status_code=400, detail="invalid or expired state")
    try:
        raw = base64.urlsafe_b64decode(state.encode("utf-8")).decode("utf-8")
        user_id, state_provider, ts_str, nonce, sig = raw.split(":", 4)
    except Exception:
        raise bad
    if state_provider != provider or not user_id or not nonce:
        raise bad
    payload = f"{user_id}:{state_provider}:{ts_str}:{nonce}"
    expected = _hmac.new(_state_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()  # NoteConnNotConfigured propagates
    # BYTES, not str: `sig` was decoded from an attacker-controlled base64
    # blob via .decode("utf-8"), so it can legally contain non-ASCII
    # characters -- see the docstring above.
    if not _hmac.compare_digest(expected.encode("utf-8"), sig.encode("utf-8")):
        raise bad
    try:
        ts = int(ts_str)
    except ValueError:
        raise bad
    if time.time() - ts > _STATE_TTL_SECONDS:
        raise bad
    _prune_used_nonces()
    if nonce in _used_state_nonces:
        raise bad  # replay
    _used_state_nonces[nonce] = time.time() + _STATE_TTL_SECONDS + 5
    return user_id


# ── provider-taxonomy -> HTTP status (mirrors broker_sync.py's Snap* mapping) ─

def _raise_for_provider_error(e: Exception) -> None:
    if isinstance(e, errors.NoteConnNotConfigured):
        raise HTTPException(status_code=503, detail=str(e))
    if isinstance(e, errors.NoteConnRateLimited):
        raise HTTPException(status_code=429, detail=str(e))
    if isinstance(e, errors.NoteConnUnsupported):
        raise HTTPException(status_code=422, detail=e.reason)
    if isinstance(e, errors.NoteConnAuthError):  # incl. NoteConnTokenExpired
        raise HTTPException(status_code=400, detail=str(e))
    if isinstance(e, errors.NoteConnTransient):
        raise HTTPException(status_code=503, detail=str(e))
    if isinstance(e, errors.NoteConnValidationError):
        # I3/I4/I7 (2026-09-02 review) -- a boundary-rejected payload
        # (padded/empty manifest, an over-cap batch) is a client error, not
        # a provider/config/rate/transient one.
        raise HTTPException(status_code=400, detail=str(e))
    raise HTTPException(status_code=502, detail=str(e))


def _upsert_connector_or_503(
    user_id: str, provider: str, creds: dict[str, Any], *, account_label: str | None,
) -> dict[str, Any]:
    """Final-review Important #C: `connections.upsert_connector` is the ONE
    call site that invokes `crypto_box.NoteBox.encrypt` — with
    `NOTE_ENCRYPTION_KEY` unset, that raises a bare `crypto_box.
    CryptoBoxError`, which is NOT part of the `note_connectors.errors`
    taxonomy `_raise_for_provider_error` maps, so it used to escape both
    `_connect_token_provider` and `oauth_callback` as an unhandled 500 with
    a traceback. Caught here and mapped to the SAME 503/not-configured
    shape `NoteConnNotConfigured` produces elsewhere in this router — a
    missing encryption key is a server misconfiguration, not a client
    error, and must never leak a traceback to the caller."""
    try:
        return connections.upsert_connector(user_id, provider, creds, account_label=account_label)
    except crypto_box.CryptoBoxError as e:
        raise HTTPException(status_code=503, detail=f"note connector storage is not configured: {e}")


async def _aclose(provider_obj: Any) -> None:
    aclose = getattr(provider_obj, "aclose", None)
    if aclose is not None:
        try:
            await aclose()
        except Exception:  # noqa: BLE001 — cleanup must never mask the real error
            pass


def _dashboard_url() -> str:
    return (os.environ.get("DASHBOARD_URL") or "https://uctintelligence.com").rstrip("/")


def _default_dest_folder_id(user_id: str, provider: str, display_name: str | None,
                            remote_id: str | None) -> str | None:
    """Best-effort default Notebook folder for a newly-connected source -- NEVER raises; a failure
    degrades to `None` (notes land at the Notebook root) rather than blocking the connect flow.
    The name and the make-or-reuse are `dest_folder`'s, the ONE authority the engine's self-heal
    shares (a deleted destination folder is recreated under exactly this name)."""
    return dest_folder.default_folder_id(
        user_id, dest_folder.default_folder_name(provider, display_name, remote_id))


# ── GET /status ───────────────────────────────────────────────────────────────

def _sync_enabled() -> bool:
    return os.environ.get("NOTE_SYNC_ENABLED") == "1"


_ZERO_COUNTS = {
    "notesCreated": 0, "notesUpdated": 0, "notesSkipped": 0,
    "mediaUploaded": 0, "conflicts": 0, "sourceDeleted": 0,
}


def _latest_sync_counts(user_id: str, source_ids: list[str]) -> dict[str, dict[str, int]]:
    """Per-source counts from that source's MOST RECENT `j2_note_sync_log`
    row — the already-shipped frontend (Task 12, `SourceRow.jsx`/
    `NoteConnectorsTrustStrip.jsx`) reads `source.counts.{notesCreated,
    notesUpdated,conflicts}` directly off every status response; without
    this, every source would render "Created 0 / Updated 0" forever even
    after real syncs ran. `j2_note_sources` itself carries no cumulative
    counters, so this is a single bulk query keyed on the newest log row id
    per source (never N+1)."""
    if not source_ids:
        return {}
    placeholders = ",".join("?" * len(source_ids))
    conn = get_connection()
    try:
        rows = conn.execute(
            f"""
            SELECT source_id, notes_created, notes_updated, notes_skipped,
                   media_uploaded, conflicts, source_deleted
              FROM j2_note_sync_log
             WHERE user_id = ? AND source_id IN ({placeholders})
               AND id IN (
                   SELECT MAX(id) FROM j2_note_sync_log
                    WHERE user_id = ? AND source_id IN ({placeholders})
                    GROUP BY source_id
               )
            """,
            (user_id, *source_ids, user_id, *source_ids),
        ).fetchall()
    finally:
        conn.close()
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        out[r["source_id"]] = {
            "notesCreated": r["notes_created"] or 0,
            "notesUpdated": r["notes_updated"] or 0,
            "notesSkipped": r["notes_skipped"] or 0,
            "mediaUploaded": r["media_uploaded"] or 0,
            "conflicts": r["conflicts"] or 0,
            "sourceDeleted": r["source_deleted"] or 0,
        }
    return out


def _parse_failures(raw: Any) -> tuple[list[dict[str, Any]], bool]:
    """`failures_json` -> (failures, unreadable). NULL/empty -> ([], False);
    malformed or wrong-shaped -> ([], True) so the client can say "details
    unavailable" instead of claiming there were none."""
    if raw is None or raw == "":
        return [], False
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return [], True
    if not isinstance(data, list):
        return [], True
    out: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        title = item.get("noteTitle")
        reason = item.get("reason")
        name = item.get("name")
        out.append({
            "noteTitle": title if isinstance(title, str) else "Untitled note",
            "reason": reason if isinstance(reason, str) else "",
            "name": name if isinstance(name, str) else None,
        })
    return out, False


def _latest_failure_counts(user_id: str, source_ids: list[str]) -> dict[str, int | None]:
    """Per-source failure count from the newest `j2_note_sync_log` row's
    `failures_json`: 0 for NULL, None for UNREADABLE (unknown, never "none":
    a 0 would hide the card's "didn't come over" label). Same newest-row
    subquery as `_latest_sync_counts`; one bulk query, never N+1."""
    if not source_ids:
        return {}
    placeholders = ",".join("?" * len(source_ids))
    conn = get_connection()
    try:
        rows = conn.execute(
            f"""
            SELECT source_id, failures_json
              FROM j2_note_sync_log
             WHERE user_id = ? AND source_id IN ({placeholders})
               AND id IN (
                   SELECT MAX(id) FROM j2_note_sync_log
                    WHERE user_id = ? AND source_id IN ({placeholders})
                    GROUP BY source_id
               )
            """,
            (user_id, *source_ids, user_id, *source_ids),
        ).fetchall()
    finally:
        conn.close()
    out: dict[str, int | None] = {}
    for r in rows:
        failures, unreadable = _parse_failures(r["failures_json"])
        out[r["source_id"]] = None if unreadable else len(failures)
    return out


@router.get("/status")
def get_status(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Providers configured/connected + per-source freshness (spec §8).
    Consumes `connections.list_connectors` (Task 11 MUST-RESOLVE #6) rather
    than re-querying `j2_note_connectors` directly."""
    connectors = {c["provider"]: c for c in connections.list_connectors(user["id"])}
    all_sources = connections.list_sources(user["id"])
    source_ids = [s["id"] for s in all_sources]
    counts_by_source = _latest_sync_counts(user["id"], source_ids)
    failure_counts = _latest_failure_counts(user["id"], source_ids)
    pending = connections.pending_removal_counts(user["id"], source_ids)
    # Plan C Task 2: what each Obsidian vault's plugin can do, from the version that
    # vault's device last reported (>= 0.2.0). The version alone: refs already staged say
    # nothing about the plugin running NOW, and a device that downgrades must show the
    # update hint again (fix round 1, M1).
    plugin_versions = (obsidian_link.plugin_versions_for_user(user["id"])
                       if any(s.get("provider") == "obsidian" for s in all_sources) else {})
    # Final review I3: with the attachment layer OFF for this member, no capability is
    # reported (null: the card's update hint never shows) and `obsidianAttachments` is
    # false (the connect modal shows the text-only consent copy).
    attachments_on = obsidian_attachments.attachments_enabled_for_user(user)
    sources_by_provider: dict[str, list[dict[str, Any]]] = {}
    for s in all_sources:
        s = dict(s)
        if s.get("provider") == "obsidian":
            version = plugin_versions.get(s.get("remoteId"))
            s["pluginVersion"] = version
            s["pluginSupportsAttachments"] = (
                obsidian_link.plugin_version_supports_attachments(version) if attachments_on else None)
        s["counts"] = counts_by_source.get(s["id"], dict(_ZERO_COUNTS))
        # Fix round 1 (I3): a pass for this source is running right now (this process's in-flight
        # guard), so the row can read "syncing" after a background Sync now. D4-2: a pass that
        # holds the guard but still waits for one of the shared pass slots is "queued" instead.
        queued = engine.is_source_queued(s["id"])
        s["queued"] = queued
        s["syncing"] = engine.is_source_busy(s["id"]) and not queued
        s["pendingRemoval"] = int(pending.get(s["id"], 0))
        # None = the newest row's failures could not be read: the count is
        # unknown (null), and `lastFailuresUnreadable` keeps the card's path to
        # the log's "couldn't be read" line. Older clients read null as 0.
        failure_count = failure_counts.get(s["id"], 0)
        s["lastFailureCount"] = None if failure_count is None else int(failure_count)
        s["lastFailuresUnreadable"] = failure_count is None
        sources_by_provider.setdefault(s["provider"], []).append(s)

    providers: dict[str, Any] = {}
    for name in registry.names():
        entry = registry.get_entry(name)
        connector = connectors.get(name)
        providers[name] = {
            "configured": entry.configured() and registry.provider_allowed_for(name, user),
            "connectKind": entry.connect_kind,
            "connected": connector is not None,
            "status": connector["status"] if connector else None,
            "accountLabel": connector["accountLabel"] if connector else None,
            "sources": sources_by_provider.get(name, []),
        }
    return {"enabled": _sync_enabled(), "obsidianAttachments": attachments_on, "providers": providers}


# ── POST /{provider}/connect ──────────────────────────────────────────────────

async def _connect_token_provider(provider: str, body: ConnectBody, user_id: str) -> dict[str, Any]:
    if provider == "roam":
        if not body.graphName or not body.token:
            raise HTTPException(status_code=400, detail="graphName and token are required")
        # Internal credential-dict shape stays `graphToken` — that's the key
        # `RoamProvider._creds` reads (providers/roam.py); the wire field is
        # `token` (the frontend's name), mapped here at the one boundary.
        creds = {"graphName": body.graphName, "graphToken": body.token}
        remote_id = body.graphName
    else:  # craft
        if not body.apiUrl or not body.apiKey:
            raise HTTPException(status_code=400, detail="apiUrl and apiKey are required")
        try:
            _base_url, link_id = parse_capability_url(body.apiUrl)
        except errors.NoteConnAuthError as e:
            raise HTTPException(status_code=400, detail=str(e))
        # Internal shape stays `capabilityUrl`/`bearer` — what
        # `CraftProvider._creds` reads; wire fields are `apiUrl`/`apiKey`.
        creds = {"capabilityUrl": body.apiUrl, "bearer": body.apiKey}
        remote_id = link_id

    provider_obj = registry.build_provider(provider)
    try:
        info = await provider_obj.validate(creds)
    except errors.NoteConnError as e:
        _raise_for_provider_error(e)
    finally:
        await _aclose(provider_obj)

    _upsert_connector_or_503(user_id, provider, creds, account_label=info.label)
    dest_folder_id = _default_dest_folder_id(user_id, provider, info.label, remote_id)
    source = connections.create_source(
        user_id, provider, remote_id, display_name=info.label, dest_folder_id=dest_folder_id,
    )
    return {"connected": True, "accountLabel": info.label, "source": source}


def _mint_device_connect_code(provider: str, user_id: str) -> dict[str, Any]:
    """`connect_kind == "device"` (Obsidian, Task 5 of the 2026-09-02 plan)
    — neither a synchronous credential POST (`"token"`) nor a redirect
    (`"oauth"`). The member mints a short-lived, single-use code HERE and
    pastes it into the locally-installed plugin, which exchanges it for a
    device token on ITS OWN call into `obsidian_link.redeem_connect_code`
    — entirely outside this router's `/connect`+`/callback` pair (see that
    module's own docstring). Mirrors `_start_oauth`'s `entry.configured()`
    gate: an unconfigured provider refuses with the same 503 shape rather
    than minting a code nothing can ever redeem against."""
    entry = registry.get_entry(provider)
    if not entry.configured():
        raise HTTPException(status_code=503, detail=f"{entry.label} is not configured on this server.")
    try:
        code = obsidian_link.mint_connect_code(user_id)
    except errors.NoteConnNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"connectCode": code, "expiresInSeconds": obsidian_link._CONNECT_CODE_TTL_SECONDS}


def _require_provider_allowed(provider: str, user: dict) -> None:
    """Plan E Task 7: the per-member gate (`registry.provider_allowed_for`; only Evernote's
    `admin` mode ever says no). The SAME 503 text as an unconfigured provider, so a member cannot
    tell "admin-only" from "off". Disconnect and the log stay ungated: a paused member can leave."""
    if not registry.provider_allowed_for(provider, user):
        label = registry.get_entry(provider).label
        raise HTTPException(status_code=503, detail=f"{label} is not configured on this server.")


def _start_oauth(provider: str, user_id: str) -> dict[str, Any]:
    entry = registry.get_entry(provider)
    if not entry.configured():
        raise HTTPException(status_code=503, detail=f"{entry.label} is not configured on this server.")
    try:
        state = _sign_state(user_id, provider)
    except errors.NoteConnNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    if provider in oauth._PROVIDERS:
        # Generic path (Notion): keyed on which providers `oauth.py` itself knows how to talk to.
        url = oauth.authorize_url(provider, state)
    elif provider == "evernote":
        # Plan E Task 7. PKCE: the verifier is derived from the state.
        from api.services.journal_two.note_connectors import evernote_oauth
        url = evernote_oauth.authorize_url(state, _state_secret())
    else:
        # Every registered "oauth" provider is handled above (Dropbox, the only one that owned
        # its OAuth outside oauth.py, was archived 2026-11-04).
        raise HTTPException(status_code=404, detail=f"unknown OAuth provider {provider!r}")
    return {"redirectUrl": url}


@router.post("/{provider}/connect")
async def connect(provider: str, user: dict = Depends(_paid), body: ConnectBody = Depends(_json(ConnectBody))) -> dict[str, Any]:
    if not registry.is_known(provider):
        raise HTTPException(status_code=404, detail=f"unknown provider {provider!r}")
    if not body.consent:
        raise HTTPException(status_code=400, detail="Consent is required to connect a note source.")

    _require_provider_allowed(provider, user)
    entry = registry.get_entry(provider)
    if entry.connect_kind == "oauth":
        return _start_oauth(provider, user["id"])
    if entry.connect_kind == "device":
        return _mint_device_connect_code(provider, user["id"])
    return await _connect_token_provider(provider, body, user["id"])


# ── GET /{provider}/callback (OAuth) ──────────────────────────────────────────

# Plan E Task 7: the `reason=` an Evernote account that cannot use the MCP server lands with (a
# 403 at validate, or a consent refusal whose description names the plan). The card offers the
# `.enex` import path for it.
EVERNOTE_PLAN_REASON = "evernote_plan"
# The `reason=` when Evernote stopped being configured between connect and callback: member words,
# the same as connect's 503, never the env var name an unconfigured `exchange_code` would carry.
EVERNOTE_UNAVAILABLE_REASON = "Evernote is not configured on this server."
_PLAN_WORDS = ("plan", "subscription", "upgrade", "premium", "personal", "professional", "tier")


def _is_evernote_plan_refusal(error: str, description: str | None) -> bool:
    text = (description or "").lower()
    return error == "access_denied" and any(word in text for word in _PLAN_WORDS)



def _start_initial_sync(source_id: str) -> None:
    """Fire-and-forget the FIRST sync for a freshly connected source.

    ⛔ Connecting is the member's "import my notebook" action; it is not a
    request to schedule an import for some time in the next hour. Without
    this, a member finished Notion's OAuth (or finished pushing an Obsidian
    vault) and landed on an EMPTY Notebook with nothing running and nothing
    saying so -- the content only appeared when the `:23` incremental tick
    happened to come round, up to 60 minutes later, or when they found the
    "Sync now" button themselves.

    Detached exactly like `sync_source_now`'s `background=1` path so the
    OAuth redirect / ingest response is never held open behind a provider
    round-trip, and exception-walled so a failing first sync can never turn
    a SUCCESSFUL connect into an error the member sees. A failure leaves the
    source exactly as the old behaviour did -- waiting for the scheduled
    tick -- and is recorded on the source row by the engine itself.
    """
    async def _run() -> None:
        try:
            await engine.sync_source(source_id, manual=True)
        except Exception:  # noqa: BLE001 — never surface into the caller
            log.exception("[note_sync] initial sync failed for source %s", source_id)

    try:
        asyncio.create_task(_run())
    except RuntimeError:
        # No running loop (sync test client / non-async caller) — the
        # scheduled tick remains the fallback, same as before this existed.
        log.warning("[note_sync] no event loop; initial sync for %s deferred to the scheduler", source_id)


# ── GET /{provider}/callback ─────────────────────────────────────────────────

def _oauth_state_failure_page(provider: str) -> HTMLResponse:
    """The ONE page every OAuth state failure returns (bad, tampered, expired,
    wrong-provider, replayed, no session, or a different session user). Status
    400, identical body for every cause, so it stays as indistinguishable as
    the JSON 400 it replaces. No script, no external assets, no user id, no
    state echo."""
    label = html.escape(registry.get_entry(provider).label)
    minutes = _STATE_TTL_SECONDS // 60
    link = html.escape(
        f"/settings?section=connections&connector={provider}&connected=0&reason=oauth_state"
    )
    body = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>Couldn't finish connecting {label}</title></head><body>"
        f"<h1>Couldn't finish connecting {label}</h1>"
        f"<p>The link back from {label} only works in the same browser where you pressed "
        f"Connect, within {minutes} minutes, and only once.</p>"
        "<p>If you started on another device or browser, go back there and press Connect "
        "again. To connect from this browser instead, sign in to UCT here and press "
        "Connect again.</p>"
        f"<a href=\"{link}\">Open Connections</a>"
        "</body></html>"
    )
    return HTMLResponse(body, status_code=400)


@router.get("/{provider}/callback", response_model=None)
async def oauth_callback(
    provider: str, code: str | None = None, state: str | None = None, error: str | None = None,
    user: dict | None = Depends(get_current_user_optional),
    error_description: str | None = None,
) -> RedirectResponse | HTMLResponse:
    """Fix-round-1 Important #2: the redirect from the provider is a
    top-level browser GET, so the user's OWN `Lax` session cookie arrives
    with it — `get_current_user_optional` (never raises; `None` when
    missing/invalid) reads it. Binding this to the state's own embedded
    user_id closes the account-takeover the reviewer's probe demonstrated:
    a state minted for user2, completed inside user1's browser session (or
    with NO session at all), attached user2's workspace to user1's
    Notebook. HMAC+TTL alone only proves the state wasn't tampered with and
    hasn't expired — neither proves it's being redeemed by the SAME person
    who started the flow."""
    dashboard = _dashboard_url()
    if not registry.is_known(provider) or registry.get_entry(provider).connect_kind != "oauth":
        raise HTTPException(status_code=404, detail=f"unknown OAuth provider {provider!r}")

    if error and provider == "evernote" and _is_evernote_plan_refusal(error, error_description):
        error = EVERNOTE_PLAN_REASON
    if error:
        return RedirectResponse(
            f"{dashboard}/settings?section=connections&connector={provider}&connected=0&reason={quote(error)}",
            status_code=302,
        )
    if not code or not state:
        raise HTTPException(status_code=400, detail="missing code/state")

    try:
        state_user_id = _verify_state(state, provider=provider)  # raises 400 on failure (incl. replay)
    except errors.NoteConnNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except HTTPException:
        return _oauth_state_failure_page(provider)
    if user is None or user.get("id") != state_user_id:
        # SAME page as a bad/expired/replayed state — a missing session and
        # a cross-user session are deliberately indistinguishable from a bad
        # signature to anyone probing this endpoint.
        return _oauth_state_failure_page(provider)
    user_id = state_user_id
    entry = registry.get_entry(provider)
    if not registry.provider_allowed_for(provider, user):
        # The flag can change between connect and callback: nothing is exchanged or stored.
        return RedirectResponse(
            f"{dashboard}/settings?section=connections&connector={provider}&connected=0",
            status_code=302,
        )

    try:
        if provider in oauth._PROVIDERS:
            # Generic path (Notion) -- ZERO per-name code for the TOKEN EXCHANGE itself.
            # `workspaceName`/`workspaceId`/`botId` are Notion's own fields
            # (`_normalize_token_response` never invents them), so falling back to the
            # registry's own label/None keeps this branch honest for a provider with no
            # "workspace" concept at all.
            creds = await oauth.exchange_code(provider, code)
            account_label = creds.get("workspaceName") or entry.label
            remote_id: str | None = creds.get("workspaceId") or creds.get("botId")
        elif provider == "evernote" and not entry.configured():
            # Task 7 review nit: re-checked here; nothing is exchanged or stored.
            return RedirectResponse(
                f"{dashboard}/settings?section=connections&connector={provider}&connected=0"
                f"&reason={quote(EVERNOTE_UNAVAILABLE_REASON)}",
                status_code=302,
            )
        elif provider == "evernote":
            # Plan E Task 7. The PKCE verifier is re-derived
            # from the signed state; one whole-account source (a member has one connector).
            from api.services.journal_two.note_connectors import evernote_oauth
            from api.services.journal_two.note_connectors.providers.evernote import EvernoteProvider
            creds = await evernote_oauth.exchange_code(code, state, _state_secret())
            # Task 7 review m2: NO user, so validation proves the NEW token alone; a 401 here can
            # never refresh (and rotate) a still-stored OLD connection.
            provider_obj = EvernoteProvider(user_id=None)
            try:
                await provider_obj.validate(creds)
            finally:
                await _aclose(provider_obj)
            account_label = "Evernote"
            remote_id = "account"
        else:
            # Unreachable: every registered "oauth" provider is handled above (the 404 at the
            # top of this function already refused any other name).
            raise HTTPException(status_code=404, detail=f"unknown OAuth provider {provider!r}")
    except errors.NoteConnError as e:
        reason = str(e)
        if provider == "evernote" and getattr(e, "code", None) == "evernote_forbidden":
            reason = EVERNOTE_PLAN_REASON  # ruling: any 403 at validate reads as the plan message
        return RedirectResponse(
            f"{dashboard}/settings?section=connections&connector={provider}&connected=0&reason={quote(reason)}",
            status_code=302,
        )

    try:
        _upsert_connector_or_503(user_id, provider, creds, account_label=account_label)
    except HTTPException:
        # Polish item #2: this is a top-level browser GET (the user's own
        # navigation completing the OAuth redirect), not an XHR — letting
        # `_upsert_connector_or_503`'s 503 propagate here would render as a
        # raw JSON error page mid-flow instead of landing the user back on
        # Settings. Same misconfig (`NOTE_ENCRYPTION_KEY` unset), same
        # "nothing got connected" outcome as the `errors.NoteConnError`
        # branch above — just without a `reason=` (the token-connect path,
        # `_connect_token_provider`, is the XHR call site and keeps the
        # 503 JSON `_upsert_connector_or_503` itself raises; only THIS
        # call site needs the redirect treatment). `connected=0` (never
        # `1`) is the self-heal effect's own contract
        # (`ConnectedAppsCard.jsx`: `params.get('connected') !== '1'` is a
        # no-op) — inert on arrival, not a false "connected" signal.
        return RedirectResponse(
            f"{dashboard}/settings?section=connections&connector={provider}&connected=0",
            status_code=302,
        )
    if remote_id:
        # Evernote's folder is just "Evernote" (Task 7 review m1): `dest_folder.default_folder_name`.
        dest_folder_id = _default_dest_folder_id(user_id, provider, account_label, remote_id)
        source = connections.create_source(
            user_id, provider, remote_id, display_name=account_label, dest_folder_id=dest_folder_id,
        )
        # CONNECT == IMPORT. See `_start_initial_sync`.
        if source and source.get("id"):
            _start_initial_sync(source["id"])
    # `connected=1` is the EXACT param the shipped frontend's OAuth
    # return-self-heal effect checks (Task 12, ConnectedAppsCard.jsx) — see
    # this file's module docstring / ConnectBody's contract note. `status=`
    # was this task's own first guess before that contract was found;
    # `connected=1` is the real one.
    return RedirectResponse(f"{dashboard}/settings?section=connections&connector={provider}&connected=1", status_code=302)


# ── POST /{provider}/sources (add an additional source) ──────────────────────

#: The answer to a second Evernote source (final review M1): Evernote syncs the whole account.
EVERNOTE_ONE_SOURCE = ("Evernote syncs your whole account, and it is already connected. "
                       "There is nothing more to add.")


@router.post("/{provider}/sources")
async def add_source(provider: str, user: dict = Depends(_paid), body: AddSourceBody = Depends(_json(AddSourceBody))) -> dict[str, Any]:
    if not registry.is_known(provider):
        raise HTTPException(status_code=404, detail=f"unknown provider {provider!r}")
    _require_provider_allowed(provider, user)
    if connections.get_connector(user["id"], provider) is None:
        raise HTTPException(status_code=409, detail=f"Connect {provider} first.")
    remote_id = (body.remoteId or "").strip()
    if not remote_id:
        raise HTTPException(status_code=400, detail="remoteId is required")
    if provider == "evernote" and any(
            src["provider"] == "evernote" for src in connections.list_sources(user["id"])):
        # Final review M1: Evernote's import keys do not depend on the source, so a second source
        # would sync the same notes under the same keys into a second folder.
        raise HTTPException(status_code=409, detail=EVERNOTE_ONE_SOURCE)

    dest_folder_id = body.destFolderId or _default_dest_folder_id(
        user["id"], provider, body.displayName, remote_id)
    source = connections.create_source(
        user["id"], provider, remote_id, display_name=body.displayName, dest_folder_id=dest_folder_id,
    )
    return {"source": source}


# ── POST /sources/{id}/sync (manual) ──────────────────────────────────────────

@router.post("/sources/{source_id}/sync")
async def sync_source_now(
    source_id: str, full: bool = False, background: bool = False,
    user: dict = Depends(_paid),
) -> dict[str, Any]:
    """On-demand sync of one of the caller's OWN sources. `background=1`
    fires the sync as a detached task and returns immediately (mirrors
    `broker_sync.py`'s `POST /sync?background=1`) so the request doesn't
    hold a worker for a multi-second provider round-trip. Per-source
    asyncio locks + the 10-min cooldown live INSIDE `engine.sync_source` —
    this router never duplicates them (per the task brief's own interface
    note)."""
    source = connections.get_source(user["id"], source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source not found")
    _require_provider_allowed(source["provider"], user)
    # Evernote rate-limit fix round 1 (I3): a provider whose pass can wait out a rate limit
    # (Evernote) always syncs in the background; the source row then reads "syncing", and the
    # progress line when the pass records it.
    if not background and registry.runs_sync_in_background(source["provider"]):
        background = True

    if background:
        if engine.is_source_busy(source_id):
            raise HTTPException(status_code=409, detail=BUSY_DETAIL)

        async def _bg() -> None:
            try:
                # A busy result here (lost the race after the peek) is a
                # quiet no-op: the other run's results will land in the log.
                await engine.sync_source(source_id, full=full, manual=True, member=True)
            except Exception:  # noqa: BLE001
                log.exception("[note_sync] background sync failed for source %s", source_id)

        asyncio.create_task(_bg())
        return {"status": "started", "background": True}

    try:
        result = await engine.sync_source(source_id, full=full, manual=True, member=True)
    except errors.NoteConnError as e:
        _raise_for_provider_error(e)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if isinstance(result, dict) and result.get("status") == "busy":
        raise HTTPException(status_code=409, detail=BUSY_DETAIL)
    return result


# ── PUT /sources/{id} ──────────────────────────────────────────────────────────

@router.put("/sources/{source_id}")
def update_source(source_id: str, user: dict = Depends(_paid), body: SourceUpdateBody = Depends(_json(SourceUpdateBody))) -> dict[str, Any]:
    source = connections.get_source(user["id"], source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source not found")
    _require_provider_allowed(source["provider"], user)
    if body.syncEnabled is None and body.destFolderId is None:
        raise HTTPException(status_code=400, detail="nothing to update")
    if body.syncEnabled is not None:
        connections.set_sync_enabled(user["id"], source_id, body.syncEnabled)
    if body.destFolderId is not None:
        connections.set_dest_folder_id(user["id"], source_id, body.destFolderId)
    return connections.get_source(user["id"], source_id)


# ── DELETE /{provider} (disconnect) ───────────────────────────────────────────

#: Final re-review N1: the whole best-effort Evernote revoke (two POSTs) may take at most this long,
#: so a hanging Evernote never holds a member's Disconnect.
EVERNOTE_REVOKE_BUDGET_S = 10.0


async def _best_effort_revoke_evernote(user_id: str) -> None:
    """Final review M5: Evernote publishes an RFC 7009 `revocation_endpoint`
    (`evernote_oauth.revoke_token`), so Disconnect ends the grant there too: BEFORE the purge (the token must still be readable), and NEVER allowed to
    block or fail the disconnect. Ungated by the flag, as Disconnect is: a member can always cut
    the grant."""
    try:
        creds = connections.get_token(user_id, "evernote")
    except Exception:  # noqa: BLE001 — an unreadable stored credential: nothing to revoke
        return
    if creds is None:
        return
    try:
        from api.services.journal_two.note_connectors import evernote_oauth  # lazy, as the doors above
        await asyncio.wait_for(evernote_oauth.revoke_token(creds), EVERNOTE_REVOKE_BUDGET_S)
    except Exception as e:  # noqa: BLE001 — best-effort; must NEVER block or fail the disconnect
        log.warning("[note_sync] Evernote token revoke failed (disconnect proceeds regardless): %s", e)


@router.delete("/{provider}")
async def disconnect(provider: str, user: dict = Depends(_paid)) -> dict[str, Any]:
    """Purges the connector's token + every source/log/remote-index row for
    this provider — NEVER touches `j2_notes`/`j2_note_folders` (spares
    already-synced notes; `connections.delete_connector`'s own contract).

    ⛔ Obsidian also revokes every `j2_obsidian_devices` row for this user
    (2026-09-02 gap fix). The ingest endpoint (`_authenticate_obsidian_
    device` below) authenticates a push purely off that table, via
    `obsidian_link.authenticate_device` — INDEPENDENTLY of the
    `j2_note_connectors` row this function otherwise purges alone. Without
    this, disconnecting Obsidian here left every already-issued device
    token still valid: a member who disconnects Obsidian in the UI,
    believing they cut the plugin off, still had a plugin able to push
    notes into staging (reproduced before this fix landed — see
    `test_obsidian_ingest.py`'s disconnect-revokes-the-device-token tests).
    Mirrors Evernote's best-effort-revoke-before-purge shape immediately
    below, generalized to whichever provider owns an out-of-band credential
    store of its own (Evernote: a third-party OAuth grant; Obsidian: a
    locally-issued device token) — NOT best-effort, though: a failed revoke
    here must fail the whole disconnect rather than silently claim success
    while a device is still live (see `obsidian_link.revoke_devices`'s own
    docstring)."""
    if not registry.is_known(provider):
        raise HTTPException(status_code=404, detail=f"unknown provider {provider!r}")
    if provider == "evernote":
        await _best_effort_revoke_evernote(user["id"])
    if provider == "obsidian":
        obsidian_link.revoke_devices(user["id"])
    ok = connections.delete_connector(user["id"], provider)
    if not ok:
        raise HTTPException(status_code=404, detail=f"{provider} is not connected")
    return {"disconnected": True}


# ── GET /sources/{id}/log ──────────────────────────────────────────────────────

@router.get("/sources/{source_id}/log")
def source_log(source_id: str, limit: int = 20, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    source = connections.get_source(user["id"], source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source not found")
    bounded = max(1, min(int(limit or 20), 200))
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_sync_log WHERE source_id = ? AND user_id = ? "
            "ORDER BY id DESC LIMIT ?",
            (source_id, user["id"], bounded),
        ).fetchall()
        out = []
        for r in rows:
            failures, unreadable = _parse_failures(r["failures_json"])
            if unreadable:
                log.warning("[note_sync] unreadable failures_json on sync log row %s", r["id"])
            out.append({
                "id": r["id"],
                "at": r["finished_at"] or r["started_at"],
                "status": r["status"],
                "created": r["notes_created"] or 0,
                "updated": r["notes_updated"] or 0,
                "skipped": r["notes_skipped"] or 0,
                "conflicts": r["conflicts"] or 0,
                "sourceDeleted": r["source_deleted"] or 0,
                "adopted": r["adopted"] or 0,  # Plan E Task 8; NULL in older rows reads 0
                "failures": failures,
                "failuresUnreadable": unreadable,
            })
        return {"rows": out}
    finally:
        conn.close()


# ── POST /obsidian/redeem (device connect-code exchange, Task 5b) ───────────
#
# The other half of the "device" `connect_kind` flow `_mint_device_connect_
# code` above started: the member copied a connect code off the dashboard
# (behind a real session + the paid gate, at MINT time); the Obsidian plugin
# POSTs it here to trade it for a long-lived device token. Called by the
# PLUGIN, not a browser -- same reasoning as `/obsidian/ingest` below, this
# endpoint takes NO `Depends(get_current_user)` / session dependency at all.
# Until this existed, a minted code had nothing to redeem against and
# minting never created a `j2_note_sources` row, so nothing ever drove
# `engine.sync_source` for Obsidian -- this closes both gaps in one endpoint.

class ObsidianRedeemBody(BaseModel):
    """Wire shape the (out-of-repo) Obsidian plugin POSTs to trade a connect
    code for a device token. No `consent` field here: consent was already
    given at MINT time (`ConnectBody.consent`, enforced in `connect()`
    before `_mint_device_connect_code` ever runs, behind the session + paid
    gate) -- redeeming is the plugin completing a flow the member already
    consented to at the browser, not a second consent surface with nobody
    at a browser to click it."""
    code: str
    vaultId: str
    label: str | None = None


@router.post("/obsidian/redeem")
def obsidian_redeem(
    request: Request,
    body: ObsidianRedeemBody = Depends(_json(ObsidianRedeemBody, after=None)),
) -> dict[str, Any]:
    """Exchanges a connect code for a device token + creates (or reuses) the
    `j2_note_sources` row that makes the sync engine pull this vault.

    ⛔ No session cookie: the Obsidian plugin runs outside any browser, so
    gating this like every other `/connect` call would make the flow
    unreachable by construction. The connect code itself -- HMAC-signed,
    embeds the minting user_id, single-use, 15-minute TTL, verified INSIDE
    `redeem_connect_code` before this handler does anything else
    (`obsidian_link.py`'s own module docstring) -- IS the credential, the
    same shape `/obsidian/ingest` below already relies on for its own
    device-token auth, one step earlier in the chain.

    What stops an attacker from grinding codes (the task brief's own
    question): this is not a short guessable PIN. A code is
    base64(user_id:ts:nonce:sig) where `sig` is a FULL 256-bit HMAC-SHA256
    digest over the rest, keyed by `PUSH_SECRET`/`VOICE_ACTION_SECRET`.
    Forging a valid one without that secret is a 2^256 search, not a
    rate-limitable few-thousand-guess space, so this is deliberately
    resistant-by-entropy rather than `@limiter.limit`-decorated like
    `auth.py`'s login/signup: this module carries `from __future__ import
    annotations`, and slowapi's `functools.wraps`-based decorator resolves a
    wrapped endpoint's string annotations against ITS OWN module globals
    (`slowapi.extension`, where `ObsidianRedeemBody` does not exist), not
    `note_sync`'s -- confirmed by reproduction: decorating this endpoint
    made FastAPI stop recognizing `body` as a JSON payload at all and treat
    it as a required, always-missing QUERY parameter, 422 on every call.
    Rather than strip the future-annotations import repo-wide (out of this
    task's scope, and every other endpoint here already depends on it) or
    invent a bespoke, POST-body-agnostic per-IP counter no other connector
    endpoint has, the fix is that a rate limiter is redundant here: the
    15-minute TTL plus the single-use nonce
    (`obsidian_link._used_connect_code_nonces`) already close the replay
    window even if one code ever leaked, and entropy alone already makes
    brute-forcing a valid signature computationally infeasible regardless of
    how many requests per minute are allowed.

    Never logs `raw_token` -- it is returned in the response body exactly
    once and nowhere else (mirrors `redeem_connect_code`'s own docstring:
    "the ONLY point the plaintext secret exists outside this call's stack
    frame").

    Idempotent per (user_id, vault_id): `connections.create_source` already
    returns the existing row on a second redemption for the same vault
    (Task 11's own idiom, reused verbatim here) -- a plugin reinstall or a
    stale second `redeem` call never creates a duplicate `j2_note_sources`
    row, exactly like `redeem_connect_code` itself rotates rather than
    duplicates the device row.
    """
    entry = registry.get_entry("obsidian")
    if not entry.configured():
        # Mirrors `_mint_device_connect_code`'s own gate -- stops a
        # redemption in flight just as surely as it stops a new mint.
        # ⛔ This comment used to go further and call the flag "the rollback
        # lever" outright -- FALSE until 2026-09-02 (I2): a device that had
        # ALREADY redeemed kept pushing to `/obsidian/ingest` with the flag
        # off, because that endpoint had no `configured()` check of its own.
        # Mint and redeem alone never made this a kill switch; `obsidian_
        # ingest` (below) now checks independently, and NEITHER endpoint's
        # comment should restate the other's guarantee as fact without
        # actually checking it -- exactly how this one went unverified.
        raise HTTPException(status_code=503, detail=f"{entry.label} is not configured on this server.")
    vault_id = (body.vaultId or "").strip()
    if not body.code or not vault_id:
        raise HTTPException(status_code=400, detail="code and vaultId are required")

    try:
        device_id, raw_token = obsidian_link.redeem_connect_code(body.code, vault_id, body.label)
    except errors.NoteConnError as e:
        _raise_for_provider_error(e)

    device = obsidian_link.get_device(device_id)
    if device is None:
        # Defensive only -- redeem_connect_code just wrote/rotated this
        # exact row with this exact device_id; a None here would mean the
        # write inside that call itself failed, which would already have
        # raised rather than returning.
        raise HTTPException(status_code=503, detail="Obsidian device could not be verified after redemption")
    _require_paid_device_user(device["user_id"])  # same re-check /obsidian/ingest performs on every push
    obsidian_link.record_plugin_version(device_id, request.headers.get(PLUGIN_VERSION_HEADER))

    # ⛔ The `j2_note_sources` row alone is NOT enough to make
    # `engine.sync_source` actually run: `_do_sync` calls
    # `_resolve_credentials(user_id, "obsidian")` unconditionally and RAISES
    # `NoteConnNotConfigured` (aborting the sync before `list_changed` is
    # ever called) the moment that returns `None` -- and it returns `None`
    # whenever no `j2_note_connectors` row exists for (user_id, provider),
    # regardless of whether a source does. Every other provider's connect
    # path (`_connect_token_provider` above) writes BOTH rows for exactly
    # this reason; Obsidian has no real credential to store (push
    # transport -- `ObsidianProvider` never reads `credentials` at all, see
    # its own module docstring), so this upserts an empty placeholder blob
    # purely to satisfy that unconditional resolution step. Reusing
    # `_upsert_connector_or_503` (not a bare `connections.upsert_connector`
    # call) keeps the SAME 503-not-a-traceback behavior every other
    # provider gets if `NOTE_ENCRYPTION_KEY` is missing -- already a
    # prerequisite here regardless, since `redeem_connect_code` itself just
    # encrypted the device secret with the same key.
    _upsert_connector_or_503(device["user_id"], "obsidian", {}, account_label=device["label"])

    dest_folder_id = _default_dest_folder_id(device["user_id"], "obsidian", device["label"], vault_id)
    source = connections.create_source(
        device["user_id"], "obsidian", vault_id,
        display_name=device["label"], dest_folder_id=dest_folder_id,
    )
    return {"deviceId": device_id, "token": raw_token, "vaultId": vault_id, "source": source}


# ── POST /obsidian/ingest (Obsidian plugin push transport, Task 3) ───────────
#
# Obsidian is local-first — the plugin PUSHES; the sync engine only PULLS from
# providers (spec §7.2). This endpoint writes ONLY to the staging tables
# (`obsidian_staging.ingest_batch`) — ⛔ NEVER to `j2_notes`. Writing notes
# directly here would duplicate the conflict ratchet, delete detection, media
# phase and import-hash logic that `note_connectors/engine.py` already owns,
# and the copies would drift ("four readers of one envelope, three of them
# wrong" — this repo has paid for that shape once). Task 4's provider reads
# staging and satisfies the ordinary `NoteProvider` contract instead, so the
# engine's convert -> upsert -> conflict -> media path is inherited unchanged.

_MAX_OBSIDIAN_INGEST_BYTES = 2_000_000  # ~2MB per push. Declared Content-Length
# is checked BEFORE the body is read (mirrors community.py's image-upload
# guard, "reject oversize up front ... so we never buffer a huge body") as a
# fast, cheap short-circuit for an HONEST client. It is NOT the real bound —
# see `_read_bounded_body` below (I7, 2026-09-02 review) for the actual
# enforcement, which holds even when Content-Length is absent, zero, or lies.


async def _read_bounded_body(request: Request, limit: int) -> bytes:
    """⛔⛔ I7 (2026-09-02 review): "the 2MB guard is bypassable via chunked/
    absent Content-Length before `await request.body()`". That was literally
    true — `await request.body()` reads the ENTIRE ASGI body stream into
    memory REGARDLESS of size before any length check ever runs; the
    post-read `len(raw) > limit` check this function replaces only fired
    AFTER the attacker's full claimed body was already buffered. A request
    with no (or a lying) Content-Length sailed past the declared-header
    check above and got fully read into memory before being rejected —
    exactly the resource-exhaustion blast radius the review named: a
    single-replica pod whose volume is shared by 20+ SQLite databases.

    This reads the body incrementally off `request.stream()` instead,
    aborting the INSTANT the running total exceeds `limit` — at most one
    extra chunk beyond `limit` is ever held (an ASGI receive() event is
    typically tens of KB), never an attacker-controlled amount, regardless
    of what Content-Length claims or omits."""
    total = 0
    chunks: list[bytes] = []
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise HTTPException(status_code=400, detail="batch too large")
        chunks.append(chunk)
    return b"".join(chunks)


# Plan C wire protocol (docs/superpowers/plans/2026-11-01-connector-fidelity-c-obsidian.md,
# "The wire protocol"). Every plugin request carries this header; a 0.1.x plugin sends none.
PLUGIN_VERSION_HEADER = "X-UCT-Plugin-Version"
# The plugin's own cap (it sends at most 5000 refs per note). Kept at 5000 after final review
# I1: the attachment pass is now one scan of the body per original
# (`providers/obsidian.py::_apply_attachment_refs`), measured at ~0.8 s for 5000 refs over a
# 1 MB body, and it runs in a worker thread, off the event loop
# (`test_the_attachment_pass_is_bounded_at_the_ref_cap`).
_MAX_ATTACHMENTS_PER_NOTE = 5000
# The statuses that carry a staged blob's hash; every other status carries none.
_REF_STATUSES_WITH_HASH = frozenset({"ok", "storage-limit"})


class ObsidianAttachmentRef(BaseModel):
    """One attachment reference the plugin resolved with Obsidian's own resolver. The
    provider swaps `original` (an exact substring of the note) for the attachment. A ref
    whose hash presence disagrees with its status is refused: the provider would
    otherwise look up a blob for a status that never uploads one, or render a hashless
    `ok` as an attachment it can never fetch."""
    original: str = Field(min_length=1, max_length=2048)
    embed: bool
    path: str = Field(min_length=1, max_length=1024)
    size: int = Field(ge=0)
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    status: Literal["ok", "too-large", "missing", "off", "storage-limit"]

    @model_validator(mode="after")
    def _hash_matches_status(self) -> "ObsidianAttachmentRef":
        if (self.sha256 is not None) != (self.status in _REF_STATUSES_WITH_HASH):
            raise ValueError(f"sha256 must be set exactly when status is ok or storage-limit (status {self.status!r})")
        return self


class ObsidianNoteItem(BaseModel):
    vault_path: str
    content_hash: str
    body_md: str
    updated_at: str
    # None = the plugin sends no refs (0.1.x, or 0.2.0 in legacy mode). Stored as NULL.
    attachments: list[ObsidianAttachmentRef] | None = Field(default=None, max_length=_MAX_ATTACHMENTS_PER_NOTE)


# The ingest batch's top-level notes-array key -- PINNED. This name is a wire
# contract with the out-of-repo Obsidian plugin (Wave 3b): nothing upstream
# of this router enforces that the plugin actually names its field this way.
# `ObsidianIngestBody.notes` is declared REQUIRED (no `= []` default) so a
# batch that sends the notes array under a different or misspelled key
# fails LOUDLY here -- a 400 naming exactly which field pydantic couldn't
# find -- instead of pydantic silently filling in an empty list and the
# endpoint returning a 200 with `written: 0` that reads as a successful,
# merely-empty push. `manifest`/`final` stay genuinely optional (the router
# docstring below already marks them `manifest?`/`final?`); only the notes
# key is load-bearing enough to pin this way.
OBSIDIAN_INGEST_NOTES_FIELD = "notes"


class ObsidianIngestBody(BaseModel):
    """Wire shape the (out-of-repo, Wave 3b) Obsidian plugin pushes.
    `consent` mirrors `ConnectBody.consent` above — the SAME gate, not a
    second scheme (task brief: "paid-gated and consent-gated like the other
    connector endpoints"). Deliberately carries NO `user_id`/`vault_id`
    field: those two values come EXCLUSIVELY from the authenticated device
    (`_authenticate_obsidian_device`) — a same-named field in the body is
    silently ignored by pydantic, never read, so a forged one cannot steer
    a write to a different tenant. Unrecognized EXTRA fields (e.g. a
    same-named-but-irrelevant `user_id`) are likewise silently ignored --
    deliberately: only `OBSIDIAN_INGEST_NOTES_FIELD` itself is pinned, see
    above."""
    consent: bool = False
    notes: list[ObsidianNoteItem]
    manifest: list[str] | None = None
    final: bool = False


def _authenticate_obsidian_device(request: Request) -> dict[str, Any]:
    """Device-token auth (Task 2's `obsidian_link.authenticate_device`) — the
    same `Authorization: Bearer <token>` idiom every other bearer-token
    endpoint in this codebase uses (`push.py`, `desk_zoom_webhook.py`).
    Raises 401 for a missing/malformed header or any token
    `authenticate_device` doesn't recognize.

    ⛔ That "never raises for a bad/garbage token" claim about
    `authenticate_device` was FALSE until obsidian_link.py's
    `compare_digest` calls were fixed to compare BYTES: headers are
    latin-1 decoded, so a raw byte >= 0x80 in the token's secret half
    reached `hmac.compare_digest` as a non-ASCII `str` and raised
    `TypeError` -- a 500 on this exact auth path, not the clean 401 above
    (measured, not assumed). Restated here as its own claim, not a
    cross-reference, is how it went unverified for two files at once;
    read `authenticate_device`'s own docstring for the mechanism, not this
    comment."""
    return _device_from_authorization(request.headers.get("authorization"))


def _device_from_authorization(header: str | None) -> dict[str, Any]:
    auth = header or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    raw_token = auth[len("Bearer "):].strip()
    device = obsidian_link.authenticate_device(raw_token)
    if device is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return device


async def _paid_obsidian_device(request: Request, *, attachments: bool = False) -> dict[str, Any]:
    """The plugin's door, shared by ingest, the attachment check and the blob upload: device
    auth (which writes `last_seen_at`), the paid-plan reads and the plugin-version record,
    in ONE worker-thread call (final review I2). On the event loop these were up to four
    SQLite calls, two of them writes, per request, and the upload runs once per BLOB: under
    auth.db write contention each could hold every member's request for its busy timeout.
    `attachments`: an attachment route. When the master switch is off for this device's
    member (`admin` mode, a non-admin) it answers 404 right after authenticating, before the
    paid gate, so the plugin reads "this server takes no attachments" and syncs text only,
    never a 403 it would read as offline (final review I3)."""
    authorization = request.headers.get("authorization")
    version = request.headers.get(PLUGIN_VERSION_HEADER)

    def gate() -> dict[str, Any]:
        device = _device_from_authorization(authorization)
        user = _device_user(device["user_id"])
        if attachments and not obsidian_attachments.attachments_enabled_for_user(user):
            raise HTTPException(status_code=404, detail="Not Found")
        _require_paid(user)
        obsidian_link.record_plugin_version(device["device_id"], version)
        return device

    return await asyncio.to_thread(gate)


def _require_paid_device_user(user_id: str) -> None:
    """Calls the SAME predicate — `auth_middleware.meets_plan_gate` — that
    `_paid`/`require_plan(list(PAID_PLANS))` enforces on every other
    connector endpoint (admin, OR a PAID_PLANS plan, OR 'comped', OR an
    active trial). Not a `Depends` because `require_plan`'s dependency chain
    resolves the caller from the SESSION COOKIE (`get_current_user_with_
    plan`), and a device push carries no session to read one from — but the
    entitlement RULE itself is not reimplemented here, only the plumbing
    that gets a user dict without a cookie. One predicate, two ways of
    reaching it, so the cookie path and the device path can never drift.
    The identity itself still comes from ONLY the already-authenticated
    device — this never reads a user id out of the request."""
    _require_paid(_device_user(user_id))


def _device_user(user_id: str) -> dict[str, Any] | None:
    """The device's member with their plan, or None."""
    user = auth_service.get_user_by_id(user_id)
    if user is None:
        return None
    user = dict(user)
    user["plan"] = auth_service.get_user_plan(user_id)
    return user


def _require_paid(user: dict[str, Any] | None) -> None:
    if user is not None and meets_plan_gate(user, list(PAID_PLANS)):
        return
    raise HTTPException(status_code=403, detail="Upgrade required")


@router.post("/obsidian/ingest")
async def obsidian_ingest(request: Request) -> dict[str, Any]:
    """Batch push from the Obsidian plugin. Body: `{consent, notes:
    [{vault_path, content_hash, body_md, updated_at}], manifest?, final?}`.
    `manifest` — the vault's COMPLETE path list — is only applied to
    `j2_obsidian_manifest` when `final` is true (see
    `obsidian_staging.ingest_batch`'s docstring for why a partial push must
    never touch it).

    ⛔⛔ I2 (2026-09-02 review): checks `registry.get_entry("obsidian").
    configured()` FIRST, before even authenticating the device token --
    this was previously missing, so `NOTE_SYNC_OBSIDIAN_ENABLED=0` stopped
    NEW mints/redemptions (`_mint_device_connect_code`/`obsidian_redeem`
    both gate on it) but did nothing to an ALREADY-connected device, which
    kept pushing indefinitely. That gap made the flag a partial rollback at
    best, not the kill switch its own name promises -- see the corrected
    comment on `obsidian_redeem`'s identical check for the false claim this
    replaces."""
    entry = registry.get_entry("obsidian")
    if not entry.configured():
        raise HTTPException(status_code=503, detail=f"{entry.label} is not configured on this server.")
    device = await _paid_obsidian_device(request)

    try:
        declared = int(request.headers.get("content-length") or 0)
    except (TypeError, ValueError):
        declared = 0
    if declared > _MAX_OBSIDIAN_INGEST_BYTES:
        raise HTTPException(status_code=400, detail="batch too large")
    raw = await _read_bounded_body(request, _MAX_OBSIDIAN_INGEST_BYTES)

    try:
        payload = json.loads(raw or b"{}")
    except Exception:
        raise HTTPException(status_code=400, detail="invalid JSON body")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid JSON body")
    try:
        body = ObsidianIngestBody(**payload)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not body.consent:
        raise HTTPException(status_code=400, detail="Consent is required to sync from Obsidian.")

    try:
        result = obsidian_staging.ingest_batch(
            user_id=device["user_id"],
            vault_id=device["vault_id"],
            notes=[n.model_dump() for n in body.notes],
            manifest=body.manifest,
            final=body.final,
        )
        if result.get("manifestReplaced"):
            await _gc_staged_blobs(device["user_id"], device["vault_id"])
        # A `final` batch is the plugin saying "that is the whole vault".
        # Draining it into the Notebook right now is what makes connecting a
        # vault mean "bring this vault into UCT" instead of "stage it and
        # wait for the :23 tick". Only on `final` — an intermediate batch is
        # a partial vault and must not be swept in mid-push. See
        # `_start_initial_sync` for the fire-and-forget contract.
        if body.final:
            src = next(
                (x for x in connections.list_sources(device["user_id"])
                 if x.get("provider") == "obsidian" and x.get("remoteId") == device["vault_id"]),
                None,
            )
            if src and src.get("id"):
                _start_initial_sync(src["id"])
        return result
    except errors.NoteConnError as e:
        # I3/I4/I7 (2026-09-02 review): `ingest_batch` now raises
        # `NoteConnValidationError` for a padded/empty manifest or an
        # over-cap batch — mapped to a clean 400, never a 500.
        _raise_for_provider_error(e)


# ── Obsidian attachments (connector fidelity Plan C, Task 2) ─────────────────
#
# The plugin hashes a note's attachments, asks `/attachments/check` which hashes this
# (member, vault) lacks, uploads each missing blob once with `PUT /attachments/{sha256}`,
# then pushes the notes through `/obsidian/ingest` with per-note `attachments` refs. The
# blob store is `obsidian_attachments` (Task 1); these routes are its only door.
#
# Gate order, the same as `obsidian_ingest`: the attachments flag (404), the Obsidian
# flag (503), the device token (401), the paid plan (403), then the version header is
# recorded. The (member, vault) of every read and write is the AUTHENTICATED DEVICE's;
# nothing in the request names either. 404 with the flag off is exactly what a server
# without these routes answers, so a 0.2.0 plugin falls back to text-only either way.

_MAX_ATTACHMENT_CHECK_BYTES = 512_000
_MAX_ATTACHMENT_CHECK_HASHES = 5000
_MAX_ATTACHMENT_NAME_CHARS = 255
_MAX_DECLARED_MIME_CHARS = 255
ATTACHMENT_PROTOCOL_VERSION = 1
# Fix round 1, M5: blob uploads in flight at once, per member and for the pod. Over either
# => 429 at once, before any byte is read (the plugin retries a 429 on its next sync). The
# editor upload doors' gate class, with its OWN instance and limits: a vault sync uploads
# blob after blob, and sharing the editor doors' pod budget would answer a member's editor
# upload 429 while other vaults sync. Per-process state (CLAUDE.md's single-process roster).
OBSIDIAN_UPLOAD_PER_MEMBER_INFLIGHT = 2
OBSIDIAN_UPLOAD_GLOBAL_INFLIGHT = 8
_OBSIDIAN_UPLOAD_GATE = UploadGate(per_member=OBSIDIAN_UPLOAD_PER_MEMBER_INFLIGHT,
                                   total=OBSIDIAN_UPLOAD_GLOBAL_INFLIGHT)


def _obsidian_attachments_off_for_everyone() -> bool:
    """The master switch at `0` (default, unset, unknown): both attachment routes 404 before
    reading anything. `admin` is decided per member after authenticating
    (`_paid_obsidian_device(attachments=True)`). `obsidian_attachments.attachments_mode`."""
    return obsidian_attachments.attachments_mode() == "0"


class ObsidianAttachmentCheckBody(BaseModel):
    sha256: list[str] = Field(max_length=_MAX_ATTACHMENT_CHECK_HASHES)


def _blob_rejected(e: "obsidian_attachments.BlobRejected") -> HTTPException:
    """The store's refusal, unflattened: its status (400 bad id/hash, 403 vault revoked
    mid-upload, 413 too large / member bound, 503 volume full) and its member-safe
    sentence."""
    return HTTPException(status_code=e.status, detail=e.detail)


async def _gc_staged_blobs(user_id: str, vault_id: str) -> None:
    """After a `final` push replaced the manifest, drop this vault's staged blobs no staged
    note references. Off the event loop; a failure is logged and never fails the push
    (the next final push collects them)."""
    try:
        await asyncio.to_thread(obsidian_attachments.gc_unreferenced, user_id, vault_id)
    except Exception:  # noqa: BLE001 -- GC is housekeeping, never the push's outcome
        log.exception("obsidian staged-blob gc failed for user=%s vault=%s", user_id, vault_id)


async def _blob_body(request: Request):
    """The upload body as it arrives, never buffered whole, bounded by the per-file cap
    while it is read (a body with no or a lying Content-Length included). The store
    streams it to disk and hashes it."""
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > obsidian_attachments.MAX_BLOB_BYTES:
            raise obsidian_attachments.BlobRejected(
                413, f"attachment is too large (limit {obsidian_attachments.MAX_BLOB_BYTES // (1024 * 1024)} MB)")
        yield chunk


def _attachment_name(raw: str | None) -> str | None:
    """`X-UCT-Attachment-Name`: the percent-encoded basename, decoded once. A 400, never
    stored: over 255 characters, a path separator, a control character (NUL, CR/LF, tab,
    DEL: the stored name may become a label or a header value), or the names `.` and `..`."""
    if raw is None:
        return None
    name = unquote(raw)
    if (len(name) > _MAX_ATTACHMENT_NAME_CHARS or "/" in name or "\\" in name
            or any(ord(c) < 0x20 or ord(c) == 0x7F for c in name) or name in (".", "..")):
        raise HTTPException(status_code=400, detail="X-UCT-Attachment-Name must be a file name of at most 255 characters")
    return name or None


def _declared_mime(raw: str | None) -> str | None:
    mime = (raw or "").split(";", 1)[0].strip().lower()
    if len(mime) > _MAX_DECLARED_MIME_CHARS:
        raise HTTPException(status_code=400, detail="Content-Type is too long")
    return mime or None


@router.post("/obsidian/attachments/check")
async def obsidian_attachments_check(request: Request) -> dict[str, Any]:
    """`{"sha256": [..≤5000]}` -> `{"protocol", "missing", "maxBytes", "remainingBytes"}`.
    `missing` is the hashes not staged for THIS device's (member, vault), in request order;
    an empty list is how the plugin learns the protocol and the limits."""
    if _obsidian_attachments_off_for_everyone():
        raise HTTPException(status_code=404, detail="Not Found")
    entry = registry.get_entry("obsidian")
    if not entry.configured():
        raise HTTPException(status_code=503, detail=f"{entry.label} is not configured on this server.")
    device = await _paid_obsidian_device(request, attachments=True)

    raw = await _read_bounded_body(request, _MAX_ATTACHMENT_CHECK_BYTES)
    try:
        # The shared body decode: a body nested past the parser's recursion limit is
        # `BodyTooDeep`, a 400 here, never a 500 (fix round 1, I1).
        payload = widget_request_body.loads_json(raw or b"{}")
        body = ObsidianAttachmentCheckBody(**payload) if isinstance(payload, dict) else None
    except (ValueError, ValidationError, widget_request_body.BodyTooDeep):
        body = None
    if body is None:
        raise HTTPException(status_code=400, detail='body must be {"sha256": [up to 5000 hashes]}')
    try:
        missing = await asyncio.to_thread(
            obsidian_attachments.missing_hashes, device["user_id"], device["vault_id"], body.sha256)
    except obsidian_attachments.BlobRejected as e:
        raise _blob_rejected(e)
    remaining = await asyncio.to_thread(obsidian_attachments.remaining_bytes, device["user_id"])
    return {
        "protocol": ATTACHMENT_PROTOCOL_VERSION,
        "missing": missing,
        "maxBytes": obsidian_attachments.MAX_BLOB_BYTES,
        # The plugin's own final review: the limits it must respect, stated by the server
        # (`maxBytes` kept for 0.2.0 plugins that read it).
        "maxBlobBytes": obsidian_attachments.MAX_BLOB_BYTES,
        "maxRefsPerNote": _MAX_ATTACHMENTS_PER_NOTE,
        "remainingBytes": remaining,
    }


@router.put("/obsidian/attachments/{sha256}")
async def obsidian_attachments_put(sha256: str, request: Request) -> dict[str, Any]:
    """Raw body = the blob. `Content-Type` = declared MIME (parameters dropped),
    `X-UCT-Attachment-Name` = percent-encoded basename. `{"stored": false}` means this
    (member, vault) already had it. The store refuses a hash mismatch (400), a body over
    the per-file cap or the member's room (413, the declared length checked before any
    byte is read) and a full volume (503); nothing is left on disk after a refusal."""
    if _obsidian_attachments_off_for_everyone():
        raise HTTPException(status_code=404, detail="Not Found")
    entry = registry.get_entry("obsidian")
    if not entry.configured():
        raise HTTPException(status_code=503, detail=f"{entry.label} is not configured on this server.")
    device = await _paid_obsidian_device(request, attachments=True)

    name = _attachment_name(request.headers.get("x-uct-attachment-name"))
    mime = _declared_mime(request.headers.get("content-type"))
    length_header = request.headers.get("content-length")
    try:
        declared = int(length_header) if length_header is not None else None
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid Content-Length")
    gate = _OBSIDIAN_UPLOAD_GATE
    if not gate.acquire(device["user_id"]):
        raise HTTPException(status_code=429, detail=UPLOAD_BUSY_SENTENCE)
    try:
        stored = await obsidian_attachments.stage_blob_stream(
            user_id=device["user_id"], vault_id=device["vault_id"], sha256=sha256,
            declared_mime=mime, name=name, chunks=_blob_body(request), declared_length=declared,
        )
    except obsidian_attachments.BlobRejected as e:
        raise _blob_rejected(e)
    finally:
        gate.release(device["user_id"])
    return {"stored": stored}
