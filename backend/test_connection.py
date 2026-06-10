import os
from imap_tools import MailBox
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

LDAP_USER = "25b2164"
TEMP_ACCESS_TOKEN = os.getenv("TEMP_ACCESS_TOKEN", "AIzaSyCbkaTCYvD0f4Ma-Y0JahziM1iXuWtYxcg")

try:
    print(f"Attempting to connect to imap.iitb.ac.in on port 993 for {LDAP_USER}...")
    with MailBox('imap.iitb.ac.in').login(LDAP_USER, TEMP_ACCESS_TOKEN, 'INBOX') as mailbox:
        print("Success: Connected and logged in!")
        print("\nFetching the last 3 email subjects as proof of connection:")
        for msg in list(mailbox.fetch(limit=3, reverse=True)):
            print(f"Subject: {msg.subject[:50]}... | Date: {msg.date}")
except Exception as e:
    print(f"\nConnection Failed: {e}")
