"""D2 — the canonical data model, as code the product may read.

⛔ APPROVED SCOPE (owner, 2026-09-12, GATE-D2 line 2, NARROWED): CP2 —
`bars_sqlite` joins the book, and exactly ONE reader resolves through it, DARK.
CP3 needs a new line.

Two modules, and the split is the point:

  `address_book` — reads the derived book. It answers, or it answers `None`;
                   it never invents a default, because a defaulted ordinal is
                   an address that confidently returns the wrong column.
  `dual_read`    — runs the legacy and book paths side by side, SERVES THE
                   LEGACY VALUE, records the comparison, and never raises.

⭐ Nothing here computes a value. D2's own spec §6.3: *"If D2 ever answers
differently from the store it addresses, D2 is wrong."*
"""
