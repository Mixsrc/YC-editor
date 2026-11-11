/* YC Studio — version navigateur : remplace le pont Electron (window.host) par des équivalents web.
   Pas de saveFiles/loadFiles : l'appli retombe sur loadStore/saveStore (IndexedDB). Pas de Soundmondo. */
(function () {
  const DB = 'yc-studio', KEY = 'store';
  const idb = () => new Promise((ok, ko) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const tx = async (mode, fn) => { const db = await idb(); return new Promise((ok, ko) => { const t = db.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => ok(q && q.result); t.onerror = () => ko(t.error); }); };
  const IMPORT_EXT = new Set(['.syx', '.mid', '.midi', '.ycs', '.json', '.y0l', '.y0p', '.y0s']);
  const extOf = (n) => { const m = /\.[^.\/]+$/.exec(n); return m ? m[0].toLowerCase() : ''; };
  const baseOf = (n) => n.split('/').pop();
  const dirOf = (n) => { const p = n.split('/'); return p.length > 1 ? p[p.length - 2] : ''; };

  // ---- .zip : lecture (deflate via DecompressionStream) et écriture (sans compression) ----
  async function unzip(buf) {
    const v = new DataView(buf), u = new Uint8Array(buf), out = [];
    let e = u.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('zip illisible');
    let n = v.getUint16(e + 10, true), p = v.getUint32(e + 16, true);
    while (n--) {
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (name.endsWith('/')) continue;
      const ds = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), raw = u.subarray(ds, ds + csize);
      let data;
      if (method === 0) data = raw;
      else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else continue;
      out.push({ name, data });
    }
    return out;
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zipBlob(files) {
    const parts = [], cen = []; let off = 0;
    for (const [name, bytes] of Object.entries(files)) {
      const nb = new TextEncoder().encode(name), d = Uint8Array.from(bytes), crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nb.length, true);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      parts.push(h.buffer, nb, d); cen.push(c.buffer, nb); off += 30 + nb.length + d.length;
    }
    const cs = cen.reduce((s, x) => s + (x.byteLength ?? x.length), 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, cen.length / 2, true); e.setUint16(10, cen.length / 2, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cen, e.buffer], { type: 'application/zip' });
  }
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

  // ---- fichiers ouverts (.syx .mid .Y0L/P/S .ycs, .zip dépliés, dossiers) → même format que la version Windows ----
  async function collect(files) {
    const out = []; let bytes = 0;
    for (const f of files) {
      const path = f.webkitRelativePath || f.name, ext = extOf(f.name);
      if (ext === '.zip') {
        try { for (const z of await unzip(await f.arrayBuffer())) { const x = extOf(z.name); if (IMPORT_EXT.has(x) && out.length < 5000) out.push({ name: baseOf(z.name), folder: dirOf(z.name), ext: x, bytes: Array.from(z.data) }); } } catch {}
      } else if (IMPORT_EXT.has(ext) && out.length < 5000 && (bytes += f.size) < 200e6) out.push({ name: f.name, folder: dirOf(path), ext, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) });
    }
    return out;
  }
  const pick = ({ folder, filters } = {}) => new Promise((ok) => {
    const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.style.display = 'none';
    if (folder) i.webkitdirectory = true;
    else { const ex = [...new Set(((filters || [])[0] || {}).extensions || [])]; if (ex.length) i.accept = ex.map((x) => '.' + x).join(','); }
    i.onchange = async () => { const l = [...i.files]; i.remove(); ok(await collect(l)); };
    i.oncancel = () => { i.remove(); ok([]); };
    document.body.append(i); i.click();
  });

  window.host = {
    loadStore: async () => { try { return await tx('readonly', (s) => s.get(KEY)); } catch { try { return JSON.parse(localStorage.getItem('ycstudio')); } catch { return null; } } },
    saveStore: async (d) => { try { await tx('readwrite', (s) => s.put(d, KEY)); } catch { try { localStorage.setItem('ycstudio', JSON.stringify(d)); } catch {} } return true; },
    saveFile: async ({ defaultName, data, binary }) => { download(new Blob([binary ? new Uint8Array(data) : data]), defaultName || 'YC.syx'); return defaultName; },
    saveZip: async ({ defaultName, files }) => { download(zipBlob(files || {}), defaultName || 'YC_Biblio.zip'); return defaultName || 'YC_Biblio.zip'; },
    openFiles: pick,
    copyText: async (t) => { try { await navigator.clipboard.writeText(t); } catch {} return true; },
    readText: () => navigator.clipboard.readText(),
    locale: () => navigator.language || 'fr',
    libDownload: async ({ url }) => {
      let r; try { r = await fetch(url); } catch { throw new Error('le site refuse le téléchargement depuis un navigateur (CORS). Télécharge le .zip à la main, puis File > Load.'); }
      if (!r.ok) throw new Error('erreur ' + r.status);
      const f = new File([await r.blob()], url.split('/').pop() || 'sons.zip');
      return { files: await collect([f]), dir: '', size: f.size };
    },
  };
})();
