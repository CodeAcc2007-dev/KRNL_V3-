"""Interest catalog access shared by the API and extraction."""
from typing import List, Dict


def fetch_active_catalog(client) -> List[dict]:
    """Active catalog rows as [{'slug','label'}], ordered by sort_order. [] on error."""
    try:
        res = (
            client.table("interest_catalog")
            .select("slug,label,sort_order")
            .eq("active", True)
            .order("sort_order")
            .execute()
        )
        return [{"slug": r["slug"], "label": r["label"]} for r in (res.data or [])]
    except Exception:
        return []


def build_catalog_lookup(catalog: List[dict]) -> Dict[str, str]:
    """Map lowercased label AND slug to the canonical slug, for tolerant matching."""
    lookup: Dict[str, str] = {}
    for row in catalog:
        slug = row["slug"]
        lookup[slug.lower()] = slug
        lookup[row["label"].lower()] = slug
    return lookup
