"""Golden evaluation set for the AI-Native Research Assistant Slice 1
("Explain") -- required by the owner authorization, 2026-09-04.

Modeled directly on api/services/compass_eval/'s template (golden set +
mechanical checks + runner + trend-worthy report shape), scaled down to
this slice's own single-shot orchestrator (ticker_explain.py) rather than
Compass's multi-turn chat handler -- there is no generator to replay and
no persisted chat history, so `runner.py` here is a straight function
call per question, not a stream reader.
"""
