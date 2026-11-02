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
    monkeypatch.setenv("TXN_RELEASE_LINKS_SEC_ENABLED", "1")
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
