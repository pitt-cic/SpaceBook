import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import {Construct} from 'constructs';
import {pythonFunction} from './lambda-utils';

export interface DataConstructsProps {
    stage: string;
}

/**
 * DynamoDB data layer — 6 tables, plus the room-photo bucket/CDN.
 * Bookings/Rooms/Sites/CalendarFeeds hold real data, so they stay
 * RemovalPolicy.RETAIN in every stage (not just prod) — losing beta data to an
 * accidental `cdk destroy` mid-iteration is still annoying, and RETAIN costs
 * nothing extra for pay-per-request tables. VisitorsCheckins/ProgramRecords are
 * future-phase placeholders with no real data (RemovalPolicy.DESTROY).
 */
export class DataConstructs extends Construct {
    public readonly roomsTable: dynamodb.Table;
    public readonly sitesTable: dynamodb.Table;
    public readonly bookingsTable: dynamodb.Table;
    public readonly visitorsCheckinsTable: dynamodb.Table;
    public readonly programRecordsTable: dynamodb.Table;
    public readonly calendarFeedsTable: dynamodb.Table;
    public readonly roomPhotosBucket: s3.Bucket;
    public readonly roomPhotosDistribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string, props: DataConstructsProps) {
        super(scope, id);

        const {stage} = props;

        // Rooms — config-like, low write volume. PK=SITE#<site>, SK=ROOM#<roomId>.
        // Query(PK=SITE#<site>) returns the full room catalog for a site; no GSI needed.
        this.roomsTable = new dynamodb.Table(this, 'RoomsTable', {
            tableName: `Rooms-${stage}`,
            partitionKey: {name: 'PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'SK', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // Sites — one item per site,
        // PK=SITE#<site>, SK=CONFIG. Kept as PK+SK rather than PK-only for
        // symmetry with the other 4 tables and to leave room for future
        // per-site sub-items (e.g. blackout dates) without a schema change,
        // even though there's exactly one item per partition today. No GSI —
        // "list all sites" is a Scan (rooms_admin/handler.py's list_sites),
        // deliberately fine at this table's single-digit-row scale.
        this.sitesTable = new dynamodb.Table(this, 'SitesTable', {
            tableName: `Sites-${stage}`,
            partitionKey: {name: 'PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'SK', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // Bookings — the core table. Base table PK=SITE#<site>,
        // SK=ROOM#<roomId>#DATE#<date>#REQ#<requestId>, so
        // "is there an overlapping approved booking?" is one Query on a room+date slice.
        // Series header items use SK=SERIES#<seriesId> under the same site PK.
        this.bookingsTable = new dynamodb.Table(this, 'BookingsTable', {
            tableName: `Bookings-${stage}`,
            partitionKey: {name: 'PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'SK', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // GSI1 ByOrg — per-organization request history.
        this.bookingsTable.addGlobalSecondaryIndex({
            indexName: 'ByOrg',
            partitionKey: {name: 'GSI1PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'GSI1SK', type: dynamodb.AttributeType.STRING},
        });

        // GSI2 BySiteStatus — staff dashboard: "all pending_approval for my site, by date".
        this.bookingsTable.addGlobalSecondaryIndex({
            indexName: 'BySiteStatus',
            partitionKey: {name: 'GSI2PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'GSI2SK', type: dynamodb.AttributeType.STRING},
        });

        // GSI3 ByRequestorEmail — "My Requests", scoped to the caller's verified email.
        this.bookingsTable.addGlobalSecondaryIndex({
            indexName: 'ByRequestorEmail',
            partitionKey: {name: 'GSI3PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'GSI3SK', type: dynamodb.AttributeType.STRING},
        });

        // GSI4 BySeries — recurring-series lookups: "list every occurrence in series S".
        this.bookingsTable.addGlobalSecondaryIndex({
            indexName: 'BySeries',
            partitionKey: {name: 'GSI4PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'GSI4SK', type: dynamodb.AttributeType.STRING},
        });

        // VisitorsCheckins — future-phase placeholder, unused. PK=SITE#<site>,
        // SK=VISITOR#<visitorId> (roster) or CHECKIN#<date>#<timestamp>#<visitorId> (log).
        this.visitorsCheckinsTable = new dynamodb.Table(this, 'VisitorsCheckinsTable', {
            tableName: `VisitorsCheckins-${stage}`,
            partitionKey: {name: 'PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'SK', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        this.visitorsCheckinsTable.addGlobalSecondaryIndex({
            indexName: 'ByCard',
            partitionKey: {name: 'GSI1PK', type: dynamodb.AttributeType.STRING},
        });

        // ProgramRecords — future-phase placeholder, unused. PK=SITE#<site>,
        // SK=RECORD#<date>#<requestId>, references Bookings by requestId.
        this.programRecordsTable = new dynamodb.Table(this, 'ProgramRecordsTable', {
            tableName: `ProgramRecords-${stage}`,
            partitionKey: {name: 'PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'SK', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // CalendarFeeds — staff calendar subscription tokens (calendar_feed).
        // PK=TOKEN#<token> → owner (feed lookup), PK=USER#<username> → token
        // (show/reset link); SK=FEED for both. RETAIN: losing it breaks every
        // staff member's Outlook subscription.
        this.calendarFeedsTable = new dynamodb.Table(this, 'CalendarFeedsTable', {
            tableName: `CalendarFeeds-${stage}`,
            partitionKey: {name: 'PK', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'SK', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // Initial catalog seed (admins manage rooms/sites at runtime after
        // this): a custom resource loads the Homewood room catalog on every
        // deploy, plus a matching Sites row for Homewood in the same pass, so
        // the initial deploy leaves a real Sites record behind and not just
        // a Rooms catalog with no corresponding site metadata. The Sites
        // write is conditional on non-existence (see rooms_seed/handler.py)
        // so a later admin edit via PUT /api/sites/{site} isn't silently
        // clobbered back to these defaults on the next `cdk deploy` — unlike
        // Rooms, which this custom resource already unconditionally
        // overwrites on every Create/Update.
        const seedFunction = pythonFunction(this, 'RoomsSeedFunction', {
            dirName: 'rooms_seed',
            handler: 'handler.handler',
            functionName: `rooms-seed-${stage}`,
            environment: {
                ROOMS_TABLE: this.roomsTable.tableName,
                SITES_TABLE: this.sitesTable.tableName,
            },
            timeout: cdk.Duration.seconds(30),
        });
        this.roomsTable.grantWriteData(seedFunction);
        this.sitesTable.grantWriteData(seedFunction);

        const seedProvider = new cr.Provider(this, 'RoomsSeedProvider', {
            onEventHandler: seedFunction,
        });
        new cdk.CustomResource(this, 'RoomsSeedResource', {
            serviceToken: seedProvider.serviceToken,
            properties: {Site: 'homewood', Version: '2'},
        });

        // Room photos: admins upload straight to this private bucket via
        // presigned POSTs from rooms_admin; the SPA reads them through
        // CloudFront (OAC). RETAIN like Rooms, whose items reference them.
        this.roomPhotosBucket = new s3.Bucket(this, 'RoomPhotosBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            cors: [{
                allowedMethods: [s3.HttpMethods.POST],
                allowedOrigins: ['*'],
                allowedHeaders: ['*'],
            }],
        });
        this.roomPhotosDistribution = new cloudfront.Distribution(this, 'RoomPhotosDistribution', {
            comment: `SpaceBook room photos (${stage})`,
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(this.roomPhotosBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
        });
    }
}
