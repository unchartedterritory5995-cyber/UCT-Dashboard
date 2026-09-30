# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 19:12:16`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10r1d-2; identity = df3f3ced657a0c99176ec3b085062fc3
- `2026-09-29 19:13:48`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 19:15:41`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 19:15:51`  **shutdown** — C:\data, 62 db files — CLEAN
