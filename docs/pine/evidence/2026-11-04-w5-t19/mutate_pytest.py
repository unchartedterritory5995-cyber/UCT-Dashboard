"""mutate_pytest.py MUTS.json TESTFILE... (run from the repo root).
MUTS.json rows: [name, file, old, new] (old must occur exactly once) or [name, "+FILE", path, content]
(create a file that must not exist). Runs pytest on the test files, records KILLED/SURVIVED, and restores
the saved bytes (or removes the created file); restores are asserted byte-exact."""
import json
import os
import subprocess
import sys

muts = json.load(open(sys.argv[1], encoding="utf-8"))
tests = sys.argv[2:]
res = []
for name, f, old, new in muts:
    created = f == "+FILE"
    if created:
        path = old
        assert not os.path.exists(path), path
        saved = None
        open(path, "w", encoding="utf-8", newline="\n").write(new)
    else:
        path = f
        saved = open(path, "rb").read()
        s = saved.decode("utf-8")
        oldn = old.replace("\n", "\r\n") if "\r\n" in s else old
        newn = new.replace("\n", "\r\n") if "\r\n" in s else new
        if s.count(oldn) != 1:
            res.append((name, "BADMATCH %d" % s.count(oldn)))
            continue
        tmp = path + ".mut"
        open(tmp, "wb").write(s.replace(oldn, newn).encode("utf-8"))
        os.replace(tmp, path)
    try:
        p = subprocess.run([sys.executable, "-m", "pytest", *tests, "-q", "-p", "no:cacheprovider", "-x", "--no-header", "-W", "ignore"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        out = p.stdout + p.stderr
        fails = [ln.strip()[:140] for ln in out.splitlines() if ln.startswith("FAILED")][:3]
        res.append((name, "KILLED" if p.returncode != 0 else "SURVIVED", fails))
    finally:
        if created:
            os.remove(path)
        else:
            tmp = path + ".restore"
            open(tmp, "wb").write(saved)
            os.replace(tmp, path)
            assert open(path, "rb").read() == saved
for r in res:
    print(json.dumps(r, ensure_ascii=True))
