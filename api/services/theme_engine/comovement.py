"""60-day daily-close correlation vs an equal-weight theme basket. Bars come from
the LOCAL bars cache ONLY (api.services.bars_sqlite.get_bars) — never a network
fetch; cold bars => None (callers must treat None as 'no signal', not low)."""
import math


def _closes(sym_hy, n=60):
    """Last n+1 daily closes, oldest-first, from the local SQLite bars cache.
    bars_sqlite.get_bars(ticker, tf, max_bars) returns (ts,o,h,l,c,v) tuples
    oldest-first (cache-read-only — it never fetches). <30 closes => None."""
    try:
        from api.services import bars_sqlite
        rows = bars_sqlite.get_bars(sym_hy, "D", n + 1) or []
        closes = [r[4] for r in rows if r[4]]
        return closes if len(closes) >= 30 else None
    except Exception:
        return None


def _rets(closes):
    return [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]


def corr60(sym_hy, basket_hy):
    """Pearson corr of sym's daily returns vs the equal-weight mean return of the
    basket (sym excluded). None when sym or >all-but-2 of the basket are cold."""
    a = _closes(sym_hy)
    if not a:
        return None
    baskets = [c for c in (_closes(b) for b in basket_hy if b != sym_hy) if c]
    if len(baskets) < 3:
        return None
    n = min(len(a), *(len(b) for b in baskets))
    ra = _rets(a[-n:])
    basket_rets = [_rets(b[-n:]) for b in baskets]
    rb = [sum(r[i] for r in basket_rets) / len(basket_rets) for i in range(n - 1)]
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = math.sqrt(sum((x - ma) ** 2 for x in ra))
    vb = math.sqrt(sum((y - mb) ** 2 for y in rb))
    return cov / (va * vb) if va and vb else None
