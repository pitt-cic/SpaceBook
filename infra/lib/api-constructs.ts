import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import {Construct} from 'constructs';

export interface ApiConstructsProps {
    staffUserPool: cognito.UserPool;
    requestorUserPool: cognito.UserPool;
    requestsPublicFunction: lambda.Function;
    requestsRequestorFunction: lambda.Function;
    requestsStaffFunction: lambda.Function;
    roomsFunction: lambda.Function;
    roomsAdminFunction: lambda.Function;
    staffAdminFunction: lambda.Function;
    calendarFeedFunction: lambda.Function;
    stage: string;
}

/**
 * REST API (apigateway.RestApi, matching infra-stack.ts's existing construct)
 * with two CognitoUserPoolsAuthorizers (staff Pool A, requestor Pool B),
 * explicit CORS headers on every Lambda response plus OPTIONS preflight per
 * resource, and a WAF rate-based rule re-anchored to the API's stage.
 */
export class ApiConstructs extends Construct {
    public readonly api: apigateway.RestApi;

    constructor(scope: Construct, id: string, props: ApiConstructsProps) {
        super(scope, id);

        this.api = new apigateway.RestApi(this, 'MeetingBookingAPI', {
            restApiName: `Meeting Booking API-${props.stage}`,
            description: 'The Bridge Portal — Meeting Booking backend API',
        });

        const staffAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'StaffAuthorizer', {
            cognitoUserPools: [props.staffUserPool],
        });
        const requestorAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'RequestorAuthorizer', {
            cognitoUserPools: [props.requestorUserPool],
        });

        const publicIntegration = new apigateway.LambdaIntegration(props.requestsPublicFunction);
        const requestorIntegration = new apigateway.LambdaIntegration(props.requestsRequestorFunction);
        const staffIntegration = new apigateway.LambdaIntegration(props.requestsStaffFunction);
        const roomsIntegration = new apigateway.LambdaIntegration(props.roomsFunction);
        const roomsAdminIntegration = new apigateway.LambdaIntegration(props.roomsAdminFunction);
        const staffAdminIntegration = new apigateway.LambdaIntegration(props.staffAdminFunction);
        const calendarFeedIntegration = new apigateway.LambdaIntegration(props.calendarFeedFunction);

        const staffMethodOptions: apigateway.MethodOptions = {
            authorizer: staffAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        };
        const requestorMethodOptions: apigateway.MethodOptions = {
            authorizer: requestorAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        };
        // Same Pool A authorizer as staffMethodOptions — API Gateway's Cognito
        // authorizer can't restrict to a specific group declaratively, so the
        // "admin" group check happens in-Lambda (rooms_admin/handler.py's
        // require_admin), matching the existing /api/admin/sites precedent
        // (requests_staff's admin_sites_summary). Named separately so the route
        // table below reads as admin-only at a glance.
        const adminMethodOptions: apigateway.MethodOptions = {
            authorizer: staffAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        };

        const apiRoot = this.api.root.addResource('api');

        // /api/sites — site-creation routes, all on the same
        // rooms_admin Lambda as the room-catalog writes below (site/room
        // catalog admin share one trust boundary). GET is deliberately
        // public/no-authorizer on this admin-capable function, since the
        // public request form's site picker needs it — same reasoning as the
        // public GET /api/sites/{site}/rooms. rooms_admin/handler.py checks
        // the route before requiring the admin claim, so this one GET method
        // never hits require_admin.
        const sites = apiRoot.addResource('sites');
        sites.addMethod('GET', roomsAdminIntegration);
        sites.addMethod('POST', roomsAdminIntegration, adminMethodOptions);
        addCorsOptions(sites);

        const site = sites.addResource('{site}');
        site.addMethod('PUT', roomsAdminIntegration, adminMethodOptions);
        addCorsOptions(site);

        const siteRooms = site.addResource('rooms');
        siteRooms.addMethod('GET', roomsIntegration);
        siteRooms.addMethod('POST', roomsAdminIntegration, adminMethodOptions);
        addCorsOptions(siteRooms);

        const siteRoomById = siteRooms.addResource('{roomId}');
        siteRoomById.addMethod('PUT', roomsAdminIntegration, adminMethodOptions);
        addCorsOptions(siteRoomById);

        const siteAvailability = site.addResource('availability');
        siteAvailability.addMethod('GET', publicIntegration);
        addCorsOptions(siteAvailability);

        const siteRequests = site.addResource('requests');
        siteRequests.addMethod('GET', staffIntegration, staffMethodOptions);
        // Staff-created booking (approved on creation, hidden rooms allowed).
        // Not matched by the WAF rate rule below (ENDS_WITH '/api/requests').
        siteRequests.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(siteRequests);

        // /api/requests
        const requests = apiRoot.addResource('requests');
        requests.addMethod('POST', publicIntegration);
        addCorsOptions(requests);

        const requestById = requests.addResource('{id}');
        requestById.addMethod('GET', staffIntegration, staffMethodOptions);
        addCorsOptions(requestById);

        const requestStatus = requestById.addResource('status');
        requestStatus.addMethod('GET', publicIntegration);
        addCorsOptions(requestStatus);

        const requestApprove = requestById.addResource('approve');
        requestApprove.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(requestApprove);

        const requestDeny = requestById.addResource('deny');
        requestDeny.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(requestDeny);

        const requestModify = requestById.addResource('modify');
        requestModify.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(requestModify);

        const requestConfirmCancellation = requestById.addResource('confirm-cancellation');
        requestConfirmCancellation.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(requestConfirmCancellation);

        const requestRejectCancellation = requestById.addResource('reject-cancellation');
        requestRejectCancellation.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(requestRejectCancellation);

        const requestResendInvite = requestById.addResource('resend-invite');
        requestResendInvite.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(requestResendInvite);

        const requestCheckin = requestById.addResource('checkin');
        requestCheckin.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(requestCheckin);

        const requestNoShow = requestById.addResource('no-show');
        requestNoShow.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(requestNoShow);

        const requestUndoCheckin = requestById.addResource('undo-checkin');
        requestUndoCheckin.addMethod('POST', staffIntegration, staffMethodOptions);
        addCorsOptions(requestUndoCheckin);

        const requestCancelRequest = requestById.addResource('cancel-request');
        requestCancelRequest.addMethod('POST', requestorIntegration, requestorMethodOptions);
        addCorsOptions(requestCancelRequest);

        const counterProposal = requestById.addResource('counter-proposal');
        const counterProposalAccept = counterProposal.addResource('accept');
        counterProposalAccept.addMethod('POST', requestorIntegration, requestorMethodOptions);
        addCorsOptions(counterProposalAccept);

        const counterProposalDecline = counterProposal.addResource('decline');
        counterProposalDecline.addMethod('POST', requestorIntegration, requestorMethodOptions);
        addCorsOptions(counterProposalDecline);

        // /api/my-requests
        const myRequests = apiRoot.addResource('my-requests');
        myRequests.addMethod('GET', requestorIntegration, requestorMethodOptions);
        addCorsOptions(myRequests);

        // /api/admin/sites (admin-only, enforced in the requests_staff Lambda)
        const admin = apiRoot.addResource('admin');
        const adminSites = admin.addResource('sites');
        adminSites.addMethod('GET', staffIntegration, staffMethodOptions);
        addCorsOptions(adminSites);

        // /api/admin/sites/{site}/rooms — full room catalog (active + inactive),
        // so an admin can see and reactivate a deactivated room. Added on the
        // same rooms_admin trust boundary as the two write routes above (see
        // AGENTS.md).
        const adminSite = adminSites.addResource('{site}');
        const adminSiteRooms = adminSite.addResource('rooms');
        adminSiteRooms.addMethod('GET', roomsAdminIntegration, adminMethodOptions);
        addCorsOptions(adminSiteRooms);

        // Presigned S3 upload for one room photo (admin-only, checked in rooms_admin).
        const adminRoomPhotos = adminSite.addResource('room-photos');
        adminRoomPhotos.addMethod('POST', roomsAdminIntegration, adminMethodOptions);
        addCorsOptions(adminRoomPhotos);

        // /api/admin/staff — staff roster + Cognito group (site) access
        // management, same admin-only trust boundary as
        // the rooms/sites routes above, on the separate staff_admin Lambda
        // (Cognito-only IAM surface — see AGENTS.md for why this isn't folded
        // into roomsAdminFunction).
        const adminStaff = admin.addResource('staff');
        adminStaff.addMethod('GET', staffAdminIntegration, adminMethodOptions);
        adminStaff.addMethod('POST', staffAdminIntegration, adminMethodOptions);
        addCorsOptions(adminStaff);

        const adminStaffByUsername = adminStaff.addResource('{username}');
        const adminStaffGroups = adminStaffByUsername.addResource('groups');
        adminStaffGroups.addMethod('PUT', staffAdminIntegration, adminMethodOptions);
        addCorsOptions(adminStaffGroups);

        // /api/calendar — staff calendar subscription (calendar_feed Lambda).
        // The token routes are Pool A; the feed itself has no authorizer
        // because Outlook can't send a Cognito token — the secret token in
        // the path is the credential. Calendar clients fetch it server-side,
        // so it needs no CORS preflight.
        const calendar = apiRoot.addResource('calendar');
        const calendarToken = calendar.addResource('token');
        calendarToken.addMethod('GET', calendarFeedIntegration, staffMethodOptions);
        calendarToken.addMethod('POST', calendarFeedIntegration, staffMethodOptions);
        addCorsOptions(calendarToken);

        const calendarFeed = calendar.addResource('feed').addResource('{token}');
        calendarFeed.addMethod('GET', calendarFeedIntegration);

        // Errors API Gateway generates itself (authorizer 401 on an expired
        // token, WAF 403, throttling, integration timeouts) never reach a
        // Lambda, so they'd otherwise carry no CORS header — the browser then
        // hides the status and the SPA sees only an opaque "Failed to fetch".
        const gatewayCorsHeaders = {
            'Access-Control-Allow-Origin': "'*'",
            'Access-Control-Allow-Headers':
                "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        };
        this.api.addGatewayResponse('Default4xx', {
            type: apigateway.ResponseType.DEFAULT_4XX,
            responseHeaders: gatewayCorsHeaders,
        });
        this.api.addGatewayResponse('Default5xx', {
            type: apigateway.ResponseType.DEFAULT_5XX,
            responseHeaders: gatewayCorsHeaders,
        });

        // WAF: rate-based rule on the public write endpoint, re-anchored to the
        // API's deployment stage (there's no CloudFront layer to attach to).
        // The scope-down limits counting to POST /api/requests — without it the
        // rule counted every call, and the staff calendar's per-day fan-out
        // (plus retries) tripped it, blanking every page for that IP. The URI
        // WAF sees includes the stage prefix (/prod/api/requests), hence
        // ENDS_WITH rather than EXACTLY.
        const webAcl = new wafv2.CfnWebACL(this, 'ApiWebAcl', {
            defaultAction: {allow: {}},
            scope: 'REGIONAL',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'MeetingBookingApiWebAcl',
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: 'RateLimitPublicSubmission',
                    priority: 0,
                    action: {block: {}},
                    statement: {
                        rateBasedStatement: {
                            limit: 300,
                            aggregateKeyType: 'IP',
                            scopeDownStatement: {
                                andStatement: {
                                    statements: [
                                        {
                                            byteMatchStatement: {
                                                fieldToMatch: {method: {}},
                                                positionalConstraint: 'EXACTLY',
                                                searchString: 'POST',
                                                textTransformations: [{priority: 0, type: 'NONE'}],
                                            },
                                        },
                                        {
                                            byteMatchStatement: {
                                                fieldToMatch: {uriPath: {}},
                                                positionalConstraint: 'ENDS_WITH',
                                                searchString: '/api/requests',
                                                textTransformations: [{priority: 0, type: 'LOWERCASE'}],
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'RateLimitPublicSubmission',
                        sampledRequestsEnabled: true,
                    },
                },
                // Abuse guard for the public calendar feed (the token itself
                // can't be guessed). Deliberately loose: Outlook/Google fetch
                // every subscriber's feed from a few shared Microsoft/Google
                // IPs, so a tight per-IP limit would block all subscribers at once.
                {
                    name: 'RateLimitCalendarFeed',
                    priority: 1,
                    action: {block: {}},
                    statement: {
                        rateBasedStatement: {
                            limit: 1000,
                            aggregateKeyType: 'IP',
                            scopeDownStatement: {
                                byteMatchStatement: {
                                    fieldToMatch: {uriPath: {}},
                                    positionalConstraint: 'CONTAINS',
                                    searchString: '/api/calendar/feed/',
                                    textTransformations: [{priority: 0, type: 'LOWERCASE'}],
                                },
                            },
                        },
                    },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'RateLimitCalendarFeed',
                        sampledRequestsEnabled: true,
                    },
                },
            ],
        });

        new wafv2.CfnWebACLAssociation(this, 'ApiWebAclAssociation', {
            resourceArn: this.api.deploymentStage.stageArn,
            webAclArn: webAcl.attrArn,
        });
    }
}

function addCorsOptions(resource: apigateway.IResource): void {
    resource.addMethod('OPTIONS', new apigateway.MockIntegration({
        integrationResponses: [{
            statusCode: '200',
            responseParameters: {
                'method.response.header.Access-Control-Allow-Headers':
                    "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
                'method.response.header.Access-Control-Allow-Origin': "'*'",
                'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,OPTIONS'",
            },
        }],
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        requestTemplates: {
            'application/json': '{"statusCode": 200}',
        },
    }), {
        methodResponses: [{
            statusCode: '200',
            responseParameters: {
                'method.response.header.Access-Control-Allow-Headers': true,
                'method.response.header.Access-Control-Allow-Origin': true,
                'method.response.header.Access-Control-Allow-Methods': true,
            },
        }],
    });
}
