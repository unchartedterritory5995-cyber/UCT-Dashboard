"""Structured exception taxonomy for note-connector providers.

Mirrors the SnapTrade wrapper's exception family
(`api/services/journal_two/broker/snaptrade_client.py`) — a provider (Roam,
Craft, Notion, Dropbox) raises ONLY these outward, never a raw httpx/SDK
exception, so the sync engine and router can make one set of decisions
regardless of which provider is talking:

    NoteConnNotConfigured — provider env creds absent (dark provider)
    NoteConnAuthError     — the stored token/credential was rejected
    NoteConnTokenExpired (⊂ NoteConnAuthError) — token/session expired;
                            caller should prompt a reconnect, same handling
                            as NoteConnAuthError unless a caller wants to
                            special-case it (e.g. a distinct UI message)
    NoteConnRateLimited   — provider asked us to back off (retry_after)
    NoteConnTransient     — 5xx / network / timeout — safe to retry
    NoteConnUnsupported   — the source is real but we cannot sync it
                            (e.g. an encrypted Roam graph) — carries `reason`

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §3.
"""

from __future__ import annotations

from typing import Any


class NoteConnError(Exception):
    """Base for all note-connector errors."""

    def __init__(self, message: str, *, status: int | None = None,
                 code: str | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.body = body


class NoteConnNotConfigured(NoteConnError):
    """Provider env credentials are not set (dark provider — e.g.
    NOTION_CLIENT_ID/SECRET, DROPBOX_APP_KEY/SECRET absent)."""


class NoteConnAuthError(NoteConnError):
    """The stored token/credential was rejected by the provider (401/403 or
    equivalent). Caller should mark the connector 'broken' and prompt a
    reconnect."""


class NoteConnTokenExpired(NoteConnAuthError):
    """The token/session expired (as opposed to being invalid/revoked).
    Subclasses NoteConnAuthError so existing `except NoteConnAuthError`
    handling catches this too; callers that want to distinguish "expired,
    please refresh" from "rejected, please reconnect" can catch this
    specifically."""


class NoteConnRateLimited(NoteConnError):
    """The provider asked us to back off. Carries `retry_after` (seconds)
    when the provider supplied one."""

    def __init__(self, message: str, *, retry_after: float | None = None, **kw):
        super().__init__(message, **kw)
        self.retry_after = retry_after


class NoteConnTransient(NoteConnError):
    """5xx / network / timeout — transient, safe to retry with backoff."""


class NoteConnUnsupported(NoteConnError):
    """The source exists and is reachable but cannot be synced as-is (e.g.
    an encrypted Roam graph our token can't read). Carries `reason` — a
    short, user-facing explanation surfaced verbatim in the UI."""

    def __init__(self, message: str, *, reason: str | None = None, **kw):
        super().__init__(message, **kw)
        self.reason = reason if reason is not None else message
