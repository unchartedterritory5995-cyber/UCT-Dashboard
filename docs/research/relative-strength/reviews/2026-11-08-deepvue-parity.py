dv = {  # Deepvue: 1M 3M 6M 9M 12M (read 2026-11-08 from Deepvue's RS Line indicator, last close 2026-11-06)
'NVDA':(24,33,42,50,47),'AAPL':(61,77,77,80,83),'MSFT':(65,76,89,90,81),'AMZN':(66,61,63,74,63),
'META':(29,48,55,53,58),'GOOGL':(25,30,32,36,39),'TSLA':(47,64,49,44,49),'AVGO':(25,26,30,34,31),
'PLTR':(24,41,80,84,61),'AMD':(16,32,49,90,92),'NFLX':(35,35,33,35,30),'LLY':(90,90,92,89,89),
'JPM':(63,55,63,69,63),'XOM':(53,65,79,80,82),'COST':(84,88,83,74,74),'INTC':(6,9,13,27,38),
'NKE':(84,75,53,35,34),'PFE':(74,81,83,80,78),'BA':(41,33,32,32,32),'CRWD':(26,49,91,95,94),'CRCL':(28,37,35,60,43)}
us = {  # ours, production rs_rating_history, asof 2026-11-06
'NVDA':(34,22,15,33,34,36),'AAPL':(82,78,52,86,78,71),'MSFT':(79,79,55,78,86,48),'AMZN':(56,50,56,48,45,46),
'META':(49,50,19,73,53,36),'GOOGL':(25,17,16,24,19,41),'TSLA':(38,47,37,83,31,21),'AVGO':(17,11,16,13,17,24),
'PLTR':(53,37,15,44,78,26),'AMD':(92,29,8,54,50,93),'NFLX':(17,18,25,29,20,11),'LLY':(89,88,88,85,92,85),
'JPM':(56,54,53,47,72,51),'XOM':(80,65,43,76,77,84),'COST':(69,79,80,86,62,56),'INTC':(25,3,2,7,6,85),
'NKE':(20,44,80,44,35,13),'PFE':(74,77,66,84,76,65),'BA':(18,18,31,17,20,28),'CRWD':(95,73,17,56,96,90),'CRCL':(30,25,18,70,11,12)}
# us tuple: ibd, fast, m1, m3, m6, m12
T=list(dv)
def rank(v):
    s=sorted(range(len(v)),key=lambda i:v[i]); r=[0]*len(v)
    i=0
    while i<len(v):
        j=i
        while j+1<len(v) and v[s[j+1]]==v[s[i]]: j+=1
        for k in range(i,j+1): r[s[k]]=(i+j)/2+1
        i=j+1
    return r
def spear(a,b):
    ra,rb=rank(a),rank(b); n=len(a); ma=sum(ra)/n; mb=sum(rb)/n
    num=sum((x-ma)*(y-mb) for x,y in zip(ra,rb)); den=(sum((x-ma)**2 for x in ra)*sum((y-mb)**2 for y in rb))**.5
    return num/den
def stats(name,a,b):
    d=[x-y for x,y in zip(a,b)]; n=len(d)
    mae=sum(abs(x) for x in d)/n; bias=sum(d)/n; w3=sum(1 for x in d if abs(x)<=3); w10=sum(1 for x in d if abs(x)<=10)
    print(f"{name:34s} MAE {mae:5.1f}  bias(us-dv) {bias:+5.1f}  within3 {w3:2d}/{n}  within10 {w10:2d}/{n}  spearman {spear(a,b):.2f}")
col=lambda d,i:[d[t][i] for t in T]
stats("our IBD-style rating vs DV 12M",col(us,0),col(dv,4))
stats("our fast vs DV 3M",col(us,1),col(dv,1))
stats("our m1 vs DV 1M",col(us,2),col(dv,0))
stats("our m3 vs DV 3M",col(us,3),col(dv,1))
stats("our m6 vs DV 6M",col(us,4),col(dv,2))
stats("our m12 vs DV 12M",col(us,5),col(dv,4))
print("\nper stock: ours IBD vs DV 12M (diff)")
for t in T: print(f"  {t:5s} {us[t][0]:3d} {dv[t][4]:3d} {us[t][0]-dv[t][4]:+4d}")
# split by strength: bias for DV12M >=75 vs <75
hi=[t for t in T if dv[t][4]>=75]; lo=[t for t in T if dv[t][4]<75]
print("\nbias where DV12M>=75:", round(sum(us[t][0]-dv[t][4] for t in hi)/len(hi),1), len(hi), " | <75:", round(sum(us[t][0]-dv[t][4] for t in lo)/len(lo),1), len(lo))
