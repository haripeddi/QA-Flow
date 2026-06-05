import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import RouterApp from "./RouterApp";
import { AuthProvider } from "./auth";
import AuthGate from "./AuthGate";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <BrowserRouter>
          <RouterApp />
        </BrowserRouter>
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>,
);
