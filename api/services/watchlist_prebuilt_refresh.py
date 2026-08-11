"""Auto-manage the prebuilt ETF watchlists — monthly liquidity re-rank + delisted pruning.

The curated THEME lists (Sector SPDRs, Commodities, Bonds…) are intentionally hand-authored
and stable — this never re-picks their members. What it DOES manage:

  1. 'Liquid Major ETFs' — re-ranked from live Massive grouped-daily dollar volume, so a newly
     liquid ETF earns its spot and a faded one drops off.
  2. Delisted pruning — any ticker in ANY list that stops trading (absent from grouped-daily
     across the last several sessions) is removed from every list.

Both write to a durable /data overlay (`prebuilt_lists_overlay.json`) that survives deploys and
is layered over the committed config by watchlist_prebuilt._apply_overlay. Scheduled monthly in
main.py, with a startup catch-up when the overlay is missing or stale. Read-only against
Massive; never wipes the overlay on a bad/empty API response (guarded)."""
import datetime
import json
import logging
import os
import time
import urllib.request

from api.services import watchlist_prebuilt as wp

_log = logging.getLogger(__name__)

BASE = "https://api.massive.com"
TOP_N = 100
_ALIVE_LOOKBACK_DAYS = 5   # a live ETF trades within this many recent sessions
_MIN_LIQUID = 50           # sanity floor — below this the API response is untrustworthy
_MIN_ALIVE = 1000          # grouped-daily should return thousands of symbols on a real day

# Same leveraged / single-stock exclusions as tools/build_prebuilt_lists.py.
_LEV_EXCLUDE = [
    "2X", "3X", "4X", "1.5X", "1.25X", "-1X", "-2X", "-3X",
    "ULTRA", "LEVERAGED", "INVERSE", "GEARED", "BOOST", "BULL", "BEAR",
    "YIELDMAX", "T-REX", "DAILY TARGET",
]


def overlay_age_days():
    ts = wp._read_overlay().get("updated_at")
    try:
        return (time.time() - float(ts)) / 86400.0 if ts else None
    except Exception:
        return None


def _key():
    return os.environ.get("MASSIVE_API_KEY", "")


def _get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def _paginate(u, key, cap=400):
    out = []
    for _ in range(cap):
        d = _get(u)
        out.extend(d.get("results") or [])
        nx = d.get("next_url")
        if not nx:
            break
        u = nx + (f"&apiKey={key}" if "apiKey=" not in nx else "")
    return out


def _grouped_recent_days(key, want_days):
    """Return [(date, {TICKER: dollar_vol})] for the most recent `want_days` trading days."""
    out = []
    d = datetime.date.today()
    for _ in range(want_days + 8):  # scan back far enough to skip weekends/holidays
        if len(out) >= want_days:
            break
        data = _get(f"{BASE}/v2/aggs/grouped/locale/us/market/stocks/{d.isoformat()}?adjusted=true&apiKey={key}")
        rows = data.get("results") or []
        if rows:
            dvol = {}
            for r in rows:
                t, c, v = (r.get("T") or "").upper(), r.get("c"), r.get("v")
                if t and c and v:
                    dvol[t] = c * v
            if dvol:
                out.append((d.isoformat(), dvol))
        d -= datetime.timedelta(days=1)
    return out


def refresh_prebuilt_lists(apply=True):
    """Recompute the overlay from live Massive data. Returns a summary dict.

    apply=True re-seeds the prebuilt watchlists immediately so the change is live without
    waiting for the next boot."""
    key = _key()
    if not key:
        _log.warning("[prebuilt-refresh] MASSIVE_API_KEY not set — skipped")
        return {"ok": False, "reason": "no_key"}

    days = _grouped_recent_days(key, _ALIVE_LOOKBACK_DAYS)
    if not days:
        _log.warning("[prebuilt-refresh] no grouped-daily data — overlay left unchanged")
        return {"ok": False, "reason": "no_grouped_data"}

    # 'alive' = anything that traded on ANY of the recent sessions (robust to thin/holiday days).
    alive = set()
    for _d, dvol in days:
        alive.update(dvol.keys())

    # Liquidity ranking off the MOST RECENT day; leveraged/single-stock names excluded.
    latest_dvol = days[0][1]
    etf_rows = _paginate(f"{BASE}/v3/reference/tickers?type=ETF&active=true&market=stocks&limit=1000&apiKey={key}", key)
    etf_names = {(r.get("ticker") or "").upper(): (r.get("name") or "") for r in etf_rows}
    ranked = sorted(((t, dv) for t, dv in latest_dvol.items() if t in etf_names),
                    key=lambda x: x[1], reverse=True)
    liquid = []
    for t, _dv in ranked:
        nm = etf_names.get(t, "").upper()
        if not any(k in nm for k in _LEV_EXCLUDE):
            liquid.append(t)
        if len(liquid) >= TOP_N:
            break

    # Guard: never overwrite the overlay from a degenerate API response.
    if len(liquid) < _MIN_LIQUID or len(alive) < _MIN_ALIVE:
        _log.warning("[prebuilt-refresh] response too thin (liquid=%d alive=%d) — overlay left unchanged",
                     len(liquid), len(alive))
        return {"ok": False, "reason": "thin_response", "liquid": len(liquid), "alive": len(alive)}

    # Delisted = curated tickers (across every committed list) that no longer trade. The liquid
    # ranking is derived from grouped-daily, so it's alive by construction and never pruned.
    committed = set()
    for l in wp._load_committed():
        committed.update(t.upper() for t in l["tickers"])
    delisted = sorted(committed - alive)

    # UCT Index Components — re-fetch constituents from FMP so a name added to / dropped from
    # an index flows through automatically. $vol-sorted (most liquid first). A list FMP can't
    # return this run KEEPS its prior overlay value (fetch_index_lists omits thin/failed sets),
    # so a bad FMP response never wipes a section.
    from api.services import index_constituents as ic
    prior_idx = wp._read_overlay().get("index_constituents") or {}
    new_idx = {}
    try:
        for name, ticks in ic.fetch_index_lists().items():
            ticks = sorted(ticks, key=lambda t: latest_dvol.get(t.upper(), 0), reverse=True)
            new_idx[name.strip().lower()] = ticks
    except Exception as e:
        _log.warning("[prebuilt-refresh] index-constituent fetch failed: %s", e)
    index_constituents = {**prior_idx, **new_idx}

    overlay = {
        "liquid_ranking": liquid,
        "delisted": delisted,
        "index_constituents": index_constituents,
        "updated_at": time.time(),
        "checked_days": [d for d, _ in days],
    }
    try:
        os.makedirs(os.path.dirname(wp._OVERLAY_PATH), exist_ok=True)
        tmp = wp._OVERLAY_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(overlay, fh, separators=(",", ":"))
        os.replace(tmp, wp._OVERLAY_PATH)
    except Exception as e:
        _log.warning("[prebuilt-refresh] overlay write failed: %s", e)
        return {"ok": False, "reason": "write_failed"}

    _log.info("[prebuilt-refresh] liquid=%d delisted=%d (%s) index=%s days=%s",
              len(liquid), len(delisted), ",".join(delisted) or "none",
              {k: len(v) for k, v in index_constituents.items()} or "none",
              ",".join(overlay["checked_days"]))

    if apply:
        try:
            wp.seed_prebuilt_watchlists()
        except Exception as e:
            _log.warning("[prebuilt-refresh] re-seed after refresh failed: %s", e)

    return {"ok": True, "liquid": len(liquid), "delisted": delisted, "checked_days": overlay["checked_days"]}


def run_scheduled_refresh():
    """Scheduler entry point — never raises into APScheduler."""
    try:
        refresh_prebuilt_lists(apply=True)
    except Exception as e:
        _log.warning("[prebuilt-refresh] scheduled run failed: %s", e)


def maybe_startup_catchup(max_age_days=30):
    """Run once shortly after boot if the overlay is missing or older than max_age_days, so
    auto-management goes live soon after this deploy instead of waiting for the monthly cron."""
    age = overlay_age_days()
    if age is None or age >= max_age_days:
        _log.info("[prebuilt-refresh] startup catch-up (overlay age=%s) — refreshing", age)
        run_scheduled_refresh()
