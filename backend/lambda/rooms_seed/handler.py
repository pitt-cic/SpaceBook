import os
from datetime import datetime, timezone

import boto3

dynamodb = boto3.resource("dynamodb")
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
SITES_TABLE = os.environ["SITES_TABLE"]

# Label/color mirror frontend/src/config/sites.ts's SITES fallback so the
# seeded row matches what the frontend shows for Homewood when no live label
# is available. Only used for sites seeded by this custom resource, today just
# "homewood" — see the Site() ResourceProperty in data-constructs.ts.
SITE_DEFAULTS = {
    "homewood": {"label": "Homewood CEC", "color": "#003594"},
}

# The initial Homewood CEC room catalog. Overwritten on every run of this
# custom resource; admins manage rooms at runtime via rooms_admin after that.
HOMEWOOD_ROOMS = [
    {"id": "r1", "floor": "Lower Level", "area": "Center", "name": "Science Lab 002", "capacity": 30,
     "equipment": ["Projector", "Screen", "Whiteboard", "Computer"], "setups": ["Classroom", "Boardroom", "Open Floor"],
     "restrictions": [], "emoji": "🔬"},
    {"id": "r2", "floor": "Lower Level", "area": "Center", "name": "Computer Lab 003", "capacity": 25,
     "equipment": ["Computer", "Projector", "Screen", "Whiteboard"], "setups": ["Classroom"],
     "restrictions": ["No Food or Beverages Allowed"], "emoji": "💻"},
    {"id": "r3", "floor": "Lower Level", "area": "Left", "name": "Lower Level Conference Room 006", "capacity": 10,
     "equipment": ["Whiteboard"], "setups": ["Boardroom"], "restrictions": [], "emoji": "🗣️"},
    {"id": "r4", "floor": "Lower Level", "area": "Left", "name": "Lower Level Conference Room 020", "capacity": 18,
     "equipment": ["Projector", "Screen", "Whiteboard"], "setups": ["Boardroom", "Classroom"], "restrictions": [],
     "emoji": "🗣️"},
    {"id": "r5", "floor": "1st Floor", "area": "Right", "name": "Classroom 103", "capacity": 72,
     "equipment": ["Projector", "Screen", "Whiteboard", "Video Conferencing", "Microphone"],
     "setups": ["Classroom", "Theatre", "Boardroom"], "restrictions": [], "emoji": "🎓"},
    {"id": "r6", "floor": "1st Floor", "area": "Left", "name": "First Floor Conference Room 114", "capacity": 10,
     "equipment": ["Projector", "Screen", "Whiteboard", "Video Conferencing"], "setups": ["Boardroom"],
     "restrictions": [], "emoji": "🗣️"},
    {"id": "r7", "floor": "Lower Level", "area": "Left", "name": "School of Education Classroom 011", "capacity": 35,
     "equipment": ["Projector", "Screen", "Whiteboard"], "setups": ["Classroom", "Boardroom"], "restrictions": [],
     "emoji": "📚"},
    {"id": "r13", "floor": "Lower Level", "area": "Center-Left", "name": "Seminar/Employee Room 009", "capacity": 9,
     "equipment": ["Whiteboard", "Projector"], "setups": ["Classroom", "Boardroom"], "restrictions": [], "emoji": "👥"},
    {"id": "r18", "floor": "Lower Level", "area": "Left", "name": "Conf. Room 19E", "capacity": 6,
     "equipment": ["Whiteboard"], "setups": ["Classroom", "Boardroom"], "restrictions": [], "emoji": "🗣️"},
    {"id": "r8", "floor": "Lower Level", "area": "Left · Med & Ed Wing",
     "name": "Medication & Education Wellness Center - Office 1 (018A)", "capacity": 6,
     "equipment": ["Computer", "Whiteboard"], "setups": ["Boardroom"], "restrictions": [], "emoji": "🏥"},
    {"id": "r9", "floor": "Lower Level", "area": "Left · Med & Ed Wing",
     "name": "Medication & Education Wellness Center - Conference Room (018B)", "capacity": 20,
     "equipment": ["Projector", "Screen", "Whiteboard", "Video Conferencing"], "setups": ["Boardroom", "Classroom"],
     "restrictions": [], "emoji": "🏥"},
    {"id": "r16", "floor": "Lower Level", "area": "Left · Med & Ed Wing",
     "name": "Medication & Education Wellness Center - Office 2 (018C)", "capacity": 4,
     "equipment": ["Computer", "Whiteboard"], "setups": ["Boardroom"], "restrictions": [], "emoji": "🏥"},
    {"id": "r17", "floor": "Lower Level", "area": "Left · Med & Ed Wing",
     "name": "Medication & Education Wellness Center - Office 3 (018D)", "capacity": 4,
     "equipment": ["Computer", "Whiteboard"], "setups": ["Boardroom"], "restrictions": [], "emoji": "🏥"},
    {"id": "r12", "floor": "1st Floor", "area": "Left · SHRS Pavilion",
     "name": "SHRS Wellness Pavilion - Conference/Open Floor Space (122)", "capacity": 50,
     "equipment": ["Projector", "Screen", "Microphone"], "setups": ["Theatre", "Open Floor", "Classroom"],
     "restrictions": [], "emoji": "🏛️"},
    {"id": "r10", "floor": "1st Floor", "area": "Left · SHRS Pavilion",
     "name": "SHRS Wellness Pavilion - Kitchen (122A)", "capacity": 10,
     "equipment": ["Kitchen Facilities"], "setups": ["Open Floor"], "restrictions": [], "emoji": "🍳"},
    {"id": "r11", "floor": "1st Floor", "area": "Left · SHRS Pavilion",
     "name": "SHRS Wellness Pavilion - Office 1 (122B)", "capacity": 2,
     "equipment": ["Computer", "Whiteboard"], "setups": ["Open Floor"], "restrictions": [], "emoji": "🏢"},
    {"id": "r19", "floor": "1st Floor", "area": "Left · SHRS Pavilion",
     "name": "SHRS Wellness Pavilion - Office 2 (122C)", "capacity": 2,
     "equipment": ["Computer", "Whiteboard"], "setups": ["Open Floor"], "restrictions": [], "emoji": "🏢"},
    {"id": "r20", "floor": "1st Floor", "area": "Left · SHRS Pavilion",
     "name": "SHRS Wellness Pavilion - Office 3 (122D)", "capacity": 2,
     "equipment": ["Computer", "Whiteboard"], "setups": ["Open Floor"], "restrictions": [], "emoji": "🏢"},
]


def handler(event, _context):
    request_type = event.get("RequestType")
    site = event.get("ResourceProperties", {}).get("Site", "homewood")

    if request_type in ("Create", "Update"):
        seed_rooms(site)
        seed_site(site)

    return {"PhysicalResourceId": f"rooms-seed-{site}", "Data": {}}


def seed_rooms(site):
    table = dynamodb.Table(ROOMS_TABLE)
    with table.batch_writer() as batch:
        for room in HOMEWOOD_ROOMS:
            item = dict(room)
            room_id = item.pop("id")
            item["PK"] = f"SITE#{site}"
            item["SK"] = f"ROOM#{room_id}"
            item["id"] = room_id
            batch.put_item(Item=item)


def seed_site(site):
    # Conditional on non-existence, unlike seed_rooms above — this custom
    # resource re-runs on every `cdk deploy` (Create/Update), and an admin
    # can now edit a site's label/color/active via PUT /api/sites/{site}
    # (rooms_admin/handler.py). An unconditional put here would silently
    # revert that edit back to these defaults on the next deploy.
    table = dynamodb.Table(SITES_TABLE)
    defaults = SITE_DEFAULTS.get(site, {"label": site.title(), "color": "#6B7280"})
    now = datetime.now(timezone.utc).isoformat()
    try:
        table.put_item(
            Item={
                "PK": f"SITE#{site}",
                "SK": "CONFIG",
                "id": site,
                "label": defaults["label"],
                "color": defaults["color"],
                "active": True,
                "createdBy": "system",
                "createdAt": now,
                "updatedBy": "system",
                "updatedAt": now,
            },
            ConditionExpression="attribute_not_exists(PK)",
        )
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        pass
