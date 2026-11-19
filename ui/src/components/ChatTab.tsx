import type React from 'react';
import { ChatHistoryPanel } from './ChatHistoryPanel';
import { ConversationView } from './ConversationView';
import { ChatOptionsPanel } from './ChatOptionsPanel';
import type { Chat, Message, SlotStatus } from '../types';

interface ChatTabProps {
  chats: Chat[];
  activeChatId: string | null;
  messages: Message[];
  slotStatus: SlotStatus;
  currentModel: string | null;
  isGenerating: boolean;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
  onSendMessage: (content: string) => void;
  onStopGeneration: () => void;
  onEditMessage: (msgId: string, newContent: string) => void;
  onRegenerate: (msgId: string) => void;
  onDeleteMessage?: (msgId: string) => void;
  onClearChat: () => void;
  onExport: (format: 'json' | 'jsonl' | 'txt' | 'markdown') => void;
}

export const ChatTab: React.FC<ChatTabProps> = (props) => {
  const currentChat = props.chats.find((c) => c.id === props.activeChatId) || null;

  return (
    <div className="flex-1 flex flex-row h-full overflow-hidden">
      <ChatHistoryPanel
        chats={props.chats}
        activeChatId={props.activeChatId}
        onSelectChat={props.onSelectChat}
        onNewChat={props.onNewChat}
        onRenameChat={props.onRenameChat}
        onDeleteChat={props.onDeleteChat}
      />
      <ConversationView
        messages={props.messages}
        slotStatus={props.slotStatus}
        isGenerating={props.isGenerating}
        onSendMessage={props.onSendMessage}
        onStopGeneration={props.onStopGeneration}
        onEditMessage={props.onEditMessage}
        onRegenerate={props.onRegenerate}
        onDeleteMessage={props.onDeleteMessage}
      />
      <ChatOptionsPanel
        currentChat={currentChat}
        messages={props.messages}
        slotStatus={props.slotStatus}
        currentModel={props.currentModel}
        onClearChat={props.onClearChat}
        onExport={props.onExport}
      />
    </div>
  );
};
