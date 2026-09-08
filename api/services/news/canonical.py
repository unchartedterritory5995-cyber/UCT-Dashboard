"""URL canonicalization.

⚠️ BUG LESSON, encoded as code.

The Finnhub probe reported a 99.2% duplicate rate that was entirely an artifact
of a naive canonicalizer: it stripped ALL query strings, and Finnhub's URLs are
shaped `finnhub.io/api/news?id=<hash>` -- the article identity lives in the
query. Every article collapsed to one URL.

So the rule is NOT "strip the query". It is:

    remove KNOWN TRACKING parameters, keep everything else.

An unknown parameter is assumed to carry identity, because being wrong in that
direction costs us a duplicate row while being wrong the other way silently
merges unrelated articles.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Exact parameter names that are pure tracking.
_TRACKING_EXACT = frozenset({
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "utm_id", "utm_name", "utm_cid", "utm_reader", "utm_brand", "utm_social",
    "utm_social_type", "utm_pubreferrer", "utm_swu",
    "fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "twclid",
    "igshid", "mc_cid", "mc_eid", "yclid", "_hsenc", "_hsmi", "vero_id",
    "ref", "referrer", "referer", "source", "src", "cmpid", "cmp", "ncid",
    "partner", "sh", "guccounter", "guce_referrer", "guce_referrer_sig",
    "__source", "taid", "ftag", "smid", "smtyp", "at_medium", "at_campaign",
    "sref", "spm", "share_id", "campaign_id", "ito", "CMP", "cid",
})

# Prefixes that are always tracking regardless of suffix.
_TRACKING_PREFIX = ("utm_", "at_custom", "pk_", "piwik_", "matomo_", "hsa_")


def _is_tracking(key: str) -> bool:
    k = (key or "").strip()
    if not k:
        return True
    if k in _TRACKING_EXACT or k.lower() in _TRACKING_EXACT:
        return True
    kl = k.lower()
    return any(kl.startswith(p) for p in _TRACKING_PREFIX)


_AMP_SUFFIX = re.compile(r"(?:/amp|\.amp|/amp/)$", re.I)


def canonical_url(url: str | None) -> str:
    """A stable identity string for an article URL.

    - scheme/host lowercased, `www.` and default ports dropped
    - fragment dropped (never identity for a news article)
    - TRACKING query params dropped; every other param KEPT and sorted
    - trailing slash and a trailing /amp dropped
    Returns '' for falsy or unparseable input.
    """
    if not url:
        return ""
    raw = str(url).strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(raw if "//" in raw else f"//{raw}", scheme="https")
        host = (parts.hostname or "").lower()
        # ⚠️ `.port` PARSES on access and raises on junk — "javascript:alert(1)"
        # made urllib try to cast "alert(1)" to an int. Unhandled, that
        # exception escaped `ingest.process` and would abort the whole
        # ingestion batch because ONE provider row was malformed.
        port = parts.port
    except ValueError:
        return ""

    if not host:
        return ""
    if host.startswith("www."):
        host = host[4:]
    if port and port not in (80, 443):
        host = f"{host}:{port}"

    path = parts.path or ""
    path = _AMP_SUFFIX.sub("", path)
    if len(path) > 1:
        path = path.rstrip("/")

    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if not _is_tracking(k)]
    kept.sort()
    query = urlencode(kept)

    return urlunsplit(("", host, path, query, "")).lstrip("/") or host


# Only these ever reach an href. A provider is untrusted input: a row with
# `javascript:` or `data:` in its url field would otherwise be rendered as a
# clickable link in the feed.
_SAFE_SCHEMES = frozenset({"http", "https"})


def display_url(url: str | None) -> str:
    """The URL we actually send a reader to: tracking stripped, scheme checked.

    Returns '' for anything that is not plain http(s), so the UI simply omits
    the link rather than emitting an unsafe href.
    """
    if not url:
        return ""
    raw = str(url).strip()
    try:
        parts = urlsplit(raw)
    except ValueError:
        return ""
    if parts.scheme and parts.scheme.lower() not in _SAFE_SCHEMES:
        return ""
    if not parts.scheme or not parts.netloc:
        # A bare host like "reuters.com/a" is fine; anything with a colon in
        # the first segment is a scheme we did not allow.
        head = raw.split("/", 1)[0]
        return "" if ":" in head else raw
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if not _is_tracking(k)]
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(kept), ""))
