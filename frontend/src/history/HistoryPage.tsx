import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import {
  setPendingRestore,
  type RestorePayload,
  type SavedAnalysis,
} from "../api/analysisTransfer";

interface Project {
  id: number;
  name: string;
  description: string;
  analysis_count: number;
}

/** Sentinel for the bucket holding analyses that belong to no project. */
const UNFILED = "unfiled";

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface HistoryPageProps {
  visible?: boolean;
}

export default function HistoryPage({ visible = true }: HistoryPageProps) {
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<SavedAnalysis[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-row transient state
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; msg: string } | null>(
    null
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  // Project management state
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<number | null>(
    null
  );
  const [projectError, setProjectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [historyRes, projectsRes] = await Promise.all([
        client.get<SavedAnalysis[]>("/analysis/history"),
        client.get<Project[]>("/projects"),
      ]);
      setSessions(historyRes.data);
      setProjects(projectsRes.data);
    } catch (err: any) {
      setError(
        err.response?.data?.detail ||
          err.message ||
          "Failed to load analysis history."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // Group analyses by project, newest first within each group
  const groups = useMemo(() => {
    const byProject = new Map<string, SavedAnalysis[]>();
    for (const s of sessions) {
      const key = s.project_id === null ? UNFILED : String(s.project_id);
      const list = byProject.get(key);
      if (list) list.push(s);
      else byProject.set(key, [s]);
    }

    const ordered: { key: string; title: string; project: Project | null; rows: SavedAnalysis[] }[] =
      projects.map((p) => ({
        key: String(p.id),
        title: p.name,
        project: p,
        rows: byProject.get(String(p.id)) ?? [],
      }));

    const unfiled = byProject.get(UNFILED) ?? [];
    if (unfiled.length > 0 || projects.length === 0) {
      ordered.push({
        key: UNFILED,
        title: "Unfiled",
        project: null,
        rows: unfiled,
      });
    }
    return ordered;
  }, [sessions, projects]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --- analysis actions ----------------------------------------------------

  async function handleOpen(session: SavedAnalysis) {
    setBusyId(session.id);
    setRowError(null);
    try {
      const res = await client.post<RestorePayload>(
        `/analysis/saved/${session.id}/open`
      );
      setPendingRestore(res.data);
      navigate("/");
    } catch (err: any) {
      setRowError({
        id: session.id,
        msg:
          err.response?.status === 410
            ? "The original film file is no longer on the server."
            : err.response?.data?.detail || "Could not reopen this analysis.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function downloadBlob(url: string, filename: string, id: number) {
    setBusyId(id);
    setRowError(null);
    try {
      const response = await client.get(url, { responseType: "blob" });
      const objectUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      setRowError({
        id,
        msg: err.response?.data?.detail || "Download failed.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(session: SavedAnalysis) {
    setBusyId(session.id);
    setRowError(null);
    try {
      await client.delete(`/analysis/saved/${session.id}`);
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      setConfirmDeleteId(null);
      // Counts shown on the project headers are now stale
      load();
    } catch (err: any) {
      setRowError({
        id: session.id,
        msg: err.response?.data?.detail || "Delete failed.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function patchAnalysis(
    session: SavedAnalysis,
    body: Record<string, unknown>
  ) {
    setBusyId(session.id);
    setRowError(null);
    try {
      const res = await client.patch<SavedAnalysis>(
        `/analysis/saved/${session.id}`,
        body
      );
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? res.data : s))
      );
      return true;
    } catch (err: any) {
      setRowError({
        id: session.id,
        msg: err.response?.data?.detail || "Update failed.",
      });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(session: SavedAnalysis, value: string) {
    const ok = await patchAnalysis(
      session,
      value === UNFILED
        ? { clear_project: true }
        : { project_id: Number(value) }
    );
    if (ok) load();
  }

  async function handleSaveNotes(session: SavedAnalysis) {
    const ok = await patchAnalysis(session, { notes: noteDraft });
    if (ok) setEditingNotesId(null);
  }

  // --- project actions -----------------------------------------------------

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setProjectError(null);
    try {
      await client.post("/projects", { name });
      setNewProjectName("");
      setCreatingProject(false);
      load();
    } catch (err: any) {
      setProjectError(
        err.response?.data?.detail || "Could not create the project."
      );
    }
  }

  async function handleRenameProject(project: Project) {
    const name = renameDraft.trim();
    if (!name || name === project.name) {
      setRenamingId(null);
      return;
    }
    setProjectError(null);
    try {
      await client.put(`/projects/${project.id}`, { name });
      setRenamingId(null);
      load();
    } catch (err: any) {
      setProjectError(
        err.response?.data?.detail || "Could not rename the project."
      );
    }
  }

  async function handleDeleteProject(project: Project) {
    setProjectError(null);
    try {
      await client.delete(`/projects/${project.id}`);
      setConfirmDeleteProject(null);
      load();
    } catch (err: any) {
      setProjectError(
        err.response?.data?.detail || "Could not delete the project."
      );
    }
  }

  // --- rendering -----------------------------------------------------------

  if (loading && sessions.length === 0 && projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <svg
            className="animate-spin h-8 w-8 text-sky-600 mx-auto"
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
          <p className="mt-3 text-sm text-slate-500">Loading history...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-md">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={load}
            className="mt-3 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">
              Analysis History
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {sessions.length} saved{" "}
              {sessions.length === 1 ? "analysis" : "analyses"} in{" "}
              {projects.length} {projects.length === 1 ? "project" : "projects"}
            </p>
          </div>

          {creatingProject ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateProject();
                  if (e.key === "Escape") setCreatingProject(false);
                }}
                placeholder="Project name"
                className="px-2 py-1.5 text-sm border border-slate-300 rounded"
              />
              <button
                onClick={handleCreateProject}
                className="px-3 py-1.5 text-sm font-medium text-white bg-sky-600 hover:bg-sky-500 rounded"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setCreatingProject(false);
                  setProjectError(null);
                }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreatingProject(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-lg"
            >
              New Project
            </button>
          )}
        </div>

        {projectError && (
          <p className="mb-3 text-sm text-red-600">{projectError}</p>
        )}

        {sessions.length === 0 && projects.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
            <p className="text-sm text-slate-600">No saved analyses yet.</p>
            <p className="text-xs text-slate-400 mt-1">
              Analyze a film, then use Save Analysis to keep it here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section
                key={group.key}
                className="bg-white border border-slate-200 rounded-lg overflow-hidden"
              >
                {/* Project header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100 border-b border-slate-200">
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="flex items-center gap-2 text-left"
                  >
                    <span className="text-slate-400 text-xs">
                      {collapsed.has(group.key) ? "▶" : "▼"}
                    </span>
                    {renamingId === group.project?.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && group.project)
                            handleRenameProject(group.project);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="px-2 py-1 text-sm border border-slate-300 rounded"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-slate-700">
                        {group.title}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">
                      ({group.rows.length})
                    </span>
                  </button>

                  {group.project && (
                    <div className="flex items-center gap-2">
                      {renamingId === group.project.id ? (
                        <button
                          onClick={() => handleRenameProject(group.project!)}
                          className="text-xs font-medium text-sky-600 hover:text-sky-700"
                        >
                          Save
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setRenamingId(group.project!.id);
                            setRenameDraft(group.project!.name);
                          }}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          Rename
                        </button>
                      )}
                      {confirmDeleteProject === group.project.id ? (
                        <>
                          <span className="text-xs text-slate-500">
                            Delete project? Its analyses move to Unfiled.
                          </span>
                          <button
                            onClick={() => handleDeleteProject(group.project!)}
                            className="text-xs font-medium text-white bg-red-600 hover:bg-red-500 px-2 py-1 rounded"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteProject(null)}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() =>
                            setConfirmDeleteProject(group.project!.id)
                          }
                          className="text-xs text-red-500 hover:text-red-600"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Rows */}
                {!collapsed.has(group.key) && (
                  <div className="divide-y divide-slate-100">
                    {group.rows.length === 0 ? (
                      <p className="px-4 py-4 text-xs text-slate-400">
                        No analyses in this project yet.
                      </p>
                    ) : (
                      group.rows.map((s) => (
                        <div key={s.id} className="px-4 py-3">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-slate-800 truncate">
                                  {s.original_filename}
                                </span>
                                {s.profile.name && (
                                  <span
                                    className={`text-xs px-1.5 py-0.5 rounded border ${
                                      s.profile.deleted
                                        ? "text-amber-700 bg-amber-50 border-amber-200"
                                        : "text-slate-600 bg-slate-50 border-slate-200"
                                    }`}
                                    title={
                                      s.profile.deleted
                                        ? "This calibration profile has been deleted; the saved snapshot is still used."
                                        : undefined
                                    }
                                  >
                                    {s.profile.name}
                                    {s.profile.deleted && " (deleted)"}
                                  </span>
                                )}
                                {!s.has_file && (
                                  <span className="text-xs px-1.5 py-0.5 rounded border text-red-700 bg-red-50 border-red-200">
                                    file missing
                                  </span>
                                )}
                              </div>

                              <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-3">
                                <span>
                                  {formatDate(s.created_at)} {formatTime(s.created_at)}
                                </span>
                                <span>Channel {s.channel}</span>
                                <span className="font-mono">
                                  a={s.a.toFixed(4)} b={s.b.toFixed(4)}{" "}
                                  c={s.c.toFixed(4)}
                                </span>
                                <span>{s.dpi} DPI</span>
                                {s.image_width && s.image_height && (
                                  <span>
                                    {s.image_width}x{s.image_height} px
                                  </span>
                                )}
                                <span>
                                  {s.has_roi ? "ROI saved" : "no ROI"}
                                </span>
                                {s.updated_at && <span>edited</span>}
                              </div>

                              {/* Notes */}
                              <div className="mt-1.5">
                                {editingNotesId === s.id ? (
                                  <div className="flex items-start gap-2">
                                    <textarea
                                      autoFocus
                                      rows={2}
                                      value={noteDraft}
                                      onChange={(e) =>
                                        setNoteDraft(e.target.value)
                                      }
                                      className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded resize-none"
                                    />
                                    <button
                                      onClick={() => handleSaveNotes(s)}
                                      className="text-xs font-medium text-sky-600 hover:text-sky-700"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => setEditingNotesId(null)}
                                      className="text-xs text-slate-500 hover:text-slate-700"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setEditingNotesId(s.id);
                                      setNoteDraft(s.notes || "");
                                    }}
                                    className="text-xs text-left text-slate-500 hover:text-slate-700"
                                  >
                                    {s.notes || (
                                      <span className="italic text-slate-400">
                                        Add notes...
                                      </span>
                                    )}
                                  </button>
                                )}
                              </div>

                              {rowError?.id === s.id && (
                                <p className="mt-1 text-xs text-red-600">
                                  {rowError.msg}
                                </p>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => handleOpen(s)}
                                  disabled={busyId === s.id || !s.has_file}
                                  title={
                                    s.has_file
                                      ? "Reopen on the Film Dose tab to continue this study"
                                      : "The original film file is no longer on the server"
                                  }
                                  className="px-2.5 py-1 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:bg-slate-300 disabled:cursor-not-allowed rounded"
                                >
                                  {busyId === s.id ? "..." : "Open"}
                                </button>
                                <button
                                  onClick={() =>
                                    downloadBlob(
                                      `/analysis/saved/${s.id}/export`,
                                      `${s.original_filename.replace(
                                        /\.[^.]+$/,
                                        ""
                                      )}_analysis_${s.id}.csv`,
                                      s.id
                                    )
                                  }
                                  disabled={busyId === s.id}
                                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded"
                                >
                                  CSV
                                </button>
                                <button
                                  onClick={() =>
                                    downloadBlob(
                                      `/analysis/saved/${s.id}/file`,
                                      s.original_filename,
                                      s.id
                                    )
                                  }
                                  disabled={busyId === s.id || !s.has_file}
                                  title="Download the original film scan"
                                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:text-slate-300 disabled:cursor-not-allowed rounded"
                                >
                                  Film
                                </button>
                                {confirmDeleteId === s.id ? (
                                  <>
                                    <button
                                      onClick={() => handleDelete(s)}
                                      className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-800"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteId(s.id)}
                                    className="px-2.5 py-1 text-xs font-medium text-red-600 bg-white border border-slate-300 hover:bg-red-50 rounded"
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>

                              <select
                                value={
                                  s.project_id === null
                                    ? UNFILED
                                    : String(s.project_id)
                                }
                                onChange={(e) => handleMove(s, e.target.value)}
                                disabled={busyId === s.id}
                                title="Move to a project"
                                className="text-xs px-1.5 py-1 border border-slate-300 rounded text-slate-600 bg-white"
                              >
                                <option value={UNFILED}>Unfiled</option>
                                {projects.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
