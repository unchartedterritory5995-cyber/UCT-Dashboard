"""W5-T5: the Python ulp_gap (column diff) and the JS tool's ulpStats (HP-3 REPORTED lines) are one rule.
The JS tool is the authority; this test fails if the two drift."""
import json
import struct
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import pine_runtime_host_parity as hp  # noqa: E402

PAIRS = [(1.4558151025898136, 1.4558151025898134), (0.0, -0.0), (5e-324, -5e-324), (-1.0, -1.0000000000000002),
         (1.0, 1.0), (float("inf"), 1.7976931348623157e308), (-3.5, 2.25)]


def js_gap(a: float, b: float):
    enc = lambda x: __import__("base64").b64encode(struct.pack("<d", x)).decode()
    code = ("import('./tools/pine_runtime_host_parity.mjs').then(m=>{const [a,b]=JSON.parse(process.argv[1]);"
            "console.log(JSON.stringify(m.ulpStats({cols:{p:a}},{cols:{p:b}})))})")
    p = subprocess.run(["node", "-e", code, json.dumps([enc(a), enc(b)])], cwd=str(REPO), capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_python_ulp_gap_equals_the_js_rule():
    for a, b in PAIRS:
        js = js_gap(a, b)
        py = hp.ulp_gap(a, b)
        if js["maxUlp"] == "inf/nan":
            assert py is None, (a, b)
            continue
        if a == b and struct.pack("<d", a) == struct.pack("<d", b):
            assert js["rows"] == 0 and py == 0, (a, b)
        elif a == b:  # 0.0 vs -0.0: differs bit for bit; adjacent zeros on the ordered line are 0 apart
            assert js["rows"] == 1 and float(js["maxUlp"]) == float(py), (a, b, js, py)  # JS Number() rounds huge BigInts
        else:
            assert js["rows"] == 1 and float(js["maxUlp"]) == float(py), (a, b, js, py)  # JS Number() rounds huge BigInts
