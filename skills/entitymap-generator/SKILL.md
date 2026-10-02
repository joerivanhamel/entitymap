---
name: entitymap-generator
description: Generate, update or audit an EntityMap (entitymap.json + entitymap.html, EntityMap v1.0 spec) for any website in any sector, with verified Wikidata sameAs matching and verbatim, live-checked evidence chunks.
---

# EntityMap Generator

Produces a publication-ready [EntityMap v1.0](https://entitymap.org/spec/v1.0) for any website: `entitymap.json` (machine-readable), `entitymap.html` (the spec §9 companion) and `entitymap-review.md` (audit trail + deployment notes). It works the same for a pizza chain, a global cosmetics group or a single-site dental practice: the method is fixed, the entities flex to the business.

**Quality bar — non-negotiable:**

- Every chunk is a verbatim passage from the site's live pages, and is re-checked against the live page by script before delivery. The same goes for every `pageTitle`.
- Every `sameAs` / `targetUri` comes from Wikidata tool output in this session, and has passed `WD.verify`. Never type a Q-number from memory. **When the match is not certain, omit it.** A missing sameAs is a small loss; a wrong one poisons the graph.
- Every relation is grounded in a sentence on the site, and recorded in the relation audit.
- The validator must report 0 errors.

Spec: EntityMap v1.0 by Fred Laurent and Dixon Jones (https://entitymap.org/spec/v1.0, https://github.com/entitymap/entitymap). The rules you need are embedded below.

## Inputs

- **Required:** the website URL.
- **Optional:** canonical brand name, priority pages, pages or sections to exclude, market/country, output folder, anything the site owner wants emphasised. If the user gives none, decide sensibly, state the choices in the review file and carry on. Don't stop to ask for confirmation of the entity list unless the user asked to review it first.

## Tooling — read before starting

The scripts live next to this file in `scripts/`:

| File | Runs in | Purpose |
|---|---|---|
| `scripts/site_tools.js` | a browser tab on the target site | sitemap inventory, page extraction, evidence search, live chunk verification (`EM`) |
| `scripts/wikidata_tools.js` | a browser tab (or Node 18+) | Wikidata reconciliation and final verification (`WD`) |
| `scripts/validate_entitymap.py` | Python 3.9+ (stdlib only) | spec validator + payloads for the live checks |
| `scripts/generate_html.py` | Python 3.9+ (stdlib only) | builds the spec §9 `entitymap.html` from the JSON |

**Why a browser.** Verbatim chunks need the page's real text and exact `<title>`; fetch/summarise tools paraphrase, and many sandboxes block wikidata.org and many websites. So the live work runs as JavaScript in a real browser tab, via any browser tool that can execute JavaScript in a page (e.g. Claude in Chrome's `javascript_tool`, the Claude desktop built-in browser, a Playwright/Puppeteer MCP's evaluate tool).

- Use two tabs: one on the **target site's origin** (paste `site_tools.js`, which defines `EM`) and one on **https://www.wikidata.org/wiki/Special:BlankPage** (paste `wikidata_tools.js`, which defines `WD`). `WD` also works from any tab or from Node 18+ (it uses Wikidata's CORS endpoint), but a Wikidata tab avoids site Content-Security-Policy blocks.
- Paste the whole file as the code of one JavaScript call. It defines the object on the page, and later calls just use it. **If the tab navigates, the object is lost: paste it again.**
- Browser tools often time out at ~30–60 s per call. Keep `EM.extract` batches to about 8 pages. Always run Wikidata work as `WD.start('reconcile', items, opts)` followed by `await WD.poll()`, and repeat `WD.poll()` while it says "still running".
- `EM` can only fetch the tab's own origin. If the site redirects `example.com` → `www.example.com`, open the tab on the final host.
- If no JavaScript-capable browser is available, stop and say so. Don't fall back to guessed IDs or paraphrased chunks.

## Process

### 1. Identity

- Open the site tab on the homepage, paste `site_tools.js`, and run `await EM.extract([location.href])`.
- **Publisher name** is the canonical brand name as the business writes it: check the Organization JSON-LD `name`, the logo alt text, the footer © line and the About page. Never use a domain, a legal suffix the brand doesn't use in public, or a product name. It must be character-identical everywhere.
- **Publisher URL** is the homepage canonical, exactly as served (scheme, `www`, trailing slash).
- **Language** comes from `<html lang>`, which gives `opts.lang` for Wikidata. **Country** is the main market, as a Wikidata Q-id from the tool (e.g. US = Q30, UK = Q145, CA = Q16, AU = Q408, DE = Q183, FR = Q142, IN = Q668; confirm any other via `WD.reconcile` with type `Place`).
- **Multilingual or multi-market sites:** an EntityMap lives at the domain root, so build it for the language/market version served at that root (check `hreflang`). Write descriptions in that language; chunks are always verbatim in the page's language. Separate country domains (e.g. `brand.de`, `brand.fr`) each get their own EntityMap.
- **Archetype** is one of: local service, food & hospitality, retail/ecommerce/consumer brand, B2B/SaaS, YMYL health, YMYL finance/legal, publisher/media, public sector/non-profit. It only steers entity selection (see the reference below).

### 2. Inventory and page selection

`await EM.sitemap()` returns the URL count and groups by first path segment. Then `EM.find('regex')` pulls URLs from the full list. If there's no sitemap (or only gzipped `.xml.gz` sitemaps, which the tool skips), collect the nav and footer links from the homepage (`[...document.querySelectorAll('nav a, footer a')].map(a=>a.href)`).

Select about **12–30 pages**, scaling with site size:

- **Include:** homepage; About; team, expert and author pages; every core product, service or treatment page (category hubs for big catalogues); pricing; locations; accreditation, regulation and trust pages; FAQs; the 3–8 pillar guides that define the domain concepts the brand talks about.
- **Exclude:** cart, account, search, tag and pagination pages, legal boilerplate, thin location duplicates, blog posts that only repeat pillar content, anything noindex (check the `robots` field).

### 3. Extract

Run `await EM.extract([...8 urls])` per batch. Each page returns `title` (the exact `<title>`, which is what `pageTitle` must be), `finalUrl`, `canonical`, `robots`, `retrieved`, `sameAs` (social/Wikidata links from JSON-LD and the page), and `blocks` (clean paragraph, list and heading text; `## ` marks headings). If `needsRender: true`, the page is JS-rendered: navigate the tab to it, re-paste `site_tools.js` and call `EM.extractLive()`.

Then `EM.grep('keyword|synonym', 4)` finds candidate evidence for an entity across every page you've extracted. That's the cheapest way to pick chunks. It automatically skips blocks repeated on 3+ pages (menus, footers). To read one page's body, use `EM.pages['<url>'].blocks`, filtered by regex.

### 4. Entity plan

Build the list from what the pages actually say. **Every entity needs at least one verbatim chunk from the site itself; if you can't find one, drop the entity.**

- **Size:** small local business 10–15 entities, mid-size 15–25, large brand 20–40 (never above 200).
- **Order and IDs:** `e_001` is always the publisher Organization. After that: people, offerings, the brand's own terms and methods, domain concepts, third-party organisations, regulations and standards, places, events, guides. Number sequentially with no gaps.
- **`name`:** as the site labels it (drop marketing padding like "Our amazing…"). One entity per real-world thing; spelling variants and abbreviations go in `alternateName`.
- **`description`:** 1–3 factual sentences in your own words, describing the thing as this publisher uses it. No superlatives the site can't back up ("leading", "best").
- **`@type`:** from the type rules below. Never use the legacy types DefinedTerm, Product, ScholarlyArticle or CreativeWork.

### 5. Wikidata reconciliation (the accuracy step)

In the Wikidata tab, paste `wikidata_tools.js`, then run:

```js
WD.start('reconcile', [
  {key:'e_001', name:'<Brand>', type:'Organization', website:'<publisher url>', country:'<country Q-id>', context:'<5-10 words from description>'},
  {key:'e_002', name:'<Full Name>', alt:['<name without title>'], type:'Person', context:'<profession, nationality>'},
  {key:'e_005', name:'<Concept>', alt:['<singular / formal name>'], type:'Concept', context:'...'},
  // every entity except ProprietaryTerm; pass website for any organisation whose site you know
], {lang:'en'}); await WD.poll()
```

`alt` = **other names for the same thing only** (abbreviation, spelling variant, formal/legal name, the singular). Never put a broader category in `alt` — a subscription plan given the alt "alarm" or a menu item given the alt "pizza" will happily match an unrelated item. If a generic concept matters, make it its own Concept entity and link offerings to it with `INSTANCE_OF`.

The tool searches Wikidata by every name and alias. It hard-rejects junk (scholarly articles, patents, disambiguation pages, name items, films, books…), acronym-only matches, type clashes (a Person must be human; an Organization must be an org or brand; a Concept or Service can't be a person, an organisation, a located place or a published work) and wrong-country candidates. It then returns a verdict.

| verdict | what you do |
|---|---|
| `MATCH`, `use:'sameAs'` | Read `desc`. If it is the same thing as the site's entity (same kind, same referent), set `"sameAs": "https://www.wikidata.org/wiki/<qid>"`. If it's only a broader category, treat it as `INSTANCE_OF` (next row). If it means something else, omit. |
| `MATCH`, `use:'INSTANCE_OF'` | The entity is the site's own offering (a plan, a menu item, a treatment package) and the item is the generic category. **No sameAs.** Add the relation `{"predicate":"INSTANCE_OF","targetName":"<Wikidata label>","targetUri":"https://www.wikidata.org/wiki/<qid>","targetDescription":"<Wikidata desc>"}`. Exception: when the entity *is* that exact product or brand (Invisalign at a dentist, a named branded product with its own item), use sameAs. |
| `AMBIGUOUS` | Pick a candidate only if its `desc` matches at least two independent facts on the site (e.g. profession + nationality, or sector + city) and no other candidate plausibly does. Otherwise omit. Write down the reasoning. |
| `REVIEW` / `NO_MATCH` | Omit. You may retry **once** with better names (singular, formal full name, without the brand prefix). Never pick a candidate the tool marked `reject`. |

Hard rules:

- Never give sameAs to a `ProprietaryTerm`.
- Never let two entities share one Q-id; distinct plans of one category each get `INSTANCE_OF` instead.
- **Publisher `sameAs`:** the Wikidata URI if e_001 was `MATCH` through the official-website check. Otherwise, use the official LinkedIn company URL if the site links it (`sameAs` field of the homepage extract) or the user supplies it. Never guess a LinkedIn URL. Otherwise omit it. Set e_001's own `sameAs` to the same value.
- A candidate flagged `viaAltOnly` matched only through an alt name: re-read its description with extra suspicion.

### 6. Evidence chunks

For each entity, pick 1–3 chunks (5 at most), using `EM.grep` and the extracted blocks.

- **Verbatim.** Copy a contiguous run of sentences from **one block**, character for character, keeping curly quotes, apostrophes and dashes exactly as extracted. You may cut at sentence boundaries. Never join non-adjacent sentences, fix typos, or add or drop punctuation.
- **Size.** 1–5 sentences, ≤600 characters (aim for 120–400). Each chunk should make sense on its own and ideally name the entity.
- **Best evidence first:**
  - the definition or what-it-is sentence (`contentType: "definition"`)
  - then proof: facts, credentials, how it works (`evidence`, `procedure`, `statistic`, `example`)
  - for the publisher: a what-we-do/about statement naming the brand, never just an address
  - for people: credentials and role
  - for regulators and accreditation bodies: the sentence on the site that states the relationship
- **Avoid:** prices, promo codes and "this month" offers (they go stale), unless the offer is the entity; nav, footer and cookie text; unattributed testimonials.
- **Fields:**
  - `sourceUrl` is the page's `finalUrl` (canonical)
  - `pageTitle` is the page's `title`, exactly
  - `publisher` is publisher.name, exactly
  - `retrieved` is that page's `retrieved`
  - `contentType` is one of definition / evidence / example / statistic / procedure

### 7. Relations

Declare only relations the site states or directly implies, and record the grounding sentence for each in the audit. Rules:

- One direction per pair. Never both PART_OF/INCLUDES, IMPROVES/DEGRADES, ENABLES/PREVENTS or OFFERS/PRODUCED_BY between the same pair.
- Only the 24 standard predicates. Never invent inverted forms (MEASURED_BY, ENABLED_BY, PRODUCES, DESCRIBES, OFFERED_BY…); swap subject and target instead.
- Type constraints:
  - `MEASURES`: the source must be a Metric
  - `AFFILIATED_WITH`: the source must be a Person
  - `COVERS`: the source must be a Concept, ProprietaryTerm or Taxonomy
  - `OFFERS`: the source must be an Organization, and the target a Service, PhysicalProduct, SoftwareProduct or Platform
- Tier 3 predicates (IMPROVES, DEGRADES, LEADS_TO, SUITED_FOR, TARGETS, ACHIEVES) need `confidence`:
  - `"declared"`: the page states the claim outright
  - `"inferred"`: only implied, and then add `context.condition`
  - When in doubt, use a Tier 2 predicate or no relation.
- `RELATES_TO` is the last resort and must stay ≤20% of relations.
- Use `"relations": []` for entities without relations.

Sector-neutral patterns that are almost always grounded:

- Publisher `OFFERS` each offering it sells or provides.
- Person `AFFILIATED_WITH` the publisher: staff, founder, author, ambassador, clinician.
- Publisher `REGULATED_BY` a statutory regulator or a formal standard or regulation it states it's registered with or bound by (e.g. a medical, dental, financial or legal regulator; ISO 27001; GDPR, HIPAA). A trade association the brand is merely a member of gets `REGULATED_BY` only if the site says the body sets standards the brand must meet; otherwise `RELATES_TO`.
- Offering `INCLUDES` a feature or component the page says it includes. Offering `REQUIRES` / `DEPENDS_ON` a prerequisite. Process step `PRECEDES` the next step.
- Offering `INSTANCE_OF` the generic Wikidata class (from step 5). Offering or Concept `REGULATED_BY` a Regulation the site ties it to.
- Offering `TARGETS` / `SUITED_FOR` an audience or use-case entity (Tier 3, so confidence is needed).
- Concept `DESCRIBED_BY` a Guide; a hub Concept `COVERS` its sub-topics.

### 8. Write entitymap.json

Use the template below: same field order, IDs `e_001…` and `c_001…` numbered in order of appearance, `generated` = today at `T00:00:00Z`, `verificationStatus: "generator-draft"` (always, until a human has reviewed it line by line), `profile: "core"`. Save to `<output folder>/<domain>/entitymap.json` (domain without `www.`; default output folder `./entitymap-output`).

### 9. Validate, verify live, fix, repeat

1. `python3 scripts/validate_entitymap.py <json> --emit-checks`. Fix **every** error. Resolve each warning or justify it in the review file; "generated is N days old" can't happen on a fresh build.
2. Site tab: `await EM.verifyChunks(<EM.verifyChunks payload>)`. It must return `allPass: true`.
   - `TYPOGRAPHIC_DIFF`: replace the text with `pageVersion` (trimmed to the same sentences).
   - `NOT_FOUND`: re-copy it from the block or pick another chunk.
   - `title MISMATCH`: use `pageTitleOnPage`.
   - `redirectsTo`: use the final URL.
   - noindex or non-200: pick a chunk from another page.
3. Wikidata tab: `WD.start('verify', <WD.verify payload>); await WD.poll()`. Every row must be `pass: true`. Remove or fix any that fail (a redirect means use the target Q-id; a junk or type problem means drop it). A `notes: label differs` row may stay only if the Wikidata decisions table explains why it is the same referent (e.g. a regional term and Wikidata's international label, such as "lorry" = "truck").
4. Loop until all three are clean.

### 10. HTML companion

Run `python3 scripts/generate_html.py <dir>/entitymap.json <dir>/entitymap.html`. It follows the layout of the repository's `entitymap_html_generator` notebook and adds everything spec §9 requires:

- `rel="alternate"` link to the JSON
- per-entity schema.org JSON-LD, with proper schema.org types plus `additionalType`, `@id`, `sameAs` and provider/affiliation links
- `data-publisher` on every blockquote and a visible "— published by X" cite
- relations as internal anchors, with Wikidata links for external targets
- `index, follow`

### 11. Review file and delivery

Write `<output folder>/<domain>/entitymap-review.md` with:

1. **Summary:** publisher, URL, archetype, counts (entities by type, chunks, relations, sameAs matched vs omitted), and the assumptions you made.
2. **Pages used:** URL and title.
3. **Wikidata decisions:** entity | verdict | decision (sameAs Q… / INSTANCE_OF Q… / omitted) | reason.
4. **Relation audit:** one line per relation, `[e_00x] PREDICATE → target | KEEP/WEAKEN/REPLACE | grounding quote (URL)`, plus the relations you removed and why.
5. **Verification:** validator result, chunk check (x/x EXACT), Wikidata check (x/x pass), date.
6. **Human review checklist:** uncertain types, Tier 3 claims, AMBIGUOUS decisions, entities you left out and why.
7. **Deployment:**
   - Serve both files at the domain root with no auth and no noindex: `/entitymap.json` (`application/json`) and `/entitymap.html`.
   - Add `EntityMap: https://<domain>/entitymap.json` to `robots.txt`.
   - Add `<link rel="entitymap" type="application/json" href="https://<domain>/entitymap.json" />` to every page `<head>`.
   - Add a sitewide footer link `<a href="https://<domain>/entitymap.html">EntityMap</a>`.
   - List `entitymap.html` in the XML sitemap (priority 0.9, changefreq weekly).
   - Validate at https://entitymap.org/validate.
   - Rebuild at least every 30 days, since `generated` older than 30 days reads as stale.
   - Switch `verificationStatus` to `"self-declared"` only after a full human review.

Reply in 3–5 lines: counts, sameAs matched/omitted, anything needing human review, and where the files are.

## Reference: entity types (16 core types)

| Type | Use for | Wikidata |
|---|---|---|
| Organization | the publisher, sub-brands, regulators, accreditation bodies, partners, manufacturers | sameAs if MATCH |
| Person | named people with a real role on the site | sameAs only if clearly the same person |
| Service | human-delivered offerings: treatments, delivery, consultancy, subscriptions, repairs | usually INSTANCE_OF |
| PhysicalProduct | tangible goods and ranges: menu items, product lines, devices | INSTANCE_OF, or sameAs for exact branded products |
| SoftwareProduct | apps and tools; **Platform** for marketplaces and ecosystems | sameAs if the exact product |
| Concept | general domain terms the site explains (conditions, ingredients, techniques, legal concepts) | sameAs expected |
| ProprietaryTerm | brand-coined names, schemes, loyalty programmes, trademarked methods | never sameAs; add canonicalLabel when there's a general term |
| Methodology / Metric / Taxonomy | named processes; measurable quantities; classification systems the publisher maintains | as Concept |
| Place | branches, service areas, venues (only if the site has real location content) | sameAs with country check |
| Event | a named occurrence with a date (a regulatory deadline, a product launch, an annual conference or festival) | sameAs if exact |
| Standard | voluntary specs with a governing body (ISO 9001, a quality framework) | sameAs if exact |
| Regulation | enacted law or statutory rules (GDPR, HIPAA, a national tax or consumer-protection law) | sameAs if exact |
| Guide | substantial maintained instructional hubs | rarely |

Decision rules:

- Exists independently of the brand → Concept. Coined or materially defined by the brand → ProprietaryTerm.
- Human-delivered → Service. Software → SoftwareProduct. Ecosystem → Platform.
- Enacted into law → Regulation. Voluntary with a governance body → Standard.

## Reference: what to pick by archetype

These are prompts for what to look for, not quotas. Only include what the site actually covers.

- **Local service** (dentist, plumber, law firm): practice Organization; practitioners (Person, credentials in chunks); each treatment or service (Service, INSTANCE_OF); branded systems they use (PhysicalProduct sameAs, e.g. Invisalign); conditions and problems they explain (Concept); regulator and registration bodies (Organization, `REGULATED_BY`); town or area served (Place, with country).
- **Food & hospitality** (restaurant chain, café): brand Organization; signature items or ranges (PhysicalProduct, INSTANCE_OF the dish); ordering channels (Service: delivery, click & collect; SoftwareProduct: the app); loyalty scheme (ProprietaryTerm); allergen or food-safety regulation the site cites (Regulation); delivery partners (Organization).
- **Retail / ecommerce / consumer brand** (cosmetics, fashion): group or brand Organization; sub-brands (Organization, sameAs usually exists); product ranges (PhysicalProduct); key ingredients or materials (Concept, sameAs); proprietary technologies (ProprietaryTerm); certifications (Standard); research or sustainability programmes (ProprietaryTerm/Methodology).
- **B2B / SaaS:** company; products (SoftwareProduct/Platform); features and modules (ProprietaryTerm, with `INCLUDES`); integrations (SoftwareProduct/Organization); metrics they define (Metric, with `MEASURES`); methodologies; compliance standards (Standard).
- **YMYL health:** provider; clinicians and medical reviewers (Person, credentials); services and treatments; conditions (Concept); regulators and licensing bodies (e.g. CQC, GMC, FDA, state medical boards → Organization); regulations (Regulation). Chunks must come from pages with visible expert attribution where possible. Keep `profile: "core"`: the healthcare profile is reserved until v1.1.
- **YMYL finance / legal:** firm; advisers or solicitors; products and services; regulator (e.g. FCA, SEC, FINRA, bar associations); regulations; concepts (pension, mortgage, power of attorney…).
- **Publisher / non-profit / public sector:** organisation; programmes (Service/ProprietaryTerm); topics (Concept hubs with `COVERS`); authors; guides.

## Reference: JSON template

```json
{
  "version": "1.0",
  "schema": "https://entitymap.org/spec/v1.0",
  "profile": "core",
  "publisher": { "name": "Brand", "url": "https://www.brand.com/", "sameAs": "https://www.wikidata.org/wiki/Q…" },
  "generated": "YYYY-MM-DDT00:00:00Z",
  "verificationStatus": "generator-draft",
  "entities": [
    {
      "entityId": "e_001",
      "@type": "Organization",
      "name": "Brand",
      "sameAs": "https://www.wikidata.org/wiki/Q…",
      "description": "1–3 factual sentences.",
      "hasChunks": [
        { "chunkId": "c_001", "text": "Verbatim sentence(s).", "sourceUrl": "https://www.brand.com/about/", "pageTitle": "Exact <title>", "publisher": "Brand", "retrieved": "YYYY-MM-DDTHH:MM:SSZ", "contentType": "definition" }
      ],
      "relations": [
        { "predicate": "OFFERS", "targetId": "e_003", "targetName": "Exact name of e_003" }
      ]
    }
  ]
}
```

Optional entity fields go between `name` and `description`, in this order: `alternateName`, `canonicalLabel`, `sameAs`. External relation targets use `targetUri` + `targetDescription` instead of `targetId`. Tier 3 relations add `"confidence"` and, where they're qualified, `"context": {"condition": "…"}`.
