"""One-off: generate a VAPID keypair for Web Push. Prints .env-ready values."""
import base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization


def main():
    priv = ec.generate_private_key(ec.SECP256R1())
    pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    pub_point = priv.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    app_server_key = base64.urlsafe_b64encode(pub_point).rstrip(b"=").decode()

    print("VAPID_PUBLIC_KEY=" + app_server_key)
    print("VAPID_PRIVATE_KEY=" + pem.replace("\n", "\\n"))
    print('VAPID_SUBJECT=mailto:admin@example.com')


if __name__ == "__main__":
    main()
