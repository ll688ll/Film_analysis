import { useEffect, useState } from "react";
import { usePersistedState } from "../components/usePersistedState";
import type { ReportMeta } from "../report/reportTypes";

interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  defaultTitle: string;
  defaultAuthor: string;
  hasRoi: boolean;
  /** Statistics are still being computed; the report would be missing them. */
  roiPending: boolean;
  /** Builds and downloads the report; rejects with a message to show. */
  onExport: (meta: ReportMeta) => Promise<void>;
}

const PREFS_KEY = "filmdose.report.v1";

const fieldClass =
  "w-full px-2 py-1.5 text-sm border border-slate-300 rounded text-slate-800 placeholder-slate-400";
const labelClass = "block text-xs font-medium text-slate-600 mb-1";

/** Title, author and comment for an HTML report, then the download. */
export default function ReportDialog({
  open,
  onClose,
  defaultTitle,
  defaultAuthor,
  hasRoi,
  roiPending,
  onExport,
}: ReportDialogProps) {
  // Author and institution rarely change between reports
  const [prefs, setPrefs] = usePersistedState(PREFS_KEY, { author: "", institution: "" });
  const [title, setTitle] = useState(defaultTitle);
  const [author, setAuthor] = useState(prefs.author || defaultAuthor);
  const [institution, setInstitution] = useState(prefs.institution);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh defaults each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setAuthor(prefs.author || defaultAuthor);
    setInstitution(prefs.institution);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTitle, defaultAuthor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      setPrefs({ author: author.trim(), institution: institution.trim() });
      await onExport({
        title: title.trim(),
        author: author.trim(),
        institution: institution.trim(),
        comment: comment.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the report.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
        className="w-[30rem] max-w-full bg-white rounded-lg shadow-xl p-5 text-slate-800"
      >
        <h2 id="report-dialog-title" className="text-base font-semibold">
          Export HTML report
        </h2>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed">
          One self-contained <span className="font-mono">.html</span> file with the dose map,
          ROI statistics, histogram, isodose contours, profiles and calibration. It opens in any
          browser without this app, stays interactive, and prints to PDF.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="report-title" className={labelClass}>
              Title
            </label>
            <input
              id="report-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="report-author" className={labelClass}>
                Author
              </label>
              <input
                id="report-author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="report-institution" className={labelClass}>
                Institution
              </label>
              <input
                id="report-institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="optional"
                className={fieldClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="report-comment" className={labelClass}>
              Comment
            </label>
            <textarea
              id="report-comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Shown at the top of the report (optional)"
              className={`${fieldClass} resize-y`}
            />
          </div>
        </div>

        {!hasRoi && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
            No ROI is placed, so the report will hold the dose map and calibration only.
          </p>
        )}
        {roiPending && (
          <p className="mt-3 text-xs text-slate-500">ROI statistics are still being computed…</p>
        )}
        {error && (
          <p className="mt-3 text-xs text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={busy || roiPending}
            className="px-3 py-1.5 text-sm font-medium text-white bg-sky-600 hover:bg-sky-500 rounded disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {busy ? "Building report…" : "Download report"}
          </button>
        </div>
      </div>
    </div>
  );
}
