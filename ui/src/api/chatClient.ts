import type { Chat, Message } from '../types';

class ChatClient {
  private getBaseUrl(): string {
    if (typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
      return '';
    }
    return 'http://127.0.0.1:7850';
  }

  private getHeaders(): Record<string, string> {
    const token = localStorage.getItem('sheep_session_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async listChats(): Promise<Chat[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/chats`, { headers: this.getHeaders() });
      if (!res.ok) return [];
      return await res.json();
    } catch { return []; }
  }

  async createChat(title?: string): Promise<Chat> {
    const res = await fetch(`${this.getBaseUrl()}/api/chats`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ title: title ?? 'New Conversation' }),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }

  async renameChat(chatId: string, title: string): Promise<void> {
    await fetch(`${this.getBaseUrl()}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ title }),
    });
  }

  async deleteChat(chatId: string): Promise<void> {
    await fetch(`${this.getBaseUrl()}/api/chats/${chatId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
  }

  async getMessages(chatId: string): Promise<Message[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/chats/${chatId}/messages`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) return [];
      return await res.json();
    } catch { return []; }
  }

  async appendMessage(chatId: string, role: string, content: string): Promise<Message> {
    const res = await fetch(`${this.getBaseUrl()}/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ role, content }),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }

  async editMessage(chatId: string, msgId: string, content: string): Promise<void> {
    await fetch(`${this.getBaseUrl()}/api/chats/${chatId}/messages/${msgId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ content }),
    });
  }

  async deleteMessage(chatId: string, msgId: string): Promise<void> {
    await fetch(`${this.getBaseUrl()}/api/chats/${chatId}/messages/${msgId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
  }

  async truncateAfter(chatId: string, msgId: string): Promise<void> {
    await fetch(`${this.getBaseUrl()}/api/chats/${chatId}/messages/${msgId}/truncate`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
  }

  async autoTitle(chatId: string, firstUserMessage: string): Promise<void> {
    const title = firstUserMessage.slice(0, 60).trim();
    await this.renameChat(chatId, title || 'New Conversation');
  }
}

export const chatClient = new ChatClient();
