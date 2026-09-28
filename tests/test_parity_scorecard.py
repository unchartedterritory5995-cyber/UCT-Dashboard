"""Rails on docs/notebook/parity-scorecard.md (wave 9, lane 9B, items B4, B5, B7).

The scorecard compares the Notebook with Notion, Evernote and Obsidian row by row. These rails
keep it honest mechanically: its row set IS the gap ledger's (both parsed, never a typed list),
every verdict is from the closed set, every row carries UCT evidence of a named kind, every repo
path it cites exists at HEAD, every competitor cell carries a URL and a date or says it is not
verified, a comparative verdict never stands on an uncited side, the 16 standards are the plan's
16, the headline counts only standards whose every clause is MET, and every cited URL is in the
citations index under a research-ledger R-row (so the 10% re-fetch control is mechanical).

Fix round 1 (controller, 2026-09-26): every cited file:line still holds its quoted fragment
(`tools/parity_scorecard.py --verify`, offline), with a control proving the check can refuse; and
the plan's "Now" cells carry exactly the scorecard's clause counts.

Fix round 2 (controller ruling, 2026-09-26): the scorecard is a MEASUREMENT AT A COMMIT, so the
citation rail checks at the revision the scorecard's own header records ("Document written at"),
parsed from its text here, never typed and never HEAD: an unrelated edit that moves a cited line
must not red it. A revision this clone does not hold fails as "unverifiable: <sha> not in this
clone"; unknown is never a pass.

Wave 10 re-score (follow-up F3, 2026-09-28): the flag records are read from `docs/feature_flags.json`
AT THE REVISION THE SCORECARD RECORDS (they read master's copy at be9ca78b6 before, which a later
flip made wrong), and a record naming any other revision is refused. §0, the evidence index, tests
provenance rather than ancestry (squash-landed waves are never ancestors of master): the tag pins the
recorded tip, the squash is an ancestor, the cited evidence is unchanged since it landed, and every
measured tree is reachable. Each of those four is shown failing on a planted defect below.
"""
from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCORECARD = REPO / 'docs' / 'notebook' / 'parity-scorecard.md'
LEDGER = REPO / 'docs' / 'notebook' / 'competitive-gap-ledger.md'
PLAN = REPO / 'docs' / 'notebook' / 'NOTEBOOK-10-OF-10-PLAN.md'
RESEARCH = REPO / 'docs' / 'notebook' / 'competitive-research-ledger.md'

_spec = importlib.util.spec_from_file_location('gap_ledger_summary_for_scorecard', REPO / 'tools' / 'gap_ledger_summary.py')
gls = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = gls
_spec.loader.exec_module(gls)

_pspec = importlib.util.spec_from_file_location('parity_scorecard_tool', REPO / 'tools' / 'parity_scorecard.py')
psc = importlib.util.module_from_spec(_pspec)
sys.modules[_pspec.name] = psc
_pspec.loader.exec_module(psc)

VERDICT = re.compile(r'^(AHEAD|PARITY|BEHIND|N/A|NOT-VERIFIED|OUT-OF-SCOPE \(D\d+\)|BLOCKED \((owner|external)\))$')
KINDS = re.compile(r'^(CODE|TEST|WALK|MEASURE|RECORD|RULING) ')
COLUMNS = ['ID', 'capability', 'ledger row', 'vs Notion', 'vs Evernote', 'vs Obsidian', 'UCT evidence',
           'competitor evidence', 'notes']


def _text(p: Path) -> str:
    return p.read_bytes().decode('utf-8').replace('\r\n', '\n')


def _section(text: str, heading_prefix: str) -> list[str]:
    lines = text.split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith('## ' + heading_prefix))
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
    return lines[start + 1:end]


def _cells(line: str) -> list[str]:
    return gls.split_cells(line)


def _a_rows() -> list[list[str]]:
    sec = _section(_text(SCORECARD), '§A')
    header = next(l for l in sec if l.startswith('| ID |'))
    assert _cells(header) == COLUMNS, _cells(header)
    return [_cells(l) for l in sec if l.startswith('| G-')]


def _ledger_rows():
    return gls.parse(LEDGER.read_bytes().decode('utf-8'))


def _vendor_parts(cell: str) -> dict[str, str]:
    parts = cell.split(' · ')
    return {p[:1]: p for p in parts if p[1:2] == ':'}


def _tracked() -> set[str]:
    top = subprocess.run(['git', '-C', str(REPO), 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True)
    out = subprocess.run(['git', '-C', top.stdout.strip(), 'ls-files'], capture_output=True, text=True, check=True,
                         encoding='utf-8', errors='replace')
    return set(out.stdout.splitlines())


# ── B4: the row set, the verdicts, the evidence ───────────────────────────────────────────────

def test_the_scorecard_row_set_equals_the_ledgers_both_parsed():
    ledger_ids = [r.rid for r in _ledger_rows()]
    card_ids = [c[0] for c in _a_rows()]
    assert len(ledger_ids) >= 89, 'non-vacuity: the ledger parse found too few rows'
    assert len(card_ids) == len(set(card_ids)), 'a scorecard row is duplicated'
    assert card_ids == ledger_ids, (sorted(set(ledger_ids) - set(card_ids)), sorted(set(card_ids) - set(ledger_ids)))


def test_every_row_has_nine_cells():
    bad = [c[0] for c in _a_rows() if len(c) != len(COLUMNS)]
    assert not bad, bad


def test_every_verdict_is_in_the_closed_set():
    rows = _a_rows()
    bad = [(c[0], c[i]) for c in rows for i in (3, 4, 5) if not VERDICT.match(c[i])]
    assert not bad, bad
    assert {c[3] for c in rows} & {'PARITY', 'NOT-VERIFIED'}, 'non-vacuity: no ordinary verdicts found'


def test_the_ledger_row_cell_cites_the_row_and_never_restates_its_status():
    lines = {r.rid: r.line for r in _ledger_rows()}
    bad = [(c[0], c[2]) for c in _a_rows()
           if c[2] != f'`docs/notebook/competitive-gap-ledger.md`:{lines[c[0]]}']
    assert not bad, bad


def test_every_row_carries_uct_evidence_of_a_named_kind():
    bad = []
    for c in _a_rows():
        items = [i.strip() for i in c[6].split(' ; ') if i.strip()]
        if not any(KINDS.match(i) for i in items):
            bad.append(c[0])
    assert not bad, bad


def _evidence_cells() -> list[str]:
    cells = []
    for c in _a_rows():
        cells += [c[6], c[7]]
    for l in _section(_text(SCORECARD), '§B —'):
        if l.startswith('| ') and not l.startswith('| clause') and not l.startswith('|---'):
            cells += _cells(l)
    return cells


def test_every_backticked_repo_path_in_an_evidence_cell_exists_at_head():
    tracked = _tracked()
    assert 'docs/notebook/competitive-gap-ledger.md' in tracked, 'non-vacuity: git ls-files did not answer'
    paths = set()
    for cell in _evidence_cells():
        for tok in re.findall(r'`([^`\s]+)`', cell):
            if '/' not in tok or tok.startswith('http'):
                continue
            paths.add(re.sub(r':[\d\-]+$', '', tok))
    assert len(paths) > 50, f'non-vacuity: only {len(paths)} cited paths found'
    missing = sorted(p for p in paths if p not in tracked)
    assert not missing, missing


def test_every_competitor_part_has_a_url_and_a_date_or_reads_not_verified():
    bad = []
    for c in _a_rows():
        parts = _vendor_parts(c[7])
        if sorted(parts) != ['E', 'N', 'O']:
            bad.append((c[0], 'vendors', sorted(parts)))
            continue
        for v, p in parts.items():
            cited = 'https://' in p and re.search(r'\(20\d\d-\d\d-\d\d\)', p)
            if not cited and 'not verified' not in p:
                bad.append((c[0], v))
    assert not bad, bad


def test_a_comparative_verdict_never_stands_on_an_uncited_competitor():
    bad = []
    for c in _a_rows():
        parts = _vendor_parts(c[7])
        for i, v in zip((3, 4, 5), 'NEO'):
            if c[i] in ('AHEAD', 'PARITY', 'BEHIND') and 'https://' not in parts.get(v, ''):
                bad.append((c[0], v, c[i]))
    assert not bad, bad


# ── B5: the 16 standards ──────────────────────────────────────────────────────────────────────

def _plan_standards() -> list[tuple[int, str]]:
    out = []
    for l in _text(PLAN).split('\n'):
        m = re.match(r'^\| (\d+) \| \*\*(.+?)\*\*', l)
        if m and 1 <= int(m.group(1)) <= 16:
            out.append((int(m.group(1)), m.group(2)))
    return out


def _card_standards() -> list[list[str]]:
    sec = _section(_text(SCORECARD), '§B —')
    return [_cells(l) for l in sec if re.match(r'^\| \d+ \| ', l)]


def test_sixteen_standards_numbered_1_to_16_named_as_the_plan_names_them():
    plan = _plan_standards()
    assert [n for n, _ in plan] == list(range(1, 17)), 'non-vacuity: the plan table did not parse'
    card = [(int(c[0]), c[1]) for c in _card_standards()]
    assert card == plan, (card, plan)


def test_the_headline_counts_only_standards_whose_every_clause_is_met():
    rows = _card_standards()
    at_bar = 0
    for c in rows:
        k, n = (int(x) for x in c[3].split('/'))
        assert (c[4] == '10') == (k == n), c
        at_bar += k == n
    m = re.search(r'\*\*(\d+) of 16 standards at bar\.\*\*', _text(SCORECARD))
    assert m, 'no headline'
    assert int(m.group(1)) == at_bar


# ── B7: citations index ───────────────────────────────────────────────────────────────────────

def test_every_cited_url_is_indexed_under_an_r_row_the_research_ledger_has():
    cited = set()
    for c in _a_rows():
        cited |= set(re.findall(r'(https://\S+?) "', c[7]))
    assert len(cited) > 20, 'non-vacuity: too few cited URLs'
    idx = [_cells(l) for l in _section(_text(SCORECARD), 'Citations index') if re.match(r'^\| \d+ \| https://', l)]
    indexed = {c[1]: c[2] for c in idx}
    assert cited <= set(indexed), sorted(cited - set(indexed))
    rrows = set(re.findall(r'^\| (R\d+) \|', _text(RESEARCH), re.M))
    missing = sorted({r for r in indexed.values() if r not in rrows})
    assert not missing, missing


# ── fix round 1: the offline citation check, and the plan's clause counts ──────────────────────

_WRITTEN_AT = re.compile(r'\*\*Document written at:\*\* `([0-9a-f]{7,40})`')
_NOT_AN_OBJECT = '0' * 40   # git's null object id: never a commit in any clone


def _written_at():
    """(scorecard text, the revision its own header records as "Document written at"), parsed from the
    text by this file's own pattern and cross-checked with the tool's, so neither can drift to HEAD."""
    text = SCORECARD.read_bytes().decode('utf-8')
    found = _WRITTEN_AT.findall(text)
    assert len(found) == 1, f'non-vacuity: the header must record exactly one "Document written at" revision, found {found}'
    assert psc.recorded_rev(text) == found[0], (psc.recorded_rev(text), found[0])
    return text, found[0]


def test_every_cited_file_line_still_holds_its_fragment():
    """tools/parity_scorecard.py --verify, offline, AT THE REVISION THE SCORECARD RECORDS: every
    CODE/RULING/RECORD/MEASURE file:line holds its quoted fragment, every WALK check carries its
    verdict, every TEST log carries its totals line, every flag RECORD matches the flag ledger at the
    same revision. Pinned, so a later unrelated edit never reds it; `--verify --rev HEAD` is the human's
    question "has the code moved since?". A revision not in this clone fails as unverifiable."""
    text, rev = _written_at()
    counts, problems = psc.verify(text, rev=rev)
    assert not problems, problems
    assert counts['CODE'] > 100 and counts['WALK'] > 20 and counts['TEST'] > 5 and counts['RECORD'] > 10, counts
    assert counts['FLAG'] > 5, counts


def test_the_verifier_can_fail_on_a_fragment_that_is_not_on_its_line():
    # control, at the same pinned revision: the text with one fragment changed must be refused.
    text, rev = _written_at()
    good = '`api/services/journal_two/notes.py`:4012 "def restore_note("'
    assert good in text, 'non-vacuity: the control citation is not in the scorecard'
    _, problems = psc.verify(text.replace(good, good.replace('restore_note(', 'restore_notes('), 1), rev=rev)
    assert any('notes.py:4012' in p for p in problems), problems


def test_a_recorded_revision_not_in_this_clone_is_unverifiable_never_a_pass():
    text, rev = _written_at()
    swapped = text.replace(f'**Document written at:** `{rev}`', f'**Document written at:** `{_NOT_AN_OBJECT}`', 1)
    assert psc.recorded_rev(swapped) == _NOT_AN_OBJECT, 'non-vacuity: the header swap did not take'
    counts, problems = psc.verify(swapped)
    assert problems == [f'unverifiable: {_NOT_AN_OBJECT} not in this clone'], problems
    assert not counts, counts
    assert psc.verify(text, rev=_NOT_AN_OBJECT)[1] == [f'unverifiable: {_NOT_AN_OBJECT} not in this clone']


_FLAG_CELL = re.compile(r'RECORD `docs/feature_flags\.json` at (\w+), key (\w+): status (\w+)')


def _a_flag_record(text):
    m = _FLAG_CELL.search(text)
    assert m, 'non-vacuity: the scorecard carries no flag record'
    return m


def test_a_flag_record_naming_another_revision_is_refused():
    """Wave 10, F3: a flag record names the revision the ledger was read at, and it must be the
    scorecard's own. (It named master's be9ca78b6 before; a gate armed after that made the cells wrong
    while every one of them still verified against the old copy.)"""
    text, rev = _written_at()
    m = _a_flag_record(text)
    assert rev.startswith(m.group(1)) or m.group(1).startswith(rev), (m.group(1), rev)
    planted = text.replace(m.group(0), m.group(0).replace(f' at {m.group(1)},', ' at be9ca78b6,'), 1)
    _, problems = psc.verify(planted, rev=rev)
    assert any(f'flag {m.group(2)}: the record names revision be9ca78b6' in p for p in problems), problems


def test_a_flag_status_the_ledger_does_not_hold_is_refused():
    text, rev = _written_at()
    m = _a_flag_record(text)
    other = 'dark' if m.group(3) != 'dark' else 'armed'
    planted = text.replace(m.group(0), m.group(0)[:-len(m.group(3))] + other, 1)
    _, problems = psc.verify(planted, rev=rev)
    assert any(f'flag {m.group(2)}: the record says {other!r}' in p for p in problems), problems
    assert not psc.verify(text, rev=rev)[1], 'control: the unplanted text verifies'


# ── §0, the evidence index (wave 10, F3): provenance, each property shown failing ──────────────────

def test_the_evidence_index_holds_on_the_real_inputs_and_is_not_vacuous():
    rows, problems = psc.evidence_index('HEAD')
    assert not problems, problems
    assert len(rows) == 2 * len(psc.B0_WAVES) + len(psc.B0_EVIDENCE) + len(psc.B0_TIPS)
    assert len(psc.B0_WAVES) >= 7 and len(psc.B0_EVIDENCE) >= 20 and len(psc.B0_TIPS) >= 10


def test_a_tag_that_does_not_pin_the_recorded_tip_is_refused():
    wave, tag, tip, landing = psc.B0_WAVES[0]
    _, problems = psc.evidence_index('HEAD', waves=[(wave, tag, '0000000aa', landing)], evidence=[], tips=[])
    assert any(f'tag {tag} does not resolve to the recorded tip' in p for p in problems), problems


def test_a_squash_that_did_not_land_is_refused():
    # 8a0098029 is a real commit of the wave-9 branch, reachable only through its tag, never from master.
    _, problems = psc.evidence_index('HEAD', waves=[('planted', 'notebook-wave9-tip-2026-09-26', 'e7c196f38', '8a0098029')],
                                     evidence=[], tips=[])
    assert problems == ['B0 planted: its squash 8a0098029 is not an ancestor of HEAD'], problems


def test_evidence_that_changed_since_it_landed_is_refused():
    # the gap ledger landed with wave 9's squash and has been edited since: it must NOT read unchanged.
    w9 = [w for w in psc.B0_WAVES if w[0] == 'wave 9']
    _, problems = psc.evidence_index('HEAD', waves=w9, evidence=[('docs/notebook/competitive-gap-ledger.md', '1c4b0bf74')], tips=[])
    assert problems == ['B0 evidence docs/notebook/competitive-gap-ledger.md: its blob at 1c4b0bf74 is not its blob at HEAD'], problems
    # control: a file wave 9 landed and nobody touched since reads unchanged
    _, ok = psc.evidence_index('HEAD', waves=w9,
                               evidence=[('docs/notebook/evidence/wave9-9b-8a0098029/browser-check.json', '1c4b0bf74')], tips=[])
    assert not ok, ok


def test_evidence_citing_an_unlisted_squash_or_missing_at_head_is_refused():
    _, problems = psc.evidence_index('HEAD', waves=[], evidence=[('docs/notebook/competitive-gap-ledger.md', '1c4b0bf74'),
                                                                  ('docs/notebook/no-such-evidence.json', 'HEAD')], tips=[])
    assert any('1c4b0bf74 is not a listed wave squash' in p for p in problems), problems
    assert any('evidence missing at HEAD: docs/notebook/no-such-evidence.json' in p for p in problems), problems


def test_a_measured_tree_that_is_not_reachable_is_refused():
    # 330a08964 wrote the wave-9 scorecard on the wave-9 branch: reachable from its tag, never from master.
    _, problems = psc.evidence_index('HEAD', waves=[], evidence=[], tips=[('330a08964', 'HEAD')])
    assert problems == ['B0 tip 330a08964 is not reachable from HEAD'], problems
    _, ok = psc.evidence_index('HEAD', waves=[], evidence=[], tips=[('330a08964', 'notebook-wave9-tip-2026-09-26')])
    assert not ok, ok


# ── §C (wave 10, F3): "what 10/10 still needs" lists every clause not MET exactly once ─────────────

def test_what_10_10_still_needs_lists_every_unmet_clause_once_under_one_owner():
    text = _text(SCORECARD)
    sec = _section(text, '§C')
    start = sec.index('### What 10/10 still needs')
    end = next(i for i in range(start + 1, len(sec)) if sec[i].startswith('### '))
    items = [l for l in sec[start:end] if l.startswith('- #')]
    groups = [l for l in sec[start:end] if l.startswith('**') and ' — ' in l and not l.startswith('**' + '0 of')]
    assert len([g for g in groups if g.split(' — ')[0].strip('*') in
                ('Owner-only (only the owner can take the step or the reading)',
                 'Quiet-slot (a timing verdict the controller takes in a held quiet slot)',
                 'Build work (an agent or the controller can do it)')]) == 3, groups
    unmet = [l for l in _section(text, '§C')[end:] if re.match(r'^\| \d+\. ', l)]
    assert unmet, 'non-vacuity: no unmet clause rows parsed'
    assert len(items) == len(unmet), (len(items), len(unmet))
    for row in unmet:
        c = _cells(row)
        n = c[0].split('.')[0]
        assert sum(1 for i in items if i.startswith(f'- #{n} ') and f': {c[1]} ({c[2]})' in i) == 1, row


def test_the_plans_now_column_carries_the_scorecards_clause_counts():
    """The plan's "Now" cells restate §B's clause counts (controller ruling, fix round 1); this keeps the
    two from drifting apart — the scorecard is the authority, the plan cell must match it."""
    plan = {}
    for l in _text(PLAN).split('\n'):
        m = re.match(r'^\| (\d+) \| \*\*.+?\*\*.*? \| [\d.]+ \(estimate\) · clauses met (\d+)/(\d+) \|', l)
        if m:
            plan[int(m.group(1))] = f'{m.group(2)}/{m.group(3)}'
    card = {int(c[0]): c[3] for c in _card_standards()}
    assert sorted(plan) == list(range(1, 17)), f'non-vacuity: parsed plan rows {sorted(plan)}'
    assert plan == card, {n: (plan.get(n), card.get(n)) for n in card if plan.get(n) != card.get(n)}
