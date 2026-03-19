import { Routes, Route, useLocation } from "react-router-dom";
import LoginPage from "./auth/LoginPage";
import RegisterPage from "./auth/RegisterPage";
import ProtectedTabs from "./components/ProtectedTabs";

function ProtectedArea() {
  // Renders a single ProtectedTabs regardless of which tab route matched
  return <ProtectedTabs />;
}

export default function App() {
  const location = useLocation();
  const isAuthRoute =
    location.pathname === "/login" || location.pathname === "/register";

  return (
    <>
      {/* Auth routes */}
      {isAuthRoute && (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      )}

      {/* Protected area — single instance, always mounted when not on auth routes */}
      {!isAuthRoute && <ProtectedArea />}
    </>
  );
}
