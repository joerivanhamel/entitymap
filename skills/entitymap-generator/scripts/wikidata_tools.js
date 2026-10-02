// EntityMap Wikidata tools - paste once into any browser tab (or run in Node 18+), then call WD.* in later calls.
// Uses the public Wikidata API (CORS via origin=*) and the Wikidata Query Service. No API key needed.
globalThis.WD = {
  api: 'https://www.wikidata.org/w/api.php', sparql: 'https://query.wikidata.org/sparql?format=json&query=',
  JUNK: { Q4167410: 'disambiguation page', Q22808320: 'name disambiguation', Q13442814: 'scholarly article', Q43305660: 'US patent', Q253623: 'patent', Q4167836: 'Wikimedia category', Q11266439: 'template', Q17633526: 'Wikinews article', Q13406463: 'Wikimedia list', Q14204246: 'project page', Q101352: 'family name', Q202444: 'given name', Q3305213: 'painting', Q482994: 'album', Q134556: 'single', Q7366: 'song', Q11424: 'film', Q5398426: 'TV series', Q21191270: 'TV episode', Q7889: 'video game', Q1002697: 'periodical', Q5633421: 'journal', Q191067: 'article', Q10870555: 'report', Q18918145: 'journal article', Q23927052: 'conference paper', Q1980247: 'chapter', Q3331189: 'edition', Q571: 'book', Q7725634: 'literary work', Q30612: 'clinical trial', Q87167: 'manuscript', Q15416: 'TV programme', Q17442446: 'Wikimedia internal item' },
  ROOTS: { org: ['Q43229', 'Q431289', 'Q4830453', 'Q783794'], place: ['Q17334923', 'Q2221906', 'Q618123', 'Q486972', 'Q82794', 'Q56061'], event: ['Q1190554', 'Q1656682'], creative: ['Q17537576', 'Q47461344', 'Q732577'], legal: ['Q820655', 'Q7748', 'Q1428955'], software: ['Q7397', 'Q35127', 'Q1668024'], taxon: ['Q16521'] },
  norm(s) { return (s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^(the|dr|prof|professor|sir|dame|mr|mrs|ms|miss|lord|lady) /, '').replace(/( (mbe|obe|cbe|kbe|dbe|phd|md|frcs|frcp|mrcgp|bds|dds|dmd|esq|jr|sr))+$/, '').replace(/ies$/, 'y').replace(/(?<![s])s$/, ''); },
  async j(params) { const u = WD.api + '?' + new URLSearchParams({ format: 'json', origin: '*', ...params }); for (let i = 0; i < 3; i++) { const r = await fetch(u); if (r.ok) return r.json(); await new Promise(z => setTimeout(z, 1500 * (i + 1))); } throw new Error('API failed ' + u); },
  host(u) { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } },
  queries(it) { const qs = new Set([it.name, ...(it.alt || [])]); const m = it.name.match(/^(.*?)\s*\(([^)]+)\)\s*$/); if (m) { qs.add(m[1]); qs.add(m[2]); } return [...qs].filter(Boolean); },
  async search(q, lang) {
    const ids = new Set();
    for (const l of [...new Set([lang, 'en'])]) { const r = await WD.j({ action: 'wbsearchentities', search: q, language: l, uselang: l, type: 'item', limit: 10 }); (r.search || []).forEach(s => ids.add(s.id)); }
    const f = await WD.j({ action: 'query', list: 'search', srsearch: q, srnamespace: 0, srlimit: 10 }); ((f.query || {}).search || []).forEach(s => ids.add(s.title));
    return [...ids];
  },
  async entities(ids, lang) {
    const out = {};
    for (let i = 0; i < ids.length; i += 50) {
      const r = await WD.j({ action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props: 'labels|aliases|descriptions|claims|sitelinks', languages: [...new Set([lang, 'en', 'mul'])].join('|'), sitefilter: lang + 'wiki|enwiki' });
      Object.entries(r.entities || {}).forEach(([k, e]) => out[k] = e);
    }
    return out;
  },
  slim(e, lang) {
    const L = o => (o || {})[lang] || (o || {}).en || (o || {}).mul || {};
    const c = p => ((e.claims || {})[p] || []).map(x => ((x.mainsnak || {}).datavalue || {}).value).filter(Boolean);
    const names = [];
    [lang, 'en', 'mul'].forEach(l => { if ((e.labels || {})[l]) names.push(e.labels[l].value); ((e.aliases || {})[l] || []).forEach(a => names.push(a.value)); });
    return { qid: e.id, label: L(e.labels).value || '', desc: L(e.descriptions).value || '', names, p31: c('P31').map(v => v.id), website: c('P856'), wiki: ((e.sitelinks || {})[lang + 'wiki'] || (e.sitelinks || {}).enwiki || {}).title || '', sitelinks: Object.keys(e.sitelinks || {}).length, missing: 'missing' in e, redirectTarget: e.id };
  },
  async flags(qids) {
    const out = {}; qids.forEach(q => out[q] = {}); if (!qids.length) return out;
    const R = WD.ROOTS, rootOf = {}; Object.entries(R).forEach(([k, v]) => v.forEach(q => rootOf[q] = k));
    for (let i = 0; i < qids.length; i += 50) {
      const q = `SELECT DISTINCT ?i ?sup WHERE { VALUES ?i {${qids.slice(i, i + 50).map(x => 'wd:' + x).join(' ')}} VALUES ?sup {${Object.keys(rootOf).map(x => 'wd:' + x).join(' ')}} ?i wdt:P31/wdt:P279* ?sup . }`;
      try {
        const r = await Promise.race([fetch(WD.sparql + encodeURIComponent(q)).then(r => r.json()), new Promise((_, no) => setTimeout(() => no('timeout'), 30000))]);
        r.results.bindings.forEach(b => { out[b.i.value.split('/').pop()][rootOf[b.sup.value.split('/').pop()]] = true; });
      } catch (e) { qids.slice(i, i + 50).forEach(id => out[id].sparqlError = true); }
    }
    return out;
  },
  // direct-claim signals (more reliable than the class tree for forbids)
  sig(e) {
    const has = p => !!((e.claims || {})[p] || []).length, p31 = ((e.claims || {}).P31 || []).map(x => (((x.mainsnak || {}).datavalue || {}).value || {}).id);
    return { genericClass: has('P279') && !has('P176') && !has('P1716') && !has('P127') && !has('P856'), country: ((e.claims || {}).P17 || []).map(x => (((x.mainsnak || {}).datavalue || {}).value || {}).id), human: p31.includes('Q5'), placeLike: has('P625'), orgLike: has('P159') || has('P112') || has('P452') || has('P1454') || has('P1128'), creativeLike: has('P50') || has('P577') || has('P123') || has('P1476'), eventLike: has('P585') && !has('P279') };
  },
  // Hard type rules. f = class-tree flags (SPARQL), g = direct-claim signals. Returns rejection reason or ''.
  typeRule(type, f = {}, g = {}, websiteMatch = false) {
    const base = type.includes(':') ? 'Concept' : type;
    if (base === 'Person') return g.human ? '' : 'not a human (P31!=Q5)';
    if (g.human) return 'is a human';
    if (base === 'Organization') return (f.org || g.orgLike || websiteMatch) ? '' : (f.sparqlError ? '' : 'not an organization/brand');
    if (base === 'Place') return (f.place || g.placeLike) ? '' : (f.sparqlError ? '' : 'not a place');
    if (base === 'Event') return (f.event || g.eventLike) ? '' : (f.sparqlError ? '' : 'not an event');
    if (g.placeLike) return 'is a located place (has coordinates)';
    if (g.orgLike) return 'is an organization (HQ/founder/industry claims)';
    if (['Regulation', 'Standard', 'Guide'].includes(base)) return '';
    if (g.creativeLike) return 'is a creative/written work (author/publication claims)';
    if (g.eventLike) return 'is a dated event';
    return '';
  },
  // MAIN: items = [{key:'e_003', name:'...', alt:['...'], type:'Concept', context:'words from the site description', website:'https://...' (Organizations), country:'Q145' (Places/Organizations, optional)}]
  // verdict: MATCH | AMBIGUOUS | REVIEW | NO_MATCH.  use: 'sameAs' or 'INSTANCE_OF' (offering matched to a generic class -> relation with targetUri, never sameAs)
  async reconcile(items, opts = {}) {
    const lang = opts.lang || 'en', results = [];
    const perItem = [];
    for (let k = 0; k < items.length; k += 4) {
      const chunk = await Promise.all(items.slice(k, k + 4).map(async it => { const ids = new Set(); (await Promise.all(WD.queries(it).map(q => WD.search(q, lang)))).flat().forEach(id => ids.add(id)); return [...ids].slice(0, 30); }));
      perItem.push(...chunk);
    }
    const ents = await WD.entities([...new Set(perItem.flat())], lang);
    const pre = items.map((it, i) => {
      const qs = WD.queries(it), acr = q => /^[A-Z0-9&.]{2,6}$/.test(q.trim());
      const want = new Set(qs.filter(q => !acr(q)).map(WD.norm)), wantAcr = new Set(qs.filter(acr).map(WD.norm)), host = WD.host(it.website || '');
      return perItem[i].map(id => ents[id]).filter(Boolean).map(e => {
        const s = WD.slim(e, lang);
        s.exactLabel = want.has(WD.norm(s.label)); s.exactAlias = !s.exactLabel && s.names.some(n => want.has(WD.norm(n)));
        const prim = new Set([it.name, (it.name.match(/^(.*?)\s*\(/) || [])[1]].filter(Boolean).map(WD.norm));
        s.viaPrimary = s.names.some(n => prim.has(WD.norm(n)));
        s.acronymOnly = !s.exactLabel && !s.exactAlias && s.names.some(n => wantAcr.has(WD.norm(n)));
        s.websiteMatch = !!host && s.website.some(w => WD.host(w) === host);
        s.junk = s.p31.map(p => WD.JUNK[p]).filter(Boolean).join(', '); s.sig = WD.sig(e);
        const ctx = new Set(WD.norm(it.context || '').split(' ').filter(w => w.length > 3)); s.ctxOverlap = WD.norm(s.desc).split(' ').filter(w => ctx.has(w)).length;
        return s;
      });
    });
    const need = [...new Set(pre.flat().filter(s => (s.exactLabel || s.exactAlias || s.websiteMatch) && !s.junk).map(s => s.qid))];
    const F = await WD.flags(need);
    items.forEach((it, i) => {
      const cands = pre[i].map(s => { s.flags = F[s.qid]; s.reject = s.junk || (s.flags ? WD.typeRule(it.type, s.flags, s.sig, s.websiteMatch) : (s.acronymOnly ? 'acronym-only match' : 'no exact name match'));
        if (!s.reject && it.country && s.sig.country.length && !s.sig.country.includes(it.country) && !s.websiteMatch) s.reject = 'different country (P17)';
        return s; });
      const strong = cands.filter(s => !s.reject && (s.exactLabel || s.exactAlias || s.websiteMatch))
        .sort((a, b) => (b.websiteMatch - a.websiteMatch) || (b.exactLabel - a.exactLabel) || (!!b.wiki - !!a.wiki) || (b.ctxOverlap - a.ctxOverlap) || (b.sitelinks - a.sitelinks));
      let verdict, why;
      if (it.type === 'ProprietaryTerm') { verdict = 'NO_MATCH'; why = 'ProprietaryTerm never gets sameAs'; }
      else if (strong.length && strong[0].websiteMatch) { verdict = 'MATCH'; why = 'official website (P856) matches'; }
      else if (it.type === 'Organization' && it.website && strong.length) { verdict = 'REVIEW'; why = 'name matches but P856 website does not - likely a different organisation'; }
      else if (strong.length === 1) { verdict = 'MATCH'; why = (strong[0].exactLabel ? 'exact label' : 'exact alias') + ', type-compatible, unique'; }
      else if (strong.length > 1 && strong.filter(s => s.exactLabel).length === 1 && strong[0].exactLabel && strong[0].wiki) { verdict = 'MATCH'; why = 'only candidate whose main label matches (others alias-only) - confirm description'; }
      else if (strong.length > 1) { verdict = 'AMBIGUOUS'; why = strong.length + ' type-compatible exact-name candidates - decide from descriptions or omit'; }
      else if (cands.some(s => !s.junk)) { verdict = 'REVIEW'; why = 'no exact, type-compatible name match'; }
      else { verdict = 'NO_MATCH'; why = 'no candidates'; }
      const top = strong[0] || {};
      const offering = ['Service', 'PhysicalProduct', 'SoftwareProduct', 'Platform'].includes(it.type);
      const use = verdict !== 'MATCH' ? undefined : (offering && (!top.viaPrimary || (top.sig && top.sig.genericClass)) ? 'INSTANCE_OF' : 'sameAs');
      const show = [...strong, ...cands.filter(s => !strong.includes(s))].slice(0, verdict === 'MATCH' ? 3 : 5)
        .map(s => ({ qid: s.qid, label: s.label, desc: s.desc, wiki: s.wiki, exact: s.exactLabel ? 'label' : s.exactAlias ? 'alias' : 'no', viaAltOnly: (s.exactLabel || s.exactAlias) && !s.viaPrimary ? true : undefined, site: s.websiteMatch || undefined, ctx: s.ctxOverlap, reject: s.reject || undefined }));
      results.push({ key: it.key, name: it.name, type: it.type, verdict, why, use, qid: ['MATCH'].includes(verdict) ? top.qid : null, label: verdict === 'MATCH' ? top.label : undefined, desc: verdict === 'MATCH' ? top.desc : undefined, candidates: show });
    });
    return results;
  },
  // Background runner (the browser tool times out at ~45s): WD.start('reconcile', items, opts) then WD.poll()
  start(fn, ...args) { WD.job = { fn, done: false, t0: Date.now() }; WD[fn](...args).then(r => { WD.job.result = r; }).catch(e => { WD.job.error = String(e); }).finally(() => { WD.job.done = true; WD.job.ms = Date.now() - WD.job.t0; }); return 'started ' + fn; },
  async poll(maxMs = 35000) { const t = Date.now(); while (!WD.job.done && Date.now() - t < maxMs) await new Promise(r => setTimeout(r, 1000)); return WD.job.done ? WD.job : 'still running (' + Math.round((Date.now() - WD.job.t0) / 1000) + 's) - call WD.poll() again'; },
  // FINAL CHECK: list = [{key, qid, name, alt:[], type, website?}] - re-fetches every sameAs before publishing
  async verify(list, opts = {}) {
    const lang = opts.lang || 'en', ids = [...new Set(list.map(x => x.qid))];
    const ents = await WD.entities(ids, lang), F = await WD.flags(ids);
    return list.map(x => {
      const e = ents[x.qid]; if (!e || 'missing' in e) return { key: x.key, qid: x.qid, pass: false, reason: 'item does not exist' };
      const s = WD.slim(e, lang), want = new Set(WD.queries(x).filter(q => !/^[A-Z0-9&.]{2,6}$/.test(q.trim())).map(WD.norm));
      const problems = [];
      if (e.id !== x.qid) problems.push('redirects to ' + e.id + ' - use that');
      const nameOk = s.names.some(n => want.has(WD.norm(n))) || (x.website && s.website.some(w => WD.host(w) === WD.host(x.website)));
      const notes = [];
      if (!nameOk) notes.push('label differs from entity name/alternateName - keep only if the review file justifies it as the same referent');
      const junk = s.p31.map(p => WD.JUNK[p]).filter(Boolean); if (junk.length) problems.push('junk class: ' + junk.join(', '));
      const tr = WD.typeRule(x.type, F[e.id], WD.sig(e), !!(x.website && s.website.some(w => WD.host(w) === WD.host(x.website)))); if (tr) problems.push('type clash: ' + tr);
      if (x.type === 'ProprietaryTerm') problems.push('ProprietaryTerm must not carry sameAs');
      return { key: x.key, qid: x.qid, label: s.label, desc: s.desc, pass: problems.length === 0, problems, notes: notes.length ? notes : undefined };
    });
  }
};
'WD tools ready';
