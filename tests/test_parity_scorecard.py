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

F3 fix round 1 (review I-1, I-2, I-3, M-6): the tag must pin the head that was SQUASHED and the squash
must carry it file for file (property 5); a measured tree is reachable only from HEAD or a declared
wave's tag, and that wave must have landed; no measured tree leans on HEAD; and every evidence file
or walked tree the scorecard cites must be one §0 checks. Each is shown failing below.

F3 fix round 3 (review R12-I1, M1-M5): the tie is MERGE-AWARE -- a squash carries a head when its tree is the
head merged onto its parent -- so a squash onto a master that moved still ties (rebuilt below from objects
only, no ref written); a rename lists both names; a rail counts for an event only if a non-skipped test ASSERTS
it in executable code (an acorn walk) and ran green; a constant-reference event is resolved, never dropped; the
squash-found rail is pinned to a named commit; and every backticked evidence path outside §0 is extracted.
"""
from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import tempfile
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


# ── §0, the evidence index (wave 10, F3; fix round 1): provenance, each property shown failing ─────

W9 = ('wave 9', 'notebook-wave9-tip-2026-09-26', 'e7c196f38', '1c4b0bf74')


def test_the_evidence_index_holds_on_the_real_inputs_and_is_not_vacuous():
    rows, problems = psc.evidence_index('HEAD')
    assert not problems, problems
    assert len(rows) == 3 * len(psc.B0_WAVES) + len(psc.B0_EVIDENCE) + len(psc.B0_TIPS)
    assert len(psc.B0_WAVES) >= 8 and len(psc.B0_EVIDENCE) >= 30 and len(psc.B0_TIPS) >= 10
    # fix round 1 (review I-3): no measured tree leans on HEAD, which a squash would leave behind
    assert all(ref != 'HEAD' for _, ref in psc.B0_TIPS), psc.B0_TIPS


def test_a_tag_that_does_not_pin_the_recorded_tip_is_refused():
    wave, tag, tip, landing = psc.B0_WAVES[0]
    _, problems = psc.evidence_index('HEAD', waves=[(wave, tag, '0000000aa', landing)], evidence=[], tips=[])
    assert any(f'tag {tag} does not resolve to the recorded head' in p for p in problems), problems
    # a bare SHA is never a tag: only refs/tags/ is consulted (review I-2)
    _, p2 = psc.evidence_index('HEAD', waves=[('planted-sha', 'e7c196f38', 'e7c196f38', '1c4b0bf74')], evidence=[], tips=[])
    assert any('tag e7c196f38 does not resolve to the recorded head' in p for p in p2), p2


def test_a_squash_that_did_not_land_is_refused():
    # 8a0098029 is a real commit of the wave-9 branch, reachable only through its tag, never from master.
    _, problems = psc.evidence_index('HEAD', waves=[('planted', W9[1], W9[2], '8a0098029')], evidence=[], tips=[])
    assert problems == ['B0 planted: its squash 8a0098029 is not an ancestor of HEAD'], problems


def test_a_head_its_squash_does_not_carry_is_refused():
    """Review I-1: the tag must pin the head that was SQUASHED. Waves 5 and 7's `-tip-` tags do not -- a
    later commit landed in their place -- and the tie (property 5) names the files that differ."""
    _, p7 = psc.evidence_index('HEAD', waves=[('wave 7 (old tag)', 'notebook-wave7-tip-2026-09-26', 'e6f418194', 'f883e0996')],
                               evidence=[], tips=[])
    assert len(p7) == 1 and ('its squash f883e0996 is not the head e6f418194 merged onto its parent -- '
                             '9 file(s) differ') in p7[0], p7
    assert 'api/routers/journal_two.py' in p7[0], p7
    _, p5 = psc.evidence_index('HEAD', waves=[('wave 5 (old tag)', 'notebook-wave5-tip-2026-09-24', '145478ec1', '2c3ed3093')],
                               evidence=[], tips=[])
    assert len(p5) == 1 and ('its squash 2c3ed3093 is not the head 145478ec1 merged onto its parent -- '
                             '12 file(s) differ') in p5[0], p5
    # control: the heads the PRs did squash are carried, file for file
    _, ok = psc.evidence_index('HEAD', waves=[w for w in psc.B0_WAVES if w[0] in ('wave 5', 'wave 7')], evidence=[], tips=[])
    assert not ok, ok


def test_a_tie_over_no_changed_file_is_refused_as_vacuous():
    """Property 5 must not pass by comparing nothing. Planted: a "squash" whose parent already contains the head
    (74a907d86's parent descends from L1a's head 6777b3335), so the head changed no file against it. The tree is
    pinned by name and read at that commit, so the rail means the same on any branch that still holds it."""
    planted = [('planted', 'notebook-wave10-L1a-tip2-2026-09-26', '6777b3335', '74a907d86')]
    _, problems = psc.evidence_index('74a907d86', waves=planted, evidence=[], tips=[])
    assert problems == ['B0 planted: the tie is vacuous -- 6777b3335 changed no file against its squash\'s parent'], problems


MASTER_WITH_SQUASHES = '4bba30b73'   # a named master commit holding wave 9's, L1a's and L1b's squashes


def test_the_squash_of_a_recorded_head_is_found_in_heads_history():
    """L1c's squash is not recorded (it does not exist yet); the tool finds it. Shown on the waves whose squash
    IS recorded, against a NAMED master commit (review R12-M4: origin/master moves, and a clone's or a stale
    worktree's can predate the squashes): the commit found is the recorded one."""
    assert _git('cat-file', '-t', MASTER_WITH_SQUASHES) == 'commit', f'{MASTER_WITH_SQUASHES} not in this clone'
    for wave, _tag, tip, squash in psc.B0_WAVES:
        if wave in ('wave 9', 'wave 10 L1a', 'wave 10 L1b'):
            found = psc._find_squash(tip, MASTER_WITH_SQUASHES)
            assert found and found.startswith(squash), (wave, found, squash)
    # control: a head no squash carries is not "found" at some later commit
    assert psc._find_squash('e6f418194', MASTER_WITH_SQUASHES) is None


def test_evidence_that_changed_since_it_landed_is_refused():
    # the gap ledger landed with wave 9's squash and has been edited since: it must NOT read unchanged.
    _, problems = psc.evidence_index('HEAD', waves=[W9], evidence=[('docs/notebook/competitive-gap-ledger.md', '1c4b0bf74')], tips=[])
    assert problems == ['B0 evidence docs/notebook/competitive-gap-ledger.md: its blob at 1c4b0bf74 is not its blob at HEAD'], problems
    # control: a file wave 9 landed and nobody touched since reads unchanged
    _, ok = psc.evidence_index('HEAD', waves=[W9],
                               evidence=[('docs/notebook/evidence/wave9-9b-8a0098029/browser-check.json', 'wave 9')], tips=[])
    assert not ok, ok


def test_evidence_citing_an_unlisted_squash_or_missing_at_head_is_refused():
    _, problems = psc.evidence_index('HEAD', waves=[W9], evidence=[('docs/notebook/competitive-gap-ledger.md', 'f883e0996'),
                                                                    ('docs/notebook/no-such-evidence.json', '1c4b0bf74'),
                                                                    ('docs/notebook/competitive-gap-ledger.md', 'HEAD')])
    assert any('f883e0996 is not a listed wave squash' in p for p in problems), problems
    assert any('evidence missing at HEAD: docs/notebook/no-such-evidence.json' in p for p in problems), problems
    assert any('HEAD is not a listed wave squash' in p for p in problems), problems   # presence alone is not a check


def test_a_measured_tree_that_is_not_reachable_is_refused():
    # 330a08964 wrote the wave-9 scorecard on the wave-9 branch: reachable from its tag, never from master.
    _, problems = psc.evidence_index('HEAD', waves=[], evidence=[], tips=[('330a08964', 'HEAD')])
    assert problems == ['B0 tip 330a08964 is not reachable from HEAD'], problems
    _, ok = psc.evidence_index('HEAD', waves=[W9], evidence=[], tips=[('330a08964', W9[1])])
    assert not ok, ok


def test_a_tree_named_against_a_ref_that_is_not_a_declared_wave_tag_is_refused():
    """Review I-2, its two counterexamples: an undeclared tag of a branch that never landed, and a SHA named
    as its own ref. Both passed the first redesign; both must be refused."""
    _, p1 = psc.evidence_index('HEAD', waves=[W9], evidence=[], tips=[('731476cb6', 'notebook-wave9c-tip-2026-09-26')])
    assert p1 == ['B0 tip 731476cb6: notebook-wave9c-tip-2026-09-26 is not HEAD or a declared wave tag'], p1
    _, p2 = psc.evidence_index('HEAD', waves=[W9], evidence=[], tips=[('4d303c9da', '4d303c9da')])
    assert p2 == ['B0 tip 4d303c9da: 4d303c9da is not HEAD or a declared wave tag'], p2
    # a declared wave tag whose wave did not land is refused too
    _, p3 = psc.evidence_index('HEAD', waves=[('planted', W9[1], W9[2], '8a0098029')], evidence=[],
                               tips=[('8a0098029', W9[1])])
    assert 'B0 tip 8a0098029: the wave of notebook-wave9-tip-2026-09-26 did not land on HEAD' in p3, p3
    # control: the same tree against its landed wave's tag passes
    # a tree that is NOT an ancestor of its declared, landed wave's tag is refused
    w8 = [w for w in psc.B0_WAVES if w[0] == 'wave 8']
    _, p4 = psc.evidence_index('HEAD', waves=w8, evidence=[], tips=[('330a08964', w8[0][1])])
    assert p4 == [f'B0 tip 330a08964 is not reachable from {w8[0][1]}'], p4
    _, ok = psc.evidence_index('HEAD', waves=[W9], evidence=[], tips=[('8a0098029', W9[1])])
    assert not ok, ok


def test_every_cited_evidence_file_and_walked_tree_is_one_the_index_checks():
    """Review M-6: the lists are hand-typed (which squash landed a file is history the cells do not carry),
    so the other direction is derived -- a citation §0 does not check is refused by name."""
    text = _text(SCORECARD)
    assert psc.cited_b0_gaps(text) == [], psc.cited_b0_gaps(text)
    assert psc.cited_b0_paths(text) and psc._B0_WALK_TIP.findall(text), 'non-vacuity: citations parsed'
    planted = text + ('\nMEASURE `docs/notebook/evidence/wave10-f3/not-indexed.json`:1 "x"'
                      '\nWALK `tools/x.py`:C1 PASS — report `docs/notebook/gate-runs/wave8/walk-341bbccf3.json`, tip 0123456789\n')
    assert psc.cited_b0_gaps(planted) == [
        'evidence docs/notebook/evidence/wave10-f3/not-indexed.json is cited but §0 does not check it',
        'walked tree 0123456789 is cited but §0 does not check it'], psc.cited_b0_gaps(planted)


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


# ── F3 fix round 2 (controller ruling 2): clause 15b is derived from the rails ───────────────────

def _telemetry_src() -> str:
    return _text(REPO / 'app' / 'src' / 'pages' / 'journal-2-0' / 'lib' / 'notebookTelemetry.js')


def _read_repo(p):
    fp = REPO / p
    return _text(fp) if fp.is_file() else None


F3VT_R3 = REPO / 'docs' / 'notebook' / 'evidence' / 'wave10-f3' / 'vitest-f3-telemetry-rails-r3.log'


def test_every_core_action_event_has_a_call_site_rail_that_ran_green():
    events = psc.core_action_events(_telemetry_src())
    assert 'ask_used' in events and len(events) >= 10, f'non-vacuity: events read {events}'
    log = _text(F3VT_R3)
    where = {}
    assert psc.telemetry_rail_gaps(events, psc.TELEMETRY_RAILS, _read_repo, log, where=where) == []
    # every event cites at least one asserting test, and save_success cites BOTH of its doors (R12-M2)
    assert sorted(where) == events, sorted(where)
    assert any('NoteEditorPage.telemetry.test.jsx' in x for x in where['save_success']), where['save_success']
    assert any('useOutboxDrain.test.jsx' in x for x in where['save_success']), where['save_success']


def test_a_core_action_event_that_is_not_railed_is_a_named_gap():
    events = psc.core_action_events(_telemetry_src())
    log = _text(F3VT_R3)
    rails = dict(psc.TELEMETRY_RAILS)
    del rails['ask_used']
    assert psc.telemetry_rail_gaps(events, rails, _read_repo, log) == ['ask_used: no call-site rail is named for it']
    rails = dict(psc.TELEMETRY_RAILS, ask_used='app/src/pages/journal-2-0/lib/noteBatch.test.js')
    assert psc.telemetry_rail_gaps(events, rails, _read_repo, log) == [
        'ask_used: app/src/pages/journal-2-0/lib/noteBatch.test.js has no test that asserts it (a comment, a '
        'skipped test, or a name that never reaches an expect(...) does not count)']
    shown = log.replace('✓ src/pages/journal-2-0/components/notebook/AskPanel.telemetry.test.jsx', '× gone')
    assert psc.telemetry_rail_gaps(events, psc.TELEMETRY_RAILS, _read_repo, shown) == [
        f'ask_used: no test of {psc.TELEMETRY_RAILS["ask_used"]} that asserts it ran green in the telemetry log']
    with pytest.raises(ValueError):
        psc.core_action_events('no table here')
    assert psc.telemetry_rail_gaps([], psc.TELEMETRY_RAILS, _read_repo, log) == [
        'CORE_ACTION_EVENTS: no events read from the source']


def test_clause_15b_and_g003_read_as_the_round_2_rulings_say():
    text = _text(SCORECARD)
    row = next(l for l in text.split('\n') if l.startswith('| Notebook telemetry for every core action |'))
    assert _cells(row)[1] == 'MET' and 'AskPanel.telemetry.test.jsx' in row, row
    g003 = next(c for c in _a_rows() if c[0] == 'G-003')
    assert g003[3:6] == ['NOT-VERIFIED'] * 3, g003[3:6]


# ── F3 fix round 3 (R12-I1, M1): the merge-aware tie, rebuilt from objects only ──────────────────
# Every commit below is written with commit-tree into the object store and never referenced: no branch, tag,
# index or working file is touched (a temporary GIT_INDEX_FILE builds each tree). Dates are pinned, so the
# same inputs give the same SHAs on every run.

_PINNED = {'GIT_AUTHOR_NAME': 'f3-r3', 'GIT_AUTHOR_EMAIL': 'f3-r3@example.invalid',
           'GIT_COMMITTER_NAME': 'f3-r3', 'GIT_COMMITTER_EMAIL': 'f3-r3@example.invalid',
           'GIT_AUTHOR_DATE': '2026-09-28T12:00:00Z', 'GIT_COMMITTER_DATE': '2026-09-28T12:00:00Z'}
W9_HEAD, W9_SQUASH = 'e7c196f38', '1c4b0bf74'
GAP_LEDGER = 'docs/notebook/competitive-gap-ledger.md'   # wave 9 changed it; its first hunk starts at line 61


def _git(*a, env=None, data=None) -> str:
    r = subprocess.run(['git', '-C', str(REPO), *a], capture_output=True, cwd=REPO, input=data,
                       env={**os.environ, **_PINNED, **(env or {})})
    assert r.returncode == 0, (a, r.stderr.decode('utf-8', 'replace'))
    return r.stdout.decode('utf-8', 'replace').strip()


def _tree_with(commit: str, changes: dict) -> str:
    """The tree of `commit` with `changes` applied ({path: bytes to write, or None to delete}), built in a
    temporary index; objects only."""
    with tempfile.TemporaryDirectory() as d:
        env = {'GIT_INDEX_FILE': os.path.join(d, 'index')}
        _git('read-tree', commit, env=env)
        for path, data in changes.items():
            if data is None:
                _git('update-index', '--force-remove', '--', path, env=env)
            else:
                blob = _git('hash-object', '-w', '--stdin', data=data)
                _git('update-index', '--add', '--cacheinfo', f'100644,{blob},{path}', env=env)
        return _git('write-tree', env=env)


def _commit(tree: str, parent: str, msg: str) -> str:
    return _git('commit-tree', tree, '-p', parent, '-m', msg)


def _moved_master_squash():
    """Master moves by one unrelated line in a file wave 9 also changed (the review's scenario, rebuilt on wave
    9 so it holds after L1c's tag is re-made); then wave 9's head is squashed onto it with a clean 3-way merge.
    Returns (parent P, moved master M, squash S)."""
    parent = _git('rev-parse', f'{W9_SQUASH}^')
    old = subprocess.run(['git', '-C', str(REPO), 'cat-file', 'blob', f'{parent}:{GAP_LEDGER}'],
                         capture_output=True, check=True).stdout
    first, rest = old.split(b'\n', 1)
    moved = _commit(_tree_with(parent, {GAP_LEDGER: first + b'\n<!-- master moved: an unrelated line -->\n' + rest}),
                    parent, 'moved master (F3 r3 rail)')
    r = subprocess.run(['git', '-C', str(REPO), 'merge-tree', '--write-tree', moved, W9_HEAD], capture_output=True)
    assert r.returncode == 0, 'precondition: the 3-way merge must be clean'
    squash = _commit(r.stdout.decode().split()[0], moved, 'squash of wave 9 onto the moved master (F3 r3 rail)')
    return parent, moved, squash


def test_a_squash_onto_a_master_that_moved_still_ties_and_is_found():
    """Review R12-I1: a GitHub squash onto a master that moved is a 3-way merge, so a file both sides touched holds
    the MERGE, not the head's blob. The per-file blob rule refused it (F-9 on master); the merge-aware rule
    accepts it -- and §0 finds it as the head's landing."""
    parent, moved, squash = _moved_master_squash()
    # non-vacuity: the squash's gap ledger is NOT the head's blob (the old rule's refusal), and IS master's edit
    assert _git('rev-parse', f'{squash}:{GAP_LEDGER}') != _git('rev-parse', f'{W9_HEAD}:{GAP_LEDGER}')
    assert b'master moved' in subprocess.run(['git', '-C', str(REPO), 'cat-file', 'blob', f'{squash}:{GAP_LEDGER}'],
                                             capture_output=True, check=True).stdout
    changed, bad = psc._tie(W9_HEAD, squash)
    assert GAP_LEDGER in changed and len(changed) == 402 and bad == set(), (len(changed), sorted(bad)[:5])
    assert psc._find_squash(W9_HEAD, squash) == squash
    rows, problems = psc.evidence_index(squash, waves=[('wave 9', W9[1], W9_HEAD, None)], evidence=[], tips=[])
    assert problems == [], problems
    assert any(r[0] == 'wave 9: landing' and r[2] == f'squash {squash[:9]}' for r in rows), rows
    # control: the moved master itself does not carry the head
    assert psc._tie(W9_HEAD, moved)[1]


def test_a_squash_of_a_later_head_than_the_tag_is_refused_closed():
    """The tag was not moved to the commit that was squashed (the controller committed the scorecard after
    tagging, or pressed "Update branch"): the squash carries a LATER head. §0 must refuse -- NOT FOUND, never a
    tie to the tagged head -- while the later head itself is found, so the refusal is about the tag."""
    _, moved, _ = _moved_master_squash()
    later = _commit(_tree_with(W9_HEAD, {'docs/notebook/parity-scorecard.md': b'# written after the tag\n'}),
                    W9_HEAD, 'a commit after the tag (F3 r3 rail)')
    r = subprocess.run(['git', '-C', str(REPO), 'merge-tree', '--write-tree', moved, later], capture_output=True)
    assert r.returncode == 0
    squash = _commit(r.stdout.decode().split()[0], moved, 'squash of the later head (F3 r3 rail)')
    _, problems = psc.evidence_index(squash, waves=[('wave 9', W9[1], W9_HEAD, None)], evidence=[], tips=[])
    assert problems == [f'B0 wave 9: no commit of {squash} carries the files {W9[1]} changed'], problems
    assert psc._find_squash(later, squash) == squash       # control: the head that WAS squashed is found


def test_a_head_that_conflicts_with_the_squash_parent_is_refused():
    """A head that does not even merge cleanly onto the squash's parent is not carried by it, whatever the squash
    holds -- the conflicted file is named."""
    base = W9_HEAD
    path = 'docs/notebook/parity-scorecard.md'
    parent = _commit(_tree_with(base, {path: b'master says A\n'}), base, 'master edits the line (F3 r3 rail)')
    head = _commit(_tree_with(base, {path: b'the head says B\n'}), base, 'the head edits it too (F3 r3 rail)')
    landing = _commit(_git('rev-parse', f'{head}^{{tree}}'), parent, 'a squash holding the head tree (F3 r3 rail)')
    changed, bad = psc._tie(head, landing)
    assert changed == {path} and bad == {f'(conflict) {path}'}, (changed, bad)


def test_a_rename_lists_both_names_so_a_landing_that_kept_the_old_file_is_refused():
    """Review R12-M1: with rename detection a rename lists only the new name. `--no-renames` lists both, and the
    merge-aware tie refuses a landing that kept the old file."""
    base = W9_HEAD
    old_path = 'docs/notebook/parity-scorecard.md'
    new_path = 'docs/notebook/parity-scorecard-renamed.md'
    blob = subprocess.run(['git', '-C', str(REPO), 'cat-file', 'blob', f'{base}:{old_path}'],
                          capture_output=True, check=True).stdout
    head = _commit(_tree_with(base, {old_path: None, new_path: blob}), base, 'rename (F3 r3 rail)')
    landing = _commit(_tree_with(base, {new_path: blob}), base, 'kept the old file (F3 r3 rail)')
    changed, bad = psc._tie(head, landing)
    assert changed == {old_path, new_path}, changed
    assert bad == {old_path}, bad
    good = _commit(_tree_with(base, {old_path: None, new_path: blob}), base, 'the rename, landed (F3 r3 rail)')
    assert psc._tie(head, good) == ({old_path, new_path}, set())


# ── F3 fix round 3 (R12-M2): a rail counts only if a non-skipped test ASSERTS the event ─────────────

FAKE = 'app/src/fake/Fake.test.jsx'


def _gaps(src, log, ev='ask_used'):
    return psc.telemetry_rail_gaps([ev], {ev: FAKE}, lambda p: src if p == FAKE else None, log)


def _log(*titles):
    return '\n'.join(f' ✓ src/fake/Fake.test.jsx > {" > ".join(t)} 5ms' for t in titles) + '\n'


_HELPER = "const calls = []\nfunction askUsed() { return calls.filter((c) => c.event === 'ask_used') }\n"


def test_a_rail_that_asserts_the_event_through_a_helper_and_ran_green_counts():
    src = _HELPER + "describe('d', () => { it('fires once', () => { expect(askUsed()).toHaveLength(1) }) })\n"
    assert _gaps(src, _log(('d', 'fires once'))) == []
    # the same test absent from the log does not count
    assert _gaps(src, _log(('d', 'another test'))) == [
        f'ask_used: no test of {FAKE} that asserts it ran green in the telemetry log']


@pytest.mark.parametrize('src', [
    # named only in a comment, beside a passing unrelated test (the review's measured case)
    "// TODO cover 'ask_used'\nit('unrelated', () => { expect(1).toBe(1) })\n",
    # asserted, but the test is skipped -- three spellings
    _HELPER + "it.skip('fires once', () => { expect(askUsed()).toHaveLength(1) })\n",
    _HELPER + "describe.skip('d', () => { it('fires once', () => { expect(askUsed()).toHaveLength(1) }) })\n",
    _HELPER + "xit('fires once', () => { expect(askUsed()).toHaveLength(1) })\n",
    # the name is in executable code but never reaches an expect(...)
    "it('sends', () => { const ev = 'ask_used'; send(ev); expect(sent).toBe(true) })\n",
], ids=['comment', 'it.skip', 'describe.skip', 'xit', 'not-asserted'])
def test_a_rail_that_does_not_assert_the_event_is_a_gap(src):
    log = _log(('unrelated',), ('fires once',), ('d', 'fires once'), ('sends',))
    assert _gaps(src, log) == [
        f'ask_used: {FAKE} has no test that asserts it (a comment, a skipped test, or a name that never reaches '
        'an expect(...) does not count)']


def test_an_unparseable_rail_or_an_ast_walk_that_cannot_run_is_never_a_pass():
    assert _gaps('it(\'x\', () => {', _log(('x',)))[0].startswith(f'ask_used: {FAKE} could not be parsed')

    def broken(sources, events):
        raise RuntimeError('node is not on PATH')
    with pytest.raises(RuntimeError):
        psc.telemetry_rail_gaps(['ask_used'], {'ask_used': FAKE}, lambda p: 'x', '', asserts=broken)


def test_the_outbox_door_is_railed_separately_and_its_loss_is_a_named_gap():
    """save_success fires from two doors; the outbox drain's (T8) has its own rail, in the run. If only that door's
    rail stopped running, 15b must say so (review R12-M2: per event was not per door)."""
    events = psc.core_action_events(_telemetry_src())
    outbox = 'app/src/pages/journal-2-0/lib/offline/useOutboxDrain.test.jsx'
    assert outbox in psc.TELEMETRY_RAILS['save_success']
    log = _text(F3VT_R3)
    shown = log.replace('✓ src/pages/journal-2-0/lib/offline/useOutboxDrain.test.jsx', '× gone')
    assert shown != log, 'non-vacuity: the outbox rail ran in the r3 log'
    assert psc.telemetry_rail_gaps(events, psc.TELEMETRY_RAILS, _read_repo, shown) == [
        f'save_success: no test of {outbox} that asserts it ran green in the telemetry log']


# ── F3 fix round 3 (R12-M3): a constant-reference event is resolved, never dropped ─────────────────

def test_core_action_events_resolves_constant_references_and_refuses_what_it_cannot_read():
    src = _telemetry_src()
    table = psc.core_action_table(src)
    assert len(table) == 17 and len(psc.core_action_events(src)) == 14, (len(table), psc.core_action_events(src))
    ref = src.replace("'T5 bulk move and tag': ['bulk_used'],", "'T5 bulk move and tag': [NOTEBOOK_EVENTS.BULK_USED],")
    assert ref != src, 'non-vacuity: the constant-reference variant was built'
    assert psc.core_action_events(ref) == psc.core_action_events(src)
    assert 'bulk_used' in psc.core_action_events(ref)
    for bad in ("[NOTEBOOK_EVENTS.NO_SUCH_KEY]", "[BULK]", "[]", "[`bulk_used`]"):
        with pytest.raises(ValueError):
            psc.core_action_events(src.replace("'T5 bulk move and tag': ['bulk_used'],",
                                               f"'T5 bulk move and tag': {bad},"))
    # an unreadable element beside a readable one is refused too, not dropped from a still-non-empty action
    mixed = src.replace("'T2 save a passage with its source': ['capture_used', 'save_success'],",
                        "'T2 save a passage with its source': ['capture_used', NOTEBOOK_EVENTS.NO_SUCH_KEY],")
    assert mixed != src, 'non-vacuity: the mixed variant was built'
    with pytest.raises(ValueError):
        psc.core_action_events(mixed)


# ── F3 fix round 3 (R12-M5): every backticked evidence path outside §0 is extracted ────────────────

def test_every_backticked_evidence_path_in_the_cells_is_extracted():
    text = _text(SCORECARD)
    paths = psc.cited_b0_paths(text)
    assert len(paths) == 26, (len(paths), paths)
    for p in ('docs/notebook/proof/evernote-evidence-2026-09-26.jsonl',
              'docs/notebook/evidence/wave9-9b-8a0098029/sandbox-integrity-2026-09-26T14-58-03.md',
              'docs/notebook/evidence/wave9-9b-8a0098029/sandbox-integrity-2026-09-26T15-30-24.md',
              'docs/notebook/evidence/wave9-9b-8a0098029/browser_check_9b.py',
              'docs/notebook/evidence/wave9-9b-8a0098029/browser_check_9b_pass2.py',
              'docs/notebook/evidence/a11y-second-review-2026-09-27/keyboard_walk.py'):
        assert p in paths, p
    # any form counts: a path in an integrity record's parenthesis, a quote's evidence, a WALK instrument
    planted = ('## §B\n(`docs/notebook/evidence/x/integrity.md`) [R17 evidence `docs/notebook/proof/q.jsonl` '
               'line 3]; WALK `docs/notebook/evidence/x/walk.py`:A1\n')
    assert psc.cited_b0_paths(planted) == ['docs/notebook/evidence/x/integrity.md', 'docs/notebook/evidence/x/walk.py',
                                           'docs/notebook/proof/q.jsonl']
    # §0 itself (the index) is not a citation of it
    assert psc.cited_b0_paths('## §0 — B0\n`docs/notebook/proof/only-in-0.json`\n## §B1\n') == []
