# PR: knowledge policy cache never serves a stale file after a same-tick rewrite

## Cause
`knowledge/policy.py` (and the identical cache in `knowledge/criteria.py`) cached the parsed file keyed on
`(path, st_mtime)`. Two writes to the same path within one mtime tick kept the key, so `load()` returned the
PREVIOUS policy. `test_r751_mentions_mode_only_serve_flagged_re_admits` hits this: `_with_policy` names each file
`policy-{time.time_ns()}.json`, and on Windows consecutive `time_ns()` values can collide, so the loop rewrites one
path inside one tick and reads the old `mode` (failed 3/5 on master). In production it means an owner policy edit
could be ignored until the next mtime change.

## Fix
- Key = `(st_mtime_ns, st_size)` via `policy.file_key()`: free (same single `stat` as before), no extra read on the
  hot path (`classify()` calls `load()` per source).
- Same-size + same-ns rewrites are the residual hole, so `policy.cache_hit()` also applies git's "racily clean"
  rule: a file modified within `RACY_WINDOW_NS` (2 s) of now is always re-read. Only the first moments after an edit
  pay a read; settled files are served from cache with one `stat`.
- `criteria.py` uses the same helpers.

## Evidence (real pytest, local venv)
- `tests/test_uct_agent_knowledge.py` x5 in a row: 180 passed each run.
- New rail `tests/test_uct_agent_policy_cache.py` (5 passed): same-ns different-content rewrite -> new content;
  control with the old `st_mtime` key monkeypatched back -> stale (bug reproduced); same-size same-ns rewrite in the
  racy window -> re-read, control with the window disabled -> stale; settled file -> served from cache with no read;
  criteria same-tick rewrite -> new content.
- knowledge_reply, coach_vocab, evidence, spend_protection + rail: 318 passed.

## Files (`git diff --name-only origin/master`)
- api/services/uct_agent/knowledge/criteria.py
- api/services/uct_agent/knowledge/policy.py
- docs/agent/program/PR-fix-policy-cache.md
- tests/test_uct_agent_policy_cache.py
