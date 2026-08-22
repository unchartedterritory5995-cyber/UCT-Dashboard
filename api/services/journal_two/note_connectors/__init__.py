"""Note Connectors — account-connected background sync of external note
libraries (Roam, Craft, Notion, Dropbox) into the Notebook.

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md
Plan: docs/superpowers/plans/2026-08-11-note-connectors.md

This package must be import-inert: importing it (or any submodule) with no
env vars set must never raise. Provider/config checks happen on USE
(`NoteConnNotConfigured` is raised from a call, never from import).
"""

from __future__ import annotations
