# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 20:55:14`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 477f40d105b55f7c2008adebbd09cda8
- `2026-09-26 20:55:49`  **post-boot (+15s)** — C:\data, 62 db files — **1 FILE(S) CHANGED**

| | file | detail |
|---|---|---|
| CHANGED | `auth.db` | 1011220480 -> 1011220480 bytes; sha256 060078da7b9a -> 7de510908b7f |

