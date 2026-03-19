import { useEffect, useState } from "react";
import client from "../api/client";

interface AnalysisSession {
  id: number;
  original_filename: string;
  channel: string;
  a: number;
  b: number;
  c: number;
  dpi: number;
  cmap_min: number;
  cmap_max: number;
  created_at: string;
  notes: string | null;
  profile: { name: string } | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string | null, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

interface HistoryPageProps {
  visible?: boolean;
}

export default function HistoryPage({ visible = true }: HistoryPageProps) {
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<number | null>(null);

  // Fetch on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  // Re-fetch whenever tab becomes visible
  useEffect(() => {
    if (visible) {
      fetchHistory();
    }
  }, [visible]);

  async function fetchHistory() {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get<AnalysisSession[]>(
        "/analysis/history"
      );
      const sorted = response.data.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setSessions(sorted);
    } catch (err: any) {
      setError(
        err.response?.data?.detail ||
          err.message ||
          "Failed to load analysis history."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleExportCsv(session: AnalysisSession) {
    setExportingId(session.id);
    try {
      const response = await client.get(`/analysis/${session.id}/export`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const safeName = session.original_filename.replace(/\.[^.]+$/, "");
      link.download = `${safeName}_analysis_${session.id}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(
        err.response?.data?.detail || err.message || "Failed to export CSV."
      );
    } finally {
      setExportingId(null);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <svg
            className="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-3"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-sm text-slate-500">Loading analysis history...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4">
            <svg
              className="w-6 h-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-slate-800 mb-1">
            Failed to load history
          </h3>
          <p className="text-sm text-slate-500 mb-4">{error}</p>
          <button
            onClick={fetchHistory}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-4">
            <svg
              className="w-6 h-6 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-slate-800 mb-1">
            No analysis sessions found
          </h3>
          <p className="text-sm text-slate-500">
            Upload and analyze a film to get started.
          </p>
        </div>
      </div>
    );
  }

  // Table view
  return (
    <div className="flex-1 bg-slate-50 overflow-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-800">
            Analysis History
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} recorded
          </p>
        </div>

        <div className="bg-white shadow-sm rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Filename
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Profile
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Channel
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Parameters
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    DPI
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Notes
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((session, idx) => (
                  <tr
                    key={session.id}
                    className={`${
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                    } hover:bg-indigo-50/40 transition-colors`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-slate-800">
                        {formatDate(session.created_at)}
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatTime(session.created_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-sm text-slate-700 font-mono"
                        title={session.original_filename}
                      >
                        {truncate(session.original_filename, 30)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {session.profile ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                          {session.profile.name}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">N/A</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm text-slate-700 capitalize">
                        {session.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className="text-xs text-slate-600 font-mono"
                        title={`a=${session.a}, b=${session.b}, c=${session.c}`}
                      >
                        {session.a.toFixed(2)}, {session.b.toFixed(2)},{" "}
                        {session.c.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm text-slate-700">
                        {session.dpi}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-sm text-slate-500"
                        title={session.notes || ""}
                      >
                        {truncate(session.notes, 50) || (
                          <span className="text-slate-300 italic">--</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleExportCsv(session)}
                          disabled={exportingId === session.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait"
                          title="Export ROI measurements as CSV"
                        >
                          {exportingId === session.id ? (
                            <svg
                              className="animate-spin h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                              />
                            </svg>
                          ) : (
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                              />
                            </svg>
                          )}
                          CSV
                        </button>
                        <button
                          disabled
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-400 bg-slate-100 border border-slate-200 rounded-md cursor-not-allowed"
                          title="Coming soon"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
