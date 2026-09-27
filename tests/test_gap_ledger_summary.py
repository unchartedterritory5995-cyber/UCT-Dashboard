"""Rails for tools/gap_ledger_summary.py (wave 9, lane 9B, B3).

The ledger's summary block is GENERATED from its rows. These rails pin that the committed block is
exactly what the tool derives today, that a row the rule cannot bucket is listed BY ID (never
dropped), and that `--check` goes red when either a STATUS or the UNBUCKETED line moves.
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(REPO, 'tools', 'gap_ledger_summary.py')
LEDGER = os.path.join(REPO, 'docs', 'notebook', 'competitive-gap-ledger.md')


def _load():
    spec = importlib.util.spec_from_file_location('gap_ledger_summary', TOOL)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # dataclasses resolve their module through sys.modules
    spec.loader.exec_module(mod)
    return mod


gls = _load()

HEADER = ('| ID | Capability | Competitor | UCT Current | Target | Parity/Diff | Persona | Switching Impact '
          '| Evidence | Status | Priority | Dependencies | Validation Condition |')
RULE = '|---|---|---|---|---|---|---|---|---|---|---|---|---|'


def _row(rid: str, status: str) -> str:
    cells = [rid, 'cap', 'comp', 'now', 'target', 'PARITY', 'All', 'Low', 'ev', status, 'P1', '—', '—']
    return '| ' + ' | '.join(cells) + ' |'


def _fixture(*rows: str) -> str:
    body = '\n'.join(['# fixture', '', HEADER, RULE, *rows, ''])
    block = gls.render(gls.parse(body))
    return body + '\n' + block + '\n'


def _ledger_text() -> str:
    return open(LEDGER, 'rb').read().decode('utf-8')


# ── the real ledger ───────────────────────────────────────────────────────────

def test_the_committed_block_equals_the_tools_output():
    text = _ledger_text()
    have = gls.committed_block(text)
    assert have is not None, 'the ledger carries no GENERATED:gap-ledger-summary block'
    assert have == gls.render(gls.parse(text))


def test_every_row_is_counted_exactly_once_and_the_parse_is_not_vacuous():
    text = _ledger_text()
    rows = gls.parse(text)
    raw_rows = [l for l in text.replace('\r\n', '\n').split('\n') if l.startswith('| G-')]
    # non-vacuity: the parse saw the real ledger (89 rows before wave 9, more after it).
    assert len(rows) == len(raw_rows) >= 89
    ids = [r.rid for r in rows]
    assert 'G-001' in ids and 'G-127' in ids
    assert len(ids) == len(set(ids)), 'a ledger ID appears twice'
    block = gls.committed_block(text)
    assert f'**Rows: {len(rows)}.**' in block
    counted = sum(1 for r in rows if r.bucket) + sum(1 for r in rows if not r.bucket)
    assert counted == len(rows)


def test_the_unbucketed_line_is_always_present_in_the_committed_block():
    block = gls.committed_block(_ledger_text())
    assert any(l.startswith('UNBUCKETED (') for l in block.split('\n'))


def test_check_passes_on_the_real_ledger_through_the_cli():
    r = subprocess.run([sys.executable, TOOL, '--check'], capture_output=True, text=True,
                       encoding='utf-8', errors='replace', cwd=REPO)
    assert r.returncode == 0, r.stdout + r.stderr
    assert 'OK:' in r.stdout


def test_self_check_passes_through_the_cli():
    r = subprocess.run([sys.executable, TOOL, '--self-check'], capture_output=True, text=True,
                       encoding='utf-8', errors='replace', cwd=REPO)
    assert r.returncode == 0, r.stdout + r.stderr
    assert 'SELF-CHECK: PASS' in r.stdout


# ── the bucketing rule, on fixtures ───────────────────────────────────────────

def test_an_unknown_status_is_listed_under_unbucketed_by_id():
    text = _fixture(_row('G-901', '**DONE**'), _row('G-902', 'wibble — nobody knows'))
    rows = {r.rid: r for r in gls.parse(text)}
    assert rows['G-901'].bucket == 'DONE'
    assert rows['G-902'].bucket is None
    block = gls.committed_block(text)
    unb = [l for l in block.split('\n') if l.startswith('UNBUCKETED (')]
    assert unb and 'G-902' in unb[0] and 'G-901' not in unb[0]
    assert '| DONE | 1 | G-901 |' in block


def test_a_duplicate_is_its_own_bucket_listed_by_id_never_folded_into_done():
    # Controller ruling, fix round 1: a DUPLICATE row stays, counted and listed on its own.
    text = _fixture(_row('G-911', '**DONE**'),
                    _row('G-912', '⚰️ was: see G-911 ⟶ **DUPLICATE of G-911 — tracked there**'))
    rows = {r.rid: r for r in gls.parse(text)}
    assert rows['G-912'].bucket == 'DUPLICATE'
    block = gls.committed_block(text)
    assert '| DUPLICATE | 1 | G-912 |' in block
    assert '| DONE | 1 | G-911 |' in block, 'the duplicate was counted as DONE too'
    assert 'UNBUCKETED (0): none' in block


def test_the_real_ledgers_duplicate_row_is_counted_in_the_duplicate_bucket():
    text = _ledger_text()
    rows = {r.rid: r for r in gls.parse(text)}
    assert rows['G-084'].bucket == 'DUPLICATE', rows['G-084']
    dup = [l for l in gls.committed_block(text).split('\n') if l.startswith('| DUPLICATE |')]
    assert dup and 'G-084' in dup[0], dup


def test_a_malformed_row_is_unbucketed_by_id_never_read_off_the_wrong_column():
    short = '| G-903 | cap | comp | now | target | All | Low | ev | **DONE** | P1 | — | — |'  # 12 cells
    rows = {r.rid: r for r in gls.parse(_fixture(_row('G-901', 'OPEN'), short))}
    assert rows['G-903'].bucket is None and 'malformed' in rows['G-903'].reason


@pytest.mark.parametrize('status, bucket', [
    ('⚰️ was: EXPERIMENT ⟶ **BUILT, DARK** (2026-09-26)', 'BUILT-DARK'),
    ('⚰️ was: **DONE** ⟶ **OPEN** — reopened', 'OPEN'),
    ('PARTIAL — price + user-note DONE, estimates rights-gated', 'PARTIAL'),
    ('EXPERIMENT, BLOCKED', 'EXPERIMENT'),
    ('**REJECTED — OUT OF SCOPE by ruling D4**', 'REJECTED'),
    ('**ARMED 2026-09-26 18:53Z**', 'DONE'),
    ('**SHIPPED + VERIFIED**', 'DONE'),
    ('**BLOCKED (owner)** — the store submission', 'BLOCKED'),
    ('see G-044', None),
    ('⚰️ was: see G-044 ⟶ **DUPLICATE of G-044 — tracked there** (2026-09-26)', 'DUPLICATE'),
])
def test_the_live_status_after_a_tombstone_and_the_first_keyword_wins(status, bucket):
    rows = gls.parse(_fixture(_row('G-904', status)))
    assert rows[0].bucket == bucket


def test_check_goes_red_when_one_status_changes_in_a_copy():
    text = _ledger_text()
    ok, _ = gls.check(text)
    assert ok
    lines = text.replace('\r\n', '\n').split('\n')
    i = next(n for n, l in enumerate(lines) if l.startswith('| G-001 '))
    assert '**DONE**' in lines[i]
    lines[i] = lines[i].replace('**DONE**', '**OPEN**', 1)
    ok2, why = gls.check('\n'.join(lines))
    assert not ok2 and 'differs' in why


def test_check_goes_red_when_the_unbucketed_line_is_dropped():
    text = _ledger_text().replace('\r\n', '\n')
    dropped = '\n'.join(l for l in text.split('\n') if not l.startswith('UNBUCKETED ('))
    assert dropped != text
    ok, why = gls.check(dropped)
    assert not ok and 'differs' in why


def test_check_goes_red_when_the_markers_are_missing():
    ok, why = gls.check('# nothing\n\n' + HEADER + '\n' + RULE + '\n' + _row('G-905', 'DONE') + '\n')
    assert not ok and 'markers' in why
