import { describe, it, expect } from 'vitest'
import SparkMD5 from 'spark-md5'
import { evernoteAdapter } from './adapters/evernote'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pngBytes = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0))
const pngMd5 = SparkMD5.ArrayBuffer.hash(pngBytes.buffer)

const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export export-date="20260810T120000Z" application="Evernote">
 <note><title>Trade recap</title>
  <content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
   <en-note><div><en-todo checked="true"/>review AAPL</div><div><en-todo/>size DDOG</div>
   <div><en-media type="image/png" hash="${pngMd5}"/></div>
   <div><en-crypt cipher="AES">Zm9v</en-crypt></div></en-note>]]></content>
  <created>20240105T093000Z</created><tag>swing</tag><tag>recap</tag>
  <resource><data encoding="base64">${PNG_B64}</data><mime>image/png</mime>
   <resource-attributes><file-name>chart.png</file-name></resource-attributes></resource>
 </note></en-export>`

const vf = { path: 'Trading Notebook.enex', size: enex.length, lastModified: null,
             bytes: async () => new TextEncoder().encode(enex) }

describe('evernote adapter', () => {
  it('maps notebook filename to folder, dates, tags, todos, media, crypt', async () => {
    const { docs } = await evernoteAdapter.parse([vf])
    const d = docs[0]
    expect(d.folderPath).toEqual(['Trading Notebook'])
    expect(d.title).toBe('Trade recap')
    expect(d.createdAt).toBe('2024-01-05T09:30:00Z')
    expect(d.tags).toEqual(['swing', 'recap'])
    expect(d.html).toContain('data-type="taskList"')
    expect(d.html).toContain('data-checked="true"')
    expect(d.html).toContain(`import-ref://${pngMd5}`)
    expect(d.media[0]).toMatchObject({ kind: 'image', name: 'chart.png' })
    expect(d.html).toContain('encrypted content')
    expect(d.importKey).toBe('evernote:Trading Notebook/Trade recap/20240105T093000Z')
  })
})
