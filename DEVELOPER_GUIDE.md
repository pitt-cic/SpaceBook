# Developer Guide

This guide covers setup, testing, and deployment.

## Prerequisites

### Python 3.13
- Matches the Lambda runtime (`infra/lib/lambda-utils.ts`). 3.12 also works for running tests.
- Download from [python.org](https://www.python.org/downloads/), Homebrew (`brew install python@3.13`),
  or use `uv`.
- Verify: `python3.13 --version`

### Node.js 24
- Download from [nodejs.org](https://nodejs.org/) or use a version manager like `nvm`
- Verify: `node --version`

### Docker (optional)
- Lambda bundling tries a local `pip3 install` first and only falls back to Docker if that
  fails, so Docker isn't required on a machine with a working `pip3`.
- Download from [docker.com](https://www.docker.com/get-started); make sure the daemon is running.

### AWS CDK + AWS CLI
- `npm install -g aws-cdk` (or use `npx cdk`, which the project's `node_modules` provides)
- AWS CLI v2, configured with credentials (below)

## AWS Credentials Setup

### Configure SSO Profile (One-Time Setup)

```bash
aws configure sso
```

You will be prompted for:
- **SSO session name**: A name for this SSO session
- **SSO start URL**: Your organization's SSO portal URL (e.g., `https://my-org.awsapps.com/start`)
- **SSO region**: Region where SSO is configured
- **SSO registration scopes**: Press enter for default

Then select your AWS account and role from the list.

### Login to SSO

```bash
aws sso login --profile <profile-name>
```

### Using the Profile

```bash
export AWS_PROFILE=<profile-name>     # for the current shell
npx cdk deploy --profile <profile-name> ...   # or per command
```

### Verifying Credentials

```bash
aws sts get-caller-identity
```

## Stages and stack names

Every deploy needs these CDK context values:

| Context | Values | Required |
|---|---|---|
| `stageName` | `dev`, `beta`, `prod` | always |
| `devName` | your name, e.g. `alice` | for `dev` and `beta` |
| `sesSenderEmail` | the From address for sign-in codes and notifications, verified in SES | always (or set `SES_SENDER_EMAIL`) |

The stack is named `SpaceBook-stack-<devName>-<stageName>` (e.g. `SpaceBook-stack-alice-dev`),
or `SpaceBook-stack-prod` for prod. Every named resource (tables, Cognito pools, Lambdas, the
Amplify app, the API) gets the same `<devName>-<stageName>` suffix, so each developer can run
their own full copy in the shared account without collisions.

- Running `cdk` without `-c stageName=…` or a sender email fails. That's expected. There's no
  default sender: use an address (or domain) verified in SES in the account and region you deploy to.
- DynamoDB Bookings/Rooms/Sites tables are **retained** when a stack is destroyed, in every stage.
  If you destroy and redeploy the same stack name, delete the leftover tables first, or the
  deploy will fail on name conflicts.
- Cognito pools are deleted with non-prod stacks and retained for prod.
- The old `MeetingBookingInfraStack-beta` stack predates this naming scheme. This code no longer
  deploys to it.

## Local checks

Run these before deploying:

```bash
# Infra: compile, lint, CDK assertion tests, synth
cd infra
npm install
npm run build && npm run lint && npm test
npx cdk synth -c stageName=dev -c devName=<yourname> -c sesSenderEmail=<sender>

# Backend: pytest (moto-mocked AWS; no real AWS calls)
cd ..
python3.13 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements-dev.txt
python -m pytest backend/tests

# Frontend: typecheck + production build
cd frontend
npm install
npm run build
```

The tests force dummy AWS credentials (`backend/tests/conftest.py`), so they run the same whether
or not you have an AWS profile exported, and never touch real AWS.

The Playwright e2e and Vitest unit tests, and the CI workflow that runs all of the above, are on
the `testing` branch and not yet merged into `main`.

## Infrastructure Deployment

### Using the Deployment Script (Recommended)

```bash
cd infra
npm run deploy -- --stage-name dev --dev-name <yourname>    # your personal dev stack
npm run deploy -- --stage-name beta --dev-name <yourname>   # a beta stack
npm run deploy -- --stage-name prod                         # prod
```

The script checks prerequisites (Node, npm, AWS CLI, credentials), resolves the SES sender email,
installs dependencies, builds TypeScript, runs `cdk bootstrap`, then deploys
`SpaceBook-stack-<devName>-<stageName>`.

The sender email comes from `--ses-sender-email`, then `SES_SENDER_EMAIL` (shell or `infra/.env`),
then the existing stack's `SesSenderEmail` output. If none is set (a new stack, or one deployed
before this output existed), the script asks for it. It warns if SES hasn't verified the address
or its domain, since sign-in codes won't send until it has.

```bash
--stage-name NAME         # dev, beta, or prod (default: beta)
--dev-name NAME           # required for dev/beta
--ses-sender-email EMAIL  # SES-verified From address (asked for if not otherwise set)
--skip-bootstrap          # skip cdk bootstrap (after the first deploy in an account/region)
--require-approval LEVEL  # never, any-change, or broadening (default: broadening)
--help
```

### Manual Deployment

```bash
cd infra
npm install
npm run build
npx cdk bootstrap                                        # first time only, per account/region
npx cdk deploy -c stageName=dev -c devName=<yourname> -c sesSenderEmail=<sender>    # or -c stageName=prod
```

### Useful CDK Commands

```bash
export SES_SENDER_EMAIL=<sender>                         # or add -c sesSenderEmail=<sender> to each
npx cdk diff    -c stageName=dev -c devName=<yourname>   # preview changes
npx cdk list    -c stageName=dev -c devName=<yourname>   # show the resolved stack name
npx cdk synth   -c stageName=dev -c devName=<yourname>   # synthesize CloudFormation
npx cdk destroy -c stageName=dev -c devName=<yourname>   # tear down (tables are retained)
```

After deploying infra, run `npm run setup-dev` in `frontend/` again (below) so your `.env`
picks up any new outputs.

## Frontend Deployment

The frontend deploys to AWS Amplify Hosting. The stack's infrastructure must already be deployed,
since the script reads the Amplify app id from its CloudFormation outputs. Frontend-only changes
don't need a CDK deploy.

```bash
cd frontend
npm run deploy -- --stage-name dev --dev-name <yourname>
npm run deploy -- --stage-name prod
```

The script:
1. Checks prerequisites (AWS CLI, credentials, zip, curl)
2. Resolves `SpaceBook-stack-<devName>-<stageName>` and reads its `AmplifyAppId` output
3. Builds the frontend
4. Creates and uploads the deployment package
5. Waits for the Amplify deployment and prints the app URL (`https://main.<appId>.amplifyapp.com`)

### Script Options

```bash
--stage-name NAME   # dev, beta, or prod (default: beta)
--dev-name NAME     # required for dev/beta
--branch NAME       # Amplify branch (default: main)
--skip-build        # use the existing dist/
--no-wait           # don't wait for the deployment to finish
--help
```

### Manual Deployment

```bash
cd frontend
npm install
npm run build

AMPLIFY_APP_ID=$(aws cloudformation describe-stacks \
    --stack-name SpaceBook-stack-<yourname>-dev \
    --query "Stacks[0].Outputs[?OutputKey=='AmplifyAppId'].OutputValue" \
    --output text)

cd dist && zip -r /tmp/deploy.zip . && cd ..

# Returns a zipUploadUrl and jobId
aws amplify create-deployment --app-id $AMPLIFY_APP_ID --branch-name main

curl --request PUT --upload-file /tmp/deploy.zip "<zipUploadUrl>"

aws amplify start-deployment --app-id $AMPLIFY_APP_ID --branch-name main --job-id <jobId>
```

## Local Development

```bash
cd frontend

# Write .env from your stack's CloudFormation outputs (API URL, both Cognito pools, region)
npm run setup-dev -- --stage-name dev --dev-name <yourname>

# Or skip AWS and keep an existing .env (see .env.example for the variables)
npm run setup-dev -- --skip-env

npm run dev                          # http://localhost:5173
npm run build && npm run preview     # preview the production build
```

The dev server talks to the **deployed** API and Cognito pools of whichever stack `.env` points
at. There's no local backend emulator.

### Signing in

- **Staff/admin (Pool A)**: Cognito accounts in your stack's staff pool. Create admins there
  directly (AWS console or `aws cognito-idp admin-create-user`) and add them to the `admin`
  group. After that, an admin can invite staff from the app's **Staff Access** page
  (**New staff user**: Cognito emails a temporary password, and they set their own at first
  sign-in) and grant or revoke `staff-<site>`/`checkin-<site>` access there.
- **Requestors (Pool B)**: passwordless. Submit a request with an email address, then sign in to
  **My Requests** with the one-time code sent to that email (submitting creates the
  requestor account). SES must be able to send from the sender address you gave at deploy
  time (the stack's `SesSenderEmail` output).

Keep credentials out of committed files. Put e2e test credentials in `frontend/.env.e2e`, which is
gitignored.

## Calendar Invites (optional)

When a booking is confirmed or cancelled, SpaceBook can email a standard iCalendar invite so the event appears in (or
disappears from) Outlook or Google Calendar. It uses only Amazon SES and the `notify` Lambda's IAM role: no Microsoft
Graph, Azure app, or API keys. Invites are **off by default**. To turn them on, copy `infra/.env.example` to
`infra/.env`, set `CALENDAR_INVITES_ENABLED=true`, and redeploy the infrastructure.

### Who gets it

- **The requester** (the booking's contact email). Their copy *is* their usual "Request approved" /
  "Cancellation confirmed" email, so they get one email, not two.
- **The staff member who approved it**: whoever clicked Approve, sent the counter-proposal the requester accepted, or
  created the booking on **New Booking**.
- **Optionally, a CEC calendar mailbox** (`CALENDAR_INVITE_RECIPIENT`), if the center wants one calendar with every
  booking. Unset by default.

Each person gets their own copy listing only themselves as attendee, so nobody sees anyone else's address.

### When it's sent

| Booking change                                                     | Invite                                                |
|:-------------------------------------------------------------------|:------------------------------------------------------|
| Staff approve a request                                            | `METHOD:REQUEST`                                      |
| Requestor accepts a counter-proposal (final room/time)             | `METHOD:REQUEST`                                      |
| Staff create a booking on **New Booking**                          | `METHOD:REQUEST`, one per date                        |
| Staff confirm a cancellation of a booking that was on the calendar | `METHOD:CANCEL`, `STATUS:CANCELLED`, `SEQUENCE` + 1   |

Pending requests, denials, counter-proposals, and declined counter-proposals send nothing beyond the existing emails.
A requestor's cancellation request leaves the event in place until staff confirm it.

- **One event per booking date.** A recurring request is already stored as one booking per date, each approved on its
  own, so each date is its own event (UID `booking-<request id>@<uid domain>`) rather than an `RRULE`. The downside: a
  long series means one email per date for each recipient.
- **`SEQUENCE`** is stored on the booking (`calendarSequence`) and bumped in the same database write that changes the
  booking. Retries and resends reuse the same UID and `SEQUENCE`, so calendars treat them as the same event, not new
  meetings.
- **Times** are `America/New_York` (`CALENDAR_TIMEZONE`) with a `VTIMEZONE` block. The event spans the actual event
  time. Setup and cleanup are listed in the description.
- **Contents:** title (`SUMMARY`), site and room (`LOCATION`), and organization, event/activity type, headcount, tech
  needs, setup/cleanup, and booking ID in `DESCRIPTION`. Staff and mailbox copies also get a staff-page link if
  `SPACEBOOK_APP_URL` is set. The requester's name, phone, free-text notes, and whether minors attend are **never**
  included.
- **Email:** a text body, a `text/calendar; method=…; charset=UTF-8` part, and `invite.ics` attached. `ORGANIZER` is
  the sender address.
- **Reliability:** queuing an invite is asynchronous and can't fail the approval that triggered it. Failed sends are
  retried automatically (Lambda async retries). Staff see the latest result ("Sent", or "Failed" with the error) and a
  **Resend invite** button in the booking's detail panel.

Set these in `infra/.env` (copy `infra/.env.example`) or your shell before deploying. They become Lambda environment
variables, and nothing is hardcoded. Only the first is needed.

| Variable                              | Default                                 | Meaning                                                                       |
|:--------------------------------------|:----------------------------------------|:------------------------------------------------------------------------------|
| `CALENDAR_INVITES_ENABLED`            | `false`                                 | `true` to send invites.                                                       |
| `CALENDAR_INVITE_FROM`                | the app's SES sender (`SES_SENDER_EMAIL`) | Organizer and sender. Must be SES-verified, on a domain with SPF/DKIM.      |
| `CALENDAR_UID_DOMAIN`                 | the sender's domain                     | Domain part of each event UID. Don't change it once in use.                   |
| `CALENDAR_INVITE_RECIPIENT`           | none                                    | Optional CEC calendar mailbox that also gets every invite.                    |
| `CALENDAR_INVITE_RECIPIENT_OVERRIDES` | none                                    | JSON `{"<site id>": "<mailbox>"}` for sites with their own mailbox.           |
| `CALENDAR_TIMEZONE`                   | `America/New_York`                      | Timezone of booking times.                                                    |
| `SPACEBOOK_APP_URL`                   | none                                    | Base URL for the staff link in staff/mailbox copies.                          |

Bookings approved before invites were turned on aren't backfilled. A staff member can add one by calling
`POST /api/requests/{id}/resend-invite`. The **Resend invite** button only appears on bookings already sent to the
calendar. Counter-proposals sent before this feature have no recorded proposer, so when one is accepted only the
requester gets the invite.

### Email delivery requirements

- **SES production access.** In the SES sandbox, every recipient (requesters included) must be a verified address.
  Request production access before go-live, which the regular approval emails need anyway.
- **Sender authentication:** the sender's domain needs SPF that includes Amazon SES and DKIM signing (SES Easy DKIM,
  or the university's own). Otherwise invites land in spam or are rejected.
- **Pitt Exchange:** if `CALENDAR_INVITE_FROM` is outside Pitt's tenant, IT may need to allow it as a sender so
  invites reach staff inboxes rather than quarantine.

### Optional CEC mailbox: what IT needs to do

Only if `CALENDAR_INVITE_RECIPIENT` is used:

1. **Create the mailbox:** an Exchange Online shared or resource mailbox for the CEC calendar, and give CEC staff
   access to its calendar.
2. **Let SpaceBook's sender through:** add `CALENDAR_INVITE_FROM` to the mailbox's allowed senders (or exempt it in a
   mail-flow rule) so it isn't blocked as an external sender.
3. **Auto-process meeting requests**, so invites land on the calendar without someone clicking Accept:
   ```powershell
   Set-CalendarProcessing -Identity <cec-calendar-mailbox> `
     -AutomateProcessing AutoAccept `
     -ProcessExternalMeetingMessages $true `
     -AllowConflicts $true `
     -DeleteComments $false -DeleteSubject $false -AddOrganizerToSubject $false
   ```
   `ProcessExternalMeetingMessages` is needed because the organizer is outside the tenant. `AllowConflicts` is needed
   because one calendar holds every room's bookings.
