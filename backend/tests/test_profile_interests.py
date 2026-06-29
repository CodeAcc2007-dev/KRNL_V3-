"""Profile interest_slugs are validated against the catalog before persisting."""
from app.api.v1.endpoints.profile import _valid_slugs


def test_valid_slugs_keeps_known_drops_unknown():
    catalog = [{"slug": "hackathons", "label": "Hackathons"},
               {"slug": "sports", "label": "Sports"}]
    assert _valid_slugs(["hackathons", "sports", "ponies"], catalog) == ["hackathons", "sports"]


def test_valid_slugs_handles_none():
    assert _valid_slugs(None, [{"slug": "hackathons", "label": "Hackathons"}]) == []
