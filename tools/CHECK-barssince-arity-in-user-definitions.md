# 3.2 pre-check — is any shipped definition using a 2-argument `ta.barssince`?

Ruling 3.2 (drop the declaration to one argument) is **gated on this count**. The local
box has a DEV store only — **4 rows, 0 mentioning `barssince`** — which says nothing
about production. The production read was **denied to me** by the auto-mode classifier
(`[Production Reads]`), so this is the owner's to run.

⛔ **Read-only. Never a write to `/data`.**

## The probe

`tools/_probe_barssince_arity.py` (below, also written to disk by this session).

## The command

```sh
cd C:/Users/Patrick/uct-worktrees/indicator-r0r1
B=$(base64 -w0 tools/_probe_barssince_arity.py)
railway ssh --service web "echo $B | base64 -d > /tmp/p.py && /opt/venv/bin/python /tmp/p.py"
```

⚠️ `/opt/venv/bin/python`, not bare `python3` — the Nix system python has none of the app
deps. And pass the script base64-encoded: `railway ssh` joins argv into one `sh` string,
so quotes, parens and heredocs all break.

## What to paste back

```
PROD_TOTAL <n> LIVE <n> TWO_ARG_HITS <n>
   HIT (user_id, def_id, version, argcount)   ← one line per hit, if any
```

- **`TWO_ARG_HITS 0`** → 3.2 lands: drop the declaration to one argument.
- **any hits** → per the ruling, list them by owner and **refuse rather than silently
  break**; the declaration change waits on a migration decision.
