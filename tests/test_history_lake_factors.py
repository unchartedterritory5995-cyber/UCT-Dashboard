"""Split-adjustment factors (tools/history_lake/factors.py): the rule, its edges, and real splits.

Loaded by path so the test needs nothing from the app.
"""
import importlib.util
import json
import os
import pathlib

import pytest

_P = pathlib.Path(__file__).resolve().parents[1] / 'tools' / 'history_lake' / 'factors.py'
_spec = importlib.util.spec_from_file_location('history_lake_factors', _P)
F = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(F)

ROWS = [
    # NVDA-like: 4-for-1 on 2021-07-20, 10-for-1 on 2024-06-10
    {'ticker': 'AAA', 'execution_date': '2021-07-20', 'split_from': 1, 'split_to': 4},
    {'ticker': 'AAA', 'execution_date': '2024-06-10', 'split_from': 1, 'split_to': 10},
    # a 1-for-10 reverse split
    {'ticker': 'REV', 'execution_date': '2023-03-01', 'split_from': 10, 'split_to': 1},
    # announced, not yet executed
    {'ticker': 'FUT', 'execution_date': '2027-01-13', 'split_from': 1, 'split_to': 2},
    # unusable rows
    {'ticker': 'BAD', 'execution_date': '2020-01-02', 'split_from': 0, 'split_to': 2},
    {'ticker': 'BAD', 'execution_date': '2020-01-03', 'split_from': None, 'split_to': 2},
    {'ticker': 'BAD', 'execution_date': '2020-01-06', 'split_from': 3, 'split_to': 3},
    {'ticker': 'BAD', 'execution_date': 'not-a-date', 'split_from': 1, 'split_to': 2},
    {'ticker': '', 'execution_date': '2020-01-07', 'split_from': 1, 'split_to': 2},
]
AS_OF = '2026-11-13'


def test_ratio():
    assert F.split_ratio(1, 4) == 4.0
    assert F.split_ratio(10, 1) == 0.1
    assert F.split_ratio('1', '2') == 2.0
    for bad in [(0, 2), (2, 0), (-1, 2), (None, 2), ('x', 2), (float('nan'), 2), (float('inf'), 2), (3, 3)]:
        assert F.split_ratio(*bad) is None


def test_tables_keep_executed_usable_rows_only():
    t = F.build_factor_tables(ROWS, AS_OF)
    assert t == {
        'AAA': [['2021-07-20', 4.0], ['2024-06-10', 10.0]],
        'REV': [['2023-03-01', 0.1]],
    }
    assert 'FUT' not in t and 'BAD' not in t


def test_a_future_split_counts_once_its_date_is_reached():
    assert 'FUT' not in F.build_factor_tables(ROWS, '2027-01-12')
    assert F.build_factor_tables(ROWS, '2027-01-13')['FUT'] == [['2027-01-13', 2.0]]


def test_as_of_must_be_a_date():
    with pytest.raises(ValueError):
        F.build_factor_tables(ROWS, '20261113')


def test_a_restated_split_is_not_applied_twice():
    rows = [
        {'ticker': 'DUP', 'execution_date': '2022-05-02', 'split_from': 1, 'split_to': 3},
        {'ticker': 'DUP', 'execution_date': '2022-05-02', 'split_from': 1, 'split_to': 3},
    ]
    assert F.build_factor_tables(rows, AS_OF)['DUP'] == [['2022-05-02', 3.0]]


def test_factor_for_date_is_strict_on_the_execution_date():
    t = F.build_factor_tables(ROWS, AS_OF)['AAA']
    assert F.factor_for_date(t, '2021-07-19') == 40.0     # before both
    assert F.factor_for_date(t, '2021-07-20') == 10.0     # ON the first execution date: already post-split
    assert F.factor_for_date(t, '2024-06-07') == 10.0
    assert F.factor_for_date(t, '2024-06-10') == 1.0      # ON the second: newest basis
    assert F.factor_for_date(t, '2026-11-13') == 1.0
    assert F.factor_for_date([], '2020-01-01') == 1.0


def test_segments_agree_with_factor_for_date_on_every_boundary():
    t = F.build_factor_tables(ROWS, AS_OF)['AAA']
    segs = F.segment_factors(t)
    assert segs == [[None, '2021-07-19', 40.0], ['2021-07-20', '2024-06-09', 10.0], ['2024-06-10', None, 1.0]]
    for first, last, f in segs:
        for d in (first, last):
            if d is not None:
                assert F.factor_for_date(t, d) == f
    assert F.segment_factors([]) == [[None, None, 1.0]]


def test_adjust_bars_forward_and_reverse():
    t = F.build_factor_tables(ROWS, AS_OF)
    dates = ['2024-06-07', '2024-06-10']
    o, h, l, c, v = F.adjust_bars(dates, [1200.0, 121.0], [1210.0, 123.0], [1190.0, 120.0], [1208.0, 122.0], [100, 1000], t['AAA'])
    assert (o, h, l, c, v) == ([120.0, 121.0], [121.0, 123.0], [119.0, 120.0], [120.8, 122.0], [1000.0, 1000])
    # reverse split: the older bar's price goes UP by 10 and its volume DOWN by 10
    o, h, l, c, v = F.adjust_bars(['2023-02-28', '2023-03-01'], [1.0, 10.0], [1.1, 11.0], [0.9, 9.0], [1.0, 10.5], [5000, 400], t['REV'])
    assert [round(x, 9) for x in o] == [10.0, 10.0]
    assert [round(x, 9) for x in h] == [11.0, 11.0]
    assert [round(x, 9) for x in v] == [500.0, 400]


def test_adjust_bars_leaves_inputs_alone_and_rejects_ragged_columns():
    o = [1.0]
    F.adjust_bars(['2020-01-01'], o, [1.0], [1.0], [1.0], [1], [['2021-01-01', 2.0]])
    assert o == [1.0]
    with pytest.raises(ValueError):
        F.adjust_bars(['2020-01-01'], [1.0, 2.0], [1.0], [1.0], [1.0], [1], [])


REF = r'D:\uct-history\ref\splits.json'


@pytest.mark.skipif(not os.path.exists(REF), reason='the vendor split reference is not on this machine')
def test_real_reference_known_splits():
    rows = json.load(open(REF, encoding='utf-8'))['rows']
    t = F.build_factor_tables(rows, AS_OF)
    # Widely documented splits, as the vendor lists them.
    nv = dict((d, r) for d, r in t['NVDA'])
    assert nv.get('2024-06-10') == 10.0 and nv.get('2021-07-20') == 4.0
    aapl = dict((d, r) for d, r in t['AAPL'])
    assert aapl.get('2020-08-31') == 4.0 and aapl.get('2014-06-09') == 7.0
    assert F.factor_for_date(t['AAPL'], '2014-06-06') == 28.0
    # nothing dated after as_of survives, and every ratio is usable
    for tk, tab in t.items():
        for d, r in tab:
            assert d <= AS_OF and r > 0 and r != 1.0
        assert [d for d, _ in tab] == sorted({d for d, _ in tab})


# ── class shares: the vendor files their splits under two spellings (2026-11-18) ──────────────────

def _cs_rows():
    return [
        {'ticker': 'BF.B', 'execution_date': '2004-01-21', 'split_from': 1, 'split_to': 2},
        {'ticker': 'BFB', 'execution_date': '2012-08-13', 'split_from': 2, 'split_to': 3},
        {'ticker': 'BFB', 'execution_date': '2016-08-19', 'split_from': 1, 'split_to': 2},
        # the same 2004 event, filed again under the undotted spelling two days later
        {'ticker': 'BFB', 'execution_date': '2004-01-23', 'split_from': 1, 'split_to': 2},
        {'ticker': 'CWD', 'execution_date': '2025-05-02', 'split_from': 15, 'split_to': 1},
        {'ticker': 'XY.pA', 'execution_date': '2020-01-02', 'split_from': 1, 'split_to': 2},
        {'ticker': 'XYpA', 'execution_date': '2021-01-04', 'split_from': 1, 'split_to': 2},
    ]


def test_a_class_share_reads_the_splits_filed_under_its_undotted_spelling():
    t = F.build_factor_tables(_cs_rows(), AS_OF)
    out = F.with_class_share_spellings(t, ['BF.B', 'AAPL'])
    assert out['BF.B'] == [['2004-01-21', 2.0], ['2012-08-13', 1.5], ['2016-08-19', 2.0]]   # 2004 once
    assert t['BF.B'] == [['2004-01-21', 2.0]]                     # the input is not changed


def test_an_undotted_spelling_that_is_its_own_symbol_is_never_borrowed():
    t = F.build_factor_tables(_cs_rows(), AS_OF)
    out = F.with_class_share_spellings(t, ['C.WD', 'CWD'])       # CWD is CaliberCos, not C.WD
    assert 'C.WD' not in out and out['CWD'] == [['2025-05-02', 1 / 15]]
    assert F.with_class_share_spellings(t, ['BF.B', 'BFB'])['BF.B'] == [['2004-01-21', 2.0]]


def test_lowercase_vendor_symbols_are_left_alone():
    t = F.build_factor_tables(_cs_rows(), AS_OF)
    assert F.with_class_share_spellings(t, ['XY.pA'])['XY.pA'] == [['2020-01-02', 2.0]]
