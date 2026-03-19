import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? "bg-slate-700 text-white"
        : "text-slate-300 hover:bg-slate-700 hover:text-white"
    }`;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Navbar */}
      <header className="bg-slate-800 shadow-lg">
        <div className="max-w-full mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Left: App title + nav links */}
            <div className="flex items-center space-x-6">
              <h1 className="text-lg font-bold text-white tracking-tight">
                Film Analysis
              </h1>
              <nav className="flex items-center space-x-1">
                <NavLink to="/" end className={linkClass}>
                  Analysis
                </NavLink>
                <NavLink to="/wizard" className={linkClass}>
                  Wizard
                </NavLink>
                <NavLink to="/history" className={linkClass}>
                  History
                </NavLink>
              </nav>
            </div>

            {/* Right: User info + logout */}
            <div className="flex items-center space-x-4">
              <span className="text-sm text-slate-300">{user?.username}</span>
              <button
                onClick={logout}
                className="px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-md transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content area */}
      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  );
}
