import { useEffect, useState } from "react";
import { api } from "./api/client.js";
import { Login } from "./pages/Login.js";
import { Dashboard } from "./pages/Dashboard.js";

type AuthState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in" };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    api
      .me()
      .then(() => setAuth({ status: "signed-in" }))
      .catch(() => setAuth({ status: "signed-out" }));
  }, []);

  if (auth.status === "loading") {
    return <p className="loading-line app">Loading…</p>;
  }
  if (auth.status === "signed-out") {
    return <Login onAuthenticated={() => setAuth({ status: "signed-in" })} />;
  }
  return <Dashboard onSignedOut={() => setAuth({ status: "signed-out" })} />;
}
