"""Adapter contract + the adapter registry (by name).

An adapter ONLY turns provider payloads into ``model.RawObs`` (ISO period
bounds, float|None). It never decides currentness, never writes the store,
never logs payloads, and its ``request_key`` never contains a key.
"""
from __future__ import annotations

import hashlib
import os
from datetime import date
from typing import Any, Iterable, Iterator, Literal, Optional, Protocol, runtime_checkable

from .. import secrets
from ..model import FetchResult, RawObs

Mode = Literal["history", "latest"]


# --------------------------------------------------------------------------- SeriesSpec

class SeriesSpec:
    """Read-only attribute view over one registry entry dict (design doc keys).

    ``spec.symbol``, ``spec.adapter`` (= source.adapter), ``spec.params``
    (= source.params), ``spec.provider_series_id``, ``spec.frequency``,
    ``spec.week_anchor``, ``spec.units``, ``spec.revision``, ``spec.release``,
    ``spec.pit``, ``spec.derivation``, ``spec.licensing``, ``spec.source`` ...
    Any other top-level key is reachable as an attribute too; ``spec.raw`` is
    the underlying dict. Missing keys read as None.
    """

    __slots__ = ("_d",)

    def __init__(self, entry: dict):
        if isinstance(entry, SeriesSpec):
            entry = entry.raw
        if not isinstance(entry, dict) or not entry.get("symbol"):
            raise ValueError("SeriesSpec needs a registry entry dict with a 'symbol'")
        object.__setattr__(self, "_d", entry)

    @property
    def raw(self) -> dict:
        return self._d

    @property
    def symbol(self) -> str:
        return self._d["symbol"]

    @property
    def source(self) -> dict:
        return self._d.get("source") or {}

    @property
    def adapter(self) -> Optional[str]:
        return self.source.get("adapter")

    @property
    def params(self) -> dict:
        return self.source.get("params") or {}

    @property
    def provider_series_id(self) -> Optional[str]:
        return self.source.get("provider_series_id")

    @property
    def agency(self) -> Optional[str]:
        return self.source.get("agency")

    @property
    def dataset(self) -> Optional[str]:
        return self.source.get("dataset")

    @property
    def week_anchor(self) -> str:
        return self._d.get("week_anchor") or ""

    @property
    def units(self) -> dict:
        return self._d.get("units") or {}

    @property
    def revision(self) -> dict:
        return self._d.get("revision") or {}

    @property
    def release(self) -> dict:
        return self._d.get("release") or {}

    def get(self, key: str, default=None):
        return self._d.get(key, default)

    def __getattr__(self, name: str):
        if name.startswith("__"):
            raise AttributeError(name)
        return self._d.get(name)

    def __setattr__(self, name, value):
        raise AttributeError("SeriesSpec is read-only")

    def __eq__(self, other) -> bool:
        return isinstance(other, SeriesSpec) and other.symbol == self.symbol

    def __hash__(self) -> int:
        return hash(self.symbol)

    def __repr__(self) -> str:
        return f"SeriesSpec({self.symbol}, adapter={self.adapter})"


def as_specs(entries: Iterable) -> list[SeriesSpec]:
    return [e if isinstance(e, SeriesSpec) else SeriesSpec(e) for e in entries]


# --------------------------------------------------------------------------- protocol

@runtime_checkable
class Adapter(Protocol):
    name: str                          # "bls"
    key_env: Optional[str]             # "BLS_API_KEY" or None
    max_series_per_request: int

    def fetch(self, specs: list[SeriesSpec], *, mode: Mode, start: Optional[date],
              end: Optional[date], http: Any) -> list[FetchResult]: ...

    # optional:
    # def calendar_events(self, horizon_days: int, http) -> list[CalendarEvent]


class BaseAdapter:
    """Helpers shared by concrete adapters. Subclasses set name/key_env and fetch()."""

    name: str = ""
    key_env: Optional[str] = None
    max_series_per_request: int = 1

    def fetch(self, specs, *, mode, start, end, http) -> list[FetchResult]:  # pragma: no cover
        raise NotImplementedError

    def key(self) -> Optional[str]:
        """The configured provider key, or None (-> keyless path or SourceUnavailable)."""
        k = secrets.provider_key(self.name)
        if k is None and self.key_env and self.key_env not in secrets.KEY_ENV.values():
            k = (os.environ.get(self.key_env) or "").strip() or None
        return k

    def chunk(self, specs: Iterable) -> Iterator[list[SeriesSpec]]:
        n = max(1, int(self.max_series_per_request or 1))
        batch: list[SeriesSpec] = []
        for s in as_specs(specs):
            batch.append(s)
            if len(batch) == n:
                yield batch
                batch = []
        if batch:
            yield batch

    @staticmethod
    def sha256(payload) -> str:
        if payload is None:
            payload = b""
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    def make_result(self, request_key: str, observations: Optional[list[RawObs]] = None, *,
                    resp=None, payload: Optional[bytes] = None,
                    source_published_at: Optional[int] = None,
                    warnings: Optional[list[str]] = None,
                    http_status: Optional[int] = None) -> FetchResult:
        """Build a FetchResult. REFUSES a request_key that redaction would change."""
        if secrets.redact(request_key) != request_key:
            raise ValueError("request_key contains secret material; build it from ids only")
        if payload is None and resp is not None:
            payload = resp.content
        status = http_status if http_status is not None else (resp.status if resp is not None else None)
        not_modified = bool(getattr(resp, "not_modified", False))
        return FetchResult(
            adapter=self.name, request_key=request_key,
            observations=list(observations or []),
            source_published_at=source_published_at, http_status=status,
            payload_sha256=self.sha256(payload) if payload is not None else None,
            payload_bytes=len(payload or b""), not_modified=not_modified,
            warnings=list(warnings or []), raw_payload=payload,
        )


# --------------------------------------------------------------------------- registry

ADAPTERS: dict[str, type] = {}
_INSTANCES: dict[str, Any] = {}


def register(adapter_cls):
    """Class decorator: ``@register class BlsAdapter(BaseAdapter): name = "bls"``."""
    name = getattr(adapter_cls, "name", None)
    if not name:
        raise ValueError(f"{adapter_cls!r} has no 'name'")
    existing = ADAPTERS.get(name)
    if existing is not None and existing is not adapter_cls and (
            existing.__module__, existing.__qualname__) != (adapter_cls.__module__, adapter_cls.__qualname__):
        raise ValueError(f"adapter name {name!r} already registered by {existing.__module__}")
    ADAPTERS[name] = adapter_cls
    _INSTANCES.pop(name, None)
    return adapter_cls


def unregister(name: str) -> None:
    ADAPTERS.pop(name, None)
    _INSTANCES.pop(name, None)
