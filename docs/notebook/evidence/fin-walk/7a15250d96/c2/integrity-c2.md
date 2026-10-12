tip under test: 7a15250d96 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-12 17:08:11`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\nb-p2a-walk-2\c2; identity = 2bc1a2a8f53b4fe0bf9125c7636de07d
- `2026-10-12 17:08:44`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-12 17:10:38`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-12 17:35:31`  **shutdown** — C:\data, 62 db files — CLEAN
