import importlib

staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")
requestor_handler = importlib.import_module("backend.lambda.requests_requestor.handler")


def test_compute_slot_keys_covers_15_minute_increments():
    keys = staff_handler.compute_slot_keys("r5", "2026-07-14", "09:00", "09:45")
    assert keys == [
        "SLOT#r5#2026-07-14#0900",
        "SLOT#r5#2026-07-14#0915",
        "SLOT#r5#2026-07-14#0930",
    ]


def test_compute_slot_keys_excludes_the_end_boundary():
    # Half-open interval semantics: a booking
    # ending at 10:00 does not lock the 10:00 slot for the next booking.
    keys = staff_handler.compute_slot_keys("r5", "2026-07-14", "09:00", "10:00")
    assert keys[-1] == "SLOT#r5#2026-07-14#0945"
    assert "SLOT#r5#2026-07-14#1000" not in keys


def test_requests_staff_and_requestor_agree_on_slot_keys():
    args = ("r7", "2026-07-14", "13:00", "14:00")
    assert staff_handler.compute_slot_keys(*args) == requestor_handler.compute_slot_keys(*args)
