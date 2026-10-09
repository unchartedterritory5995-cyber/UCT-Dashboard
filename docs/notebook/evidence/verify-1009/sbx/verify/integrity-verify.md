tip under test: 1a9a460ab3 (configuration verify)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-09 16:24:49`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-verify-sbx\verify; identity = b537f79055a672bfa1c02c6c402ccb56
- `2026-10-09 16:25:20`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-09 16:27:11`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-09 16:35:23`  **shutdown** — C:\data, 62 db files — CLEAN
