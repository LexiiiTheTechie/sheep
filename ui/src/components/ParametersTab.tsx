import { useState } from 'react';
import type React from 'react';
import { Sliders, RotateCcw } from 'lucide-react';
import type { GenerationParams } from '../types';

interface ParametersTabProps {
  params: GenerationParams;
  onChangeParams: (params: GenerationParams) => void;
  onResetDefaults: () => void;
}

export const ParametersTab: React.FC<ParametersTabProps> = ({
  params,
  onChangeParams,
  onResetDefaults,
}) => {
  const [activePreset, setActivePreset] = useState<string>('Default');

  const presets: Record<string, GenerationParams> = {
    Default: {
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
      repetitionPenalty: 1.15,
    },
    Creative: {
      temperature: 0.95,
      topP: 0.95,
      maxTokens: 2048,
      repetitionPenalty: 1.1,
    },
    Precise: {
      temperature: 0.2,
      topP: 0.8,
      maxTokens: 2048,
      repetitionPenalty: 1.2,
    },
  };

  const handleSelectPreset = (presetName: string) => {
    setActivePreset(presetName);
    if (presets[presetName]) {
      onChangeParams(presets[presetName]);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-8 select-text">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Generation Parameters</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Fine-tune samplers, temperature, and length limits for your model inferences.
          </p>
        </div>

        <button
          onClick={onResetDefaults}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 bg-neutral-900 border border-neutral-800 rounded-lg hover:bg-neutral-800 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to Defaults
        </button>
      </div>

      {/* Preset Selector */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-neutral-200 mb-3 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-indigo-400" />
          Sampler Presets
        </h2>
        <div className="flex gap-2">
          {Object.keys(presets).map((name) => (
            <button
              key={name}
              onClick={() => handleSelectPreset(name)}
              className={`px-4 py-2 rounded-lg text-xs font-medium border transition-all ${
                activePreset === name
                  ? 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Sliders */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-6">
        {/* Temperature */}
        <div>
          <div className="flex justify-between text-xs mb-2">
            <span className="font-medium text-neutral-300">Temperature</span>
            <span className="font-mono text-neutral-400">{params.temperature}</span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={params.temperature}
            onChange={(e) =>
              onChangeParams({ ...params, temperature: parseFloat(e.target.value) })
            }
            className="w-full accent-indigo-500 bg-neutral-800 h-1.5 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-[11px] text-neutral-500 mt-1">
            Controls randomness. Lower values produce more focused, deterministic answers.
          </p>
        </div>

        {/* Top-P */}
        <div>
          <div className="flex justify-between text-xs mb-2">
            <span className="font-medium text-neutral-300">Top-P (Nucleus Sampling)</span>
            <span className="font-mono text-neutral-400">{params.topP}</span>
          </div>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={params.topP}
            onChange={(e) =>
              onChangeParams({ ...params, topP: parseFloat(e.target.value) })
            }
            className="w-full accent-indigo-500 bg-neutral-800 h-1.5 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-[11px] text-neutral-500 mt-1">
            Limits tokens to the cumulative probability mass. 1.0 disables nucleus sampling.
          </p>
        </div>

        {/* Repetition Penalty */}
        <div>
          <div className="flex justify-between text-xs mb-2">
            <span className="font-medium text-neutral-300">Repetition Penalty</span>
            <span className="font-mono text-neutral-400">{params.repetitionPenalty}</span>
          </div>
          <input
            type="range"
            min={1.0}
            max={2.0}
            step={0.05}
            value={params.repetitionPenalty}
            onChange={(e) =>
              onChangeParams({ ...params, repetitionPenalty: parseFloat(e.target.value) })
            }
            className="w-full accent-indigo-500 bg-neutral-800 h-1.5 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-[11px] text-neutral-500 mt-1">
            Penalizes the repetition of existing phrases and tokens.
          </p>
        </div>

        {/* Max Tokens */}
        <div>
          <div className="flex justify-between text-xs mb-2">
            <span className="font-medium text-neutral-300">Max Generation Tokens</span>
            <span className="font-mono text-neutral-400">{params.maxTokens}</span>
          </div>
          <input
            type="range"
            min={128}
            max={8192}
            step={128}
            value={params.maxTokens}
            onChange={(e) =>
              onChangeParams({ ...params, maxTokens: parseInt(e.target.value) })
            }
            className="w-full accent-indigo-500 bg-neutral-800 h-1.5 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-[11px] text-neutral-500 mt-1">
            Maximum number of tokens to generate per response turn.
          </p>
        </div>
      </div>
    </div>
  );
};
