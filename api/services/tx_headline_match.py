"""Which stocks a TradeXchange headline is about.

TX writes most company news as "TICKER(S) - headline", but a third of the feed
is not that tidy: "GME: NOV Weekly 24 CALL…", "BA -- Expecting…", "MRNA lows",
"AMDpartners with GOOGL", "ROBINHOOD TO INTEGRATE…", "… with Snowflake (SNOW)".

Two strengths of evidence, kept apart on purpose:

* `prefix` - the headline STARTS with tickers and a separator (- -- : – — |).
  That is TX's own tagging; it is trusted as-is, small caps included.
* `candidates` - a ticker seen anywhere else: `$AMD`, `(SNOW)`, a bare leading
  ticker ("MRNA lows"), one glued to a word ("AMDpartners"), or a standalone
  capitalised word in a normal-case headline. These are GUESSES: a caller must
  confirm them against a real universe (the recap: a Massive lookup; /news:
  the one ticker the member asked for) before treating them as a tag.

Company names ("ROBINHOOD", "Netflix") are matched with `name_keys` + `find_names`.

⛔ The same file lives in two repos: tx-recap/tx_match.py and
uct-dashboard api/services/tx_headline_match.py. Change both together; each
repo's tests pin the same cases.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Capitalised tokens that are words or acronyms, not tickers, in this feed.
STOP = frozenset("""
A I AI AM PM ET EST EDT PT US USA UK EU UAE UN UTC ID IT ON OR SO TO BY AT AS IF OF IN IS BE DO GO NO UP OK
CEO CFO COO CTO CIO EVP SVP VP CHAIR BOARD EPS EBIT EBITDA FCF FFO AFFO NII NIM GAAP ADJ REV EST ESTS
Q1 Q2 Q3 Q4 H1 H2 FY FQ1 FQ2 FQ3 FQ4 YOY QOQ MOM YTD TTM LTM BPS PCT AH PRE POST RTH ATH ATL
IPO SPAC ETF ETFS ADR ADRS ADS NAV OTC NYSE NASDAQ AMEX CBOE CME SEC FTC DOJ FDA EPA FAA FCC FERC
CFPB IRS DOD DOE DHS NHTSA NIH CDC WHO IMF ECB BOJ BOE PBOC RBA RBI FED FOMC OPEC GDP CPI PPI PCE PMI
ISM JOLTS NFP ADP API EIA LNG WTI USD EUR JPY GBP CNY CAD AUD CHF HKD BTC ETH M&A LBO PE VC PIPE
AWS OCI GPU CPU TPU HBM DRAM NAND SSD AI/ML ML LLM EV EVS SUV RV HVAC SAAS IOT AR VR XR OEM ODM
CDS BDC REIT MLP LP LLC INC CORP CO LTD PLC SA NV AG SE ADV TV PC PCS UPS FX DC NY NYC LA SF DC
NEW NOW ALL ARE CAN HAS HAD WAS WILL MAY NOT BUT AND THE FOR WITH FROM INTO OVER UNDER OUT OFF
SAYS SAID SEES SEE TOLD NEWS ALERT ALERTS UPDATE UPDATES FLASH BREAKING WATCH RUMOR REPORT REPORTS
SOURCE SOURCES OPTIONS CALL CALLS PUT PUTS OFFER BID ACTUAL EXPECTING EXPECTED PRIOR VS RE LOW LOWS
HIGH HIGHS OPEN CLOSE DEAL DEALS BUY SELL HOLD RAISE RAISES CUT CUTS BEAT MISS GUIDE TOP KEY BIG
JAN FEB MAR APR JUN JUL AUG SEP SEPT OCT NOV DEC MON TUE WED THU FRI SAT SUN WEEK DAY YEAR
NYT WSJ FT BBG BLOOMBERG REUTERS RTRS DJ DJN AP AFP CNBC CNN FOX WAPO AXIOS SEMAFOR BARRONS MW SCMP NIKKEI
STAT TC POLITICO INFO SM CIRC MOC MOO SALE IMBALANCE FORM OWNER OTHER DIRECTOR OFFICER ADJUSTED BEATS MISSES
ESTIMATE ESTIMATES PRESIDENT DONALD TRUMP WI BTC DRAWS LIVE VOL POP PREMARKET FY2025 FY2026 FY2027
""".split())

#: Leading words that are never TX's ticker tag ("FED: holds", "WATCH: …", "API: draw").
PREFIX_STOP = frozenset("""
UPDATE ALERT ALERTS FLASH WATCH NEWS RUMOR SOURCE SOURCES OPTIONS ACTUAL REPORT US USA FED ECB BOJ BOE
PBOC FOMC OPEC CPI PPI GDP PMI ISM EIA API NFP ADP JOLTS PCE SEC FDA DOJ FTC EU UK CHINA JAPAN
""".split())

_TOK = r"[A-Z][A-Z0-9]{0,5}(?:\.[A-Z]{1,2})?"
_TOKS = rf"(?:{_TOK}[\s,/&]+){{0,6}}{_TOK}"
# TX's own tag: "ETN - …", "AEMC AKEMF V7F - …", "BA -- …", "AMD/NVDA – …". The dash needs a
# space before it, so "VISA SAYS CROSS-BORDER" is not split on the hyphen.
_PREFIX = re.compile(rf"^({_TOKS})(?:\s+-{{1,2}}|\s*--|\s*[–—])\s*(.+)$")
# Weaker leads, confirmed by the caller: "GME: …" ("TRUMP: …" is not a ticker), and tickers
# straight into the sentence: "STX EPS of …", "INTC ORCL Intel and Oracle …", "HOOD down ah".
_COLON = re.compile(rf"^({_TOKS})\s*[:|]\s*(.+)$")
_LEAD = re.compile(rf"^({_TOKS})\s+(?=[A-Z]?[a-z]|EPS\b|FFO\b|AFFO\b|Q[1-4]\b)")
_DOLLAR = re.compile(r"\$([A-Z]{1,5}(?:\.[A-Z])?)\b")                       # "$AMD"
_PAREN = re.compile(r"\(([A-Z]{1,5}(?:\.[A-Z])?)\)")                        # "(SNOW)"
_GLUED = re.compile(r"(?<![A-Za-z0-9])([A-Z]{2,6})([a-z]{3,})")            # "AMDpartners"
# Earnings lines TX runs together: "…Revenue BeatEGBN EPS of…", "…MissedMCRI EPS…"
_GLUED_AFTER = re.compile(r"(?<=[a-z])([A-Z]{2,5})(?=\s+(?:EPS|FFO|AFFO|Q[1-4]|Revenue)\b)")
_WORD = re.compile(r"(?<![A-Za-z0-9$.])([A-Z][A-Z0-9]{1,5}(?:\.[A-Z])?)(?![A-Za-z0-9])")


@dataclass
class Parsed:
    prefix: list[str] = field(default_factory=list)
    body: str = ""
    candidates: list[str] = field(default_factory=list)
    #: "AMDPartners" could be AMD+"Partners" or AMDP+"artners": the shorter guess, mapped to the
    #: longer one it is only to be used without ("LPLAreported" is LPLA, never LPL).
    fallback: dict[str, str] = field(default_factory=dict)


def is_shouting(text: str) -> bool:
    """Mostly upper case ("FED SAYS FOMC MEETING BEGAN") - its words are not ticker evidence."""
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(c.islower() for c in letters) < 0.3 * len(letters)


def _add(out: list[str], t: str, skip=(), *, explicit: bool = False) -> None:
    """`explicit` ($NOW, (NOW)) is written as a ticker, so the word list does not apply."""
    if (explicit or t not in STOP) and t not in skip and t not in out:
        out.append(t)


def _toks(group: str) -> list[str]:
    return [t for t in dict.fromkeys(re.split(r"[\s,/&]+", group)) if t]


def parse(text: str) -> Parsed:
    text = text.strip()
    p = Parsed(body=text)
    m = _PREFIX.match(text)
    if m:
        p.prefix = [t for t in _toks(m.group(1)) if t not in PREFIX_STOP]
        if p.prefix:
            p.body = m.group(2).strip()
    if not p.prefix:
        c = _COLON.match(text)
        if c and (lead := [t for t in _toks(c.group(1)) if t not in PREFIX_STOP]):
            p.candidates.extend(lead)
            p.body = c.group(2).strip()
        else:
            ld = _LEAD.match(text)
            if ld:
                for t in _toks(ld.group(1)):
                    if len(t) >= 3 or len(_toks(ld.group(1))) > 1:
                        _add(p.candidates, t)
    for t in _DOLLAR.findall(text) + _PAREN.findall(text):
        _add(p.candidates, t, p.prefix, explicit=True)
    for t in _GLUED_AFTER.findall(text):
        _add(p.candidates, t, p.prefix)
    for run, _rest in _GLUED.findall(p.body):
        _add(p.candidates, run, p.prefix)
        if len(run) >= 3 and run[:-1] not in STOP and run[:-1] not in p.prefix and run[:-1] not in p.candidates:
            p.candidates.append(run[:-1])
            p.fallback[run[:-1]] = run
    if not is_shouting(p.body):
        for t in _WORD.findall(p.body):
            if len(t) >= 3:          # two-letter words only count as $XX or (XX)
                _add(p.candidates, t, p.prefix)
    return p


def confirm(p: Parsed, is_real) -> list[str]:
    """Candidates that `is_real(ticker)` accepts, honouring glued fallbacks."""
    out = []
    for t in p.candidates:
        parent = p.fallback.get(t)
        if parent and is_real(parent):
            continue
        if is_real(t) and t not in out:
            out.append(t)
    return out


# ── company names ────────────────────────────────────────────────────────────

_SUFFIX = re.compile(
    r"\b(inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|holdings?|group|"
    r"sa|nv|ag|se|lp|llc|n\.v|s\.a|class [abc]|common stock|ordinary shares?|"
    r"american depositary shares?|ads|adr|new|the)\b\.?", re.I)
_GENERIC = frozenset("""
american first general united national international global advanced applied digital new bank energy
health capital royal southern western eastern northern pacific atlantic central community data life
home select power public smart standard great golden green blue red solar world universal crown
texas florida california york carolina enterprise enterprises financial industries systems
technologies technology solutions services resources partners therapeutics pharmaceuticals bio
trade target block gap match square live core open rocket snap box sun pool ball dover chart five
signet news fox dollar state regions citizens discover progressive insight compass frontier delta
carnival best value edge arrow ross eagle shift vital vista summit pinnacle apex atlas titan liberty
freedom patriot genesis element alpha beta omega prime premier main union pilgrim pioneer sterling
""".split())
ALIASES = {"GOOGL": ["google"], "GOOG": ["google"], "META": ["facebook", "instagram"],
           "BRK.B": ["berkshire"], "TSM": ["tsmc"], "XOM": ["exxon"], "CVX": ["chevron"],
           "KO": ["coca-cola", "coke"], "HD": ["home depot"], "WMT": ["walmart"]}


def name_keys(ticker: str, name: str | None) -> list[str]:
    """'Robinhood Markets, Inc.' -> ['robinhood markets', 'robinhood']; lower case."""
    keys = list(ALIASES.get(ticker, []))
    if name:
        clean = re.sub(r"\s+", " ", _SUFFIX.sub(" ", name.replace(",", " "))).strip(" .&-").lower()
        if len(clean) >= 4:
            keys.append(clean)
        first = clean.split(" ")[0] if clean else ""
        if len(first) >= 4 and first not in _GENERIC and first not in keys:
            keys.append(first)
    return keys


def names_regex(keys) -> re.Pattern | None:
    keys = sorted({k for k in keys if k}, key=len, reverse=True)
    if not keys:
        return None
    return re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(k) for k in keys) + r")(?![a-z0-9])", re.I)


def find_names(rx: re.Pattern | None, text: str) -> list[str]:
    """Name keys found in `text`, lower case. A name must be written as one - capitalised
    ("Robinhood", "ROBINHOOD") - so "and trade" is never The Trade Desk."""
    if rx is None:
        return []
    return [m.group(1).lower() for m in rx.finditer(text) if m.group(1)[0].isupper()]


def mentions(text: str, ticker: str, name: str | None = None) -> bool:
    """Is this headline about `ticker`? (/news: one known ticker, so guesses can be accepted.)"""
    p = parse(text)
    if ticker in p.prefix or ticker in p.candidates:
        return True
    # A shouting headline's words are not candidates, but for one known ticker of 3+
    # letters that is not a word, "CIGNA, UNITEDHEALTHCARE …" / "… BY COREWEAVE" is fine.
    if is_shouting(p.body) and len(ticker) >= 3 and ticker not in STOP:
        if re.search(rf"(?<![A-Za-z0-9]){re.escape(ticker)}(?![A-Za-z0-9])", p.body):
            return True
    return bool(find_names(names_regex(name_keys(ticker, name)), text))
