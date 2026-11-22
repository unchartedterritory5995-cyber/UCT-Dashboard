# UCT Agent coach — concept knowledge base (Wave 3, W3-1)

`concepts/*.md` is the ONLY text the coach explains from. The server
(`api/services/uct_agent/coach/concepts.py`) parses this directory at import and serves it to the
browser (`GET /api/agent/coach/concepts`, admin-only, `UCT_AGENT_COACH=1`); the model is told to use the
concept text it is given, never to improvise an explanation (`coach/prompt.py`).

## File format (parsed, so keep it exact)

```
---
id: relative-strength            # stable, kebab-case, equals the file name
title: Relative strength
aliases: rs, rs line, relative strength line
observe: ma | volume | none      # which ONE grounded chart observation may accompany it
---
## What it is
## What to look for
## Common mistakes
## Uncertainty
```

Rules that do not bend (railed by `tests/test_uct_agent_coach.py`):
- at least 12 concepts; every file has all four sections, and the Uncertainty section is never empty;
- no guarantee / order language anywhere (the coach guard's own phrase list runs over every file);
- no advice about THE MEMBER's own size, entries or exits: formulas and principles only;
- figures are generic (a "20-day average" is a concept, not a reading) — the one observation line comes from
  a served envelope, never from this text;
- plain text, no markdown tables, no links; each section is short enough to read in a chat bubble.
