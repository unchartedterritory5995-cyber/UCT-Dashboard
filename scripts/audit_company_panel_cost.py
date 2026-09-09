"""Company Panel cost tracer.

Replays a real user journey against the live app and counts EVERY outbound
network call, classified by provider host. Static reading tells you what the
code intends; this tells you what it does.

    python scripts/audit_company_panel_cost.py

Read-only with respect to providers: it makes whatever calls the panel itself
would make, nothing more, and it never writes to a provider.
"""

from __future__ import annotations

import os
import sys
import time
from collections import Counter, defaultdict
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Providers we care about, matched on hostname substring.
PROVIDERS = [
    ("financialmodelingprep.com", "FMP"),
    ("finnhub.io", "Finnhub"),
    ("api.massive.com", "Massive/Polygon"),
    ("polygon.io", "Massive/Polygon"),
    ("sec.gov", "SEC EDGAR"),
    ("twitterapi.io", "TwitterAPI.io"),
    ("api.anthropic.com", "Anthropic LLM"),
    ("api.openai.com", "OpenAI LLM"),
    ("yahoo", "yfinance/Yahoo"),
    ("yfinance", "yfinance/Yahoo"),
    ("query1.finance", "yfinance/Yahoo"),
    ("query2.finance", "yfinance/Yahoo"),
]

CALLS: list[tuple[str, str, str]] = []       # (provider, host, path)
_phase = "setup"


def _classify(url: str) -> tuple[str, str, str]:
    try:
        p = urlsplit(str(url))
        host = (p.hostname or "?").lower()
        path = p.path or "/"
    except Exception:
        return f"OTHER:?", "?", str(url)[:60]
    if p.query:
        path = f"{path}?{p.query}"
    for frag, name in PROVIDERS:
        if frag in host:
            return name, host, path
    if host in ("testserver", "localhost", "127.0.0.1"):
        return "", host, path          # our own app, not a provider
    return f"OTHER:{host}", host, path


def _record(url: str) -> None:
    prov, host, path = _classify(url)
    if not prov:
        return                      # internal loopback
    CALLS.append((_phase, prov, f"{host}{path[:70]}"))


def install_probes() -> None:
    """Patch every outbound HTTP path the app can use."""
    import httpx
    import requests

    _hx_send = httpx.Client.send

    def hx_send(self, request, *a, **k):
        _record(str(request.url))
        return _hx_send(self, request, *a, **k)

    httpx.Client.send = hx_send

    _rq = requests.Session.request

    def rq(self, method, url, *a, **k):
        _record(url)
        return _rq(self, method, url, *a, **k)

    requests.Session.request = rq

    for fn in ("get", "post"):
        orig = getattr(requests, fn)

        def wrapper(url, *a, _o=orig, **k):
            _record(url)
            return _o(url, *a, **k)

        setattr(requests, fn, wrapper)

    # urllib (yfinance's fallback path on some versions)
    try:
        import urllib.request as ur
        _uo = ur.urlopen

        def uo(u, *a, **k):
            _record(getattr(u, "full_url", u))
            return _uo(u, *a, **k)

        ur.urlopen = uo
    except Exception:
        pass

    # Anthropic client — the LLM path is a background thread, so catch it at
    # the SDK boundary too in case the HTTP patch is installed on a different
    # client instance.
    try:
        import anthropic
        _mc = anthropic.resources.messages.Messages.create

        def mc(self, *a, **k):
            _record("https://api.anthropic.com/v1/messages")
            return _mc(self, *a, **k)

        anthropic.resources.messages.Messages.create = mc
    except Exception:
        pass

    # ── PROVIDER-FUNCTION probes ────────────────────────────────────────────
    # The HTTP probes above go quiet when a key is missing, because the client
    # short-circuits before the request. Hooking the client FUNCTIONS instead
    # counts the calls the panel would spend with keys present, which is what
    # the cost model needs — and makes the trace reproducible on a machine
    # without production credentials.
    def _wrap(mod, attr, label):
        try:
            orig = getattr(mod, attr)
        except Exception:
            return

        def w(*a, _o=orig, _l=label, _n=attr, **k):
            arg = str(a[0])[:60] if a else str(k)[:60]
            _record(f"https://{_l}/{_n}?{arg}")
            return _o(*a, **k)
        try:
            setattr(mod, attr, w)
        except Exception:
            pass

    try:
        from api.services import fmp_client
        _wrap(fmp_client, "_fetch", "financialmodelingprep.com")
    except Exception:
        pass
    try:
        from api.services import finnhub_client
        _wrap(finnhub_client, "fh_get", "finnhub.io")
    except Exception:
        pass
    try:
        from api.services import sec_filings
        _wrap(sec_filings, "recent_filings", "sec.gov")
    except Exception:
        pass
    try:
        from api.services import yfinance_pool
        for a in ("download", "fetch", "history", "get_info", "ticker_info"):
            if hasattr(yfinance_pool, a):
                _wrap(yfinance_pool, a, "query1.finance.yahoo.com")
    except Exception:
        pass


def phase(name: str) -> None:
    global _phase
    _phase = name


def main() -> int:
    install_probes()

    from fastapi.testclient import TestClient
    import api.main as m

    app = m.app

    # Bypass auth: we are measuring provider calls, not authorization.
    paid = {"email": "audit@local", "plan": "pro", "is_paid": True,
            "id": 1, "user_id": 1, "plan_status": "active", "role": "admin"}
    overridden = 0
    for route in app.routes:
        dep = getattr(route, "dependant", None)
        if not dep:
            continue
        for sub in getattr(dep, "dependencies", []):
            call = getattr(sub, "call", None)
            if call and "user" in getattr(call, "__name__", "").lower():
                app.dependency_overrides[call] = lambda: paid
                overridden += 1
    # Also override the well-known entry points by name.
    for modname, attr in [("api.routers.fundamentals", "require_paid"),
                          ("api.deps", "get_current_user_with_plan"),
                          ("api.routers.stock_brief", "require_paid")]:
        try:
            mod = __import__(modname, fromlist=[attr])
            fn = getattr(mod, attr, None)
            if fn:
                app.dependency_overrides[fn] = lambda: paid
        except Exception:
            pass
    try:
        from api.services.auth_utils import get_current_user_with_plan as g
        app.dependency_overrides[g] = lambda: paid
    except Exception:
        pass

    client = TestClient(app)

    JOURNEY = [
        ("1. open AAPL overview", [
            "/api/stock-brief/AAPL", "/api/fundamentals/AAPL",
            "/api/fundamentals-full/AAPL", "/api/earnings-intel/AAPL"]),
        ("2. financials tab", [
            "/api/fundamentals-statements/AAPL?period=quarter",
            "/api/filings/AAPL"]),
        ("3. earnings tab", ["/api/earnings-intel/AAPL"]),
        ("4. ownership tab", [
            "/api/research/ownership/AAPL", "/api/fundamentals-full/AAPL"]),
        ("5. news tab", ["/api/company-news/AAPL?limit=25"]),
        ("6. news search", ["/api/company-news/AAPL?limit=25&q=iphone"]),
        ("7. news load more", ["/api/company-news/AAPL?limit=25&cursor=" ]),
        ("8. switch to MU (all tabs)", [
            "/api/stock-brief/MU", "/api/fundamentals/MU",
            "/api/fundamentals-full/MU", "/api/earnings-intel/MU",
            "/api/fundamentals-statements/MU?period=quarter",
            "/api/research/ownership/MU", "/api/company-news/MU?limit=25"]),
        ("9. switch BACK to AAPL (all tabs)", [
            "/api/stock-brief/AAPL", "/api/fundamentals/AAPL",
            "/api/fundamentals-full/AAPL", "/api/earnings-intel/AAPL",
            "/api/fundamentals-statements/AAPL?period=quarter",
            "/api/research/ownership/AAPL", "/api/company-news/AAPL?limit=25"]),
        ("10. close + reopen panel (AAPL)", [
            "/api/fundamentals-full/AAPL", "/api/earnings-intel/AAPL",
            "/api/company-news/AAPL?limit=25"]),
    ]

    print("=" * 78)
    print("COMPANY PANEL — LIVE REQUEST TRACE")
    print("=" * 78)
    print(f"auth dependencies overridden: {overridden}\n")

    # A real cursor for the pagination step.
    try:
        r0 = client.get("/api/company-news/AAPL?limit=5")
        cur = (r0.json() or {}).get("next_cursor") or ""
    except Exception:
        cur = ""
    CALLS.clear()

    per_phase: dict[str, Counter] = {}
    for label, urls in JOURNEY:
        phase(label)
        before = len(CALLS)
        for u in urls:
            if u.endswith("cursor="):
                u = u + cur
            t0 = time.time()
            try:
                resp = client.get(u)
                status = resp.status_code
            except Exception as e:
                status = f"ERR {type(e).__name__}"
            ms = (time.time() - t0) * 1000
            print(f"  {label:34s} {status}  {ms:7.0f}ms  {u[:52]}")
        time.sleep(1.2)          # let any background LLM thread start
        c = Counter(p for ph, p, _ in CALLS[before:] if ph == label)
        per_phase[label] = c
        if c:
            print(f"     -> PROVIDER CALLS: {dict(c)}")
        else:
            print("     -> PROVIDER CALLS: none")
        print()

    print("=" * 78)
    print("PROVIDER CALLS BY PHASE")
    print("=" * 78)
    print(f"  {'PHASE':36s} {'CALLS':>6s}  breakdown")
    for label, c in per_phase.items():
        print(f"  {label:36s} {sum(c.values()):6d}  {dict(c) or '-'}")

    print()
    print("=" * 78)
    print("TOTAL BY PROVIDER (whole journey, cold cache)")
    print("=" * 78)
    tot = Counter(p for _, p, _ in CALLS)
    for p, n in tot.most_common():
        print(f"  {p:26s} {n:5d}")
    print(f"  {'TOTAL':26s} {sum(tot.values()):5d}")

    # ---- cache-sharing proof -------------------------------------------
    print()
    print("=" * 78)
    print("CACHE SHARING — 100 repeat requests per endpoint (same symbol)")
    print("=" * 78)
    for name, url in [
        ("MU Overview   /api/fundamentals-full", "/api/fundamentals-full/MU"),
        ("MU Earnings   /api/earnings-intel", "/api/earnings-intel/MU"),
        ("MU Ownership  /api/research/ownership", "/api/research/ownership/MU"),
        ("MU News       /api/company-news", "/api/company-news/MU?limit=25"),
        ("MU News srch  /api/company-news?q=", "/api/company-news/MU?limit=25&q=hbm"),
    ]:
        phase(f"warm:{name}")
        client.get(url)                       # warm
        base = len(CALLS)
        t0 = time.time()
        for _ in range(100):
            client.get(url)
        ms = (time.time() - t0) * 1000
        new = Counter(p for ph, p, _ in CALLS[base:])
        verdict = "SHARED (0 provider calls)" if not new else f"LEAKS {dict(new)}"
        print(f"  {name:38s} 100 reqs in {ms:7.0f}ms  -> {verdict}")

    print()
    print("=" * 78)
    print("DISTINCT ENDPOINTS TOUCHED")
    print("=" * 78)
    by_prov: dict[str, Counter] = defaultdict(Counter)
    for ph, p, ep in CALLS:
        by_prov[p][ep] += 1
    for p in sorted(by_prov):
        print(f"  {p}")
        for ep, n in by_prov[p].most_common(14):
            flag = "   <-- DUPLICATED" if n > 2 else ""
            print(f"      x{n:<3d} {ep[:78]}{flag}")

    print()
    print("=" * 78)
    print("PER-SYMBOL COLD COST (phase 8 = a symbol never seen before)")
    print("=" * 78)
    c8 = per_phase.get("8. switch to MU (all tabs)", Counter())
    for prov, n in c8.most_common():
        print(f"  {prov:26s} {n:4d} calls for one new symbol, all tabs")
    print(f"  {'TOTAL':26s} {sum(c8.values()):4d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
