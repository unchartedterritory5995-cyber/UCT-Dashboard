# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 20:09:34`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10l3; identity = f571e4805055e85f1f2aa002e825c77c
- `2026-09-28 20:10:10`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 20:12:01`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 20:12:07`  **shutdown** — C:\data, 62 db files — CLEAN
