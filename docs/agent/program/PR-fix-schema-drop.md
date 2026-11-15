# Server: never silently drop a capability over its args schema

## Cause

`api/services/uct_agent/turn.py` `validate_manifest` keeps a capability only if its `args` schema is inside the
structured-output subset: keys limited to `_SCHEMA_KEYS` = `type, properties, required, additionalProperties, enum,
const, items, anyOf, description`, every object `additionalProperties: false` with every property required, depth at
most 6. Anything else (`minItems`, `maxItems`, `minimum`, `maximum`, `pattern`, `format`, `default`, …) made the old
`_closed_schema` return False and the loop `continue` with **no log**. The whole capability is left out, so the model
can't call that action at all. #1076 hit this with `minItems`/`maxItems` on its alert-levels list. Its pytest caught it
through `test_the_real_manifest_survives_validation_intact`, but in production the drop would have been silent.

## Census (AUDIT, confirmed by the Lead)

`app/src/agent/contract/manifest.golden.json` on origin/master has 0 uses of `minItems`/`maxItems`. No shipped action
is dropped. The new rail measures the same thing with the server's own code: `schema_problems` is empty for every
golden capability.

## Fix

- `schema_problems(node)` replaces `_closed_schema`. It applies the same rule but returns each violation by path and
  keyword (for example `args.levels: unsupported keyword(s) maxItems, minItems`). It is exactly as strict as before;
  the only change is that a non-list `anyOf` is now treated as a violation.
- `validate_manifest` now logs at ERROR, naming the capability and the reasons, when it leaves one out for its
  schema. It runs on every turn, so each (capability, reason) is logged once per process (module-level
  `_SCHEMA_DROP_LOGGED`). The drop itself happens on every turn, as before. It still leaves out only that capability. It does not refuse the whole turn, so one bad action can't take
  down every request. Bounds the subset can't express belong in the capability's code, as #1076 did.
- Rail in `tests/test_uct_agent_contract.py`:
  - every golden capability is inside the subset (failures are listed by name and keyword);
  - control: a planted capability with `minItems`/`maxItems` fails the rail, is dropped by `validate_manifest`, and
    the ERROR log names it and `minItems`;
  - each kind of violation is named (missing required, `minimum`, `pattern` inside `anyOf`);
  - two `validate_manifest` calls with the same bad capability give exactly one ERROR, and it is dropped both times.

## Evidence

- `pytest tests/test_uct_agent_contract.py`: 15 passed, including the 4 new tests.
- First commit: `pytest` on every server test that calls `validate_manifest` or reads the golden manifest (28 files):
  1157 passed.
- After the AUDIT log-once change: `pytest` on the contract test plus every test file that calls `validate_manifest`
  (15 files): 554 passed.

## Files
- `api/services/uct_agent/turn.py`
- `docs/agent/program/PR-fix-schema-drop.md`
- `tests/test_uct_agent_contract.py`
