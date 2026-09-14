# Wisdom rails, v1

How the Wave 1 ban rails, the owner-private store guards, the journal-exclusion grep and
the vocabulary authority check work, what proves each one can fail, and what none of
them can see. **The code is the authority; this page explains it.** Where a number or a
list lives in code, this page names the constant instead of restating it — read it there.

| File | Role |
|---|---|
| `api/services/wisdom/core/bans.py` | the four rails; standard library only, imports nothing from `api.*` |
| `tools/wisdom/core_check_bans.py` | the pre-merge CLI (exit 0 / 1 / 2) |
| `tools/wisdom/core_journal_exclusion_grep.py` | the W1 §10.5 grep, classified |
| `tests/test_wisdom_bans.py` | the rails' controls and the grep's controls |
| `api/services/wisdom/core/private.py` | the owner-private store and its guards |
| `tests/test_wisdom_core_private.py`, `tests/test_wisdom_core_private_routes.py` | the store's controls and the owner gate on the real app |
| `tests/test_wisdom_vocab_authority.py` | a setup-name constant with no vocabulary map row fails by name |
| `.github/workflows/wisdom-rails.yml` | CI for all of the standard-library checks |

## 1. What the rails enforce

| Rail | Ruling | Fails on |
|---|---|---|
| `substack` | W1 §0.4a | a Wisdom module importing the Substack publisher, or a Sunday Scans publish / run / promo module (star imports included); a string naming the saved Substack login file or a Sunday Scans drafts path |
| `journal` | W1 Part 10 (D16b deferred) | a Wisdom module importing Journal, J2, Notebook-search or broker/note-sync code; a string naming a J2 table, a Journal 1.0 table, the `journal-2-0` path, a `lib/offline` path, or the J2/Journal API prefix |
| `private_store` | W1 §0.4d (D16a) | any module under `api/` or `tools/wisdom` other than the three owners reaching `core/private.py` by import, relative import, attribute, `getattr`, `importlib` / `__import__` string, or a path string |
| `offlimits` | W1 §0.4i, CONTRACTS §1 | a program branch whose diff, working tree or untracked files touch an off-limits path |

They are static checks run in CI and before merge. They do not run inside the product,
and they cannot stop a runtime read the code never names (section 9).

## 2. How a source rail reads a file

- **Scope** is `SCOPES`. `substack` and `journal` read the program scope (Wisdom services,
  Wisdom routers, Wisdom tools). `private_store` reads all of `api/` plus the Wisdom tools,
  because the private store must be unreachable from the whole product, not only from Wisdom.
- **Imports come from the AST, in every form:** `import a.b`, `from a import b`, relative
  imports resolved against the file's own package, star imports, aliases, and
  `importlib.import_module("…")` / `__import__("…")` with a literal.
- **Strings:** every string constant except a docstring is matched against the rail's
  patterns. Comments are not in the AST at all.
- **So prose explaining a ban never trips the ban**, and a banned name in code always does.
- **A file that does not parse is a violation.** It cannot be proven clean.

## 3. Exemptions are exact sets

- `BAN_CHECK_FILES` — the rail module and its two tools must spell the banned names. Only
  their **string constants** are exempt; their **imports are still checked**.
- `PRIVATE_ALLOWED_IMPORTERS` — `core/private.py`, `extract/writer.py`, `api/routers/wisdom_core.py`.
- Both sets are asserted exactly by `tests/test_wisdom_bans.py`, and the real-router allowance
  is proven load-bearing: remove the router from the set and the real scan goes red.
- ⛔ Adding a file to either set is a contract change, not a fix. The CI failure message says so.

## 4. Floors, sentinels and INCONCLUSIVE

- `SCOPE_FLOORS` gives each source rail a minimum file count and named sentinel files that
  must be among those scanned. Below either, the result is **INCONCLUSIVE, never a pass**:
  a wrong root, a moved directory or a glob that matches nothing reads exactly like a clean tree.
- The grep carries the same shape (`FLOOR`, with the programme manifest as a sentinel).
- **Exit codes** (CLI, grep, CI): `0` every rail measured and is clean · `1` at least one
  violation, each named `[rail] path:line: detail` · `2` no violation, but something could not
  measure. `1` wins over `2`.
- `--no-floor` exists for synthetic trees in tests. Never use it on the real repository.

## 5. The off-limits diff rail

- **Applies only on a program branch** (`PROGRAM_BRANCH_RE`: `feat/wisdom-loop` or
  `wisdom/*`). Any other branch is SKIPPED with the reason: the off-limits list is this
  programme's commitment.
- **Branch identity:** `GITHUB_HEAD_REF` (pull requests), then `GITHUB_REF_NAME` unless it is a
  `/merge` ref, then `git rev-parse --abbrev-ref HEAD`. No identity is INCONCLUSIVE.
- **Base:** the merge base with `origin/master`, then `master`, then `origin/HEAD`. None (a
  shallow clone) is INCONCLUSIVE — which is why CI checks out with `fetch-depth: 0`.
- **Changed files:** the committed diff from the merge base (`--name-only --no-renames -z`, so a
  rename reports both paths), plus the working tree, plus untracked files that are not ignored.
  A forbidden file that is staged but not committed still fails.
- **Off-limits:** `OFFLIMITS_PREFIXES`, `OFFLIMITS_FILES`, `OFFLIMITS_BASENAMES`, and any
  `lib/offline` segment.
- **The git plumbing is proven on a hermetic repository** (empty global config, no system
  config), because an empty diff from a broken invocation reads exactly like a clean branch:
  a clean program branch must report the one file it changed, a dirty one must report both the
  committed and the untracked forbidden path, and a non-program branch must be skipped.

## 6. The journal-exclusion grep (W1 §10.5)

The owner's check, as a grep would do it: case-insensitive substrings `journal`, `j2`,
`notebook`, `broker`, `fills`, `reconcil` over the programme paths and `docs/wisdom/`
(the manifest included). Every hit gets three tags:

- **class** — `ban-check` (the rails, their tests and this page, or a line carrying the
  `journal-exclusion guard` marker, i.e. a runtime refusal); `ruling-text` (a `docs/wisdom`
  line, or a Python docstring or comment-only line, that states a ban, deferral or
  exclusion); `live-reference` (everything else — a human reads these).
- **sense** — `journal` when the line names journal / j2 / notebook / broker; `other` when
  only `fills` / `reconcil` matched, or when the only journal word is SQLite's `journal_mode`
  pragma.
- **kind** — `doc` under `docs/` or in a `.md` / `.txt` file; `code` otherwise.

`--strict` exits 1 only on a **live-reference with journal sense in code**. A plan paragraph
that names D16 is a human's to read, not a gate's to fail. **A trailing comment does not make a
code line prose**, and unparseable Python has no prose lines. The grep is a reading aid; the
import rails are the enforcement.

## 7. The owner-private store

`core/private.py` holds share counts, position sizes and stated entries on open positions,
as stated in the content streams, and nothing else (W1 §0.4d). Its guards:

| Guard | Behaviour |
|---|---|
| key unset | `put_private` returns False and writes **nothing**: no file, no table, no row, never a plaintext fallback |
| encryption | every value is Fernet-encrypted by `CryptoBox("WISDOM_PRIVATE_KEY")` (retired key env `WISDOM_PRIVATE_KEYS_V1`) |
| separate file | `WISDOM_PRIVATE_DB_PATH`, resolved per call; a path that is the same file as `wisdom.db` is refused |
| excluded locators | a source locator pointing into Journal, J2, Notebook or broker data is refused (`journal-exclusion guard`) |
| contract | an unknown field, blank record id or blank locator raises; an empty value stores nothing |
| read back | only through `GET /api/admin/wisdom/core/private/{record_id}`, gated by `require_owner` (the first `ADMIN_EMAILS` entry), `Cache-Control: no-store`, 503 while the key is unset |
| census | the `/data` default is pinned by the repo-root conftest census and is not a new unguarded site |

**Property test:** 500 seeded random records (`CASES`, `SEED` in the test) — no private value
lands in any `wisdom.db` column. The scanner's own controls prove it finds every public token it
should and a private value planted where it must not be. The same property over publish-adapter
output is guarded by `find_spec` and **skips, naming the seam**, until
`api.services.wisdom.publish.adapters` exists; re-run it after that merge.

## 8. Mutation checks

Each guard was broken by an edit, the suite was run, the red was read, and the guard was
restored by an edit — never by a checkout. Run on `wisdom/w1-b-rails`, 2026-09-13.

**Rails, vocabulary, aliases, spoken prices, entities, speakers** (applied together):

| Id | Broken | Must go red |
|---|---|---|
| M-a | the Substack import predicate compares against a name that never matches | Substack planted-import controls |
| M-b | the J2 table pattern misspelled | Journal planted-table controls |
| M-c | the private-store importer check inverted | planted private-store controls and the real-router allowance |
| M-d | untracked files dropped from the diff rail | the hermetic dirty-branch test |
| M-e | the floor check disabled | the below-floor INCONCLUSIVE tests |
| M-f | docstrings no longer excluded from string checks | the docstring controls |
| M-g | one map row's external name changed in `setup-vocabulary-v1.json` | the vocabulary authority check, by name |
| M-h | the auto-promotion flag gate forced on | the flag-off promotion test |
| M-i | owner-decided vocabulary rows overwritten by a reseed | the owner-decision-kept test |
| M-j | an alias context rule forced to always fire | the ordinary-English "light" test |
| M-k | the price sanity pass accepts more than one plausible reading | the ambiguous-reading test |
| M-l | the single-letter ticker penalty removed | the single-letter test |
| M-m | the crypto underlying dropped from a resolution | the crypto-vehicle test |
| M-n | a guest speaker no longer requires every name token to match whole | the guest-name tests |

All fourteen together: **113 failed, 188 passed, 1 skipped**; every mutation's control was among
the failures. Restored: green.

**Private store** (two runs, so the layers could be told apart):

| Id | Broken | Result |
|---|---|---|
| P-b | the excluded-locator guard removed | `test_a_locator_into_journal_or_broker_data_is_refused` red (4 cases) |
| P-c | the same-file guard removed | `test_the_private_store_never_shares_a_file_with_wisdom_db` red |
| P-d | the key-unset guard removed **alone** | **green** — `CryptoBox` refuses to encrypt without a key, so the explicit guard is the first of two layers and neither alone is load-bearing |
| P-a + P-d | plaintext stored **and** the key guard removed | `test_with_the_key_unset_nothing_is_stored_and_no_file_is_created`, `test_values_round_trip_and_only_ciphertext_reaches_disk`, `test_a_rewrite_replaces_the_value_and_keeps_one_row`, `test_property_no_private_value_ever_lands_in_wisdom_db` red. The round-trip test runs with the key set, where P-d cannot act, so its red is P-a's alone |

**The grep:**

| Id | Broken | Result |
|---|---|---|
| G-a | docstring / comment prose no longer counts as ruling text | the classification test, the strict clean control and the real-checkout measurement red |
| G-b | the `journal_mode` pragma counted as the Journal | the classification test red (and the real checkout) |
| G-c | `--strict` counts plan documents as well as code | the strict clean control red (and the real checkout) |
| G-d | the grep's floor disabled | the below-floor INCONCLUSIVE test red |

## 9. What these checks cannot see

- **A module name or SQL built at runtime** (concatenation, formatting, a value read from
  config). The rails read literals; a determined dynamic reach is invisible to them.
- **Code outside the scopes** — the frontend, and any Python outside `api/` and the Wisdom tools.
- **Content-level leaks.** The rails prove what code imports and names, not what an LLM writes
  into a record. The property test covers the store and `wisdom.db`; the publish-adapter half
  waits for the adapters to exist.
- **Source text in data files.** No rail compares committed JSON or test strings with the golden
  files (W1 §0.4f: no transcript text, golden quotes or private levels in git). The S-B vocabulary
  file was checked by hand against the gitignored golden files before commit, found to carry
  golden-set excerpts, and reduced to locators only: `definition` is null, evidence items are
  `{stream, source_ref, locator}`, aliases are name-like forms of at most three words with no
  price level. Test prices and sentences are illustrative, never an author's level or line.
- **Branches outside the programme.** The diff rail skips them by design.
- **The grep's classes are heuristics.** A ruling word on a code line's trailing comment does
  not rescue it, but a docstring that merely mentions a ban word is classed as ruling text.

## 10. Running them

```sh
python tools/wisdom/core_check_bans.py                   # all four rails; exit 0 / 1 / 2
python tools/wisdom/core_check_bans.py --rail offlimits  # one rail
python tools/wisdom/core_journal_exclusion_grep.py --strict
python -m pytest --noconftest -p no:cacheprovider tests/test_wisdom_bans.py tests/test_wisdom_vocab_authority.py -q
```

CI (`.github/workflows/wisdom-rails.yml`) runs the CLI and those two test files on Python 3.12
with nothing installed but pytest. `--noconftest` is load-bearing: the repo conftests import the
product. The vocabulary check's engine-database comparison skips unless `WISDOM_ENGINE_DB` points
at a read-only copy of `uct_intelligence.db`; `tools/wisdom/core_vocab_engine_check.py` runs the
same comparison by hand.
