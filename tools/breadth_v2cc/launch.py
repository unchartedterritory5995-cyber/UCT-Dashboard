"""Run a correction-branch script on the runner under PID 1's environment, with the
branch's api/services modules OVERLAID on the deployed /app code (per module, via the
package __path__), so nothing in /app is modified and the parked supervisor is untouched."""
import os, sys
if os.environ.get("_V2CC_CHILD") != "1":
    env = {}
    for kv in open('/proc/1/environ', 'rb').read().split(b'\0'):
        if b'=' in kv:
            k, v = kv.split(b'=', 1); env[k.decode()] = v.decode(errors='replace')
    here = os.path.dirname(os.path.abspath(__file__))
    env['PYTHONPATH'] = here + ':/app'
    env['_V2CC_CHILD'] = '1'
    os.chdir(here)
    exe = os.readlink('/proc/1/exe')
    os.execve('/usr/bin/nice', ['nice', '-n', '15', exe, '-u', __file__] + sys.argv[1:], env)
here = os.path.dirname(os.path.abspath(__file__))
overlay = os.path.join(os.path.dirname(os.path.dirname(here)), "api", "services")
sys.path.insert(0, "/app")
import api.services
api.services.__path__.insert(0, overlay)
script = sys.argv[1]
sys.argv = sys.argv[1:]
import runpy
runpy.run_path(os.path.join(here, script), run_name="__main__")
