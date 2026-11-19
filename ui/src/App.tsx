import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatTab } from './components/ChatTab';
import { ModelTab } from './components/ModelTab';
import { ParametersTab } from './components/ParametersTab';
import { AccountTab } from './components/AccountTab';
import { SettingsTab } from './components/SettingsTab';
import { AuthModal } from './components/AuthModal';
import { api } from './api/client';
import { authClient } from './api/authClient';
import { chatClient } from './api/chatClient';
import type {
  TabId,
  UserProfile,
  SlotStatus,
  Chat,
  Message,
  UserSession,
  GenerationParams,
} from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('chat');

  // Auth & profile
  const [user, setUser] = useState<UserProfile | null>(null);
  const [slotStatus, setSlotStatus] = useState<SlotStatus>({
    activeUsers: 0,
    maxActiveUsers: 3,
    userHoldsSlot: false,
    state: 'available',
  });
  const [sessions, setSessions] = useState<UserSession[]>([]);

  // Model state
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  // Sampling parameters
  const [params, setParams] = useState<GenerationParams>({
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    repetitionPenalty: 1.15,
  });

  // Chat state
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Settings
  const [modelDirectory] = useState('user_data/models');

  // Verify authentication on startup
  useEffect(() => {
    async function initAuth() {
      const profile = await authClient.getMe();
      if (profile) {
        setUser(profile);
        const status = await authClient.getSlotStatus();
        setSlotStatus(status);
        const userSessions = await authClient.getSessions(profile.id);
        setSessions(userSessions);
        await loadChats();
      }
    }
    initAuth();
  }, []);

  // Sync available models
  useEffect(() => {
    async function syncModels() {
      try {
        const info = await api.getModelInfo();
        if (info?.model_name && info.model_name !== 'None') {
          setCurrentModel(info.model_name);
        } else {
          setCurrentModel(null);
        }
        const models = await api.listModels();
        setAvailableModels(models);
      } catch (e) {
        console.error('Failed to sync models:', e);
        setAvailableModels([]);
      }
    }
    syncModels();
    const interval = setInterval(syncModels, 5000);
    return () => clearInterval(interval);
  }, [user]);

  // Load messages when active chat changes
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    chatClient.getMessages(activeChatId).then(setMessages);
  }, [activeChatId]);

  // Chat management
  const loadChats = async () => {
    const list = await chatClient.listChats();
    setChats(list);
    if (list.length > 0) {
      setActiveChatId(list[0].id);
    }
  };

  const handleNewChat = async () => {
    try {
      const chat = await chatClient.createChat('New Conversation');
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      setMessages([]);
    } catch (e) {
      console.error('Failed to create chat:', e);
    }
  };

  const handleSelectChat = (id: string) => {
    if (isGenerating) return;
    setActiveChatId(id);
  };

  const handleRenameChat = async (id: string, title: string) => {
    await chatClient.renameChat(id, title);
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  };

  const handleDeleteChat = async (id: string) => {
    await chatClient.deleteChat(id);
    const remaining = chats.filter((c) => c.id !== id);
    setChats(remaining);
    if (activeChatId === id) {
      if (remaining.length > 0) {
        setActiveChatId(remaining[0].id);
      } else {
        const newChat = await chatClient.createChat('New Conversation');
        setChats([newChat]);
        setActiveChatId(newChat.id);
        setMessages([]);
      }
    }
  };

  // Sending messages
  const runGeneration = async (chatId: string, history: Message[]) => {
    if (!user) return;

    if (!slotStatus.userHoldsSlot) {
      try {
        const newStatus = await authClient.claimSlot(user.id);
        setSlotStatus(newStatus);
      } catch (err: unknown) {
        alert((err as Error).message);
        return;
      }
    }

    const tempBotId = `temp_bot_${Date.now()}`;
    const tempBot: Message = {
      id: tempBotId,
      chat_id: chatId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      edited_at: null,
      position: history.length,
    };
    setMessages((prev) => [...prev, tempBot]);
    setIsGenerating(true);
    abortControllerRef.current = new AbortController();

    const historyPayload = history.map((m) => ({ role: m.role, content: m.content }));
    let streamedContent = '';

    await api.streamChat(
      historyPayload,
      {
        temperature: params.temperature,
        top_p: params.topP,
        max_tokens: params.maxTokens,
        repetition_penalty: params.repetitionPenalty,
      },
      (token: string) => {
        streamedContent += token;
        setMessages((prev) =>
          prev.map((m) => (m.id === tempBotId ? { ...m, content: streamedContent } : m))
        );
      },
      async () => {
        setIsGenerating(false);
        try {
          const saved = await chatClient.appendMessage(chatId, 'assistant', streamedContent);
          setMessages((prev) => prev.map((m) => (m.id === tempBotId ? saved : m)));
        } catch {
          // Keep temp message on failure
        }
      },
      (err: Error) => {
        setIsGenerating(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempBotId
              ? { ...m, content: `Error: ${err.message || 'Generation failed'}` }
              : m
          )
        );
      },
      abortControllerRef.current.signal
    );
  };

  const handleSendMessage = async (content: string) => {
    if (!user) return;
    let targetChatId = activeChatId;

    if (!targetChatId) {
      const chat = await chatClient.createChat('New Conversation');
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      targetChatId = chat.id;
    }

    let userMsg: Message;
    try {
      userMsg = await chatClient.appendMessage(targetChatId, 'user', content);
    } catch {
      userMsg = {
        id: `temp_user_${Date.now()}`,
        chat_id: targetChatId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
        edited_at: null,
        position: messages.length,
      };
    }

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    // Auto-title on first message
    if (messages.length === 0) {
      chatClient.autoTitle(targetChatId, content).then(() => {
        const title = content.slice(0, 60).trim();
        setChats((prev) =>
          prev.map((c) => (c.id === targetChatId ? { ...c, title } : c))
        );
      });
    }

    await runGeneration(targetChatId, updatedMessages);
  };

  // Edit message
  const handleEditMessage = async (msgId: string, newContent: string) => {
    if (!activeChatId) return;
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;

    await chatClient.editMessage(activeChatId, msgId, newContent);

    if (msg.role === 'user') {
      const updatedMsg: Message = { ...msg, content: newContent, edited_at: new Date().toISOString() };
      const truncated = [...messages.slice(0, msg.position), updatedMsg];
      setMessages(truncated);
      await runGeneration(activeChatId, truncated);
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, content: newContent, edited_at: new Date().toISOString() } : m
        )
      );
    }
  };

  // Regenerate
  const handleRegenerate = async (msgId: string) => {
    if (!activeChatId) return;
    await chatClient.deleteMessage(activeChatId, msgId);
    const idx = messages.findIndex((m) => m.id === msgId);
    const preceding = idx > 0 ? messages.slice(0, idx) : [];
    setMessages(preceding);
    await runGeneration(activeChatId, preceding);
  };

  // Delete individual message (and subsequent turn)
  const handleDeleteMessage = async (msgId: string) => {
    if (!activeChatId) return;
    await chatClient.deleteMessage(activeChatId, msgId);
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx !== -1) {
      setMessages(messages.slice(0, idx));
    }
  };

  const handleStopGeneration = async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    await api.stopGeneration();
    setIsGenerating(false);
  };

  // Model Operations
  const handleLoadModel = async (name: string) => {
    if (!user) return;
    setIsLoadingModel(true);
    try {
      const status = await authClient.claimSlot(user.id);
      setSlotStatus(status);
      await api.loadModel(name);
      setCurrentModel(name);
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleUnloadModel = async () => {
    if (!user) return;
    setIsLoadingModel(true);
    try {
      await api.unloadModel();
      setCurrentModel(null);
      const status = await authClient.releaseSlot(user.id);
      setSlotStatus(status);
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleUpdateMaxActiveUsers = async (count: number) => {
    if (!user) return;
    try {
      await authClient.setMaxActiveUsers(count, user.id);
      setSlotStatus((prev) => ({ ...prev, maxActiveUsers: count }));
    } catch (err: unknown) {
      alert((err as Error).message);
    }
  };

  // Account
  const handleAuthenticated = async (loggedInUser: UserProfile) => {
    setUser(loggedInUser);
    const status = await authClient.getSlotStatus();
    setSlotStatus(status);
    const userSessions = await authClient.getSessions(loggedInUser.id);
    setSessions(userSessions);
    await loadChats();
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!user) return;
    await authClient.revokeSession(sessionId);
    const updated = await authClient.getSessions(user.id);
    setSessions(updated);
  };

  const handleExportAllData = () => {
    if (!user) return;
    const exportBundle = {
      user: { id: user.id, username: user.username },
      exportedAt: new Date().toISOString(),
      chats,
      messages,
      presets: [params],
      version: '1.0',
    };
    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sheep-export-${user.username}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSingleChat = (format: 'json' | 'jsonl' | 'txt' | 'markdown') => {
    const activeChat = chats.find((c) => c.id === activeChatId);
    if (!activeChat) return;
    let content = '';
    let mimeType = 'text/plain';
    const filename = `${activeChat.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30) || 'chat'}-${Date.now()}.${format === 'markdown' ? 'md' : format}`;

    if (format === 'markdown') {
      mimeType = 'text/markdown';
      content = `# ${activeChat.title}\nExported: ${new Date().toLocaleString()}\n\n` +
        messages.map((m) => `### **${m.role.toUpperCase()}**:\n${m.content}\n`).join('\n---\n\n');
    } else if (format === 'json') {
      mimeType = 'application/json';
      content = JSON.stringify({ chat: activeChat, messages }, null, 2);
    } else if (format === 'jsonl') {
      mimeType = 'application/x-ndjson';
      content = messages.map((m) => JSON.stringify({ role: m.role, content: m.content, created_at: m.created_at })).join('\n');
    } else if (format === 'txt') {
      mimeType = 'text/plain';
      content = messages.map((m) => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n');
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearChatMessages = async () => {
    if (!activeChatId) return;
    if (confirm('Clear all messages in this conversation?')) {
      for (const m of messages) {
        await chatClient.deleteMessage(activeChatId, m.id);
      }
      setMessages([]);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    await authClient.deleteAccount(user.id);
    setUser(null);
    window.location.reload();
  };

  const handleLogout = async () => {
    await authClient.logout();
    setUser(null);
    setChats([]);
    setMessages([]);
    setActiveChatId(null);
  };

  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-100 overflow-hidden font-sans">
      {!user && <AuthModal onAuthenticated={handleAuthenticated} />}

      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        user={user}
        slotStatus={slotStatus}
        onLogout={handleLogout}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {activeTab === 'chat' && (
          <ChatTab
            chats={chats}
            activeChatId={activeChatId}
            messages={messages}
            slotStatus={slotStatus}
            currentModel={currentModel}
            isGenerating={isGenerating}
            onSelectChat={handleSelectChat}
            onNewChat={handleNewChat}
            onRenameChat={handleRenameChat}
            onDeleteChat={handleDeleteChat}
            onSendMessage={handleSendMessage}
            onStopGeneration={handleStopGeneration}
            onEditMessage={handleEditMessage}
            onRegenerate={handleRegenerate}
            onDeleteMessage={handleDeleteMessage}
            onClearChat={handleClearChatMessages}
            onExport={handleExportSingleChat}
          />
        )}

        {activeTab === 'model' && (
          <ModelTab
            slotStatus={slotStatus}
            currentModel={currentModel}
            availableModels={availableModels}
            onLoadModel={handleLoadModel}
            onUnloadModel={handleUnloadModel}
            isLoading={isLoadingModel}
          />
        )}

        {activeTab === 'parameters' && (
          <ParametersTab
            params={params}
            onChangeParams={setParams}
            onResetDefaults={() => setParams({ temperature: 0.7, topP: 0.9, maxTokens: 2048, repetitionPenalty: 1.15 })}
          />
        )}

        {activeTab === 'account' && (
          <AccountTab
            user={user}
            sessions={sessions}
            onRevokeSession={handleRevokeSession}
            onExportAllData={handleExportAllData}
            onExportSingleChat={handleExportSingleChat}
            onDeleteAccount={handleDeleteAccount}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            user={user}
            maxActiveUsers={slotStatus.maxActiveUsers}
            onUpdateMaxActiveUsers={handleUpdateMaxActiveUsers}
            modelDirectory={modelDirectory}
            onPickDirectory={() => alert('Opening folder picker...')}
          />
        )}

        {activeTab === 'admin' && (
          <div className="p-8 max-w-4xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold text-purple-400">Admin Lifecycle Management</h1>
            <p className="text-xs text-neutral-400">
              Admin powers are strictly limited to user lifecycle and slot release. Admins have zero access to private user chat histories.
            </p>
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl">
              <h3 className="text-sm font-semibold text-neutral-200 mb-2">Slot Allocations</h3>
              <div className="text-xs text-neutral-400">{slotStatus.activeUsers} of {slotStatus.maxActiveUsers} active slots occupied.</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
