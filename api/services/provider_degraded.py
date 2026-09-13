"""D1/S8 — the ONE shape a caller attaches when a provider call failed.

⛔ THE ADAPTER'S CONTRACT IS FAIL-FAST, AND THE CALL SITE OWNS DEGRADATION
(owner ruling, 2026-09-12). `fmp_client`'s typed functions RAISE — not-found,
entitlement-denied, rate-limited, transient, not-configured — and that is
deliberate: the adapter has the typed evidence but not the context to decide
whether a member should see nothing, a stale value, or a note. This module is
what a call site uses to say *"empty BECAUSE x"* instead of just empty.

──────────────────────────────────────────────────────────────────────────────
⛔ DEGRADED IS NOT ABSENT, AND THEY MUST NOT RENDER THE SAME
──────────────────────────────────────────────────────────────────────────────

This is the `CoverageLine` lesson applied to one field: *"we could not compute
it"* and *"there is nothing here"* are different facts to a member, and a
surface that collapses them makes a provider outage look like a quiet market.
A caller that returns its empty shape with **no** envelope is saying the second
thing; attaching one says the first.

⭐ So the envelope is ADDITIVE and never replaces the empty shape. A client that
ignores it behaves exactly as before; a client that reads it can show the note.

⚠️ **`source` is `provider_error` and nothing else.** It is a discriminator for
the UI, not a free-text field — a second spelling would mean a surface could
check for one and silently miss the other.
"""
from __future__ import annotations

from typing import Any

#: The discriminator. ⛔ One spelling, named once.
SOURCE_PROVIDER_ERROR = "provider_error"


def error_kind(exc: Exception) -> str:
    """The D1 typed exception -> its short kind.

    ⭐ The ladder is ordered most-specific-first and ends in `unknown` rather
    than raising: a caller degrading a response must never itself fail because
    the failure was an unfamiliar shape.
    """
    from api.services import provider_errors as pe

    return (
        "not_configured" if isinstance(exc, pe.ProviderNotConfigured) else
        "not_found" if isinstance(exc, pe.ProviderNotFound) else
        "auth_error" if isinstance(exc, pe.ProviderAuthError) else
        "rate_limited" if isinstance(exc, pe.ProviderRateLimited) else
        "transient" if isinstance(exc, pe.ProviderTransient) else
        "unknown"
    )


def envelope(exc: Exception, *, activity: str | None = None) -> dict[str, Any]:
    """The S8 provenance envelope for a failed provider call.

    `activity` names the call site (e.g. `"research.quote"`), so a surface
    showing two degraded fields can say WHICH one is degraded rather than
    reporting one note for the whole page.
    """
    return {
        "source": SOURCE_PROVIDER_ERROR,
        "kind": error_kind(exc),
        "vendor": getattr(exc, "vendor", None),
        "status": getattr(exc, "status", None),
        "entitlement_denied": getattr(exc, "entitlement_denied", None),
        "activity": activity,
        "message": str(exc),
    }


def error_shape(exc: Exception) -> dict[str, Any]:
    """The per-vendor JSON error shape `/api/provenance/quote` has returned
    since S8 Step 2.

    ⭐ Kept here so the two are ONE authority rather than two spellings of the
    same ladder. `provenance_quote._error_shape` delegates to this; it used to
    own its own copy, and a copy of a type ladder is exactly the thing that
    drifts the day a new provider error class is added
    (`lesson_a_second_authority_over_one_value`).
    """
    return {
        "error": True,
        "kind": error_kind(exc),
        "vendor": getattr(exc, "vendor", None),
        "status": getattr(exc, "status", None),
        "entitlement_denied": getattr(exc, "entitlement_denied", None),
        "message": str(exc),
    }
