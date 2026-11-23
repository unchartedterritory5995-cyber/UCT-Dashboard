"""UCT point-in-time rebuild, stage 1: acquire inputs (read-only from providers).
Writes ONLY under /data/_audit/uct_pit. Resumable. Prints no market values."""
import gzip, json, os, sys, time, urllib.request, urllib.error
from datetime import date, timedelta
ROOT = "/data/_audit/uct_pit"
K = os.environ["MASSIVE_API_KEY"]
BASE = "https://api.polygon.io"
os.makedirs(f"{ROOT}/grouped", exist_ok=True)
LOG = open(f"{ROOT}/acquire.log", "a", buffering=1)
def log(*a): LOG.write(time.strftime("%H:%M:%S ") + " ".join(map(str, a)) + "\n")

def get(url, tries=6):
    sep = "&" if "?" in url else "?"
    for i in range(tries):
        try:
            with urllib.request.urlopen(url + f"{sep}apiKey={K}", timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504): time.sleep(2 ** i); continue
            raise
        except Exception:
            time.sleep(2 ** i)
    raise RuntimeError("failed after retries")

def paged(url, out_path):
    if os.path.exists(out_path): log("skip", out_path); return
    rows, n = [], 0
    while url:
        j = get(url); rows += j.get("results") or []; n += 1
        url = j.get("next_url"); time.sleep(0.15)
        if n % 50 == 0: log(out_path, "pages", n, "rows", len(rows))
    with gzip.open(out_path + ".tmp", "wt") as f: json.dump(rows, f)
    os.replace(out_path + ".tmp", out_path); log("wrote", out_path, len(rows))

def grouped(start, end):
    d, n, empty = start, 0, 0
    while d <= end:
        if d.weekday() < 5:
            p = f"{ROOT}/grouped/{d}.json.gz"
            if not os.path.exists(p):
                j = get(f"{BASE}/v2/aggs/grouped/locale/us/market/stocks/{d}?adjusted=false&include_otc=false")
                res = j.get("results") or []
                with gzip.open(p + ".tmp", "wt") as f:
                    json.dump({T["T"]: [T.get("o"), T.get("h"), T.get("l"), T.get("c"), T.get("v"), T.get("vw")] for T in res if "T" in T}, f)
                os.replace(p + ".tmp", p); n += 1; empty += (not res)
                if n % 100 == 0: log("grouped", d, "fetched", n, "empty", empty)
                time.sleep(0.12)
        d += timedelta(days=1)
    log("grouped done", n, "empty", empty)

def grouped_s3(start, end):
    """Day aggregates from the provider's S3 flat files (unadjusted; every ticker that traded)."""
    import boto3, csv, io
    s3 = boto3.client("s3", aws_access_key_id=os.environ.get("MASSIVE_S3_ACCESS_KEY") or os.environ.get("MASSIVE_ACCESS_KEY"),
                      aws_secret_access_key=os.environ.get("MASSIVE_S3_SECRET") or os.environ.get("MASSIVE_SECRET_KEY"),
                      endpoint_url=os.environ.get("MASSIVE_S3_ENDPOINT") or "https://files.massive.com")
    d, n, miss = start, 0, 0
    while d <= end:
        if d.weekday() < 5:
            p = f"{ROOT}/grouped/{d}.json.gz"
            if not os.path.exists(p):
                key = f"us_stocks_sip/day_aggs_v1/{d:%Y}/{d:%m}/{d}.csv.gz"
                body = None
                for attempt in range(10):
                    try:
                        body = s3.get_object(Bucket="flatfiles", Key=key)["Body"].read(); break
                    except Exception as e:
                        if "NoSuchKey" in str(e) or "404" in str(e): body = b""; break
                        time.sleep(min(120, 3 * 2 ** attempt))
                if body is None:
                    log("gave up", d); d += timedelta(days=1); continue
                if body == b"":
                    miss += 1; d += timedelta(days=1); continue
                out = {}
                for r in csv.DictReader(io.StringIO(gzip.decompress(body).decode())):
                    f = lambda k: float(r[k]) if r.get(k) not in (None, "") else None
                    out[r["ticker"]] = [f("open"), f("high"), f("low"), f("close"), f("volume"), None]
                with gzip.open(p + ".tmp", "wt") as fh: json.dump(out, fh)
                os.replace(p + ".tmp", p); n += 1
                if n % 200 == 0: log("grouped_s3", d, "fetched", n, "missing", miss)
        d += timedelta(days=1)
    log("grouped_s3 done", n, "missing(holidays)", miss)

def sec_bulk():
    from api.services.fundamentals_pit import sec_client as SEC
    ua = os.environ.get("SEC_USER_AGENT", SEC.DEFAULT_UA)
    for name, url in (("companyfacts.zip", "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"),
                      ("submissions.zip", "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip")):
        p = f"{ROOT}/sec/{name}"; os.makedirs(f"{ROOT}/sec", exist_ok=True)
        if os.path.exists(p): log("skip", p); continue
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=600) as r, open(p + ".tmp", "wb") as f:
            while True:
                b = r.read(1 << 20)
                if not b: break
                f.write(b)
        os.replace(p + ".tmp", p); log("wrote", p, os.path.getsize(p))

if __name__ == "__main__":
    stage = sys.argv[1]
    log("START", stage)
    try:
        if stage == "ref":
            paged(f"{BASE}/v3/reference/tickers?market=stocks&active=true&limit=1000", f"{ROOT}/ref_active.json.gz")
            paged(f"{BASE}/v3/reference/tickers?market=stocks&active=false&limit=1000", f"{ROOT}/ref_inactive.json.gz")
            paged(f"{BASE}/v3/reference/splits?limit=1000", f"{ROOT}/splits.json.gz")
        elif stage == "grouped_s3":
            a = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else date(2007, 6, 1)
            b = date.fromisoformat(sys.argv[3]) if len(sys.argv) > 3 else date(2026, 11, 20)
            grouped_s3(a, b)
        elif stage == "grouped":
            grouped(date(2007, 6, 1), date(2026, 11, 20))
        elif stage == "sec":
            sec_bulk()
        log("DONE", stage)
    except Exception as e:
        log("FAILED", stage, type(e).__name__, str(e)[:200]); raise
