tip under test: 8852a2a8c0 (configuration c3)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 12:37:47`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-walk-r\c3; identity = f70e65cf8876a1f19345977456749b9b
- `2026-10-07 12:38:25`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:40:17`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:40:25`  **shutdown** — C:\data, 62 db files — CLEAN
