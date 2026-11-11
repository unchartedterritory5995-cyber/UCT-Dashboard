"""The declared enum of bars SERVE LABELS (P0 rails — serve-label budget).

Every ``bars_fetch._mark_serve(<label>)`` in the codebase — the label the router emits
as ``Server-Timing: bars;desc="<label>"`` — must be one of the keys below. A new
serve path cannot invent an ad-hoc label: ``tests/test_serve_label_budget.py`` scans
every ``_mark_serve`` call (and the dynamic ``tier`` values handed to it) and fails on
an undeclared one, and fails on a declared one nothing emits any more (so this list
cannot rot either).

The monitor (synthetic prod monitor, ``tools/bars_warmth_*``) should classify a
response by ``SERVE_LABELS[label]`` instead of keeping its own hand-copied sets.

PURE DATA. Nothing imports this on the serve path; it changes no behaviour.

Classes:
  warm      — answered from a local store, current
  stale     — answered instantly, payload known/likely stale (SWR)
  deadline  — answered at a wait ceiling; payload may be incomplete / unverified
  cold      — the request waited on an upstream fetch or another request's fetch
  miss      — default before any serve path claimed the request
  route     — not a bars-store read (other series kinds routed through /api/bars)
  shed      — refused / deferred under load
  error     — the serve failed and an empty series was returned
"""

from __future__ import annotations

from types import MappingProxyType

SERVE_CLASSES = ("warm", "stale", "deadline", "cold", "miss", "route", "shed", "error")

_LABELS: dict[str, tuple[str, str]] = {
    # ── api/services/bars_fetch.py ─────────────────────────────────────────────
    "miss":             ("miss",     "default set at _get_bars_inner entry; overwritten by every serve path"),
    "mem":              ("warm",     "in-memory TTL cache hit"),
    "sqlite":           ("warm",     "SQLite bars.db had enough fresh rows"),
    "warm-mem":         ("warm",     "warm-path in-memory hit"),
    "warm-sqlite":      ("warm",     "warm-path SQLite hit"),
    "yf-only":          ("warm",     "index symbols served from yfinance-only path"),
    "delta":            ("warm",     "since= delta poll served from local rows"),
    "delta-async-heal": ("deadline", "delta served now, tail heal running in background"),
    "delta-deadline":   ("deadline", "delta/date-delta heal hit its ceiling; served what is held"),
    "deep-deadline":    ("deadline", "deep-history fetch hit its ceiling"),
    "sd-deadline":      ("deadline", "same-day tail fetch hit its ceiling (unverified tail)"),
    "sd-partial":       ("deadline", "same-day tail fetch returned partial coverage"),
    "stale-swr":        ("stale",    "stale-while-revalidate: cached rows served, refresh behind"),
    "replay-warming":   ("deadline", "replay window still warming"),
    "fetch":            ("cold",     "this request is the designated upstream fetcher"),
    "inflight-wait":    ("cold",     "waited on another request's in-flight fetch"),
    "cold-bg":          ("cold",     "cold symbol: background fetch spawned, empty/no_data answered"),
    # ── api/routers/bars.py ────────────────────────────────────────────────────
    "entry":            ("miss",     "router entry default"),
    "breadth":          ("route",    "breadth series routed through /api/bars"),
    "market-indicator": ("route",    "market-indicator series routed through /api/bars"),
    "index":            ("route",    "index series routed through /api/bars"),
    "warm-shed":        ("shed",     "warm request shed under load (503)"),
    "history-read":     ("warm",     "/api/bars-history sealed read (Server-Timing literal)"),
    # ── api/index_bars.py  (_cached_series tier) ───────────────────────────────
    "index-mem":        ("warm",     "index series memory cache"),
    "index-mem-stale":  ("stale",    "index series memory cache, stale"),
    "index-disk":       ("warm",     "index series disk cache"),
    "index-disk-stale": ("stale",    "index series disk cache, stale"),
    "index-yf":         ("cold",     "index series fetched from yfinance"),
    "index-error":      ("error",    "index serve failed"),
    # ── api/services/breadth_symbols.py  (tier) ────────────────────────────────
    "breadth-build":       ("cold",  "breadth series built on request"),
    "breadth-cache":       ("warm",  "breadth series cache"),
    "breadth-cache-stale": ("stale", "breadth series cache, stale"),
    "breadth-disk":        ("warm",  "breadth series disk"),
    # ── get_serve_layer() fallback ─────────────────────────────────────────────
    "unknown":          ("miss",     "get_serve_layer() before any _mark_serve on this thread"),
}

#: label -> class (one of SERVE_CLASSES). Read-only; the monitor imports this.
SERVE_LABELS = MappingProxyType({k: v[0] for k, v in _LABELS.items()})
#: label -> one-line description.
SERVE_LABEL_DOCS = MappingProxyType({k: v[1] for k, v in _LABELS.items()})


def serve_class(label: str) -> str:
    """Class of a served label; ``'undeclared'`` for anything outside the enum."""
    return SERVE_LABELS.get(label, "undeclared")


def labels_in_class(cls: str) -> frozenset[str]:
    return frozenset(k for k, v in SERVE_LABELS.items() if v == cls)
