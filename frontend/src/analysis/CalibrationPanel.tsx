import { useState, useEffect } from "react";
import client from "../api/client";

export interface ChannelParams {
  channel: string;
  a: number;
  b: number;
  c: number;
}

export interface Profile {
  id: number;
  name: string;
  notes?: string;
  note?: string;
  primary_channel?: string;
  channel_params: ChannelParams[];
}

interface CalibrationPanelProps {
  profiles: Profile[];
  onApplyCalibration: (params: {
    profile_id: number;
    channel: string;
    a: number;
    b: number;
    c: number;
    cmap_min: number;
    cmap_max: number;
  }) => void;
  onProfilesChange: () => void;
  disabled: boolean;
  loading: boolean;
  cmapMin: number;
  cmapMax: number;
  onCmapMinChange: (v: number) => void;
  onCmapMaxChange: (v: number) => void;
}

const CHANNELS = ["Red", "Green", "Blue", "Gray"];

export default function CalibrationPanel({
  profiles,
  onApplyCalibration,
  onProfilesChange,
  disabled,
  loading,
  cmapMin,
  cmapMax,
  onCmapMinChange,
  onCmapMaxChange,
}: CalibrationPanelProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<number | "">("");
  const [channel, setChannel] = useState("Red");
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selectedProfile =
    selectedProfileId !== ""
      ? profiles.find((p) => p.id === selectedProfileId)
      : undefined;

  // Auto-fill a/b/c when profile or channel changes
  useEffect(() => {
    if (!selectedProfile) return;
    const params = selectedProfile.channel_params?.find(
      (cp) => cp.channel.toLowerCase() === channel.toLowerCase()
    );
    if (params) {
      setA(params.a);
      setB(params.b);
      setC(params.c);
    }
  }, [selectedProfile, channel]);

  // Reset edit/delete state when profile selection changes
  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
  }, [selectedProfileId]);

  const handleApply = () => {
    if (selectedProfileId === "") return;
    onApplyCalibration({
      profile_id: selectedProfileId,
      channel,
      a,
      b,
      c,
      cmap_min: cmapMin,
      cmap_max: cmapMax,
    });
  };

  const handleStartEdit = () => {
    if (!selectedProfile) return;
    setEditName(selectedProfile.name);
    setEditNote(selectedProfile.note || selectedProfile.notes || "");
    setEditing(true);
    setConfirmDelete(false);
  };

  const handleCancelEdit = () => {
    setEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedProfile || !editName.trim()) return;
    setEditSaving(true);
    try {
      await client.put(`/profiles/${selectedProfile.id}`, {
        name: editName.trim(),
        note: editNote.trim(),
      });
      onProfilesChange();
      setEditing(false);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update profile.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProfile) return;
    try {
      await client.delete(`/profiles/${selectedProfile.id}`);
      setSelectedProfileId("");
      setConfirmDelete(false);
      onProfilesChange();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to delete profile.");
    }
  };

  return (
    <div className="p-4 border-b border-slate-600">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Calibration
      </h2>

      {profiles.length === 0 ? (
        <p className="text-sm text-slate-500">
          No calibration profiles available. Use the Wizard to create one.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Profile selector */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Profile
            </label>
            <select
              value={selectedProfileId}
              onChange={(e) =>
                setSelectedProfileId(
                  e.target.value ? Number(e.target.value) : ""
                )
              }
              disabled={disabled}
              className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200"
            >
              <option value="">-- Select Profile --</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Profile management buttons */}
          {selectedProfile && !editing && (
            <div className="flex gap-2">
              <button
                onClick={handleStartEdit}
                className="flex-1 px-2 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors"
              >
                Edit Profile
              </button>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-2 py-1.5 text-xs font-medium text-red-400 bg-slate-700 hover:bg-red-900/30 border border-slate-600 rounded transition-colors"
                >
                  Delete
                </button>
              ) : (
                <div className="flex gap-1">
                  <button
                    onClick={handleDelete}
                    className="px-2 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Inline edit form */}
          {editing && selectedProfile && (
            <div className="space-y-2 bg-slate-800/50 rounded-lg p-3 border border-slate-600">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Note</label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  rows={2}
                  className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving || !editName.trim()}
                  className="flex-1 px-2 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed rounded transition-colors"
                >
                  {editSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-2 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Profile notes (when not editing) */}
          {!editing && selectedProfile?.notes && (
            <div className="text-xs text-slate-400 bg-slate-800/50 rounded px-2 py-1.5 border border-slate-600">
              {selectedProfile.notes}
            </div>
          )}
          {!editing && !selectedProfile?.notes && selectedProfile?.note && (
            <div className="text-xs text-slate-400 bg-slate-800/50 rounded px-2 py-1.5 border border-slate-600">
              {selectedProfile.note}
            </div>
          )}

          {/* Channel selector */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Channel
            </label>
            <div className="flex rounded-lg overflow-hidden border border-slate-600">
              {CHANNELS.map((ch) => (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  disabled={disabled}
                  className={`flex-1 px-1 py-1.5 text-xs font-medium transition-colors ${
                    channel === ch
                      ? "bg-sky-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          {/* a, b, c inputs */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "a", val: a, set: setA },
              { label: "b", val: b, set: setB },
              { label: "c", val: c, set: setC },
            ].map(({ label, val, set }) => (
              <div key={label}>
                <label className="block text-xs text-slate-400 mb-1">
                  {label}
                </label>
                <input
                  type="number"
                  step="any"
                  value={val}
                  onChange={(e) => set(Number(e.target.value))}
                  disabled={disabled}
                  className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 font-mono"
                />
              </div>
            ))}
          </div>

          {/* Colormap range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Min Dose (Gy)
              </label>
              <input
                type="number"
                step="0.1"
                value={cmapMin}
                onChange={(e) => onCmapMinChange(Number(e.target.value))}
                disabled={disabled}
                className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Max Dose (Gy)
              </label>
              <input
                type="number"
                step="0.1"
                value={cmapMax}
                onChange={(e) => onCmapMaxChange(Number(e.target.value))}
                disabled={disabled}
                className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200"
              />
            </div>
          </div>

          {/* Apply button */}
          <button
            onClick={handleApply}
            disabled={disabled || selectedProfileId === "" || loading}
            className={`w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${
              disabled || selectedProfileId === "" || loading
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : "bg-sky-600 hover:bg-sky-500 text-white"
            }`}
          >
            {loading && (
              <svg
                className="animate-spin h-4 w-4"
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
            )}
            Apply Calibration
          </button>
        </div>
      )}
    </div>
  );
}
