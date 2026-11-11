#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import {InfraStack} from '../lib/infra-stack';

const app = new cdk.App();

const devName = app.node.tryGetContext('devName') as string | undefined;
const stageName = app.node.tryGetContext('stageName') as string;

const validStages = ['dev', 'beta', 'prod'];

if (!stageName || !validStages.includes(stageName)) {
    throw new Error('Please provide a valid stageName: cdk deploy -c stageName=dev|beta|prod');
}

if (!devName && stageName !== 'prod') {
    throw new Error('Please provide devName for non-prod deployments: cdk deploy -c devName=yourname -c stageName=dev|beta');
}

const isProd = stageName === 'prod';
const stackName = isProd
    ? `SpaceBook-stack-${stageName}`
    : `SpaceBook-stack-${devName}-${stageName}`;

// From address for OTP codes and notification emails. There's deliberately no
// default: it must be an identity verified in SES in the deploying account.
// deploy-infra.sh resolves it (and prompts for it on a new stack).
const sesSenderEmail = (
    (app.node.tryGetContext('sesSenderEmail') as string | undefined) ?? process.env.SES_SENDER_EMAIL ?? ''
).trim();

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sesSenderEmail)) {
    throw new Error(
        'Please provide a valid SES sender email: cdk deploy -c sesSenderEmail=you@example.edu (or set SES_SENDER_EMAIL)',
    );
}

const removalPolicy = isProd
    ? cdk.RemovalPolicy.RETAIN
    : cdk.RemovalPolicy.DESTROY;

new InfraStack(app, stackName, {
    stackName,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    description: 'Meeting Booking ("The Bridge Portal") Infrastructure',
    developerName: isProd ? undefined : devName,
    stageName,
    sesSenderEmail,
    tableRemovalPolicy: removalPolicy,
    allowedOrigins: [],
});
