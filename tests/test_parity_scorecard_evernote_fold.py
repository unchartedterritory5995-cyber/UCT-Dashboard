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
