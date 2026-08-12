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
import logging
import os
import secrets
import time
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    PAID_PLANS,
    get_current_user,
    get_current_user_optional,
    require_plan,
)
from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.note_connectors import connections, engine, errors, oauth, registry
from api.services.journal_two.note_connectors.providers.craft import parse_capability_url

log = logging.getLogger("note_connectors.router")

router = APIRouter(prefix="/api/j2/notes/connectors", tags=["note-connectors"])

_paid = require_plan(list(PAID_PLANS))

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
    client-supplied bad state."""
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
    if not _hmac.compare_digest(expected, sig):
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
    raise HTTPException(status_code=502, detail=str(e))


async def _aclose(provider_obj: Any) -> None:
    aclose = getattr(provider_obj, "aclose", None)
    if aclose is not None:
        try:
            await aclose()
        except Exception:  # noqa: BLE001 — cleanup must never mask the real error
            pass


def _dashboard_url() -> str:
    return (os.environ.get("DASHBOARD_URL") or "https://uctintelligence.com").rstrip("/")


def _dropbox_redirect_uri() -> str:
    # Reuses oauth.py's OWN redirect-uri derivation (pure, no side effects,
    # not keyed off oauth.py's `_PROVIDERS` registry at all — see its
    # source) rather than re-deriving the `<PROVIDER>_REDIRECT_URI` override
    # + DASHBOARD_URL + callback-path format a second time here. A second
    # authority over that format drifting from the first is exactly this
    # repo's most-repeated defect class.
    return oauth._redirect_uri("dropbox")


def _default_dest_folder_id(user_id: str, name: str) -> str | None:
    """Best-effort default Notebook folder for a newly-connected source
    (spec §5: "default: 'Roam — {graph}' root folder") — NEVER raises; a
    failure here degrades to `None` (notes land at the Notebook root) rather
    than blocking the connect flow."""
    trimmed = (name or "").strip()[:80] or "Notebook Sync"
    try:
        folder = notes_svc.create_folder(user_id, trimmed)
        return folder["id"]
    except notes_svc.NoteValidationError:
        try:
            for f in notes_svc.list_folders(user_id):
                if f["name"] == trimmed and not f.get("parentId"):
                    return f["id"]
        except Exception:  # noqa: BLE001
            pass
        return None
    except Exception:  # noqa: BLE001
        return None


# ── GET /status ───────────────────────────────────────────────────────────────

def _sync_enabled() -> bool:
    return os.environ.get("NOTE_SYNC_ENABLED") == "1"


_ZERO_COUNTS = {
    "notesCreated": 0, "notesUpdated": 0, "notesSkipped": 0,
    "mediaUploaded": 0, "conflicts": 0,
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
                   media_uploaded, conflicts
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
        }
    return out


@router.get("/status")
def get_status(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Providers configured/connected + per-source freshness (spec §8).
    Consumes `connections.list_connectors` (Task 11 MUST-RESOLVE #6) rather
    than re-querying `j2_note_connectors` directly."""
    connectors = {c["provider"]: c for c in connections.list_connectors(user["id"])}
    all_sources = connections.list_sources(user["id"])
    counts_by_source = _latest_sync_counts(user["id"], [s["id"] for s in all_sources])
    sources_by_provider: dict[str, list[dict[str, Any]]] = {}
    for s in all_sources:
        s = dict(s)
        s["counts"] = counts_by_source.get(s["id"], dict(_ZERO_COUNTS))
        sources_by_provider.setdefault(s["provider"], []).append(s)

    providers: dict[str, Any] = {}
    for name in registry.names():
        entry = registry.get_entry(name)
        connector = connectors.get(name)
        providers[name] = {
            "configured": entry.configured(),
            "connectKind": entry.connect_kind,
            "connected": connector is not None,
            "status": connector["status"] if connector else None,
            "accountLabel": connector["accountLabel"] if connector else None,
            "sources": sources_by_provider.get(name, []),
        }
    return {"enabled": _sync_enabled(), "providers": providers}


# ── POST /{provider}/connect ──────────────────────────────────────────────────

async def _connect_token_provider(provider: str, body: ConnectBody, user_id: str) -> dict[str, Any]:
    entry = registry.get_entry(provider)
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

    connections.upsert_connector(user_id, provider, creds, account_label=info.label)
    dest_folder_id = _default_dest_folder_id(user_id, f"{entry.label} — {info.label}")
    source = connections.create_source(
        user_id, provider, remote_id, display_name=info.label, dest_folder_id=dest_folder_id,
    )
    return {"connected": True, "accountLabel": info.label, "source": source}


def _start_oauth(provider: str, user_id: str) -> dict[str, Any]:
    entry = registry.get_entry(provider)
    if not entry.configured():
        raise HTTPException(status_code=503, detail=f"{entry.label} is not configured on this server.")
    try:
        state = _sign_state(user_id, provider)
    except errors.NoteConnNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    if provider == "notion":
        url = oauth.authorize_url("notion", state)
    else:  # dropbox
        from api.services.journal_two.note_connectors.providers.dropbox import authorize_url as dbx_authorize_url
        url = dbx_authorize_url(_dropbox_redirect_uri(), state)
    return {"redirectUrl": url}


@router.post("/{provider}/connect")
async def connect(provider: str, body: ConnectBody, user: dict = Depends(_paid)) -> dict[str, Any]:
    if not registry.is_known(provider):
        raise HTTPException(status_code=404, detail=f"unknown provider {provider!r}")
    if not body.consent:
        raise HTTPException(status_code=400, detail="Consent is required to connect a note source.")

    entry = registry.get_entry(provider)
    if entry.connect_kind == "oauth":
        return _start_oauth(provider, user["id"])
    return await _connect_token_provider(provider, body, user["id"])


# ── GET /{provider}/callback (OAuth) ──────────────────────────────────────────

@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str, code: str | None = None, state: str | None = None, error: str | None = None,
    user: dict | None = Depends(get_current_user_optional),
) -> RedirectResponse:
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

    if error:
        return RedirectResponse(
            f"{dashboard}/settings?connector={provider}&connected=0&reason={quote(error)}",
            status_code=302,
        )
    if not code or not state:
        raise HTTPException(status_code=400, detail="missing code/state")

    try:
        state_user_id = _verify_state(state, provider=provider)  # raises 400 on failure (incl. replay)
    except errors.NoteConnNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    if user is None or user.get("id") != state_user_id:
        # SAME generic failure as a bad/expired/replayed state — a missing
        # session and a cross-user session are deliberately indistinguishable
        # from a bad signature to anyone probing this endpoint.
        raise HTTPException(status_code=400, detail="invalid or expired state")
    user_id = state_user_id
    entry = registry.get_entry(provider)

    try:
        if provider == "notion":
            creds = await oauth.exchange_code("notion", code)
            account_label = creds.get("workspaceName") or "Notion"
            remote_id: str | None = creds.get("workspaceId") or creds.get("botId") or "workspace"
        else:  # dropbox -- no oauth.py entry (see providers/dropbox.py's own OAuth
            # mechanics); exchanges directly against its documented private
            # helper (the module's own docstring invites this: "the router
            # task ... can call these directly", and the existing provider
            # test suite already does the same).
            from api.services.journal_two.note_connectors.providers import dropbox as dbx
            client = httpx.AsyncClient(timeout=30.0)
            try:
                token_data = await dbx._exchange_authorization_code(client, code, _dropbox_redirect_uri())
            finally:
                await client.aclose()
            creds = {"accessToken": token_data.get("access_token")}
            if token_data.get("refresh_token"):
                creds["refreshToken"] = token_data["refresh_token"]
            provider_obj = registry.build_provider("dropbox")
            try:
                info = await provider_obj.validate(creds)
            finally:
                await _aclose(provider_obj)
            account_label = info.label
            # Dropbox needs a FOLDER before a source can exist -- picked
            # separately via GET .../dropbox/folders + POST .../dropbox/sources
            # (MUST-RESOLVE #3). The connector is fully connected here; the
            # source is not auto-created (unlike Roam/Craft/Notion, where the
            # connector IS the one implicit source).
            remote_id = None
    except errors.NoteConnError as e:
        return RedirectResponse(
            f"{dashboard}/settings?connector={provider}&connected=0&reason={quote(str(e))}",
            status_code=302,
        )

    connections.upsert_connector(user_id, provider, creds, account_label=account_label)
    if remote_id:
        dest_folder_id = _default_dest_folder_id(user_id, f"{entry.label} — {account_label}")
        connections.create_source(
            user_id, provider, remote_id, display_name=account_label, dest_folder_id=dest_folder_id,
        )
    # `connected=1` is the EXACT param the shipped frontend's OAuth
    # return-self-heal effect checks (Task 12, ConnectedAppsCard.jsx) — see
    # this file's module docstring / ConnectBody's contract note. `status=`
    # was this task's own first guess before that contract was found;
    # `connected=1` is the real one.
    return RedirectResponse(f"{dashboard}/settings?connector={provider}&connected=1", status_code=302)


# ── Dropbox folder picker (spec §7: "OWN folder picker") ─────────────────────

@router.get("/{provider}/folders")
async def list_provider_folders(
    provider: str, path: str = "", user: dict = Depends(_paid),
) -> dict[str, Any]:
    if provider != "dropbox":
        raise HTTPException(status_code=404, detail="only dropbox exposes a folder picker")
    try:
        creds = connections.get_token(user["id"], provider)
    except Exception:  # noqa: BLE001 — crypto_box.CryptoBoxError etc. -> treat as needing reconnect
        raise HTTPException(status_code=409, detail="Reconnect Dropbox — stored credentials are unreadable.")
    if creds is None:
        raise HTTPException(status_code=409, detail="Connect Dropbox first.")

    provider_obj = registry.build_provider("dropbox")
    try:
        folders = await provider_obj.list_folders(creds, path)
    except errors.NoteConnError as e:
        _raise_for_provider_error(e)
    finally:
        await _aclose(provider_obj)
    return {"folders": folders}


# ── POST /{provider}/sources (add an additional source) ──────────────────────

@router.post("/{provider}/sources")
async def add_source(provider: str, body: AddSourceBody, user: dict = Depends(_paid)) -> dict[str, Any]:
    if not registry.is_known(provider):
        raise HTTPException(status_code=404, detail=f"unknown provider {provider!r}")
    if connections.get_connector(user["id"], provider) is None:
        raise HTTPException(status_code=409, detail=f"Connect {provider} first.")
    remote_id = (body.remoteId or "").strip()
    if not remote_id:
        raise HTTPException(status_code=400, detail="remoteId is required")

    entry = registry.get_entry(provider)
    label = body.displayName or remote_id
    dest_folder_id = body.destFolderId or _default_dest_folder_id(
        user["id"], f"{entry.label} — {label}")
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

    if background:
        async def _bg() -> None:
            try:
                await engine.sync_source(source_id, full=full, manual=True)
            except Exception:  # noqa: BLE001
                log.exception("[note_sync] background sync failed for source %s", source_id)

        asyncio.create_task(_bg())
        return {"status": "started", "background": True}

    try:
        return await engine.sync_source(source_id, full=full, manual=True)
    except errors.NoteConnError as e:
        _raise_for_provider_error(e)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── PUT /sources/{id} ──────────────────────────────────────────────────────────

@router.put("/sources/{source_id}")
def update_source(source_id: str, body: SourceUpdateBody, user: dict = Depends(_paid)) -> dict[str, Any]:
    source = connections.get_source(user["id"], source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source not found")
    if body.syncEnabled is None and body.destFolderId is None:
        raise HTTPException(status_code=400, detail="nothing to update")
    if body.syncEnabled is not None:
        connections.set_sync_enabled(user["id"], source_id, body.syncEnabled)
    if body.destFolderId is not None:
        connections.set_dest_folder_id(user["id"], source_id, body.destFolderId)
    return connections.get_source(user["id"], source_id)


# ── DELETE /{provider} (disconnect) ───────────────────────────────────────────

async def _best_effort_revoke_dropbox(user_id: str) -> None:
    """Fix-round-1 Important #5 (spec §8: "revoke best-effort, purge
    tokens, keep notes"). Dropbox exposes `POST /2/auth/token/revoke`
    (`providers/dropbox.py::revoke_token`) — called here, BEFORE the token
    is purged (it needs to still be readable), and NEVER allowed to block
    or fail the disconnect: any failure (network, already-revoked, an
    unreadable stored credential) is caught and logged, not raised.
    Notion has no revoke endpoint for a third-party OAuth app (the user's
    own Notion "Connections" settings is the only place that grant can be
    pulled) and Roam/Craft credentials are user-pasted tokens they manage
    themselves, never app-issued OAuth grants — there is nothing on our
    side to revoke for either, so this is Dropbox-only by design, not an
    oversight."""
    try:
        creds = connections.get_token(user_id, "dropbox")
    except Exception:  # noqa: BLE001 — crypto_box.CryptoBoxError etc. -> nothing readable to revoke
        return
    if creds is None:
        return
    try:
        from api.services.journal_two.note_connectors.providers.dropbox import revoke_token
        await revoke_token(creds)
    except Exception as e:  # noqa: BLE001 — best-effort; must NEVER block or fail the disconnect
        log.warning("[note_sync] Dropbox token revoke failed (disconnect proceeds regardless): %s", e)


@router.delete("/{provider}")
async def disconnect(provider: str, user: dict = Depends(_paid)) -> dict[str, Any]:
    """Purges the connector's token + every source/log/remote-index row for
    this provider — NEVER touches `j2_notes`/`j2_note_folders` (spares
    already-synced notes; `connections.delete_connector`'s own contract)."""
    if not registry.is_known(provider):
        raise HTTPException(status_code=404, detail=f"unknown provider {provider!r}")
    if provider == "dropbox":
        await _best_effort_revoke_dropbox(user["id"])
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
        return {"rows": [dict(r) for r in rows]}
    finally:
        conn.close()
