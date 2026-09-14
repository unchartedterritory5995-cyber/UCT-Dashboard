import io,glob,re,time
v=str(int(time.time()))
for f in glob.glob('*.html'):
    s=io.open(f,encoding='utf-8').read()
    s=re.sub(r'proto\.(css|js)(\?v=\d+)?', lambda m: 'proto.%s?v=%s'%(m.group(1),v), s)
    io.open(f,'w',encoding='utf-8').write(s)
print(v)
