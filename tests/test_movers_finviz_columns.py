"""The movers screener must pin the columns it parses.

Sibling of the `avg_vol` hole found on 2026-08-09: `v=152` is Finviz's CUSTOM
view, so a request without `c=` receives whatever the Finviz Elite ACCOUNT's
saved layout happens to hold. Editing that layout in a browser silently changes
what this code is handed.

The failure here is quieter than a blank field. `_parse_pct` maps a missing
`Change` to 0.0, and the loop `break`s on the first row under 3% — so the
Movers sidebar goes empty while every request still returns 200 and 3,676 rows.

Rather than assert a literal list, the rail derives the required column NAMES
from the parser itself and checks each one is pinned. Retyping the list here
would put a second authority on it — the defect this repo keeps paying for.
"""
import re

from api.services import massive


# Finviz export column ids, verified live 2026-07-27 and re-verified 2026-08-09
# (request `c=1,2,66` -> header `Ticker,Company,Change`).
_ID_FOR_COLUMN = {"Ticker": "1", "Company": "2", "Change": "66"}


def _pinned_ids(url: str) -> list[str]:
    m = re.search(r"[?&]c=([0-9,]+)", url)
    return m.group(1).split(",") if m else []


def _captured_url(monkeypatch) -> str:
    seen = {}

    class _Resp:
        text = '"Ticker","Company","Change"\r\n"AAA","Alpha","0.10%"\r\n'

        def raise_for_status(self):
            return None

    def _fake_get(url, **kw):
        seen.setdefault("url", url)
        return _Resp()

    monkeypatch.setenv("FINVIZ_API_KEY", "test-token")
    monkeypatch.setattr(massive.httpx, "get", _fake_get)
    massive._fetch_finviz_movers_live()
    return seen["url"]


def test_every_column_the_parser_reads_is_pinned_in_the_request(monkeypatch):
    """Derived, not typed: whatever `_fetch_finviz_movers_live` reads out of a
    row must appear in the `c=` list, or the account's saved view is deciding
    whether this function works."""
    import inspect

    src = inspect.getsource(massive._fetch_finviz_movers_live)
    read_names = set(re.findall(r'row\.get\(\s*"([A-Za-z ]+)"', src))
    assert read_names, "found no row.get() column reads — the probe itself is broken"

    pinned = _pinned_ids(_captured_url(monkeypatch))
    assert pinned, "no c= column list in the export URL"

    for name in sorted(read_names):
        assert name in _ID_FOR_COLUMN, (
            f"parser reads a column this rail has no verified Finviz id for: {name!r}. "
            f"Verify the id against a live export and add it, do not guess."
        )
        assert _ID_FOR_COLUMN[name] in pinned, (
            f"column {name!r} (id {_ID_FOR_COLUMN[name]}) is parsed but NOT pinned; "
            f"pinned ids are {pinned}"
        )


def test_the_filter_and_sort_survive_alongside_the_column_list(monkeypatch):
    """Control — adding `c=` must not have displaced the liquidity filter or
    the sort order, which are what make the first row the biggest mover."""
    url = _captured_url(monkeypatch)
    assert "f=sh_price_o5,sh_avgvol_o300,sh_mktcap_smallover" in url
    assert "o=-change" in url
