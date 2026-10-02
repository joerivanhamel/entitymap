#!/usr/bin/env python3
"""EntityMap v1.0 validator (errors = spec MUST violations, warnings = quality/SHOULD).
Usage: python3 validate_entitymap.py entitymap.json [--emit-checks]
--emit-checks prints compact JSON payloads for the browser checks (EM.verifyChunks / WD.verify)."""
import json, re, sys
from datetime import datetime, timezone
from urllib.parse import urlparse

CORE = {"Concept", "ProprietaryTerm", "Methodology", "Metric", "Taxonomy", "Person", "Organization", "SoftwareProduct",
        "PhysicalProduct", "Service", "Platform", "Place", "Event", "Standard", "Regulation", "Guide"}
LEGACY = {"DefinedTerm", "Product", "ScholarlyArticle", "CreativeWork"}
T1 = {"INSTANCE_OF", "PART_OF", "INCLUDES", "DEPENDS_ON", "REQUIRES", "MEASURES", "PRODUCED_BY", "REGULATED_BY", "AUTHORED_BY", "AFFILIATED_WITH", "COVERS"}
T2 = {"RELATES_TO", "PRECEDES", "ENABLES", "PREVENTS", "CONFLICTS_WITH", "DESCRIBED_BY", "OFFERS"}
T3 = {"IMPROVES", "DEGRADES", "LEADS_TO", "SUITED_FOR", "TARGETS", "ACHIEVES"}
STANDARD = T1 | T2 | T3
RESERVED = {"healthcare": {"TREATS", "CONTRAINDICATED_WITH", "REDUCES", "INDICATES", "EVIDENCED_BY"},
            "finance": {"CORRELATED_WITH", "BENCHMARKS_AGAINST", "PRICED_BY", "HEDGES"},
            "education": {"TEACHES", "PREREQUISITE_FOR", "ASSESSES"}}
FORBIDDEN = {"MEASURED_BY", "ENABLED_BY", "PRODUCES", "PRODUCED_FOR", "DEPENDED_ON_BY", "DEPENDS_ON_BY", "REQUIRED_BY", "IMPROVED_BY",
             "DEGRADED_BY", "COVERS_BY", "COVERED_BY", "DESCRIBES", "DESCRIBED_BY_INVERSE", "AFFILIATED_WITH_BY", "OFFERED_BY"}
OFFER_TARGETS = {"SoftwareProduct", "Service", "Platform", "PhysicalProduct"}
EXCLUSIVE = [("PART_OF", "INCLUDES", True), ("IMPROVES", "DEGRADES", False), ("ENABLES", "PREVENTS", False), ("OFFERS", "PRODUCED_BY", True)]
WIKIDATA = re.compile(r"^https://www\.wikidata\.org/wiki/Q[1-9]\d*$")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def sentences(t):
    return len([s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'‘“(])", t.strip()) if s])


def main():
    path = sys.argv[1]
    data = json.load(open(path, encoding="utf-8"))
    E, W = [], []
    err, warn = E.append, W.append
    for f in ("version", "schema", "publisher", "generated", "entities"):
        if f not in data: err(f"root: missing '{f}'")
    if data.get("version") != "1.0": err("root: version must be \"1.0\"")
    if data.get("schema") != "https://entitymap.org/spec/v1.0": err("root: schema must be https://entitymap.org/spec/v1.0")
    gen = data.get("generated", "")
    if not ISO.match(str(gen)): err("root: generated is not an ISO 8601 timestamp")
    else:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(gen.replace("Z", "+00:00"))).days
        if age > 30: warn(f"root: generated is {age} days old (consumers treat >30 days as stale)")
    vs = data.get("verificationStatus", "self-declared")
    if vs not in ("self-declared", "generator-draft", "third-party-verified"): err(f"root: invalid verificationStatus '{vs}'")
    if vs != "generator-draft": warn("root: verificationStatus is not 'generator-draft' — only promote after line-by-line human review")
    profile = data.get("profile", "core")
    pub = data.get("publisher", {}) or {}
    pname, purl = pub.get("name"), pub.get("url", "")
    if not pname: err("publisher: missing name")
    if not purl: err("publisher: missing url")
    if pname and re.search(r"\.(com|co\.uk|org|net|io|uk|de|fr)\b|^https?:|^www\.", pname, re.I): err(f"publisher.name '{pname}' looks like a domain — use the canonical brand name")
    if pname and pname != pname.strip(): err("publisher.name has leading/trailing whitespace")
    phost = urlparse(purl).netloc.lower().removeprefix("www.")
    vocab = set((data.get("vocabulary") or {}).get("predicates", []))
    for p in vocab:
        if p in STANDARD: err(f"vocabulary: custom predicate {p} conflicts with a standard predicate")
        if p != p.upper(): err(f"vocabulary: custom predicate {p} must be uppercase")
    if vocab and not (data.get("vocabulary") or {}).get("namespace"): err("vocabulary: custom predicates need a documented namespace URI")
    allowed = STANDARD | vocab | RESERVED.get(profile, set())

    ents = data.get("entities") or []
    if not ents: err("entities: at least one entity required")
    if len(ents) > 200: warn(f"{len(ents)} entities — spec says shard above 200")
    ids, chunk_ids, by_id, same_as = set(), set(), {}, {}
    for e in ents:
        eid = e.get("entityId", "?")
        if eid in ids: err(f"{eid}: duplicate entityId")
        ids.add(eid); by_id[eid] = e
    rel_count, relates_to, pairs = 0, 0, {}
    for e in ents:
        eid, t, name = e.get("entityId", "?"), e.get("@type", ""), e.get("name", "")
        for f in ("entityId", "@type", "name", "description", "hasChunks"):
            if f not in e or e.get(f) in (None, "", []): err(f"{eid}: missing '{f}'")
        if t in LEGACY: err(f"{eid}: legacy v0.x type '{t}'")
        elif t not in CORE and ":" not in t: err(f"{eid}: '{t}' is not a v1.0 core type (custom types must be namespaced, e.g. 'acme:Thing')")
        d = e.get("description", "")
        if d and not 1 <= sentences(d) <= 3: warn(f"{eid}: description should be 1–3 sentences")
        st = e.get("status", "active")
        if st not in ("active", "deprecated", "merged"): err(f"{eid}: invalid status '{st}'")
        if st in ("deprecated", "merged") and not e.get("replacedBy"): err(f"{eid}: status {st} requires replacedBy")
        for f, vals in (("maturityStatus", {"proposed", "established", "deprecated"}), ("audienceType", {"technical", "executive", "general", "regulatory"})):
            if f in e and e[f] not in vals: err(f"{eid}: invalid {f} '{e[f]}'")
        sa = e.get("sameAs")
        if sa:
            for s in ([sa] if isinstance(sa, str) else sa):
                if "wikidata.org" in s and not WIKIDATA.match(s): err(f"{eid}: malformed Wikidata sameAs '{s}' (use https://www.wikidata.org/wiki/Q…)")
                if "wikidata.org" in s: same_as.setdefault(s, []).append(eid)
            if t == "ProprietaryTerm": warn(f"{eid}: ProprietaryTerm should not carry sameAs")
        elif t == "Concept": warn(f"{eid}: Concept without sameAs (SHOULD) — fine only if Wikidata reconciliation found no exact match")
        chunks = e.get("hasChunks") or []
        if len(chunks) > 5: err(f"{eid}: {len(chunks)} chunks (max 5)")
        for c in chunks:
            cid = c.get("chunkId", "?")
            for f in ("chunkId", "text", "sourceUrl", "pageTitle", "publisher"):
                if not c.get(f): err(f"{eid}/{cid}: missing '{f}'")
            if cid in chunk_ids: err(f"{cid}: duplicate chunkId")
            chunk_ids.add(cid)
            if c.get("publisher") != pname: err(f"{eid}/{cid}: publisher '{c.get('publisher')}' ≠ publisher.name '{pname}'")
            tx = c.get("text", "")
            if len(tx) > 600: err(f"{eid}/{cid}: text is {len(tx)} chars (max 600)")
            if tx and sentences(tx) > 5: warn(f"{eid}/{cid}: text has more than 5 sentences")
            if tx != tx.strip(): warn(f"{eid}/{cid}: text has leading/trailing whitespace")
            su = c.get("sourceUrl", "")
            if not su.startswith("https://"): warn(f"{eid}/{cid}: sourceUrl is not https")
            if phost and urlparse(su).netloc.lower().removeprefix("www.") != phost: warn(f"{eid}/{cid}: sourceUrl is off the publisher's domain")
            if "retrieved" not in c: warn(f"{eid}/{cid}: missing retrieved (SHOULD)")
            elif not ISO.match(str(c["retrieved"])): err(f"{eid}/{cid}: retrieved is not ISO 8601")
            if "contentType" in c and c["contentType"] not in ("definition", "evidence", "example", "statistic", "procedure"): err(f"{eid}/{cid}: invalid contentType")
            if "relevanceScore" in c and not (isinstance(c["relevanceScore"], (int, float)) and 0 <= c["relevanceScore"] <= 1): err(f"{eid}/{cid}: relevanceScore must be 0.0–1.0")
        seen_rel = set()
        for r in e.get("relations") or []:
            rel_count += 1
            p, tid, tname = r.get("predicate", ""), r.get("targetId"), r.get("targetName")
            tag = f"{eid} {p} → {tname}"
            if not p: err(f"{eid}: relation missing predicate")
            if not tname: err(f"{tag}: missing targetName")
            if p in FORBIDDEN: err(f"{tag}: forbidden inverted predicate")
            elif p not in allowed: err(f"{tag}: predicate not in standard vocabulary or declared vocabulary")
            if p == "RELATES_TO": relates_to += 1
            if p in T3 and r.get("confidence") not in ("declared", "inferred"): err(f"{tag}: Tier 3 predicate needs confidence declared|inferred")
            if "confidence" in r and r["confidence"] not in ("declared", "inferred"): err(f"{tag}: invalid confidence")
            if p in T3 and r.get("confidence") == "inferred" and not r.get("context"): warn(f"{tag}: inferred Tier 3 relation without context")
            if tid is None and not r.get("targetUri"): warn(f"{tag}: no targetId or targetUri")
            if tid is not None and tid not in by_id and not r.get("targetShard"): err(f"{tag}: targetId {tid} does not exist")
            if tid == eid: err(f"{tag}: self-relation")
            tgt = by_id.get(tid)
            if tgt and tname != tgt.get("name"): warn(f"{tag}: targetName differs from target entity name '{tgt.get('name')}'")
            if r.get("targetUri") and "wikidata.org" in r["targetUri"] and not WIKIDATA.match(r["targetUri"]): err(f"{tag}: malformed Wikidata targetUri")
            if tid is None and r.get("targetUri") and not r.get("targetDescription"): warn(f"{tag}: external target — add targetDescription")
            if p == "MEASURES" and t != "Metric": err(f"{tag}: MEASURES source must be Metric")
            if p == "AFFILIATED_WITH" and t != "Person": err(f"{tag}: AFFILIATED_WITH source must be Person")
            if p == "COVERS" and t not in ("Concept", "ProprietaryTerm", "Taxonomy"): err(f"{tag}: COVERS source must be Concept/ProprietaryTerm/Taxonomy")
            if p == "OFFERS":
                if t != "Organization": err(f"{tag}: OFFERS source must be Organization")
                if tgt and tgt.get("@type") not in OFFER_TARGETS: err(f"{tag}: OFFERS target must be SoftwareProduct/Service/Platform/PhysicalProduct")
            key = (p, tid or r.get("targetUri"))
            if key in seen_rel: warn(f"{tag}: duplicate relation")
            seen_rel.add(key)
            if tid: pairs.setdefault((eid, tid), set()).add(p)
    for (a, b), ps in pairs.items():
        back = pairs.get((b, a), set())
        for x, y, directional in EXCLUSIVE:
            if (x in ps and y in ps) or (x in ps and y in back):
                err(f"{a}↔{b}: {x} and {y} declared between the same pair")
        if a < b:
            for p in ps & back:
                if p in ("PART_OF", "INCLUDES"): err(f"{a}↔{b}: {p} declared in both directions")
    if rel_count and relates_to / rel_count > 0.2: warn(f"RELATES_TO is {relates_to}/{rel_count} relations (>20%)")
    for s, who in same_as.items():
        if len(who) > 1: warn(f"sameAs {s} is shared by {', '.join(who)} — sameAs asserts identity; distinct entities cannot share one (use INSTANCE_OF + targetUri)")
    if pub.get("sameAs") and "wikidata.org" in pub["sameAs"] and not WIKIDATA.match(pub["sameAs"]): err("publisher: malformed Wikidata sameAs")
    types = {}
    for e in ents: types[e.get("@type")] = types.get(e.get("@type"), 0) + 1
    print(f"{path}: {len(ents)} entities, {len(chunk_ids)} chunks, {rel_count} relations · types {types}")
    for x in E: print("ERROR  ", x)
    for x in W: print("WARN   ", x)
    print(f"\n{len(E)} errors, {len(W)} warnings → {'PASS' if not E else 'FAIL'}")
    if "--emit-checks" in sys.argv:
        chunks = [{"chunkId": c["chunkId"], "sourceUrl": c["sourceUrl"], "pageTitle": c["pageTitle"], "text": c["text"]} for e in ents for c in e.get("hasChunks", [])]
        wd = [{"key": e["entityId"], "qid": e["sameAs"].rsplit("/", 1)[1], "name": e["name"], "alt": [e["alternateName"]] if e.get("alternateName") else [], "type": e["@type"],
               **({"website": purl} if e["entityId"] == ents[0]["entityId"] and e["@type"] == "Organization" else {})}
              for e in ents if isinstance(e.get("sameAs"), str) and WIKIDATA.match(e["sameAs"])]
        wd += [{"key": f"{e['entityId']}>{r['predicate']}", "qid": r["targetUri"].rsplit("/", 1)[1], "name": r["targetName"], "type": "Concept"}
               for e in ents for r in e.get("relations") or [] if WIKIDATA.match(r.get("targetUri", ""))]
        if pub.get("sameAs") and WIKIDATA.match(pub["sameAs"]):
            wd.append({"key": "publisher", "qid": pub["sameAs"].rsplit("/", 1)[1], "name": pname, "type": "Organization", "website": purl})
        print("\n--- EM.verifyChunks payload ---\n" + json.dumps(chunks, ensure_ascii=False))
        print("\n--- WD.verify payload ---\n" + json.dumps(wd, ensure_ascii=False))
    sys.exit(1 if E else 0)


if __name__ == "__main__":
    main()
