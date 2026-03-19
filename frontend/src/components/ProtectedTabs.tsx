import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import Layout from "./Layout";
import AnalysisPage from "../analysis/AnalysisPage";
import WizardPage from "../wizard/WizardPage";
import HistoryPage from "../history/HistoryPage";

/**
 * Renders all three main pages simultaneously inside a single Layout,
 * showing/hiding them based on the current route. This keeps components
 * mounted so React state is preserved across tab switches.
 */
export default function ProtectedTabs() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-slate-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const path = location.pathname;

  return (
    <Layout>
      {/* All pages rendered simultaneously; CSS controls visibility */}
      <div className={`flex-1 flex flex-col overflow-hidden ${path === "/" ? "" : "hidden"}`}>
        <AnalysisPage />
      </div>
      <div className={`flex-1 flex flex-col overflow-hidden ${path === "/wizard" ? "" : "hidden"}`}>
        <WizardPage />
      </div>
      <div className={`flex-1 flex flex-col overflow-hidden ${path === "/history" ? "" : "hidden"}`}>
        <HistoryPage visible={path === "/history"} />
      </div>
    </Layout>
  );
}
