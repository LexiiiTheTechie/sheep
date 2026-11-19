import type React from 'react';
import { Cpu, CheckCircle2, Play, Square, HardDrive } from 'lucide-react';
import type { SlotStatus } from '../types';

interface ModelTabProps {
  slotStatus: SlotStatus;
  currentModel: string | null;
  availableModels: string[];
  onLoadModel: (modelName: string) => void;
  onUnloadModel: () => void;
  isLoading: boolean;
}

export const ModelTab: React.FC<ModelTabProps> = ({
  slotStatus,
  currentModel,
  availableModels,
  onLoadModel,
  onUnloadModel,
  isLoading,
}) => {
  const isFull = slotStatus.activeUsers >= slotStatus.maxActiveUsers;
  const isLockedOut = !slotStatus.userHoldsSlot && isFull;

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-8 select-text">
      <div>
        <h1 className="text-2xl font-bold text-neutral-100">Model Management</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Load and manage local LLMs. Loading a model or chatting claims an active user slot.
        </p>
      </div>

      {/* Current Model Status */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-neutral-200 mb-4 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-indigo-400" />
          Active Model Slot
        </h2>

        {currentModel ? (
          <div className="flex items-center justify-between p-4 bg-neutral-950/80 border border-neutral-800 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
              <div>
                <div className="text-sm font-semibold text-neutral-100 font-mono">
                  {currentModel}
                </div>
                <div className="text-xs text-emerald-400 mt-0.5">
                  Slot active & resident in memory
                </div>
              </div>
            </div>

            <button
              onClick={onUnloadModel}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg border border-neutral-700 transition-colors"
            >
              <Square className="w-3.5 h-3.5 text-red-400" />
              Release Slot / Unload
            </button>
          </div>
        ) : (
          <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-800 rounded-lg">
            <Cpu className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">No model loaded. Select a model below to claim your slot.</p>
          </div>
        )}
      </div>

      {/* Available Models */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-neutral-200 mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-indigo-400" />
          Available GGUF Models
        </h2>

        {availableModels.length === 0 ? (
          <div className="text-xs text-neutral-500 py-4 text-center">
            No models found in your model directory. Add .gguf files to <code className="text-neutral-400">user_data/models/</code>.
          </div>
        ) : (
          <div className="space-y-2.5">
            {availableModels.map((model) => {
              const isSelected = currentModel === model;
              return (
                <div
                  key={model}
                  className="flex items-center justify-between p-3.5 bg-neutral-950/60 border border-neutral-800/80 rounded-lg"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="text-xs font-mono text-neutral-200 truncate">
                      {model}
                    </div>
                  </div>

                  {isSelected ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Loaded
                    </span>
                  ) : (
                    <button
                      onClick={() => onLoadModel(model)}
                      disabled={isLoading || isLockedOut}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-lg text-xs font-medium transition-colors"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      {isLockedOut ? 'Locked Out' : 'Load Model'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
