"""TERM-022 (FB-D1-01) -- the Massive adapter: the one typed boundary new code
reaches Massive REST through.

⭐ ONE CLIENT, ONE BUDGET, ONE ERROR MODEL. Nothing here opens a connection.
Every request goes through `massive._get_client()._typed_get` -- the existing
chokepoint's typed transport, which owns the shared `httpx` session, the token
bucket (`massive._take_token`), the 24h cached-forbidden state and the typed
`Massive*` errors from `provider_errors`. This module adds what callers kept
re-implementing by hand (building the query, holding the key, following
`next_url`) and what they never did (a vendor + licensing-class stamp on every
answer, and per-class counts).

⛔ NO SILENT FALLBACK. Every failure RAISES a `ProviderError` subclass:
  * transport failures, 429s, 5xx, 404, 401/403 -- as `_typed_get` raises them;
  * a cached-forbidden state -- as `MassiveAuthError(code="cached_forbidden")`,
    never as a `None`/empty value a caller could render as "nothing there";
  * pagination past `max_pages` -- `MassiveTransient(code="truncated")`, never a
    silently short list;
  * a `next_url` that is not on `massive._REST_BASE` over https -- refused before
    any request, so the key is never sent to another host.
An empty list/object means Massive ANSWERED and had nothing. Whether a caller
then degrades (a background sweep that logs and moves on) is the caller's own,
visible decision -- it is never made here.

⛔ THE KEY NEVER APPEARS IN AN ERROR. Messages are built from the caller's bare
path (no query string); anything echoed from the vendor passes through
`log_redaction.redact`.

⚠️ THE BUDGET IS PER PROCESS (STATE-7). See the note beside `massive._take_token`.

Adopting it: `get(path, params=..., data_class=..., activity=...)` for one
object, `get_pages(...)` for a `results` list across `next_url` pages. Both
return a `ProviderResult`; read `.value`. The census rail
(`tools/vendor_callsite_census.py`) counts every module that still reaches
around this boundary, and that count only goes down.
"""
from __future__ import annotations

import threading
from typing import Any, Mapping, Optional
from urllib.parse import urlencode

from api.services import massive as _massive
from api.services import provider_errors as _pe
from api.services import provider_licensing_class as _plc
from api.services.log_redaction import redact as _redact

VENDOR = "massive"
_ERR = _massive._ERR  # the ONE Massive error family (MassiveTransient, MassiveNotFound, ...)

_stats_lock = threading.Lock()
_by_class: dict[str, dict[str, int]] = {}


# ── observability ─────────────────────────────────────────────────────────

def _bump(data_class: str, field: str) -> None:
    with _stats_lock:
        row = _by_class.setdefault(data_class, {"calls": 0, "errors": 0, "budget_denied": 0})
        row[field] += 1


def stats() -> dict:
    """Per-data-class call/error/budget-denial counts since process start, plus
    the transport's own budget (shared with every other typed Massive caller)."""
    with _stats_lock:
        by_class = {k: dict(v) for k, v in sorted(_by_class.items())}
    return {"vendor": VENDOR, "by_data_class": by_class, "budget": _massive.budget()}


def reset_stats() -> None:
    """Tests only."""
    with _stats_lock:
        _by_class.clear()


# ── the boundary ──────────────────────────────────────────────────────────

def _require(data_class: str, activity: str) -> None:
    if not isinstance(data_class, str) or not data_class.strip():
        raise ValueError("data_class is required -- it selects the licensing class stamped on the answer")
    if not isinstance(activity, str) or not activity.strip():
        raise ValueError("activity is required -- it is the provenance of the answer")


def _check_path(path: str) -> None:
    if (not isinstance(path, str) or not path.startswith("/") or path.startswith("//")
            or "?" in path or "://" in path):
        raise ValueError("path must be a bare Massive REST path like '/v3/reference/tickers' "
                         "(no host, no query string -- pass params=)")


def _client():
    try:
        return _massive._get_client()
    except RuntimeError:
        raise _ERR.not_configured("MASSIVE_API_KEY not set") from None


def _encode(params: Optional[Mapping[str, Any]], api_key: str) -> str:
    pairs: list[tuple[str, str]] = []
    for k, v in (params or {}).items():
        if str(k).lower() == "apikey":
            raise ValueError("the adapter owns the credential -- never pass apiKey")
        if v is None:
            continue
        pairs.append((str(k), ("true" if v else "false") if isinstance(v, bool) else str(v)))
    pairs.append(("apiKey", api_key))
    return urlencode(pairs, safe=",")


def _next_path(next_url: Any, api_key: str, path: str) -> str:
    """The vendor's cursor URL as a transport path: its query kept VERBATIM
    (a cursor is opaque -- never decoded and re-encoded), any key it carries
    dropped, ours appended once."""
    base = _massive._REST_BASE.rstrip("/") + "/"
    if not isinstance(next_url, str) or not next_url.startswith(base):
        raise _ERR.transient(f"Massive {path}: next_url is not on the Massive REST host -- "
                             "refused, the key is never sent elsewhere", code="foreign_next_url")
    rest = next_url[len(base) - 1:]
    route, _, query = rest.partition("?")
    kept = [seg for seg in query.split("&") if seg and seg.split("=", 1)[0].lower() != "apikey"]
    kept.append(f"apiKey={api_key}")
    return f"{route}?{'&'.join(kept)}"


def _fetch(client, path_qs: str, *, path: str, data_class: str, timeout: Optional[float]) -> dict:
    _bump(data_class, "calls")
    try:
        data = client._typed_get(path_qs, timeout=timeout)
    except _pe.ProviderError as exc:
        _bump(data_class, "errors")
        if isinstance(exc, _pe.ProviderRateLimited) and exc.status is None:
            _bump(data_class, "budget_denied")  # the LOCAL bucket said no; a 429 carries status=429
        raise
    if not isinstance(data, dict):
        _bump(data_class, "errors")
        raise _ERR.transient(f"Massive {path}: answer is not a JSON object")
    if data.get("__degraded__"):
        _bump(data_class, "errors")
        raise _ERR.auth_error(
            f"Massive {path}: {data.get('__degraded__')} since {data.get('__degraded_since__')} "
            "(a 401/403 is cached for 24h; not retried)", status=403, code="cached_forbidden")
    return data


def _result(value: Any, *, data_class: str, activity: str) -> _pe.ProviderResult:
    return _pe.ProviderResult(
        value=value,
        provenance=_pe.ProvenanceRecord(vendor=VENDOR, source_activity=activity),
        licensing_class=_plc.licensing_class_for(VENDOR, data_class),
        freshness=None,  # not established here -- never fabricated from request time
    )


def get(path: str, *, data_class: str, activity: str,
        params: Optional[Mapping[str, Any]] = None,
        timeout: Optional[float] = None) -> _pe.ProviderResult:
    """One Massive REST object. `.value` is the JSON object as Massive sent it.
    Raises a `ProviderError` subclass on any failure (see the module docstring)."""
    _require(data_class, activity)
    _check_path(path)
    client = _client()
    data = _fetch(client, f"{path}?{_encode(params, client._api_key)}",
                  path=path, data_class=data_class, timeout=timeout)
    return _result(data, data_class=data_class, activity=activity)


def get_pages(path: str, *, data_class: str, activity: str, max_pages: int,
              params: Optional[Mapping[str, Any]] = None,
              results_key: str = "results",
              timeout: Optional[float] = None) -> _pe.ProviderResult:
    """Every row of a paginated Massive list, following `next_url`. `.value` is
    the concatenated `results_key` lists. All-or-nothing: a failure on any page,
    or more than `max_pages` pages, RAISES -- a partial list is never returned."""
    _require(data_class, activity)
    _check_path(path)
    if not isinstance(max_pages, int) or max_pages < 1:
        raise ValueError("max_pages must be a positive int -- pagination is always bounded")
    client = _client()
    path_qs = f"{path}?{_encode(params, client._api_key)}"
    rows: list = []
    for _ in range(max_pages):
        data = _fetch(client, path_qs, path=path, data_class=data_class, timeout=timeout)
        page = data.get(results_key)
        if page is None:
            page = []
        if not isinstance(page, list):
            _bump(data_class, "errors")
            raise _ERR.transient(f"Massive {path}: '{_redact(str(results_key))}' is not a list")
        rows.extend(page)
        nxt = data.get("next_url")
        if not nxt:
            return _result(rows, data_class=data_class, activity=activity)
        try:
            path_qs = _next_path(nxt, client._api_key, path)
        except _pe.ProviderError:
            _bump(data_class, "errors")
            raise
    _bump(data_class, "errors")
    raise _ERR.transient(f"Massive {path}: more than {max_pages} pages -- refusing a truncated answer",
                         code="truncated")
