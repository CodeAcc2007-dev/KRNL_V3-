"""One-time cleanup of duplicate event rows created by re-syncs before Phase 1.

Legacy rows have no message_id, so duplicates are detected by content:
(user_id, display_name). The LOWEST id in each group is kept; the rest are
deleted from Supabase along with their orphaned Qdrant vectors.

DRY-RUN by default — prints exactly what it would delete and changes nothing.
Pass --apply to actually delete.

Usage (from the backend/ directory):
    python scripts/cleanup_duplicates.py            # dry run
    python scripts/cleanup_duplicates.py --apply    # perform deletions
"""
import os
import sys
from collections import defaultdict

# Allow running as `python scripts/cleanup_duplicates.py` from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client

from app.core.config import settings
from app.services.ingestion import qdrant_client

COLLECTION = "krnl_email_chunks"


def main(apply: bool) -> None:
    supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

    rows = (supabase.table("events")
            .select("id, user_id, display_name")
            .order("id")
            .execute()).data or []
    print(f"Loaded {len(rows)} event rows.")

    groups = defaultdict(list)
    for r in rows:
        groups[(r["user_id"], r["display_name"])].append(r["id"])

    to_delete = []  # list of (id, display_name)
    for (user_id, display_name), ids in groups.items():
        if len(ids) > 1:
            keep = min(ids)
            dupes = sorted(i for i in ids if i != keep)
            print(f"  '{display_name}': keep id={keep}, delete {dupes}")
            to_delete.extend((i, display_name) for i in dupes)

    if not to_delete:
        print("No duplicates found. Nothing to do.")
        return

    print(f"\n{'APPLYING' if apply else 'DRY RUN'}: {len(to_delete)} duplicate rows would be deleted.")
    if not apply:
        print("Re-run with --apply to delete them (and their Qdrant vectors).")
        return

    delete_ids = {str(eid) for eid, _ in to_delete}

    # Delete the matching Qdrant vectors by POINT ID. Filter-deleting by
    # event_id would require a payload index on that field (which the collection
    # doesn't have); scrolling + deleting by id avoids that dependency.
    try:
        points, _ = qdrant_client.scroll(
            collection_name=COLLECTION, limit=10000,
            with_payload=True, with_vectors=False,
        )
        orphan_point_ids = [p.id for p in points if str((p.payload or {}).get("event_id")) in delete_ids]
        if orphan_point_ids:
            qdrant_client.delete(collection_name=COLLECTION, points_selector=orphan_point_ids)
        print(f"  deleted {len(orphan_point_ids)} Qdrant vectors for {len(delete_ids)} events")
    except Exception as e:
        print(f"  WARN: failed to delete Qdrant vectors: {e}")

    for event_id, display_name in to_delete:
        try:
            supabase.table("events").delete().eq("id", event_id).execute()
            print(f"  deleted event id={event_id} ('{display_name}')")
        except Exception as e:
            print(f"  ERROR: failed to delete event {event_id}: {e}")

    print("Done.")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
