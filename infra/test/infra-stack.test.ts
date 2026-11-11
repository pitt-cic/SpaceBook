import * as cdk from 'aws-cdk-lib/core';
import {Template, Match} from 'aws-cdk-lib/assertions';
import {InfraStack, calendarInviteEnvironment} from '../lib/infra-stack';

describe('InfraStack', () => {
    const app = new cdk.App();
    const stack = new InfraStack(app, 'TestInfraStack', {
        stackName: 'TestInfraStack',
        stageName: 'beta',
        sesSenderEmail: 'sender@example.edu',
        tableRemovalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const template = Template.fromStack(stack);

    test('creates the 6 DynamoDB tables', () => {
        template.resourceCountIs('AWS::DynamoDB::Table', 6);
        template.hasResourceProperties('AWS::DynamoDB::Table', {TableName: 'Rooms-beta'});
        template.hasResourceProperties('AWS::DynamoDB::Table', {TableName: 'Sites-beta'});
        template.hasResourceProperties('AWS::DynamoDB::Table', {TableName: 'Bookings-beta'});
        template.hasResourceProperties('AWS::DynamoDB::Table', {TableName: 'VisitorsCheckins-beta'});
        template.hasResourceProperties('AWS::DynamoDB::Table', {TableName: 'ProgramRecords-beta'});
        template.hasResourceProperties('AWS::DynamoDB::Table', {TableName: 'CalendarFeeds-beta'});
    });

    test('Bookings table has all 4 GSIs', () => {
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'Bookings-beta',
            GlobalSecondaryIndexes: [
                {IndexName: 'ByOrg'},
                {IndexName: 'BySiteStatus'},
                {IndexName: 'ByRequestorEmail'},
                {IndexName: 'BySeries'},
            ],
        });
    });

    test('creates two Cognito user pools (Pool A staff, Pool B requestor)', () => {
        template.resourceCountIs('AWS::Cognito::UserPool', 2);
        template.hasResourceProperties('AWS::Cognito::UserPool', {
            UserPoolName: 'meeting-booking-staff-pool-beta',
        });
        template.hasResourceProperties('AWS::Cognito::UserPool', {
            UserPoolName: 'meeting-booking-requestor-pool-beta',
        });
    });

    test('Pool A has admin/staff-homewood/checkin-homewood groups', () => {
        template.resourceCountIs('AWS::Cognito::UserPoolGroup', 3);
        template.hasResourceProperties('AWS::Cognito::UserPoolGroup', {GroupName: 'admin'});
        template.hasResourceProperties('AWS::Cognito::UserPoolGroup', {GroupName: 'staff-homewood'});
        template.hasResourceProperties('AWS::Cognito::UserPoolGroup', {GroupName: 'checkin-homewood'});
    });

    test('Pool B is wired for CUSTOM_AUTH with 3 Lambda triggers', () => {
        template.hasResourceProperties('AWS::Cognito::UserPool', {
            UserPoolName: 'meeting-booking-requestor-pool-beta',
            LambdaConfig: Match.objectLike({
                DefineAuthChallenge: Match.anyValue(),
                CreateAuthChallenge: Match.anyValue(),
                VerifyAuthChallengeResponse: Match.anyValue(),
            }),
        });
    });

    test('Pool B keeps the original email until a change is verified (it is the ownership key)', () => {
        template.hasResourceProperties('AWS::Cognito::UserPool', {
            UserPoolName: 'meeting-booking-requestor-pool-beta',
            UserAttributeUpdateSettings: {AttributesRequireVerificationBeforeUpdate: ['email']},
        });
    });

    test('creates one REST API with two Cognito authorizers', () => {
        template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
        template.resourceCountIs('AWS::ApiGateway::Authorizer', 2);
        template.hasResourceProperties('AWS::ApiGateway::RestApi', {Name: 'Meeting Booking API-beta'});
    });

    test('creates the domain-grouped Lambda functions plus the auth/seed helpers', () => {
        const expectedFunctionNames = [
            'requests-public-beta', 'requests-requestor-beta', 'requests-staff-beta',
            'rooms-beta', 'rooms-admin-beta', 'staff-admin-beta', 'notify-beta', 'checkin-beta',
            'requestor-define-auth-challenge-beta', 'requestor-create-auth-challenge-beta',
            'requestor-verify-auth-challenge-beta', 'rooms-seed-beta', 'calendar-feed-beta',
        ];
        for (const functionName of expectedFunctionNames) {
            template.hasResourceProperties('AWS::Lambda::Function', {FunctionName: functionName});
        }
    });

    test('staff-admin function is scoped to only the staff pool ARN, no DynamoDB access', () => {
        template.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: Match.arrayWith(['cognito-idp:AdminCreateUser', 'cognito-idp:AdminAddUserToGroup']),
                        Resource: Match.objectLike({
                            'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('StaffUserPool')]),
                        }),
                    }),
                ]),
            }),
        });
    });

    test('staff create (POST /api/admin/staff) needs a Pool A token', () => {
        const resources = template.findResources('AWS::ApiGateway::Resource');
        const staffIds = Object.keys(resources).filter((id) => resources[id].Properties.PathPart === 'staff');
        expect(staffIds).toHaveLength(1);
        template.hasResourceProperties('AWS::ApiGateway::Method', {
            HttpMethod: 'POST',
            ResourceId: {Ref: staffIds[0]},
            AuthorizationType: 'COGNITO_USER_POOLS',
        });
    });

    test('rooms-admin function can CreateGroup on the staff pool ARN', () => {
        template.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: 'cognito-idp:CreateGroup',
                        Resource: Match.objectLike({
                            'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('StaffUserPool')]),
                        }),
                    }),
                ]),
            }),
        });
    });

    test('creates a WAF WebACL associated to the API stage', () => {
        template.resourceCountIs('AWS::WAFv2::WebACL', 1);
        template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    });

    test('serves room photos from a private bucket through CloudFront', () => {
        template.resourceCountIs('AWS::S3::Bucket', 1);
        template.hasResourceProperties('AWS::S3::Bucket', {
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: true,
                BlockPublicPolicy: true,
                IgnorePublicAcls: true,
                RestrictPublicBuckets: true,
            },
        });
        template.resourceCountIs('AWS::CloudFront::Distribution', 1);
        template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
        template.hasResourceProperties('AWS::Lambda::Function', {
            Environment: {
                Variables: Match.objectLike({
                    ROOM_PHOTOS_BUCKET: Match.anyValue(),
                    ROOM_PHOTOS_DOMAIN: Match.anyValue(),
                }),
            },
        });
    });

    test('scopes the WAF rate limit to POST /api/requests only', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Rules: Match.arrayWith([
                Match.objectLike({
                    Name: 'RateLimitPublicSubmission',
                    Statement: {
                        RateBasedStatement: Match.objectLike({
                            ScopeDownStatement: {
                                AndStatement: {
                                    Statements: Match.arrayWith([
                                        Match.objectLike({
                                            ByteMatchStatement: Match.objectLike({SearchString: 'POST'}),
                                        }),
                                        Match.objectLike({
                                            ByteMatchStatement: Match.objectLike({SearchString: '/api/requests'}),
                                        }),
                                    ]),
                                },
                            },
                        }),
                    },
                }),
            ]),
        });
    });

    test('calendar feed is public but its token routes need a Pool A token', () => {
        const resources = template.findResources('AWS::ApiGateway::Resource');
        const idOf = (pathPart: string) =>
            Object.keys(resources).find((id) => resources[id].Properties.PathPart === pathPart);
        const feedId = idOf('{token}');
        const tokenId = idOf('token');
        expect(feedId).toBeDefined();
        expect(tokenId).toBeDefined();

        template.hasResourceProperties('AWS::ApiGateway::Method', {
            HttpMethod: 'GET',
            ResourceId: {Ref: feedId},
            AuthorizationType: 'NONE',
        });
        for (const method of ['GET', 'POST']) {
            template.hasResourceProperties('AWS::ApiGateway::Method', {
                HttpMethod: method,
                ResourceId: {Ref: tokenId},
                AuthorizationType: 'COGNITO_USER_POOLS',
            });
        }
    });

    test('rate-limits the calendar feed path loosely (shared Outlook/Google fetch IPs)', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Rules: Match.arrayWith([
                Match.objectLike({
                    Name: 'RateLimitCalendarFeed',
                    Statement: {
                        RateBasedStatement: Match.objectLike({
                            Limit: 1000,
                            ScopeDownStatement: {
                                ByteMatchStatement: Match.objectLike({SearchString: '/api/calendar/feed/'}),
                            },
                        }),
                    },
                }),
            ]),
        });
    });

    test('adds CORS headers to gateway-generated 4xx/5xx responses', () => {
        for (const type of ['DEFAULT_4XX', 'DEFAULT_5XX']) {
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: type,
                ResponseParameters: Match.objectLike({
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
                }),
            });
        }
    });

    test('calendar invites default to off, with notify wired to the tables it records results in', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'notify-beta',
            Environment: {
                Variables: Match.objectLike({
                    CALENDAR_INVITES_ENABLED: 'false',
                    BOOKINGS_TABLE: Match.anyValue(),
                    ROOMS_TABLE: Match.anyValue(),
                    SITES_TABLE: Match.anyValue(),
                }),
            },
        });
        template.hasResourceProperties('AWS::ApiGateway::Resource', {PathPart: 'resend-invite'});
    });

    test('passes the configured SES sender to notify and the OTP trigger, and outputs it', () => {
        const senders = Object.values(template.findResources('AWS::Lambda::Function'))
            .map((fn) => fn.Properties?.Environment?.Variables?.SES_SENDER_EMAIL)
            .filter((value) => value !== undefined);
        expect(senders).toEqual(['sender@example.edu', 'sender@example.edu']);
        template.hasOutput('SesSenderEmail', {Value: 'sender@example.edu'});
    });

    test('creates the Amplify app with both pools wired as VITE_* env vars', () => {
        template.resourceCountIs('AWS::Amplify::App', 1);
        template.hasResourceProperties('AWS::Amplify::App', {Name: 'meeting-booking-frontend-beta'});
        const expectedNames = [
            'VITE_USER_POOL_ID', 'VITE_USER_POOL_CLIENT_ID',
            'VITE_REQUESTOR_USER_POOL_ID', 'VITE_REQUESTOR_USER_POOL_CLIENT_ID',
            'VITE_API_URL', 'VITE_AWS_REGION',
        ];
        template.hasResourceProperties('AWS::Amplify::App', {
            EnvironmentVariables: Match.arrayWith(
                expectedNames.map((name) => Match.objectLike({Name: name}))
            ),
        });
    });
});

describe('InfraStack stage scoping', () => {
    const app = new cdk.App();
    const betaStack = new InfraStack(app, 'TestInfraStack-beta', {
        stackName: 'TestInfraStack-beta',
        stageName: 'beta',
        sesSenderEmail: 'sender@example.edu',
        tableRemovalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const prodStack = new InfraStack(app, 'TestInfraStack-prod', {
        stackName: 'TestInfraStack-prod',
        stageName: 'prod',
        sesSenderEmail: 'sender@example.edu',
        tableRemovalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const betaTemplate = Template.fromStack(betaStack);
    const prodTemplate = Template.fromStack(prodStack);

    test('beta and prod get differently-named tables and functions', () => {
        betaTemplate.hasResourceProperties('AWS::DynamoDB::Table', {TableName: 'Bookings-beta'});
        prodTemplate.hasResourceProperties('AWS::DynamoDB::Table', {TableName: 'Bookings-prod'});
        betaTemplate.hasResourceProperties('AWS::Lambda::Function', {FunctionName: 'requests-staff-beta'});
        prodTemplate.hasResourceProperties('AWS::Lambda::Function', {FunctionName: 'requests-staff-prod'});
    });

    test('Bookings/Rooms/Sites/CalendarFeeds tables stay RETAIN in both stages', () => {
        for (const template of [betaTemplate, prodTemplate]) {
            for (const prefix of ['Bookings', 'Rooms', 'Sites', 'CalendarFeeds']) {
                template.hasResource('AWS::DynamoDB::Table', {
                    Properties: Match.objectLike({TableName: Match.stringLikeRegexp(`^${prefix}-`)}),
                    DeletionPolicy: 'Retain',
                });
            }
        }
    });

    test('Cognito pools are DESTROY in beta but RETAIN in prod', () => {
        betaTemplate.hasResource('AWS::Cognito::UserPool', {
            Properties: Match.objectLike({UserPoolName: 'meeting-booking-staff-pool-beta'}),
            DeletionPolicy: 'Delete',
        });
        prodTemplate.hasResource('AWS::Cognito::UserPool', {
            Properties: Match.objectLike({UserPoolName: 'meeting-booking-staff-pool-prod'}),
            DeletionPolicy: 'Retain',
        });
    });
});

describe('calendarInviteEnvironment', () => {
    const configured = {
        CALENDAR_INVITES_ENABLED: 'true',
        CALENDAR_INVITE_RECIPIENT: 'cec@example.edu',
        CALENDAR_INVITE_FROM: 'spacebook@example.edu',
        CALENDAR_UID_DOMAIN: 'example.edu',
    };

    test('needs only the enable flag', () => {
        expect(calendarInviteEnvironment({CALENDAR_INVITES_ENABLED: 'true'})).toEqual({CALENDAR_INVITES_ENABLED: 'true'});
    });

    test('is off unless explicitly enabled', () => {
        expect(calendarInviteEnvironment({})).toEqual({CALENDAR_INVITES_ENABLED: 'false'});
    });

    test('passes through configured values when enabled', () => {
        expect(calendarInviteEnvironment({...configured, SPACEBOOK_APP_URL: 'https://app.example.edu'}))
            .toEqual({...configured, SPACEBOOK_APP_URL: 'https://app.example.edu'});
    });

    test('rejects a malformed per-site override map', () => {
        expect(() => calendarInviteEnvironment({...configured, CALENDAR_INVITE_RECIPIENT_OVERRIDES: '{nope'}))
            .toThrow();
    });
});
