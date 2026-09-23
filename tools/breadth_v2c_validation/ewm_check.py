import sys; sys.path.insert(0,'/app')
import numpy as np, pandas as pd
from api.services.breadth_live import _ewm_last, _EMA20_ALPHA as A
rng=np.random.default_rng(1)
X=100+np.cumsum(rng.normal(0,1,(6,60)),axis=1)
X[1,30]=np.nan; X[2,10:13]=np.nan; X[3,:5]=np.nan; X[4,55]=np.nan
p=pd.DataFrame(X.T).ewm(alpha=A,adjust=False,ignore_na=False).mean().iloc[-1].to_numpy()
q=_ewm_last(X,A)
for i,lab in enumerate(['no gaps','1 gap mid','3-gap run','leading NaN','gap near end','no gaps']): print(lab, round(p[i],6), round(q[i],6), 'diff', round(q[i]-p[i],6))
# the collector-equivalent definition written out: pandas adjust=False resets the weight
def pandas_like(x, a):
    y = None; w = 1.0
    for v in x:
        if y is None:
            if v == v: y, w = v, 1.0
            continue
        w *= (1 - a)
        if v == v:
            y = (w * y + a * v) / (w + a); w = 1.0
    return y
print('hand-written adjust=False recursion == pandas:', all(abs(pandas_like(X[i], A) - p[i]) < 1e-9 for i in range(6)))
