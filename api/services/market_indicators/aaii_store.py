"""THE AAII SENTIMENT SURVEY READER — three components, two stores, one timeline.

⭐⭐ THIS MODULE INGESTS NOTHING. Every number it returns was already written to a
canonical UCT store by a path that existed before this file did, and the AAII source
gate for this project was passed on exactly that basis: `aaii_bulls`, `aaii_bears` and
`aaii_neutral` are FIRST-CLASS STORED KEYS, not something reconstructed here. The one
forbidden move in this whole area — deriving three components from the one spread — is
not merely avoided, it is unavailable: this file never reads `aaii_spread`.

⛔⛔ THE HISTORY LIVES IN TWO STORES AND THE SEAM IS A DATE, NOT A GUESS.

    breadth_sentiment_history   1987-07-24 … 2026-01-01   the public archive seed
    breadth_snapshots           2026-01-02 … today        the 4:15pm collector

`tools/build_breadth_sentiment.py` keeps ONLY rows strictly before its
`COLLECTOR_FLOOR` (2026-01-02) precisely so the two never overlap and neither has to
win an argument with the other. Reading both and preferring the collector on a
collision is belt-and-braces, not a merge policy.

⛔ THE OBSERVATION DATE IS `aaii_survey_date`, NEVER THE SNAPSHOT'S OWN DATE. A
snapshot is written every trading day and CARRIES the standing weekly reading, so
keying on its date would manufacture five observations a week out of one survey —
the exact fabrication `step_to_daily` exists to avoid downstream. Deduplicating by
survey date turns ~180 daily snapshots back into the ~36 surveys they report.

⚠️ AND A SNAPSHOT WITHOUT A SURVEY DATE IS SKIPPED, not dated by its own row. An
undated reading is a number we cannot place on a timeline, and placing it anyway is
how a survey series acquires a point nobody took.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

_log = logging.getLogger("market_indicators.aaii")

#: The three components, by their canonical stored key. ⛔ `aaii_spread` IS ABSENT
#: DELIBERATELY — it is a DERIVED series with its own long-standing member-facing
#: home (`UCTAAII`, the breadth pseudo-ticker), and nothing here should be able to
#: confuse a component with a derivation of two components.
COMPONENT_KEYS = ("aaii_bulls", "aaii_bears", "aaii_neutral")

#: The snapshot field carrying the date the survey was TAKEN FOR.
_SURVEY_DATE_KEY = "aaii_survey_date"


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _iso10(v) -> Optional[str]:
    """A 'YYYY-MM-DD' or nothing. ⚠️ The collector has stored this as both a bare
    ISO day and a full timestamp across eras; taking the first ten characters and
    then VALIDATING is what makes the reader survive both without a format flag."""
    if not v:
        return None
    s = str(v)[:10]
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        return None
    try:
        int(s[0:4]), int(s[5:7]), int(s[8:10])
    except ValueError:
        return None
    return s


def _from_archive(key: str) -> dict:
    """{survey_date: value} from the public-archive seed. Read-only."""
    try:
        from api.services import breadth_sentiment_history as hist
    except Exception:
        return {}
    out = {}
    for p in hist.observations(key) or []:
        d = _iso10(p.get("t"))
        v = _finite(p.get("v"))
        if d and v is not None:
            out[d] = v
    return out


def _from_snapshots(key: str) -> dict:
    """{survey_date: value} from the collector's daily rows, deduplicated.

    ⚠️ LAST WRITE WINS ON A SURVEY DATE, and the scan is date-ASCENDING so "last"
    means the most recent snapshot that reported that survey. A revised reading
    therefore supersedes the first one it was published beside, which is what a
    revision is.
    """
    try:
        from api.services import breadth_monitor as bm
    except Exception:
        return {}
    out = {}
    try:
        with bm._conn() as c:
            rows = c.execute(
                "SELECT date, metrics FROM breadth_snapshots ORDER BY date ASC"
            ).fetchall()
    except Exception as e:
        _log.warning("aaii: snapshot read failed (%s) — archive only", e)
        return {}
    for row in rows:
        raw = row[1] if not hasattr(row, "keys") else row["metrics"]
        if not raw:
            continue
        try:
            m = json.loads(raw)
        except Exception:
            continue
        if not isinstance(m, dict):
            continue
        v = _finite(m.get(key))
        if v is None:
            continue
        d = _iso10(m.get(_SURVEY_DATE_KEY))
        if d is None:
            # ⛔ NOT DATED BY THE SNAPSHOT'S OWN DAY. See the module header: that
            # would turn one survey into one observation per trading day.
            continue
        out[d] = v
    return out


def observations(key: str) -> list:
    """Every AAII reading for one component, ascending — `[{t, v}]`.

    `t` is the date the survey was taken FOR (AAII's Wednesday), never the day the
    number was read or stored. `[]` when the component is unknown or unavailable —
    an honest "cannot", which every caller renders as an absence.
    """
    k = (key or "").strip().lower()
    if k not in COMPONENT_KEYS:
        return []
    merged = _from_archive(k)
    # ⭐ THE COLLECTOR WINS A COLLISION. The archive is a frozen public snapshot;
    # the collector is the live authority and is the only one of the two that can
    # carry a revision. By construction they do not overlap — this decides the
    # case where a future re-seed makes them.
    merged.update(_from_snapshots(k))
    return [{"t": d, "v": merged[d]} for d in sorted(merged)]


def coverage() -> dict:
    """Per-component first/last/count, for the operator status surface."""
    out = {}
    for k in COMPONENT_KEYS:
        obs = observations(k)
        out[k] = {"rows": len(obs),
                  "first": obs[0]["t"] if obs else None,
                  "last": obs[-1]["t"] if obs else None}
    return out
