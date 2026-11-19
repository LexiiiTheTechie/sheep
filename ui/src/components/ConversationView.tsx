import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Send, StopCircle, Lock, Sparkles } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import type { Message, SlotStatus } from '../types';

interface ConversationViewProps {
  messages: Message[];
  slotStatus: SlotStatus;
  isGenerating: boolean;
  onSendMessage: (content: string) => void;
  onStopGeneration: () => void;
  onEditMessage: (msgId: string, newContent: string) => void;
  onRegenerate: (msgId: string) => void;
  onDeleteMessage?: (msgId: string) => void;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
  messages,
  slotStatus,
  isGenerating,
  onSendMessage,
  onStopGeneration,
  onEditMessage,
  onRegenerate,
  onDeleteMessage,
}) => {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isFull = slotStatus.activeUsers >= slotStatus.maxActiveUsers;
  const isLockedOut = !slotStatus.userHoldsSlot && isFull;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isGenerating || isLockedOut) return;
    onSendMessage(input.trim());
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 overflow-hidden relative">
      {/* Lockout banner */}
      {isLockedOut && (
        <div className="bg-amber-950/70 border-b border-amber-800/80 px-4 py-2.5 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400" />
            <span>
              <strong>Hard Lockout Active:</strong> All {slotStatus.maxActiveUsers} model slots are occupied.
            </span>
          </div>
          <span className="text-[11px] text-amber-400/80">Waiting for a slot to free up.</span>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 select-text">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto text-neutral-500 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-indigo-400 shadow-inner">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-300 text-sm">Start a conversation</h3>
              <p className="text-xs text-neutral-500 mt-1">
                Responses are processed entirely on your local machine with strict zero-telemetry.
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={idx === messages.length - 1}
              isGenerating={isGenerating}
              onEditSave={onEditMessage}
              onRegenerate={onRegenerate}
              onDeleteMessage={onDeleteMessage}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="p-4 bg-neutral-900/60 border-t border-neutral-800">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative flex items-end gap-2">
          <textarea
            ref={textareaRef}
            disabled={isLockedOut || isGenerating}
            placeholder={
              isLockedOut
                ? `Capacity full (${slotStatus.activeUsers}/${slotStatus.maxActiveUsers}) — locked out`
                : 'Send a message… (Shift+Enter for newline, Enter to send)'
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            className="flex-1 bg-neutral-950 border border-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none overflow-hidden"
          />
          {isGenerating ? (
            <button
              type="button"
              onClick={onStopGeneration}
              className="p-3 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors flex-shrink-0"
              title="Stop generation"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || isLockedOut}
              className="p-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-xl transition-colors flex-shrink-0"
              title="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
