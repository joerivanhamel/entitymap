#!/usr/bin/env python3
"""Generate the spec §9 entitymap.html companion from entitymap.json (spec-complete; layout follows the repository's entitymap_html_generator notebook).
Usage: python3 generate_html.py entitymap.json [entitymap.html]"""
import html, json, sys

SCHEMA_TYPE = {"Concept": "DefinedTerm", "ProprietaryTerm": "DefinedTerm", "Methodology": "DefinedTerm", "Metric": "DefinedTerm",
               "Taxonomy": "DefinedTermSet", "Person": "Person", "Organization": "Organization", "SoftwareProduct": "SoftwareApplication",
               "PhysicalProduct": "Product", "Service": "Service", "Platform": "SoftwareApplication", "Place": "Place", "Event": "Event",
               "Standard": "CreativeWork", "Regulation": "Legislation", "Guide": "Article"}
esc = lambda s: html.escape(str(s or ""), quote=True)


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else src.rsplit("/", 1)[0] + "/entitymap.html" if "/" in src else "entitymap.html"
    d = json.load(open(src, encoding="utf-8"))
    pub = d["publisher"]; pname = pub["name"]; root = pub["url"].rstrip("/")
    json_url, html_url = f"{root}/entitymap.json", f"{root}/entitymap.html"
    ents = d["entities"]; ids = {e["entityId"]: e for e in ents}
    org_id = next((e["entityId"] for e in ents if e["@type"] == "Organization" and e["name"] == pname), None)

    def ld(e):
        t = e["@type"]
        o = {"@context": "https://schema.org", "@type": SCHEMA_TYPE.get(t, "Thing"), "@id": f"{html_url}#{e['entityId']}",
             "additionalType": f"https://entitymap.org/spec/v1.0#{t}", "name": e["name"], "description": e["description"]}
        if e.get("alternateName"): o["alternateName"] = e["alternateName"]
        same = [e["sameAs"]] if isinstance(e.get("sameAs"), str) else list(e.get("sameAs") or [])
        if e["entityId"] == org_id and pub.get("sameAs") and pub["sameAs"] not in same: same.append(pub["sameAs"])
        if same: o["sameAs"] = same if len(same) > 1 else same[0]
        if e["entityId"] == org_id: o["url"] = pub["url"]
        elif e.get("hasChunks"): o["url"] = e["hasChunks"][0]["sourceUrl"]
        for r in e.get("relations") or []:
            ref = {"@id": f"{html_url}#{r['targetId']}"} if r.get("targetId") in ids else None
            if not ref: continue
            p = r["predicate"]
            if p == "AFFILIATED_WITH" and t == "Person": o.setdefault("affiliation", []).append(ref)
            elif p == "PRODUCED_BY" and t == "Service": o["provider"] = ref
            elif p == "PRODUCED_BY" and t in ("PhysicalProduct", "SoftwareProduct", "Platform"): o["brand" if t == "PhysicalProduct" else "publisher"] = ref
            elif p == "AUTHORED_BY": o["author"] = ref
        if org_id and t == "Service" and "provider" not in o and any(r.get("targetId") == e["entityId"] and r["predicate"] == "OFFERS" for r in ids[org_id].get("relations") or []):
            o["provider"] = {"@id": f"{html_url}#{org_id}"}
        if org_id and t == "PhysicalProduct" and "brand" not in o and any(r.get("targetId") == e["entityId"] and r["predicate"] == "OFFERS" for r in ids[org_id].get("relations") or []):
            o["brand"] = {"@id": f"{html_url}#{org_id}"}
        o["subjectOf"] = {"@type": "WebPage", "@id": html_url}
        return json.dumps(o, indent=4, ensure_ascii=False).replace("</", "<\\/")

    H = ["<!DOCTYPE html>", '<html lang="en">', "<head>", '    <meta charset="UTF-8">',
         '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
         f"    <title>EntityMap - {esc(pname)}</title>",
         f'    <meta name="description" content="EntityMap for {esc(pname)}: the entities this site covers, how they relate, and the evidence passages that support them.">',
         '    <meta name="robots" content="index, follow">',
         f'    <link rel="canonical" href="{esc(html_url)}">',
         f'    <link rel="alternate" type="application/json" href="{esc(json_url)}">',
         "    <style>",
         "        body { font-family: system-ui, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem; }",
         "        .entity { border-bottom: 1px solid #ccc; padding-bottom: 2rem; margin-bottom: 2rem; }",
         "        blockquote { border-left: 4px solid #007bff; margin: 1rem 0; padding-left: 1rem; color: #555; }",
         "        cite { display: block; margin-top: 0.5rem; font-size: 0.9em; font-style: normal; color: #666; }",
         "        .meta { font-size: 0.9em; color: #666; }",
         "    </style>", "</head>", "<body>",
         f"    <h1>EntityMap for {esc(pname)}</h1>",
         "    <p>This is the human-readable knowledge index for this domain.</p>",
         f'    <p class="meta">Machine-readable version: <a href="{esc(json_url)}">entitymap.json</a> · EntityMap v{esc(d["version"])} · Generated {esc(d["generated"][:10])} · Status: {esc(d.get("verificationStatus", "self-declared"))}</p>']
    for e in ents:
        eid = e["entityId"]
        H.append(f'    <div class="entity" id="{esc(eid)}">')
        H.append(f"        <h2>{esc(e['name'])} <small>({esc(e['@type'])})</small></h2>")
        if e.get("alternateName"): H.append(f"        <p class=\"meta\">Also known as: {esc(e['alternateName'])}</p>")
        H.append(f"        <p>{esc(e['description'])}</p>")
        same = [e["sameAs"]] if isinstance(e.get("sameAs"), str) else list(e.get("sameAs") or [])
        if same: H.append("        <p class=\"meta\">Same as: " + ", ".join(f'<a href="{esc(s)}">{esc(s.rsplit("/", 1)[-1] if "wikidata.org" in s else s.split("://", 1)[-1].rstrip("/"))}</a>' for s in same) + "</p>")
        H.append('        <script type="application/ld+json">')
        H.append("        " + ld(e).replace("\n", "\n        "))
        H.append("        </script>")
        if e.get("hasChunks"):
            H.append("        <h3>Evidence</h3>")
            for c in e["hasChunks"]:
                p = esc(c.get("publisher", pname))
                H += [f'        <blockquote data-publisher="{p}">', f'            "{esc(c["text"])}"', "            <cite>",
                      f'                <a href="{esc(c["sourceUrl"])}">{esc(c["pageTitle"])}</a> — published by {p}', "            </cite>", "        </blockquote>"]
        if e.get("relations"):
            H.append("        <h3>Relations</h3>"); H.append("        <ul>")
            for r in e["relations"]:
                if r.get("targetId") in ids: link = f'<a href="#{esc(r["targetId"])}">{esc(r["targetName"])}</a>'
                elif r.get("targetUri"): link = f'<a href="{esc(r["targetUri"])}">{esc(r["targetName"])}</a>'
                else: link = esc(r["targetName"])
                extra = f' <small>({esc(r["confidence"])})</small>' if r.get("confidence") else ""
                cond = (r.get("context") or {}).get("condition")
                if cond: extra += f" <small>— {esc(cond)}</small>"
                H.append(f'            <li><strong>{esc(r["predicate"])}</strong> {link}{extra}</li>')
            H.append("        </ul>")
        H.append("    </div>")
    H += ["</body>", "</html>"]
    open(out, "w", encoding="utf-8").write("\n".join(H) + "\n")
    print(f"wrote {out} ({len(ents)} entities)")


if __name__ == "__main__":
    main()
