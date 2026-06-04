import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./Layout";
import DesignPage from "./pages/DesignPage";
import AuthoringWorkspace from "./authoring/AuthoringWorkspace";
import TraceabilityPage from "./traceability/TraceabilityPage";
import TestRunsPage from "./runs/TestRunsPage";
import TestRunDetailPage from "./runs/TestRunDetailPage";

export default function RouterApp() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DesignPage />} />
        <Route path="/process/:key" element={<DesignPage />} />
        <Route
          path="/process/:key/node/:nodeId"
          element={<AuthoringWorkspace />}
        />
        <Route path="/traceability" element={<TraceabilityPage />} />
        <Route path="/runs" element={<TestRunsPage />} />
        <Route path="/runs/:runId" element={<TestRunDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
