"""TERM-072 -- answer the D1 adapter's transport with a legacy-shaped FMP fake.

Before TERM-072 these modules reached FMP through `earnings_estimates._fmp_get`,
and their tests stubbed that one name with a fake shaped like it:

    fake(path, params, timeout=...) -> the parsed JSON body, or None

The modules now call `fmp_client` typed functions, every one of which goes
through `fmp_client._get_raw(path, params, timeout)`. `route_fmp` patches THAT
seam with the same fake, so each test keeps its fixture, its path assertions and
its expected output unchanged -- only the patch target moved:

  * a body               -> served as the vendor's 200 answer (the typed
                            function applies its own not-found predicate, and
                            `body_or_none` hands `[]` back exactly as before);
  * None                 -> FMP did not answer: raised as a transient error,
                            which `body_or_none` turns back into None;
  * an exception raised  -> propagates to the typed function, then `body_or_none`
                            degrades it to None, as the legacy helper did.

It returns the list of (path, params, timeout) the adapter asked for.
"""
from __future__ import annotations


def route_fmp(monkeypatch, fake):
    from api.services import fmp_client as fc

    calls: list[tuple[str, dict, object]] = []

    def _raw(path, params, timeout=None):
        calls.append((path, dict(params), timeout))
        body = fake(path, dict(params), timeout=timeout)
        if body is None:
            raise fc.FMPTransient(f"stub: FMP did not answer {path}", vendor="fmp")
        return body

    monkeypatch.setattr(fc, "_get_raw", _raw)
    return calls
