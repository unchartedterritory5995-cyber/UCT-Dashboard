r"""Which render-token SLOT did a sender present? (R29, OI-13 step 6.)

⚰️ **THE QUESTION THIS EXISTS TO ANSWER.** `CHART_RENDER_TOKEN_PREVIOUS` is set on `web` and
holds a DIFFERENT value from `CHART_RENDER_TOKEN` — measured 2026-09-15 by salted hash,
in-process, without printing either. So production is running TWO live render credentials from
a rotation somebody started and never finished: "an uncleared previous is not a rotation, it is
two live tokens."

Clearing it is one env change. The risk is the one thing nobody could size: a sender still
holding the OLD value — realistically a browser carrying a pre-rotation frontend bundle — gets
a silent 403 at `/r/*`. **R29: do not clear until a durable counter has read ZERO `previous`
matches across a full weekday including Morning Wire's 07:35 ET run and a market session.**

⛔⛔ **THE COUNTER MUST BE DURABLE OR IT ANSWERS THE WRONG QUESTION.** `web` deployed TWENTY
times on 2026-09-15; the longest pod life was ~45 minutes. An in-memory counter is erased ~20x
a day, so "zero previous matches" would mean "zero since the last deploy, which was 20 minutes
ago" — and a missed poll would be indistinguishable from a genuine zero. An absence is evidence
only if the instrument could have seen a presence.

⛔ **NEVER THE VALUE. ONLY THE SLOT NAME.** This module records `"current"` / `"previous"`,
counts, and timestamps. No token, no prefix, no length, no hash of the live value goes to disk
or to a log. C-13 is the standing reason: the chart-renderer logged the render token in
plaintext on every page-load timeout for two weeks.

⛔ **AND IT NEVER DECIDES ANYTHING.** The accept/reject decision is made before this is called
and is byte-identical whether the write succeeds, fails, or the volume is read-only.
"""
from __future__ import annotations

import json
import os
import pathlib
import threading
import time

SLOT_CURRENT = "current"
SLOT_PREVIOUS = "previous"
SLOTS = (SLOT_CURRENT, SLOT_PREVIOUS)

_lock = threading.RLock()
_last_error: str | None = None


def counter_path() -> pathlib.Path:
    r"""⛔ The `.get()` default is an INLINE LITERAL — the `auth_db.py:10` idiom. Written with
    module constants instead, `conftest.shared_data_root_census` cannot derive the pin, the var
    lands in `unpinnable`, and unit tests write into the owner's live `C:\data`. That exact
    mistake was made and caught by the tripwire in the sibling module on 2026-09-17."""
    return pathlib.Path(os.environ.get("RENDER_TOKEN_SLOT_COUNTER_PATH",
                                       "/data/discord-render/token-slots.json"))


def _blank() -> dict:
    return {"slots": {s: {"count": 0, "first_seen": None, "last_seen": None} for s in SLOTS},
            "since": None, "commit": None}


def _read() -> dict:
    try:
        d = json.loads(counter_path().read_text(encoding="utf-8"))
        if not isinstance(d, dict) or "slots" not in d:
            return _blank()
        for s in SLOTS:
            d["slots"].setdefault(s, {"count": 0, "first_seen": None, "last_seen": None})
        return d
    except FileNotFoundError:
        return _blank()
    except Exception:  # noqa: BLE001 — an unreadable counter is a BLANK one, never a zero claim
        d = _blank()
        d["unreadable"] = True
        return d


def note_match(slot: str, *, commit: str = "", now: float | None = None) -> bool:
    """Record that a sender presented the token in `slot`. Returns True if persisted.

    ⛔ Called AFTER the accept decision, never inside it. Every failure is swallowed into
    `_last_error` and surfaced by `snapshot()` — a swallowed error that leaves no trace would
    make an unwritable volume look exactly like a quiet one."""
    global _last_error
    if slot not in SLOTS:
        return False
    try:
        now = time.time() if now is None else now
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
        with _lock:
            d = _read()
            if d.get("unreadable"):
                d.pop("unreadable", None)
            entry = d["slots"][slot]
            entry["count"] = int(entry.get("count") or 0) + 1
            entry["first_seen"] = entry.get("first_seen") or stamp
            entry["last_seen"] = stamp
            d["since"] = d.get("since") or stamp
            d["commit"] = commit or d.get("commit")
            p = counter_path()
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(p.suffix + ".tmp")
            tmp.write_text(json.dumps(d), encoding="utf-8")
            os.replace(tmp, p)      # atomic — a torn counter would read as a zero
        return True
    except Exception as e:  # noqa: BLE001
        _last_error = f"note_match: {e!r}"[:160]
        return False


def snapshot() -> dict:
    """What `/api/discord/render-health` carries. Slot names and counts ONLY."""
    d = _read()
    out = {"slots": d.get("slots", {}), "since": d.get("since"),
           "path": str(counter_path()), "last_error": _last_error}
    if d.get("unreadable"):
        # ⛔ UNREADABLE IS NOT ZERO. R29's condition is "zero previous matches"; an unreadable
        # counter must never satisfy it.
        out["unreadable"] = True
    return out


def r29_satisfied(*, weekday_span_hours: float = 24.0) -> dict:
    """Is OI-13 step 6 permitted? PURE over the snapshot, so the rule is testable.

    ⛔ Three ways to answer NO, and they are different facts: the counter is unreadable; it has
    not covered a full weekday yet; or a `previous` match was actually seen."""
    s = snapshot()
    if s.get("unreadable"):
        return {"ok": False, "reason": "counter unreadable — unreadable is not zero"}
    prev = int((s.get("slots", {}).get(SLOT_PREVIOUS) or {}).get("count") or 0)
    if prev > 0:
        return {"ok": False, "reason": f"{prev} previous-slot match(es) seen", "previous": prev}
    since = s.get("since")
    if not since:
        return {"ok": False, "reason": "no observation window yet"}
    try:
        started = time.mktime(time.strptime(since, "%Y-%m-%dT%H:%M:%SZ"))
        hours = (time.time() - started) / 3600.0
    except Exception:  # noqa: BLE001
        return {"ok": False, "reason": "unparsable since-stamp"}
    if hours < weekday_span_hours:
        return {"ok": False, "reason": f"only {hours:.1f} h observed of {weekday_span_hours:.0f} h",
                "hours": round(hours, 1)}
    return {"ok": True, "reason": f"zero previous matches over {hours:.1f} h", "hours": round(hours, 1)}


def _reset_for_tests() -> None:
    global _last_error
    with _lock:
        _last_error = None
