import type React from 'react';
import { 
  Download, 
  FileText, 
  FileCode, 
  Cpu, 
  Trash2,
  Settings2,
  Info
} from 'lucide-react';
import type { Chat, Message, SlotStatus } from '../types';

interface ChatOptionsPanelProps {
  currentChat: Chat | null;
  messages: Message[];
  slotStatus: SlotStatus;
  currentModel: string | null;
  onClearChat: () => void;
  onExport: (format: 'json' | 'jsonl' | 'txt' | 'markdown') => void;
}

export const ChatOptionsPanel: React.FC<ChatOptionsPanelProps> = ({
  currentChat: _currentChat,
  messages,
  slotStatus,
  currentModel,
  onClearChat,
  onExport,
}) => {
  const userMsgCount = messages.filter((m) => m.role === 'user').length;
  const assistantMsgCount = messages.filter((m) => m.role === 'assistant').length;

  return (
    <aside className="w-64 bg-neutral-900/60 border-l border-neutral-800 flex flex-col justify-between overflow-y-auto select-none p-4 space-y-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2 pb-3 border-b border-neutral-800">
          <Settings2 className="w-4 h-4 text-indigo-400" />
          <h2 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider">Chat Options</h2>
        </div>

        {/* Model & Slot Status Info */}
        <div className="bg-neutral-950/60 border border-neutral-800/80 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-400 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              Active Engine
            </span>
            <span className={`w-2 h-2 rounded-full ${currentModel ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          </div>
          <div className="text-xs font-mono text-neutral-200 truncate" title={currentModel || 'No model loaded'}>
            {currentModel || 'None (Unloaded)'}
          </div>
          <div className="text-[10px] text-neutral-500 pt-1 border-t border-neutral-800/60 flex justify-between">
            <span>Capacity</span>
            <span className="font-mono text-neutral-400">{slotStatus.activeUsers} / {slotStatus.maxActiveUsers} users</span>
          </div>
        </div>

        {/* Conversation Statistics */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Thread Stats</span>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-neutral-950/40 border border-neutral-800/60 rounded-lg p-2.5">
              <div className="text-[10px] text-neutral-500">User Turns</div>
              <div className="text-sm font-semibold text-indigo-400 mt-0.5">{userMsgCount}</div>
            </div>
            <div className="bg-neutral-950/40 border border-neutral-800/60 rounded-lg p-2.5">
              <div className="text-[10px] text-neutral-500">AI Responses</div>
              <div className="text-sm font-semibold text-purple-400 mt-0.5">{assistantMsgCount}</div>
            </div>
          </div>
        </div>

        {/* Export Formats */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            Export Conversation
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => onExport('json')}
              disabled={messages.length === 0}
              className="flex items-center gap-2 px-3 py-2 bg-neutral-950/60 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-40 rounded-lg text-xs font-mono text-neutral-300 transition-colors"
              title="Standard JSON export with full metadata"
            >
              <FileCode className="w-3.5 h-3.5 text-indigo-400" />
              .json
            </button>
            <button
              onClick={() => onExport('jsonl')}
              disabled={messages.length === 0}
              className="flex items-center gap-2 px-3 py-2 bg-neutral-950/60 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-40 rounded-lg text-xs font-mono text-neutral-300 transition-colors"
              title="JSON Lines format for fine-tuning & datasets"
            >
              <FileCode className="w-3.5 h-3.5 text-purple-400" />
              .jsonl
            </button>
            <button
              onClick={() => onExport('txt')}
              disabled={messages.length === 0}
              className="flex items-center gap-2 px-3 py-2 bg-neutral-950/60 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-40 rounded-lg text-xs font-mono text-neutral-300 transition-colors"
              title="Clean plaintext script"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              .txt
            </button>
            <button
              onClick={() => onExport('markdown')}
              disabled={messages.length === 0}
              className="flex items-center gap-2 px-3 py-2 bg-neutral-950/60 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-40 rounded-lg text-xs font-mono text-neutral-300 transition-colors"
              title="Markdown document"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              .md
            </button>
          </div>
        </div>

        {/* Memory & Privacy Assurance */}
        <div className="bg-neutral-950/40 border border-neutral-800/60 rounded-xl p-3 text-[11px] text-neutral-400 space-y-1.5">
          <div className="flex items-center gap-1.5 text-neutral-300 font-medium">
            <Info className="w-3.5 h-3.5 text-indigo-400" />
            Zero Residual Memory
          </div>
          <p className="text-[10px] text-neutral-500 leading-normal">
            When you delete messages or turns, they are removed from SQLite and never included in the generation context. The model has zero memory of deleted tokens.
          </p>
        </div>
      </div>

      {/* Danger Zone: Clear Current Thread */}
      {messages.length > 0 && (
        <div className="pt-4 border-t border-neutral-800/80">
          <button
            onClick={onClearChat}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-950/30 hover:bg-red-900/40 border border-red-800/40 text-red-300 rounded-lg text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Messages in Chat
          </button>
        </div>
      )}
    </aside>
  );
};
