import json,urllib.request,sys
BASE='http://127.0.0.1:8151'
def req(sess,p,data=None,meth=None,base=None):
    r=urllib.request.Request((base or BASE)+p,data=json.dumps(data).encode() if data is not None else None,headers={'Cookie':'uct_session='+sess,'Content-Type':'application/json'},method=meth)
    try:
        with urllib.request.urlopen(r,timeout=60) as x:
            b=x.read().decode(); 
            try: return x.status,json.loads(b)
            except Exception: return x.status,b
    except urllib.error.HTTPError as e: return e.code,e.read().decode()[:800]
