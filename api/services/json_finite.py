"""One pass that makes a payload JSON-encodable: any non-finite float becomes None.

⛔ Starlette encodes with ``allow_nan=False``, so a single ``inf`` or ``NaN``
anywhere in a response turns the WHOLE answer into a 500 (2026-10-18: KOPN's
forward P/E broke every screener scan page that carried it, and
``/api/fundamentals/KOPN``). The producers refuse their own non-finite values
and the screener table stores them as NULL (``snapshot_db._coerce``); this is
for the answer boundary, where a value already persisted before those guards
(the screener rows, the fundamentals snapshot store) would otherwise keep
failing until it was rebuilt.

Applied where a response is assembled, never as an app-wide encoder: a
recursive walk over every payload would cost the large ones (the flow
aggregate) for nothing.
"""
import math


def scrub(obj):
    """``obj`` with every non-finite float replaced by None. Containers are
    copied only when something inside them changes, so a clean payload comes
    back as the same object."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        out = None
        for k, v in obj.items():
            nv = scrub(v)
            if nv is not v:
                if out is None:
                    out = dict(obj)
                out[k] = nv
        return obj if out is None else out
    if isinstance(obj, list):
        out = None
        for i, v in enumerate(obj):
            nv = scrub(v)
            if nv is not v:
                if out is None:
                    out = list(obj)
                out[i] = nv
        return obj if out is None else out
    if isinstance(obj, tuple):
        new = tuple(scrub(v) for v in obj)
        return obj if all(a is b for a, b in zip(new, obj)) else new
    return obj
