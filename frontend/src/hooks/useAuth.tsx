import {
  AuthenticationDetails,
  CognitoUser,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { userPool } from '../config/cognito';
import { currentSession } from '../lib/session';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
  error: string | null;
  cognitoUser: CognitoUser | null;
  userAttributes: Record<string, string>;
  // Snapshot of the ID token from sign-in/restore (or the last refresh). Fine
  // as an "is signed in" signal for `enabled:` checks, but it expires after
  // 1h — API calls must use getIdToken() instead.
  idToken: string | null;
  // Resolves a currently-valid raw ID token JWT, refreshing it if expired —
  // send verbatim in the Authorization header for API Gateway's
  // CognitoUserPoolsAuthorizer (no "Bearer " prefix, see api/client.ts). If the
  // refresh token is gone or expired too, signs out (RequireRole then
  // redirects to /login) and rejects with a 401 ApiError.
  getIdToken: () => Promise<string>;
  groups: string[];
  // The account's real email, decoded from the ID token's `email` claim.
  // Cognito's own `cognito:username`/CognitoUser.getUsername() is a
  // machine-generated sub-like id here (this pool aliases email for login
  // rather than using it as the username), so it's unusable for display.
  email: string;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  completeNewPasswordChallenge: (
    newPassword: string,
    attributes?: { givenName?: string; familyName?: string },
  ) => Promise<CognitoUserSession>;
  clearError: () => void;
}

type LoginResult =
  | { status: 'success'; session: CognitoUserSession }
  | { status: 'newPasswordRequired'; userAttributes: Record<string, string> };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Exported so callers that just resolved a session (login/completeNewPasswordChallenge's
// return value) can route by role immediately, without waiting on this context's
// own `groups` state to re-render — that state update lands one render late
// relative to an in-flight async handler's own closure.
export function parseGroups(session: CognitoUserSession): string[] {
  const raw = session.getIdToken().decodePayload()['cognito:groups'] as unknown;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  return String(raw)
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cognitoUser, setCognitoUser] = useState<CognitoUser | null>(null);
  const [userAttributes, setUserAttributes] = useState<Record<string, string>>({});
  const [idToken, setIdToken] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const idTokenRef = useRef<string | null>(null);

  const applySession = useCallback((session: CognitoUserSession) => {
    idTokenRef.current = session.getIdToken().getJwtToken();
    setIdToken(idTokenRef.current);
    setGroups(parseGroups(session));
    setEmail((session.getIdToken().decodePayload()['email'] as string) ?? '');
  }, []);

  // Restores an existing browser session on load so a page refresh doesn't
  // force a re-login (amazon-cognito-identity-js keeps the session in
  // localStorage under the hood; the template's original hook never checked
  // for it).
  useEffect(() => {
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) {
      setIsInitializing(false);
      return;
    }
    currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        setIsInitializing(false);
        return;
      }
      setIsAuthenticated(true);
      setCognitoUser(currentUser);
      applySession(session);
      setIsInitializing(false);
    });
  }, [applySession]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    setIsLoading(true);
    setError(null);

    const user = new CognitoUser({
      Username: email,
      Pool: userPool,
    });

    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    return new Promise((resolve, reject) => {
      user.authenticateUser(authDetails, {
        onSuccess: (session) => {
          setIsAuthenticated(true);
          setCognitoUser(user);
          applySession(session);
          setIsLoading(false);
          resolve({ status: 'success', session });
        },
        onFailure: (err) => {
          setIsLoading(false);
          const message = err.message || 'Authentication failed';
          setError(message);
          reject(new Error(message));
        },
        newPasswordRequired: (attrs) => {
          setCognitoUser(user);
          setUserAttributes(attrs);
          setIsLoading(false);
          resolve({ status: 'newPasswordRequired', userAttributes: attrs });
        },
      });
    });
  }, [applySession]);

  const completeNewPasswordChallenge = useCallback(
    async (
      newPassword: string,
      attributes?: { givenName?: string; familyName?: string },
    ): Promise<CognitoUserSession> => {
      if (!cognitoUser) {
        throw new Error('No user session found');
      }

      setIsLoading(true);
      setError(null);

      const requiredAttributes: Record<string, string> = {};
      if (attributes?.givenName) {
        requiredAttributes.given_name = attributes.givenName;
      }
      if (attributes?.familyName) {
        requiredAttributes.family_name = attributes.familyName;
      }

      return new Promise((resolve, reject) => {
        cognitoUser.completeNewPasswordChallenge(newPassword, requiredAttributes, {
          onSuccess: (session) => {
            setIsAuthenticated(true);
            applySession(session);
            setIsLoading(false);
            resolve(session);
          },
          onFailure: (err) => {
            setIsLoading(false);
            const message = err.message || 'Password change failed';
            setError(message);
            reject(new Error(message));
          },
        });
      });
    },
    [cognitoUser, applySession],
  );

  const logout = useCallback(() => {
    const user = userPool.getCurrentUser();
    if (user) {
      user.signOut();
    }
    setIsAuthenticated(false);
    setCognitoUser(null);
    setUserAttributes({});
    idTokenRef.current = null;
    setIdToken(null);
    setGroups([]);
    setEmail('');
    setError(null);
  }, []);

  const getIdToken = useCallback(async (): Promise<string> => {
    try {
      const session = await currentSession(userPool);
      const token = session.getIdToken().getJwtToken();
      // Only push state when a refresh actually minted a new token, so a
      // per-request call doesn't re-render the whole tree.
      if (token !== idTokenRef.current) applySession(session);
      return token;
    } catch {
      logout();
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
  }, [applySession, logout]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        isInitializing,
        error,
        cognitoUser,
        userAttributes,
        idToken,
        getIdToken,
        groups,
        email,
        login,
        logout,
        completeNewPasswordChallenge,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
