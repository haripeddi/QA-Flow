import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAuthConfig,
  setAuthErrorHandler,
  setAuthToken,
} from "./api";

export interface AuthUser {
  email: string;
  name?: string;
  picture?: string;
}

interface AuthState {
  ready: boolean;
  /** True when the backend requires Google sign-in. */
  authActive: boolean;
  /** Set when the backend wants auth but the frontend has no client id. */
  misconfigured: boolean;
  domain: string | null;
  clientId: string;
  user: AuthUser | null;
  token: string | null;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "qaflow.idToken";
const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();

function decodeUser(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as {
      email?: string;
      name?: string;
      picture?: string;
      exp?: number;
    };
    if (!payload.email) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authActive, setAuthActive] = useState(false);
  const [domain, setDomain] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY),
  );

  const user = useMemo(() => (token ? decodeUser(token) : null), [token]);

  const applyToken = useCallback((next: string | null) => {
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
    setAuthToken(next);
    setToken(next);
  }, []);

  const signOut = useCallback(() => {
    applyToken(null);
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  }, [applyToken]);

  // Keep api client in sync with the current token + 401 handling.
  useEffect(() => {
    setAuthToken(token);
    setAuthErrorHandler(() => {
      applyToken(null);
    });
    return () => setAuthErrorHandler(null);
  }, [token, applyToken]);

  // Drop an expired token on load.
  useEffect(() => {
    if (token && !decodeUser(token)) applyToken(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAuthConfig().then((cfg) => {
      if (cancelled) return;
      setAuthActive(cfg.enabled);
      setDomain(cfg.domain);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const misconfigured = authActive && !CLIENT_ID;

  const value: AuthState = {
    ready,
    authActive,
    misconfigured,
    domain,
    clientId: CLIENT_ID,
    user,
    token,
    signOut,
  };

  // Expose the credential handler to the GIS callback.
  const onCredential = useCallback(
    (cred: string) => applyToken(cred),
    [applyToken],
  );

  return (
    <AuthContext.Provider value={value}>
      {ready && authActive && !user && !misconfigured && (
        <GoogleScriptLoader />
      )}
      <CredentialBridge onCredential={onCredential} active={authActive} />
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Loads the Google Identity Services script once.
function GoogleScriptLoader() {
  useEffect(() => {
    if (document.getElementById("gis-script")) return;
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.id = "gis-script";
    document.head.appendChild(s);
  }, []);
  return null;
}

// Stores the latest credential callback so the sign-in button can use it.
let credentialSink: ((cred: string) => void) | null = null;
function CredentialBridge({
  onCredential,
  active,
}: {
  onCredential: (cred: string) => void;
  active: boolean;
}) {
  useEffect(() => {
    if (!active) return;
    credentialSink = onCredential;
    return () => {
      credentialSink = null;
    };
  }, [onCredential, active]);
  return null;
}

// Renders the official Google button into a container, polling until the
// GIS library is available.
export function GoogleSignInButton({ clientId, domain }: {
  clientId: string;
  domain: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      const g = window.google?.accounts?.id;
      if (g && ref.current) {
        window.clearInterval(timer);
        g.initialize({
          client_id: clientId,
          callback: (resp: { credential?: string }) => {
            if (resp.credential && credentialSink) credentialSink(resp.credential);
          },
          hosted_domain: domain ?? undefined,
          auto_select: false,
        });
        g.renderButton(ref.current, {
          theme: "filled_blue",
          size: "large",
          shape: "pill",
          text: "signin_with",
          width: 280,
        });
      } else if (tries > 100) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [clientId, domain]);
  return <div ref={ref} />;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (
            el: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}
