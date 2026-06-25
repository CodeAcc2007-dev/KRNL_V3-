"""One-time backfill of events.email_date for rows synced before the column existed.

Re-fetches the mailbox (headers only), maps message_id -> send date, and updates
each event that has a matching message_id. Rows with no message_id (legacy) are
left NULL and fall back to created_at for sorting.

Usage (from backend/):  python scripts/backfill_email_date.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from imap_tools import MailBox
from supabase import create_client
from app.core.config import settings
from app.core.encryption import decrypt_token
from app.utils.dedup import get_message_id

sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

acc = sb.table("connected_accounts").select("*").eq("connection_status", "connected").execute().data
if not acc:
    print("No connected account.")
    sys.exit(0)
acc = acc[0]
token = decrypt_token(acc["encrypted_token"])

# Build message_id -> send date from the mailbox (headers only = fast).
mid_to_date = {}
with MailBox("imap.iitb.ac.in").login(acc["imap_username"], token, "INBOX") as mailbox:
    for msg in mailbox.fetch("ALL", reverse=True, limit=300, headers_only=True, mark_seen=False):
        if msg.date:
            mid_to_date[get_message_id(msg)] = msg.date.isoformat()
print(f"Indexed {len(mid_to_date)} emails from the mailbox.")

rows = sb.table("events").select("id, message_id, email_date").eq("user_id", acc["user_id"]).execute().data or []
updated = 0
for r in rows:
    if r.get("email_date") or not r.get("message_id"):
        continue
    dt = mid_to_date.get(r["message_id"])
    if dt:
        sb.table("events").update({"email_date": dt}).eq("id", r["id"]).execute()
        updated += 1

print(f"Backfilled email_date on {updated} of {len(rows)} events.")
