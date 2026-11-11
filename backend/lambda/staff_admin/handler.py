import json
import os
import re

import boto3
import botocore.exceptions

STAFF_USER_POOL_ID = os.environ["STAFF_USER_POOL_ID"]
cognito = boto3.client("cognito-idp")

# Deliberately loose: Cognito does the real validation; this only turns an
# obviously malformed address into a 400 before calling it.
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ClientError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def handler(event, _context):
    method = event.get("httpMethod")
    resource = event.get("resource")

    try:
        groups = get_groups(event)
        require_admin(groups)
        if method == "GET" and resource == "/api/admin/staff":
            return list_staff()
        if method == "POST" and resource == "/api/admin/staff":
            return create_staff(event)
        if method == "PUT" and resource == "/api/admin/staff/{username}/groups":
            return set_staff_groups(event)
        return response(404, {"message": "Not found"})
    except ClientError as exc:
        return response(exc.status_code, {"message": exc.message})


def get_groups(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    raw = claims.get("cognito:groups", "")
    return [g for g in raw.replace(",", " ").split() if g]


def require_admin(groups):
    if "admin" not in groups:
        raise ClientError(403, "Admin access required")


def list_known_groups():
    """Read live from Cognito rather than an env var so a group added via a
    CDK deploy or at runtime (rooms_admin's create_site) is immediately valid
    here with no redeploy of this function."""
    names = []
    kwargs = {"UserPoolId": STAFF_USER_POOL_ID, "Limit": 60}
    while True:
        result = cognito.list_groups(**kwargs)
        names.extend(g["GroupName"] for g in result.get("Groups", []))
        next_token = result.get("NextToken")
        if not next_token:
            break
        kwargs["NextToken"] = next_token
    return names


def list_staff():
    available_groups = list_known_groups()
    staff = []
    kwargs = {"UserPoolId": STAFF_USER_POOL_ID, "Limit": 60}
    while True:
        result = cognito.list_users(**kwargs)
        for user in result.get("Users", []):
            staff.append(describe_user(user))
        pagination_token = result.get("PaginationToken")
        if not pagination_token:
            break
        kwargs["PaginationToken"] = pagination_token
    return response(200, {"staff": staff, "availableGroups": available_groups})


def describe_user(user):
    username = user["Username"]
    attrs = {a["Name"]: a["Value"] for a in user.get("Attributes", [])}
    groups_result = cognito.admin_list_groups_for_user(UserPoolId=STAFF_USER_POOL_ID, Username=username)
    return {
        "username": username,
        "email": attrs.get("email", ""),
        "enabled": user.get("Enabled", False),
        "status": user.get("UserStatus", ""),
        "groups": sorted(g["GroupName"] for g in groups_result.get("Groups", [])),
    }


def create_staff(event):
    """Create a staff-pool user with Cognito's default invite (temporary
    password emailed; they set their own at first sign-in, which the login
    page's newPasswordRequired path handles) and add them to the chosen
    staff-<site> groups. Staff only: admin and checkin- groups are granted,
    if ever, through the existing groups editor."""
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        raise ClientError(400, "Request body must be JSON")
    if not isinstance(body, dict):
        raise ClientError(400, "Request body must be a JSON object")

    email = body.get("email")
    if not isinstance(email, str) or not EMAIL_RE.match(email.strip()):
        raise ClientError(400, "A valid email is required")
    # The pool signs in by email case-sensitively, so normalize to avoid two
    # accounts that differ only by case.
    email = email.strip().lower()

    groups = body.get("groups")
    if not isinstance(groups, list) or not all(isinstance(g, str) for g in groups):
        raise ClientError(400, "groups must be a list of group names")
    groups = sorted(set(groups))
    if not groups:
        raise ClientError(400, "Select at least one site")
    not_staff = [g for g in groups if not g.startswith("staff-")]
    if not_staff:
        raise ClientError(400, f"Only staff site groups can be granted here: {', '.join(not_staff)}")
    unknown = sorted(set(groups) - set(list_known_groups()))
    if unknown:
        raise ClientError(400, f"Unknown group(s): {', '.join(unknown)}")

    # The pool's username attribute is email, so Username takes the email
    # and Cognito assigns the actual (machine-generated) username.
    try:
        created = cognito.admin_create_user(
            UserPoolId=STAFF_USER_POOL_ID,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
            DesiredDeliveryMediums=["EMAIL"],
        )
    except cognito.exceptions.UsernameExistsException:
        raise ClientError(409, "A staff account with this email already exists")
    except cognito.exceptions.InvalidParameterException as exc:
        raise ClientError(400, exc.response.get("Error", {}).get("Message", "Invalid email"))

    user = created["User"]
    try:
        for group in groups:
            cognito.admin_add_user_to_group(UserPoolId=STAFF_USER_POOL_ID, Username=user["Username"], GroupName=group)
    except botocore.exceptions.ClientError:
        raise ClientError(
            500,
            f"The account for {email} was created and the invite sent, but granting site access failed. "
            "Set their access from the staff list.",
        )
    return response(201, describe_user(user))


def set_staff_groups(event):
    username = event["pathParameters"]["username"]
    body = json.loads(event.get("body") or "{}")
    desired = body.get("groups")
    if not isinstance(desired, list) or not all(isinstance(g, str) for g in desired):
        raise ClientError(400, "groups must be a list of group names")

    known_groups = set(list_known_groups())
    unknown = sorted(set(desired) - known_groups)
    if unknown:
        raise ClientError(400, f"Unknown group(s): {', '.join(unknown)}")

    try:
        current_result = cognito.admin_list_groups_for_user(UserPoolId=STAFF_USER_POOL_ID, Username=username)
    except cognito.exceptions.UserNotFoundException:
        raise ClientError(404, "Staff user not found")

    current = {g["GroupName"] for g in current_result.get("Groups", [])}
    desired_set = set(desired)

    for group in desired_set - current:
        cognito.admin_add_user_to_group(UserPoolId=STAFF_USER_POOL_ID, Username=username, GroupName=group)
    for group in current - desired_set:
        cognito.admin_remove_user_from_group(UserPoolId=STAFF_USER_POOL_ID, Username=username, GroupName=group)

    updated = cognito.admin_list_groups_for_user(UserPoolId=STAFF_USER_POOL_ID, Username=username)
    return response(200, {"username": username, "groups": sorted(g["GroupName"] for g in updated.get("Groups", []))})


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body, default=str),
    }
