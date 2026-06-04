import { Link, Outlet, useLocation } from "react-router-dom";

export default function Layout() {
  const loc = useLocation();
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
      </nav>
      <Outlet />
    </div>
  );
}
