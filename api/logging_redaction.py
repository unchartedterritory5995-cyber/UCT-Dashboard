"""Keep one route's query string out of our own access log (Wave L Slice 4 gate).

⭐⭐ THIS IS A BACKSTOP, NOT THE PRIMARY CONTROL — and saying so is the point.
The primary control already exists and predates this file: `api/main.py` puts
`"uvicorn.access"` in its `_noisy` list and sets it to WARNING, while uvicorn
emits access lines at INFO. **So this app logs no request URLs at all**,
verified two ways — by reading that list, and empirically, by running the real
app under `local_backend_sandbox.py --log-level info` and getting ZERO request
lines (the check that first looked clean for the wrong reason: a sandbox at
`warning` produces no access lines to be clean about).

⛔ SO WHY KEEP THIS. That list is about NOISE, not privacy. Removing one string
from it is a plausible one-word change by someone restoring "operational
visibility", and the moment it happens every share's payload starts landing in
the log. `tests/test_share_query_redaction.py` pins both layers so the silence
is deliberate rather than incidental.

⛔ THE UNDERLYING SHAPE. The Web Share Target is `method: "GET"`, so an Android
share arrives as:

    GET /journal/share?title=…&text=…&url=… HTTP/1.1

and `text` is where most sending apps put the link AND the surrounding prose —
which can be a passage the member selected from private correspondence, not a
public headline. `railway.json` starts uvicorn without `--no-access-log`, so
only the `setLevel` above stands between that line and the log. uvicorn's access
record is (measured against uvicorn 0.41.0's own source, `h11_impl.py` /
`httptools_impl.py`):

    access_logger.info('%s - "%s %s HTTP/%s" %d',
                       client_addr, method, path_WITH_QUERY, http_version, status)

so `record.args[2]` carries the member's shared text into our logs verbatim.

⭐ NARROWEST LAYER, DELIBERATELY. This does NOT disable access logging, and it
does not touch any other route: it rewrites the query of exactly the paths in
`REDACTED_QUERY_PATHS` and leaves the method, path, status and every other
request untouched, so the log stays as useful as it was.

⛔⛔ WHAT THIS DOES NOT DO, AND WE DO NOT CLAIM IT DOES. Redaction happens
INSIDE our process. Any upstream component that logs the request line before it
reaches us — Railway's edge/proxy above all — has already seen the full URL, and
we cannot reach it. That residual is the honest cost of the GET transport and is
recorded as such in `docs/notebook/wave-l-slice4-mobile-share.md` §10. Do not
describe this module as making the share payload private; it makes it absent
from OUR logs.

⛔ INSTALL AFTER UVICORN HAS CONFIGURED LOGGING. Measured the hard way: a filter
added at module import is silently discarded, because uvicorn applies its own
logging config during startup and rebuilds those loggers. `install()` is called
from the lifespan, which runs after that.
"""
from __future__ import annotations

import logging

ACCESS_LOGGER = "uvicorn.access"

# The one route whose query is member content rather than parameters.
REDACTED_QUERY_PATHS = frozenset({"/journal/share"})

# What replaces the query. Deliberately visible: an operator reading the log
# should see that something was removed on purpose, not an oddly bare URL.
REDACTION = "?<redacted>"

# uvicorn's access record positions the path+query third; see the module
# docstring for the call this mirrors.
_PATH_ARG = 2


class ShareQueryRedactionFilter(logging.Filter):
    """Rewrite the request target of a redacted path, in place, and never raise.

    A logging filter runs on the request path of every response, so it fails
    closed in the only way that matters: any unexpected record shape is passed
    through UNCHANGED rather than dropped. Losing access logs to a defensive
    bug here would be a worse outcome than the thing it guards.
    """

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        try:
            args = record.args
            if not isinstance(args, tuple) or len(args) <= _PATH_ARG:
                return True
            target = args[_PATH_ARG]
            if not isinstance(target, str) or "?" not in target:
                return True
            path = target.split("?", 1)[0]
            if path not in REDACTED_QUERY_PATHS:
                return True
            new = list(args)
            new[_PATH_ARG] = path + REDACTION
            record.args = tuple(new)
        except Exception:
            # Never let redaction break logging.
            pass
        return True


def install() -> bool:
    """Attach the filter to the access logger. Idempotent; returns whether it
    is now present (so a caller can log the fact rather than assume it)."""
    logger = logging.getLogger(ACCESS_LOGGER)
    for existing in logger.filters:
        if isinstance(existing, ShareQueryRedactionFilter):
            return True
    logger.addFilter(ShareQueryRedactionFilter())
    return True
