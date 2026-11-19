import { useState, useRef, useEffect } from 'react';
import type React from 'react';
import { Pencil, RefreshCw, Check, X, Bot, User, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../types';

interface MessageBubbleProps {
  message: Message;
  isLast: boolean;
  isGenerating: boolean;
  onEditSave: (msgId: string, newContent: string) => void;
  onRegenerate: (msgId: string) => void;
  onDeleteMessage?: (msgId: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isLast,
  isGenerating,
  onEditSave,
  onRegenerate,
  onDeleteMessage,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync editContent when message updates externally
  useEffect(() => {
    if (!isEditing) setEditContent(message.content);
  }, [message.content, isEditing]);

  // Auto-resize textarea
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      textareaRef.current.focus();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editContent.trim();
    if (trimmed && trimmed !== message.content) {
      onEditSave(message.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditContent(message.content);
    setIsEditing(false);
  };

  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const showRegenerate = isLast && isAssistant && !isGenerating;
  const canEdit = !isGenerating;

  return (
    <div className={`group flex gap-3 max-w-3xl ${isUser ? 'ml-auto justify-end' : 'mr-auto justify-start'}`}>
      {/* Assistant avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0 mt-0.5 shadow-sm">
          <Bot className="w-4 h-4" />
        </div>
      )}

      <div className="flex flex-col gap-1 max-w-full">
        {/* Bubble */}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-indigo-600 text-white rounded-tr-xs shadow-sm'
              : 'bg-neutral-900 border border-neutral-800 text-neutral-200 rounded-tl-xs shadow-sm'
          }`}
        >
          {isEditing ? (
            <div className="flex flex-col gap-2 min-w-[260px]">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave();
                  if (e.key === 'Escape') handleCancel();
                }}
                className={`w-full bg-transparent resize-none focus:outline-none text-sm leading-relaxed ${
                  isUser ? 'text-white placeholder:text-indigo-200' : 'text-neutral-200 placeholder:text-neutral-500'
                }`}
                rows={1}
              />
              <div className="flex items-center gap-2 justify-end pt-1 border-t border-neutral-700/50">
                <span className="text-[10px] opacity-60">Ctrl+Enter to save</span>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs transition-colors"
                >
                  <Check className="w-3 h-3" />
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
                    isUser ? 'bg-indigo-700 hover:bg-indigo-800 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                  }`}
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-neutral-950 prose-pre:border prose-pre:border-neutral-800 prose-code:text-indigo-300 prose-code:bg-neutral-800/80 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-headings:text-neutral-100 prose-a:text-indigo-400 select-text">
              {message.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              ) : (
                isGenerating && isLast ? (
                  <span className="inline-flex gap-1 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                ) : null
              )}
            </div>
          )}
        </div>

        {/* Controls row below bubble */}
        {!isEditing && (
          <div className={`flex items-center gap-2 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {/* Timestamp */}
            <span className="text-[10px] text-neutral-500">
              {message.created_at ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              {message.edited_at && <span className="ml-1 opacity-70">(edited)</span>}
            </span>

            {/* Edit button — visible on hover for both user and assistant */}
            {canEdit && (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-all"
                  title="Edit message"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                {onDeleteMessage && (
                  <button
                    onClick={() => onDeleteMessage(message.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition-all"
                    title="Delete message"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </>
            )}

            {/* Regenerate — only on last assistant message when idle */}
            {showRegenerate && (
              <button
                onClick={() => onRegenerate(message.id)}
                className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-neutral-400 hover:text-indigo-400 hover:bg-neutral-800 transition-all"
                title="Regenerate response"
              >
                <RefreshCw className="w-3 h-3" />
                Regenerate
              </button>
            )}
          </div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="w-7 h-7 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-300 flex-shrink-0 mt-0.5 shadow-sm">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
};
