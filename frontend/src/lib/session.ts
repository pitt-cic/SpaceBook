import type { CognitoUserPool, CognitoUserSession } from 'amazon-cognito-identity-js';

const inflight = new WeakMap<CognitoUserPool, Promise<CognitoUserSession>>();

/**
 * Resolves the pool's stored session, refreshing it with the refresh token
 * when the ID token has expired (Cognito ID tokens last 1h). getSession()
 * returns the cached session untouched while it's still valid, so calling
 * this per request is cheap. Concurrent callers share one in-flight lookup so
 * a page firing many queries at expiry triggers a single refresh.
 */
export function currentSession(pool: CognitoUserPool): Promise<CognitoUserSession> {
  const pending = inflight.get(pool);
  if (pending) return pending;

  const promise = new Promise<CognitoUserSession>((resolve, reject) => {
    const user = pool.getCurrentUser();
    if (!user) {
      reject(new Error('No signed-in user'));
      return;
    }
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        reject(err ?? new Error('Session expired'));
        return;
      }
      resolve(session);
    });
  }).finally(() => inflight.delete(pool));

  inflight.set(pool, promise);
  return promise;
}
