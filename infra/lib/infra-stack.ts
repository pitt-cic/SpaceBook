import * as cdk from 'aws-cdk-lib/core';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import {Construct} from 'constructs';
import {AuthConstructs} from './auth-constructs';
import {DataConstructs} from './data-constructs';
import {ComputeConstructs} from './compute-constructs';
import {ApiConstructs} from './api-constructs';

/**
 * Calendar invite settings for the Lambdas, read from the deploying shell's
 * environment (infra/.env, see .env.example). Off unless
 * CALENDAR_INVITES_ENABLED=true. Invites go to each booking's requester and
 * approving staff member, so nothing else is required; the rest are optional
 * overrides (notify defaults the sender to sesSenderEmail).
 */
export function calendarInviteEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
    if ((env.CALENDAR_INVITES_ENABLED ?? '').toLowerCase() !== 'true') {
        return {CALENDAR_INVITES_ENABLED: 'false'};
    }
    if (env.CALENDAR_INVITE_RECIPIENT_OVERRIDES) {
        JSON.parse(env.CALENDAR_INVITE_RECIPIENT_OVERRIDES); // throws on a malformed site → mailbox map
    }
    const optional = [
        'CALENDAR_INVITE_FROM', 'CALENDAR_UID_DOMAIN', 'CALENDAR_INVITE_RECIPIENT',
        'CALENDAR_INVITE_RECIPIENT_OVERRIDES', 'CALENDAR_TIMEZONE', 'SPACEBOOK_APP_URL',
    ];
    const result: Record<string, string> = {CALENDAR_INVITES_ENABLED: 'true'};
    for (const name of optional) {
        if (env[name]) result[name] = env[name] as string;
    }
    return result;
}

export interface InfraStackProps extends cdk.StackProps {
    readonly stackName: string;
    readonly stageName: string;
    readonly developerName?: string;
    /** SES-verified From address for OTP codes and notifications (no default). */
    readonly sesSenderEmail: string;
    readonly tableRemovalPolicy: cdk.RemovalPolicy;
    readonly allowedOrigins?: string[];
}

/**
 * Single stack, grown from the template's infra-stack.ts rather than split
 * into several. Composed from sibling construct files for
 * readability; still one deployed CloudFormation stack.
 */
export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: InfraStackProps) {
        super(scope, id, props);

        const {stageName, developerName, sesSenderEmail} = props;
        // Resource suffix: 'alice-dev', 'alice-beta', or 'prod' — unique per deployer+stage.
        const stage = developerName ? `${developerName}-${stageName}` : stageName;
        const callbackUrls = ['http://localhost:5173/', 'http://localhost:3000/'];
        const logoutUrls = ['http://localhost:5173/', 'http://localhost:3000/'];

        const data = new DataConstructs(this, 'Data', {stage});

        const auth = new AuthConstructs(this, 'Auth', {
            sesSenderEmail,
            callbackUrls,
            logoutUrls,
            stage,
        });

        const compute = new ComputeConstructs(this, 'Compute', {
            bookingsTable: data.bookingsTable,
            roomsTable: data.roomsTable,
            sitesTable: data.sitesTable,
            visitorsCheckinsTable: data.visitorsCheckinsTable,
            calendarFeedsTable: data.calendarFeedsTable,
            roomPhotosBucket: data.roomPhotosBucket,
            roomPhotosDomain: data.roomPhotosDistribution.distributionDomainName,
            staffUserPool: auth.staffUserPool,
            requestorUserPool: auth.requestorUserPool,
            sesSenderEmail,
            calendarInviteEnvironment: calendarInviteEnvironment(),
            stage,
        });

        const api = new ApiConstructs(this, 'Api', {
            staffUserPool: auth.staffUserPool,
            requestorUserPool: auth.requestorUserPool,
            requestsPublicFunction: compute.requestsPublicFunction,
            requestsRequestorFunction: compute.requestsRequestorFunction,
            requestsStaffFunction: compute.requestsStaffFunction,
            roomsFunction: compute.roomsFunction,
            roomsAdminFunction: compute.roomsAdminFunction,
            staffAdminFunction: compute.staffAdminFunction,
            calendarFeedFunction: compute.calendarFeedFunction,
            stage,
        });

        // Amplify App — the template's pattern, extended with Pool B's two
        // VITE_* vars.
        const amplifyApp = new amplify.CfnApp(this, 'AmplifyApp', {
            name: `meeting-booking-frontend-${stage}`,
            environmentVariables: [
                {name: 'VITE_USER_POOL_ID', value: auth.staffUserPool.userPoolId},
                {name: 'VITE_USER_POOL_CLIENT_ID', value: auth.staffUserPoolClient.userPoolClientId},
                {name: 'VITE_REQUESTOR_USER_POOL_ID', value: auth.requestorUserPool.userPoolId},
                {name: 'VITE_REQUESTOR_USER_POOL_CLIENT_ID', value: auth.requestorUserPoolClient.userPoolClientId},
                {name: 'VITE_API_URL', value: api.api.url},
                {name: 'VITE_AWS_REGION', value: this.region},
            ],
            buildSpec: `version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: frontend/dist
    files:
      - '**/*'
  cache:
    paths:
      - frontend/node_modules/**/*`,
            customRules: [
                {
                    source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>',
                    target: '/index.html',
                    status: '200',
                },
            ],
        });

        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.api.url,
            description: 'API Gateway URL',
        });

        new cdk.CfnOutput(this, 'UserPoolId', {
            value: auth.staffUserPool.userPoolId,
            description: 'Cognito Staff/Admin User Pool ID',
        });

        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: auth.staffUserPoolClient.userPoolClientId,
            description: 'Cognito Staff/Admin User Pool Client ID',
        });

        new cdk.CfnOutput(this, 'RequestorUserPoolId', {
            value: auth.requestorUserPool.userPoolId,
            description: 'Cognito Requestor User Pool ID',
        });

        new cdk.CfnOutput(this, 'RequestorUserPoolClientId', {
            value: auth.requestorUserPoolClient.userPoolClientId,
            description: 'Cognito Requestor User Pool Client ID',
        });

        new cdk.CfnOutput(this, 'CognitoRegion', {
            value: this.region,
            description: 'AWS Region for Cognito',
        });

        // Read back by deploy-infra.sh so redeploys reuse the sender without asking.
        new cdk.CfnOutput(this, 'SesSenderEmail', {
            value: sesSenderEmail,
            description: 'SES From address for OTP codes and notification emails',
        });

        new cdk.CfnOutput(this, 'AmplifyAppId', {
            value: amplifyApp.attrAppId,
            description: 'Amplify App ID',
        });
    }
}
