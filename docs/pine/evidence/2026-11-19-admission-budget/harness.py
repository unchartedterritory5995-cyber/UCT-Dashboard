"""Entry point: the spawn-context detector child re-imports __main__, so the work lives in repro_core."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if __name__ == "__main__":
    import repro_core  # noqa: F401
