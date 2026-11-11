import { AuthenticationDetails, CognitoUser, type CognitoUserSession } from 'amazon-cognito-identity-js';
import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { requestorUserPool } from '../config/cognito';
import { currentSession } from '../lib/session';

type Step = 'request-code' | 'enter-code';

interface RequestorAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  email: string | null;
  idToken: string | null;
  // Same contract as useAuth().getIdToken — a valid token per call, refreshed
  // if the 1h ID token has expired; signs out and rejects with a 401 if not.
  getIdToken: () => Promise<string>;
  step: Step;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  reset: () => void;
  logout: () => void;
  clearError: () => void;
}

const RequestorAuthContext = createContext<RequestorAuthContextType | undefined>(undefined);

/**
 * Pool B — passwordless email-OTP (CUSTOM_AUTH), sibling to useAuth.tsx's
 * Pool A session. Drives CognitoUser.initiateAuth/sendCustomChallengeAnswer
 * against the three backend triggers in backend/lambda/auth_challenge/:
 * DefineAuthChallenge issues one CUSTOM_CHALLENGE up front (so the
 * `customChallenge` callback, not `onSuccess`, is the expected first
 * response), CreateAuthChallenge emails a 6-digit code, and
 * VerifyAuthChallengeResponse checks the answer (3 attempts before failure).
 */
export function RequestorAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const idTokenRef = useRef<string | null>(null);
  const [step, setStep] = useState<Step>('request-code');
  const [cognitoUser, setCognitoUser] = useState<CognitoUser | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const requestCode = useCallback(async (emailInput: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    const normalized = emailInput.trim().toLowerCase();

    const user = new CognitoUser({ Username: normalized, Pool: requestorUserPool });
    user.setAuthenticationFlowType('CUSTOM_AUTH');
    const authDetails = new AuthenticationDetails({ Username: normalized });

    return new Promise((resolve, reject) => {
      user.initiateAuth(authDetails, {
        customChallenge: () => {
          setCognitoUser(user);
          setEmail(normalized);
          setStep('enter-code');
          setIsLoading(false);
          resolve();
        },
        onSuccess: () => {
          setIsLoading(false);
          resolve();
        },
        onFailure: (err) => {
          setIsLoading(false);
          const message = err.message || 'Could not send a sign-in code';
          setError(message);
          reject(new Error(message));
        },
      });
    });
  }, []);

  const verifyCode = useCallback(
    async (code: string): Promise<void> => {
      if (!cognitoUser) {
        throw new Error('Request a code first');
      }
      setIsLoading(true);
      setError(null);

      return new Promise((resolve, reject) => {
        cognitoUser.sendCustomChallengeAnswer(code, {
          onSuccess: (session: CognitoUserSession) => {
            setIsAuthenticated(true);
            idTokenRef.current = session.getIdToken().getJwtToken();
            setIdToken(idTokenRef.current);
            setIsLoading(false);
            resolve();
          },
          customChallenge: () => {
            setIsLoading(false);
            const message = 'Incorrect code. Please try again.';
            setError(message);
            reject(new Error(message));
          },
          onFailure: (err) => {
            setIsLoading(false);
            const message = err.message || 'Sign-in failed. Request a new code.';
            setError(message);
            setStep('request-code');
            setCognitoUser(null);
            reject(new Error(message));
          },
        });
      });
    },
    [cognitoUser],
  );

  const reset = useCallback(() => {
    setStep('request-code');
    setCognitoUser(null);
    setError(null);
  }, []);

  const logout = useCallback(() => {
    cognitoUser?.signOut();
    setIsAuthenticated(false);
    setCognitoUser(null);
    setEmail(null);
    idTokenRef.current = null;
    setIdToken(null);
    setStep('request-code');
    setError(null);
  }, [cognitoUser]);

  const getIdToken = useCallback(async (): Promise<string> => {
    try {
      const session = await currentSession(requestorUserPool);
      const token = session.getIdToken().getJwtToken();
      if (token !== idTokenRef.current) {
        idTokenRef.current = token;
        setIdToken(token);
      }
      return token;
    } catch {
      logout();
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
  }, [logout]);

  return (
    <RequestorAuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        error,
        email,
        idToken,
        getIdToken,
        step,
        requestCode,
        verifyCode,
        reset,
        logout,
        clearError,
      }}
    >
      {children}
    </RequestorAuthContext.Provider>
  );
}

export function useRequestorAuth() {
  const context = useContext(RequestorAuthContext);
  if (context === undefined) {
    throw new Error('useRequestorAuth must be used within a RequestorAuthProvider');
  }
  return context;
}
