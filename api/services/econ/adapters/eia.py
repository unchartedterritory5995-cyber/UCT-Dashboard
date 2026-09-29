"""EIA adapter -- weekly petroleum series (WPSR stocks, retail gasoline).

KEYED (``EIA_API_KEY`` set): EIA API v2, key in the query string (``api_key``;
``secrets.redact`` scrubs it from every URL/log/exception; it is never in a
``request_key``). Two documented request shapes
(https://www.eia.gov/opendata/documentation.php):

  * ``params.v2_route`` present (e.g. ``petroleum/stoc/wstk``) -> the data route
    ``/v2/<route>/data/?frequency=weekly&data[0]=value&facets[series][]=<CODE>
    &sort[0][column]=period&sort[0][direction]=desc&offset=&length=5000``,
    paged by ``offset`` against ``response.total`` (5,000-row cap per call).
  * otherwise the APIv1 compatibility route ``/v2/seriesid/<PET.CODE.W>``
    (one call; ``response.total`` greater than the rows returned is refused as
    PARTIAL rather than stored).

  403 ``API_KEY_MISSING``/``API_KEY_INVALID`` -> ``SourceUnavailable("key ...")``.

KEYLESS (no key; the path Phase 0 proved and this adapter verifies live):
the dnav "history" page ``https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx
?n=PET&s=<CODE>&f=W`` -- a static HTML table with the FULL history (crude
from 1982-08-20, gasoline from 1990-08-20), one row per Year-Month with up to
five (End Date MM/DD, Value) pairs, plus ``Release Date: M/D/YYYY`` and
``Next Release Date``. Chosen over ``hist_xls/<CODE>w.xls`` because the .xls is
BIFF (needs ``xlrd``, which is NOT in requirements.txt), and over
``ir.eia.gov/wpsr/table1.csv`` because that file is latest-weeks-only, crude
only (no gasoline price), in MILLION barrels with 3 decimals, and is served
via a 302 to a CloudFront SIGNED URL whose policy window starts at the release
time (its S3 Last-Modified, 09:37 ET, PRECEDES the 10:30 ET release -- unusable
as a publication time).
IDENTITY GUARD: the page must link ``../hist_xls/<CODE><f>.xls`` -- a page for
another series (or an error page) is MalformedPayload.

source_published_at (keyless): the dnav page has no validators (no-store) and
states the release DATE only, so the adapter sends a 1-byte ``Range`` GET for
``https://www.eia.gov/dnav/pet/hist_xls/<CODE><f>.xls`` (IIS, Accept-Ranges)
and uses its ``Last-Modified`` when that instant's ET date equals the page's
"Release Date" (observed: crude LM Wed 11:48 ET for the 10:30 WPSR; gasoline
LM Tue 09:26 ET) -- a conservative (late-side) release instant. Otherwise None
+ a warning. Keyed mode has no publication timestamp (None).

Period grammar (registry week_anchor): stocks = week ENDING Friday
(``FRI``: period_end = the Friday); retail gasoline = the Monday survey date
(``MON``: period_end = the survey Monday). ``period_start = period_end - 6``
for both (the validator's 7-day W grid); the observation DATE the agency
states is always ``period_end``. A date that is not on the anchor weekday is
MalformedPayload. NA markers ``--`` ``-`` ``NA`` ``W`` -> None (never 0).

``source.params`` read: ``series_id`` (``PET.<CODE>.<F>``; falls back to
``provider_series_id``), ``v2_route`` (optional), ``latest_n`` (optional,
default 8 = weeks returned in latest mode when no start is given).
"""
from __future__ import annotations

import email.utils
import html as _html
import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from .. import http as econ_http
from .. import timeutil
from ..model import EconError, MalformedPayload, RawObs, SourceUnavailable
from .base import BaseAdapter, as_specs, register

V2_BASE = "https://api.eia.gov/v2/"
LEAF_URL = "https://www.eia.gov/dnav/{n_lower}/hist/LeafHandler.ashx"
HIST_XLS_URL = "https://www.eia.gov/dnav/{n_lower}/hist_xls/{code}{f_lower}.xls"
V2_PAGE = 5000
NA_MARKERS = frozenset({"", "--", "-", "NA", "W", "NULL", "null", "(NA)"})
_WEEKDAY = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}
_FREQ = {"W": "weekly", "M": "monthly", "A": "annual", "D": "daily"}
_MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
_SID = re.compile(r"^([A-Z]+)\.([A-Z0-9_]+)\.([WDMA])$")


def _utcnow() -> datetime:          # monkeypatched in tests
    return datetime.now(timezone.utc)


def parse_series_id(spec) -> tuple[str, str, str]:
    sid = str(spec.params.get("series_id") or spec.provider_series_id or "").strip()
    m = _SID.match(sid)
    if not m:
        raise MalformedPayload(f"eia {spec.symbol}: series_id must look like PET.CODE.W")
    return m.group(1), m.group(2), m.group(3)


def _num(s) -> Optional[float]:
    if s is None:
        return None
    if isinstance(s, (int, float)) and not isinstance(s, bool):
        x = float(s)
    else:
        t = str(s).replace("\xa0", " ").strip()
        if t in NA_MARKERS:
            return None
        if not re.fullmatch(r"-?[\d,]*\.?\d+", t):
            raise MalformedPayload("eia: non-numeric value")
        x = float(t.replace(",", ""))
    if x != x or x in (float("inf"), float("-inf")):
        raise MalformedPayload("eia: non-finite value")
    return x


def _week(pe: date, anchor: str, symbol: str) -> tuple[str, str]:
    a = (anchor or "").upper()
    if a in _WEEKDAY and pe.weekday() != _WEEKDAY[a]:
        raise MalformedPayload(f"eia {symbol}: observation {pe} is not a {a}")
    return (pe - timedelta(days=6)).isoformat(), pe.isoformat()


# ─────────────────────────────── keyless: dnav leaf page ───────────────────


_TD = re.compile(r"<td[^>]*class\s*=\s*['\"]?(B\d)['\"]?[^>]*>(.*?)</td>", re.S | re.I)
_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_REL = re.compile(r"Release Date:\s*(\d{1,2})/(\d{1,2})/(\d{4})", re.I)
_NEXT = re.compile(r"Next Release Date:\s*(\d{1,2})/(\d{1,2})/(\d{4})", re.I)


def _cell(s: str) -> str:
    return _html.unescape(re.sub(r"<[^>]+>", "", s)).replace("\xa0", " ").strip()


def parse_leaf(text: str, *, symbol: str, code: str, freq: str, anchor: str):
    """-> (observations, release_date|None, next_release_date|None)."""
    if not text or "<tbody" not in text.lower():
        raise MalformedPayload(f"eia {symbol}: dnav page has no data table")
    xls = f"hist_xls/{code}{freq.lower()}.xls".lower()
    if xls not in text.lower():
        raise MalformedPayload(f"eia {symbol}: dnav page is not for series {code} (identity)")
    lo = text.lower()
    body = text[lo.index("<tbody"):lo.index("</tbody>") if "</tbody>" in lo else len(text)]
    out: dict[str, RawObs] = {}
    for tr in _TR.findall(body):
        cells = _TD.findall(tr)
        if not cells:
            continue                                  # spacer rows
        if cells[0][0].upper() != "B6":
            raise MalformedPayload(f"eia {symbol}: unexpected table layout")
        lab = _cell(cells[0][1])
        m = re.fullmatch(r"(\d{4})-([A-Za-z]{3})", lab)
        if not m or m.group(2).title() not in _MONTHS:
            raise MalformedPayload(f"eia {symbol}: bad Year-Month label")
        y, mon = int(m.group(1)), _MONTHS[m.group(2).title()]
        pairs = cells[1:]
        if len(pairs) % 2:
            raise MalformedPayload(f"eia {symbol}: odd date/value cell count")
        for (c1, d), (c2, v) in zip(pairs[0::2], pairs[1::2]):
            d, v = _cell(d), _cell(v)
            if not d:
                if v:
                    raise MalformedPayload(f"eia {symbol}: value without a date")
                continue
            dm = re.fullmatch(r"(\d{2})/(\d{2})", d)
            if not dm:
                raise MalformedPayload(f"eia {symbol}: bad End Date cell")
            mm, dd = int(dm.group(1)), int(dm.group(2))
            yy = y + (1 if (mon == 12 and mm == 1) else -1 if (mon == 1 and mm == 12) else 0)
            if abs(mm - mon) not in (0, 11):
                raise MalformedPayload(f"eia {symbol}: End Date outside its Year-Month row")
            try:
                pe = date(yy, mm, dd)
            except ValueError:
                raise MalformedPayload(f"eia {symbol}: impossible End Date") from None
            ps, pe_s = _week(pe, anchor, symbol)
            if pe_s in out:
                raise MalformedPayload(f"eia {symbol}: duplicate week {pe_s}")
            out[pe_s] = RawObs(symbol, ps, pe_s, _num(v))
    if not out:
        raise MalformedPayload(f"eia {symbol}: dnav table is empty")
    rel = _REL.search(text.replace("Next Release Date", "Next_Release_Date"))
    nxt = _NEXT.search(text)
    rd = date(int(rel.group(3)), int(rel.group(1)), int(rel.group(2))) if rel else None
    nd = date(int(nxt.group(3)), int(nxt.group(1)), int(nxt.group(2))) if nxt else None
    return [out[k] for k in sorted(out)], rd, nd


def _http_date(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        return None
    if dt is None or dt.tzinfo is None:
        return None
    return int(dt.timestamp())


# ─────────────────────────────── keyed: API v2 ─────────────────────────────


def _v2_doc(resp, symbol: str):
    if resp.status in (401, 403):
        code = ""
        try:
            code = str((resp.json() or {}).get("error", {}).get("code", ""))
        except (ValueError, AttributeError):
            pass
        raise SourceUnavailable(f"eia {symbol}: key rejected or missing ({code or resp.status})")
    soft = econ_http.soft_failure(resp)
    if soft:
        raise MalformedPayload(f"eia {symbol}: {soft}")
    resp.raise_for_status()
    body = (resp.content or b"").lstrip()
    if body[:1] == b"<":
        raise MalformedPayload(f"eia {symbol}: HTML instead of JSON")
    try:
        doc = json.loads(body)
    except ValueError:
        raise MalformedPayload(f"eia {symbol}: body is not JSON") from None
    if not isinstance(doc, dict):
        raise MalformedPayload(f"eia {symbol}: JSON is not an object")
    if "error" in doc and "response" not in doc:
        raise MalformedPayload(f"eia {symbol}: API error document")
    r = doc.get("response")
    if not isinstance(r, dict) or not isinstance(r.get("data"), list):
        raise MalformedPayload(f"eia {symbol}: missing response.data")
    try:
        total = int(r.get("total")) if r.get("total") is not None else None
    except (TypeError, ValueError):
        raise MalformedPayload(f"eia {symbol}: bad response.total") from None
    return r["data"], total


def parse_v2_rows(rows, *, symbol: str, code: str, anchor: str) -> list[RawObs]:
    out: dict[str, RawObs] = {}
    for r in rows:
        if not isinstance(r, dict):
            raise MalformedPayload(f"eia {symbol}: non-object row")
        sid = r.get("series") or r.get("series-id") or r.get("seriesId")
        if sid is not None:
            parts = str(sid).strip().split(".")
            if (parts[1] if len(parts) == 3 else parts[0]) != code:
                raise MalformedPayload(f"eia {symbol}: payload carries another series (identity)")
        try:
            pe = timeutil.as_date(str(r.get("period", "")).strip())
        except ValueError:
            raise MalformedPayload(f"eia {symbol}: malformed period") from None
        ps, pe_s = _week(pe, anchor, symbol)
        if pe_s in out:
            raise MalformedPayload(f"eia {symbol}: duplicate week {pe_s}")
        out[pe_s] = RawObs(symbol, ps, pe_s, _num(r.get("value")))
    return [out[k] for k in sorted(out)]


# ─────────────────────────────── adapter ──────────────────────────────────


@register
class EiaAdapter(BaseAdapter):
    name = "eia"
    key_env = "EIA_API_KEY"
    max_series_per_request = 1

    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None):
        if http is None:
            raise ValueError("eia.fetch needs an HttpClient")
        key = self.key()
        return [self._keyed(s, mode, start, end, http, key) if key
                else self._keyless(s, mode, start, end, http) for s in as_specs(specs)]

    @staticmethod
    def _window(obs, mode, start, end, latest_n):
        if start is not None:
            obs = [o for o in obs if o.period_end >= timeutil.iso(start)]
        if end is not None:
            obs = [o for o in obs if o.period_end <= timeutil.iso(end)]
        if mode == "latest" and start is None:
            obs = obs[-latest_n:]
        return obs

    def _keyless(self, spec, mode, start, end, http):
        n, code, f = parse_series_id(spec)
        latest_n = int(spec.params.get("latest_n", 8) or 8)
        resp = http.get(LEAF_URL.format(n_lower=n.lower()), params={"n": n, "s": code, "f": f})
        soft = econ_http.soft_failure(resp)
        if soft:
            raise MalformedPayload(f"eia {spec.symbol}: {soft}")
        resp.raise_for_status()
        obs, rel, nxt = parse_leaf(resp.text("utf-8"), symbol=spec.symbol, code=code, freq=f,
                                   anchor=spec.week_anchor)
        warnings: list[str] = []
        published = None
        if rel is not None:
            published = self._published_at(http, n, code, f, rel, warnings)
        else:
            warnings.append("dnav page states no Release Date")
        obs = self._window(obs, mode, start, end, latest_n)
        rk = f"eia:dnav:{n}.{code}.{f}:{mode}:{timeutil.iso(start) if start else ''}..{timeutil.iso(end) if end else ''}"
        return self.make_result(rk, obs, resp=resp, source_published_at=published, warnings=warnings)

    @staticmethod
    def _published_at(http, n, code, f, rel: date, warnings) -> Optional[int]:
        url = HIST_XLS_URL.format(n_lower=n.lower(), code=code, f_lower=f.lower())
        try:
            r = http.get(url, headers={"Range": "bytes=0-0"})
        except EconError:
            warnings.append("release-time probe unavailable")
            return None
        if r.status not in (200, 206):
            warnings.append(f"release-time probe HTTP {r.status}")
            return None
        ts = _http_date(r.headers.get("last-modified"))
        if ts is None:
            warnings.append("release-time probe has no Last-Modified")
            return None
        if timeutil.et_date(ts) != rel:
            warnings.append("hist_xls Last-Modified is not on the page's Release Date; not used")
            return None
        return ts

    def _keyed(self, spec, mode, start, end, http, key):
        n, code, f = parse_series_id(spec)
        latest_n = int(spec.params.get("latest_n", 8) or 8)
        route = str(spec.params.get("v2_route") or "").strip().strip("/")
        base_q = [("api_key", key)]
        if start is not None:
            base_q.append(("start", timeutil.iso(start)))
        if end is not None:
            base_q.append(("end", timeutil.iso(end)))
        rows: list = []
        raws: list[bytes] = []
        status = None
        if route:
            if not re.fullmatch(r"[a-z0-9_]+(/[a-z0-9_]+)*", route):
                raise MalformedPayload(f"eia {spec.symbol}: bad params.v2_route")
            url = f"{V2_BASE}{route}/data/"
            offset = 0
            want = latest_n if (mode == "latest" and start is None) else None
            while True:
                q = base_q + [("frequency", _FREQ[f]), ("data[0]", "value"),
                              ("facets[series][]", code), ("sort[0][column]", "period"),
                              ("sort[0][direction]", "desc"), ("offset", str(offset)),
                              ("length", str(want or V2_PAGE))]
                resp = http.get(url, params=q)
                status = resp.status
                data, total = _v2_doc(resp, spec.symbol)
                rows += data
                raws.append(resp.content or b"")
                offset += len(data)
                if want is not None or not data or total is None or offset >= total:
                    break
                if offset > 200_000:
                    raise MalformedPayload(f"eia {spec.symbol}: runaway paging")
            if want is None and total is not None and len(rows) != total:
                raise MalformedPayload(f"eia {spec.symbol}: partial ({len(rows)} of {total})")
            rk_route = route
        else:
            resp = http.get(f"{V2_BASE}seriesid/{n}.{code}.{f}", params=base_q)
            status = resp.status
            rows, total = _v2_doc(resp, spec.symbol)
            raws.append(resp.content or b"")
            if total is not None and total > len(rows):
                raise MalformedPayload(f"eia {spec.symbol}: partial ({len(rows)} of {total}); "
                                       "set params.v2_route for paged access")
            rk_route = "seriesid"
        obs = parse_v2_rows(rows, symbol=spec.symbol, code=code, anchor=spec.week_anchor)
        obs = self._window(obs, mode, start, end, latest_n)
        rk = f"eia:v2:{rk_route}:{n}.{code}.{f}:{mode}:{timeutil.iso(start) if start else ''}..{timeutil.iso(end) if end else ''}"
        return self.make_result(rk, obs, payload=b"\n".join(raws), http_status=status)
