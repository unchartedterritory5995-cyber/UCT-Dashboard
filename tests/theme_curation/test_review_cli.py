from tools.theme_curation import review_cli
from tools.theme_curation.proposals import Proposal
from tools.theme_curation.ledger import Ledger


def test_records_and_resumes(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    props = [Proposal("t", "add", "AAA", 0.4), Proposal("t", "add", "BBB", 0.4)]
    answers = iter(["a", "r"])
    review_cli.review_interactive(props, lg, input_fn=lambda _: next(answers), out_fn=lambda *_: None)
    assert lg.get("t", "AAA", "add")["decision"] == "approve"
    assert lg.get("t", "BBB", "add")["decision"] == "reject"

    # Resume: both already decided -> input_fn must NOT be called again
    def _boom(_):
        raise AssertionError("should not prompt for already-decided items")
    review_cli.review_interactive(props, lg, input_fn=_boom, out_fn=lambda *_: None)
