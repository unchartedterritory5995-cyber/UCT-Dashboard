"""The ONLY network client for the econ package.

Guarantees:
  * every URL it logs or puts in an exception is ``secrets.redact``-ed;
    request bodies and response bodies never appear in messages;
  * bounded retries: connection errors / timeouts / 5xx / 429 / 408, honoring
    ``Retry-After`` (delta-seconds or HTTP-date, capped at ``backoff_cap``),
    otherwise exponential backoff with FULL jitter; other 4xx are returned to the
    caller untouched (never retried);
  * after the budget: ``model.SourceUnavailable`` naming method + redacted URL +
    last status (or exception TYPE) + attempts -- and raised ``from None`` so a
    raw library exception (whose text contains the unredacted URL) is never
    chained into a logged traceback;
  * redirects are NOT followed (Census answers a bad/missing key with a 302 to
    ``missing_key.html`` + ``X-DataWebAPI-KeyError``); ``Response.location`` is
    exposed and :func:`soft_failure` / :func:`is_error_redirect` classify it;
  * conditional GET (ETag / Last-Modified) through an injected validator store;
  * per-host politeness interval + a per-host/status request counter
    (:meth:`HttpClient.stats`) for request-volume measurement.

Transport contract (injectable for tests): ``transport(req: Request)`` returns
an object with ``status_code`` (or ``status``), ``headers`` (mapping) and
``content`` (bytes). Transient failures should raise :class:`TransportError`,
``ConnectionError`` or ``TimeoutError`` (all retried). Any other exception is
not retried and becomes ``SourceUnavailable`` immediately.
"""
from __future__ import annotations

import copy
import email.utils
import json as _json
import logging
import random
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Optional
from urllib.parse import urlencode, urlsplit, urlunsplit

from . import secrets
from .model import SourceUnavailable

log = logging.getLogger(__name__)
secrets.install_logging_redaction()

DEFAULT_USER_AGENT = "UCT-Intelligence econ-ingest (contact: see docs)"
DEFAULT_HOST_INTERVALS = {
    "api.bls.gov": 0.3,          # BLS v2: 50 requests / 10 s
}
DEFAULT_INTERVAL = 0.25
RETRY_STATUSES = frozenset({408, 429})
# Location / header markers of a provider "error page" redirect.
_ERROR_REDIRECT_MARKERS = ("missing_key", "invalid_key", "error", "keyerror")


class TransportError(Exception):
    """A transient transport failure (connect, read timeout, reset). Retried.

    The message MUST NOT carry the URL; the default transport only records the
    underlying exception's TYPE name.
    """


@dataclass
class Request:
    method: str
    url: str                                   # full URL incl. query (may contain a key!)
    headers: dict[str, str] = field(default_factory=dict)
    body: Optional[bytes] = None
    timeout: Any = (10, 60)
    allow_redirects: bool = False

    def __repr__(self) -> str:                  # never leak the key through a repr
        return f"Request({self.method} {secrets.redact(self.url)})"


@dataclass
class Response:
    status: int
    headers: dict[str, str]                    # lower-case names
    content: bytes
    url_redacted: str
    not_modified: bool = False
    attempts: int = 1
    elapsed_ms: float = 0.0
    validators: Optional[tuple] = None         # (etag, last_modified) seen on a 200

    @property
    def location(self) -> Optional[str]:
        return self.headers.get("location")

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def is_redirect(self) -> bool:
        return 300 <= self.status < 400 and self.status != 304

    def text(self, encoding: str = "utf-8") -> str:
        return (self.content or b"").decode(encoding, "replace")

    def json(self):
        return _json.loads(self.content or b"null")

    def raise_for_status(self) -> "Response":
        """SourceUnavailable (redacted) unless 2xx/304."""
        if self.ok or self.not_modified:
            return self
        raise SourceUnavailable(
            f"HTTP {self.status} for {self.url_redacted} (after {self.attempts} attempt(s))")

    def __repr__(self) -> str:
        return f"Response({self.status} {self.url_redacted} {len(self.content or b'')}B)"


# --------------------------------------------------------------------------- soft failures

def is_empty_body(resp: Response) -> bool:
    """True for a 'successful' answer that carries nothing: b'', whitespace, [], {}, null."""
    body = (resp.content or b"").strip()
    return body in (b"", b"[]", b"{}", b"null")


def is_error_redirect(resp: Response) -> bool:
    """A 30x whose target is a provider error page (Census missing_key.html)."""
    if not resp.is_redirect:
        return False
    if "x-datawebapi-keyerror" in resp.headers:
        return True
    loc = (resp.location or "").lower()
    return any(m in loc for m in _ERROR_REDIRECT_MARKERS)


def soft_failure(resp: Response) -> Optional[str]:
    """Reason string when a response 'succeeded' at HTTP level but is not data.

    None means "no soft failure detected" -- NOT "valid"; validation still runs.
    """
    if resp.not_modified:
        return None
    if resp.is_redirect:
        if is_error_redirect(resp):
            return "provider error redirect (key rejected or missing)"
        return f"unexpected redirect {resp.status}"
    if resp.ok and is_empty_body(resp):
        return "empty body"
    return None


# --------------------------------------------------------------------------- transport

def _default_transport():
    """requests.Session if installed, else httpx.Client. Imported lazily."""
    try:
        import requests  # type: ignore
    except ImportError:  # pragma: no cover - depends on env
        requests = None
    if requests is not None:
        session = requests.Session()
        transient = (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                     requests.exceptions.ChunkedEncodingError)

        def _send(req: Request):
            try:
                return session.request(req.method, req.url, headers=req.headers, data=req.body,
                                       timeout=req.timeout, allow_redirects=req.allow_redirects)
            except transient as e:
                raise TransportError(type(e).__name__) from None
        return _send

    import httpx  # type: ignore

    client = httpx.Client(follow_redirects=False)

    def _send_httpx(req: Request):
        t = req.timeout
        timeout = httpx.Timeout(t[1], connect=t[0]) if isinstance(t, tuple) else httpx.Timeout(t)
        try:
            return client.request(req.method, req.url, headers=req.headers, content=req.body,
                                  timeout=timeout)
        except httpx.TransportError as e:
            raise TransportError(type(e).__name__) from None
    return _send_httpx


def _host(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def _with_params(url: str, params) -> str:
    if not params:
        return url
    items = list(params.items()) if isinstance(params, Mapping) else list(params)
    qs = urlencode(items, doseq=True)
    parts = urlsplit(url)
    query = f"{parts.query}&{qs}" if parts.query else qs
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


# --------------------------------------------------------------------------- client

class HttpClient:
    def __init__(self, transport: Optional[Callable[[Request], Any]] = None,
                 user_agent: str = DEFAULT_USER_AGENT, timeout=(10, 60), max_retries: int = 4,
                 backoff_base: float = 1.0, backoff_cap: float = 60, sleep=time.sleep,
                 clock=time.time, validator_store=None, host_intervals: Optional[dict] = None,
                 default_interval: float = DEFAULT_INTERVAL, rng: Optional[Callable[[], float]] = None):
        self._transport = transport
        self.user_agent = user_agent
        self.timeout = timeout
        self.max_retries = max(0, int(max_retries))
        self.backoff_base = float(backoff_base)
        self.backoff_cap = float(backoff_cap)
        self._sleep = sleep
        self._clock = clock
        self.validator_store = validator_store
        self.host_intervals = dict(DEFAULT_HOST_INTERVALS if host_intervals is None else host_intervals)
        self.default_interval = float(default_interval)
        self._rng = rng or random.random
        self._last_request: dict[str, float] = {}
        self._stats: dict[str, dict[str, int]] = {}
        self._lock = threading.Lock()

    # ---------------------------------------------------------------- public verbs
    def get(self, url, params=None, headers=None, conditional_key=None,
            defer_validators: bool = False) -> Response:
        return self._request("GET", _with_params(url, params), headers, None,
                             conditional_key, defer_validators)

    def post_json(self, url, body, params=None, headers=None, conditional_key=None) -> Response:
        h = {"Content-Type": "application/json"}
        h.update(headers or {})
        data = _json.dumps(body).encode("utf-8")
        return self._request("POST", _with_params(url, params), h, data, conditional_key, False)

    def post_form(self, url, data, params=None, headers=None, conditional_key=None) -> Response:
        h = {"Content-Type": "application/x-www-form-urlencoded"}
        h.update(headers or {})
        items = list(data.items()) if isinstance(data, Mapping) else list(data)
        payload = urlencode(items, doseq=True).encode("utf-8")
        return self._request("POST", _with_params(url, params), h, payload, conditional_key, False)

    def commit_validators(self, conditional_key: str, resp: Response) -> None:
        """Store ETag/Last-Modified AFTER the caller validated the payload.

        Use with ``get(..., defer_validators=True)`` so a 200 whose payload later
        FAILS validation cannot turn every future poll into a 304.
        """
        if self.validator_store is None or not conditional_key or not resp.validators:
            return
        etag, lm = resp.validators
        if etag or lm:
            self.validator_store.put(conditional_key, etag, lm)

    def stats(self) -> dict:
        """{"by_host": {host: {status|error: n}}, "total": n}. Copy; safe to mutate."""
        with self._lock:
            by_host = copy.deepcopy(self._stats)
        return {"by_host": by_host, "total": sum(sum(v.values()) for v in by_host.values())}

    def reset_stats(self) -> None:
        with self._lock:
            self._stats.clear()

    # ---------------------------------------------------------------- internals
    def _count(self, host: str, key: str) -> None:
        with self._lock:
            h = self._stats.setdefault(host, {})
            h[key] = h.get(key, 0) + 1

    def _polite_wait(self, host: str) -> None:
        interval = self.host_intervals.get(host, self.default_interval)
        if interval <= 0:
            self._last_request[host] = self._clock()
            return
        last = self._last_request.get(host)
        if last is not None:
            wait = interval - (self._clock() - last)
            if wait > 0:
                self._sleep(wait)
        self._last_request[host] = self._clock()

    def _retry_after(self, headers: Mapping[str, str]) -> Optional[float]:
        raw = (headers.get("retry-after") or "").strip()
        if not raw:
            return None
        try:
            secs = float(raw)
        except ValueError:
            try:
                dt = email.utils.parsedate_to_datetime(raw)
            except (TypeError, ValueError, IndexError):
                return None
            if dt is None:
                return None
            secs = dt.timestamp() - self._clock()
        return min(max(0.0, secs), self.backoff_cap)

    def _backoff(self, attempt: int) -> float:
        ceiling = min(self.backoff_cap, self.backoff_base * (2 ** (attempt - 1)))
        return self._rng() * ceiling           # full jitter

    def _get_transport(self):
        if self._transport is None:
            self._transport = _default_transport()
        return self._transport

    def _request(self, method: str, url: str, headers, body, conditional_key,
                 defer_validators: bool) -> Response:
        url_red = secrets.redact(url)
        host = _host(url)
        h = {"User-Agent": self.user_agent, "Accept-Encoding": "gzip, deflate"}
        h.update(headers or {})
        if conditional_key and self.validator_store is not None:
            v = self.validator_store.get(conditional_key)
            if v:
                etag, lm = v
                if etag:
                    h["If-None-Match"] = etag
                if lm:
                    h["If-Modified-Since"] = lm
        req = Request(method=method, url=url, headers=h, body=body, timeout=self.timeout)

        transport = self._get_transport()
        total = self.max_retries + 1
        last = "no attempt"
        for attempt in range(1, total + 1):
            self._polite_wait(host)
            t0 = self._clock()
            delay: Optional[float] = None
            try:
                raw = transport(req)
            except (TransportError, ConnectionError, TimeoutError) as e:
                kind = type(e).__name__
                self._count(host, f"error:{kind}")
                last = kind
                log.debug("econ.http %s %s -> %s (attempt %d/%d)", method, url_red, kind,
                          attempt, total)
            except Exception as e:  # not transient -> no retry, no raw text
                kind = type(e).__name__
                self._count(host, f"error:{kind}")
                raise SourceUnavailable(
                    f"{method} {url_red} failed: {kind} (attempt {attempt})") from None
            else:
                status = int(getattr(raw, "status_code", None) or getattr(raw, "status", 0) or 0)
                rh = {str(k).lower(): str(v) for k, v in dict(getattr(raw, "headers", {}) or {}).items()}
                content = getattr(raw, "content", b"") or b""
                if isinstance(content, str):
                    content = content.encode("utf-8")
                ms = (self._clock() - t0) * 1000.0
                self._count(host, str(status))
                log.debug("econ.http %s %s -> %d in %.0fms (attempt %d/%d)", method, url_red,
                          status, ms, attempt, total)
                if status >= 500 or status in RETRY_STATUSES:
                    last = f"status {status}"
                    delay = self._retry_after(rh) if status in (429, 503) else None
                else:
                    resp = Response(status=status, headers=rh, content=content,
                                    url_redacted=url_red, not_modified=(status == 304),
                                    attempts=attempt, elapsed_ms=ms)
                    if status == 200:
                        etag, lm = rh.get("etag"), rh.get("last-modified")
                        if etag or lm:
                            resp.validators = (etag, lm)
                            if conditional_key and not defer_validators:
                                self.commit_validators(conditional_key, resp)
                    return resp
            if attempt < total:
                self._sleep(delay if delay is not None else self._backoff(attempt))
        raise SourceUnavailable(
            f"{method} {url_red} failed after {total} attempt(s) (last: {last})") from None
