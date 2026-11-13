"""Wire protocol between the `stream-ingest` service and the web pod (PR3).

Design: INGEST-PROCESS-DESIGN (2026-11-13), owner-approved, "DECIDED 11-13":
break-before-make only, never two Massive sockets. Nothing in this module opens a
socket, and nothing here decides WHEN a socket opens: it is the pure data layer
both sides will share once PR4 (ingest service) and PR5 (web feed client +
RemoteBroadcaster) land. **No runtime path imports this module yet**, and the rail
`tests/test_feed_protocol.py::test_no_runtime_module_imports_feed_protocol` keeps
it that way until PR5 wires it on purpose.

PURE BY CONSTRUCTION
--------------------
No wall clock, no randomness, no threads, no asyncio, no IO. Every function that
needs "now" takes it as an explicit argument (`now` in seconds for leases,
`now_ms` for revisions), so every behaviour here is reproducible from its inputs.
The determinism rail parses this file's AST and fails on an import of `time`,
`datetime`, `random`, `asyncio`, `threading`, `socket` or `os`.

WHAT CROSSES THE WIRE
---------------------
Every message is one orjson object with `v` (protocol version) and `k` (kind).

web -> ingest (control plane, level-triggered):
  hello   {v, k:"hello", client_id, gen}
  desired {v, k:"desired", gen, owners:{owner:{sym:[ch]}}, keys:[[sym,key]],
           nhnl_seeds:{sym:seed}, tas_syms:[sym]}         (full replace)
  patch   {v, k:"patch", gen, seq, owners:{owner:{sym:[ch]}}, keys_add, keys_remove,
           tas_add, tas_remove, nhnl_seeds:{sym:seed|null}}  (delta on top of desired)

ingest -> web (data plane):
  batch   {v, k:"batch", epoch, seq, bars:[[sym,key,bar,final]],
           prices:{sym:{price,ts,trade_ts,volume}}, agg:{sym:[av,c,s]},
           nhnl:{..}, nhnl_rt:{..}, tas:{sym:[print|gap]}, status:{..}|null}

`ch` is one of the bar_stream channels "AM" / "A" / "T" (PR #1186's per-(sym,
channel) owner model); `key` is a BarBroadcaster key ("1","5","15","30","60","60e").

Decode is strict: unknown version, unknown kind, unknown field, wrong type,
non-finite number or oversize input raises a `ProtocolError` subclass. It never
raises anything else.

The inner shapes of `nhnl_seeds`, `nhnl`, `nhnl_rt` and `status` are owned by the
NH/NL and status producers (PR4/PR5). Here they are validated as JSON objects of
bounded size with string keys and JSON-safe, finite values, and are passed through
untouched. Changing their shape is a protocol change: bump `PROTOCOL_VERSION`.

THE PIECES
----------
1. `encode` / `decode` + the message dataclasses.
2. `CoalescingBuffer` (ingest side, one per client connection): keyed latest-wins
   bars on (sym, key, t) with final-wins, latest-wins prices/agg, append-only
   bounded T&S with explicit gap markers, bounded memory, `drain()` -> one batch.
3. `DesiredUnion` (ingest side): multi-client union of desired sets with per-
   channel subscribe/unsubscribe deltas and the client lease.
4. `SeqTracker` (web side): epoch/seq bookkeeping returning explicit actions.
5. `LegacyFilter` + `RevClock` + `relay_bars` (web side): the v2/legacy older-t
   filter and the HLC `rev` stamp, byte-compatible with BarBroadcaster._dispatch.
"""
from __future__ import annotations

import enum
import math
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Optional, Union

import orjson

PROTOCOL_VERSION = 1
SUPPORTED_VERSIONS = frozenset({PROTOCOL_VERSION})

#: bar_stream channels, in bar_stream's wire order (PR #1186 `_CHANNEL_ORDER`).
CHANNELS: tuple[str, ...] = ("AM", "A", "T")
_CHANNEL_SET = frozenset(CHANNELS)

#: BarBroadcaster keys -> (tf, session). Must equal bar_broadcaster._KEY_SPEC; a
#: test pins the two together. Duplicated (not imported) so this module stays pure
#: and bar_broadcaster's heavy imports never ride along.
KEY_SPEC: dict[str, tuple[str, str]] = {
    "1": ("1", "rth"), "5": ("5", "rth"), "15": ("15", "rth"), "30": ("30", "rth"),
    "60": ("60", "rth"), "60e": ("60", "eth"),
}
BAR_KEYS = frozenset(KEY_SPEC)

#: Hard input bound for `decode` (bytes). A full snapshot batch for ~3k symbols
#: is well under 2MB; 16MB is a corruption guard, not a tuning knob.
MAX_MESSAGE_BYTES = 16 * 1024 * 1024
MAX_SYM_LEN = 24
MAX_ID_LEN = 128
#: Bound on an opaque JSON object (nhnl/status/seed): nesting depth and node count.
MAX_OPAQUE_DEPTH = 6
MAX_OPAQUE_NODES = 200_000

_BAR_FIELDS = frozenset({"t", "o", "h", "l", "c", "v", "final", "trade_ts"})
_PRICE_FIELDS = frozenset({"price", "ts", "trade_ts", "volume"})


# ── Errors ──────────────────────────────────────────────────────────────────────

class ProtocolError(ValueError):
    """Base of every error this module raises on bad input. `code` is stable."""
    code = "protocol_error"

    def __init__(self, detail: str):
        super().__init__(f"{self.code}: {detail}")
        self.detail = detail


class MalformedMessage(ProtocolError):
    code = "malformed"


class UnknownVersion(ProtocolError):
    code = "unknown_version"


class UnknownKind(ProtocolError):
    code = "unknown_kind"


class MessageTooLarge(ProtocolError):
    code = "too_large"


class StaleGeneration(ProtocolError):
    """A desired/patch from an older generation than the client's current one."""
    code = "stale_generation"


class PatchOutOfOrder(ProtocolError):
    """A patch whose seq is not the next one for its generation. The client must
    resend a full `desired` (level-triggered recovery)."""
    code = "patch_out_of_order"


class UnknownClient(ProtocolError):
    code = "unknown_client"


# ── Message types ───────────────────────────────────────────────────────────────

Owners = dict  # owner -> {sym -> frozenset[channel]}


@dataclass(frozen=True)
class Hello:
    client_id: str
    gen: int


@dataclass(frozen=True)
class Desired:
    gen: int
    owners: dict = field(default_factory=dict)          # {owner: {sym: frozenset[ch]}}
    keys: frozenset = frozenset()                       # {(sym, key)}
    nhnl_seeds: dict = field(default_factory=dict)      # {sym: opaque JSON}
    tas_syms: frozenset = frozenset()                   # {sym}


@dataclass(frozen=True)
class Patch:
    """Delta on a client's current desired set.

    `owners` replaces the channel set of each named (owner, sym); an EMPTY set
    removes that (owner, sym). `nhnl_seeds` upserts, a None value removes."""
    gen: int
    seq: int
    owners: dict = field(default_factory=dict)
    keys_add: frozenset = frozenset()
    keys_remove: frozenset = frozenset()
    tas_add: frozenset = frozenset()
    tas_remove: frozenset = frozenset()
    nhnl_seeds: dict = field(default_factory=dict)


@dataclass(frozen=True)
class BarUpdate:
    sym: str
    key: str
    bar: dict      # {t, o, h, l, c, v, trade_ts?}  ("final" lives in `final`)
    final: bool


@dataclass(frozen=True)
class TasGap:
    """Explicit T&S gap marker: `dropped` prints with trade times in [first_t,
    last_t] were evicted by the per-symbol bound before they could be sent."""
    dropped: int
    first_t: int
    last_t: int


# A T&S print on the wire: [t_ms, price, size, conditions|null].
TasPrint = tuple  # (int, number, number, Optional[tuple[int, ...]])


@dataclass(frozen=True)
class Batch:
    epoch: int
    seq: int
    bars: tuple = ()               # tuple[BarUpdate, ...]
    prices: dict = field(default_factory=dict)   # {sym: {price, ts, trade_ts, volume}}
    agg: dict = field(default_factory=dict)      # {sym: (av, c, s)}
    nhnl: dict = field(default_factory=dict)
    nhnl_rt: dict = field(default_factory=dict)
    tas: dict = field(default_factory=dict)      # {sym: tuple[TasPrint | TasGap, ...]}
    status: Optional[dict] = None

    def is_empty(self) -> bool:
        return not (self.bars or self.prices or self.agg or self.nhnl or self.nhnl_rt
                    or self.tas or self.status is not None)


Message = Union[Hello, Desired, Patch, Batch]


# ── Validators (raise MalformedMessage) ─────────────────────────────────────────

def _bad(detail: str):
    raise MalformedMessage(detail)


def _is_int(x) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


def _is_num(x) -> bool:
    if isinstance(x, bool):
        return False
    if isinstance(x, int):
        return True
    return isinstance(x, float) and math.isfinite(x)


def _int(x, what: str, lo: int = 0) -> int:
    if not _is_int(x) or x < lo:
        _bad(f"{what} must be an int >= {lo}")
    return x


def _num(x, what: str, nonneg: bool = False):
    if not _is_num(x) or (nonneg and x < 0):
        _bad(f"{what} must be a finite number" + (" >= 0" if nonneg else ""))
    return x


def _opt_int(x, what: str):
    return None if x is None else _int(x, what)


def _opt_num(x, what: str, nonneg: bool = False):
    return None if x is None else _num(x, what, nonneg)


def _str_id(x, what: str, maxlen: int = MAX_ID_LEN) -> str:
    if not isinstance(x, str) or not x or len(x) > maxlen or x != x.strip():
        _bad(f"{what} must be a non-empty string <= {maxlen} chars without edge whitespace")
    return x


def _sym(x, what: str = "sym") -> str:
    s = _str_id(x, what, MAX_SYM_LEN)
    if any(ch.isspace() for ch in s) or s != s.upper():
        _bad(f"{what} must be an upper-case symbol without whitespace")
    return s


def _bar_key(x) -> str:
    if x not in BAR_KEYS:
        _bad(f"bar key must be one of {sorted(BAR_KEYS)}")
    return x


def _dict(x, what: str) -> dict:
    if not isinstance(x, dict):
        _bad(f"{what} must be an object")
    return x


def _list(x, what: str) -> list:
    if not isinstance(x, (list, tuple)):
        _bad(f"{what} must be an array")
    return x


def _exact_fields(obj: dict, required: Iterable[str], optional: Iterable[str], what: str):
    req = set(required)
    allowed = req | set(optional)
    missing = req - obj.keys()
    if missing:
        _bad(f"{what} missing field(s) {sorted(missing)}")
    extra = obj.keys() - allowed
    if extra:
        _bad(f"{what} has unknown field(s) {sorted(map(str, extra))}")


def _channels(x, what: str, allow_empty: bool) -> frozenset:
    chans = _list(x, what)
    out = frozenset(chans)
    if len(out) != len(chans):
        _bad(f"{what} has duplicate channels")
    if not out <= _CHANNEL_SET:
        _bad(f"{what} channels must be a subset of {list(CHANNELS)}")
    if not out and not allow_empty:
        _bad(f"{what} must name at least one channel")
    return out


def _owners(x, what: str, allow_empty_channels: bool) -> dict:
    out = {}
    for owner, syms in _dict(x, what).items():
        _str_id(owner, f"{what} owner")
        inner = {}
        for sym, chans in _dict(syms, f"{what}[{owner}]").items():
            inner[_sym(sym)] = _channels(chans, f"{what}[{owner}][{sym}]", allow_empty_channels)
        out[owner] = inner
    return out


def _key_pairs(x, what: str) -> frozenset:
    out = set()
    for pair in _list(x, what):
        p = _list(pair, f"{what} entry")
        if len(p) != 2:
            _bad(f"{what} entries must be [sym, key]")
        out.add((_sym(p[0]), _bar_key(p[1])))
    return frozenset(out)


def _sym_set(x, what: str) -> frozenset:
    return frozenset(_sym(s, what) for s in _list(x, what))


def _opaque(x, what: str) -> Any:
    """A JSON value of bounded depth/size: str keys, finite numbers only."""
    budget = [MAX_OPAQUE_NODES]

    def walk(v, depth):
        budget[0] -= 1
        if budget[0] < 0:
            _bad(f"{what} is too large")
        if depth > MAX_OPAQUE_DEPTH:
            _bad(f"{what} is nested too deeply")
        if v is None or isinstance(v, (bool, str)):
            return
        if isinstance(v, (int, float)):
            if not _is_num(v):
                _bad(f"{what} contains a non-finite number")
            return
        if isinstance(v, (list, tuple)):
            for i in v:
                walk(i, depth + 1)
            return
        if isinstance(v, dict):
            for k, i in v.items():
                if not isinstance(k, str):
                    _bad(f"{what} keys must be strings")
                walk(i, depth + 1)
            return
        _bad(f"{what} contains a non-JSON value")

    walk(x, 0)
    return x


def _opaque_obj(x, what: str) -> dict:
    _dict(x, what)
    _opaque(x, what)
    return x


def _bar(x, final: bool, what: str = "bar") -> dict:
    b = _dict(x, what)
    _exact_fields(b, ("t", "o", "h", "l", "c", "v"), ("final", "trade_ts"), what)
    _int(b["t"], f"{what}.t")
    for f in ("o", "h", "l", "c"):
        _num(b[f], f"{what}.{f}")
    _num(b["v"], f"{what}.v", nonneg=True)
    if b.get("trade_ts") is not None:
        _int(b["trade_ts"], f"{what}.trade_ts")
    if "final" in b and b["final"] is not final:
        _bad(f"{what}.final disagrees with the entry's final flag")
    out = {k: b[k] for k in ("t", "o", "h", "l", "c", "v")}
    if b.get("trade_ts") is not None:
        out["trade_ts"] = b["trade_ts"]
    return out


def _price(x, what: str) -> dict:
    p = _dict(x, what)
    _exact_fields(p, ("price", "ts"), ("trade_ts", "volume"), what)
    return {
        "price": _num(p["price"], f"{what}.price"),
        "ts": _int(p["ts"], f"{what}.ts"),
        "trade_ts": _opt_int(p.get("trade_ts"), f"{what}.trade_ts"),
        "volume": _opt_num(p.get("volume"), f"{what}.volume", nonneg=True),
    }


def _agg(x, what: str) -> tuple:
    a = _list(x, what)
    if len(a) != 3:
        _bad(f"{what} must be [av, c, s]")
    return (_opt_num(a[0], f"{what}.av", nonneg=True),
            _opt_num(a[1], f"{what}.c"),
            _opt_num(a[2], f"{what}.s", nonneg=True))


def _tas_item(x, what: str):
    if isinstance(x, dict):
        _exact_fields(x, ("gap", "from", "to"), (), what)
        d = _int(x["gap"], f"{what}.gap", lo=1)
        a = _int(x["from"], f"{what}.from")
        b = _int(x["to"], f"{what}.to")
        if b < a:
            _bad(f"{what} gap range is inverted")
        return TasGap(d, a, b)
    p = _list(x, what)
    if len(p) != 4:
        _bad(f"{what} print must be [t, p, s, c]")
    conds = p[3]
    if conds is not None:
        conds = tuple(_int(c, f"{what}.c[]") for c in _list(conds, f"{what}.c"))
    return (_int(p[0], f"{what}.t"), _num(p[1], f"{what}.p"),
            _num(p[2], f"{what}.s", nonneg=True), conds)


# ── Parse (wire dict -> dataclass) ──────────────────────────────────────────────

def _parse_hello(m: dict) -> Hello:
    _exact_fields(m, ("v", "k", "client_id", "gen"), (), "hello")
    return Hello(_str_id(m["client_id"], "client_id"), _int(m["gen"], "gen"))


def _parse_desired(m: dict) -> Desired:
    _exact_fields(m, ("v", "k", "gen", "owners", "keys", "nhnl_seeds", "tas_syms"), (), "desired")
    seeds = _opaque_obj(m["nhnl_seeds"], "nhnl_seeds")
    for s in seeds:
        _sym(s, "nhnl_seeds sym")
    return Desired(
        gen=_int(m["gen"], "gen"),
        owners=_owners(m["owners"], "owners", allow_empty_channels=False),
        keys=_key_pairs(m["keys"], "keys"),
        nhnl_seeds=dict(seeds),
        tas_syms=_sym_set(m["tas_syms"], "tas_syms"),
    )


def _parse_patch(m: dict) -> Patch:
    _exact_fields(m, ("v", "k", "gen", "seq"),
                  ("owners", "keys_add", "keys_remove", "tas_add", "tas_remove", "nhnl_seeds"),
                  "patch")
    seeds = _opaque_obj(m.get("nhnl_seeds", {}), "nhnl_seeds")
    for s in seeds:
        _sym(s, "nhnl_seeds sym")
    p = Patch(
        gen=_int(m["gen"], "gen"),
        seq=_int(m["seq"], "seq", lo=1),
        owners=_owners(m.get("owners", {}), "owners", allow_empty_channels=True),
        keys_add=_key_pairs(m.get("keys_add", []), "keys_add"),
        keys_remove=_key_pairs(m.get("keys_remove", []), "keys_remove"),
        tas_add=_sym_set(m.get("tas_add", []), "tas_add"),
        tas_remove=_sym_set(m.get("tas_remove", []), "tas_remove"),
        nhnl_seeds=dict(seeds),
    )
    if p.keys_add & p.keys_remove:
        _bad("patch adds and removes the same key")
    if p.tas_add & p.tas_remove:
        _bad("patch adds and removes the same T&S symbol")
    return p


def _parse_batch(m: dict) -> Batch:
    _exact_fields(m, ("v", "k", "epoch", "seq"),
                  ("bars", "prices", "agg", "nhnl", "nhnl_rt", "tas", "status"), "batch")
    bars = []
    seen = set()
    for i, e in enumerate(_list(m.get("bars", []), "bars")):
        e = _list(e, f"bars[{i}]")
        if len(e) != 4:
            _bad(f"bars[{i}] must be [sym, key, bar, final]")
        sym, key = _sym(e[0]), _bar_key(e[1])
        if not isinstance(e[3], bool):
            _bad(f"bars[{i}].final must be a bool")
        bar = _bar(e[2], e[3], f"bars[{i}].bar")
        ident = (sym, key, bar["t"])
        if ident in seen:
            _bad(f"bars has a duplicate (sym, key, t) entry at {i}")
        seen.add(ident)
        bars.append(BarUpdate(sym, key, bar, e[3]))
    prices = {_sym(s): _price(p, f"prices[{s}]") for s, p in _dict(m.get("prices", {}), "prices").items()}
    agg = {_sym(s): _agg(a, f"agg[{s}]") for s, a in _dict(m.get("agg", {}), "agg").items()}
    tas = {}
    for s, items in _dict(m.get("tas", {}), "tas").items():
        tas[_sym(s)] = tuple(_tas_item(x, f"tas[{s}]") for x in _list(items, f"tas[{s}]"))
    status = m.get("status")
    if status is not None:
        status = _opaque_obj(status, "status")
    return Batch(
        epoch=_int(m["epoch"], "epoch"),
        seq=_int(m["seq"], "seq", lo=1),
        bars=tuple(bars),
        prices=prices,
        agg=agg,
        nhnl=_opaque_obj(m.get("nhnl", {}), "nhnl"),
        nhnl_rt=_opaque_obj(m.get("nhnl_rt", {}), "nhnl_rt"),
        tas=tas,
        status=status,
    )


_PARSERS = {"hello": _parse_hello, "desired": _parse_desired,
            "patch": _parse_patch, "batch": _parse_batch}
KINDS = frozenset(_PARSERS)


def parse(obj: Any) -> Message:
    """Validate an already-JSON-decoded object into a message. Raises only
    ProtocolError subclasses."""
    if not isinstance(obj, dict):
        raise MalformedMessage("message must be a JSON object")
    v = obj.get("v")
    if not _is_int(v):
        raise MalformedMessage("missing or non-integer protocol version `v`")
    if v not in SUPPORTED_VERSIONS:
        raise UnknownVersion(f"version {v} not in {sorted(SUPPORTED_VERSIONS)}")
    k = obj.get("k")
    parser = _PARSERS.get(k) if isinstance(k, str) else None
    if parser is None:
        raise UnknownKind(f"kind {k!r} not in {sorted(KINDS)}")
    try:
        return parser(obj)
    except ProtocolError:
        raise
    except Exception as e:  # defensive: decode must never crash on hostile input
        raise MalformedMessage(f"{type(e).__name__}") from None


def decode(data: Union[bytes, bytearray, memoryview, str], *,
           max_bytes: int = MAX_MESSAGE_BYTES) -> Message:
    """bytes/str -> message. Raises only ProtocolError subclasses."""
    if isinstance(data, str):
        data = data.encode("utf-8", "surrogatepass")
    elif not isinstance(data, (bytes, bytearray, memoryview)):
        raise MalformedMessage("input must be bytes or str")
    if len(data) > max_bytes:
        raise MessageTooLarge(f"{len(data)} bytes > {max_bytes}")
    try:
        obj = orjson.loads(data)
    except orjson.JSONDecodeError:
        raise MalformedMessage("invalid JSON") from None
    except Exception as e:
        raise MalformedMessage(f"undecodable input ({type(e).__name__})") from None
    return parse(obj)


# ── Encode (dataclass -> wire dict -> bytes) ────────────────────────────────────

def _owners_wire(owners: dict) -> dict:
    return {o: {s: [c for c in CHANNELS if c in chans] for s, chans in sorted(syms.items())}
            for o, syms in sorted(owners.items())}


def _keys_wire(keys) -> list:
    return [[s, k] for s, k in sorted(keys)]


def _tas_wire(item) -> Any:
    if isinstance(item, TasGap):
        return {"gap": item.dropped, "from": item.first_t, "to": item.last_t}
    t, p, s, c = item
    return [t, p, s, None if c is None else list(c)]


def to_wire(msg: Message) -> dict:
    """Message -> plain JSON-ready dict (canonical ordering)."""
    if isinstance(msg, Hello):
        return {"v": PROTOCOL_VERSION, "k": "hello", "client_id": msg.client_id, "gen": msg.gen}
    if isinstance(msg, Desired):
        return {"v": PROTOCOL_VERSION, "k": "desired", "gen": msg.gen,
                "owners": _owners_wire(msg.owners), "keys": _keys_wire(msg.keys),
                "nhnl_seeds": dict(sorted(msg.nhnl_seeds.items())),
                "tas_syms": sorted(msg.tas_syms)}
    if isinstance(msg, Patch):
        return {"v": PROTOCOL_VERSION, "k": "patch", "gen": msg.gen, "seq": msg.seq,
                "owners": _owners_wire(msg.owners),
                "keys_add": _keys_wire(msg.keys_add), "keys_remove": _keys_wire(msg.keys_remove),
                "tas_add": sorted(msg.tas_add), "tas_remove": sorted(msg.tas_remove),
                "nhnl_seeds": dict(sorted(msg.nhnl_seeds.items()))}
    if isinstance(msg, Batch):
        out = {"v": PROTOCOL_VERSION, "k": "batch", "epoch": msg.epoch, "seq": msg.seq,
               "bars": [[b.sym, b.key, {**b.bar, "final": b.final}, b.final] for b in msg.bars],
               "prices": msg.prices, "agg": {s: list(a) for s, a in msg.agg.items()},
               "nhnl": msg.nhnl, "nhnl_rt": msg.nhnl_rt,
               "tas": {s: [_tas_wire(i) for i in items] for s, items in msg.tas.items()},
               "status": msg.status}
        return out
    raise MalformedMessage(f"cannot encode {type(msg).__name__}")


def encode(msg: Message, *, validate: bool = True) -> bytes:
    """Message -> bytes. With `validate` (default) the wire dict is run through the
    same strict parser `decode` uses, so a message that cannot be decoded can
    never be sent (e.g. a NaN price raises MalformedMessage here, not on the
    receiver)."""
    obj = to_wire(msg)
    if validate:
        parse(obj)
    try:
        return orjson.dumps(obj)
    except (TypeError, orjson.JSONEncodeError) as e:
        raise MalformedMessage(f"unencodable message ({type(e).__name__})") from None


# ── 2. Coalescing buffer (ingest side, one per client connection) ───────────────

class Offer(enum.Enum):
    ACCEPTED = "accepted"
    SUPERSEDED = "superseded"   # stale input ignored (non-final after a final for that t)
    REJECTED = "rejected"       # outside a configured cap (e.g. a T&S symbol over the cap)
    STALLED = "stalled"         # buffer overflowed; the server must disconnect the client


@dataclass(frozen=True)
class BufferLimits:
    max_pending_bars: int = 8192        # distinct (sym, key, t) awaiting drain
    max_price_syms: int = 8192
    max_agg_syms: int = 8192
    max_tas_syms: int = 20              # design: T&S for <= 20 symbols
    max_tas_per_sym: int = 512          # per-symbol T&S prints between drains
    max_nhnl_keys: int = 8192           # top-level keys of nhnl / nhnl_rt each
    max_final_guards: int = 16384       # (sym, key) final watermarks remembered (LRU)


class CoalescingBuffer:
    """Per-client outbound buffer on the ingest side.

    Bars: latest-wins on (sym, key, t), so a `final` or a correction for an older
    t is never overwritten by a newer t (they are different keys). FINAL WINS:
    once a final is offered for (sym, key, t), any later non-final for a t <= the
    newest finalized t of that (sym, key) is stale (BarBroadcaster finality is
    monotonic in t: a bucket is final once trade time passed its end, which
    finalizes every older bucket too) and is ignored as SUPERSEDED, whether the
    final is still pending or was already drained. A later FINAL for the same t
    (a late-AM correction) replaces the earlier final.

    Prices / agg: latest-wins on sym. nhnl / nhnl_rt: latest-wins per top-level
    key (per-epoch cumulative counters, so replays are safe). status: latest-wins
    whole. T&S: append-only, bounded per sym; overflow evicts the oldest prints
    and the drained list starts with an explicit TasGap.

    Memory is bounded by `BufferLimits`. Overflowing any pending bound (other
    than per-sym T&S, which degrades with a gap marker) puts the buffer in the
    STALLED state: pending data is released, every offer returns STALLED and
    `drain()` returns None. That is the design's "a stalled client gets
    disconnected and receives a full snapshot on reconnect": loss is never
    silent, it always forces a resync."""

    def __init__(self, epoch: int, limits: BufferLimits = BufferLimits()):
        if not _is_int(epoch) or epoch < 0:
            raise ValueError("epoch must be an int >= 0")
        self.epoch = epoch
        self.limits = limits
        self.seq = 0
        self.stalled = False
        self.stall_reason: Optional[str] = None
        self._bars: dict[tuple[str, str, int], BarUpdate] = {}
        self._final_hi: "OrderedDict[tuple[str, str], int]" = OrderedDict()
        self._prices: dict[str, dict] = {}
        self._agg: dict[str, tuple] = {}
        self._nhnl: dict[str, Any] = {}
        self._nhnl_rt: dict[str, Any] = {}
        self._status: Optional[dict] = None
        self._tas: dict[str, deque] = {}
        self._tas_gap: dict[str, list] = {}   # sym -> [dropped, first_t, last_t]
        self.counters = {"superseded": 0, "rejected": 0, "tas_dropped": 0,
                         "guards_evicted": 0, "batches": 0}

    # -- state --

    def _stall(self, reason: str) -> Offer:
        self.stalled = True
        self.stall_reason = reason
        self._bars.clear()
        self._prices.clear()
        self._agg.clear()
        self._nhnl.clear()
        self._nhnl_rt.clear()
        self._tas.clear()
        self._tas_gap.clear()
        self._status = None
        return Offer.STALLED

    def pending_size(self) -> int:
        """Number of retained items (bars + prices + agg + nhnl keys + T&S prints)."""
        return (len(self._bars) + len(self._prices) + len(self._agg) + len(self._nhnl)
                + len(self._nhnl_rt) + sum(len(d) for d in self._tas.values()))

    def max_size(self) -> int:
        lim = self.limits
        return (lim.max_pending_bars + lim.max_price_syms + lim.max_agg_syms
                + 2 * lim.max_nhnl_keys + lim.max_tas_syms * lim.max_tas_per_sym)

    def final_watermark(self, sym: str, key: str) -> Optional[int]:
        return self._final_hi.get((sym, key))

    # -- offers --

    def offer_bar(self, sym: str, key: str, bar: Mapping, final: bool) -> Offer:
        if self.stalled:
            return Offer.STALLED
        b = _bar(dict(bar), bool(final))   # strict: never buffer what cannot be sent
        final = bool(final)
        t = b["t"]
        gk = (sym, key)
        hi = self._final_hi.get(gk)
        if not final and hi is not None and t <= hi:
            self.counters["superseded"] += 1
            return Offer.SUPERSEDED
        ident = (sym, key, t)
        if ident not in self._bars and len(self._bars) >= self.limits.max_pending_bars:
            return self._stall("pending bars over limit")
        self._bars[ident] = BarUpdate(sym, key, b, final)
        if final:
            if hi is None or t > hi:
                self._final_hi[gk] = t
            self._final_hi.move_to_end(gk)
            while len(self._final_hi) > self.limits.max_final_guards:
                self._final_hi.popitem(last=False)
                self.counters["guards_evicted"] += 1
        return Offer.ACCEPTED

    def offer_price(self, sym: str, price, ts: int, trade_ts: Optional[int] = None,
                    volume=None) -> Offer:
        if self.stalled:
            return Offer.STALLED
        p = _price({"price": price, "ts": ts, "trade_ts": trade_ts, "volume": volume}, "price")
        if sym not in self._prices and len(self._prices) >= self.limits.max_price_syms:
            return self._stall("price symbols over limit")
        self._prices[sym] = p
        return Offer.ACCEPTED

    def offer_agg(self, sym: str, av, c=None, s=None) -> Offer:
        if self.stalled:
            return Offer.STALLED
        a = _agg([av, c, s], "agg")
        if sym not in self._agg and len(self._agg) >= self.limits.max_agg_syms:
            return self._stall("agg symbols over limit")
        self._agg[sym] = a
        return Offer.ACCEPTED

    def _merge_opaque(self, target: dict, update: Mapping, what: str) -> Offer:
        if self.stalled:
            return Offer.STALLED
        upd = _opaque_obj(dict(update), what)
        new = sum(1 for k in upd if k not in target)
        if len(target) + new > self.limits.max_nhnl_keys:
            return self._stall(f"{what} keys over limit")
        target.update(upd)
        return Offer.ACCEPTED

    def offer_nhnl(self, update: Mapping) -> Offer:
        return self._merge_opaque(self._nhnl, update, "nhnl")

    def offer_nhnl_rt(self, update: Mapping) -> Offer:
        return self._merge_opaque(self._nhnl_rt, update, "nhnl_rt")

    def set_status(self, status: Mapping) -> Offer:
        if self.stalled:
            return Offer.STALLED
        self._status = _opaque_obj(dict(status), "status")
        return Offer.ACCEPTED

    def offer_tas(self, sym: str, t: int, p, s, conds: Optional[Iterable[int]] = None) -> Offer:
        if self.stalled:
            return Offer.STALLED
        item = _tas_item([t, p, s, None if conds is None else list(conds)], "tas")
        d = self._tas.get(sym)
        if d is None:
            if len(self._tas) >= self.limits.max_tas_syms:
                self.counters["rejected"] += 1
                return Offer.REJECTED
            d = self._tas[sym] = deque()
        if len(d) >= self.limits.max_tas_per_sym:
            old = d.popleft()
            g = self._tas_gap.get(sym)
            if g is None:
                self._tas_gap[sym] = [1, old[0], old[0]]
            else:
                g[0] += 1
                g[1] = min(g[1], old[0])
                g[2] = max(g[2], old[0])
            self.counters["tas_dropped"] += 1
        d.append(item)
        return Offer.ACCEPTED

    def forget(self, sym: str) -> None:
        """Drop the final watermarks of a symbol no client wants any more."""
        for k in BAR_KEYS:
            self._final_hi.pop((sym, k), None)

    # -- drain --

    def drain(self, *, allow_empty: bool = False) -> Optional[Batch]:
        """Everything pending as ONE batch, seq advanced by one. Bars are ordered
        by (sym, key, t ascending): per key, a batch carries ascending t, the same
        ordering contract as BarBroadcaster._flush. Returns None when stalled, or
        when nothing is pending and not `allow_empty` (a heartbeat batch)."""
        if self.stalled:
            return None
        if not (self._bars or self._prices or self._agg or self._nhnl or self._nhnl_rt
                or self._tas or self._status is not None) and not allow_empty:
            return None
        bars = tuple(self._bars[k] for k in sorted(self._bars))
        tas = {}
        for sym, d in self._tas.items():
            g = self._tas_gap.get(sym)
            items = ([TasGap(g[0], g[1], g[2])] if g else []) + list(d)
            if items:
                tas[sym] = tuple(items)
        self.seq += 1
        batch = Batch(epoch=self.epoch, seq=self.seq, bars=bars, prices=self._prices,
                      agg=self._agg, nhnl=self._nhnl, nhnl_rt=self._nhnl_rt, tas=tas,
                      status=self._status)
        self._bars = {}
        self._prices = {}
        self._agg = {}
        self._nhnl = {}
        self._nhnl_rt = {}
        self._tas = {}
        self._tas_gap = {}
        self._status = None
        self.counters["batches"] += 1
        return batch


# ── 3. Desired-state union + lease (ingest side) ────────────────────────────────

@dataclass(frozen=True)
class ChannelDelta:
    """What the ingest must change upstream / in its own state after a control
    event. `subscribe` / `unsubscribe` are {sym: frozenset[channel]} in bar_stream
    terms; the others are plain set differences of the unioned sets."""
    subscribe: dict = field(default_factory=dict)
    unsubscribe: dict = field(default_factory=dict)
    keys_added: frozenset = frozenset()
    keys_removed: frozenset = frozenset()
    tas_added: frozenset = frozenset()
    tas_removed: frozenset = frozenset()
    released_clients: tuple = ()

    def is_empty(self) -> bool:
        return not (self.subscribe or self.unsubscribe or self.keys_added or self.keys_removed
                    or self.tas_added or self.tas_removed or self.released_clients)


@dataclass
class _ClientState:
    gen: int
    owners: dict = field(default_factory=dict)       # owner -> {sym -> frozenset}
    keys: set = field(default_factory=set)
    tas: set = field(default_factory=set)
    seeds: dict = field(default_factory=dict)
    patch_seq: int = 0
    connected: bool = True
    lease_until: Optional[float] = None
    has_desired: bool = False


DEFAULT_LEASE_S = 180.0   # INGEST_CLIENT_LEASE_S


class DesiredUnion:
    """Union of every client's desired set (web replicas are separate clients).

    Per channel, a symbol is wanted while ANY owner of ANY live-or-leased client
    wants that channel (invariant 10: owner refcount union per channel), so one
    owner or one client narrowing its set can never narrow what another still
    holds. A disconnected client's set is HELD until `now >= lease_until` and then
    released by `expire(now)`; a `hello` from the same client_id before then
    reclaims it (a web deploy keeps the feed warm). Time is always the explicit
    `now` argument (seconds, any monotonic origin)."""

    def __init__(self, lease_s: float = DEFAULT_LEASE_S):
        if not (isinstance(lease_s, (int, float)) and lease_s >= 0):
            raise ValueError("lease_s must be >= 0")
        self.lease_s = float(lease_s)
        self._clients: dict[str, _ClientState] = {}

    # -- views --

    def clients(self) -> dict:
        return {cid: {"gen": c.gen, "connected": c.connected, "lease_until": c.lease_until}
                for cid, c in self._clients.items()}

    def channels(self) -> dict:
        """{sym: frozenset[channel]} over every client and owner."""
        acc: dict[str, set] = {}
        for c in self._clients.values():
            for syms in c.owners.values():
                for sym, chans in syms.items():
                    if chans:
                        acc.setdefault(sym, set()).update(chans)
        return {s: frozenset(ch) for s, ch in acc.items()}

    def keys(self) -> frozenset:
        return frozenset().union(*(c.keys for c in self._clients.values())) if self._clients else frozenset()

    def tas_syms(self) -> frozenset:
        return frozenset().union(*(c.tas for c in self._clients.values())) if self._clients else frozenset()

    def nhnl_seeds(self) -> dict:
        """Merged seeds; on a conflict the lexically greatest client_id wins
        (deterministic; replicas send identical seeds in practice)."""
        out: dict = {}
        for cid in sorted(self._clients):
            out.update(self._clients[cid].seeds)
        return out

    # -- diffing --

    def _snapshot(self):
        return self.channels(), self.keys(), self.tas_syms()

    def _delta(self, before, released=()) -> ChannelDelta:
        ch0, k0, t0 = before
        ch1, k1, t1 = self._snapshot()
        sub, unsub = diff_channels(ch0, ch1)
        return ChannelDelta(subscribe=sub, unsubscribe=unsub,
                            keys_added=k1 - k0, keys_removed=k0 - k1,
                            tas_added=t1 - t0, tas_removed=t0 - t1,
                            released_clients=tuple(released))

    # -- control events --

    def hello(self, client_id: str, gen: int, now: float) -> ChannelDelta:
        """A client (re)connects. A known client keeps its held set until its new
        `desired` (gen must not go backwards); an unknown one starts empty."""
        _str_id(client_id, "client_id")
        _int(gen, "gen")
        c = self._clients.get(client_id)
        if c is None:
            self._clients[client_id] = _ClientState(gen=gen)
            return ChannelDelta()
        if gen < c.gen:
            raise StaleGeneration(f"hello gen {gen} < current {c.gen}")
        c.gen = gen
        c.connected = True
        c.lease_until = None
        c.patch_seq = 0
        return ChannelDelta()

    def set_desired(self, client_id: str, desired: Desired, now: float) -> ChannelDelta:
        """Full replace of one client's set (level-triggered)."""
        c = self._require(client_id)
        if desired.gen < c.gen:
            raise StaleGeneration(f"desired gen {desired.gen} < current {c.gen}")
        before = self._snapshot()
        c.gen = desired.gen
        c.owners = {o: {s: frozenset(ch) for s, ch in syms.items() if ch}
                    for o, syms in desired.owners.items()}
        c.owners = {o: syms for o, syms in c.owners.items() if syms}
        c.keys = set(desired.keys)
        c.tas = set(desired.tas_syms)
        c.seeds = dict(desired.nhnl_seeds)
        c.patch_seq = 0
        c.has_desired = True
        return self._delta(before)

    def apply_patch(self, client_id: str, patch: Patch, now: float) -> ChannelDelta:
        """Apply a delta. Its gen must equal the current gen and its seq must be
        the next one; otherwise PatchOutOfOrder / StaleGeneration and NOTHING is
        applied (the client resends a full `desired`)."""
        c = self._require(client_id)
        if patch.gen < c.gen:
            raise StaleGeneration(f"patch gen {patch.gen} < current {c.gen}")
        if patch.gen != c.gen or not c.has_desired:
            raise PatchOutOfOrder(f"patch for gen {patch.gen} before its desired")
        if patch.seq != c.patch_seq + 1:
            raise PatchOutOfOrder(f"patch seq {patch.seq}, expected {c.patch_seq + 1}")
        before = self._snapshot()
        for owner, syms in patch.owners.items():
            cur = c.owners.setdefault(owner, {})
            for sym, chans in syms.items():
                if chans:
                    cur[sym] = frozenset(chans)
                else:
                    cur.pop(sym, None)
            if not cur:
                c.owners.pop(owner, None)
        c.keys |= set(patch.keys_add)
        c.keys -= set(patch.keys_remove)
        c.tas |= set(patch.tas_add)
        c.tas -= set(patch.tas_remove)
        for sym, seed in patch.nhnl_seeds.items():
            if seed is None:
                c.seeds.pop(sym, None)
            else:
                c.seeds[sym] = seed
        c.patch_seq = patch.seq
        return self._delta(before)

    def disconnect(self, client_id: str, now: float) -> ChannelDelta:
        """Start the lease. Nothing is released yet, so the delta is empty."""
        c = self._require(client_id)
        c.connected = False
        c.lease_until = float(now) + self.lease_s
        return ChannelDelta()

    def expire(self, now: float) -> ChannelDelta:
        """Release every disconnected client whose lease ended at or before `now`."""
        gone = sorted(cid for cid, c in self._clients.items()
                      if not c.connected and c.lease_until is not None and now >= c.lease_until)
        if not gone:
            return ChannelDelta()
        before = self._snapshot()
        for cid in gone:
            del self._clients[cid]
        return self._delta(before, released=gone)

    def next_expiry(self) -> Optional[float]:
        leases = [c.lease_until for c in self._clients.values()
                  if not c.connected and c.lease_until is not None]
        return min(leases) if leases else None

    def _require(self, client_id: str) -> _ClientState:
        c = self._clients.get(client_id)
        if c is None:
            raise UnknownClient(f"no hello from {client_id!r}")
        return c


def diff_channels(before: Mapping[str, Iterable[str]], after: Mapping[str, Iterable[str]]):
    """Per-channel delta between two {sym: channels} maps ->
    (subscribe {sym: frozenset}, unsubscribe {sym: frozenset})."""
    sub, unsub = {}, {}
    for sym in set(before) | set(after):
        b = frozenset(before.get(sym, ()))
        a = frozenset(after.get(sym, ()))
        if a - b:
            sub[sym] = a - b
        if b - a:
            unsub[sym] = b - a
    return sub, unsub


# ── 4. Seq / epoch tracker (web side) ───────────────────────────────────────────

class TrackAction(enum.Enum):
    APPLY = "apply"                     # in order: fold into the mirror
    RESET_AND_APPLY = "reset_and_apply" # new epoch (ingest boot / new connection): reset mirror, then fold
    RESYNC = "resync"                   # gap / duplicate / bad start: drop the connection, reconnect
    DISCARD = "discard"                 # already resyncing: ignore until a new epoch starts at seq 1


class SeqTracker:
    """Web-side batch bookkeeping. Each feed connection is its own epoch whose
    batches start at seq 1 and increase by exactly 1. A new epoch starting at 1
    resets the mirror (invariant 8). Any gap or duplicate within an epoch, or a
    new epoch that does not start at 1, requires a resync; until a fresh epoch
    begins every batch is DISCARDed."""

    def __init__(self):
        self.epoch: Optional[int] = None
        self.last_seq = 0
        self.resyncing = False
        self.counters = {"applied": 0, "resets": 0, "gaps": 0, "duplicates": 0,
                         "discarded": 0}

    def accept(self, epoch: int, seq: int) -> TrackAction:
        if epoch != self.epoch:
            if seq == 1:
                self.epoch, self.last_seq, self.resyncing = epoch, 1, False
                self.counters["resets"] += 1
                return TrackAction.RESET_AND_APPLY
            return self._resync("gaps")
        if self.resyncing:
            self.counters["discarded"] += 1
            return TrackAction.DISCARD
        if seq == self.last_seq + 1:
            self.last_seq = seq
            self.counters["applied"] += 1
            return TrackAction.APPLY
        return self._resync("duplicates" if seq <= self.last_seq else "gaps")

    def _resync(self, why: str) -> TrackAction:
        self.counters[why] += 1
        if self.resyncing:
            self.counters["discarded"] += 1
            return TrackAction.DISCARD
        self.resyncing = True
        return TrackAction.RESYNC

    def reset(self) -> None:
        """The connection was dropped by the client: forget the epoch."""
        self.epoch, self.last_seq, self.resyncing = None, 0, False


# ── 5. Relay helpers (web side) ─────────────────────────────────────────────────

class LegacyFilter:
    """The v2/legacy older-t filter, exactly as BarBroadcaster._dispatch applies
    it: per (sym, key), a frame whose t is older than the newest t already sent to
    LEGACY subscribers is v2-only. Lives on web, so it survives ingest epochs."""

    def __init__(self):
        self._hi: dict[tuple[str, str], int] = {}

    def admit(self, sym: str, key: str, t: int) -> bool:
        """True when legacy subscribers may receive this frame (and records it)."""
        k = (sym, key)
        ok = t >= self._hi.get(k, t)
        if ok:
            self._hi[k] = t
        return ok

    @staticmethod
    def deliver(legacy_ok: bool, v2: bool) -> bool:
        return v2 or legacy_ok

    def high(self, sym: str, key: str) -> Optional[int]:
        return self._hi.get((sym, key))

    def forget(self, sym: str) -> None:
        for k in BAR_KEYS:
            self._hi.pop((sym, k), None)

    def __len__(self) -> int:
        return len(self._hi)


class RevClock:
    """Bar contract `rev`: a hybrid-logical-clock millisecond revision per
    (sym, key), `max(prev + 1, now_ms)` — the exact rule of
    BarBroadcaster._dispatch. Strictly increasing per key even if `now_ms` goes
    backwards, comparable with REST `developing.rev` (as-of ms). Stamped on WEB at
    relay time, never on ingest, so an ingest restart (new epoch) cannot reset or
    rewind it."""

    def __init__(self):
        self._rev: dict[tuple[str, str], int] = {}

    def stamp(self, sym: str, key: str, now_ms: int) -> int:
        if not _is_int(now_ms):
            raise ValueError("now_ms must be an int")
        k = (sym, key)
        rev = max(self._rev.get(k, 0) + 1, now_ms)
        self._rev[k] = rev
        return rev

    def observe(self, sym: str, key: str, rev: int) -> None:
        """Fold an externally seen rev (e.g. a REST developing.rev already served)
        so the next stamp is strictly above it."""
        k = (sym, key)
        if rev > self._rev.get(k, 0):
            self._rev[k] = rev

    def peek(self, sym: str, key: str) -> Optional[int]:
        return self._rev.get((sym, key))

    def forget(self, sym: str) -> None:
        """Only for a symbol whose clients are all gone: a later stamp restarts at
        now_ms, which is still above any rev a live client saw for it in practice."""
        for k in BAR_KEYS:
            self._rev.pop((sym, k), None)


@dataclass(frozen=True)
class RelayFrame:
    sym: str
    key: str
    msg: dict          # exactly BarBroadcaster's SSE frame: {sym, tf, bar, session?, rev}
    legacy_ok: bool


def frame_for(sym: str, key: str, bar: Mapping, final: bool, rev: int) -> dict:
    """The SSE frame BarBroadcaster._msg + _dispatch build for one bar."""
    tf, sess = KEY_SPEC[key]
    msg = {"sym": sym, "tf": tf, "bar": {**bar, "final": bool(final)}}
    if tf == "60":
        msg["session"] = sess
    msg["rev"] = rev
    return msg


def relay_bars(bars: Iterable[BarUpdate], legacy: LegacyFilter, revs: RevClock,
               now_ms: int) -> list:
    """Turn a batch's bars into subscriber frames, in batch order: rev stamped per
    frame, legacy admission decided per frame. A subscriber receives a frame iff
    `LegacyFilter.deliver(frame.legacy_ok, subscriber_is_v2)`."""
    out = []
    for b in bars:
        rev = revs.stamp(b.sym, b.key, now_ms)
        ok = legacy.admit(b.sym, b.key, b.bar["t"])
        out.append(RelayFrame(b.sym, b.key, frame_for(b.sym, b.key, b.bar, b.final, rev), ok))
    return out
