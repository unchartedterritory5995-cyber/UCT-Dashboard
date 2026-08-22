A table whose cells are not just plain text — one holds inline code, one
holds an image (TableCell/TableHeader are `block+`, so an image can sit as a
sibling block next to the cell's own paragraph).

| Symbol | Snippet | Chart |
| --- | --- | --- |
| NVDA | `df.iloc[-1]` | ![NVDA daily](https://example.com/charts/nvda.png) |
| AAPL | `get_bars(sym)` | plain cell, no image |
