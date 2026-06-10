from cryptography.fernet import Fernet
from app.core.config import settings

# Initialize Fernet with base64 encoded encryption key from config
fernet = Fernet(settings.ENCRYPTION_KEY.encode() if isinstance(settings.ENCRYPTION_KEY, str) else settings.ENCRYPTION_KEY)

def encrypt_token(plain_text: str) -> str:
    """
    Encrypts a plain-text token string and returns the encrypted string representation.
    """
    if not plain_text:
        return ""
    encrypted_bytes = fernet.encrypt(plain_text.encode("utf-8"))
    return encrypted_bytes.decode("utf-8")

def decrypt_token(encrypted_str: str) -> str:
    """
    Decrypts an encrypted token string and returns the original plain-text token string.
    """
    if not encrypted_str:
        return ""
    decrypted_bytes = fernet.decrypt(encrypted_str.encode("utf-8"))
    return decrypted_bytes.decode("utf-8")
