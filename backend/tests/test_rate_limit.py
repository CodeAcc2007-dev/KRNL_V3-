"""allow_request: fixed-window per-key limiter, fails open if Redis is down."""
import app.core.rate_limit as rl


class FakeRedis:
    def __init__(self):
        self.counts = {}
        self.expires = {}

    def incr(self, key):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    def expire(self, key, seconds):
        self.expires[key] = seconds
        return True


class BrokenRedis:
    def incr(self, key):
        raise ConnectionError("redis down")


def test_first_request_in_window_is_allowed(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(rl, "redis_client", fake)

    assert rl.allow_request("ratelimit:sync:userA", limit=1, window_seconds=60) is True
    # window TTL is set on the first hit only
    assert fake.expires["ratelimit:sync:userA"] == 60


def test_request_over_limit_is_rejected(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(rl, "redis_client", fake)

    assert rl.allow_request("k", limit=1, window_seconds=60) is True
    assert rl.allow_request("k", limit=1, window_seconds=60) is False


def test_keys_are_independent(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(rl, "redis_client", fake)

    assert rl.allow_request("ratelimit:sync:userA", limit=1, window_seconds=60) is True
    assert rl.allow_request("ratelimit:sync:userB", limit=1, window_seconds=60) is True


def test_ttl_set_only_on_first_hit(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(rl, "redis_client", fake)

    rl.allow_request("k", limit=5, window_seconds=60)
    fake.expires["k"] = 999  # simulate a partially elapsed window
    rl.allow_request("k", limit=5, window_seconds=60)

    assert fake.expires["k"] == 999  # second hit must not reset the TTL


def test_fails_open_when_redis_errors(monkeypatch):
    monkeypatch.setattr(rl, "redis_client", BrokenRedis())

    # a Redis outage must not block a legitimate sync
    assert rl.allow_request("k", limit=1, window_seconds=60) is True
