export type TabId = 'chat' | 'model' | 'parameters' | 'account' | 'settings' | 'admin';

export interface UserSession {
  id: string;
  device: string;
  ip: string;
  lastActive: string;
  isCurrent: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  role: 'owner' | 'user';
  createdAt: string;
}

export interface SlotStatus {
  activeUsers: number;
  maxActiveUsers: number;
  userHoldsSlot: boolean;
  state: 'available' | 'locked' | 'in-use';
}

// Chat persistence types (match Rust db.rs structs, snake_case from API)
export interface Chat {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  edited_at: string | null;
  position: number;
}

// Compatibility aliases
export type ChatMessage = Message;

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}

export interface GenerationParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  repetitionPenalty: number;
}
