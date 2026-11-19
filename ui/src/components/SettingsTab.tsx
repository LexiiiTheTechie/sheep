import { useState } from 'react';
import type React from 'react';
import { Shield, Server, HardDrive, Check } from 'lucide-react';
import type { UserProfile } from '../types';

interface SettingsTabProps {
  user: UserProfile | null;
  maxActiveUsers: number;
  onUpdateMaxActiveUsers: (count: number) => void;
  modelDirectory: string;
  onPickDirectory: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  user,
  maxActiveUsers,
  onUpdateMaxActiveUsers,
  modelDirectory,
  onPickDirectory,
}) => {
  const [slotCount, setSlotCount] = useState(maxActiveUsers);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const isOwner = user?.role === 'owner';

  const handleSaveSlots = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateMaxActiveUsers(slotCount);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-8 select-text">
      <div>
        <h1 className="text-2xl font-bold text-neutral-100">Application Settings</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Configure model storage, engine capacity, and host options.
        </p>
      </div>

      {/* Model Storage */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-neutral-200 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-indigo-400" />
          Model Directory
        </h2>
        <p className="text-xs text-neutral-400">
          Folder where your GGUF models are stored on disk.
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={modelDirectory}
            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-neutral-300 focus:outline-none"
          />
          <button
            onClick={onPickDirectory}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium border border-neutral-700 transition-colors"
          >
            Browse
          </button>
        </div>
      </div>

      {/* Capacity & Lockout Control (Admin Only) */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-200 flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              Concurrent Active Users Cap
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              Limits how many distinct users can load a model or chat concurrently. Any additional user is hard locked out until a slot is freed.
            </p>
          </div>
          {isOwner && (
            <span className="text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider">
              Admin Managed
            </span>
          )}
        </div>

        {isOwner ? (
          <form onSubmit={handleSaveSlots} className="flex items-center gap-4 pt-2">
            <div className="w-40">
              <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                Max Active Users
              </label>
              <input
                type="number"
                min={1}
                max={16}
                value={slotCount}
                onChange={(e) => setSlotCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              type="submit"
              className="mt-5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                  Saved
                </>
              ) : (
                'Update Limit'
              )}
            </button>
          </form>
        ) : (
          <div className="p-3 bg-neutral-950/60 border border-neutral-800 rounded-lg text-xs text-neutral-400 flex items-center gap-2">
            <Shield className="w-4 h-4 text-neutral-500" />
            <span>Currently set to <strong className="text-neutral-200">{maxActiveUsers}</strong> concurrent users. Managed by the server administrator.</span>
          </div>
        )}
      </div>

      {/* Isolation Info */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-neutral-200 flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          Strict User Isolation
        </h2>
        <p className="text-xs text-neutral-400 leading-relaxed">
          Sheep enforces absolute data separation. Your chats, custom parameters, presets, and generation sessions are encrypted and stored in your account's isolated SQLite namespace. Administrators and other users have zero access to read your private conversations.
        </p>
      </div>
    </div>
  );
};
