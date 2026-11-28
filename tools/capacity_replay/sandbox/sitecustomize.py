"""Replay sandbox, applied in EVERY interpreter started with this directory on PYTHONPATH and REPLAY_SANDBOX=1
(so uvicorn's spawned worker processes get it too). Read-only immutable store, loopback-only sockets, no vendor."""
import os
if os.environ.get("REPLAY_SANDBOX") == "1":
    import socket, sqlite3
    _STORE = os.environ.get("REPLAY_STORE", "C:/data/bars.db")
    _PLACE = os.path.normcase(os.path.abspath(os.path.join(os.environ["DATA_DIR"], "bars.db")))
    _RO = "file:%s?mode=ro&immutable=1" % _STORE.replace("\\", "/")

    def _loopback(addr):
        try:
            host = addr[0] if isinstance(addr, tuple) else addr
            return host in ("127.0.0.1", "::1", "localhost") or str(host).startswith("127.")
        except Exception:
            return False
    _rc, _rcx = socket.socket.connect, socket.socket.connect_ex

    def _guard_connect(self, addr):
        if self.family in (socket.AF_INET, socket.AF_INET6) and not _loopback(addr):
            raise ConnectionRefusedError("replay sandbox: outbound %r refused" % (addr,))
        return _rc(self, addr)

    def _guard_connect_ex(self, addr):
        if self.family in (socket.AF_INET, socket.AF_INET6) and not _loopback(addr):
            return 111
        return _rcx(self, addr)
    socket.socket.connect, socket.socket.connect_ex = _guard_connect, _guard_connect_ex
    _gai = socket.getaddrinfo

    def _getaddrinfo(host, *a, **k):
        if host not in (None, "127.0.0.1", "::1", "localhost", "0.0.0.0") and not str(host).startswith("127."):
            raise socket.gaierror("replay sandbox: DNS for %r refused" % (host,))
        return _gai(host, *a, **k)
    socket.getaddrinfo = _getaddrinfo
    _sc = sqlite3.connect

    def _sq(database, *a, **k):
        d = str(database)
        path = d[5:].split("?", 1)[0] if d.startswith("file:") else d
        if path and path != ":memory:" and os.path.normcase(os.path.abspath(path)) == _PLACE:
            k["uri"] = True
            return _sc(_RO, *a, **k)
        return _sc(database, *a, **k)
    sqlite3.connect = _sq

    import importlib.abc, importlib.machinery, sys

    class _PatchAfterImport(importlib.abc.MetaPathFinder):
        """Pin bars_fetch's freshness rule and the yfinance pool the moment they are imported."""
        def find_spec(self, name, path, target=None):
            if name not in ("api.services.bars_fetch", "api.services.yfinance_pool"):
                return None
            sys.meta_path.remove(self)
            try:
                spec = importlib.machinery.PathFinder.find_spec(name, path)
            finally:
                sys.meta_path.insert(0, self)
            if spec is None:
                return None
            orig = spec.loader.exec_module

            def exec_module(mod, orig=orig, name=name):
                orig(mod)
                if name.endswith("bars_fetch"):
                    mod._needs_fresh = lambda last_ts, tf, ticker=None: last_ts is None
                else:
                    def _no_vendor(*a, **k):
                        raise TimeoutError("replay sandbox: no vendor")
                    mod.fetch_history = _no_vendor
                    mod.run_in_pool = _no_vendor
            spec.loader.exec_module = exec_module
            return spec
    sys.meta_path.insert(0, _PatchAfterImport())
