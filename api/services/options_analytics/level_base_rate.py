"""BRK-08: the dealer-level BASE RATE. How often did price respect each named level?

The positioning vocabulary (`positioning_vocab.py`) names levels; a name alone does not say
whether the level has ever meant anything for this stock. This module answers that from OUR
stored history only:

THE BATCHED STEP (never on web, never per request)
  `build_session(contracts_gz, session, out_path)` reads ONE day's options-log contracts file
  (`options_universe_log.py`, ~2M rows) once and writes a small per-underlying levels file:
  Call Wall, Put Wall and Zero Gamma as `api/gex_service.py` computes them (the same formula,
  `contract_gex`; the same wall band; the same cumulative-flip rule), over the 30-day window the
  positioning panel reads (`dte=month`), with the session's logged underlying price. Stored in R2
  at `options_log/levels/<YYYY>/<date>.csv.gz`. The terminal-next-monitor job `options-levels`
  (after `options-screen`) builds every logged session that has no levels file yet (`catch_up`).

THE REQUEST PATH (web)
  `base_rate(sym)` reads the symbol's row from each mirrored levels file (sorted, early stop,
  LRU-cached) and, for every session with a level, looks at the closes of the next
  `HORIZON_SESSIONS` logged sessions:
    * Call Wall (above spot): TESTED when a close comes within `TEST_BAND_PCT` of it or above;
      BROKE when a close is above it; HELD when tested and never broke.
    * Put Wall (below spot): the mirror image.
    * Zero Gamma: TESTED when a close comes within the band or crosses; BROKE when a close is on
      the other side from where the session closed; HELD otherwise.
  A level already on the wrong side of the close (a call wall below spot) is counted as not
  applicable, never as a hold or a break.

⛔ NO RATE BELOW `MIN_TESTED` TESTED INSTANCES. Below it the answer is a sentence with the
  sample size, never a number. The options log began 2026-09-30.
⛔ A SESSION THE LOG DID NOT RECORD IS A GAP. An instance needs all `HORIZON_SESSIONS` following
  trading sessions logged with a price for the symbol; otherwise it is counted as incomplete.
⛔ ZERO GAMMA ONLY WHEN IT IS A REAL FLIP. gex_service falls back to stand-in levels when
  cumulative gamma never changes sign; the recorder keeps only the two flip methods, so a
  stand-in is never scored as if it were a flip.
⛔ CLOSES, NOT INTRADAY. Prices are the log's 16:30 ET underlying price; an intraday poke through
  a level that closed back inside is not a break here, and the method says so.
⛔ DARK behind OPTIONS_LEVEL_BASE_RATE_ENABLED (web route and the monitor job).
"""
from __future__ import annotations

import csv
import datetime as _dt
import gzip
import os
import re
import shutil
import tempfile
import threading
import time
from collections import OrderedDict
from typing import Callable, Optional

FLAG = "OPTIONS_LEVEL_BASE_RATE_ENABLED"
PREFIX = "options_log/levels"
FIELDS = ("underlying", "spot", "call_wall", "put_wall", "zero_gamma", "zero_gamma_method")
WINDOW_DAYS = 30            # the positioning panel's `dte=month`
HORIZON_SESSIONS = 5
TEST_BAND_PCT = 1.0
MIN_TESTED = 20
LOOKBACK_SESSIONS = 252
KINDS = ("call_wall", "put_wall", "zero_gamma")
FLIP_METHODS = ("cumulative_flip", "cumulative_flip_from_top")
RESULT_TTL_S = 600.0

METHOD = (f"From our options log: each session's Call Wall, Put Wall and Zero Gamma are rebuilt "
          f"from the logged chain with the GEX page's own rules (expirations within {WINDOW_DAYS} "
          f"days, walls within the 15% band, Zero Gamma only where cumulative gamma really "
          f"flips). Then the next {HORIZON_SESSIONS} logged closes are read. A level is TESTED "
          f"when a close comes within {TEST_BAND_PCT:g}% of it or goes past it; it BROKE when a "
          f"close went past it; it HELD when it was tested and no close went past it. Closes "
          f"only (16:30 ET): an intraday break that closed back inside counts as held.")


def is_enabled() -> bool:
    from api.services.options_analytics import flags
    return flags.is_on(FLAG)


def key_for(session: str) -> str:
    return f"{PREFIX}/{session[:4]}/{session}.csv.gz"


# ── the batched step ────────────────────────────────────────────────────────────

def _f(v) -> Optional[float]:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def levels_of(strikes: dict, spot: float, *, band_pct: float = 15.0) -> dict:
    """Call Wall / Put Wall / Zero Gamma from {strike: [call_gamma_oi, put_gamma_oi]} (sum of
    gamma x open interest per side) at `spot`, by gex_service.get_gex_data's rules (naive
    convention: calls positive, puts negative; walls inside the band; cumulative flip, bottom-up
    then top-down). Zero Gamma is None when cumulative gamma never flips."""
    from api.gex_service import contract_gex
    rows = []
    for k in sorted(strikes):
        if spot > 0 and abs(k - spot) / spot * 100.0 > band_pct:
            continue
        c, p = strikes[k]
        cg = contract_gex(c, 1.0, spot) if c else 0.0
        pg = -contract_gex(p, 1.0, spot) if p else 0.0
        if cg == 0 and pg == 0:
            continue
        rows.append((k, cg, pg))
    out = {"call_wall": None, "put_wall": None, "zero_gamma": None, "zero_gamma_method": None}
    if not rows:
        return out
    out["call_wall"] = max(rows, key=lambda r: r[1])[0] if any(r[1] > 0 for r in rows) else None
    out["put_wall"] = min(rows, key=lambda r: r[2])[0] if any(r[2] < 0 for r in rows) else None
    cum, prev_k, prev_c = 0.0, None, 0.0
    for k, cg, pg in rows:
        cum += cg + pg
        if prev_k is not None and prev_c < 0 <= cum:
            t = -prev_c / (cum - prev_c) if cum != prev_c else 0.0
            out["zero_gamma"], out["zero_gamma_method"] = round(prev_k + t * (k - prev_k), 4), FLIP_METHODS[0]
            return out
        prev_k, prev_c = k, cum
    cum, prev_k, prev_c = 0.0, None, 0.0
    for k, cg, pg in reversed(rows):
        cum += cg + pg
        if prev_k is not None and prev_c > 0 >= cum:
            t = prev_c / (prev_c - cum) if cum != prev_c else 0.0
            out["zero_gamma"], out["zero_gamma_method"] = round(prev_k - t * (prev_k - k), 4), FLIP_METHODS[1]
            return out
        prev_k, prev_c = k, cum
    return out


def build_session(contracts_gz_path: str, session: _dt.date, out_path: str) -> dict:
    """Read ONE day's contracts file once; write the per-underlying levels file. Receipt back."""
    try:
        from api.gex_service import MASSIVE_STRIKE_BAND_PCT as band
    except Exception:  # noqa: BLE001 -- the stated band if the module cannot load here
        band = 15.0
    last = session + _dt.timedelta(days=WINDOW_DAYS)
    acc: dict = {}
    spots: dict = {}
    rows_in = used = 0
    with gzip.open(contracts_gz_path, "rt", newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows_in += 1
            und = r.get("underlying")
            if not und:
                continue
            px = _f(r.get("underlying_price"))
            if px:
                spots[und] = px
            try:
                exp = _dt.date.fromisoformat((r.get("expiration") or "")[:10])
            except ValueError:
                continue
            if not session <= exp <= last:
                continue
            k, oi, g = _f(r.get("strike")), _f(r.get("open_interest")), _f(r.get("gamma"))
            if k is None or not oi or oi <= 0 or not g:
                continue
            side = 0 if r.get("type") == "call" else 1 if r.get("type") == "put" else None
            if side is None:
                continue
            cell = acc.setdefault(und, {}).setdefault(k, [0.0, 0.0])
            cell[side] += g * oi
            used += 1
    n = with_level = 0
    with gzip.open(out_path, "wt", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(FIELDS)
        for und in sorted(spots):
            spot = spots[und]
            lv = levels_of(acc.get(und) or {}, spot, band_pct=band)
            with_level += any(lv[k] is not None for k in KINDS)
            w.writerow([und, spot] + [("" if lv[k] is None else lv[k]) for k in FIELDS[2:]])
            n += 1
    return {"session": session.isoformat(), "rows_in": rows_in, "contracts_used": used,
            "underlyings": n, "with_level": with_level, "path": out_path}


def catch_up(*, list_keys: Callable[[], list], download: Callable[[str, str], None],
             upload: Callable[[str, str, str], None], workdir: Optional[str] = None,
             limit: int = 5) -> dict:
    """Build the levels file for every logged session that lacks one (newest first, at most
    `limit` per run). One bad day is named, never fatal."""
    keys = set(list_keys())
    logged = sorted({m.group(1) for k in keys
                     for m in [re.search(r"options_log/\d{4}/(\d{4}-\d{2}-\d{2})\.contracts\.csv\.gz$", k)]
                     if m}, reverse=True)
    missing = [d for d in logged if key_for(d) not in keys]
    built, failed = [], []
    for d in missing[:limit]:
        tmp = tempfile.mkdtemp(prefix="options_levels_", dir=workdir)
        try:
            src = os.path.join(tmp, "contracts.csv.gz")
            download(f"options_log/{d[:4]}/{d}.contracts.csv.gz", src)
            rec = build_session(src, _dt.date.fromisoformat(d), os.path.join(tmp, "levels.csv.gz"))
            upload(rec["path"], key_for(d), "application/gzip")
            built.append({k: rec[k] for k in ("session", "underlyings", "with_level", "contracts_used")})
        except Exception as e:  # noqa: BLE001 -- named in the receipt
            failed.append({"session": d, "error": f"{type(e).__name__}: {e}"})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return {"logged": len(logged), "built": built, "failed": failed,
            "pending": max(0, len(missing) - min(limit, len(missing)))}


def run_catch_up() -> dict:
    """Production wiring for the monitor: R2 list / download / upload."""
    from api import flow_backup
    client, bucket = flow_backup._r2_client(), flow_backup._bucket()
    if client is None or not bucket:
        raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")

    def list_keys():
        out = []
        for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="options_log/"):
            out.extend(o["Key"] for o in page.get("Contents") or [])
        return out

    return catch_up(list_keys=list_keys,
                    download=lambda key, path: client.download_file(bucket, key, path),
                    upload=lambda path, key, ct: client.upload_file(path, bucket, key,
                                                                    ExtraArgs={"ContentType": ct}))


def receipt_text(rec: dict) -> tuple:
    built = ", ".join(f"{b['session']} ({b['with_level']}/{b['underlyings']} with a level)"
                      for b in rec.get("built") or []) or "none"
    body = (f"Logged sessions: {rec.get('logged', 0)}. Built: {built}. "
            f"Still pending: {rec.get('pending', 0)}.")
    if rec.get("failed"):
        body += " Failed: " + "; ".join(f"{f['session']}: {f['error']}" for f in rec["failed"])
    return ("Options levels: " + ("FAILED" if rec.get("failed") else "built"), body, bool(rec.get("failed")))


# ── the store web reads ─────────────────────────────────────────────────────────

class LocalStore:
    """`<root>/options_log/levels/<YYYY>/<date>.csv.gz`. Tests seed one; R2 mirrors into one."""

    def __init__(self, root: str):
        self.root = root

    def sessions(self) -> list:
        base = os.path.join(self.root, *PREFIX.split("/"))
        out = []
        if not os.path.isdir(base):
            return out
        for year in os.listdir(base):
            ydir = os.path.join(base, year)
            if not os.path.isdir(ydir):
                continue
            for name in os.listdir(ydir):
                m = re.match(r"^(\d{4}-\d{2}-\d{2})\.csv\.gz$", name)
                if m:
                    out.append(m.group(1))
        return sorted(out)

    def path(self, session: str) -> Optional[str]:
        p = os.path.join(self.root, *key_for(session).split("/"))
        return p if os.path.exists(p) else None


class R2Store(LocalStore):
    """The levels files in R2, mirrored on demand (listing cached LIST_TTL_S; a file re-fetched
    only when its ETag changes)."""

    LIST_TTL_S = 600

    def __init__(self, cache_dir: Optional[str] = None):
        super().__init__(cache_dir or os.path.join(tempfile.gettempdir(), "uct_options_levels"))
        self._lock = threading.Lock()
        self._listed_at = 0.0
        self._etags: dict = {}

    def _sync(self) -> None:
        with self._lock:
            if self._listed_at and time.monotonic() - self._listed_at < self.LIST_TTL_S:
                return
            from api import flow_backup
            client, bucket = flow_backup._r2_client(), flow_backup._bucket()
            if client is None or not bucket:
                raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
            seen = {}
            for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX + "/"):
                for o in page.get("Contents") or []:
                    if re.search(r"/\d{4}-\d{2}-\d{2}\.csv\.gz$", o["Key"]):
                        seen[o["Key"]] = o.get("ETag", "")
            for key, etag in seen.items():
                local = os.path.join(self.root, *key.split("/"))
                if self._etags.get(key) == etag and os.path.exists(local):
                    continue
                os.makedirs(os.path.dirname(local), exist_ok=True)
                client.download_file(bucket, key, local + ".part")
                os.replace(local + ".part", local)
                self._etags[key] = etag
            self._listed_at = time.monotonic()

    def sessions(self) -> list:
        self._sync()
        return super().sessions()


_store_override: Optional[LocalStore] = None
_default_store: Optional[R2Store] = None


def get_store() -> LocalStore:
    global _default_store
    if _store_override is not None:
        return _store_override
    if _default_store is None:
        _default_store = R2Store()
    return _default_store


_ROWS: "OrderedDict" = OrderedDict()
_ROWS_MAX = 8192
_ROWS_LOCK = threading.Lock()
_RESULTS: dict = {}
_RESULTS_LOCK = threading.Lock()


def clear_cache() -> None:
    with _ROWS_LOCK:
        _ROWS.clear()
    with _RESULTS_LOCK:
        _RESULTS.clear()


def _row(store: LocalStore, session: str, sym: str) -> Optional[dict]:
    """The symbol's row in one session's levels file (sorted: the scan stops once past it)."""
    path = store.path(session)
    if path is None:
        return None
    try:
        ck = (path, os.path.getmtime(path), sym)
    except OSError:
        return None
    with _ROWS_LOCK:
        if ck in _ROWS:
            _ROWS.move_to_end(ck)
            return _ROWS[ck]
    found = None
    with gzip.open(path, "rt", newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            u = r.get("underlying") or ""
            if u == sym:
                found = {"spot": _f(r.get("spot")), **{k: _f(r.get(k)) for k in KINDS},
                         "zero_gamma_method": r.get("zero_gamma_method") or None}
                break
            if u > sym:
                break
    with _ROWS_LOCK:
        _ROWS[ck] = found
        while len(_ROWS) > _ROWS_MAX:
            _ROWS.popitem(last=False)
    return found


def _next_sessions(session: str, n: int) -> list:
    from api.services.research import iv_history as ivh
    d, out = _dt.date.fromisoformat(session), []
    try:
        for _ in range(n):
            d = ivh._next_trading_day(d)
            out.append(d.isoformat())
    except Exception:  # noqa: BLE001 -- past the calendar horizon: an incomplete instance
        return []
    return out


def score(kind: str, level: float, spot: float, closes: list) -> str:
    """'held' | 'broke' | 'untested' | 'not_applicable' for one level over the closes after it."""
    band = TEST_BAND_PCT / 100.0
    if kind == "call_wall":
        if level <= spot:
            return "not_applicable"
        if any(c > level for c in closes):
            return "broke"
        return "held" if max(closes) >= level * (1 - band) else "untested"
    if kind == "put_wall":
        if level >= spot:
            return "not_applicable"
        if any(c < level for c in closes):
            return "broke"
        return "held" if min(closes) <= level * (1 + band) else "untested"
    if level == spot:
        return "not_applicable"
    above = spot > level
    if any((c < level) if above else (c > level) for c in closes):
        return "broke"
    near = any(abs(c - level) <= level * band for c in closes)
    return "held" if near else "untested"


def _min_sessions_note(tested: int) -> str:
    need = MIN_TESTED - tested
    return (f"{tested} tested instance{'s' if tested != 1 else ''} so far; a rate needs "
            f"{MIN_TESTED}, so {need} more before one is shown.")


def base_rate_from(sym: str, store: LocalStore) -> dict:
    from api.services.options_analytics import positioning_vocab as pv
    have = store.sessions()[-LOOKBACK_SESSIONS:]
    have_set = set(have)
    rows = {d: _row(store, d, sym) for d in have}
    counts = {k: {"held": 0, "broke": 0, "untested": 0, "not_applicable": 0, "incomplete": 0}
              for k in KINDS}
    recent: dict = {k: [] for k in KINDS}
    for d in have:
        r = rows.get(d)
        if not r or not r.get("spot"):
            continue
        nxt = _next_sessions(d, HORIZON_SESSIONS)
        closes = [rows[x]["spot"] for x in nxt if x in have_set and rows.get(x) and rows[x].get("spot")]
        complete = len(nxt) == HORIZON_SESSIONS and len(closes) == HORIZON_SESSIONS
        for k in KINDS:
            lv = r.get(k)
            if lv is None:
                continue
            if not complete:
                counts[k]["incomplete"] += 1
                continue
            s = score(k, lv, r["spot"], closes)
            counts[k][s] += 1
            if s in ("held", "broke"):
                recent[k].append({"session": d, "level": lv, "spot": r["spot"], "outcome": s})
    out_rows = []
    for k in KINDS:
        c = counts[k]
        tested = c["held"] + c["broke"]
        rate = round(c["held"] / tested * 100, 1) if tested >= MIN_TESTED else None
        out_rows.append({"id": k, "label": pv.label_of(k), **c, "tested": tested,
                         "held_pct": rate, "note": None if rate is not None else _min_sessions_note(tested),
                         "recent": recent[k][-5:]})
    first = have[0] if have else None
    return {"symbol": sym, "label": "computed", "method": METHOD,
            "source": "UCT options log (Massive /v3/snapshot?type=options, recorded daily at 16:30 ET)",
            "horizon_sessions": HORIZON_SESSIONS, "test_band_pct": TEST_BAND_PCT, "min_tested": MIN_TESTED,
            "sessions_with_levels": len(have), "first_session": first,
            "last_session": have[-1] if have else None,
            "sessions_for_symbol": sum(1 for d in have if rows.get(d) and rows[d].get("spot")),
            "levels": out_rows,
            "note": (None if have else "No session's levels have been recorded yet. The recorder "
                     "rebuilds them from the options log, which began 2026-09-30."),
            "computed_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")}


def base_rate(sym: str, *, store: Optional[LocalStore] = None) -> dict:
    """Cached per (symbol, newest levels session): one computation per new session."""
    store = store or get_store()
    have = store.sessions()
    key = (sym, have[-1] if have else None, len(have))
    with _RESULTS_LOCK:
        hit = _RESULTS.get(key)
        if hit and time.monotonic() - hit[0] < RESULT_TTL_S:
            return hit[1]
    out = base_rate_from(sym, store)
    with _RESULTS_LOCK:
        if len(_RESULTS) > 2048:
            _RESULTS.clear()
        _RESULTS[key] = (time.monotonic(), out)
    return out
