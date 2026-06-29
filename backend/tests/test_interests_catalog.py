"""Catalog service helpers: shape + lookup building."""
from app.services.interests import build_catalog_lookup


def test_lookup_maps_label_and_slug_case_insensitively():
    catalog = [{"slug": "hackathons", "label": "Hackathons"},
               {"slug": "research-projects", "label": "Research & Projects"}]
    lookup = build_catalog_lookup(catalog)
    assert lookup["hackathons"] == "hackathons"          # slug key
    assert lookup["research & projects"] == "research-projects"  # label key, lowered
    assert lookup["HACKATHONS".lower()] == "hackathons"
    assert "unknown" not in lookup
