import { useState, useEffect } from "react";

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

          {/* Profile notes */}
          {selectedProfile?.notes && (
            <div className="text-xs text-slate-400 bg-slate-800/50 rounded px-2 py-1.5 border border-slate-600">
              {selectedProfile.notes}
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
