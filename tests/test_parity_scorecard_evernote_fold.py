"""Rails for the wave-10 Evernote fold in tools/parity_scorecard.py (lane 10E-1).

The controller's help-centre research (docs/notebook/proof/evernote-evidence-2026-09-26.jsonl)
carries 9 verbatim quotes and 40 paraphrases. A paraphrase is never entered into QUOTES: every
QUOTES entry read from that research ("browser-read" sources) must be, character for character,
the non-null quote the committed evidence file records for its URL.
"""
from __future__ import annotations

from tools import parity_scorecard as S


def test_the_evidence_file_holds_the_nine_quotes_and_forty_paraphrases():
    ev = S.evernote_evidence()
    assert len(ev) == 49
    assert sum(1 for r in ev if r.get('quote')) == 9
    assert sum(1 for r in ev if not r.get('quote')) == 40


def test_every_browser_read_quote_is_the_evidence_file_s_own_words():
    keys = [k for k, (pid, _q) in S.QUOTES.items() if S.SOURCES[pid].get('kind') == 'browser-read']
    assert len(keys) == 9, keys            # non-vacuity: the check below has nine quotes to judge
    assert S.browser_read_problems() == []


def test_a_paraphrase_entered_as_a_quote_is_refused():
    ev = S.evernote_evidence()
    para = next(r for r in ev if not r.get('quote'))
    text = para.get('paraphrase') or para.get('note')
    pid = 'evernote_help__planted'
    sources = {pid: {'vendor': 'evernote', 'kind': 'browser-read', 'public_url': para['url']}}
    got = S.browser_read_problems(quotes={'E_planted': [pid, text]}, sources=sources, evidence=ev)
    assert got and got[0][0] == 'E_planted', got


def test_an_edited_quote_is_refused():
    ev = S.evernote_evidence()
    q = next(r for r in ev if r.get('quote'))
    pid = 'evernote_help__planted'
    sources = {pid: {'vendor': 'evernote', 'kind': 'browser-read', 'public_url': q['url']}}
    got = S.browser_read_problems(quotes={'E_planted': [pid, q['quote'] + ' and more']}, sources=sources, evidence=ev)
    assert got, 'a quote that is not the evidence file\'s exact words passed'


# ── wave 12, lane 12C phase 1: a FETCHED verbatim quote supersedes a paraphrase; nothing else does ──

def test_a_fetched_quote_supersedes_a_paraphrase_and_a_browser_read_or_a_string_does_not():
    fetched = {'src_f': {'vendor': 'evernote', 'status': 200, 'sha256': 'ab' * 32, 'public_url': 'https://x/f'}}
    browser = {'src_b': {'vendor': 'evernote', 'kind': 'browser-read', 'status': 200, 'sha256': 'cd' * 32,
                          'public_url': 'https://x/b'}}   # 200 + sha on purpose: only the kind may refuse it
    unhashed = {'src_u': {'vendor': 'evernote', 'status': 200, 'sha256': None, 'public_url': 'https://x/u'}}
    sources = {**fetched, **browser, **unhashed}
    quotes = {'Q_f': ['src_f', 'a sentence'], 'Q_b': ['src_b', 'a sentence'], 'Q_u': ['src_u', 'a sentence']}
    sup = lambda cited: S.paraphrase_superseded(cited, quotes=quotes, sources=sources)
    assert sup(['Q_f'])                                   # the control: the one case that supersedes
    assert not sup(['Q_b'])                               # a browser read is checked against the evidence file instead
    assert not sup(['Q_f', 'Q_b'])                        # one browser-read quote is enough to keep the old rule
    assert not sup(['Q_u'])                               # a 200 with no sha256 of the bytes is not a recorded fetch
    assert not sup('not verified — a reason')             # a string cell never supersedes anything
    assert not sup([])


def test_every_r18_quote_is_cut_from_a_recorded_fetch():
    r18 = {pid: m for pid, m in S.SOURCES.items() if m.get('rrow') == 'R18'}
    assert len(r18) >= 20, len(r18)                      # non-vacuity: lane 12C's pass is in the manifest
    for pid, m in r18.items():
        assert m['status'] == 200 and m.get('kind') != 'browser-read', pid
        assert len(m['sha256']) == 64 and int(m['sha256'], 16) >= 0, pid
        assert m['fetched_utc'].startswith('2026-10-02T') and m['fetched_utc'].endswith('Z'), pid
    keys = [k for k, (pid, _q) in S.QUOTES.items() if pid in r18]
    assert len(keys) >= 30, len(keys)
    assert all(len(S.QUOTES[k][1].split()) <= 25 for k in keys)
