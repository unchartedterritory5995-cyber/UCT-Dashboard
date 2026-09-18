"""The lexical screens golden-v1.1 uses to decide a segment CANNOT contain an instrument-bearing
or teaching-vocabulary record. ONE authority, shared with `tools/wisdom_golden_verify.py` (the
golden-methodology reader) and `api/services/wisdom/extract/prescreen.py` (R102, session 27 — the
$0 pre-extraction filter). Moved out of the golden-verify tool on the same R15 precedent as
`tools/wisdom/category_norm.py`: a screen duplicated for a second caller is a screen that drifts.

⛔ AN ABSENCE IS NOT MECHANICALLY DECIDABLE IN GENERAL (`docs/wisdom/methodology/golden-v1.1.md`
§4). What IS mechanical:
  * no instrument token  -> CALL, NEGATIVE_CALL, MENTION and LEVEL are not CONSTRUCTIBLE.
    Each needs an instrument (R1, R3, the MENTION rule), so no instrument means no record.
  * no price token       -> LEVEL additionally needs a stated price.
  * lexicon screen       -> PRINCIPLE and MARKET_SIGNAL. This one is a SCREEN, NOT A PROOF: a
    generalisable teaching statement has no lexical signature, so absence of vocabulary is not
    absence of meaning. Golden-v1.1 therefore marks every row declaring these two PROVISIONAL,
    never CONFIRMED, off this screen alone.

⛔⛔ THE INSTRUMENT SCREEN IS DELIBERATELY NOT `segmenter.detect_mentions`. That function is
UNIVERSE-GATED — an uppercase token counts only when `cap_universe.json` knows it — and the
golden-v1.1 build's first pass used it and passed messages naming SOXL, CBRS, ETHU, NBIL, SNDU
and KORU as "no instrument here". Absence of knowledge is not absence of a ticker
(`lesson_a_symbol_universe_does_not_settle_a_ticker_match`). This screen rejects on the SHAPE of
a token instead, and adds company names and sector words, because the extractor resolves "Micron"
and "semis" to instruments no uppercase regex will ever see.

⭐ **R102 (session 27) re-purposes this from a GOLDEN-LABEL claim check to a PRE-EXTRACTION
filter**: a production segment where every screen below comes back empty is a segment the model
has never been observed to produce a floored-type record from, at $0 cost to find out. That is a
DIFFERENT question from "is this NULL row's claim honest" and a weaker one — see
`api/services/wisdom/extract/prescreen.py` for the measured recall-loss bound before this is ever
used to skip a real segment.
"""
from __future__ import annotations

import re

_NULL_CASHTAG = re.compile(r"\$[A-Za-z]{1,6}\b")
_NULL_UPPER = re.compile(r"\b[A-Z]{2,6}\b")
_NULL_PRICE = re.compile(r"\$\s?\d|(?<![\w.])\d{1,5}(?:,\d{3})*\.\d{1,2}(?![\w.])")
#: Uppercase tokens that are never an instrument in this corpus. Anything NOT here is treated as
#: a possible ticker, which is the safe direction for a claim of absence.
_NULL_UPPER_OK = frozenset("""
A I AM PM ET EST EDT CT PT AI IT ON NO OK OR SO TO IN IS IF AT BY OF AN AS BE DO GO UP MY WE HE
ALL AND ARE BUT NOT YES NEW ONE TWO BIG LOW HIGH OUT FOR YOU CAN NOW THE WAS HAS HAD HOW WHY WHO
US USA UK EU NYSE SEC IRS FOMC FED CPI PPI PCE GDP NFP PMI JOLTS UMICH ISM ADP ECB BOJ
EPS ER IPO ETF ETFS CEO CFO COO CTO AH PT DD IMO TBH LOL HAGW FWIW BTW ASAP FYI TL DR
EMA SMA MA RS HVC EP PEG ORB VWAP ADR ATR RSI MACD ATH HOD LOD YTD EOD MTD QTD NH NL
UCT TSDR SUBSTACK ZOOM DISCORD YOUTUBE TC PDF API URL HTML CSS JSON ID OS PC TV APP
Q1 Q2 Q3 Q4 H1 H2 FY MON TUE WED THU FRI SAT SUN JAN FEB MAR APR JUN JUL AUG SEP OCT NOV DEC
LIVE TRADING SCANS SUNDAY MARKET WEEK DAY MONTH YEAR HOUR MIN SEC
""".split())
_NULL_COMPANY = re.compile(
    r"\b(nvidia|tesla|apple|amazon|google|alphabet|meta|facebook|microsoft|netflix|micron|"
    r"broadcom|intel|palantir|coinbase|robinhood|nike|walmart|costco|boeing|disney|oracle|"
    r"salesforce|adobe|qualcomm|sandisk|seagate|western digital|super ?micro|arm holdings|"
    r"bitcoin|ethereum|solana|dogecoin|berkshire|goldman|morgan stanley|jpmorgan|"
    r"united parcel|fedex|starbucks|mcdonald|pepsi|coca[- ]cola|exxon|chevron|pfizer|moderna|"
    r"lilly|novo|astrazeneca|paypal|block|square|uber|lyft|airbnb|doordash|snowflake|"
    r"datadog|crowdstrike|cloudflare|shopify|spotify|roblox|unity|rivian|lucid|ford|"
    r"general motors|caterpillar|deere|lockheed|raytheon|northrop|palo alto)\b", re.I)
_NULL_SECTOR = re.compile(
    r"\b(semis?|semiconductors?|banks?|financials?|megacaps?|mega[- ]cap|small[- ]caps?|"
    r"russell|nasdaq|s&p|spx|dow jones|indices|the index|memory names?|leaders?|"
    r"biotech|energy names?|miners?|crypto names?|quantum names?|nuclear names?|"
    r"growth names?|momentum names?|utilities|healthcare|industrials|staples|discretionary)\b", re.I)
_NULL_PRINCIPLE_LEX = re.compile(
    r"\b(always|never|every time|the rule|rule is|you should|you have to|you must|the key is|"
    r"discipline|risk manage|stop loss|position siz|cut (?:your )?loss|let (?:your )?winners|"
    r"the mistake|principle|expectancy|probabilit|be careful|have a system|"
    r"sit on (?:your|my) hands|less is more)\w*", re.I)
_NULL_SIGNAL_LEX = re.compile(
    r"\b(distribution day|follow[- ]through|risk[- ]on|risk[- ]off|washout|capitulat|rotation|"
    r"uptrend|downtrend|correction|bull market|bear market|oversold|overbought|"
    r"under the hood|t2108|t2100|advance/decline)\w*", re.I)

#: Every screen key `null_screens` produces, in one place so a caller can iterate without
#: retyping the seven names (and a screen added or renamed here cannot silently miss a caller
#: that hand-typed the old set).
SCREEN_KEYS: tuple = ("cashtags", "upper_tokens", "companies", "sectors", "prices",
                     "principle_lexicon", "signal_lexicon")


def null_screens(text: str) -> dict:
    """Every screen a NULL row's claim — or a pre-extraction skip decision — rests on, as
    MEASUREMENTS. Each value is the list of hits; the claim of absence holds only where the list
    is empty, and the lists are stored/returned so a caller can re-derive them and fail on drift
    instead of trusting a cached verdict."""
    return {
        "cashtags": sorted(set(_NULL_CASHTAG.findall(text))),
        "upper_tokens": sorted({t for t in _NULL_UPPER.findall(text) if t not in _NULL_UPPER_OK}),
        "companies": sorted({m.group(0).lower() for m in _NULL_COMPANY.finditer(text)}),
        "sectors": sorted({m.group(0).lower() for m in _NULL_SECTOR.finditer(text)}),
        "prices": sorted({m.group(0) for m in _NULL_PRICE.finditer(text)}),
        "principle_lexicon": sorted({m.group(0).lower() for m in _NULL_PRINCIPLE_LEX.finditer(text)}),
        "signal_lexicon": sorted({m.group(0).lower() for m in _NULL_SIGNAL_LEX.finditer(text)}),
    }


def any_screen_fires(text: str) -> bool:
    """True unless EVERY screen comes back empty. R102's predicate: a segment where this is
    False has never been observed to carry an instrument, a price, or teaching vocabulary — the
    same absence golden-v1.1 requires before a NULL row may claim it, applied to unlabelled
    production text instead of a hand-written claim."""
    screens = null_screens(text)
    return any(screens[key] for key in SCREEN_KEYS)
