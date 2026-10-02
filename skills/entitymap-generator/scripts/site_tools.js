// EntityMap site tools - paste once into a browser tab ON THE TARGET SITE'S ORIGIN, then call EM.* in later calls.
window.EM = window.EM || {};
const EM_U = (...c) => String.fromCharCode(...c); // ASCII-only source: special characters are built from char codes
Object.assign(EM, {
  pages: EM.pages || {}, urls: EM.urls || [],
  norm: s => (s || '').replace(new RegExp('[' + EM_U(0xa0, 0x2007, 0x202f, 0x200b) + ']', 'g'), ' ').replace(/\s+/g, ' ').trim(),
  loose: s => EM.norm(s).replace(new RegExp('[`' + EM_U(0x2018, 0x2019, 0x201a, 0x2032) + ']', 'g'), "'").replace(new RegExp('[' + EM_U(0x201c, 0x201d, 0x201e, 0x2033) + ']', 'g'), '"').replace(new RegExp('[' + EM_U(0x2013, 0x2014, 0x2212) + ']', 'g'), '-').split(EM_U(0x2026)).join('...').toLowerCase(),
  async get(url) {
    const r = await fetch(url, { credentials: 'omit', redirect: 'follow' });
    return { status: r.status, finalUrl: r.url, type: r.headers.get('content-type') || '', text: await r.text() };
  },
  // 1. URL inventory from robots.txt + sitemaps (handles sitemap indexes, gz not supported)
  async sitemap(max = 5000) {
    const seen = new Set(), queue = [], out = new Map();
    try { const rb = await EM.get('/robots.txt'); (rb.text.match(/^\s*sitemap:\s*(\S+)/gim) || []).forEach(l => queue.push(l.split(/:\s*/i).slice(1).join(':').trim())); } catch (e) {}
    if (!queue.length) ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap-index.xml'].forEach(p => queue.push(new URL(p, location.origin).href));
    let files = 0;
    while (queue.length && files < 60 && out.size < max) {
      const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm);
      let r; try { r = await EM.get(sm); } catch (e) { continue; } files++;
      if (r.status !== 200) continue;
      const x = new DOMParser().parseFromString(r.text, 'application/xml');
      x.querySelectorAll('sitemap > loc').forEach(l => queue.push(l.textContent.trim()));
      x.querySelectorAll('url').forEach(u => { const loc = u.querySelector('loc'); if (loc && out.size < max) out.set(loc.textContent.trim(), (u.querySelector('lastmod') || {}).textContent || ''); });
    }
    EM.urls = [...out.keys()];
    const groups = {};
    EM.urls.forEach(u => { let seg; try { seg = '/' + (new URL(u).pathname.split('/')[1] || ''); } catch (e) { seg = '?'; } (groups[seg] = groups[seg] || []).push(u); });
    return { sitemapFiles: [...seen], total: EM.urls.length, groups: Object.fromEntries(Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, { count: v.length, sample: v.slice(0, 8) }])) };
  },
  find(re, limit = 60) { const rx = new RegExp(re, 'i'); return EM.urls.filter(u => rx.test(u)).slice(0, limit); },
  // 2. Parse a Document into evidence blocks (works on fetched or live DOM)
  parse(doc, url) {
    const q = s => doc.querySelector(s);
    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } }).filter(Boolean);
    const sameAs = new Set();
    JSON.stringify(ld).replace(/"sameAs":\s*(\[[^\]]*\]|"[^"]*")/g, (m, v) => { try { [].concat(JSON.parse(v)).forEach(x => sameAs.add(x)); } catch (e) {} });
    const social = [...doc.querySelectorAll('a[href]')].map(a => a.href).filter(h => /linkedin\.com\/company|wikidata\.org\/wiki\/Q|wikipedia\.org\/wiki\//i.test(h));
    const body = (doc.body || doc.documentElement).cloneNode(true);
    body.querySelectorAll('script,style,noscript,template').forEach(n => n.remove());
    const tw = doc.createTreeWalker(body, 4), parts = []; while (tw.nextNode()) parts.push(tw.currentNode.nodeValue);
    const fullText = EM.norm(body.textContent) + ' ' + EM_U(0x2016) + ' ' + EM.norm(parts.join(' '));
    const root = (q('main, [role=main], article') || doc.body).cloneNode(true);
    root.querySelectorAll('script,style,noscript,svg,iframe,template,form,nav,header,footer,aside,[aria-hidden="true"],[hidden]').forEach(n => n.remove());
    root.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i]').forEach(n => n.remove());
    const blocks = [], seen = new Set();
    root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,dd,dt,td,figcaption').forEach(n => {
      if (n.matches('li') && n.querySelector('p,li')) return;
      const t = EM.norm(n.textContent);
      const isH = /^H\d$/.test(n.tagName);
      if (!t || seen.has(t) || (!isH && t.length < 25)) return; seen.add(t);
      blocks.push((isH ? '## ' : '') + t);
    });
    return {
      url, title: EM.norm((q('title') || {}).textContent), h1: EM.norm((q('h1') || {}).textContent),
      canonical: (q('link[rel=canonical]') || {}).href || '', robots: (q('meta[name=robots]') || {}).content || '',
      lang: doc.documentElement.lang || '', metaDescription: (q('meta[name=description]') || {}).content || '',
      ldTypes: [...new Set(JSON.stringify(ld).match(/"@type":\s*"[^"]+"/g) || [])].map(s => s.split('"')[3]).slice(0, 15),
      sameAs: [...new Set([...sameAs, ...social])].slice(0, 20), fullText, blocks
    };
  },
  // 3. Fetch + parse many pages (same origin). Returns trimmed view; full data kept in EM.pages.
  async extract(urls, maxBlocks = 80, maxLen = 700) {
    const res = [];
    for (const url of urls) {
      try {
        const r = await EM.get(url);
        const p = EM.parse(new DOMParser().parseFromString(r.text, 'text/html'), url);
        Object.assign(p, { status: r.status, finalUrl: r.finalUrl, retrieved: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), needsRender: p.blocks.join(' ').length < 600 });
        EM.pages[url] = p; if (r.finalUrl !== url) EM.pages[r.finalUrl] = p;
        const { fullText, ...view } = p;
        view.blocks = p.blocks.slice(0, maxBlocks).map(b => b.length > maxLen ? b.slice(0, maxLen) + ' [...]' : b);
        view.totalBlocks = p.blocks.length; res.push(view);
      } catch (e) { res.push({ url, error: String(e) }); }
    }
    return res;
  },
  // 3a. Find candidate evidence across every extracted page: EM.grep('fall detect|automatic', 3)
  grep(re, perPage = 4, minLen = 60) {
    const rx = new RegExp(re, 'i'), out = [], freq = {};
    const pages = Object.entries(EM.pages).filter(([u, p]) => u === p.url).map(([u, p]) => p);
    pages.forEach(p => new Set(p.blocks).forEach(b => freq[b] = (freq[b] || 0) + 1));
    // blocks repeated on 3+ pages are menus/footers/boilerplate, never evidence
    pages.forEach(p => { const hits = p.blocks.filter(b => !b.startsWith('## ') && b.length >= minLen && (freq[b] < 3 || pages.length < 4) && rx.test(b)).slice(0, perPage); if (hits.length) out.push({ url: p.finalUrl || p.url, title: p.title, hits }); });
    return out;
  },
  // 3b. For JS-rendered pages: navigate the tab to the page, re-paste this file, then call EM.extractLive()
  extractLive() { const p = EM.parse(document, location.href); p.status = 200; p.finalUrl = location.href; p.retrieved = new Date().toISOString().replace(/\.\d+Z$/, 'Z'); EM.pages[location.href] = p; const { fullText, ...v } = p; return v; },
  // 4. Verify chunks are verbatim + pageTitle exact. chunks: [{chunkId, sourceUrl, pageTitle, text}]
  async verifyChunks(chunks) {
    const out = [];
    for (const c of chunks) {
      let p = EM.pages[c.sourceUrl];
      if (!p) { try { const r = await EM.get(c.sourceUrl); p = EM.parse(new DOMParser().parseFromString(r.text, 'text/html'), c.sourceUrl); p.status = r.status; p.finalUrl = r.finalUrl; EM.pages[c.sourceUrl] = p; } catch (e) { out.push({ chunkId: c.chunkId, verdict: 'FETCH_FAIL', error: String(e) }); continue; } }
      const exact = p.fullText.includes(EM.norm(c.text)) || p.blocks.some(b => b.includes(EM.norm(c.text)));
      const loose = exact || EM.loose(p.fullText).includes(EM.loose(c.text).replace(/[.!?;:,]+$/, ''));
      const v = { chunkId: c.chunkId, text: exact ? 'EXACT' : loose ? 'TYPOGRAPHIC_DIFF' : 'NOT_FOUND', title: p.title === EM.norm(c.pageTitle) ? 'OK' : 'MISMATCH', status: p.status, len: c.text.length };
      if (v.title !== 'OK') v.pageTitleOnPage = p.title;
      if (p.finalUrl && p.finalUrl !== c.sourceUrl) v.redirectsTo = p.finalUrl;
      if (/noindex/i.test(p.robots)) v.noindex = true;
      if (v.text === 'TYPOGRAPHIC_DIFF') { const i = EM.loose(p.fullText).indexOf(EM.loose(c.text).replace(/[.!?;:,]+$/, '')); v.pageVersion = p.fullText.substr(i, c.text.length + 5); }
      out.push(v);
    }
    const bad = out.filter(v => v.text !== 'EXACT' || v.title !== 'OK' || v.redirectsTo || v.noindex || v.status !== 200);
    return { checked: out.length, allPass: bad.length === 0, problems: bad };
  }
});
'EM site tools ready on ' + location.origin;
