"""Econ adapters. Provider modules are imported LAZILY on first lookup.

``get_adapter(name)`` / ``available()`` import every known provider module that
exists; a module that is simply absent is skipped silently (built incrementally),
while a module that exists but fails to import is recorded in
``import_errors()`` (redacted) instead of taking the service down.
"""
from __future__ import annotations

import importlib
import logging

from .. import secrets
from .base import (ADAPTERS, Adapter, BaseAdapter, SeriesSpec, as_specs,  # noqa: F401
                   register, unregister, _INSTANCES)

log = logging.getLogger(__name__)

KNOWN_ADAPTER_MODULES = ("bls", "bea", "census", "fed_ddp", "nyfed", "nyfed_esms",
                         "fiscaldata", "eia", "dol", "fhfa")

_loaded = False
_import_errors: dict[str, str] = {}


def load_all(force: bool = False) -> None:
    global _loaded
    if _loaded and not force:
        return
    for mod in KNOWN_ADAPTER_MODULES:
        full = f"{__name__}.{mod}"
        try:
            importlib.import_module(full)
            _import_errors.pop(mod, None)
        except ModuleNotFoundError as e:
            if e.name == full:
                continue                    # not written yet -- fine
            _import_errors[mod] = secrets.safe_exc(e)
            log.warning("econ adapter %s failed to import: %s", mod, _import_errors[mod])
        except Exception as e:  # noqa: BLE001
            _import_errors[mod] = secrets.safe_exc(e)
            log.warning("econ adapter %s failed to import: %s", mod, _import_errors[mod])
    _loaded = True


def import_errors() -> dict[str, str]:
    return dict(_import_errors)


def get_adapter(name: str):
    """A (cached) adapter instance by name; KeyError if unknown."""
    if name not in ADAPTERS:
        load_all()
    if name not in ADAPTERS:
        raise KeyError(f"unknown econ adapter {name!r}")
    inst = _INSTANCES.get(name)
    if inst is None:
        inst = ADAPTERS[name]()
        _INSTANCES[name] = inst
    return inst


def available() -> list[str]:
    load_all()
    return sorted(ADAPTERS)
