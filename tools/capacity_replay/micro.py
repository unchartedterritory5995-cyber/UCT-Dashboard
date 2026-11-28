import asyncio, aiohttp, time, sys
url = sys.argv[1]; conc = int(sys.argv[2]); dur = float(sys.argv[3])
async def main():
    n = 0; lat = []
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=0)) as s:
        end = time.monotonic() + dur
        async def w():
            nonlocal n
            while time.monotonic() < end:
                t = time.monotonic()
                async with s.get(url) as r:
                    await r.read()
                lat.append(time.monotonic() - t); n += 1
        await asyncio.gather(*[w() for _ in range(conc)])
    lat.sort()
    print("%s conc=%d rps=%.0f p50=%.1fms p99=%.1fms" % (url.split('/api/')[1][:50], conc, n / dur, lat[len(lat)//2]*1000, lat[int(len(lat)*.99)]*1000))
asyncio.run(main())
