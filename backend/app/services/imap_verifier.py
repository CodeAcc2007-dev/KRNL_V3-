from imap_tools import MailBox

def verify_imap_connection(username: str, token: str) -> bool:
    """
    Synchronously tests connection and login credentials on the IIT Bombay IMAP server.
    Raises ValueError with a clear reason if the connection or login fails.
    """
    try:
        # Using context manager ensures connection sockets are closed cleanly
        with MailBox('imap.iitb.ac.in') as mailbox:
            mailbox.login(username, token, 'INBOX')
        return True
    except Exception as e:
        error_msg = str(e)
        if "login" in error_msg.lower() or "auth" in error_msg.lower() or "credential" in error_msg.lower() or "no" in error_msg:
            raise ValueError("Invalid credentials")
        elif "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
            raise ValueError("IMAP server connection timed out")
        else:
            raise ValueError(f"IMAP server connection failed: {error_msg}")
