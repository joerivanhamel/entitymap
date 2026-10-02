# EntityMap Generator: an Agent Skill

An [Agent Skill](https://agentskills.io) that turns any website into a publication-ready **EntityMap v1.0**: `entitymap.json`, the spec §9 companion `entitymap.html`, and an `entitymap-review.md` audit trail. It works for any site in any sector and any country, from a local dentist to a global consumer brand.

It's built on the [EntityMap open standard](https://entitymap.org/spec/v1.0) by Fred Laurent and Dixon Jones ([github.com/entitymap/entitymap](https://github.com/entitymap/entitymap)). This folder adds an automated generator on top of that spec; the spec itself is unchanged.

## What it does

1. **Inventory** the site from `robots.txt` and the XML sitemaps, then select the 12–30 pages that define the business.
2. **Extract** clean page text and the exact `<title>` in a real browser tab, so chunks can be truly verbatim.
3. **Plan the entities** using a sector-neutral checklist (local services, food & hospitality, retail/consumer brands, B2B/SaaS, YMYL health and finance, publishers, non-profits) and the 16 core types.
4. **Reconcile with Wikidata.** Every candidate is searched by name and alias. The tool rejects scholarly articles, patents, disambiguation and name items, acronym-only hits, type clashes (a person matched to a company, a concept matched to a place) and wrong-country matches. It returns `MATCH` / `AMBIGUOUS` / `REVIEW` / `NO_MATCH`, plus whether to use `sameAs` or an `INSTANCE_OF` link to a generic class. Uncertain matches are omitted, never guessed.
5. **Pick evidence chunks** that are copied character for character, and re-verify every chunk and page title against the live pages before delivery.
6. **Write grounded relations**, with a per-relation audit (direction rules, type constraints, Tier 3 confidence, RELATES_TO budget).
7. **Validate** against every MUST rule in the spec, **re-verify** every Wikidata ID, then **generate** the HTML companion with valid schema.org JSON-LD per entity.

## Files

| Path | Purpose |
|---|---|
| `SKILL.md` | The skill instructions the agent follows |
| `scripts/site_tools.js` | Browser-side: sitemap, extraction, evidence search, live chunk verification |
| `scripts/wikidata_tools.js` | Browser- or Node-side: Wikidata reconciliation and final ID verification |
| `scripts/validate_entitymap.py` | EntityMap v1.0 validator (Python 3.9+, no dependencies) |
| `scripts/generate_html.py` | Builds `entitymap.html` from `entitymap.json` (Python 3.9+, no dependencies) |

## Requirements

- An agent that supports Agent Skills (e.g. Claude Code, Claude.ai / Claude desktop, or any skills-compatible runtime).
- A browser tool that can run JavaScript in a page: Claude in Chrome, the Claude desktop built-in browser, or a Playwright/Puppeteer MCP server.
- Python 3.9+ for validation and HTML generation.
- No API keys. Wikidata is queried through its public API and query service.

## Install

**Claude Code:** copy this folder to `~/.claude/skills/entitymap-generator/` (personal) or `.claude/skills/entitymap-generator/` in a project.

**Claude.ai / Claude desktop:** zip the `entitymap-generator` folder and upload it under *Settings → Capabilities → Skills*.

Then ask: *"Create an EntityMap for https://example.com"*.

## Output

```
entitymap-output/<domain>/
├── entitymap.json          # verificationStatus: "generator-draft"
├── entitymap.html          # spec §9 companion with per-entity JSON-LD
└── entitymap-review.md     # Wikidata decisions, relation audit, verification results, deployment steps
```

Files are always marked `"generator-draft"`. Per the spec, only promote them to `"self-declared"` after a human has reviewed them line by line, and validate at [entitymap.org/validate](https://entitymap.org/validate) before publishing.

## Credits and license

The EntityMap v1.0 specification is by Fred Laurent and Dixon Jones, licensed under CC BY 4.0 ([entitymap.org/spec/v1.0](https://entitymap.org/spec/v1.0)). This skill was contributed by Joeri Vanhamel and is shared under the same CC BY 4.0 license as this repository.
