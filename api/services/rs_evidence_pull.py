"""The web pod's pull of the RS evidence artifact, and the card's read of it
(UCT Relative Strength, Phase 2b, unit 2b-03).

Engineering map docs/superpowers/plans/2026-11-06-uct-rs-phase2-engineering-map.md
section 2.1 ("Web pulls with `get_bytes`, refuses short payloads, writes
atomically (the `opt_flow.run_pull` contract)") and section 3 row 2b-03.

THE BRIDGE. The worker measures (`api.services.rs_evidence`, unit 2b-01) and
publishes ``rs/evidence.json`` to R2 through `data_sync.put_bytes` after its
21:30 ET run. This module is the other end: `pull_once` reads that key through
`data_sync.get_bytes` and lands it at ``<DATA_DIR>/rs_evidence.json`` on the
web pod; `load_local` is what the chart provider reads; `evidence_for` and
`summary_line` turn one signal's numbers into the card's figures and sentence.

THE REFUSAL RULES (`opt_flow.run_pull`'s contract, and the map's "web pull
preserves the prior artifact on a short payload"). Nothing is written, and the
previous local file is kept byte-for-byte, when the R2 object is missing (R2
unconfigured or the key absent; `get_bytes` returns None and never raises),
when `get_bytes` itself raises (defended here anyway), when the payload is
under :data:`MIN_BYTES`, when it is not JSON, or when it is not the 2b-01
shape (``version == 1``, a ``per_signal`` dict, an ``asof`` string). The byte
floor is the counterpart of 2b-01's ROW floor: the smallest artifact the
builder produces -- five signals, three horizons, the method block, ZERO rows --
is just over 4 KB (`tests/test_rs_evidence_pull.py` measures it), so 2 KB is
below every legitimate artifact and above any truncated upload, error page or
empty object. The data directory is never created here: on the web pod it is
the mounted volume, and a box without it has nothing to serve.

THE WRITE IS ATOMIC: the bytes go to a temp file beside the target and
``os.replace`` swaps it in, so a reader (`load_local`, in the request path)
sees the old artifact or the new one and never a half-written file.

NO FEATURE FLAG, by design. An absent artifact is a no-op pull and the cards
fall back to :data:`HONESTY_SENTENCE`; the only switch that matters is the
worker's `RS_EVIDENCE_ENABLED` (unit 2b-02), which decides whether anything is
published at all. The one environment variable read here is ``DATA_DIR``.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from datetime import datetime, timezone
from typing import Callable, Optional

from api.services.rs_evidence import ARTIFACT_KEY, ARTIFACT_VERSION, DISPLAY_FLOOR_N, SURVIVORSHIP_NOTE

log = logging.getLogger(__name__)

#: The local file name under ``DATA_DIR`` (the R2 key is `ARTIFACT_KEY`).
LOCAL_NAME = "rs_evidence.json"
#: A payload under this many bytes is refused (module header).
MIN_BYTES = 2048
#: The horizon the cards print (plan section 9: the quarter-ahead read).
DEFAULT_HORIZON = 63

#: Readout card key (`RS_LINE_RAW.readout[].key` in nativeRegistry.js) ->
#: the artifact signal it measures. `signature._rs_evidence` builds
#: ``payload.evidence.signals`` and ``payload.evidence.sentence`` on these keys,
#: so unit 2b-09 points a card at ``scalar:evidence.sentence.<key>``. The
#: rating, checks and sensitivity cards have no signal in the v1 artifact.
CARD_SIGNALS: dict = {
    "rsHigh": "rs_new_high",
    "beforePrice": "rs_new_high_before_price",
    "redDay": "rs_new_high_red_day",
    "phase": "rs_cross_up_21ema",
    "mansfield": "mansfield_cross_up",
}

#: The plural noun phrase each signal takes in the sentence.
SIGNAL_LABELS: dict = {
    "rs_new_high": "RS new highs",
    "rs_new_high_before_price": "RS new highs before price",
    "rs_new_high_red_day": "RS new highs on a red day",
    # "21-day", not "21-bar" (review #7, 2026-11-07): the artifact is measured on
    # daily bars, and the same sentence prints on a weekly chart, where a bar is a week.
    "rs_cross_up_21ema": "RS line crosses above its 21-day average",
    "mansfield_cross_up": "Mansfield crosses above zero",
}

#: The calendar span each measured horizon covers, in the sentence's own words.
#: A horizon not listed prints its session count alone.
HORIZON_WORDS: dict = {21: "about 1 month", 63: "about 3 months", 126: "about 6 months"}

#: The card's honesty sentence, printed whenever a signal has no displayable
#: number. It is the per-signal form of `rs_discord_post.HONESTY_LINE` (that
#: one is the Discord post's: plural, prefixed "Evidence:", with a second
#: sentence about the nightly backtest); the shared clause is pinned by
#: `tests/test_rs_evidence_pull.py` so a rewording of one flags the other.
HONESTY_SENTENCE = "No published hit rate exists for this signal and UCT has not measured one yet."

_CACHE_LOCK = threading.Lock()
_CACHE: dict = {"path": None, "mtime_ns": None, "artifact": None}
_LAST_RECEIPT: Optional[dict] = None


# ── paths ─────────────────────────────────────────────────────────────────────

def _default_data_dir() -> str:
    """``DATA_DIR`` or the pod's mount. One seam, so tests point it elsewhere."""
    return os.environ.get("DATA_DIR", "/data")


def local_path(data_dir: Optional[str] = None) -> str:
    return os.path.join(data_dir or _default_data_dir(), LOCAL_NAME)


# ── the pull ──────────────────────────────────────────────────────────────────

def validate_artifact(payload) -> Optional[str]:
    """Why ``payload`` is not a 2b-01 artifact, or None when it is."""
    if not isinstance(payload, dict):
        return "not_an_object"
    if payload.get("version") != ARTIFACT_VERSION:
        return "bad_version"
    if not isinstance(payload.get("per_signal"), dict):
        return "no_per_signal"
    asof = payload.get("asof")
    if not isinstance(asof, str) or not asof.strip():
        return "no_asof"
    return None


def _default_get_bytes(key: str) -> Optional[bytes]:
    from api.services import data_sync
    return data_sync.get_bytes(key)


def _atomic_write_bytes(path: str, data: bytes) -> None:
    parent = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".rs_evidence_", suffix=".tmp", dir=parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def pull_once(*, get_bytes: Optional[Callable[[str], Optional[bytes]]] = None,
              data_dir: Optional[str] = None, now: Optional[datetime] = None) -> dict:
    """Read `ARTIFACT_KEY` through ``get_bytes`` (default `data_sync.get_bytes`)
    and land it at `local_path`. Never raises.

    Receipt: ``{pulled, reason, bytes, asof, path, key, pulled_at}`` with
    ``reason`` None on success or one of ``no_data_dir``, ``no_r2_object``,
    ``get_bytes_raised``, ``short_payload``, ``bad_json``, ``not_an_object``,
    ``bad_version``, ``no_per_signal``, ``no_asof``, ``write_failed``. On every
    refusal the previous local file is untouched.
    """
    global _LAST_RECEIPT
    path = local_path(data_dir)
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    receipt = {"pulled": False, "reason": None, "bytes": 0, "asof": None,
               "path": path, "key": ARTIFACT_KEY, "pulled_at": stamp}

    def _refuse(reason: str, **extra) -> dict:
        global _LAST_RECEIPT                             # the nested scope needs its own declaration
        receipt.update(reason=reason, **extra)
        log.warning("[rs_evidence_pull] refusing (%s): prior artifact preserved at %s", reason, path)
        _LAST_RECEIPT = dict(receipt)
        return receipt

    if not os.path.isdir(os.path.dirname(path) or "."):
        return _refuse("no_data_dir")
    try:
        raw = (get_bytes or _default_get_bytes)(ARTIFACT_KEY)
    except Exception as e:                               # noqa: BLE001 - the contract is "never raises"
        log.warning("[rs_evidence_pull] get_bytes raised: %s", e)
        return _refuse("get_bytes_raised")
    if raw is None:
        return _refuse("no_r2_object")
    if not isinstance(raw, (bytes, bytearray)):
        raw = str(raw).encode("utf-8")
    raw = bytes(raw)
    receipt["bytes"] = len(raw)
    if len(raw) < MIN_BYTES:
        return _refuse("short_payload")
    try:
        payload = json.loads(raw)
    except ValueError:
        return _refuse("bad_json")
    why = validate_artifact(payload)
    if why is not None:
        return _refuse(why, asof=payload.get("asof") if isinstance(payload, dict) else None)
    receipt["asof"] = payload["asof"]
    try:
        _atomic_write_bytes(path, raw)
    except Exception as e:                               # noqa: BLE001
        log.warning("[rs_evidence_pull] write failed: %s", e)
        return _refuse("write_failed")
    receipt["pulled"] = True
    log.info("[rs_evidence_pull] pulled %s: bytes=%d asof=%s -> %s", ARTIFACT_KEY, len(raw), payload["asof"], path)
    _LAST_RECEIPT = dict(receipt)
    return receipt


def last_receipt() -> Optional[dict]:
    """The receipt of the last `pull_once` in this process, for a status readback."""
    return dict(_LAST_RECEIPT) if _LAST_RECEIPT else None


# ── the local read ────────────────────────────────────────────────────────────

def load_local(data_dir: Optional[str] = None) -> Optional[dict]:
    """The parsed local artifact, or None when it is absent, unreadable or not
    the 2b-01 shape. Cached in-process on the file's mtime, so the request path
    pays one ``os.stat`` per call and a parse only when the pull replaced the
    file. The returned dict is shared: read it, never mutate it."""
    path = local_path(data_dir)
    try:
        mtime_ns = os.stat(path).st_mtime_ns
    except OSError:
        return None
    with _CACHE_LOCK:
        if _CACHE["path"] == path and _CACHE["mtime_ns"] == mtime_ns:
            return _CACHE["artifact"]
    try:
        with open(path, "rb") as fh:
            payload = json.loads(fh.read())
    except (OSError, ValueError):
        return None
    if validate_artifact(payload) is not None:
        return None
    with _CACHE_LOCK:
        _CACHE.update(path=path, mtime_ns=mtime_ns, artifact=payload)
    return payload


# ── the card's read ───────────────────────────────────────────────────────────

def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def _int(v) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def evidence_for(signal: str, horizon: int = DEFAULT_HORIZON, artifact: Optional[dict] = None) -> Optional[dict]:
    """One signal's numbers at one horizon, or None when there is no artifact or
    the artifact carries no block for the signal.

    ``{signal, label, n, sessions, effective_n, incomplete, hit_rate_pct,
    median_excess_pct, baseline_hit_rate_pct, horizon_bars, start, end,
    benchmark, asof, survivorship, survivorship_corrected, display_floor_n,
    displayable}``.

    THE FLOOR IS ON EFFECTIVE N, NOT RAW n (review #6, 2026-11-07). Events that
    share a session share one market: 5,000 red-day highs on 40 red sessions
    are 40 observations, not 5,000 (research base 03-evidence.md, the
    effective-N rule; measure.py's own header). ``sessions`` is the artifact's
    per-signal ``dates`` (distinct sessions with an event) and ``effective_n``
    is ``min(n, sessions)``; ``displayable`` is ``effective_n >=
    method.display_floor_n`` (the floor the artifact carries, `DISPLAY_FLOOR_N`
    when it does not) AND a hit rate exists AND the window has both dates. An
    artifact without ``dates`` has no effective N and is not displayable. The
    same rule governs the Discord evidence line, which filters on
    ``displayable`` (main.py `_rs_evidence_for`).

    ``baseline_hit_rate_pct`` is the all-bars hit rate at the same horizon, so
    the sentence reads as lift and not as a number on its own. A null statistic
    stays null, nothing is invented. Percent fields are percent (the artifact's
    ``hit_rate`` is a fraction, its ``median_excess`` already percent).
    """
    art = artifact if artifact is not None else load_local()
    if not isinstance(art, dict):
        return None
    block = (art.get("per_signal") or {}).get(signal)
    if not isinstance(block, dict):
        return None
    h = (block.get("horizons") or {}).get(str(int(horizon)))
    h = h if isinstance(h, dict) else {}
    n = _int(h.get("n"))
    sessions = _int(block.get("dates"))
    effective = min(n, sessions) if (n is not None and sessions is not None) else None
    hit = _num(h.get("hit_rate"))
    med = _num(h.get("median_excess"))
    method = art.get("method") if isinstance(art.get("method"), dict) else {}
    floor = _int(method.get("display_floor_n"))
    if floor is None:
        floor = DISPLAY_FLOOR_N
    window = art.get("window") if isinstance(art.get("window"), dict) else {}
    start, end = window.get("from"), window.get("to")
    displayable = (effective is not None and effective >= floor and hit is not None
                   and isinstance(start, str) and isinstance(end, str))
    base = baseline_for(horizon, art)
    return {
        "signal": signal,
        "label": SIGNAL_LABELS.get(signal, signal),
        "n": n,
        "sessions": sessions,
        "effective_n": effective,
        "incomplete": _int(h.get("incomplete")),
        "hit_rate_pct": round(hit * 100.0, 2) if hit is not None else None,
        "median_excess_pct": round(med, 2) if med is not None else None,
        "baseline_hit_rate_pct": base.get("hit_rate_pct") if base else None,
        "horizon_bars": int(horizon),
        "start": start,
        "end": end,
        "benchmark": art.get("benchmark"),
        "asof": art.get("asof"),
        "survivorship": art.get("survivorship") or SURVIVORSHIP_NOTE,
        "survivorship_corrected": False,
        "display_floor_n": floor,
        "displayable": bool(displayable),
    }


def baseline_for(horizon: int = DEFAULT_HORIZON, artifact: Optional[dict] = None) -> Optional[dict]:
    """The all-bars baseline at one horizon (``{n, hit_rate_pct, median_excess_pct,
    horizon_bars}``), the number a signal's hit rate is read against; None
    when the artifact has none."""
    art = artifact if artifact is not None else load_local()
    if not isinstance(art, dict):
        return None
    b = (art.get("baseline") or {}).get(str(int(horizon)))
    if not isinstance(b, dict):
        return None
    hit, med = _num(b.get("hit_rate")), _num(b.get("median_excess"))
    return {"n": _int(b.get("n")),
            "hit_rate_pct": round(hit * 100.0, 2) if hit is not None else None,
            "median_excess_pct": round(med, 2) if med is not None else None,
            "horizon_bars": int(horizon)}


def _sentence_case(note: str) -> str:
    note = str(note or "").strip().rstrip(".")
    return (note[:1].upper() + note[1:] + ".") if note else ""


def _below_floor_sentence(ev: dict) -> Optional[str]:
    """What UCT measured when it is too little to print (review #22,
    2026-11-07): the honesty line says "has not measured one yet", which is
    false once the artifact carries the signal. None when the floor is not the
    reason the number is withheld (the caller then prints the honesty line)."""
    n, sessions, floor = ev.get("n"), ev.get("sessions"), ev.get("display_floor_n")
    if not isinstance(floor, int) or not isinstance(n, int) or not isinstance(sessions, int):
        return None
    h = ev.get("horizon_bars")
    if n == 0:
        pending = ev.get("incomplete")
        if isinstance(pending, int) and pending > 0 and isinstance(h, int):
            return (f"UCT has recorded {pending:,} events on {sessions:,} sessions, none with a complete "
                    f"{h}-session window yet, so no hit rate is printed.")
        return f"UCT measured 0 events, too few to print a hit rate (floor {floor})."
    if min(n, sessions) >= floor:
        return None
    return f"UCT measured {n:,} events on {sessions:,} sessions, too few to print a hit rate (floor {floor})."


def sentence_for(ev: Optional[dict]) -> str:
    """The evidence sentence for an `evidence_for` dict, in operator voice.

    Displayable: the count, the sessions it fell on, the window, then the hit
    rate against the all-bars baseline (review #6) at a horizon stated in
    SESSIONS, measured on daily bars (review #7: the same sentence prints on a
    weekly chart, where "63 bars" would read as 63 weeks). Under the floor: what
    was measured and why it is withheld (review #22). No artifact block for the
    signal (or a block the floor does not explain): `HONESTY_SENTENCE`."""
    if not isinstance(ev, dict):
        return HONESTY_SENTENCE
    if not ev.get("displayable"):
        return _below_floor_sentence(ev) or HONESTY_SENTENCE
    bench = ev.get("benchmark") or "the benchmark"
    h = int(ev["horizon_bars"])
    on = f" on {int(ev['sessions']):,} sessions" if isinstance(ev.get("sessions"), int) else ""
    text = (f"{int(ev['n']):,} {ev['label']}{on}, {ev['start']} to {ev['end']}, daily bars: "
            f"{float(ev['hit_rate_pct']):.1f}% closed higher than {bench} {h} sessions later")
    notes = [w for w in (HORIZON_WORDS.get(h),) if w]
    if ev.get("median_excess_pct") is not None:
        notes.append(f"median {float(ev['median_excess_pct']):+.1f}%")
    if notes:
        text += f" ({'; '.join(notes)})"
    if ev.get("baseline_hit_rate_pct") is not None:
        text += f", against {float(ev['baseline_hit_rate_pct']):.1f}% for all bars"
    text += "."
    tail = _sentence_case(ev.get("survivorship") or SURVIVORSHIP_NOTE)
    return f"{text} {tail}" if tail else text


def summary_line(signal: str, horizon: int = DEFAULT_HORIZON, artifact: Optional[dict] = None) -> str:
    """`sentence_for(evidence_for(signal, horizon, artifact))`."""
    return sentence_for(evidence_for(signal, horizon, artifact))
