# ⚠️ ROUTED TO THE OWNER OF `api/services/ticker_explain.py`

**Not a Notebook file. Wave P does not own it and has deliberately not touched
it.** This note exists because the Wave P release could not honestly claim a
green repository while this stands, and because a red rail with no addressee
becomes a red rail everyone learns to ignore.

```
CLASSIFICATION   LIVE REPO DEFECT · OTHER WORKSTREAM OWNED
STATUS           present on origin/master BEFORE the Wave P merge
INTRODUCED BY    a21518d0e "Add Security Research Q&A Slice 2:
                 6-composer contextual assistant (I1)"
FOUND BY         the Wave P release reconciliation, 2026-09-09
```

## The failing rail

```
tests/test_no_shadowed_definitions.py::test_no_module_shadows_its_own_definitions

  api/services/ticker_explain.py: _DOMAIN_FETCHERS (constant) at lines [930, 1000]
```

## The two bindings

```python
# line 930
_DOMAIN_FETCHERS: dict[str, tuple] = {}  # populated below _build_evidence to avoid import cycles

# line 1000
_DOMAIN_FETCHERS = {
    "news": _fetch_news,
    "analyst": _fetch_analyst,
    ...
}
```

⛔ **The comment says "populated". The code REBINDS.** `.update(...)` would have
kept the object the forward declaration created; `=` replaces it. Python keeps
the last binding, so the first one is dead — and the sentence beside it is a
claim about a mechanism that is not what runs.

## What it costs today, measured rather than assumed

- The only read is **line 1041**, inside a function, at call time — after both
  bindings have executed. **So the shipped behaviour is currently correct.**
- Between the two bindings: **8 function definitions and zero reads** of the
  name.

⭐ **It is therefore latent, not live-broken.** It becomes real the moment
anyone does what the forward declaration invites: aliases the name at import
time (`from api.services.ticker_explain import _DOMAIN_FETCHERS`), captures it
into a default argument, patches it in a test, or reads it from one of those 8
functions. Each of those gets the **empty** dict, and the failure is a silently
missing domain rather than an error.

## What this needs from its owner

One of two decisions, whichever matches the intent:

1. **If the forward declaration is load-bearing** (the import-cycle story), make
   line 1000 populate rather than rebind — `_DOMAIN_FETCHERS.update({...})` —
   and the comment becomes true.
2. **If it is not**, delete line 930 and let the single definition stand.

Either way `tests/test_no_shadowed_definitions.py` goes green and the repo can
be called green again.

⛔ **Wave P will not make this change.** It is a different workstream's file and
a different workstream's intent; guessing which of the two fixes was meant is
exactly the kind of edit that turns a latent defect into a live one.
