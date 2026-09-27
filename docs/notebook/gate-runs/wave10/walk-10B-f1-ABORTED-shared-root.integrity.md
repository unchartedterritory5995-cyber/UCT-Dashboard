# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 20:55:24`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10b; identity = c54ef879ddfc79e898bc91003b4fd1d1
- `2026-09-26 20:56:00`  **post-boot (+15s)** — C:\data, 62 db files — **1 FILE(S) CHANGED**

| | file | detail |
|---|---|---|
| CHANGED | `auth.db` | 1011220480 -> 1011220480 bytes; sha256 060078da7b9a -> 7de510908b7f |

