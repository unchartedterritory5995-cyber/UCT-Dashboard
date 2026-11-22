"""MD-1 kind `themes.rotation` (owner: terminal-data, data wave 2) — which UCT themes are rotating in and out.

The Agent half of the TROT terminal panel (app/src/pages/terminal/panels/themeRotationModel.js), over the answer
`services/theme_performance.compute_rotation_signals()` gives `GET /api/theme-rotation`: every theme's 1-week, 1-month
and 3-month return ranked as a percentile among all themes (0 weakest, 100 strongest); a theme whose 1-week rank is
THRESHOLD or more points above its 1-month rank is "rotating in", THRESHOLD or more below is "rotating out".

⛔ READ FROM THE SERVICE'S CACHE, NEVER COMPUTED HERE (MD-1 §5). `compute_rotation_signals()` answers from its own
15-minute cache, and on a miss calls `get_theme_performance()`, which builds the live theme overlay synchronously when
that is cold: about 22 Massive requests, more than a turn's whole provider budget (the reason `themes` reads without
building, MD-1 §4.3). So this adapter reads the service's cache entry (`cache[_ROTATION_CACHE_KEY]`) and nothing else:
  * an entry → the answer, provider_calls 0;
  * no entry → `unavailable`, with the reason. The cache is filled whenever the member route, the Charts theme groups
    or a Screener build asks the service; this read never asks it to compute.
⚠️ COUPLING, stated: one cache-key constant of the service. A rail computes through the service and reads the entry
back by that name, so a rename fails by name.

TIME (MD-1 §3)
  * `generated_at` is when UCT worked the ranking out (a computation time, like `fetched_at`), from theme returns that
    are re-priced from snapshots while a session can print. The vendor's observation time is not carried, so `as_of` is
    null, `data.computed_at` gives UCT's time, labelled as such, and it is never worded as live. freshness `periodic`.
  * `stale` is always false: the entry is at most 15 minutes old by the service's own TTL, and whether the theme
    returns behind it are a session behind is not checked here. A note says so.

MODEL-ISOLATED (ADR-005): "rotating in" / "rotating out" is UCT's own selection (its percentile ranks and its
THRESHOLD-point rule over its own curated themes), a UCT-derived ranking like `leaders.longRun`, not a vendor fact.
The plain theme returns stay the non-isolated `themes` kind. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "themes.rotation"
SOURCE = "uct-theme-rotation"
SIDES = ("both", "in", "out")
DEFAULT_LIMIT = 20
MAX_LIMIT = 50
#: the service's own rule (a rank change of this many percentile points is a rotation), railed against its source
THRESHOLD = 20
#: an entry's fields, by the route's own names; returns are percent, ranks are percentiles 0-100
ENTRY_FIELDS = ("name", "ticker", "1w_return", "1w_rank", "1m_return", "1m_rank", "3m_return", "3m_rank",
                "momentum_delta")

NOTE_WHAT = ("each theme's 1-week and 1-month return is ranked as a percentile among all of UCT's themes; a theme is "
             "rotating in when its 1-week rank is 20 or more points above its 1-month rank, and rotating out when it "
             "is 20 or more points below. UCT's own ranking of its own themes, not a forecast")
NOTE_TIME = ("worked out by UCT at {at} from its theme returns, which are re-priced while a session is open (UCT's "
             "time; the vendor's observation time is not carried), and kept for up to 15 minutes, so as_of is not "
             "given: not a live feed")
NOTE_NO_TIME = "the ranking carries no time, so as_of is not given"
NOTE_BASE = "whether the theme returns behind the ranking are a session behind is not checked by this read"
NOTE_NOT_CACHED = ("the theme rotation ranking is not held in the server's cache at the moment (it is kept 15 minutes "
                   "after it is worked out), and this read never starts that computation; ask again shortly")
NOTE_WARMING = "theme returns are still being computed on the server, so no theme is ranked yet"
NOTE_FAILED = "the theme rotation ranking could not be read"
NOTE_NONE = "no theme is rotating {side} by 20 points or more among the {ranked} ranked; that is a healthy answer"
NOTE_CUT = "showing the first {n} of {total} themes rotating {side}, biggest rank change first"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    if params.get("side", "both") not in SIDES:
        return "`side` must be one of " + ", ".join(SIDES)
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v else None


def _entries(raw: Any, sign: int) -> list[dict]:
    """The rows of one list, on the right side of zero (the service's own sign rule), biggest change first."""
    out = []
    for e in raw if isinstance(raw, list) else []:
        delta = _num(e.get("momentum_delta")) if isinstance(e, dict) else None
        if delta is None or delta * sign <= 0 or not str(e.get("ticker") or "").strip():
            continue
        out.append({k: e.get(k) for k in ENTRY_FIELDS})
    return sorted(out, key=lambda r: -abs(r["momentum_delta"]))


def _computed_at(raw: Any) -> Optional[str]:
    try:
        d = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return env.utc_iso(d if d.tzinfo else d.replace(tzinfo=timezone.utc))


def cached_signals() -> Any:
    """The service's cached answer WITHOUT computing it (see the module docstring), or None."""
    from api.services import theme_performance as svc
    from api.services.cache import cache
    return cache.get(svc._ROTATION_CACHE_KEY)


def read_themes_rotation(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    side = params.get("side", "both")
    limit = params.get("limit", DEFAULT_LIMIT)
    try:
        hit = cached_signals()
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never a guess
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if hit is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_CACHED)
    if not isinstance(hit, dict) or not isinstance(hit.get("rotating_in"), list) or not isinstance(hit.get("rotating_out"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    rankings = hit.get("rankings") if isinstance(hit.get("rankings"), dict) else {}
    if not rankings:                                       # the service's cold answer: "not ready", never "nothing rotates"
        return env.unavailable(KIND, params, SOURCE, NOTE_WARMING)

    lists = {"in": _entries(hit["rotating_in"], 1) if side in ("both", "in") else [],
             "out": _entries(hit["rotating_out"], -1) if side in ("both", "out") else []}
    computed_at = _computed_at(hit.get("generated_at"))
    notes = [NOTE_WHAT, NOTE_TIME.format(at=computed_at) if computed_at else NOTE_NO_TIME, NOTE_BASE]
    for s in ("in", "out"):
        if side not in ("both", s):
            continue
        if not lists[s]:
            notes.append(NOTE_NONE.format(side=s, ranked=len(rankings)))
        elif len(lists[s]) > limit:
            notes.append(NOTE_CUT.format(n=limit, total=len(lists[s]), side=s))
    total = len(lists["in"]) + len(lists["out"])
    shown = min(len(lists["in"]), limit) + min(len(lists["out"]), limit)
    # `rotating_in` / `rotating_out` / `generated_at` keep the route's own names (the TROT panel's model reads them)
    data = {"side": side, "rotating_in": lists["in"][:limit], "rotating_out": lists["out"][:limit],
            "in_count": len(lists["in"]), "out_count": len(lists["out"]), "ranked": len(rankings),
            "threshold": THRESHOLD, "generated_at": hit.get("generated_at") if computed_at else None,
            "computed_at": computed_at}
    coverage = {"evaluated": len(rankings), "answered": shown, "dropped": total - shown,
                "not_computable": 0}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                             stale=False, coverage=coverage, notes=notes, provider_calls=0)
