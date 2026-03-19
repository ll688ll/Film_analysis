import { useState, useCallback } from "react";
import client from "../api/client";
import WizardCanvas from "./WizardCanvas";
import CurveChart from "./CurveChart";

interface CalibrationPoint {
  dose: number;
  red_pct: number;
  green_pct: number;
  blue_pct: number;
  filename: string;
}

interface FitResult {
  a: number;
  b: number;
  c: number;
  r_squared: number;
}

interface FittedCurves {
  Red?: FitResult;
  Green?: FitResult;
  Blue?: FitResult;
}

export default function WizardPage() {
  // Profile info
  const [profileName, setProfileName] = useState("");
  const [profileNote, setProfileNote] = useState("");

  // Image state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);

  // ROI
  const [roi, setRoi] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: 80,
    h: 80,
  });

  // Point collection
  const [dose, setDose] = useState("");
  const [points, setPoints] = useState<CalibrationPoint[]>([]);
  const [selectedPointIdx, setSelectedPointIdx] = useState<number | null>(null);

  // Curve fitting
  const [fittedCurves, setFittedCurves] = useState<FittedCurves | null>(null);
  const [primaryChannel, setPrimaryChannel] = useState<"Red" | "Green" | "Blue">("Red");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const clearMessages = () => {
    setError(null);
    setSuccessMsg(null);
  };

  // Upload image
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    clearMessages();
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await client.post("/wizard/upload-image", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSessionId(res.data.wizard_session_id);
      setCurrentFilename(file.name);

      // Fetch preview as blob via authenticated client
      const previewRes = await client.get(
        `/analysis/${res.data.wizard_session_id}/preview`,
        { responseType: "blob" }
      );
      const blobUrl = URL.createObjectURL(previewRes.data);
      setImageUrl(blobUrl);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to upload image.");
    } finally {
      setLoading(false);
    }
  };

  const handleROIChange = useCallback(
    (newRoi: { x: number; y: number; w: number; h: number }) => {
      setRoi(newRoi);
    },
    []
  );

  // Add point
  const handleAddPoint = async () => {
    clearMessages();
    const doseVal = parseFloat(dose);
    if (isNaN(doseVal) || doseVal < 0) {
      setError("Enter a valid dose value (>= 0).");
      return;
    }
    if (!sessionId) {
      setError("Upload an image first.");
      return;
    }
    setLoading(true);
    try {
      const res = await client.post("/wizard/extract-point", {
        wizard_session_id: sessionId,
        x: roi.x,
        y: roi.y,
        w: roi.w,
        h: roi.h,
        dose: doseVal,
      });
      setPoints((prev) => [
        ...prev,
        {
          dose: res.data.dose,
          red_pct: res.data.red_pct,
          green_pct: res.data.green_pct,
          blue_pct: res.data.blue_pct,
          filename: currentFilename || "unknown",
        },
      ]);
      setDose("");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to extract point.");
    } finally {
      setLoading(false);
    }
  };

  // Remove point
  const handleRemovePoint = () => {
    if (selectedPointIdx === null) return;
    setPoints((prev) => prev.filter((_, i) => i !== selectedPointIdx));
    setSelectedPointIdx(null);
    setFittedCurves(null);
  };

  // Fit curves
  const handleFitCurves = async () => {
    clearMessages();
    if (points.length < 4) {
      setError("Need at least 4 points to fit calibration curves.");
      return;
    }
    setLoading(true);
    try {
      const res = await client.post("/wizard/fit-curves", {
        points: points.map(({ dose, red_pct, green_pct, blue_pct }) => ({
          dose,
          red_pct,
          green_pct,
          blue_pct,
        })),
      });
      setFittedCurves(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to fit curves.");
    } finally {
      setLoading(false);
    }
  };

  // Save profile
  const handleSave = async () => {
    clearMessages();
    if (!profileName.trim()) {
      setError("Enter a profile name.");
      return;
    }
    if (!fittedCurves) {
      setError("Fit the curves before saving.");
      return;
    }
    setLoading(true);
    try {
      const res = await client.post("/wizard/save-profile", {
        name: profileName.trim(),
        note: profileNote.trim(),
        primary_channel: primaryChannel,
        fitted_params: fittedCurves,
        points: points.map(({ dose, red_pct, green_pct, blue_pct }) => ({
          dose,
          red_pct,
          green_pct,
          blue_pct,
        })),
      });
      setSuccessMsg(`Profile "${res.data.name}" saved successfully.`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save profile.");
    } finally {
      setLoading(false);
    }
  };

  const maxDose = points.length > 0 ? Math.max(...points.map((p) => p.dose)) : 10;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ---- Left Sidebar ---- */}
      <aside className="w-96 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
        {/* Profile Info */}
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-3">
            Profile Info
          </h2>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="e.g. EBT3 Jan 2026"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <label className="block text-xs font-medium text-slate-600 mt-3 mb-1">Note</label>
          <textarea
            value={profileNote}
            onChange={(e) => setProfileNote(e.target.value)}
            placeholder="Optional notes..."
            rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Film Image */}
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-3">
            Film Image
          </h2>
          <label className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer transition-colors">
            Upload Image
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </label>
          {currentFilename && (
            <p className="mt-2 text-xs text-slate-500 truncate" title={currentFilename}>
              Current: {currentFilename}
            </p>
          )}
        </div>

        {/* Point Collection */}
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-3">
            Point Collection
          </h2>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Dose (Gy)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={handleAddPoint}
              disabled={loading || !sessionId}
              className="px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md transition-colors whitespace-nowrap"
            >
              Add Point
            </button>
          </div>

          {/* Points Table */}
          {points.length > 0 && (
            <div className="mt-3 border border-slate-200 rounded-md overflow-hidden">
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">#</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Dose</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">R%</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">G%</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">B%</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((pt, i) => (
                      <tr
                        key={i}
                        onClick={() => setSelectedPointIdx(i)}
                        className={`cursor-pointer transition-colors ${
                          selectedPointIdx === i
                            ? "bg-blue-100"
                            : i % 2 === 0
                            ? "bg-white"
                            : "bg-slate-50"
                        } hover:bg-blue-50`}
                      >
                        <td className="px-2 py-1">{i + 1}</td>
                        <td className="px-2 py-1">{pt.dose.toFixed(2)}</td>
                        <td className="px-2 py-1">{(pt.red_pct * 100).toFixed(1)}</td>
                        <td className="px-2 py-1">{(pt.green_pct * 100).toFixed(1)}</td>
                        <td className="px-2 py-1">{(pt.blue_pct * 100).toFixed(1)}</td>
                        <td className="px-2 py-1 truncate max-w-[60px]" title={pt.filename}>
                          {pt.filename}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedPointIdx !== null && (
            <button
              onClick={handleRemovePoint}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors"
            >
              Remove Selected Point
            </button>
          )}
        </div>

        {/* Curve Fitting */}
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-3">
            Curve Fitting
          </h2>
          <button
            onClick={handleFitCurves}
            disabled={loading || points.length < 4}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            {loading ? "Fitting..." : "Fit Curves"}
          </button>
          {points.length > 0 && points.length < 4 && (
            <p className="mt-2 text-xs text-amber-600">
              Need at least 4 points ({4 - points.length} more).
            </p>
          )}

          {fittedCurves && (
            <div className="mt-3 space-y-2">
              {(["Red", "Green", "Blue"] as const).map((ch) => {
                const fit = fittedCurves[ch];
                if (!fit) return null;
                const colorClass =
                  ch === "Red"
                    ? "text-red-600"
                    : ch === "Green"
                    ? "text-green-600"
                    : "text-blue-600";
                return (
                  <div key={ch} className="bg-slate-50 rounded-md p-2">
                    <p className={`text-xs font-semibold ${colorClass}`}>{ch} Channel</p>
                    <div className="grid grid-cols-2 gap-x-3 mt-1 text-xs text-slate-600">
                      <span>a = {fit.a.toFixed(4)}</span>
                      <span>b = {fit.b.toFixed(4)}</span>
                      <span>c = {fit.c.toFixed(4)}</span>
                      <span className="font-medium">
                        R<sup>2</sup> = {fit.r_squared.toFixed(4)}
                      </span>
                    </div>
                  </div>
                );
              })}

              <div className="mt-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Primary Channel
                </label>
                <select
                  value={primaryChannel}
                  onChange={(e) =>
                    setPrimaryChannel(e.target.value as "Red" | "Green" | "Blue")
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="Red">Red</option>
                  <option value="Green">Green</option>
                  <option value="Blue">Blue</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Save */}
        <div className="p-4">
          <button
            onClick={handleSave}
            disabled={loading || !fittedCurves || !profileName.trim()}
            className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            Save as Profile
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="mx-4 mb-4 px-3 py-2 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mx-4 mb-4 px-3 py-2 text-xs font-medium text-green-800 bg-green-50 border border-green-200 rounded-md">
            {successMsg}
          </div>
        )}

        {/* Loading overlay text */}
        {loading && (
          <div className="mx-4 mb-4 px-3 py-2 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-md animate-pulse">
            Processing...
          </div>
        )}
      </aside>

      {/* ---- Right Side ---- */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Canvas */}
        <div className="flex-1 p-3 min-h-0">
          <WizardCanvas imageUrl={imageUrl} onROIChange={handleROIChange} />
        </div>
        {/* Chart */}
        <div className="flex-1 p-3 pt-0 min-h-0">
          <div className="w-full h-full bg-white border border-slate-200 rounded-lg overflow-hidden">
            <CurveChart
              points={points}
              fittedCurves={
                fittedCurves
                  ? {
                      Red: fittedCurves.Red
                        ? { a: fittedCurves.Red.a, b: fittedCurves.Red.b, c: fittedCurves.Red.c }
                        : undefined,
                      Green: fittedCurves.Green
                        ? {
                            a: fittedCurves.Green.a,
                            b: fittedCurves.Green.b,
                            c: fittedCurves.Green.c,
                          }
                        : undefined,
                      Blue: fittedCurves.Blue
                        ? {
                            a: fittedCurves.Blue.a,
                            b: fittedCurves.Blue.b,
                            c: fittedCurves.Blue.c,
                          }
                        : undefined,
                    }
                  : null
              }
              maxDose={maxDose}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
