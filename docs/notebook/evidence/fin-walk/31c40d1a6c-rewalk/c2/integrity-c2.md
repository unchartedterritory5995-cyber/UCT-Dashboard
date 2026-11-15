tip under test: b846ca27ef (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-11-13 20:16:13`  **pre-boot (baseline)** — C:\data, 63 db files — CLEAN
    - sandbox = <temp>\fe-rw-root\c2; identity = e6219b6a86601a04b98e46c6fad54fb2
- `2026-11-13 20:16:46`  **post-boot (+15s)** — C:\data, 63 db files — CLEAN
- `2026-11-13 20:18:36`  **post-prewarm (+120s)** — C:\data, 63 db files — CLEAN
- `2026-11-13 20:27:46`  **shutdown** — C:\data, 63 db files — CLEAN
