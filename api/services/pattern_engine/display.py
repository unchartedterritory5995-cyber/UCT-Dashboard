"""Display-only annotations for detections (never read by any firing decision).

`end_t` on a detection is the last bar of the SCAN WINDOW for every geometry
detector (lab/geometry_eval REPORT.md fix 3), so a stored detection cannot say
whether its structure is live or ended weeks ago. It also feeds the memory
dedup hash and outcome tracking, so it is deliberately NOT changed here.

Instead `annotate(detections, bars)` adds, under `geometry.extras`:

  pattern_end_t     the newest bar time any of the detection's own anchors
                    (primary or `geometry.secondary`) sits on — the
                    structure's real last bar.
  pattern_age_bars  how many window bars came after it (0 = the structure is
                    on the last bar).

Both are derived from anchors the detector already emitted, after the fact, so
they cannot change what fires, its confidence or HIST_SCORE.
"""
from __future__ import annotations

from bisect import bisect_right


def _anchor_times(geometry: dict) -> list:
    out = []
    for a in (geometry or {}).get("anchors") or []:
        t = a.get("t") if isinstance(a, dict) else None
        if isinstance(t, (int, float)):
            out.append(t)
    for sec in (geometry or {}).get("secondary") or []:
        if isinstance(sec, dict):
            out.extend(_anchor_times({"anchors": sec.get("anchors")}))
    return out


def pattern_end(detection: dict, bar_times: list):
    """(pattern_end_t, pattern_age_bars) or (None, None) when unknowable.

    Only anchor times that are REAL bar times of this window count, so a stray
    projected or index-shaped value can never masquerade as the pattern's end.
    """
    if not bar_times:
        return None, None
    present = set(bar_times)
    times = [t for t in _anchor_times(detection.get("geometry") or {}) if t in present]
    if not times:
        return None, None
    end_t = max(times)
    age = len(bar_times) - bisect_right(bar_times, end_t)
    return int(end_t), int(age)


def annotate(detections: list, bars: list) -> list:
    """Stamp pattern_end_t / pattern_age_bars in place. Never raises."""
    try:
        bar_times = [b["t"] for b in bars or []]
    except Exception:  # noqa: BLE001 -- display annotation must never break a scan
        return detections
    for d in detections or []:
        try:
            end_t, age = pattern_end(d, bar_times)
            if end_t is None:
                continue
            geom = d.setdefault("geometry", {})
            extras = geom.setdefault("extras", {})
            extras["pattern_end_t"] = end_t
            extras["pattern_age_bars"] = age
        except Exception:  # noqa: BLE001
            continue
    return detections
