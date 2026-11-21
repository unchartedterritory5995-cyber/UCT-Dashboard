"""The device's daily-delta fixture IS a server delta (app/src/data/deviceStore/__fixtures__/ffseed_delta.json).

delta.test.js applies the fixture's deltas on the device side and must read back exactly the fixture's new full
packs. That proves the device against the SERVER only while the fixture is what the server's own code writes,
so this file holds it to that, by meaning rather than by bytes (gzip output may differ between zlib builds):

* every case's delta passes the server's own proof against its base and new pack (`ffseed_delta.verify_delta`);
* the generator (tools/ffseed_make_delta_js_fixture.py) still builds the same bars and the same operations, entry
  for entry, so a change to the builder, the format or the op choice turns this red by name. Then regenerate:

    python tools/ffseed_make_delta_js_fixture.py
"""
import base64
import hashlib
import json
import os

from api.services import ffseed_delta as dl
from api.services import ffseed_format as fmt
from tools import ffseed_make_delta_js_fixture as gen

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "app", "src", "data", "deviceStore", "__fixtures__", "ffseed_delta.json")
# the fields of a delta entry that do not depend on how a blob was compressed
_MEANING = [i for i, f in enumerate(dl.ENTRY_FIELDS) if f not in ("off", "len")]


def _committed():
    with open(FIXTURE, encoding="ascii") as f:
        return json.load(f)


def _b(s):
    return base64.b64decode(s)


def test_every_committed_delta_is_proven_by_the_server_and_names_its_manifest_entry():
    fx = _committed()
    assert set(fx["cases"]) == {"5", "D"}
    for tf, c in fx["cases"].items():
        base, new, delta = _b(c["base"]), _b(c["new"]), _b(c["delta"])
        dl.verify_delta(base, delta, new)                      # raises unless delta + base == new, exactly
        tr = dl.read_delta_trailer(delta)
        assert (tr["base"], tr["build"], tr["tf"]) == (fx["base_build"], fx["build"], tf)
        assert {s: dl.OP_NAMES[e[0]] for s, e in tr["symbols"].items()} == c["ops"]
        e = c["entry"]
        assert (e["bytes"], e["sha256"]) == (len(new), hashlib.sha256(new).hexdigest())
        assert (e["delta"]["bytes"], e["delta"]["sha256"]) == (len(delta), hashlib.sha256(delta).hexdigest())
        assert e["delta"]["base"] == fx["base_build"]
        ntr = fmt.read_trailer(new)
        assert e["symbols"] == len(ntr["symbols"]) and e["bars"] == sum(x[2] for x in ntr["symbols"].values())
    assert fx["cases"]["5"]["ops"] == gen.WANT_OPS


def test_the_generator_still_builds_the_committed_fixture():
    fx, now = _committed(), gen.fixture()
    for tf, c in fx["cases"].items():
        g = now["cases"][tf]
        assert g["ops"] == c["ops"] and g["splits"] == c["splits"] and g["comp"] == c["comp"]
        for k in ("base", "new"):
            a, b = _b(c[k]), _b(g[k])
            ta, tb = fmt.read_trailer(a), fmt.read_trailer(b)
            assert sorted(ta["symbols"]) == sorted(tb["symbols"]), (tf, k)
            for s in ta["symbols"]:
                assert fmt.read_served(a, s, ta) == fmt.read_served(b, s, tb), (tf, k, s)
        da, db = dl.read_delta_trailer(_b(c["delta"])), dl.read_delta_trailer(_b(g["delta"]))
        assert sorted(da["symbols"]) == sorted(db["symbols"])
        for s, e in da["symbols"].items():
            assert [e[i] for i in _MEANING] == [db["symbols"][s][i] for i in _MEANING], (tf, s)
