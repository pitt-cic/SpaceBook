import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import {Construct} from 'constructs';
import {pythonFunction} from './lambda-utils';

export interface ComputeConstructsProps {
    bookingsTable: dynamodb.Table;
    roomsTable: dynamodb.Table;
    sitesTable: dynamodb.Table;
    visitorsCheckinsTable: dynamodb.Table;
    calendarFeedsTable: dynamodb.Table;
    staffUserPool: cognito.UserPool;
    requestorUserPool: cognito.UserPool;
    roomPhotosBucket: s3.Bucket;
    roomPhotosDomain: string;
    sesSenderEmail: string;
    /** CALENDAR_* Lambda env vars from calendarInviteEnvironment() (infra-stack.ts). */
    calendarInviteEnvironment: Record<string, string>;
    stage: string;
}

/**
 * The domain-grouped Lambda functions (public, requestor, staff, and admin
 * groups), each its own directory/deployable unit under
 * backend/lambda/, each with an IAM role scoped to only the trust boundary
 * that function needs.
 */
export class ComputeConstructs extends Construct {
    public readonly notifyFunction: lambda.Function;
    public readonly requestsPublicFunction: lambda.Function;
    public readonly requestsRequestorFunction: lambda.Function;
    public readonly requestsStaffFunction: lambda.Function;
    public readonly roomsFunction: lambda.Function;
    public readonly roomsAdminFunction: lambda.Function;
    public readonly staffAdminFunction: lambda.Function;
    public readonly checkinFunction: lambda.Function;
    public readonly calendarFeedFunction: lambda.Function;

    constructor(scope: Construct, id: string, props: ComputeConstructsProps) {
        super(scope, id);

        const {stage} = props;

        // notify — internal only, no API Gateway route. SES send only, plus
        // what calendar invites need: room/site names for LOCATION, and
        // UpdateItem to record each invite's result on its booking.
        const invitesEnabled = {
            CALENDAR_INVITES_ENABLED: props.calendarInviteEnvironment.CALENDAR_INVITES_ENABLED,
        };
        this.notifyFunction = pythonFunction(this, 'NotifyFunction', {
            dirName: 'notify',
            handler: 'handler.handler',
            functionName: `notify-${stage}`,
            environment: {
                SES_SENDER_EMAIL: props.sesSenderEmail,
                BOOKINGS_TABLE: props.bookingsTable.tableName,
                ROOMS_TABLE: props.roomsTable.tableName,
                SITES_TABLE: props.sitesTable.tableName,
                ...props.calendarInviteEnvironment,
            },
        });
        this.notifyFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: ['*'],
        }));
        props.bookingsTable.grant(this.notifyFunction, 'dynamodb:UpdateItem');
        props.roomsTable.grantReadData(this.notifyFunction);
        props.sitesTable.grantReadData(this.notifyFunction);

        // requests_public — no auth; submit, availability, public status lookup.
        // Provisions a Pool B user at submission time so OTP login works later.
        this.requestsPublicFunction = pythonFunction(this, 'RequestsPublicFunction', {
            dirName: 'requests_public',
            handler: 'handler.handler',
            functionName: `requests-public-${stage}`,
            environment: {
                BOOKINGS_TABLE: props.bookingsTable.tableName,
                NOTIFY_FUNCTION_NAME: this.notifyFunction.functionName,
                REQUESTOR_USER_POOL_ID: props.requestorUserPool.userPoolId,
                SITES_TABLE: props.sitesTable.tableName,
                // Read-only: rejects submissions that name a hidden (staff-only) room.
                ROOMS_TABLE: props.roomsTable.tableName,
            },
        });
        props.bookingsTable.grantReadWriteData(this.requestsPublicFunction);
        props.sitesTable.grantReadData(this.requestsPublicFunction);
        props.roomsTable.grantReadData(this.requestsPublicFunction);
        this.notifyFunction.grantInvoke(this.requestsPublicFunction);
        this.requestsPublicFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['cognito-idp:AdminCreateUser'],
            resources: [props.requestorUserPool.userPoolArn],
        }));

        // requests_requestor — Pool B JWT; read/write scoped to the caller's own
        // requests (enforced in-Lambda via GSI3 ByRequestorEmail + email match).
        this.requestsRequestorFunction = pythonFunction(this, 'RequestsRequestorFunction', {
            dirName: 'requests_requestor',
            handler: 'handler.handler',
            functionName: `requests-requestor-${stage}`,
            environment: {
                BOOKINGS_TABLE: props.bookingsTable.tableName,
                NOTIFY_FUNCTION_NAME: this.notifyFunction.functionName,
                ...invitesEnabled,
            },
        });
        props.bookingsTable.grantReadWriteData(this.requestsRequestorFunction);
        this.notifyFunction.grantInvoke(this.requestsRequestorFunction);

        // requests_staff — Pool A JWT; full R/W on Bookings within the caller's
        // site (or any site for admin), enforced in-Lambda.
        // Also reads Sites table for dashboard_sites() to list all active sites
        // for admin users, and Rooms to
        // validate the room staff assign on approve.
        this.requestsStaffFunction = pythonFunction(this, 'RequestsStaffFunction', {
            dirName: 'requests_staff',
            handler: 'handler.handler',
            functionName: `requests-staff-${stage}`,
            environment: {
                BOOKINGS_TABLE: props.bookingsTable.tableName,
                ROOMS_TABLE: props.roomsTable.tableName,
                SITES_TABLE: props.sitesTable.tableName,
                NOTIFY_FUNCTION_NAME: this.notifyFunction.functionName,
                ...invitesEnabled,
            },
        });
        props.bookingsTable.grantReadWriteData(this.requestsStaffFunction);
        props.roomsTable.grantReadData(this.requestsStaffFunction);
        props.sitesTable.grantReadData(this.requestsStaffFunction);
        this.notifyFunction.grantInvoke(this.requestsStaffFunction);

        // rooms — public read of the room catalog.
        this.roomsFunction = pythonFunction(this, 'RoomsFunction', {
            dirName: 'rooms',
            handler: 'handler.handler',
            functionName: `rooms-${stage}`,
            environment: {ROOMS_TABLE: props.roomsTable.tableName},
        });
        props.roomsTable.grantReadData(this.roomsFunction);

        // rooms_admin — admin-only room *and* site catalog CRUD
        // (create/edit/deactivate), a separate function from the public
        // `rooms` read path so that function's role never holds write access
        // (least privilege per trust boundary, not per route).
        // Site and room admin share this one function since they share the
        // identical admin-only trust boundary, even though sites also need
        // Cognito write access that rooms never did — see the CreateGroup
        // grant below.
        this.roomsAdminFunction = pythonFunction(this, 'RoomsAdminFunction', {
            dirName: 'rooms_admin',
            handler: 'handler.handler',
            functionName: `rooms-admin-${stage}`,
            environment: {
                ROOMS_TABLE: props.roomsTable.tableName,
                SITES_TABLE: props.sitesTable.tableName,
                STAFF_USER_POOL_ID: props.staffUserPool.userPoolId,
                ROOM_PHOTOS_BUCKET: props.roomPhotosBucket.bucketName,
                ROOM_PHOTOS_DOMAIN: props.roomPhotosDomain,
            },
        });
        props.roomsTable.grantReadWriteData(this.roomsAdminFunction);
        // Presigned upload POSTs are signed with this role, so it needs PutObject;
        // DeleteObject removes photos dropped from a room.
        props.roomPhotosBucket.grantPut(this.roomsAdminFunction, 'rooms/*');
        props.roomPhotosBucket.grantDelete(this.roomsAdminFunction, 'rooms/*');
        props.sitesTable.grantReadWriteData(this.roomsAdminFunction);
        // Runtime staff-<site>/checkin-<site> group creation for a newly
        // created site, chosen over deploy-time group creation so a new site
        // is staffable without a redeploy. Scoped
        // to exactly CreateGroup on the staff pool ARN, nothing broader —
        // AdminAddUserToGroup etc. stay staff_admin's grant, not this one's.
        this.roomsAdminFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['cognito-idp:CreateGroup'],
            resources: [props.staffUserPool.userPoolArn],
        }));

        // staff_admin — admin-only staff roster + Cognito group (site) access
        // management. Cognito-only, no DynamoDB access;
        // scoped to exactly the staff pool (Pool A) via its ARN — the same
        // least-privilege-per-trust-boundary idiom as roomsAdminFunction above,
        // and the same admin_* Cognito call pattern auth-constructs.ts's Pool B
        // triggers already use for CreateAuthChallenge etc.
        this.staffAdminFunction = pythonFunction(this, 'StaffAdminFunction', {
            dirName: 'staff_admin',
            handler: 'handler.handler',
            functionName: `staff-admin-${stage}`,
            environment: {STAFF_USER_POOL_ID: props.staffUserPool.userPoolId},
        });
        this.staffAdminFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'cognito-idp:AdminCreateUser',
                'cognito-idp:ListUsers',
                'cognito-idp:ListGroups',
                'cognito-idp:AdminListGroupsForUser',
                'cognito-idp:AdminAddUserToGroup',
                'cognito-idp:AdminRemoveUserFromGroup',
            ],
            resources: [props.staffUserPool.userPoolArn],
        }));

        // calendar_feed — staff Outlook/iCal subscription. Pool A token
        // routes plus one public .ics route keyed by a secret token. Reads
        // the owner's live groups from Cognito on every fetch so revoked
        // site access drops out of the feed; read-only on Bookings.
        this.calendarFeedFunction = pythonFunction(this, 'CalendarFeedFunction', {
            dirName: 'calendar_feed',
            handler: 'handler.handler',
            functionName: `calendar-feed-${stage}`,
            environment: {
                BOOKINGS_TABLE: props.bookingsTable.tableName,
                ROOMS_TABLE: props.roomsTable.tableName,
                SITES_TABLE: props.sitesTable.tableName,
                CALENDAR_FEEDS_TABLE: props.calendarFeedsTable.tableName,
                STAFF_USER_POOL_ID: props.staffUserPool.userPoolId,
            },
        });
        props.bookingsTable.grantReadData(this.calendarFeedFunction);
        props.roomsTable.grantReadData(this.calendarFeedFunction);
        props.sitesTable.grantReadData(this.calendarFeedFunction);
        props.calendarFeedsTable.grantReadWriteData(this.calendarFeedFunction);
        this.calendarFeedFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminListGroupsForUser'],
            resources: [props.staffUserPool.userPoolArn],
        }));

        // checkin — future-phase placeholder, not wired to API Gateway yet.
        this.checkinFunction = pythonFunction(this, 'CheckinFunction', {
            dirName: 'checkin',
            handler: 'handler.handler',
            functionName: `checkin-${stage}`,
        });
        props.visitorsCheckinsTable.grantReadWriteData(this.checkinFunction);
    }
}
