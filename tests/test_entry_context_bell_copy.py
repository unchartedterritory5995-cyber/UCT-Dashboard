"""P0.4 -- the new-fill bell notice must not send the member to the Notebook.

The notice's link is the trade side (Open Positions), and Research Home's Notices box now shows
it beside Notebook notices. A sentence that says "captured in your Notebook" under a link that
opens the Positions tab sends the member looking in the wrong place.
"""
from api.services.journal_two import entry_context as ec


def test_the_fill_notice_does_not_send_the_member_to_the_notebook():
    assert "Notebook" not in ec.BELL_MESSAGE
    assert ec.BELL_VIEW_URL == "/journal?j2tab=positions"
