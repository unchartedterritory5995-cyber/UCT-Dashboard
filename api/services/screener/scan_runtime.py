"""W5-T14 -- the scan DOORS' side of a stored runtime document.

Light on purpose: the on-demand door (`scan_run`, which the request path reaches) and the
sweep (`scan_evaluator`, which it must NEVER reach: `test_scan_evaluator_off_request_path`)
both need the same three answers about a runtime row -- may it run in this lane now
(`runtime_admission`), is it scannable and what is it filed under (`runtime_scan_spec`),
and a handle that remembers its row (`runtime_scan_doc`). They live here, once, so the
request path asks them without importing the evaluator and neither door keeps a copy.
"""
from __future__ import annotations

import math
from typing import Any, Mapping, Optional

from api.services import runtime_definitions, runtime_server_lane, scan_definition
from api.services.screener import scan_store


class RuntimeScanDoc(dict):
    """A stored runtime document that REMEMBERS THE ROW it was read from.

    The scan lanes pass definitions, not rows, and the service needs the row's
    ``def_id``, ``version`` and owner (and admission needs the owner's role). A
    plain ``dict`` copy loses ``lane_row`` and then every runtime run refuses by
    name (``_runtime_row``) -- it fails closed, it never guesses an owner."""

    lane_row: Optional[Mapping[str, Any]] = None


def runtime_scan_doc(row: Mapping[str, Any]) -> RuntimeScanDoc:
    """The scan lanes' handle for one stored runtime row (shallow copy of its document)."""
    doc = RuntimeScanDoc(row["definition"])
    doc.lane_row = row
    return doc


def runtime_scan_spec(definition: Any) -> dict:
    """``{"def_hash", "plot"}`` for a scannable runtime document, or ``ScanRefused``.

    The handle is the store's own (``runtime_definitions.handle`` =
    ``HASH_PREFIX`` + the source's sha256), so a runtime result can never collide
    with a tree's ``sha256:`` handle in ``scan_hits`` / ``scan_coverage``."""
    if not runtime_definitions.is_runtime(definition):
        raise scan_definition.ScanRefused(
            "kind", "this is not a stored runtime document")
    compute = definition["compute"]
    outputs = compute.get("outputs")
    plots = sorted(outputs) if isinstance(outputs, dict) else []
    if len(plots) != 1:
        raise scan_definition.ScanRefused(
            "tree",
            f"a scan reads ONE plot and this script maps {len(plots)} "
            f"({', '.join(plots) or 'none'}); a document names no scan plot of its "
            "own, so only a script drawing exactly one plot (a 0/1 condition) is "
            "scannable")
    try:
        handle = runtime_definitions.handle(definition)
    except Exception as exc:                                 # noqa: BLE001
        raise scan_definition.ScanRefused(
            "hash", f"the script's identity could not be read: {exc}") from exc
    if not handle.startswith(runtime_definitions.HASH_PREFIX):
        raise scan_definition.ScanRefused(
            "hash", "the runtime handle does not carry the runtime prefix")
    return {"def_hash": handle, "plot": plots[0]}


def runtime_admission(row: Any, lane: str, plot: str) -> Optional[tuple]:
    """``(guard, sentence)`` when this stored runtime row may NOT run this plot in this lane
    now, else ``None``. THE ONE ADMISSION: ``runtime_server_lane.admission`` (the stored
    verdict, then ``server_lane_refusal``), the very question ``runtime_column_fn`` asks on
    every call. Fails closed (an admission that cannot answer admits nothing)."""
    try:
        return runtime_server_lane.admission(row, plot, lane)
    except Exception:  # noqa: BLE001 -- an admission that cannot answer admits nothing
        return ("runtime:server-unavailable",
                "the server-lane admission could not answer, so this script does not run")


def store_time_seconds(t: Any) -> Optional[float]:
    """ONE store bar key as the service's unix SECONDS, or ``None`` when it is not readable.

    The store keys a daily bar by a YYYYMMDD int; the runtime reads ``t`` as unix seconds. A
    daily key becomes its session's 09:30 America/New_York open (the chart's daily convention,
    ``indicator_compute.bar_open_instant``); epoch seconds pass through. The single home of this
    conversion for the scan and backtest lanes (W5-T15's ``_epoch_seconds`` should call it)."""
    from api.services import indicator_compute
    if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t):
        return None
    n = int(t)
    if scan_store._AS_OF_MIN <= n <= scan_store._AS_OF_MAX:
        secs = indicator_compute.bar_open_instant(
            "%04d-%02d-%02d" % (n // 10000, (n // 100) % 100, n % 100), "D")
    else:
        secs = indicator_compute.bar_open_instant(float(n))
    return None if secs is None else float(secs)
