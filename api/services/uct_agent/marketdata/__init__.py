"""UCT Agent market-data gateway (contract MD-1, docs/agent/program/contracts/MD-1-market-data.md).

One server-side entry point for every Agent market-data read. Each kind is an ADAPTER over an existing
canonical UCT service (massive snapshot, bars_fetch, fmp_client, breadth_current, screener/query …): it
never opens a new upstream connection, WebSocket, scheduler job or database, and it never forks a
pipeline. Every answer is a DataEnvelope (envelope.py) carrying its source, the DATA's own time
(`as_of`) and a freshness class.

Dark: nothing is served unless UCT_AGENT_DATA=1 (scan kinds also need UCT_AGENT_SCAN=1), and the only
route (/api/agent/data) is admin-dark like every /api/agent/* route.

Ownership (docs/agent/program/OWNERSHIP.md): this package — agent-md; scan kinds live in
api/services/uct_agent/scan/ — agent-sc.
"""
