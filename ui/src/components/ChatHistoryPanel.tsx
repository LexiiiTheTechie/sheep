import { useState } from 'react';
import type React from 'react';
import { Plus, MessageSquare, Pencil, Trash2, Check, X } from 'lucide-react';
import type { Chat } from '../types';

interface ChatHistoryPanelProps {
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
}

export const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = ({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onRenameChat,
  onDeleteChat,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const startEdit = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(chat.id);
    setEditTitle(chat.title);
  };

  const commitEdit = (id: string) => {
    if (editTitle.trim()) onRenameChat(id, editTitle.trim());
    setEditingId(null);
  };

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(id);
  };

  const confirmDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteChat(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="w-56 flex-shrink-0 flex flex-col bg-neutral-900/50 border-r border-neutral-800 overflow-hidden select-none">
      {/* Header */}
      <div className="px-3 py-3 border-b border-neutral-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Chats</span>
        <button
          onClick={onNewChat}
          className="p-1 rounded-md text-neutral-400 hover:text-indigo-400 hover:bg-neutral-800 transition-colors"
          title="New conversation"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto py-1">
        {chats.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-neutral-600">
            No conversations yet.
            <br />Click + to start one.
          </div>
        )}
        {chats.map((chat) => {
          const isActive = chat.id === activeChatId;
          const isEditing = editingId === chat.id;
          const isConfirmDelete = confirmDeleteId === chat.id;

          return (
            <div
              key={chat.id}
              onClick={() => { if (!isEditing) onSelectChat(chat.id); }}
              className={`group relative mx-1 my-0.5 rounded-lg px-2.5 py-2 cursor-pointer transition-all ${
                isActive
                  ? 'bg-indigo-600/15 border border-indigo-500/30'
                  : 'hover:bg-neutral-800/60 border border-transparent'
              }`}
            >
              {isEditing ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(chat.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 bg-neutral-950 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-neutral-100 focus:outline-none"
                  />
                  <button onClick={() => commitEdit(chat.id)} className="text-emerald-400 hover:text-emerald-300">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-neutral-500 hover:text-neutral-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : isConfirmDelete ? (
                <div className="flex items-center gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
                  <span className="text-red-400 flex-1">Delete?</span>
                  <button onClick={(e) => confirmDelete(chat.id, e)} className="text-red-400 hover:text-red-300 font-semibold">Yes</button>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} className="text-neutral-500 hover:text-neutral-300">No</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-indigo-400' : 'text-neutral-600'}`} />
                  <span className={`text-xs truncate flex-1 ${isActive ? 'text-neutral-100 font-medium' : 'text-neutral-400'}`}>
                    {chat.title}
                  </span>
                  {/* Hover actions */}
                  <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => startEdit(chat, e)}
                      className="p-0.5 rounded text-neutral-500 hover:text-neutral-200 transition-colors"
                      title="Rename"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteClick(chat.id, e)}
                      className="p-0.5 rounded text-neutral-500 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
