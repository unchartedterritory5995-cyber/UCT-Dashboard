tip under test: 8852a2a8c0 (configuration c1)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 11:50:50`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-walk\c1; identity = 55a6d61205d51d0915aeee172faf75a9
- `2026-10-07 11:51:40`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 11:53:34`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:09:14`  **shutdown** — C:\data, 62 db files — CLEAN
