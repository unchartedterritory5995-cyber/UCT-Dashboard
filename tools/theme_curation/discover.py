"""Stage 2 candidate discovery via Perplexity (list-mode)."""
import re

from api.services.perplexity_search import web_search
from tools.theme_curation import loaders

_LIST_SYSTEM = (
    "You are a financial data extractor. Output ONLY lines of the form "
    "'TICKER — one-line reason', one per line, no prose, no markdown, no preamble. "
    "TICKER is the US-listed exchange symbol. Do not invent tickers."
)
_LINE_RE = re.compile(r"^\s*\$?([A-Za-z][A-Za-z.\-]{0,5})\s+[—\-]\s+", re.M)


def extract_tickers(text: str) -> list:
    out, seen = [], set()
    for m in _LINE_RE.finditer(text or ""):
        s = loaders.norm(m.group(1))
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _one(theme_name: str, run_id: str, salt_suffix: str) -> dict:
    res = web_search(
        f"List the leading US-listed public companies materially exposed to "
        f"the {theme_name} theme right now.",
        max_tokens=1500, system=_LIST_SYSTEM, mode="fast",
        domain_pack="finance", cache_salt=f"{run_id}{salt_suffix}")
    return {"tickers": extract_tickers(res.get("answer", "")),
            "error": res.get("error")}


def discover(theme_name: str, run_id: str, confirm: bool = False) -> dict:
    a = _one(theme_name, run_id, "")
    if a["error"] or not confirm:
        return a
    b = _one(theme_name, run_id, "::confirm")
    if b["error"]:
        return {"tickers": [], "error": b["error"]}
    bset = set(b["tickers"])
    return {"tickers": [t for t in a["tickers"] if t in bset], "error": None}
