import type { ReactNode } from "react";
import { GoogleSignInButton, useAuth } from "./auth";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { ready, authActive, misconfigured, user, clientId, domain } = useAuth();

  if (!ready) {
    return <div className="auth-splash">Loading…</div>;
  }

  if (authActive && misconfigured) {
    return (
      <div className="auth-splash">
        <div className="auth-card">
          <h1>QA Flow</h1>
          <p className="auth-error">
            Sign-in is required but this site has no Google client ID.
            Set <code>VITE_GOOGLE_CLIENT_ID</code> in the frontend environment
            and redeploy.
          </p>
        </div>
      </div>
    );
  }

  if (authActive && !user) {
    return (
      <div className="auth-splash">
        <div className="auth-card">
          <div className="auth-logo">QA&nbsp;Flow</div>
          <h1>Sign in to continue</h1>
          <p className="auth-sub">
            {domain
              ? `Use your @${domain} Google account.`
              : "Use your Google account."}
          </p>
          <div className="auth-btn-wrap">
            <GoogleSignInButton clientId={clientId} domain={domain} />
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
