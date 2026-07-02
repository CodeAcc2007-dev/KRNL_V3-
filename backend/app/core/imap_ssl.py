import ssl


def imap_ssl_context() -> ssl.SSLContext:
    """SSL context for imap.iitb.ac.in.

    The server negotiates a legacy static-RSA cipher that OpenSSL 3's default
    security level (SECLEVEL=2) rejects with a handshake failure. Lowering to
    SECLEVEL=1 restores compatibility while keeping certificate verification on.
    """
    ctx = ssl.create_default_context()
    ctx.set_ciphers("DEFAULT@SECLEVEL=1")
    return ctx
