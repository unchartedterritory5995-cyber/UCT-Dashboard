"""NAAIM Exposure Index — read on the SERVER from public discussion, as the PC collector does.

⭐ WHY (2026-10-10, owner): stop relying on the PC. NAAIM paywalled the live index on
2026-08-01 (its free feed lags ~3 months) and the owner ACCEPTED the "chatter" route on
2026-08-08: the weekly number is posted by subscribers and member firms, and a
conservative reader recovers it. This is uct-intelligence `scripts/naaim_chatter.py`
(origin/master 2026-10-10) ported unchanged in its rules — the keys it needs
(`TWITTERAPI_IO_API_KEY`, `PERPLEXITY_API_KEY`) are already on the web pod:

  * a number counts only ANCHORED to a NAAIM / "exposure index" mention, with DECIMALS
    (people round, and a rounded integer outvotes the true value)
  * last week's reading is excluded (posts quote it as "down from X")
  * >= 2 independent accounts agree, or one trusted account, or one account plus an
    independent web read (Perplexity) — and a web read that CONTRADICTS the crowd blocks
  * a tie, or nothing, returns None: a wrong sentiment number is worse than a missing one

`fill()` then does what the collector's push does with the reading: the canonical series
(`market_indicators.naaim_store.ingest`, dated by the survey Wednesday) and the newest
stored breadth row(s) still carrying an older survey.
"""
from __future__ import annotations

import logging
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

_log = logging.getLogger("breadth_naaim")

SEARCH = "https://api.twitterapi.io/twitter/tweet/advanced_search"
MIN_ACCOUNTS = 2
NAAIM_MIN, NAAIM_MAX = 0.0, 250.0
TRUSTED = {"isabelnet_sa", "neilsethinew", "investescape7", "naaim_official"}

_ANCHOR = r"(?:naaim|exposure\s*index)"
_NUM = r"(\d{1,3}\.\d{1,2})"
_PATTERNS = [
    re.compile(_ANCHOR + r"[^0-9\n]{0,120}?" + _NUM, re.I),
    re.compile(_NUM + r"[^0-9\n]{0,40}?" + _ANCHOR, re.I),
]
_PRIOR_CUE = re.compile(r"\b(?:from|vs\.?|versus|prior|previous|last\s+week)\b\s*$", re.I)
_STRIP = [
    re.compile(r"https?://\S+"),
    re.compile(r"\$\d[\d,\.]*"),
    re.compile(r"\b(?:19|20)\d{2}\b"),
    re.compile(r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b"),
    re.compile(r"@\w+"),
]


def _clean(text: str) -> str:
    for rx in _STRIP:
        text = rx.sub(" ", text)
    return text


def extract(text: str, prior: Optional[float] = None) -> set:
    """Candidate readings anchored to a NAAIM mention (empty set if none)."""
    t = _clean(text or "")
    if not re.search(_ANCHOR, t, re.I):
        return set()
    out = set()
    for rx in _PATTERNS:
        for m in rx.finditer(t):
            try:
                v = round(float(m.group(1)), 2)
            except (TypeError, ValueError):
                continue
            if not (NAAIM_MIN <= v <= NAAIM_MAX):
                continue
            if prior is not None and abs(v - prior) < 0.051:
                continue
            if _PRIOR_CUE.search(t[:m.start(1)]):
                continue
            out.add(v)
    return out


def _precision(v: float) -> int:
    s = f"{v:.2f}".rstrip("0")
    return len(s.split(".")[1]) if "." in s else 0


def consensus(tweets: list, min_accounts: int = MIN_ACCOUNTS, prior: Optional[float] = None,
              web: Optional[float] = None) -> tuple:
    """(value, supporters, note) or (None, [], reason)."""
    by_value = defaultdict(set)
    for t in tweets:
        handle = ((t.get("author") or {}).get("userName") or "?").lower()
        for v in extract(t.get("text", ""), prior=prior):
            by_value[v].add(handle)
    if not by_value:
        return None, [], "no anchored candidates"
    merged: dict = {}
    for v in sorted(by_value, key=lambda x: -_precision(x)):
        for kept in merged:
            if abs(kept - v) < 0.051:
                merged[kept] |= by_value[v]
                break
        else:
            merged[v] = set(by_value[v])
    ranked = sorted(merged.items(), key=lambda kv: (len(kv[1]), len(kv[1] & TRUSTED)),
                    reverse=True)
    value, accounts = ranked[0]
    if web is not None and abs(web - value) >= 0.051:
        return None, [], f"web says {web}, crowd says {value} — refusing to pick"
    if len(accounts) >= min_accounts:
        note = f"{len(accounts)} accounts agree"
    elif accounts & TRUSTED:
        note = f"single trusted source (@{sorted(accounts & TRUSTED)[0]})"
    elif web is not None:
        note = f"1 account + independent web confirmation ({web})"
    else:
        return None, [], f"best candidate {value} had only {len(accounts)} untrusted source(s)"
    if len(ranked) > 1 and len(ranked[1][1]) == len(accounts):
        return None, [], f"tie between {value} and {ranked[1][0]}"
    return value, sorted(accounts), note


def web_confirm(survey_week: str, post: Optional[Callable] = None) -> Optional[float]:
    key = os.environ.get("PERPLEXITY_API_KEY")
    if not key:
        return None
    q = (f"What was the NAAIM Exposure Index reading for the survey week of {survey_week}? "
         "Reply with ONLY the number to two decimals, nothing else. If you are not certain "
         "of that specific week, reply UNKNOWN.")
    try:
        if post is None:
            import requests
            post = requests.post
        r = post("https://api.perplexity.ai/chat/completions",
                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                 json={"model": "sonar-pro", "temperature": 0.0,
                       "messages": [{"role": "user", "content": q}]}, timeout=60)
        if getattr(r, "status_code", 0) != 200:
            return None
        txt = r.json()["choices"][0]["message"]["content"].strip()
        if "unknown" in txt.lower():
            return None
        m = re.search(r"\b(\d{1,3}\.\d{1,2})\b", txt)
        if not m:
            return None
        v = round(float(m.group(1)), 2)
        return v if NAAIM_MIN <= v <= NAAIM_MAX else None
    except Exception:
        return None


def fetch_week(survey_wed: str, pages: int = 5, get: Optional[Callable] = None) -> list:
    """Every tweet mentioning NAAIM from the day after a survey Wednesday, capped at +7
    days (a wider window swept in the NEXT survey's posts and answered wrong)."""
    key = os.environ.get("TWITTERAPI_IO_API_KEY")
    if not key:
        return []
    if get is None:
        import requests
        get = requests.get
    wed = datetime.strptime(survey_wed, "%Y-%m-%d")
    since = (wed + timedelta(days=1)).strftime("%Y-%m-%d_00:00:00_UTC")
    until = (wed + timedelta(days=7)).strftime("%Y-%m-%d_00:00:00_UTC")
    seen, out = set(), []
    for term in ("NAAIM", '"exposure index"'):
        cursor = None
        for _ in range(pages):
            params = {"query": f"{term} since:{since} until:{until}", "queryType": "Latest"}
            if cursor:
                params["cursor"] = cursor
            try:
                r = get(SEARCH, headers={"x-api-key": key}, params=params, timeout=30)
            except Exception:
                break
            if getattr(r, "status_code", 0) != 200:
                break
            p = r.json()
            for t in p.get("tweets", []):
                tid = t.get("id")
                if tid and tid in seen:
                    continue
                if tid:
                    seen.add(tid)
                out.append(t)
            cursor = p.get("next_cursor")
            if not p.get("has_next_page") or not cursor:
                break
    return out


def latest_survey_wednesday(today: Optional[date] = None) -> str:
    d = today or datetime.now(timezone.utc).date()
    return (d - timedelta(days=(d.weekday() - 2) % 7)).isoformat()


def prior_reading() -> Optional[tuple]:
    """(value, survey_wednesday) of the newest reading in the canonical series."""
    try:
        from api.services.market_indicators import naaim_store
        obs = naaim_store.observations() or []
    except Exception:
        return None
    best = None
    for o in obs:
        d = str(o.get("observed_on") or o.get("date") or o.get("t") or "")[:10]
        v = o.get("value", o.get("v"))
        if d and v is not None and (best is None or d > best[1]):
            best = (float(v), d)
    return best


def latest_reading(week: Optional[str] = None, prior: Optional[float] = None,
                   look_back_weeks: int = 2, fetch: Callable = fetch_week,
                   web: Callable = web_confirm) -> Optional[tuple]:
    """(value, survey_wednesday) from chatter, walking back from the newest survey."""
    start = week or latest_survey_wednesday()
    for i in range(look_back_weeks + 1):
        wk = (datetime.strptime(start, "%Y-%m-%d") - timedelta(weeks=i)).strftime("%Y-%m-%d")
        tweets = fetch(wk)
        if not tweets:
            continue
        wk_prior = prior if (prior is None or i == 0) else None
        value, accounts, note = consensus(tweets, prior=wk_prior)
        if value is None:
            value, accounts, note = consensus(tweets, prior=wk_prior, web=web(wk))
        if value is None:
            continue
        _log.info("[naaim] %s for survey %s — %s (%s)", value, wk, note,
                  ", ".join("@" + a for a in accounts[:4]))
        return value, wk
    return None


_DONE: dict = {}


def fill(sessions: int = 10, reading: Optional[tuple] = None) -> dict:
    """Find the newest reading (at most one chatter search per survey week) and record
    it: the canonical series, then every recent stored row dated on/after the survey's
    publication Thursday whose own reading is absent or from an older survey."""
    from api.services import breadth_monitor as bm
    from api.services.market_indicators import naaim_store
    prior = prior_reading()
    if reading is None:
        wk_now = latest_survey_wednesday()
        if prior and prior[1] >= wk_now:
            reading = prior                                  # this week is already known
        elif _DONE.get(wk_now) and (datetime.now(timezone.utc).timestamp()
                                    - _DONE[wk_now] < 6 * 3600):
            return {"ok": True, "status": "searched recently", "week": wk_now}
        else:
            _DONE[wk_now] = datetime.now(timezone.utc).timestamp()
            reading = latest_reading(prior=prior[0] if prior else None)
    if not reading:
        return {"ok": False, "status": "no reading"}
    value, wk = reading
    ing = naaim_store.ingest(value, observed_on=wk, source=naaim_store.SOURCE_COLLECTOR)
    publish = (date.fromisoformat(wk) + timedelta(days=1)).isoformat()
    fixed, failed = [], []
    for r in bm.get_history(sessions) or []:
        d = r.get("date")
        if not d or d < publish:
            continue
        have = str(r.get("naaim_date") or "")[:10]
        if r.get("naaim") is not None and have >= wk:
            continue
        (fixed if bm.patch_fields(d, {"naaim": value, "naaim_date": wk}) else failed).append(d)
    out = {"ok": not failed, "value": value, "survey": wk,
           "series": ing.get("accepted"), "fixed": sorted(fixed), "failed": failed}
    _log.info("[naaim] %s", out)
    return out
