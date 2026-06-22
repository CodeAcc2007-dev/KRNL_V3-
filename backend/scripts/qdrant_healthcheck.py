"""Confirm Qdrant vector search returns candidates for a user (ops/diagnostic)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client
from app.core.config import settings
from app.services.event_merge import find_matching_event

sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
row = sb.table("events").select("user_id, display_name").limit(1).execute().data
if not row:
    print("No events to test against.")
    sys.exit(0)

user_id = row[0]["user_id"]
name = row[0]["display_name"]
match = find_matching_event(user_id, f"update regarding {name}", sb)
print(f"Search for '{name}' -> match: {match['display_name'] if match else None}")
