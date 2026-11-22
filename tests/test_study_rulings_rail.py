"""The bank agrees with every owner ruling on a question or a chart example (NOTE_LEDGER section 14).

His latest keep on an item must name an item still in a bank file and on no retire list; his latest cut must leave no
such item in a bank file that is not retired (scripts/study/check_rulings.py; the pod half is a dry run of
scripts/study/retire_ids.py, which names any listed item that is not a draft). A bank regeneration that drops a keep,
or brings a cut back under its old id, fails here by name.
"""
from scripts.study import check_rulings


def test_every_keep_is_in_the_bank_and_every_cut_is_retired():
    res = check_rulings.check()
    assert res["tally"]["keeps checked"] > 100 and res["tally"]["cuts checked"] > 50     # it really read the rulings
    assert res["problems"] == [], res["problems"][:5]


def test_his_latest_ruling_on_an_item_stands():
    # the Go Signal hourly sitting: "Okay" on the full window, then "Cut" on the open close-up (go-hourly-2)
    res = check_rulings.check()
    assert res["tally"]["superseded by a later ruling"] >= 3
