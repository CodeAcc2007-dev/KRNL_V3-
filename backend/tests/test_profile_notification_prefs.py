from app.schemas.profile import ProfileUpdate, ProfileResponse


def test_update_accepts_notification_prefs():
    u = ProfileUpdate(notification_prefs={"master": True, "digest": False})
    assert u.notification_prefs == {"master": True, "digest": False}


def test_response_defaults_prefs():
    r = ProfileResponse(user_name="X", interests="", roll_number="", primary_department="")
    assert r.notification_prefs == {"master": True, "important": True, "reminders": True, "digest": True}
