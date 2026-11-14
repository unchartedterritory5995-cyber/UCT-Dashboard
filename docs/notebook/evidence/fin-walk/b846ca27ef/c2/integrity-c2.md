tip under test: b846ca27ef (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-11-13 19:25:00`  **pre-boot (baseline)** — C:\data, 63 db files — CLEAN
    - sandbox = <temp>\fe-full-root\c2; identity = 2ecfc421d05f9a7dc6786b52d84824b2
- `2026-11-13 19:25:33`  **post-boot (+15s)** — C:\data, 63 db files — CLEAN
- `2026-11-13 19:27:24`  **post-prewarm (+120s)** — C:\data, 63 db files — CLEAN
