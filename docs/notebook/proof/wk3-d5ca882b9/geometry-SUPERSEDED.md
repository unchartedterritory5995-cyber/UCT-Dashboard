# geometry.json from this run is NOT committed -- superseded, and oversized

This run's geometry sweep used the PRE-FIX occluder/at-rest code (before commits `a05944039`
and `e6d1e93f7`). Its raw `geometry.json` was 5.3 MB, over `tools/check_repo_hygiene.py`'s 5 MB
limit, and every number this program's README cites for clause 6c comes from the CORRECTED,
control-VALID re-run committed at `docs/notebook/proof/wk3-e6d1e93f7-geo/geometry.json` instead
-- so keeping the oversized, superseded file in git bought nothing but a hygiene violation.

Kept locally (not in git) at this lane's own scratchpad, `wk3-old-buggy-geometry.json.bak`, for
anyone who wants to diff the two shapes by hand; not needed to trust the README, which cites
only the corrected run.
