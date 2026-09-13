"""The D12 dataset registry — the one authority for what S-A captures, when, and how it pages.

Each :class:`Dataset` names its reader (``families/<name>.py``), the job slot that
runs it (docs/wisdom/CONTRACTS.md §5), how its as_of is chosen, and which health
states page. ``wisdom_capture_datasets`` mirrors the static half of this table and
is re-synced from it on every run; nothing else restates it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from api.services.wisdom.capture.families import (
    breadth_intraday,
    candidates,
    catalysts,
    detection_outcomes,
    detections,
    finviz,
    gex,
    rs,
    screener,
    street,
    themes,
    tweets,
    vision,
    wire,
    wire_inputs,
)

JOB_DETECTIONS = "wisdom_capture_detections"
JOB_MORNING = "wisdom_capture_morning"
JOB_THEMES = "wisdom_capture_themes"
JOB_TWEETS = "wisdom_capture_tweets"
JOB_EOD = "wisdom_capture_eod"
JOB_LATE = "wisdom_capture_late"

_PAGE_ALL = frozenset({"zero", "missing"})
_PAGE_MISSING = frozenset({"missing"})
_PAGE_NONE: frozenset = frozenset()


@dataclass(frozen=True)
class Dataset:
    name: str
    family: str
    job_id: str
    cadence: str
    as_of_rule: str
    read: Callable[..., dict]
    session_shaped: bool = False
    pages: frozenset = field(default=_PAGE_ALL)
    shard_rows: int = 0            # >0: a RowStream payload is archived in shards of this many rows + a manifest
    hash_on_change: bool = False   # an unchanged payload writes no new object

    @property
    def r2_prefix(self) -> str:
        return f"wisdom/context/<as_of>/{self.name}"


DATASETS: tuple[Dataset, ...] = (
    Dataset("detections", "pattern_detections", JOB_DETECTIONS, "daily 00:17 ET",
            "ET date of the slot; rows with last_seen_at in (watermark, slot], detected_at within the "
            "pattern engine's active window before the watermark",
            detections.read, shard_rows=5000),
    Dataset("detection_outcomes", "pattern_detections", JOB_DETECTIONS, "daily 00:17 ET",
            "ET date of the slot; pattern_outcomes with resolved_at in (watermark, slot]",
            detection_outcomes.read, pages=_PAGE_MISSING),
    Dataset("screener", "screener", JOB_MORNING, "daily 05:43 ET",
            "median bars_asof of screener_rows (the session the rows describe), never snapshot_date",
            screener.read, session_shaped=True),
    Dataset("finviz", "finviz", JOB_MORNING, "daily 05:43 ET",
            "ET date of the artifact's own as_of (the 02:45 ET universe pull)",
            finviz.read),
    Dataset("themes", "theme_members", JOB_THEMES, "daily 06:13 ET",
            "ET date of the run; hash-on-change",
            themes.read, hash_on_change=True),
    Dataset("tweets", "x_posts", JOB_TWEETS, "hourly :29",
            "ET date of (slot − 1 h): official-account posts created that ET day",
            tweets.read, pages=_PAGE_MISSING),
    Dataset("wire", "wire", JOB_EOD, "mon-fri 16:52 ET",
            "the payload's own 'date'",
            wire.read, session_shaped=True),
    Dataset("candidates", "scanner_candidates", JOB_EOD, "mon-fri 16:52 ET",
            "the candidates envelope's market_date, else the wire date",
            candidates.read, session_shaped=True),
    Dataset("rs", "rs", JOB_EOD, "mon-fri 16:52 ET",
            "session of the run (the cache carries no as-of date of its own)",
            rs.read, session_shaped=True),
    Dataset("street", "street", JOB_EOD, "mon-fri 16:52 ET",
            "session of the run",
            street.read, session_shaped=True),
    Dataset("breadth_intraday", "breadth_intraday", JOB_EOD, "mon-fri 16:52 ET",
            "session of the run (breadth_intraday.session_date)",
            breadth_intraday.read, session_shaped=True),
    Dataset("gex", "gex", JOB_EOD, "mon-fri 16:52 ET",
            "session of the run — a named gap on web (see families/gex.py)",
            gex.read, session_shaped=True, pages=_PAGE_NONE),
    Dataset("wire_inputs", "morning_wire_inputs", JOB_EOD, "mon-fri 16:52 ET",
            "the wire date; Brain Pack rows as of that date",
            wire_inputs.read, session_shaped=True, pages=_PAGE_MISSING),
    Dataset("catalysts", "catalysts", JOB_LATE, "mon-fri 17:34 ET",
            "session of the run (catalysts.market_date)",
            catalysts.read, session_shaped=True),
    Dataset("vision", "pattern_vision", JOB_LATE, "mon-fri 17:34 ET",
            "session of the run; pattern_verdicts with judged_at in (watermark, 17:34 ET of that session]",
            vision.read, session_shaped=True, pages=_PAGE_MISSING),
)

_BY_NAME = {ds.name: ds for ds in DATASETS}


def by_name(name: str) -> Optional[Dataset]:
    return _BY_NAME.get(name)


def for_job(job_id: str) -> tuple[Dataset, ...]:
    return tuple(ds for ds in DATASETS if ds.job_id == job_id)


def job_ids() -> tuple[str, ...]:
    seen: list[str] = []
    for ds in DATASETS:
        if ds.job_id not in seen:
            seen.append(ds.job_id)
    return tuple(seen)
