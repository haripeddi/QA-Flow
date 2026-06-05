import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth";

export default function Layout() {
  const loc = useLocation();
  const { user, signOut } = useAuth();
  return (
    <div className="app-shell">
      <nav className="top-nav">
        <Link to="/" className="brand">
          QA Flow
        </Link>
        <Link
          to="/"
          className={loc.pathname === "/" || loc.pathname.startsWith("/process") ? "nav-on" : ""}
        >
          Use Cases
        </Link>
        <Link
          to="/traceability"
          className={loc.pathname.startsWith("/traceability") ? "nav-on" : ""}
        >
          Traceability
        </Link>
        <Link
          to="/runs"
          className={loc.pathname.startsWith("/runs") ? "nav-on" : ""}
        >
          Test Runs
        </Link>
        {user && (
          <div className="nav-user">
            {user.picture && (
              <img src={user.picture} alt="" referrerPolicy="no-referrer" />
            )}
            <span className="nav-user-email">{user.email}</span>
            <button type="button" className="nav-signout" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </nav>
      <Outlet />
    </div>
  );
}
