A supported data-URI image (kept, gets a bounded `md-img-N.<ext>` ref and a
`data_uri` media entry) followed by an unsupported-MIME data-URI image (an
SVG payload, which markdown-it-py's own destination validator never even
tokenizes as an image — `mddoc.py`'s pre-tokenization pass degrades it to a
visible `[unsupported image: ...]` marker instead of leaking the raw base64
payload into the note).

![tiny supported png](data:image/png;base64,aUxvdmVOb3Rlcw==)

![tiny unsupported svg](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)
