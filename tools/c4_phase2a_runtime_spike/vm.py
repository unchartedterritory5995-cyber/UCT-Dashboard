"""tools/c4_phase2a_runtime_spike/vm.py — the Python dispatch loop.

⛔ MEASUREMENT INSTRUMENT. See isa.md. Not a Pine runtime.

⭐ WRITTEN THE WAY A PYTHON VM WOULD ACTUALLY BE WRITTEN IF IT HAD TO BE FAST:
local-variable binding of every hot name, a list-based stack with explicit index,
`math.isnan` avoided in favour of `x != x`, and no attribute lookups inside the
dispatch loop. Measuring a naive implementation would understate Python and make
the architecture decision on a strawman.
"""

import json
import sys
import time

PUSH_CONST, PUSH_SERIES, PUSH_HIST = 0, 1, 2
ADD, SUB, MUL, DIV, LT = 3, 4, 5, 6, 7
LOAD_LOCAL, STORE_LOCAL, LOAD_PERSIST, STORE_PERSIST = 8, 9, 10, 11
JUMP_IF_FALSE, JUMP = 12, 13
ARR_PUSH, ARR_GET, ARR_SIZE = 14, 15, 16
EMIT, POP, HALT = 17, 18, 19

NAN = float("nan")


def run(program, series, bars, max_steps=None):
    code = program["code"]
    consts = program["consts"]
    stack = [0.0] * 64
    locals_ = [0.0] * program["locals"]
    persist = [0.0] * program["persists"]
    arrays = [[] for _ in range(program["arrays"])]
    out = [0.0] * bars
    steps = 0
    limit = max_steps if max_steps is not None else float("inf")

    for bar in range(bars):
        sp = 0
        pc = 0
        while True:
            base = pc * 3
            op = code[base]
            a = code[base + 1]
            b = code[base + 2]
            pc += 1
            steps += 1
            if steps > limit:
                raise RuntimeError("INSTRUCTION_LIMIT_EXCEEDED")

            if op == PUSH_CONST:
                stack[sp] = consts[a]; sp += 1
            elif op == PUSH_SERIES:
                stack[sp] = series[a][bar]; sp += 1
            elif op == PUSH_HIST:
                if b == -1:
                    sp -= 1
                    off = stack[sp]
                else:
                    off = b
                idx = bar - int(off)
                stack[sp] = series[a][idx] if 0 <= idx <= bar else NAN
                sp += 1
            elif op == ADD:
                sp -= 1; y = stack[sp]; sp -= 1; x = stack[sp]
                stack[sp] = NAN if (x != x or y != y) else x + y; sp += 1
            elif op == SUB:
                sp -= 1; y = stack[sp]; sp -= 1; x = stack[sp]
                stack[sp] = NAN if (x != x or y != y) else x - y; sp += 1
            elif op == MUL:
                sp -= 1; y = stack[sp]; sp -= 1; x = stack[sp]
                stack[sp] = NAN if (x != x or y != y) else x * y; sp += 1
            elif op == DIV:
                sp -= 1; y = stack[sp]; sp -= 1; x = stack[sp]
                stack[sp] = NAN if (x != x or y != y or y == 0) else x / y; sp += 1
            elif op == LT:
                sp -= 1; y = stack[sp]; sp -= 1; x = stack[sp]
                stack[sp] = NAN if (x != x or y != y) else (1.0 if x < y else 0.0); sp += 1
            elif op == LOAD_LOCAL:
                stack[sp] = locals_[a]; sp += 1
            elif op == STORE_LOCAL:
                sp -= 1; locals_[a] = stack[sp]
            elif op == LOAD_PERSIST:
                stack[sp] = persist[a]; sp += 1
            elif op == STORE_PERSIST:
                sp -= 1; persist[a] = stack[sp]
            elif op == JUMP_IF_FALSE:
                sp -= 1; t = stack[sp]
                if t != t or t == 0:
                    pc = a
            elif op == JUMP:
                pc = a
            elif op == ARR_PUSH:
                sp -= 1; arrays[a].append(stack[sp])
            elif op == ARR_GET:
                sp -= 1; i = int(stack[sp]); arr = arrays[a]
                stack[sp] = arr[i] if 0 <= i < len(arr) else NAN; sp += 1
            elif op == ARR_SIZE:
                stack[sp] = float(len(arrays[a])); sp += 1
            elif op == EMIT:
                sp -= 1; out[bar] = stack[sp]
            elif op == POP:
                sp -= 1
            elif op == HALT:
                break
            else:
                raise RuntimeError("bad opcode %r" % op)
    return out, steps


def synth_bars(n):
    import math
    close = [0.0] * n
    openp = [0.0] * n
    high = [0.0] * n
    low = [0.0] * n
    p = 100.0
    for i in range(n):
        p += math.sin(i / 7) * 0.4 + math.cos(i / 13) * 0.2
        close[i] = p
        openp[i] = p - 0.1
        high[i] = p + 0.5
        low[i] = p - 0.5
    return [openp, high, low, close]


def _arg(flag, default):
    if flag in sys.argv:
        return sys.argv[sys.argv.index(flag) + 1]
    return default


if __name__ == "__main__":
    with open(_arg("--program", "program.json"), encoding="utf-8") as fh:
        program = json.load(fh)
    bars = int(_arg("--bars", 300))
    reps = int(_arg("--reps", 5))
    symbols = int(_arg("--symbols", 1))
    series = synth_bars(bars)

    t0 = time.perf_counter()
    checksum = 0.0
    steps = 0
    for _ in range(symbols):
        out, steps = run(program, series, bars)
        checksum += out[-1]
    first = (time.perf_counter() - t0) * 1000.0

    times = []
    for _ in range(reps):
        a = time.perf_counter()
        for _ in range(symbols):
            run(program, series, bars)
        times.append((time.perf_counter() - a) * 1000.0)
    times.sort()
    out, _ = run(program, series, bars)
    print(json.dumps({
        "host": "python " + sys.version.split()[0],
        "bars": bars, "symbols": symbols, "steps": steps,
        "firstRunMs": first,
        "medianMs": times[len(times) // 2],
        "minMs": times[0],
        "checksum": checksum,
        "head": out[:5],
        "tail": out[-3:],
    }))
