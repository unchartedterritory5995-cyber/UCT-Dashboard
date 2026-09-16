# Wave S — owner decisions

> One entry per decision. Each records **what was asked**, **what was ruled**, and
> **what it settles in code** — so a reader can tell a decision from a proposal
> without asking. (That distinction is what closed C-6 for Wave T: the answers
> existed a day before the ratification, and until then they read as proposals.)

---

## S-07 · user-defined templates are **FREE** — 2026-09-14

**Asked.** S-07's remaining scope is two gaps: no user-defined templates, and no
financials/valuation scaffold. Specifying the first requires knowing whether a
member's own template is a paid capability. The spec refused to guess, because
**two shipped precedents in this repo answer it oppositely** and both are live:

| precedent | gate | reading |
|---|---|---|
| `j2_note_saved_views` — the closest structural analog (a user-authored, per-account artifact in the Notebook itself) | `Depends(get_current_user)` on all four routes | **free** |
| `api/routers/user_definitions.py` — the other user-authored artifact in the app | *"EVERYTHING HERE IS PAID (owner ruling). There is no free read: a definition list is user content on a premium surface."* | **paid** |

**Ruled: FREE.**

**What governs.** `j2_note_saved_views` is the governing precedent for Notebook
templates. `user_definitions.py`'s paid ruling remains true **for definitions**
and does not extend here. Recording which one governs is the point of this entry —
the contradiction is not resolved by deleting one precedent, it is resolved by
scoping each.

⭐ **The reasoning, so it is not re-litigated.** The nine built-in templates are
free today. Gating a member's own version of a free feature would make the paid
tier the price of *personalising something they already have*, which is not what
the premium surface is for.

**What it settles in code** — this is a scope ruling, not an implementation
detail, and it decides three things at once:

1. **The gate** — the CRUD routes take `get_current_user`, not the paid
   dependency.
2. **The store** — the spec recommends a `j2_note_templates` table over the
   `user_preferences` idiom, on the two prior rulings against prefs for
   author-in-a-loop content. FREE does not change that recommendation; it removes
   the entitlement column from the decision.
3. **Two rails** — one asserting a non-paid account can create and read its own
   template, and one asserting the built-ins remain reachable for an account with
   no templates of its own. Each must be able to FAIL: flip the dependency to the
   paid one and the first must redden.

⛔ **Not settled by this ruling, and still open:** whether a member's template can
be *shared* with another member. Sharing is a different question with a different
blast radius and is **out of S-07's scope** — do not infer an answer from FREE.

**Recorded in both places**, so neither precedent can be cited against it later:
here, and in `PROGRAM-MANIFEST.md` §7 (Contradictions resolved).
