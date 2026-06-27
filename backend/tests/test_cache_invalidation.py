"""invalidate_user_cache must delete only the target user's cached answers."""
import app.services.semantic_cache as sc


class FakeRedis:
    def __init__(self):
        self.store = {}

    def keys(self, pattern):
        prefix = pattern.rstrip("*")
        return [k for k in self.store if k.startswith(prefix)]

    def delete(self, *keys):
        n = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                n += 1
        return n


def test_deletes_only_target_user_keys(monkeypatch):
    fake = FakeRedis()
    fake.store = {
        "cache:userA:q1": "x",
        "cache:userA:q2": "y",
        "cache:userB:q1": "z",
    }
    monkeypatch.setattr(sc, "redis_client", fake)

    deleted = sc.invalidate_user_cache("userA")

    assert deleted == 2
    assert set(fake.store) == {"cache:userB:q1"}


def test_no_keys_is_a_noop(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(sc, "redis_client", fake)
    assert sc.invalidate_user_cache("ghost") == 0
