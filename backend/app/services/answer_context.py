"""Builds the numbered source set, context string, and citations for Ask KRNL."""

SYSTEM_PROMPT = (
    "You are KRNL's assistant for an IIT Bombay student. Answer ONLY using the "
    "provided event sources. The context begins with today's date; treat any "
    "deadline before today as past and never describe a past deadline as "
    "upcoming. Answer the EXACT time window the question asks and do not widen "
    "it: \"today\" means only events dated today, \"tomorrow\" only events dated "
    "tomorrow, \"this week\" or \"next N days\" only events within that range "
    "from today. If no provided event falls in the asked window, say there is "
    "nothing due in that window rather than listing events outside it. When a "
    "question covers a window, enumerate EVERY provided event inside it and omit "
    "none. State exact dates and venues as given. If the sources do not contain "
    "the answer, say you do not know. Never invent links. Cite each statement "
    "with the source's bracket number, e.g. [1], [2]."
)


def build_source_set(agenda: list[dict], rag_docs: list[dict],
                     max_rag_extra: int = 5) -> list[dict]:
    by_event: dict[str, dict] = {}
    order: list[str] = []

    for item in agenda:
        eid = str(item.get("event_id"))
        by_event[eid] = {
            "event_id": eid,
            "display_name": item.get("display_name") or "Unknown Event",
            "deadline": item.get("deadline"),
            "venue": item.get("venue"),
            "category": item.get("category") or "General",
            "links": [],
            "body": "",
        }
        order.append(eid)

    extras = 0
    for doc in rag_docs:
        eid = str(doc.get("event_id"))
        body = doc.get("text") or ""
        if eid in by_event:
            src = by_event[eid]
            if not src["body"]:
                src["body"] = body
            if not src["links"]:
                src["links"] = doc.get("links") or []
            continue
        if extras >= max_rag_extra:
            continue
        by_event[eid] = {
            "event_id": eid,
            "display_name": doc.get("display_name") or "Unknown Event",
            "deadline": doc.get("deadline"),
            "venue": doc.get("venue"),
            "category": doc.get("category") or "General",
            "links": doc.get("links") or [],
            "body": body,
        }
        order.append(eid)
        extras += 1

    sources = []
    for idx, eid in enumerate(order, start=1):
        src = by_event[eid]
        src["index"] = idx
        sources.append(src)
    return sources


def render_context(sources: list[dict], anchor: str) -> str:
    lines = [f"Today is {anchor} (IST).", "", "Event sources:"]
    for s in sources:
        lines.append(f"[{s['index']}] {s['display_name']}")
        lines.append(
            f"    Deadline: {s['deadline'] or 'none'} | "
            f"Venue: {s['venue'] or 'none'} | Category: {s['category']}"
        )
        if s["links"]:
            lines.append(f"    Links: {', '.join(s['links'])}")
        if s["body"]:
            lines.append(f"    Details: {s['body']}")
    return "\n".join(lines)


_SUPERSCRIPT_DIGITS = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
}


def to_superscript(n: int) -> str:
    return "".join(_SUPERSCRIPT_DIGITS[d] for d in str(n))


def map_citations(answer_text: str, sources: list[dict]) -> tuple[str, list[dict]]:
    citations = []
    for s in sources:
        idx = s["index"]
        bracket = f"[{idx}]"
        if bracket in answer_text:
            answer_text = answer_text.replace(bracket, to_superscript(idx))
            try:
                event_id_val = int(s["event_id"])
            except (ValueError, TypeError):
                event_id_val = 0
            citations.append({
                "id": idx,
                "label": s["display_name"],
                "event_id": event_id_val,
            })
    return answer_text, citations
