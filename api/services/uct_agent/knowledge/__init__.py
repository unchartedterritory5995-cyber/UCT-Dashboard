"""UCT Agent knowledge kinds (KN-1): the Trading Brain's approved knowledge, read-only, through the MD-1 gateway.

Kinds: knowledge.search · setup.playbook · setup.record (kinds.py). Everything here only READS:
  - the installed Brain Pack database (`brain_sync.brain_dir()/data/uct_intelligence.db`, opened mode=ro),
  - the existing facades `brain_service.lookup_playbook` / `setup_winrate` (byte-identical, never edited).
Default-deny source policy: docs/agent/knowledge/policy.json (policy.py). No external call is made anywhere
in this package (no embedding, no model): retrieval is SQLite FTS5 over a local index keyed on the pack.
Dark by construction: the gateway registers these kinds only once its REGISTRARS lists this package, and
every read also needs UCT_AGENT_KNOWLEDGE=1 (read per request).
"""
