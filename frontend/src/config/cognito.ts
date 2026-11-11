import { CognitoUserPool } from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: import.meta.env.VITE_USER_POOL_ID || '',
  ClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || '',
};

export const userPool = new CognitoUserPool(poolData);

// Pool B — Requestor (passwordless email-OTP, CUSTOM_AUTH). Independent pool,
// sibling to the staff/admin pool above (auth-constructs.ts's two-pool split).
const requestorPoolData = {
  UserPoolId: import.meta.env.VITE_REQUESTOR_USER_POOL_ID || '',
  ClientId: import.meta.env.VITE_REQUESTOR_USER_POOL_CLIENT_ID || '',
};

export const requestorUserPool = new CognitoUserPool(requestorPoolData);
