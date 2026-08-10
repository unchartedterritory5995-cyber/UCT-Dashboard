"""Cross-company transcript keyword alerts.

Every test writes to a tmp_path DB. The suite shares one `C:\\data\\auth.db`
because conftest doesn't isolate DB paths, so a service with its own store must
point somewhere disposable or it pollutes the real volume.
"""
import importlib

import pytest


@pytest.fixture
def ka(tmp_path, monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_ALERTS_DB_PATH", str(tmp_path / "kw.db"))
    monkeypatch.setenv("TRANSCRIPT_KEYWORD_ALERTS_ENABLED", "1")
    import api.services.transcript_keyword_alerts as m
    importlib.reload(m)          # DB_PATH is read at import
    m.init_db()
    return m


SEGMENTS = [
    {"speaker": "Operator", "content": "Welcome to the call."},
    {"speaker": "Hugh Johnston",
     "content": "Tariffs really have nothing to do with it. What is driving the "
                "performance is execution by the Parks team across both domestic "
                "and international parks this quarter."},
    {"speaker": "Josh D’Amaro",
     "content": "We are investing heavily in artificial intelligence across the "
                "studio pipeline, and tariff exposure remains immaterial."},
]
TRANSCRIPT = {"quarter": "2026Q3", "segments": SEGMENTS}


class TestNormalizeKeyword:
    def test_trims_and_lowercases(self, ka):
        assert ka.normalize_keyword("  Tariff  ") == "tariff"
        assert ka.normalize_keyword("SUPPLY   CHAIN") == "supply chain"

    def test_refuses_a_keyword_too_short_to_be_a_signal(self, ka):
        # A 2-character term matches on nearly every call, and an alert that
        # always fires is indistinguishable from no alert at all.
        assert ka.normalize_keyword("AI") is None
        assert ka.normalize_keyword("") is None
        assert ka.normalize_keyword(None) is None

    def test_refuses_an_absurdly_long_one(self, ka):
        assert ka.normalize_keyword("x" * 61) is None


class TestFindMentions:
    def test_finds_the_turn_the_speaker_and_a_readable_excerpt(self, ka):
        hits = ka.find_mentions("tariff", SEGMENTS)
        assert [h["segment"] for h in hits] == [1, 2]
        assert hits[0]["speaker"] == "Hugh Johnston"
        assert "nothing to do with it" in hits[0]["excerpt"]

    def test_matches_a_plural_without_matching_inside_another_word(self, ka):
        assert ka.find_mentions("tariff", SEGMENTS)          # "Tariffs" / "tariff"
        # "art" must not hit "artificial" — a substring match would make every
        # short keyword useless.
        assert ka.find_mentions("art", SEGMENTS) == []

    def test_is_case_insensitive(self, ka):
        assert len(ka.find_mentions("TARIFF", SEGMENTS)) == 2

    def test_counts_every_mention_but_reports_one_turn_each(self, ka):
        segs = [{"speaker": "CEO", "content": "Tariff, tariff, and more tariff."}]
        hits = ka.find_mentions("tariff", segs)
        assert len(hits) == 1 and hits[0]["count"] == 3

    def test_a_multi_word_phrase_tolerates_whitespace_differences(self, ka):
        segs = [{"speaker": "CFO", "content": "Our supply\n  chain held up well."}]
        assert ka.find_mentions("supply chain", segs)

    def test_no_match_and_junk_are_quiet(self, ka):
        assert ka.find_mentions("cryptocurrency", SEGMENTS) == []
        assert ka.find_mentions("", SEGMENTS) == []
        assert ka.find_mentions("tariff", []) == []


class TestSubscriptions:
    def test_add_list_remove(self, ka):
        assert ka.add_keyword("u1", " Tariff ") == "tariff"
        assert ka.list_keywords("u1") == ["tariff"]
        assert ka.remove_keyword("u1", "TARIFF") is True
        assert ka.list_keywords("u1") == []

    def test_adding_twice_is_idempotent(self, ka):
        ka.add_keyword("u1", "tariff"); ka.add_keyword("u1", "tariff")
        assert ka.list_keywords("u1") == ["tariff"]

    def test_a_user_cannot_subscribe_without_bound(self, ka):
        for i in range(ka.MAX_KEYWORDS_PER_USER):
            assert ka.add_keyword("u1", f"keyword{i:03d}") is not None
        assert ka.add_keyword("u1", "one-too-many") is None

    def test_subscriptions_are_keyed_by_keyword_so_one_scan_serves_everyone(self, ka):
        ka.add_keyword("u1", "tariff"); ka.add_keyword("u2", "tariff")
        ka.add_keyword("u2", "buyback")
        subs = ka.all_subscriptions()
        assert sorted(subs["tariff"]) == ["u1", "u2"]
        assert subs["buyback"] == ["u2"]


class TestDedup:
    def test_fires_once_per_user_keyword_symbol_quarter(self, ka):
        assert ka.try_record_fire("u1", "tariff", "DIS", "2026Q3") is True
        assert ka.try_record_fire("u1", "tariff", "DIS", "2026Q3") is False

    def test_a_NEW_quarter_is_a_new_event(self, ka):
        ka.try_record_fire("u1", "tariff", "DIS", "2026Q3")
        assert ka.try_record_fire("u1", "tariff", "DIS", "2026Q4") is True

    def test_another_company_saying_it_is_a_new_event(self, ka):
        ka.try_record_fire("u1", "tariff", "DIS", "2026Q3")
        assert ka.try_record_fire("u1", "tariff", "AAPL", "2026Q3") is True

    def test_one_users_alert_never_silences_another(self, ka):
        ka.try_record_fire("u1", "tariff", "DIS", "2026Q3")
        assert ka.try_record_fire("u2", "tariff", "DIS", "2026Q3") is True


class TestScan:
    def test_delivers_one_alert_per_subscriber_carrying_the_evidence(self, ka):
        ka.add_keyword("u1", "tariff"); ka.add_keyword("u2", "tariff")
        sent = []
        n = ka.scan_transcript("DIS", TRANSCRIPT, ka.all_subscriptions(),
                               deliver=lambda **kw: sent.append(kw))
        assert n == 2
        assert {s["user_id"] for s in sent} == {"u1", "u2"}
        one = sent[0]
        assert one["sym"] == "DIS"
        assert "tariff" in one["title"] and "2026Q3" in one["title"]
        assert one["extra_data"]["mentions"] == 2      # two turns, one hit each
        assert one["extra_data"]["segment"] == 1       # jump target
        assert "Hugh Johnston" in one["message"]

    def test_a_re_scan_of_the_same_call_stays_silent(self, ka):
        ka.add_keyword("u1", "tariff")
        subs = ka.all_subscriptions()
        sent = []
        ka.scan_transcript("DIS", TRANSCRIPT, subs, deliver=lambda **k: sent.append(k))
        ka.scan_transcript("DIS", TRANSCRIPT, subs, deliver=lambda **k: sent.append(k))
        assert len(sent) == 1

    def test_an_unmentioned_keyword_never_fires(self, ka):
        ka.add_keyword("u1", "cryptocurrency")
        sent = []
        assert ka.scan_transcript("DIS", TRANSCRIPT, ka.all_subscriptions(),
                                  deliver=lambda **k: sent.append(k)) == 0
        assert sent == []

    def test_one_failing_delivery_does_not_abort_the_others(self, ka):
        ka.add_keyword("u1", "tariff"); ka.add_keyword("u2", "tariff")
        sent = []
        def flaky(**kw):
            if kw["user_id"] == "u1":
                raise RuntimeError("smtp down")
            sent.append(kw)
        ka.scan_transcript("DIS", TRANSCRIPT, ka.all_subscriptions(), deliver=flaky)
        assert [s["user_id"] for s in sent] == ["u2"]


class TestRunScan:
    def test_is_inert_until_the_flag_is_set(self, ka, monkeypatch):
        monkeypatch.delenv("TRANSCRIPT_KEYWORD_ALERTS_ENABLED", raising=False)
        called = []
        assert ka.run_scan(["DIS"], fetch=lambda s: called.append(s)) == {"skipped": "disabled"}
        assert not called, "fetched a transcript while disabled"

    def test_does_no_provider_work_when_nobody_subscribes(self, ka):
        called = []
        out = ka.run_scan(["DIS", "AAPL"], fetch=lambda s: called.append(s))
        assert out["fired"] == 0 and not called

    def test_scans_each_symbol_and_reports_what_it_did(self, ka):
        ka.add_keyword("u1", "tariff")
        out = ka.run_scan(["DIS", "AAPL"], fetch=lambda s: TRANSCRIPT)
        assert out["scanned"] == 2
        assert out["fired"] == 2       # same keyword, two different companies
        assert out["keywords"] == 1

    def test_one_unreachable_symbol_does_not_abort_the_sweep(self, ka):
        ka.add_keyword("u1", "tariff")
        def fetch(sym):
            if sym == "BAD":
                raise RuntimeError("provider down")
            return TRANSCRIPT
        out = ka.run_scan(["BAD", "DIS"], fetch=fetch)
        assert out["scanned"] == 1 and out["fired"] == 1

    def test_a_symbol_with_no_transcript_is_skipped_quietly(self, ka):
        ka.add_keyword("u1", "tariff")
        out = ka.run_scan(["NONE"], fetch=lambda s: None)
        assert out == {"scanned": 0, "fired": 0, "keywords": 1}


class TestReporterSelection:
    def test_reads_ALL_THREE_buckets_including_amc_tonight(self, ka):
        # amc_tonight is the set that just reported after today's close, whose
        # transcripts publish ~2h later — i.e. exactly what an 18:30 ET scan is
        # for. Reading only bmo+amc would scan yesterday and miss tonight.
        earnings = {
            "bmo": [{"sym": "jpm"}],
            "amc": [{"sym": "AAPL"}],
            "amc_tonight": [{"sym": "DIS"}],
        }
        assert ka.reporters_from_earnings(earnings) == ["JPM", "AAPL", "DIS"]

    def test_dedupes_a_symbol_appearing_in_two_buckets(self, ka):
        assert ka.reporters_from_earnings(
            {"bmo": [{"sym": "DIS"}], "amc_tonight": [{"sym": "DIS"}]}) == ["DIS"]

    def test_survives_ragged_payloads(self, ka):
        assert ka.reporters_from_earnings({}) == []
        assert ka.reporters_from_earnings(None) == []
        assert ka.reporters_from_earnings(
            {"bmo": [None, {}, {"sym": ""}, "junk", {"sym": "DIS"}]}) == ["DIS"]


class TestIndexBackedScan:
    """The calendar path reaches ≤45 symbols; the index holds ~1,500 calls.

    `engine._normalize_earnings` caps each reporter bucket at 15, and the module
    has documented that bound since it was written. These pin the wider net —
    and, more importantly, that a wider net does not mean repeat alerts.
    """

    class _Index:
        def __init__(self, hits): self._hits = hits
        def search(self, kw, limit=200, since=None):
            self.last = {"kw": kw, "since": since}
            return {"hits": self._hits.get(kw, [])}

    def _hit(self, sym, year=2026, q=3, snippet="on <mark>tariff</mark> costs"):
        return {"symbol": sym, "year": year, "quarter": q,
                "date": "2026-08-09", "snippet": snippet}

    def test_one_query_per_KEYWORD_not_per_company(self, ka):
        # The old shape fetched N transcripts and matched every keyword against
        # each. Cost should track subscriptions, not how busy the tape was.
        idx = self._Index({"tariff": [self._hit("AAPL"), self._hit("MSFT")]})
        queries = []
        orig = idx.search
        def spy(kw, **kw2):
            queries.append(kw); return orig(kw, **kw2)
        idx.search = spy
        out = ka.run_scan_via_index(index=idx, deliver=lambda **k: None,
                                    subs={"tariff": ["u1"]})
        assert queries == ["tariff"]
        assert out["hits"] == 2 and out["fired"] == 2

    def test_strips_the_FTS_highlight_markup_from_the_alert_body(self, ka):
        # Snippets carry <mark> from FTS5; an email is plain text and would
        # render the tags literally.
        sent = []
        idx = self._Index({"tariff": [self._hit("AAPL")]})
        ka.run_scan_via_index(index=idx, subs={"tariff": ["u1"]},
                              deliver=lambda **k: sent.append(k))
        assert "<mark>" not in sent[0]["message"]
        assert "tariff" in sent[0]["message"]

    def test_a_RE_SCAN_does_not_realert(self, ka):
        # The whole risk of a wider net: dedup on (user, keyword, symbol,
        # quarter) is what stops the same call firing twice.
        idx = self._Index({"tariff": [self._hit("AAPL")]})
        first = ka.run_scan_via_index(index=idx, subs={"tariff": ["u1"]},
                                      deliver=lambda **k: None)
        second = ka.run_scan_via_index(index=idx, subs={"tariff": ["u1"]},
                                       deliver=lambda **k: None)
        assert first["fired"] == 1
        assert second["fired"] == 0, "a re-scan re-alerted the same call"

    def test_looks_back_a_DAY_not_only_today(self, ka):
        # A 16:30 ET call publishes its transcript ~2h later; a same-day window
        # would miss every one of them on the 18:30 run that matters most.
        import datetime
        idx = self._Index({"tariff": []})
        ka.run_scan_via_index(index=idx, subs={"tariff": ["u1"]},
                              deliver=lambda **k: None)
        expected = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        assert idx.last["since"] == expected

    def test_no_subscriptions_is_a_no_op_not_a_sweep(self, ka):
        out = ka.run_scan_via_index(index=self._Index({}), subs={},
                                    deliver=lambda **k: None)
        assert out["fired"] == 0

    def test_a_failing_index_query_does_not_abort_the_other_keywords(
            self, ka):

        class _Flaky:
            def search(self, kw, limit=200, since=None):
                if kw == "boom":
                    raise RuntimeError("fts exploded")
                return {"hits": [{"symbol": "AAPL", "year": 2026, "quarter": 3,
                                  "date": "2026-08-09", "snippet": "ok"}]}

        out = ka.run_scan_via_index(index=_Flaky(),
                                    subs={"boom": ["u1"], "fine": ["u1"]},
                                    deliver=lambda **k: None)
        assert out["fired"] == 1

    def test_a_failing_DELIVERY_does_not_abort_the_rest(self, ka):
        calls = []

        def deliver(**k):
            calls.append(k)
            if k["sym"] == "AAPL":
                raise RuntimeError("smtp down")

        idx = self._Index({"tariff": [self._hit("AAPL"), self._hit("MSFT")]})
        out = ka.run_scan_via_index(index=idx, subs={"tariff": ["u1"]},
                                    deliver=deliver)
        assert len(calls) == 2 and out["fired"] == 1
