"""Turns raw user search text into an FTS5 MATCH expression.

ONE authority for this translation. FTS5's MATCH grammar raises on
unbalanced quotes and reinterprets bare words like OR / NEAR / NOT as
operators, so raw user text can never be passed through -- it would either
500 the notes list or silently change what the member asked for.

Every term is quoted (which makes operators literal) and the final term gets
a `*` so search feels live as you type.

⚠️ This is a deliberate, reviewed behaviour change from the old LIKE-only
search: FTS5 MATCH with a `*` suffix matches TOKEN PREFIXES, not arbitrary
substrings. Searching "andle" no longer finds a note containing "handle" --
only "cup", "handle", "handles", etc. (whole tokens, or tokens the last term
is a literal prefix of) match. See notes.py's `list_notes` for the LIKE
fallback (used only when this returns None) and test_notes_fts.py for the
rail that pins this divergence on purpose.
"""
from __future__ import annotations

import re

# Anything that is not a word character or a digit is a separator. This also
# strips the quote characters that would unbalance the expression.
_TERM_RE = re.compile(r"[^\w]+", re.UNICODE)


def fts_match_expr(q: str) -> str | None:
    """Returns an FTS5 MATCH expression, or None if `q` has no searchable
    term (caller falls back to LIKE). Never raises on user input."""
    if not q:
        return None
    terms = [t for t in _TERM_RE.split(q.strip()) if t]
    if not terms:
        return None
    quoted = [f'"{t}"' for t in terms[:-1]]
    quoted.append(f'"{terms[-1]}"*')  # prefix-match the term being typed
    return " ".join(quoted)
