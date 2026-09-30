"""Screenshot the changed /r/* letter panels at w=728 from the BUILT bundle.

No server process: every request is answered by page.route — static files from
app/dist, /api/* from the fixtures below. Nothing reaches production or C:\\data.
"""
import base64, json, mimetypes, sys, pathlib, datetime as dt
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright

DIST = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
ORIGIN = "http://render.test"
PNG_1x1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")

def enc(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

today = dt.datetime.now(ZoneInfo("America/New_York")).date()
mon = today - dt.timedelta(days=today.weekday())
nmon = mon + dt.timedelta(days=7)
def ds(d): return d.isoformat()
def lab(d): return d.strftime("%a %b ") + str(d.day)
def e(sym, name, mc, **kw): return {"sym": sym, "name": name, "mc_b": mc, "ew": 0, **kw}

thu = mon + dt.timedelta(days=3)
CUR = {"days": {
    ds(mon + dt.timedelta(days=i)): {"label": lab(mon + dt.timedelta(days=i)), "bmo": [], "amc": []} for i in range(5)}}
CUR["days"][ds(mon + dt.timedelta(days=1))]["amc"] = [e("PAYX", "Paychex, Inc.", 45, ew=80)]
CUR["days"][ds(mon + dt.timedelta(days=2))]["amc"] = [e("NKE", "Nike, Inc.", 110, ew=300), e("CCL", "Carnival Corporation", 30, ew=90)]
CUR["days"][ds(mon + dt.timedelta(days=2))]["bmo"] = [e("GIS", "General Mills", 32, ew=60)]
CUR["days"][ds(thu)]["bmo"] = [e("MKC", "McCormick & Company", 20, ew=40), e("STZ", "Constellation Brands", 38, ew=70)]
NEXT = {"days": {
    ds(nmon + dt.timedelta(days=i)): {"label": lab(nmon + dt.timedelta(days=i)), "bmo": [], "amc": []} for i in range(5)}}
NEXT["days"][ds(nmon)]["bmo"] = [e("MKC", "McCormick & Company", 20, date_est=True), e("PEP", "PepsiCo, Inc.", 200, date_est=True)]
NEXT["days"][ds(nmon + dt.timedelta(days=1))]["amc"] = [e("LEVI", "Levi Strauss & Co.", 8, date_est=True)]

BOOK = {"date": ds(today), "part": 1, "rows": [
    {"rank": 1, "sym": "NVDA", "theme": "AI Semiconductors", "setup": "VCP", "entry": 182.5, "stop": 171.2, "t1": 195, "t2": 210, "levels_source": "card"},
    {"rank": 2, "sym": "PLTR", "theme": "AI Software", "setup": "Flag", "entry": None, "stop": None, "t1": None, "t2": None},
    {"rank": 3, "sym": "MU", "theme": "Memory", "setup": "Base Breakout", "entry": 168.4, "stop": 158.9, "t1": 182, "t2": 196},
    {"rank": 4, "sym": "ANET", "theme": "Networking", "setup": "Pullback", "entry": None, "stop": None, "t1": None, "t2": None},
]}
ECON = {"date": ds(today), "rows": [
    {"time": "08:30", "kind": "econ", "event": "Jobless Claims", "estimate": "224K", "is_key": True},
    {"time": "09:00", "kind": "fed", "event": "Fed Speaker", "note": "", "speaker": "", "title": "", "is_key": True},
    {"time": "10:00", "kind": "econ", "event": "JOLTS Job Openings", "estimate": "7.19M", "is_key": True},
    {"time": "13:00", "kind": "fed", "event": "Fed Speaker", "note": "voting member", "speaker": "Waller", "title": "", "is_key": True},
    {"time": "15:00", "kind": "econ", "event": "API Crude Inventories", "estimate": "", "is_key": False},
], "amc": ["NKE", "CCL", "PAYX"], "amc_count": 5}
BREADTH = {"exposure": {"score": 100, "score_delta": 0, "note": "Constructive tape; stay with leaders.", "bonus": 0},
           "market_phase": "Confirmed Uptrend",
           "ma_data": {"spy": {"price": 764.1, "ema9_pct": 0.8, "ema20_pct": 1.9, "sma50_pct": 4.2, "sma200_pct": 11.3},
                       "qqq": {"price": 734.9, "ema9_pct": 1.1, "ema20_pct": 2.4, "sma50_pct": 5.0, "sma200_pct": 14.8}}}
SNAP = {"etfs": {"SPY": {"price": "765.61", "chg": "+0.42%", "css": "pos"}, "QQQ": {"price": "736.53", "chg": "+0.61%", "css": "pos"}}}
THEMES = {"period": "1W", "max_abs": 8.4, "leaders": [
    {"name": "Semiconductor Equipment & Materials", "ret": 8.4, "holdings": ["AMAT", "LRCX", "KLAC"]},
    {"name": "Nuclear & Uranium", "ret": 6.1, "holdings": ["CCJ", "OKLO", "SMR"]},
    {"name": "Quantum Computing", "ret": 5.0, "holdings": ["IONQ", "RGTI", "QBTS"]},
    {"name": "Space & Satellite Communications", "ret": 3.2, "holdings": ["RKLB", "ASTS", "LUNR"]},
    {"name": "Robotics & Automation", "ret": 2.1, "holdings": ["ISRG", "TER", "SYM"]}],
  "laggards": [
    {"name": "Homebuilders & Residential Construction", "ret": -6.2, "holdings": ["DHI", "LEN", "PHM"]},
    {"name": "Regional Banks", "ret": -4.0, "holdings": ["KRE", "ZION", "CMA"]},
    {"name": "Airlines", "ret": -3.1, "holdings": ["DAL", "UAL", "AAL"]},
    {"name": "Cannabis", "ret": -2.2, "holdings": ["TLRY", "CGC"]},
    {"name": "Solar", "ret": -1.4, "holdings": ["ENPH", "FSLR", "RUN"]}]}

def api(path, query):
    if path == "/api/r/book": return BOOK
    if path == "/api/r/econ": return ECON
    if path == "/api/r/themes": return THEMES
    if path == "/api/r/breadth": return BREADTH
    if path == "/api/snapshot": return SNAP
    if path == "/api/calendar": return NEXT if "week=" in query else CUR
    return {}

EARNCARDS = {"rows": [
    {"sym": "MU", "name": "Micron Technology", "badge": "ON OUR WATCH LIST", "on_board": True, "session": "AMC",
     "label": "Wed Oct 1", "last_q": {"label": "Q3", "eps": 1.91, "rev_m": 9301}, "eps_est": 2.85, "rev_est": 11200,
     "up_label": "Q4", "proj_eps_yoy": 141, "proj_rev_yoy": 20, "exp_move_pct": 9.1},
    {"sym": "RIVN", "name": "Rivian Automotive, Inc.", "on_board": True, "session": "BMO", "label": "Thu Oct 2",
     "last_q": {"eps": -0.97, "rev_m": 1300}, "eps_est": -0.62, "rev_est": 1550, "proj_eps_yoy": 0.3, "proj_rev_yoy": 12,
     "exp_move_pct": 11.4},
]}
EARNRESULTS = {"rows": [
    {"sym": "NKE", "name": "Nike, Inc.", "badge": "IN THE BOOK", "session": "AMC", "is_beat": True,
     "eps_act": 0.49, "eps_est": 0.27, "eps_surp": 81, "rev_act": 11720, "rev_est": 11000, "rev_surp": 6.5,
     "eps_yoy": 0.2, "rev_yoy": 2},
    {"sym": "BB", "name": "BlackBerry Limited", "session": "BMO", "is_beat": False,
     "eps_act": -5.34, "eps_est": -5.10, "eps_surp": -4.7, "rev_act": 120, "rev_est": 126, "rev_surp": -4.8,
     "eps_yoy": -12, "rev_yoy": -0.4},
]}

SHOTS = [
    ("earncards", f"/r/earncards?w=728&data={enc(EARNCARDS)}"),
    ("earnresults", f"/r/earnresults?w=728&data={enc(EARNRESULTS)}"),
    ("book", "/r/book?part=1&w=728"),
    ("econ", "/r/econ?w=728"),
    ("calendar", "/r/calendar?w=728&from=today&days=5"),
    ("internals_premarket", "/r/internals?variant=exposure&w=728&spy=765.30&qqq=739.28&label=pre-market"),
    ("internals_control", "/r/internals?variant=exposure&w=728"),
    ("themes", "/r/themes?period=1W&n=5&holds=3&w=728"),
]

def handler(route):
    url = route.request.url
    if not url.startswith(ORIGIN):
        return route.continue_() if ("fonts.g" in url) else route.abort()
    rest = url[len(ORIGIN):]
    path, _, query = rest.partition("?")
    if path.startswith("/api/ticker-logo/"):
        return route.fulfill(status=200, content_type="image/png", body=PNG_1x1)
    if path.startswith("/api/"):
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(api(path, query)))
    f = DIST / path.lstrip("/")
    if not path.startswith("/r/") and f.is_file():
        ct = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        if f.suffix == ".js": ct = "text/javascript"
        return route.fulfill(status=200, content_type=ct, body=f.read_bytes())
    return route.fulfill(status=200, content_type="text/html", body=(DIST / "index.html").read_bytes())

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 780, "height": 1400}, device_scale_factor=1, color_scheme="dark")
    ctx.route("**/*", handler)
    for name, path in SHOTS:
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda ex: errs.append(str(ex)))
        page.goto(ORIGIN + path)
        try:
            page.wait_for_function("window.__panelReady === true", timeout=15000)
        except Exception as ex:  # noqa: BLE001
            print(name, "panelReady wait failed:", ex)
        el = page.query_selector("#panel-export")
        if not el:
            print(name, "NO #panel-export", errs); page.close(); continue
        box = el.bounding_box()
        dest = OUT / f"{name}_w728.png"
        el.screenshot(path=str(dest))
        print(f"{name}: {dest} box={box['width']:.0f}x{box['height']:.0f} errors={errs}")
        page.close()
    b.close()
