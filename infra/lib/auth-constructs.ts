import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import {Construct} from 'constructs';
import {pythonFunction} from './lambda-utils';

export interface AuthConstructsProps {
    sesSenderEmail: string;
    callbackUrls: string[];
    logoutUrls: string[];
    stage: string;
}

/**
 * Two independent Cognito pools.
 *
 * Pool A — Staff/Admin: the template's own UserPool/UserPoolClient pattern,
 * extended with admin/staff-<site>/checkin-<site> groups and selfSignUpEnabled
 * flipped to false (accounts are admin-provisioned, never self-signup).
 *
 * Pool B — Requestor: an independent pool on CUSTOM_AUTH (passwordless email
 * OTP), deliberately separate from Pool A. Three
 * Lambda triggers implement the challenge; no self-signup — the
 * requests_public Lambda provisions a Pool B user at submission time.
 */
export class AuthConstructs extends Construct {
    public readonly staffUserPool: cognito.UserPool;
    public readonly staffUserPoolClient: cognito.UserPoolClient;
    public readonly requestorUserPool: cognito.UserPool;
    public readonly requestorUserPoolClient: cognito.UserPoolClient;
    public readonly adminGroup: cognito.CfnUserPoolGroup;
    public readonly staffHomewoodGroup: cognito.CfnUserPoolGroup;
    public readonly checkinHomewoodGroup: cognito.CfnUserPoolGroup;

    constructor(scope: Construct, id: string, props: AuthConstructsProps) {
        super(scope, id);

        const {stage} = props;

        // Prod pools RETAIN so an errant `cdk destroy` can't trivially wipe
        // real staff/requestor accounts — the main risk this stage mechanism
        // exists to reduce. Beta stays DESTROY (the template's own original
        // convention) so iteration/teardown stays cheap.
        const poolRemovalPolicy = stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

        // ── Pool A: Staff/Admin (template's pool, extended) ──
        this.staffUserPool = new cognito.UserPool(this, 'StaffUserPool', {
            userPoolName: `meeting-booking-staff-pool-${stage}`,
            selfSignUpEnabled: false,
            signInAliases: {
                email: true,
            },
            autoVerify: {
                email: true,
            },
            passwordPolicy: {
                minLength: 8,
                requireUppercase: true,
                requireLowercase: true,
                requireDigits: true,
                requireSymbols: false,
            },
            mfa: cognito.Mfa.OFF,
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: poolRemovalPolicy,
        });

        this.staffUserPoolClient = new cognito.UserPoolClient(this, 'StaffUserPoolClient', {
            userPool: this.staffUserPool,
            userPoolClientName: `meeting-booking-staff-client-${stage}`,
            authFlows: {
                userSrp: true,
                userPassword: true,
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                },
                scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
                callbackUrls: props.callbackUrls,
                logoutUrls: props.logoutUrls,
            },
            preventUserExistenceErrors: true,
        });

        // Groups encode role + site in one claim (admin, staff-<site>,
        // checkin-<site>). Only Homewood's groups are created here; groups for
        // sites added later are created at runtime by rooms_admin's create_site.
        this.adminGroup = new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
            userPoolId: this.staffUserPool.userPoolId,
            groupName: 'admin',
            description: 'Cross-site administrator',
        });

        this.staffHomewoodGroup = new cognito.CfnUserPoolGroup(this, 'StaffHomewoodGroup', {
            userPoolId: this.staffUserPool.userPoolId,
            groupName: 'staff-homewood',
            description: 'Homewood CEC staff',
        });

        this.checkinHomewoodGroup = new cognito.CfnUserPoolGroup(this, 'CheckinHomewoodGroup', {
            userPoolId: this.staffUserPool.userPoolId,
            groupName: 'checkin-homewood',
            description: 'Homewood CEC front-desk check-in operators',
        });

        // ── Pool B: Requestor (independent pool, custom passwordless OTP) ──
        const defineAuthChallenge = pythonFunction(this, 'DefineAuthChallengeFunction', {
            dirName: 'auth_challenge',
            handler: 'define_auth_challenge.handler',
            functionName: `requestor-define-auth-challenge-${stage}`,
        });

        const createAuthChallenge = pythonFunction(this, 'CreateAuthChallengeFunction', {
            dirName: 'auth_challenge',
            handler: 'create_auth_challenge.handler',
            functionName: `requestor-create-auth-challenge-${stage}`,
            environment: {
                SES_SENDER_EMAIL: props.sesSenderEmail,
            },
        });
        createAuthChallenge.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: ['*'],
        }));

        const verifyAuthChallengeResponse = pythonFunction(this, 'VerifyAuthChallengeResponseFunction', {
            dirName: 'auth_challenge',
            handler: 'verify_auth_challenge.handler',
            functionName: `requestor-verify-auth-challenge-${stage}`,
        });

        this.requestorUserPool = new cognito.UserPool(this, 'RequestorUserPool', {
            userPoolName: `meeting-booking-requestor-pool-${stage}`,
            selfSignUpEnabled: false,
            signInAliases: {
                email: true,
            },
            autoVerify: {
                email: true,
            },
            standardAttributes: {
                email: {required: true, mutable: true},
                givenName: {required: false, mutable: true},
                familyName: {required: false, mutable: true},
            },
            mfa: cognito.Mfa.OFF,
            accountRecovery: cognito.AccountRecovery.NONE,
            // Email is the ownership key for a requestor's bookings
            // (requests_requestor matches on the token's email claim). A
            // self-service email change stays pending — the claim keeps the
            // original — until the new inbox verifies it. (Excluding email
            // from the client's writeAttributes isn't possible: Cognito
            // requires required attributes to stay client-writable.)
            keepOriginal: {email: true},
            removalPolicy: poolRemovalPolicy,
            lambdaTriggers: {
                defineAuthChallenge,
                createAuthChallenge,
                verifyAuthChallengeResponse,
            },
        });

        this.requestorUserPoolClient = new cognito.UserPoolClient(this, 'RequestorUserPoolClient', {
            userPool: this.requestorUserPool,
            userPoolClientName: `meeting-booking-requestor-client-${stage}`,
            authFlows: {
                custom: true,
            },
            preventUserExistenceErrors: true,
        });
    }
}
