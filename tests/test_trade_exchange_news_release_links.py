"""Original press-release links (release_links.py): verified-only, write-once,
off the delivery path.

The company-news store is a REAL company_news.db built from its own schema in a
temp dir (read-only to the resolver); SEC EDGAR is a fake transport. Times are
written the way company news stores FMP's today: the Eastern wall clock labelled
UTC (see the module's timestamp contract)."""
from __future__ import annotations

import json
import pathlib
import sqlite3
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from api.services.trade_exchange_news import pipeline as pl
from api.services.trade_exchange_news import records
from api.services.trade_exchange_news import release_links as rl
from api.services.trade_exchange_news.store import Store

ET = ZoneInfo("America/New_York")
MIN = 60_000
T0 = int(datetime(2026, 10, 29, 20, 5, tzinfo=timezone.utc).timestamp() * 1000)   # 16:05 ET
NOW = T0 + 20 * MIN
GNW = "https://www.globenewswire.com/news-release/2026/10/29/3176543/0/en/Acme-Corp-Reports-Third-Quarter-2026-Results.html"
TITLE = "Acme Corp Reports Third Quarter 2026 Results"
REPO = pathlib.Path(__file__).resolve().parents[1]


def iso_fmp(ms: int) -> str:
    """FMP's Eastern wall clock, stored as if it were UTC (company news today)."""
    wall = datetime.fromtimestamp(ms / 1000, ET).replace(tzinfo=None)
    return wall.replace(tzinfo=timezone.utc).isoformat()


def iso_utc(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    from api.services.news import store as cn_store
    cn = tmp_path / "company_news.db"
    c = sqlite3.connect(cn)
    c.executescript(cn_store._SCHEMA)  # noqa: SLF001 -- the store's own schema
    c.commit()
    c.close()
    monkeypatch.setattr(cn_store, "_DB_PATH", str(cn))
    monkeypatch.setenv("TXN_SOURCE_ALLOWLIST", "TX-PressRelease,TX-News")
    monkeypatch.setenv("TXN_RELEASE_LINKS_FMP_ENABLED", "1")
    monkeypatch.setenv("TXN_RELEASE_LINKS_SEC_ENABLED", "1")
    monkeypatch.setenv("TXN_RELEASE_LINKS_DISPLAY_ENABLED", "1")
    rl._LINKS.clear()
    rl.COUNTS.clear()
    yield cn


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "trade_exchange_news.db"))


_n = [0]


def tx(store, content, ms=T0, source="TX-PressRelease", tickers=()):
    _n[0] += 1
    rec = {"id": f"01TEST{_n[0]:020d}", "source": source, "content": content, "received_at_ms": ms}
    store.ingest(rec, via="push", dedupe_key=records.dedupe_key(source, content), window_ms=0,
                 tickers=list(tickers), now_ms=ms)
    return rec["id"]


def fmp(cn_path, title, tickers, *, url=GNW, publisher="GlobeNewswire", cls="wire", provider="fmp",
        pub_ms=T0 - 1 * MIN, ing_ms=T0 + 8 * MIN, published=None, reject=""):
    from api.services.news.dedupe import headline_key
    c = sqlite3.connect(cn_path)
    cur = c.execute(
        "INSERT INTO news_items(provider, provider_id, source_name, source_display, source_class, url, headline, "
        "headline_key, published_at, ingested_at, reject_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (provider, url + str(pub_ms) + title, publisher, publisher, cls, url, title, headline_key(title),
         published or iso_fmp(pub_ms), iso_utc(ing_ms), reject))
    for t in tickers:
        c.execute("INSERT INTO news_tickers(news_id, ticker, relevance, subject) VALUES (?,?,?,?)",
                  (cur.lastrowid, t, "direct", "subject"))
    c.commit()
    nid = cur.lastrowid
    c.close()
    return nid


def poll(cn_path, stamp):
    c = sqlite3.connect(cn_path)
    c.execute("INSERT OR REPLACE INTO news_source_health(source, last_ok, state) VALUES ('fmp', ?, 'ok')", (stamp,))
    c.commit()
    c.close()


def resolver(store, now=NOW, sec=None, published=None):
    out = published if published is not None else []
    return rl.Resolver(store, sec=sec, now_ms=lambda: now,
                       on_link=lambda eid, ev: out.append((eid, ev)))


def link_rows(store):
    return store._conn().execute("SELECT event_id, kind, url, publisher, tier FROM release_links").fetchall()


def shadow(store, eid=None):
    q = "SELECT event_id, source, tier FROM release_link_candidates"
    rows = store._conn().execute(q).fetchall()
    return {(r[1], r[2]) for r in rows if eid is None or r[0] == eid}


# ── FMP: the accepted tier ────────────────────────────────────────────────────

def test_exact_title_same_ticker_unique_wire_url_is_linked_and_published(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    pubs = []
    st = resolver(store, published=pubs).run_pass()
    assert st["fmp_linked"] == 1
    assert link_rows(store) == [(eid, "original_release", GNW, "GlobeNewswire", rl.TIER_FMP_EXACT)]
    assert rl.lookup(eid) == {"kind": "original_release", "url": GNW, "publisher": "GlobeNewswire"}
    assert pubs and pubs[0][0] == eid and pubs[0][1]["link"]["url"] == GNW


def test_headline_events_carry_the_link_on_every_read_path(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    other = tx(store, "BETA - Beta Inc Announces Something Unrelated Entirely Today", tickers=["BETA"])
    fmp(env, TITLE, ["ACME"])
    resolver(store).run_pass()
    rows = {r["event_id"]: r for r in store.after(0, 10)}
    ev = pl.headline_event(rows[eid], store.epoch, derived={})
    assert ev["link"]["kind"] == "original_release"
    assert "link" not in pl.headline_event(rows[other], store.epoch, derived={})


def test_the_link_survives_a_restart_and_the_fmp_row_expiring(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    nid = fmp(env, TITLE, ["ACME"])
    resolver(store).run_pass()
    c = sqlite3.connect(env)                       # company news prunes the row (7-day reject rule)
    c.execute("DELETE FROM news_items WHERE id=?", (nid,))
    c.execute("DELETE FROM news_tickers WHERE news_id=?", (nid,))
    c.commit()
    c.close()
    rl._LINKS.clear()
    assert rl.load(store) == 1                     # boot: read back from our own table
    assert rl.lookup(eid)["url"] == GNW
    resolver(store, now=NOW + 3 * 86_400_000).run_pass()
    assert link_rows(store)[0][2] == GNW           # never re-decided, never removed


def test_a_true_utc_published_time_also_verifies(store, env):
    """After company news fixes its zone, a correct UTC time must still pass."""
    tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"], published=iso_utc(T0 - 2 * MIN))
    assert resolver(store).run_pass()["fmp_linked"] == 1
    assert store._conn().execute("SELECT reading FROM release_links").fetchone()[0] == "stored"


def test_an_explicit_zone_is_trusted_and_not_reread(store, env):
    tx(store, f"ACME - {TITLE}")
    # 16:04 ET written with its offset: correct as stored, and "et_wall" must NOT be tried
    fmp(env, TITLE, ["ACME"], published=datetime.fromtimestamp((T0 - MIN) / 1000, ET).isoformat())
    resolver(store).run_pass()
    assert store._conn().execute("SELECT reading FROM release_links").fetchone()[0] == "stored"


def test_a_late_fmp_arrival_is_linked_on_a_later_poll(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    r = resolver(store, now=T0 + MIN)
    poll(env, "p1")
    assert r.run_pass()["fmp_linked"] == 0
    fmp(env, TITLE, ["ACME"], ing_ms=T0 + 25 * MIN)
    r._now = lambda: T0 + 26 * MIN
    assert r.run_pass()["fmp_checked"] == 0        # no new company-news poll yet: no re-check
    poll(env, "p2")
    assert r.run_pass()["fmp_linked"] == 1
    assert rl.lookup(eid)


def test_passes_are_idempotent_and_a_link_is_written_once(store, env):
    tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    r = resolver(store)
    r.run_pass()
    fmp(env, TITLE, ["ACME"], url=GNW.replace("3176543", "3176999"))   # a second URL appears later
    poll(env, "again")
    r.run_pass()
    r.run_pass()
    assert len(link_rows(store)) == 1 and link_rows(store)[0][2] == GNW


# ── FMP: never accepted ──────────────────────────────────────────────────────

def test_two_wire_urls_for_the_same_headline_and_ticker_are_ambiguous(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    fmp(env, TITLE, ["ACME"], url="https://www.prnewswire.com/news-releases/acme-corp-reports-third-quarter-2026-results-302500000.html",
        publisher="PR Newswire")
    resolver(store).run_pass()
    assert link_rows(store) == []
    assert ("fmp", "fmp_exact_ambiguous") in shadow(store, eid)


def test_duplicate_company_headlines_link_only_the_right_ticker(store, env):
    title = "Company to Participate in Upcoming Investor Conferences in November"
    a = tx(store, f"AAA - {title}")
    b = tx(store, f"BBB - {title}")
    c = tx(store, f"CCC - {title}")
    ua = "https://www.businesswire.com/news/home/20261029000001/en/Company-to-Participate-in-Upcoming-Investor-Conferences-in-November"
    ub = "https://www.businesswire.com/news/home/20261029000002/en/Company-to-Participate-in-Upcoming-Investor-Conferences-in-November"
    fmp(env, title, ["AAA"], url=ua, publisher="Business Wire")
    fmp(env, title, ["BBB"], url=ub, publisher="Business Wire")
    resolver(store).run_pass()
    got = {r[0]: r[2] for r in link_rows(store)}
    assert got == {a: ua, b: ub}
    assert c not in got and ("fmp", "fmp_exact_ticker_disagree") in shadow(store, c)


def test_a_wrong_ticker_is_shadow_logged_never_linked(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACMEF"])
    resolver(store).run_pass()
    assert link_rows(store) == [] and ("fmp", "fmp_exact_ticker_disagree") in shadow(store, eid)


def test_close_wording_is_shadow_only(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, "Acme Corp Reports Strong Third Quarter 2026 Financial Results", ["ACME"],
        url=GNW.replace("Results", "Strong-Results"))
    resolver(store).run_pass()
    assert link_rows(store) == [] and ("fmp", "fmp_fuzzy_ticker") in shadow(store, eid)


def test_short_headlines_need_the_tight_time_window(store, env):
    near = tx(store, "ACME - Acme Declares Quarterly Dividend")
    far = tx(store, "BETA - Beta Declares Quarterly Dividend", ms=T0 + 60 * MIN)
    fmp(env, "Acme Declares Quarterly Dividend", ["ACME"], pub_ms=T0 - 5 * MIN,
        url="https://www.globenewswire.com/news-release/2026/10/29/1/0/en/Acme-Declares-Quarterly-Dividend.html")
    fmp(env, "Beta Declares Quarterly Dividend", ["BETA"], pub_ms=T0 + 40 * MIN, ing_ms=T0 + 50 * MIN,
        url="https://www.globenewswire.com/news-release/2026/10/29/2/0/en/Beta-Declares-Quarterly-Dividend.html")
    resolver(store, now=T0 + 70 * MIN).run_pass()
    got = {r[0] for r in link_rows(store)}
    assert near in got and far not in got          # 20 min off: fine for long titles, not for 4 words
    assert ("fmp", "fmp_exact_time_off") in shadow(store, far)


def test_a_record_far_from_the_arrival_time_is_not_linked(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"], pub_ms=T0 - 26 * 60 * MIN, ing_ms=T0 - 25 * 60 * MIN)   # yesterday's release
    resolver(store).run_pass()
    assert link_rows(store) == []
    assert eid not in {r[0] for r in link_rows(store)}


def test_x_posts_and_non_wire_sources_are_never_accepted(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"], provider="x", cls="social", publisher="@somebody", url="https://x.com/somebody/status/1")
    fmp(env, TITLE, ["ACME"], cls="journalism", publisher="Benzinga",
        url="https://www.benzinga.com/pressreleases/26/10/acme-corp-reports-third-quarter-2026-results")
    resolver(store).run_pass()
    assert link_rows(store) == []


@pytest.mark.parametrize("url", [
    "http://www.globenewswire.com/news-release/2026/10/29/1/0/en/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "javascript:alert(1)",
    "https://user:pw@www.globenewswire.com/news-release/x/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "https://www.globenewswire.com:8443/news-release/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "https://globenewswire.com.evil.example/news-release/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "https://www.prnewswire.com/news-releases/acme-corp-reports-third-quarter-2026-results-1.html",   # host != publisher
    "https://www.globenewswire.com/news-release/Acme Corp.html",
    'https://www.globenewswire.com/news-release/"><script>.html',
    "https://www.globenewswire.com/" + "a" * 1100,
    "https://www.globenewswire.com/",
    "https://www.globenewswire.com/news-release/2026/10/29/1/0/en/Zeta-Unrelated-Merger-Agreement-Signed.html",  # slug != title
])
def test_unsafe_or_unassociated_urls_are_refused(store, env, url):
    tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"], url=url)
    resolver(store).run_pass()
    assert link_rows(store) == []


def test_safe_url_keeps_a_good_url_byte_for_byte():
    assert rl.safe_url(GNW, rl.WIRE_HOSTS["GlobeNewswire"]) == GNW
    assert rl.safe_url(GNW, rl.WIRE_HOSTS["Business Wire"]) is None
    assert rl.safe_url(None, ("x.com",)) is None


def test_other_sources_are_never_considered(store, env):
    eid = tx(store, f"ACME - {TITLE}", source="TX-News")
    fmp(env, TITLE, ["ACME"])
    resolver(store).run_pass()
    assert link_rows(store) == [] and rl.lookup(eid) is None


def test_company_news_missing_skips_fmp_without_failing(store, env, monkeypatch):
    tx(store, f"ACME - {TITLE}")
    st = rl.Resolver(store, now_ms=lambda: NOW, cn_connect=lambda: None).run_pass()
    assert st.get("fmp_db_unavailable") and link_rows(store) == []


def test_the_resolver_never_writes_company_news(store, env):
    tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    before = pathlib.Path(env).read_bytes()
    resolver(store).run_pass()
    assert pathlib.Path(env).read_bytes() == before


def test_the_headline_archive_is_unchanged(store, env):
    tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    dump = lambda: store._conn().execute("SELECT * FROM headlines ORDER BY seq").fetchall()  # noqa: E731
    led = lambda: store._conn().execute("SELECT * FROM deliveries ORDER BY event_id").fetchall()  # noqa: E731
    h, d = dump(), led()
    resolver(store).run_pass()
    assert dump() == h and led() == d


# ── SEC EDGAR ────────────────────────────────────────────────────────────────

CIK = 1234567
ACC = "0001234567-26-000123"


class FakeSec:
    def __init__(self, exhibit: str, accepted_ms: int = T0 + 4 * MIN, form="8-K", fail=None, tickers=None):
        self.exhibit, self.accepted, self.form, self.fail = exhibit, accepted_ms, form, fail
        self.tickers = tickers or {"0": {"ticker": "ACME", "cik_str": CIK}}
        self.urls = []

    def __call__(self, url, max_bytes):
        from api.services.fundamentals_pit.sec_client import SecError
        self.urls.append(url)
        if self.fail and self.fail(url):
            raise SecError(url, 503, "unavailable")
        if url.endswith("company_tickers.json"):
            return json.dumps(self.tickers).encode()
        if "/submissions/" in url:
            acc = datetime.fromtimestamp(self.accepted / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            return json.dumps({"filings": {"recent": {"form": ["4", self.form], "acceptanceDateTime": [acc, acc],
                                                      "accessionNumber": ["x", ACC], "primaryDocument": ["f4.xml", "d8k.htm"]}}}).encode()
        if url.endswith("index.json"):
            return json.dumps({"directory": {"item": [{"name": "d8k.htm"}, {"name": "ex99-1.htm"}, {"name": "R1.xml"}]}}).encode()
        if url.endswith("ex99-1.htm"):
            return self.exhibit.encode()
        raise SecError(url, 404, "not found")


def sec_res(store, fake, now=T0 + 50 * MIN):
    return resolver(store, now=now, sec=rl.SecLookup(get=fake))


EXHIBIT = (f"<html><body><p>Exhibit 99.1</p><p><b>{TITLE.upper()}</b></p>"
           "<p>CITY, Oct. 29, 2026 -- Acme Corp today reported ...</p></body></html>")


def test_sec_exhibit_with_the_exact_title_is_linked_as_an_sec_filing(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fake = FakeSec(EXHIBIT)
    st = sec_res(store, fake).run_pass()
    assert st["sec_linked"] == 1
    url = f"https://www.sec.gov/Archives/edgar/data/{CIK}/{ACC.replace('-', '')}/ex99-1.htm"
    assert link_rows(store) == [(eid, "sec_filing", url, "SEC EDGAR", rl.TIER_SEC_EXACT)]
    assert url in fake.urls                         # the link is the document we fetched and read


def test_sec_waits_for_fmp_first(store, env):
    tx(store, f"ACME - {TITLE}")
    fake = FakeSec(EXHIBIT)
    assert sec_res(store, fake, now=T0 + 20 * MIN).run_pass()["sec_checked"] == 0
    assert fake.urls == []


def test_fmp_wins_when_both_could_link(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    sec_res(store, FakeSec(EXHIBIT)).run_pass()
    assert link_rows(store)[0][1] == "original_release" and link_rows(store)[0][0] == eid


def test_sec_word_overlap_without_the_exact_title_is_shadow_only(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    ex = ("<p>Acme Corp Third Quarter 2026: Reports Record Results</p>"
          "<p>Acme Corp reported third quarter 2026 results today.</p>")
    sec_res(store, FakeSec(ex)).run_pass()
    assert link_rows(store) == [] and ("sec", "sec_containment") in shadow(store, eid)


def test_sec_title_deep_in_the_exhibit_is_not_exact(store, env):
    tx(store, f"ACME - {TITLE}")
    ex = "<p>" + ("filler words here " * 400) + f"</p><p>{TITLE}</p>"
    sec_res(store, FakeSec(ex)).run_pass()
    assert all(r[1] != "sec_filing" for r in link_rows(store))


def test_sec_filing_outside_the_window_is_ignored(store, env):
    tx(store, f"ACME - {TITLE}")
    sec_res(store, FakeSec(EXHIBIT, accepted_ms=T0 - 10 * 60 * MIN)).run_pass()
    assert link_rows(store) == []


def test_sec_short_titles_are_never_exact(store, env):
    tx(store, "ACME - Acme Updates Guidance")
    sec_res(store, FakeSec("<p>Acme Updates Guidance</p>")).run_pass()
    assert link_rows(store) == []


def test_sec_uses_the_issuer_slot_not_a_mentioned_company(store, env):
    """'ACME - ... with Megacorp': the SEC search is ACME's, never Megacorp's."""
    tx(store, f"ACME - {TITLE}", tickers=["ACME", "MEGA"])
    fake = FakeSec(EXHIBIT, tickers={"0": {"ticker": "MEGA", "cik_str": 999}})
    sec_res(store, fake).run_pass()
    assert link_rows(store) == [] and not any("/submissions/" in u for u in fake.urls)


def test_sec_transport_errors_retry_with_a_bound(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fake = FakeSec(EXHIBIT, fail=lambda u: "/submissions/" in u)
    r = sec_res(store, fake)
    for i in range(rl.SEC_MAX_ATTEMPTS + 3):
        r._now = lambda i=i: T0 + 50 * MIN + i * rl.SEC_RETRY_MS
        r.run_pass()
    att, nxt, status = store._conn().execute(
        "SELECT sec_attempts, sec_next_ms, status FROM release_link_state WHERE event_id=?", (eid,)).fetchone()
    assert att == rl.SEC_MAX_ATTEMPTS and nxt is None and link_rows(store) == []


def test_sec_budget_bounds_requests_per_pass(store, env):
    for i in range(30):
        tx(store, f"ACME - Acme Corp Announces Item Number {i} Of A Long Series Today")
    fake = FakeSec("<p>nothing</p>")
    r = sec_res(store, fake)
    r.run_pass(sec_budget=7)
    assert len(fake.urls) <= 7


def test_sec_off_leaves_rows_pending_for_later(store, env, monkeypatch):
    eid = tx(store, f"ACME - {TITLE}", ms=T0 - 5 * 86_400_000)
    monkeypatch.setenv("TXN_RELEASE_LINKS_SEC_ENABLED", "0")
    fake = FakeSec(EXHIBIT, accepted_ms=T0 - 5 * 86_400_000 + 4 * MIN)
    sec_res(store, fake).run_pass()
    assert fake.urls == []
    assert store._conn().execute("SELECT status FROM release_link_state WHERE event_id=?", (eid,)).fetchone()[0] == "pending"
    monkeypatch.setenv("TXN_RELEASE_LINKS_SEC_ENABLED", "1")
    sec_res(store, fake).run_pass()
    assert link_rows(store) and link_rows(store)[0][1] == "sec_filing"


def test_historical_catch_up_and_exhaustion(store, env):
    old = T0 - 10 * 86_400_000
    eid = tx(store, f"ACME - {TITLE}", ms=old)
    fake = FakeSec("<p>unrelated</p>", accepted_ms=old + 4 * MIN)
    r = sec_res(store, fake, now=T0)
    r.run_pass()
    assert store._conn().execute("SELECT status FROM release_link_state WHERE event_id=?", (eid,)).fetchone()[0] == "exhausted"
    n = len(fake.urls)
    r.run_pass()
    assert len(fake.urls) == n                      # exhausted rows are never fetched again


# ── rails ────────────────────────────────────────────────────────────────────

def test_first_id_since_finds_the_first_row_stored_at_or_after(env):
    ids = [fmp(env, f"Row {i} headline words", ["ACME"], ing_ms=T0 + i * MIN,
               url=f"https://www.globenewswire.com/news-release/{i}/Row-{i}-headline-words.html") for i in range(40)]
    cn = sqlite3.connect(env)
    try:
        for k in (0, 1, 17, 39):
            assert rl._first_id_since(cn, iso_utc(T0 + k * MIN)) == ids[k]
        assert rl._first_id_since(cn, iso_utc(T0 + 99 * MIN)) == ids[-1] + 1     # nothing that new
    finally:
        cn.close()



def test_snapshot_reports_tiers_state_and_shadow(store, env):
    tx(store, f"ACME - {TITLE}")
    tx(store, "BETA - Beta Inc Reports Third Quarter 2026 Results Today", tickers=["BETA"])
    fmp(env, TITLE, ["ACME"])
    fmp(env, "Beta Inc Reports Third Quarter 2026 Results Today", ["BETAF"],
        url="https://www.globenewswire.com/news-release/2026/10/29/9/0/en/Beta-Inc-Reports-Third-Quarter-2026-Results-Today.html")
    resolver(store).run_pass()
    snap = rl.snapshot(store)
    assert snap["by_tier"] == {rl.TIER_FMP_EXACT: 1}
    assert snap["shadow"] == {"fmp_exact_ticker_disagree": 1}
    assert snap["state"]["linked"] == 1


def test_the_module_never_deletes():
    src = (REPO / "api/services/trade_exchange_news/release_links.py").read_text(encoding="utf-8")
    assert "DELETE" not in src.upper().replace("NEVER REPLACED OR DELETED", "")


def test_no_matching_happens_on_read(monkeypatch, store, env):
    """headline_event must not reach company news, SEC or any matcher."""
    eid = tx(store, f"ACME - {TITLE}")
    for name in ("decide_fmp", "decide_sec", "_fmp_candidates", "_company_news_ro"):
        monkeypatch.setattr(rl, name, lambda *a, **k: (_ for _ in ()).throw(AssertionError("matched on read")))
    row = store.after(0, 1)[0]
    assert row["event_id"] == eid
    pl.headline_event(row, store.epoch, derived={})


# ── 2026-11-01 review follow-ups ─────────────────────────────────────────────

@pytest.mark.parametrize("content, syms, body", [
    ("APPN APPN - Appian Marks Major Milestone", {"APPN"}, "Appian Marks Major Milestone"),
    ("DCOM DCOM-P DCBG - Dime Declares Dividend", {"DCOM", "DCOM-P", "DCBG"}, "Dime Declares Dividend"),
    ("BH BH-A - BIGLARI HOLDINGS INC. NEWS RELEASE", {"BH", "BH-A"}, "BIGLARI HOLDINGS INC. NEWS RELEASE"),
    ("ACME, BETA - Acme and Beta Merge", {"ACME", "BETA"}, "Acme and Beta Merge"),
    ("$ACME - Acme Reports", {"ACME"}, "Acme Reports"),
    ("PATK - ROCKFORD FOSGATE PROMOTES A VP - REGION", {"PATK"}, "ROCKFORD FOSGATE PROMOTES A VP - REGION"),
    ("Acme Corp Reports Results", set(), "Acme Corp Reports Results"),
    ("THE REALREAL ANNOUNCES RESULTS", set(), "THE REALREAL ANNOUNCES RESULTS"),
])
def test_split_slot_reads_every_slot_shape(content, syms, body):
    assert rl.split_slot(content) == (syms, body)


def test_a_repeated_symbol_slot_is_an_exact_match(store, env):
    """60+ of the 74 'close wording' rows of the 2026-11-01 review were this."""
    eid = tx(store, f"ACME ACME ACME-P - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    resolver(store).run_pass()
    assert link_rows(store)[0][0] == eid


def test_html_entities_in_the_tx_headline_still_match_exactly(store, env):
    title = "Floor & Decor Announces Board Leadership Transition"
    eid = tx(store, "FND - Floor &amp; Decor Announces Board Leadership Transition")
    fmp(env, title, ["FND"], url="https://www.businesswire.com/news/home/20261029000009/en/Floor-Decor-Announces-Board-Leadership-Transition",
        publisher="Business Wire")
    resolver(store).run_pass()
    assert link_rows(store)[0][0] == eid


def test_a_sibling_company_with_near_identical_wording_is_never_linked(store, env):
    """The review's false positives: MSG Rangers vs MSG Knickerbockers (both in the
    slot) and Medallion Financial vs Medallion Bank."""
    eid = tx(store, "MSGR MSGK - MSG Rangers Corp. to Release Fiscal 2027 First Quarter Results")
    knicks = "https://www.businesswire.com/news/home/1/en/MSG-Knickerbockers-Corp.-to-Release-Fiscal-2027-First-Quarter-Results"
    rangers = "https://www.businesswire.com/news/home/2/en/MSG-Rangers-Corp.-to-Release-Fiscal-2027-First-Quarter-Results"
    fmp(env, "MSG Knickerbockers Corp. to Release Fiscal 2027 First Quarter Results", ["MSGK"], url=knicks, publisher="Business Wire")
    fmp(env, "MSG Rangers Corp. to Release Fiscal 2027 First Quarter Results", ["MSGR"], url=rangers, publisher="Business Wire")
    m = tx(store, "MFIN - Medallion Financial Corp. Reports 2026 Third Quarter Results")
    fmp(env, "Medallion Bank Reports 2026 Third Quarter Results and Declares Series G Preferred Stock Dividend", ["MFIN"],
        url="https://www.globenewswire.com/news-release/2026/10/29/5/0/en/Medallion-Bank-Reports-2026-Third-Quarter-Results.html")
    resolver(store).run_pass()
    got = {r[0]: r[2] for r in link_rows(store)}
    assert got == {eid: rangers} and m not in got
    assert ("fmp", "fmp_fuzzy_ticker") in shadow(store, m)


def test_a_plausible_url_on_a_record_that_does_not_match_is_not_linked(store, env):
    """The URL's slug spells the TX headline, but the RECORD's headline differs: a
    link is never accepted because its URL looks right."""
    tx(store, f"ACME - {TITLE}")
    fmp(env, "Acme Corp Schedules Investor Day", ["ACME"], url=GNW)
    resolver(store).run_pass()
    assert link_rows(store) == []


def test_two_rows_with_the_same_url_are_one_release(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    fmp(env, TITLE, ["ACME"], pub_ms=T0 - 2 * MIN)       # the same article from FMP's other lane
    resolver(store).run_pass()
    assert link_rows(store)[0][:3] == (eid, "original_release", GNW)


def test_too_many_identical_headlines_never_link(store, env, monkeypatch):
    monkeypatch.setattr(rl, "HK_MAX", 3)
    tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    for i in range(4):
        fmp(env, TITLE, [f"X{i}"], url=GNW.replace("3176543", f"99{i}"))
    resolver(store).run_pass()
    assert link_rows(store) == []


def _scramble_ids(cn_path, n=60):
    """Rows inserted AFTER the candidates but stamped long BEFORE them: the
    ingested_at/id order the binary search assumes is broken."""
    c = sqlite3.connect(cn_path)
    for i in range(n):
        c.execute("INSERT INTO news_items(provider, provider_id, source_display, source_class, url, headline, "
                  "headline_key, published_at, ingested_at) VALUES ('fmp', ?, 'GlobeNewswire', 'wire', ?, ?, '', ?, ?)",
                  (f"old{i}", f"https://www.globenewswire.com/old/{i}", f"Old {i}", iso_utc(T0 - 40 * 3600_000),
                   iso_utc(T0 - 40 * 3600_000)))
    c.commit()
    c.close()


def test_acceptance_does_not_depend_on_the_row_id_invariant(store, env):
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])                              # low id, in window
    _scramble_ids(env)
    cn = sqlite3.connect(env)
    try:                                                   # the id bound now EXCLUDES the candidate...
        lo = iso_utc(T0 - 6 * 3600_000 - rl.ID_BOUND_MARGIN_MS)
        assert rl._first_id_since(cn, lo) > 1
    finally:
        cn.close()
    resolver(store).run_pass()                             # ...and the exact match is still found
    assert link_rows(store)[0][0] == eid


def test_ambiguity_does_not_depend_on_the_row_id_invariant(store, env):
    tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"], url=GNW.replace("3176543", "111"))   # hidden below a broken id bound
    _scramble_ids(env)
    fmp(env, TITLE, ["ACME"])
    resolver(store).run_pass()
    assert link_rows(store) == []                          # still two URLs: ambiguous


@pytest.mark.parametrize("url", [
    "https://www.globenewsіre.com/news-release/Acme-Corp-Reports-Third-Quarter-2026-Results.html",   # Cyrillic i
    "https://www.globenewswire.com%2eevil.example/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "https://evil.example" + "\\" + "@www.globenewswire.com/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "https://www.globenewswire.com.@evil.example/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "https://www.globenewswire.com@evil.example/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "https://evil.example/https://www.globenewswire.com/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "//www.globenewswire.com/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
    "https:/www.globenewswire.com/Acme-Corp-Reports-Third-Quarter-2026-Results.html",
])
def test_lookalike_and_smuggled_hosts_are_refused(url):
    assert rl.safe_url(url, rl.WIRE_HOSTS["GlobeNewswire"]) is None


class _Resp:
    def __init__(self, url, body=b"{}"):
        self._u, self._b, self.headers = url, body, {}

    def geturl(self):
        return self._u

    def read(self, n=-1):
        return self._b

    def close(self):
        pass


def test_sec_documents_are_never_taken_from_a_redirect(monkeypatch):
    import urllib.request
    asked = "https://www.sec.gov/Archives/edgar/data/1/2/ex99-1.htm"
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: _Resp("https://evil.example/ex99.htm"))
    with pytest.raises(rl.RedirectRefused):
        rl._sec_get(asked, 1000)
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: _Resp(asked, b"ok"))
    assert rl._sec_get(asked, 1000) == b"ok"


def test_a_redirected_sec_fetch_is_an_error_not_a_link(store, env):
    tx(store, f"ACME - {TITLE}")
    fake = FakeSec(EXHIBIT)

    def redirected(url, max_bytes):
        if url.endswith("ex99-1.htm"):
            raise rl.RedirectRefused(url)
        return fake(url, max_bytes)
    st = resolver(store, now=T0 + 50 * MIN, sec=rl.SecLookup(get=redirected)).run_pass()
    assert st["sec_errors"] == 1 and link_rows(store) == []


# ── flags: independent, default off, reversible ─────────────────────────────

def test_every_flag_defaults_off(monkeypatch):
    from api.services.trade_exchange_news import config
    for k in ("TXN_RELEASE_LINKS_ENABLED", "TXN_RELEASE_LINKS_FMP_ENABLED", "TXN_RELEASE_LINKS_SEC_ENABLED",
              "TXN_RELEASE_LINKS_DISPLAY_ENABLED"):
        monkeypatch.delenv(k, raising=False)
    assert not any((config.release_links_enabled(), config.release_links_fmp_enabled(),
                    config.release_links_sec_enabled(), config.release_links_display_enabled()))


def test_fmp_off_skips_fmp_and_sec_still_runs_alone(store, env, monkeypatch):
    monkeypatch.setenv("TXN_RELEASE_LINKS_FMP_ENABLED", "0")
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    st = resolver(store, now=T0 + 50 * MIN, sec=rl.SecLookup(get=FakeSec(EXHIBIT))).run_pass()
    assert st.get("fmp_off") and st["fmp_checked"] == 0
    rows = link_rows(store)
    assert len(rows) == 1 and rows[0][0] == eid and rows[0][1] == "sec_filing"


def test_display_off_hides_every_link_and_publishes_nothing_but_keeps_them(store, env, monkeypatch):
    monkeypatch.setenv("TXN_RELEASE_LINKS_DISPLAY_ENABLED", "0")
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    pubs = []
    resolver(store, published=pubs).run_pass()
    row = store.after(0, 1)[0]
    assert len(link_rows(store)) == 1 and pubs == []
    assert rl.lookup(eid) is None and "link" not in pl.headline_event(row, store.epoch, derived={})
    monkeypatch.setenv("TXN_RELEASE_LINKS_DISPLAY_ENABLED", "1")
    assert pl.headline_event(row, store.epoch, derived={})["link"]["url"] == GNW


def test_a_pass_reports_its_longest_write_hold(store, env):
    for i in range(50):
        tx(store, f"ACME - Acme Corp Item {i} Announced Today For Everyone")
    st = resolver(store).run_pass()
    assert st["fmp_checked"] == 50 and 0 <= st["write_ms_max"] < 1000


def test_headline_ingest_proceeds_while_the_resolver_runs(store, env):
    """The resolver's writes are short transactions on its own connection; the
    single writer's ingest never fails behind them."""
    import threading
    for i in range(200):
        tx(store, f"ACME - Acme Corp Item {i} Announced Today For Everyone")
    r = resolver(store)
    t = threading.Thread(target=r.run_pass)
    t.start()
    ids = [tx(store, f"BETA - Beta Live Headline {i}", ms=NOW + i) for i in range(20)]
    t.join()
    got = {r_["event_id"] for r_ in store.after(0, 1000)}
    assert set(ids) <= got


# ── release-candidate QA follow-ups ──────────────────────────────────────────

def test_fmp_rechecks_rotate_when_more_rows_are_pending_than_the_batch(store, env):
    """More unlinked rows than the batch: every row is still re-checked on later
    polls (the least-checked first), not only the newest ``fmp_batch``."""
    ids = [tx(store, f"ACME - Acme Corp Announces Unrelated Item Number {i} Today", ms=T0 + i * MIN) for i in range(5)]
    r = resolver(store, now=T0 + 30 * MIN)
    for k in range(6):
        poll(env, f"2026-10-29T20:{10 + k:02d}:00+00:00")
        r.run_pass(fmp_batch=3)
    passes = dict(store._conn().execute("SELECT event_id, fmp_passes FROM release_link_state").fetchall())
    assert all(passes[i] >= 3 for i in ids), passes


def test_a_row_past_the_fmp_window_gets_its_final_check_ahead_of_fresh_rows(store, env):
    old = tx(store, "ACME - Acme Corp Announces An Older Unrelated Item Today", ms=T0 - 49 * 60 * MIN)
    for i in range(4):
        tx(store, f"ACME - Acme Corp Announces Fresh Unrelated Item {i} Today", ms=T0 + i * MIN)
    r = resolver(store, now=T0 + 30 * MIN)
    r.run_pass(fmp_batch=10)                       # first look at everything
    poll(env, "2026-10-29T20:30:00+00:00")
    r.run_pass(fmp_batch=1)                        # one re-check: the expired row's last one
    final = store._conn().execute("SELECT fmp_final FROM release_link_state WHERE event_id=?", (old,)).fetchone()[0]
    assert final == 1


def test_sec_live_schedule_goes_ahead_of_the_historical_backlog(store, env):
    old = T0 - 10 * 86_400_000
    for i in range(60):
        tx(store, f"ACME - Acme Corp Announces Archived Item Number {i} Today", ms=old + i * MIN)
    fresh = tx(store, f"ACME - {TITLE}")
    st = sec_res(store, FakeSec(EXHIBIT)).run_pass(sec_budget=120)
    assert st["sec_linked"] == 1 and link_rows(store)[0][0] == fresh


def test_sec_submissions_cache_keeps_only_filtered_filings_and_is_bounded(monkeypatch):
    monkeypatch.setattr(rl, "SEC_SUB_CACHE_MAX", 3)
    fake = FakeSec(EXHIBIT)
    sec = rl.SecLookup(get=fake)
    sec.budget = 100
    for cik in range(1, 8):
        assert [f["form"] for f in sec.filings(cik)] == ["8-K"]
    assert list(sec._subs) == [5, 6, 7]
    assert all(isinstance(v[1], list) for v in sec._subs.values())   # never the parsed JSON
    n = len(fake.urls)
    sec.filings(7)
    assert len(fake.urls) == n                                       # a cached issuer costs no request


def test_sec_budget_has_a_floor_so_one_headline_cannot_stall_the_queue(monkeypatch):
    from api.services.trade_exchange_news import config
    monkeypatch.setenv("TXN_RELEASE_LINKS_SEC_BUDGET", "0")
    assert config.release_links_sec_budget() == 20
    monkeypatch.setenv("TXN_RELEASE_LINKS_SEC_BUDGET", "500")
    assert config.release_links_sec_budget() == 120


def test_boot_with_the_resolver_off_creates_no_tables(store, env, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.delenv("TXN_RELEASE_LINKS_ENABLED", raising=False)
    rl.start(SimpleNamespace(store=store))
    try:
        names = {r[0] for r in store._conn().execute("SELECT name FROM sqlite_master")}
        assert not any(n.startswith("release_link") for n in names)
        assert rl._thread is None
    finally:
        rl.stop()


def test_boot_with_the_resolver_off_still_loads_links_stored_earlier(store, env, monkeypatch):
    from types import SimpleNamespace
    eid = tx(store, f"ACME - {TITLE}")
    fmp(env, TITLE, ["ACME"])
    resolver(store).run_pass()
    rl._LINKS.clear()
    monkeypatch.delenv("TXN_RELEASE_LINKS_ENABLED", raising=False)
    rl.start(SimpleNamespace(store=store))
    try:
        assert rl.lookup(eid)["url"] == GNW
    finally:
        rl.stop()


def test_a_restart_never_revives_the_previous_thread(store, env, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setenv("TXN_RELEASE_LINKS_ENABLED", "1")
    monkeypatch.setenv("TXN_RELEASE_LINKS_START_DELAY_S", "3600")
    pipe = SimpleNamespace(store=store)
    rl.start(pipe)
    first_stop, first_thread = rl._stop, rl._thread
    rl.stop()
    rl.start(pipe)
    try:
        assert first_stop.is_set() and not rl._stop.is_set()
        assert rl._thread is not first_thread and not first_thread.is_alive()
    finally:
        rl.stop()


def test_a_gzip_sec_response_is_inflated_with_the_cap(monkeypatch):
    """A small gzip download that inflates past the cap is refused; within the cap
    it arrives as plain bytes (the shared client never inflates it again)."""
    import gzip
    import urllib.request
    asked = "https://www.sec.gov/Archives/edgar/data/1/2/ex99-1.htm"

    def resp(body):
        r = _Resp(asked, gzip.compress(body))
        r.headers = {"Content-Encoding": "gzip"}
        return r

    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: resp(b"<p>ok</p>"))
    assert rl._sec_get(asked, 1000) == b"<p>ok</p>"
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: resp(b"a" * 50_000))
    with pytest.raises(ValueError):
        rl._sec_get(asked, 1000)


def _filler(chars):
    return "<p>" + ("routine words " * (chars // 14 + 1)) + "</p>"


def test_sec_title_must_start_near_the_top_of_the_document(store, env):
    """Within SEC_TITLE_HEAD it is the release; deeper (a main form that names the
    exhibit, a later filing quoting it) is shadow-only, never a link."""
    eid = tx(store, f"ACME - {TITLE}")
    sec_res(store, FakeSec(_filler(1200) + f"<p>{TITLE}</p>")).run_pass()
    assert link_rows(store) == [] and ("sec", "sec_exhibit_deep") in shadow(store, eid)


def test_sec_title_within_the_head_is_linked(store, env):
    tx(store, f"ACME - {TITLE}")
    sec_res(store, FakeSec(_filler(500) + f"<p>{TITLE}</p>")).run_pass()
    assert link_rows(store) and link_rows(store)[0][1] == "sec_filing"


LATER_EXHIBITS = {
    "opens with it": EXHIBIT,
    "repeats it further down": _filler(500) + f"<p>{TITLE}</p>",
    "combined heading": f"<p><b>{TITLE.upper()}; ACME CORP DECLARES QUARTERLY DIVIDEND</b></p>",
    "second heading line": f"<p><b>ACME CORP DECLARES QUARTERLY DIVIDEND</b></p><p><b>{TITLE.upper()}</b></p>",
    "highlights bullet": f"<p>Acme Corp Declares Dividend Today</p><ul><li>{TITLE}</li></ul>",
}


@pytest.mark.parametrize("shape", sorted(LATER_EXHIBITS))
def test_a_filing_more_than_6h_after_the_headline_is_never_linked(store, env, shape):
    """QA M2: a later filing with the exact headline may be a different release (a
    combined release, a highlights bullet, a recap). Text alone cannot always tell,
    so it is shadow-only, however it is laid out."""
    eid = tx(store, f"ACME - {TITLE}")
    later = T0 + rl.SEC_LINK_MAX_MS + 1 * MIN
    sec_res(store, FakeSec(LATER_EXHIBITS[shape], accepted_ms=later), now=later + 10 * MIN).run_pass()
    assert link_rows(store) == [] and ("sec", "sec_late_exact") in shadow(store, eid)


def test_a_filing_just_inside_6h_is_linked(store, env):
    tx(store, f"ACME - {TITLE}")
    at = T0 + rl.SEC_LINK_MAX_MS - 1 * MIN
    sec_res(store, FakeSec(EXHIBIT, accepted_ms=at), now=at + 10 * MIN).run_pass()
    assert link_rows(store) and link_rows(store)[0][1] == "sec_filing"


def test_css_and_head_text_never_push_the_title_down(store, env):
    tx(store, f"ACME - {TITLE}")
    ex = "<html><head><title>x</title><style>" + ("p { margin: 0 } " * 200) + "</style></head><body>" + EXHIBIT
    sec_res(store, FakeSec(ex)).run_pass()
    assert link_rows(store) and link_rows(store)[0][1] == "sec_filing"
