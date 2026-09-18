"""R63(b) — instrument real cold-path calls, durably, so R63(d) can join them against the
durable stall record over real pod boots.

WHY DURABLE AND NOT AN IN-MEMORY RING. `stall_record.py`'s own docstring already paid for this
lesson: *"web deployed TWENTY times in one day; the longest pod life was ~45 minutes. A ring
buffer... held in module state is erased ~20x/day."* R63(b)'s whole purpose is to accumulate
evidence *across* "the next 10 pods" — an in-memory ring would lose everything on the very next
redeploy, before anyone reads it. Same fix as `stall_record.py`: append-only JSONL on the volume,
own env var, `/data` default (the `AUTH_DB_PATH` idiom `conftest.shared_data_root_census` derives
sandbox pins from).

WHAT IT RECORDS, AND WHY WALL-CLOCK, NOT UPTIME. `stall_record.py` keys its entries on
`uptime_s` because LoopWatch owns that clock and starts it itself. This instrument is a
DIFFERENT component with no shared clock to LoopWatch, and inventing a second "since boot"
timer here would be a second authority over "how long has this pod been up" the moment the two
disagree by even a second. Wall-clock (`at_start`/`at_end`, UTC ISO) is what both this file and
`stall_record.py` already agree on independently, so `join_with_stall_record` compares wall-clock
INTERVAL OVERLAP rather than trying to reconcile two uptime clocks.

WHY A CONTEXT MANAGER, NOT A DECORATOR. Several of R63(a)'s candidate call sites are inline
blocks inside larger functions (a lazy `import` followed immediately by a data load), not clean
standalone functions worth decorating. `with observe_cold_call("name"):` wraps exactly the span
that matters without requiring a refactor to extract a function first.

NEVER RAISES INTO THE CALLER'S PATH FOR AN INSTRUMENTATION FAILURE. A write failure here must
never turn a working cold path into a broken one — the same contract as `stall_record.note()`.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import pathlib
import threading
import time

logger = logging.getLogger(__name__)

RECORD_PATH_ENV = "COLD_PATH_INSTRUMENT_PATH"
#: ⛔ INLINE LITERAL DEFAULT, never a name — `conftest.shared_data_root_census`'s AST derivation
#: requires `os.environ.get(ENV, "/data/...")` with the default written literally at the call
#: site (`stall_record.record_path`'s own docstring measured this the hard way, 2026-09-17).
DEFAULT_RECORD_PATH = "/data/discord-render/cold-path-calls.jsonl"

#: Keep it bounded. Even a busy pod logging every manifest hit stays well under this in a
#: 45-minute life; a long-lived local dev process is the only way to approach it.
MAX_RECORDS = 5000

_lock = threading.Lock()
_main_thread = threading.main_thread()
_last_error: "str | None" = None


def record_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("COLD_PATH_INSTRUMENT_PATH",
                                       "/data/discord-render/cold-path-calls.jsonl"))


def _append(entry: dict) -> None:
    global _last_error
    try:
        p = record_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with _lock:
            lines = []
            if p.exists():
                lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
            lines.append(json.dumps(entry))
            if len(lines) > MAX_RECORDS:
                lines = lines[-MAX_RECORDS:]
            tmp = p.with_suffix(p.suffix + ".tmp")
            tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
            os.replace(tmp, p)          # atomic — a torn write must never corrupt the record
    except Exception as e:                                     # noqa: BLE001
        _last_error = f"append: {e!r}"[:160]
        logger.exception("[cold-path-instrument] could not append a record")


@contextlib.contextmanager
def observe_cold_call(name: str):
    """Wrap a cold-path call span. Records regardless of success/failure — a loader that raises
    is exactly as interesting to R63(d) as one that succeeds slowly, maybe more so."""
    t0 = time.time()
    on_loop = threading.current_thread() is _main_thread
    thread_name = threading.current_thread().name
    ok = True
    try:
        yield
    except Exception:
        ok = False
        raise
    finally:
        t1 = time.time()
        try:
            _append({
                "at_start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
                "at_end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t1)),
                "name": name,
                "duration_ms": round((t1 - t0) * 1000, 1),
                "thread": thread_name,
                "is_loop_thread": on_loop,
                "ok": ok,
                "pid": os.getpid(),
            })
        except Exception:                                      # noqa: BLE001
            # ⛔ Observability must never be what breaks the cold path it is watching — the
            # same contract stall_record.note() states for itself.
            logger.exception("[cold-path-instrument] recording failed for %r", name)


def snapshot() -> dict:
    """What the record holds right now — for a status endpoint or a probe, never for a
    decision (this instrument gates nothing)."""
    try:
        lines = record_path().read_text(encoding="utf-8", errors="replace").splitlines()
        recent = [json.loads(x) for x in lines[-100:] if x.strip().startswith("{")]
        return {"path": str(record_path()), "total_recorded": len(lines), "recent": recent,
                "last_error": _last_error}
    except FileNotFoundError:
        return {"path": str(record_path()), "total_recorded": 0, "recent": [],
                "last_error": _last_error}
    except Exception as e:                                      # noqa: BLE001
        return {"path": str(record_path()), "total_recorded": None, "recent": [],
                "read_error": repr(e)[:160], "last_error": _last_error}


def join_with_stall_record(cold_calls: "list[dict]", stalls: "list[dict]",
                           *, pad_seconds: float = 1.0) -> list[dict]:
    """PURE — the analysis R63(d) actually needs. For every stall entry, name the cold-path
    calls (if any) whose [at_start - pad, at_end + pad] wall-clock window contains the stall's
    `at`. `pad_seconds` covers clock-granularity slop (both records round to whole seconds).

    ⛔ Returns EVERY stall, joined or not — a stall with an empty `joined_calls` list is the
    R63(d) finding itself ("a settled-pod stall with no cold-path cause"), not a row to drop.
    """
    def _parse(s: str) -> float:
        return time.mktime(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ")) - time.timezone

    calls = []
    for c in cold_calls:
        try:
            calls.append((_parse(c["at_start"]) - pad_seconds,
                          _parse(c["at_end"]) + pad_seconds, c))
        except Exception:                                       # noqa: BLE001
            continue

    out = []
    for s in stalls:
        try:
            at = _parse(s["at"])
        except Exception:                                        # noqa: BLE001
            out.append({**s, "joined_calls": [], "join_error": "unparsable stall timestamp"})
            continue
        hits = [c for (lo, hi, c) in calls if lo <= at <= hi]
        out.append({**s, "joined_calls": hits})
    return out


def _reset_for_tests() -> None:
    global _last_error
    _last_error = None
