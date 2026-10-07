tip under test: 8852a2a8c0 (configuration c3)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 12:09:59`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-walk\c3; identity = 95211d4e0ae86b51378059b7165c33f9
- `2026-10-07 12:10:40`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:12:32`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:12:42`  **shutdown** — C:\data, 62 db files — CLEAN
