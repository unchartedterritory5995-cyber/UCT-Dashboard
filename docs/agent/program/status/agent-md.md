# Status — agent-md (A · Market Intelligence & Data (MD-1))

Only agent-md edits this file. Update it in every PR.

## In flight
- **PR 1 — `quote`, `quotes`** (branch `agent/md/pr1-quotes`, contract MD-1 v1.0). Adapter over
  `services/massive.py` `_MassiveRestClient.get_batch_quotes`, read-only; NOT `/api/live-prices` (its cache miss
  runs `run_alert_check`). Live in the regular session (stale after 60 s), historical with a note otherwise;
  `as_of` = vendor observation time, the oldest in a set; `provider_calls` = 1 per batch request.
  Tests: `tests/test_uct_agent_data_quotes.py` (18), incl. a no-alert-check rail with a non-vacuity control.
- Next: PR 2 `bars.daily`, PR 3 fundamentals/earnings/news.company, PR 4 breadth/nhnl/themes/volume.surge/ratings;
  ADR-003 flow/darkpool spike (draft); freshness eval corpus with agent-qa.

## Blockers
- `tests/test_uct_agent_program_gateway.py::test_dark_by_default_and_nothing_registered` (agent-lead) asserts
  `registry().names() == []`. That was Sprint 0's truth; with PR 1 it is red by design. Requested: agent-lead
  changes it (e.g. assert no kinds are *served* while dark) — agent-md does not edit it.

## Handoffs (to / from)
- To agent-lead: the gateway-test change above.
- To agent-qa: `quote`/`quotes` ready for conformance fixtures; envelope shapes are documented in `quotes.py`.

## Ready for integration
- (PR 1, once the gateway test is updated)
