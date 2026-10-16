tip under test: b754972379 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 22:27:30`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-midtext-20261016T032711Z\c2; identity = 8d9ac96f9ca514baecc56fa6a54efcde
- `2026-10-15 22:28:09`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 22:30:03`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 22:40:21`  **shutdown** — C:\data, 62 db files — CLEAN
