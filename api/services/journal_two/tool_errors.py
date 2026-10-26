"""Notebook widgets wave 9 (ruling W9-R10): the one refusal base for the routine and tracker stores.

A `ToolError` is a refusal whose message is a member sentence (`.sentence`), with an HTTP status
and an error code, so the router (Task 9.6) can answer either store's refusals through one
`except ToolError` as `{"detail": {"code": e.code, "message": e.sentence}}` with `e.status`.
`routines.RoutineError` and `trackers.TrackerError` subclass it; their own subclasses
(NotFound, Conflict, OutsideWindow, ReadOnly) are unchanged.
"""
from __future__ import annotations


class ToolError(ValueError):
    status = 400
    code = "invalid"

    def __init__(self, sentence: str):
        super().__init__(sentence)
        self.sentence = sentence
