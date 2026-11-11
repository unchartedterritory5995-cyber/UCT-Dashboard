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
shape (``version == ARTIFACT_VERSION``, a ``per_signal`` dict, an ``asof``
string; version 2 since 2026-11-07, when the forward return moved to the next
session's open and the split guard landed, so a version-1 artifact measured on
the signal close is refused rather than printed under the new wording). The byte
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
import math
import os
import tempfile
import threading
from datetime import datetime, timezone
from typing import Callable, Optional

from api.services.rs_evidence import ARTIFACT_KEY, ARTIFACT_VERSION, DISPLAY_FLOOR_N, SURVIVORSHIP_NOTE
from api.services.rs_evidence.measure import HORIZONS as _JOB_HORIZONS

log = logging.getLogger(__name__)

#: The local file name under ``DATA_DIR`` (the R2 key is `ARTIFACT_KEY`).
LOCAL_NAME = "rs_evidence.json"
#: A payload under this many bytes is refused (module header).
MIN_BYTES = 2048
#: The horizon the cards print (plan section 9: the quarter-ahead read).
#: Read from the job's own table (21/63/126 sessions), never retyped: the
#: single-authority rail allows one module to declare the RS lookback pair.
DEFAULT_HORIZON = _JOB_HORIZONS[1]

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

#: THE SPAN RULE (unit VA3, 2026-11-07): a measured number prints only when the
#: events with a complete window at the printed horizon fell on at least this many
#: DIFFERENT sessions, as well as clearing the artifact's display floor on n.
#: Events on one session share one market, so 5,000 red-day highs on 40 red
#: sessions are 40 observations, not 5,000 (research base 03-evidence.md §(c):
#: "report distinct event dates"; "suppress display when effective N < 100").
#: 100 is the research base's own number for effective N; it is what review #6's
#: rule (effective N = min(n, sessions) >= 100) already required, so stating it
#: here keeps that bar, where a smaller number (20) would have lowered it.
MIN_EVENT_DATES = 100

#: The uncertainty range printed beside a measured hit rate: a Wilson score
#: interval at this confidence. Its ``n`` is the EFFECTIVE n (``min(n,
#: sessions)``), not the raw event count: events that share a session are not
#: independent draws, so an interval over every event would read narrower than
#: the data can support. Counting each session once is the cautious side.
INTERVAL_CONFIDENCE_PCT = 95
#: The two-sided normal quantile for :data:`INTERVAL_CONFIDENCE_PCT` (95 %).
INTERVAL_Z = 1.959963984540054
#: The words the range takes in the sentence, for a reader who has never met a
#: confidence interval: ``"58.3% (likely between 51.9% and 64.4%)"``.
INTERVAL_WORDS = "likely between"


def wilson_interval(hit_rate: float, n: float, z: float = INTERVAL_Z):
    """The Wilson score interval ``(low, high)`` as fractions for a share
    ``hit_rate`` (0-1) observed over ``n`` trials; ``None`` without a positive
    ``n`` or a share in range. Wilson rather than the plain normal range because
    it stays inside 0-1 and behaves near 0 % and 100 %."""
    try:
        p, n = float(hit_rate), float(n)
    except (TypeError, ValueError):
        return None
    if not (n > 0 and 0.0 <= p <= 1.0):
        return None
    z2 = z * z
    den = 1.0 + z2 / n
    centre = (p + z2 / (2.0 * n)) / den
    half = z * math.sqrt(p * (1.0 - p) / n + z2 / (4.0 * n * n)) / den
    low = 0.0 if p == 0.0 else max(0.0, centre - half)     # the bounds are exact at the ends;
    high = 1.0 if p == 1.0 else min(1.0, centre + half)    # float error must not print 99.99...
    return low, high


#: The calendar span each measured horizon covers, in the sentence's own words.
#: A horizon not listed prints its session count alone.
HORIZON_WORDS: dict = dict(zip(_JOB_HORIZONS, ("about 1 month", "about 3 months", "about 6 months")))


def outcome_phrase(benchmark: Optional[str], horizon: int) -> str:
    """What the hit rate counts, with its BASE, in the member's words: the share
    that beat the benchmark from the next session's open to the close ``horizon``
    sessions later (owner decision N6, 2026-11-07: a member sees the dot after
    the close and can act at the next open at the earliest). The ONE phrase: the
    card sentence, the methodology page and the Discord evidence line all read it
    from here, so the base cannot be stated two ways."""
    bench = benchmark or "the benchmark"
    return f"beat {bench} from the next session's open to the close {int(horizon)} sessions later"

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
    hit_rate_low_pct, hit_rate_high_pct, median_excess_pct,
    baseline_hit_rate_pct, horizon_bars, start, end, benchmark, asof,
    survivorship, survivorship_corrected, split_unchecked, display_floor_n,
    min_event_dates, displayable, outcome}``. ``outcome`` is
    :func:`outcome_phrase`: what the hit rate counts, base included, so a caller
    printing the number prints its basis.

    THE FLOOR IS ON EFFECTIVE N, NOT RAW n (review #6, 2026-11-07). Events that
    share a session share one market: 5,000 red-day highs on 40 red sessions
    are 40 observations, not 5,000 (research base 03-evidence.md, the
    effective-N rule; measure.py's own header). ``sessions`` is the horizon
    block's ``dates`` (distinct sessions with an event whose window at this
    horizon is complete, unit VA3), or the per-signal ``dates`` (every session
    with an event) on an artifact built before that field; ``effective_n`` is
    ``min(n, sessions)``. ``displayable`` is ``n >= method.display_floor_n``
    (the floor the artifact carries, `DISPLAY_FLOOR_N` when it does not) AND
    ``sessions >= MIN_EVENT_DATES`` (the span rule) AND a hit rate exists AND
    the window has both dates. An artifact without ``dates`` has no span and is
    not displayable. The same rule governs the Discord evidence line, which
    filters on ``displayable`` (main.py `_rs_evidence_for`).

    ``hit_rate_low_pct`` / ``hit_rate_high_pct`` are the :func:`wilson_interval`
    at :data:`INTERVAL_CONFIDENCE_PCT` over ``effective_n``. ``split_unchecked``
    is how many names behind this signal had a split list the guard could not
    judge (the artifact's ``split_guard.unchecked_by_signal``, else its run-level
    ``unchecked``); ``None`` on an artifact that does not say.

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
    sessions = _int(h.get("dates"))
    if sessions is None:                                 # an artifact from before unit VA3
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
    displayable = (n is not None and n >= floor and sessions is not None and sessions >= MIN_EVENT_DATES
                   and hit is not None and isinstance(start, str) and isinstance(end, str))
    band = wilson_interval(hit, effective) if (hit is not None and effective) else None
    base = baseline_for(horizon, art)
    return {
        "signal": signal,
        "label": SIGNAL_LABELS.get(signal, signal),
        "n": n,
        "sessions": sessions,
        "effective_n": effective,
        "incomplete": _int(h.get("incomplete")),
        "hit_rate_pct": round(hit * 100.0, 2) if hit is not None else None,
        "hit_rate_low_pct": round(band[0] * 100.0, 2) if band else None,
        "hit_rate_high_pct": round(band[1] * 100.0, 2) if band else None,
        "median_excess_pct": round(med, 2) if med is not None else None,
        "baseline_hit_rate_pct": base.get("hit_rate_pct") if base else None,
        "horizon_bars": int(horizon),
        "start": start,
        "end": end,
        "benchmark": art.get("benchmark"),
        "asof": art.get("asof"),
        "survivorship": art.get("survivorship") or SURVIVORSHIP_NOTE,
        "survivorship_corrected": False,
        "split_unchecked": split_unchecked_for(signal, art),
        "display_floor_n": floor,
        "min_event_dates": MIN_EVENT_DATES,
        "displayable": bool(displayable),
        "outcome": outcome_phrase(art.get("benchmark"), horizon),
    }


def split_unchecked_for(signal: str, artifact: Optional[dict]) -> Optional[int]:
    """How many names behind ``signal`` the split guard could not judge: the
    artifact's per-signal count when it carries one, else the run-level count,
    else ``None`` (an artifact from before unit VA3 says nothing, and nothing is
    printed for it)."""
    guard = artifact.get("split_guard") if isinstance(artifact, dict) else None
    if not isinstance(guard, dict):
        return None
    by_signal = guard.get("unchecked_by_signal")
    if isinstance(by_signal, dict) and _int(by_signal.get(signal)) is not None:
        return max(0, _int(by_signal.get(signal)))
    run_level = _int(guard.get("unchecked"))
    return max(0, run_level) if run_level is not None else None


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


def requirement_phrase(floor, min_dates=MIN_EVENT_DATES) -> str:
    """What a measured number needs before it prints, in plain words (the
    withheld sentence and the methodology page both read it from here)."""
    return f"it needs at least {int(floor):,} events on at least {int(min_dates):,} different sessions"


def likely_range_phrase(low_pct, high_pct) -> str:
    """The hit rate's likely range as it follows the number, with its leading
    space: `` (likely between 51.9% and 64.4%)``; ``""`` when either bound is
    missing. The ONE wording (:data:`INTERVAL_WORDS`): the card sentence and the
    Discord evidence line both read it from here."""
    lo, hi = _num(low_pct), _num(high_pct)
    if lo is None or hi is None:
        return ""
    return f" ({INTERVAL_WORDS} {lo:.1f}% and {hi:.1f}%)"


def survivorship_sentence(note=None) -> str:
    """The survivorship caveat as a sentence (``Universe as held, survivorship
    not yet corrected.``), from the artifact's own note or `SURVIVORSHIP_NOTE`."""
    return _sentence_case(note or SURVIVORSHIP_NOTE)


def split_unchecked_phrase(count) -> str:
    """The measured sentence's disclosure of names the split guard could not
    judge; ``""`` when there are none (or the artifact does not say)."""
    n = _int(count)
    if not n or n <= 0:
        return ""
    return f"Stock splits not yet checked for {n:,} {'name' if n == 1 else 'names'}."


def _below_floor_sentence(ev: dict) -> Optional[str]:
    """What UCT measured when it is too little to print (review #22,
    2026-11-07): the honesty line says "has not measured one yet", which is
    false once the artifact carries the signal. None when the floor is not the
    reason the number is withheld (the caller then prints the honesty line)."""
    n, sessions, floor = ev.get("n"), ev.get("sessions"), ev.get("display_floor_n")
    if not isinstance(floor, int) or not isinstance(n, int) or not isinstance(sessions, int):
        return None
    h = ev.get("horizon_bars")
    min_dates = ev.get("min_event_dates")
    min_dates = min_dates if isinstance(min_dates, int) else MIN_EVENT_DATES
    need = requirement_phrase(floor, min_dates)
    if n == 0:
        pending = ev.get("incomplete")
        if isinstance(pending, int) and pending > 0 and isinstance(h, int):
            return (f"UCT has recorded {pending:,} events on {sessions:,} sessions, none with a complete "
                    f"{h}-session window yet, so no hit rate is printed.")
        return f"UCT measured 0 events, too few to print a hit rate: {need}."
    if n >= floor and sessions >= min_dates:
        return None
    return f"UCT measured {n:,} events on {sessions:,} sessions, too few to print a hit rate: {need}."


def sentence_for(ev: Optional[dict]) -> str:
    """The evidence sentence for an `evidence_for` dict, in operator voice.

    Displayable: the count, the sessions it fell on, the window, then the hit
    rate with its likely range (:func:`wilson_interval`, unit VA3) and its base
    (:func:`outcome_phrase`: from the next session's open, N6) against the
    all-bars baseline (review #6) at a horizon stated in SESSIONS, measured on
    daily bars (review #7: the same sentence prints on a weekly chart, where "63
    bars" would read as 63 weeks); then, only when the artifact counts any,
    the names whose splits could not be checked (unit VA3), then the
    survivorship caveat. Under the floor or the span rule: what was measured
    and what a number needs (review #22). No artifact block for the signal (or
    a block the floor does not explain): `HONESTY_SENTENCE`."""
    if not isinstance(ev, dict):
        return HONESTY_SENTENCE
    if not ev.get("displayable"):
        return _below_floor_sentence(ev) or HONESTY_SENTENCE
    h = int(ev["horizon_bars"])
    on = f" on {int(ev['sessions']):,} sessions" if isinstance(ev.get("sessions"), int) else ""
    band = likely_range_phrase(ev.get("hit_rate_low_pct"), ev.get("hit_rate_high_pct"))
    text = (f"{int(ev['n']):,} {ev['label']}{on}, {ev['start']} to {ev['end']}, daily bars: "
            f"{float(ev['hit_rate_pct']):.1f}%{band} {outcome_phrase(ev.get('benchmark'), h)}")
    notes = [w for w in (HORIZON_WORDS.get(h),) if w]
    if ev.get("median_excess_pct") is not None:
        notes.append(f"median {float(ev['median_excess_pct']):+.1f}%")
    if notes:
        text += f" ({'; '.join(notes)})"
    if ev.get("baseline_hit_rate_pct") is not None:
        text += f", against {float(ev['baseline_hit_rate_pct']):.1f}% for all bars"
    text += "."
    splits = split_unchecked_phrase(ev.get("split_unchecked"))
    if splits:
        text += f" {splits}"
    tail = survivorship_sentence(ev.get("survivorship"))
    return f"{text} {tail}" if tail else text


def summary_line(signal: str, horizon: int = DEFAULT_HORIZON, artifact: Optional[dict] = None) -> str:
    """`sentence_for(evidence_for(signal, horizon, artifact))`."""
    return sentence_for(evidence_for(signal, horizon, artifact))
