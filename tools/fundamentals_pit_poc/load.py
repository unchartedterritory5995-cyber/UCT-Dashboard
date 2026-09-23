import os
import json, os, sys, glob
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from api.services.fundamentals_pit import facts as F, filings as FL, knowledge as K
from fetch import CACHE as SEC
def load(t):
    doc = json.load(open(os.path.join(SEC, f"facts_{t}.json"), encoding="utf-8"))
    sub = json.load(open(os.path.join(SEC, f"sub_{t}.json"), encoding="utf-8"))
    pages = [sub["filings"]["recent"]] + [json.load(open(os.path.join(SEC, f"sub_{t}_{f['name']}"), encoding="utf-8")) for f in sub["filings"].get("files", [])]
    fl = FL.parse_submission_pages(pages)
    fx = F.parse_companyfacts(doc)
    return doc, sub, fl, fx
