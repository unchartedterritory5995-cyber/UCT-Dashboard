"""UCT Agent research (contract RS-1, docs/agent/program/contracts/RS-1-research.md). Owner: agent-rs (W2-B1).

One composed MD-1 kind, `research.company`, built from the gateway kinds the server already serves plus the
ONE web search the turn already pays for. Facts carry only figures the gateway returned; web prose is
interpretation and is stripped of any figure the gateway did not return. Nothing here opens an upstream
connection of its own: the inputs are gateway reads (counted against the turn) and `turn._research`
(metered through budget.Meter.research exactly as the turn does).
"""
