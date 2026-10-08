# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 15:46:18`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\folder-walk10; identity = 255cd068d91ed22e828d929b921521ba
- `2026-10-07 15:46:58`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:48:50`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:48:50`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
