"""Run a validator module under PID 1's real environment (numpy, /app, provider creds).
A `railway ssh` shell lacks PID 1's env, so the interpreter is re-exec'd with it."""
import os, sys
env = {}
for kv in open('/proc/1/environ', 'rb').read().split(b'\0'):
    if b'=' in kv:
        k, v = kv.split(b'=', 1); env[k.decode()] = v.decode(errors='replace')
here = os.path.dirname(os.path.abspath(__file__))
env['PYTHONPATH'] = here + ':/app'
os.chdir(here)
exe = os.readlink('/proc/1/exe')
os.execve('/usr/bin/nice' if os.path.exists('/usr/bin/nice') else exe,
          (['nice', '-n', '15'] if os.path.exists('/usr/bin/nice') else []) + [exe, '-u'] + sys.argv[1:], env)
