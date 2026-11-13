tip under test: 7e849c6740 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-11-12 19:50:19`  **pre-boot (baseline)** — C:\data, 63 db files — CLEAN
    - sandbox = <temp>\ff2-held-data\c2; identity = beee430d34775f49f382dfbee65c7c07
- `2026-11-12 19:51:10`  **post-boot (+15s)** — C:\data, 63 db files — CLEAN
- `2026-11-12 19:53:02`  **post-prewarm (+120s)** — C:\data, 63 db files — CLEAN
- `2026-11-12 20:52:51`  **shutdown** — C:\data, 63 db files — **1 FILE(S) CHANGED**

| | file | detail |
|---|---|---|
| CHANGED | `bars.db` | 3310784512 -> 3311173632 bytes; sha256 eb64e99e41eb -> 52f206654082 |

