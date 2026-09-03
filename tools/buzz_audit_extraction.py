"""What is the /buzz extractor GETTING WRONG on today's real chat?

⛔ The earlier day-one audit compared extract(messages) against the store. Both
sides ran the SAME extractor, so it proved ingest fidelity and nothing about
extraction quality -- a token the extractor never recognises is invisible to
that check by construction. This asks the independent questions instead:

  1. SUPPRESSED: an uppercase token that IS a real symbol but was not booked.
     Which gate stopped it, and is that gate right?
  2. CASHTAGS: an explicit $TICKER the room typed that produced nothing.
  3. ALIASES: a company NAME in the alias table that produced no booking.

Run:  python tools/buzz_audit_extraction.py
      Needs DISCORD_BOT_TOKEN + BUZZ_CHANNELS (override the env file with
      BUZZ_ENV_FILE). Reads Discord; writes NOTHING.

Privacy: short snippets are printed for judgement; nothing is written to disk.
"""
import collections
import os
import pathlib
import datetime
import re
import sys
import time
import zoneinfo

import requests
from dotenv import dotenv_values

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from api.services import buzz_extract, buzz_universe as U  # noqa: E402

ENV = dotenv_values(os.environ.get("BUZZ_ENV_FILE", r"C:\Users\Patrick\uct_intelligence\.env"))
H = {"Authorization": "Bot " + (ENV.get("DISCORD_BOT_TOKEN") or "").strip()}
B = "https://discord.com/api/v10"
CH = "1216816863313657886"
ET = zoneinfo.ZoneInfo("America/New_York")
TODAY = datetime.datetime.now(ET).strftime("%Y-%m-%d")

SYMS = U.symbols()
CHAT = U.chat_words()
HOUSE = U.HOUSE_VOCAB
WORDF = {w.upper() for w in U.WORD_FORMS}
ALIASES = U.aliases()

msgs, before, pages = [], None, 0
while pages < 12:
    p = {"limit": 100}
    if before:
        p["before"] = before
    r = requests.get(f"{B}/channels/{CH}/messages", params=p, headers=H, timeout=30)
    if r.status_code == 429:
        time.sleep(min(float(r.headers.get("retry-after", "1")), 30)); continue
    page = r.json()
    if not page:
        break
    pages += 1
    stop = False
    for m in page:
        ts = ((int(m["id"]) >> 22) + 1420070400000) / 1000
        if datetime.datetime.fromtimestamp(ts, ET).strftime("%Y-%m-%d") != TODAY:
            stop = True; continue
        if (m.get("author") or {}).get("bot"):
            continue
        msgs.append(m.get("content") or "")
    before = str(min(int(x["id"]) for x in page))
    if stop:
        break
    time.sleep(0.3)

print(f"{len(msgs)} human messages today\n")

TOK = re.compile(r"\b[A-Z]{2,6}\b")
CASH = re.compile(r"\$([A-Za-z]{1,6})\b")

suppressed = collections.Counter()
reason = {}
samples = collections.defaultdict(list)
cash_missed = collections.Counter()
cash_samples = collections.defaultdict(list)
alias_missed = collections.Counter()

for text in msgs:
    booked = {t for t, _ in buzz_extract.extract(text)}
    # 1. uppercase symbols that did not book
    for tok in set(TOK.findall(text)):
        if tok in SYMS and tok not in booked:
            suppressed[tok] += 1
            if tok in CHAT:
                reason[tok] = "derived collision list"
            elif tok in HOUSE:
                reason[tok] = "HOUSE_VOCAB acronym"
            elif tok in WORDF:
                reason[tok] = "WORD_FORMS"
            else:
                reason[tok] = "?? no gate explains it"
            if len(samples[tok]) < 2:
                samples[tok].append(re.sub(r"\s+", " ", text)[:110])
    # 2. explicit cashtags that produced nothing
    for c in set(CASH.findall(text)):
        if c.upper() not in booked:
            cash_missed[c.upper()] += 1
            if len(cash_samples[c.upper()]) < 2:
                cash_samples[c.upper()].append(re.sub(r"\s+", " ", text)[:110])
    # 3. alias names present but unbooked
    low = text.lower()
    for name, sym in ALIASES.items():
        if len(name) >= 4 and re.search(r"\b" + re.escape(name) + r"\b", low) and sym not in booked:
            alias_missed[f"{name} -> {sym}"] += 1

print("=" * 72)
print("1. SUPPRESSED — a real symbol appeared in caps and was NOT booked")
print("=" * 72)
for tok, n in suppressed.most_common(22):
    print(f"  {tok:<6} x{n:<3} [{reason.get(tok)}]")
    for s in samples[tok]:
        print(f"        \"{s.encode('ascii','replace').decode()}\"")

print("\n" + "=" * 72)
print("2. CASHTAGS that produced no booking")
print("=" * 72)
if not cash_missed:
    print("  none — every $TICKER the room typed was counted")
for c, n in cash_missed.most_common(15):
    inuni = c in SYMS
    print(f"  ${c:<6} x{n}   in universe: {inuni}")
    for s in cash_samples[c]:
        print(f"        \"{s.encode('ascii','replace').decode()}\"")

print("\n" + "=" * 72)
print("3. COMPANY NAMES present but not booked")
print("=" * 72)
if not alias_missed:
    print("  none")
for k, n in alias_missed.most_common(15):
    print(f"  {k:<28} x{n}")
