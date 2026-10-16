tip under test: 5895abfa273214387a98d405f357ce52fc32956f (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 21:08:44`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-midtext-20261016T020721Z\c2; identity = afabb48311aed20ea6239c8a38a28a9f
- `2026-10-15 21:10:22`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 21:12:15`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 21:17:39`  **shutdown** — C:\data, 62 db files — CLEAN
