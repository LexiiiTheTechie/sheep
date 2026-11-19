import type { UserProfile, UserSession, SlotStatus } from '../types';

/**
 * Universal Auth & Slot Client
 * Dynamically resolves port: in Tauri desktop window (custom scheme or file://),
 * it points to http://127.0.0.1:7850.
 * In a browser (http://localhost:7850), it uses relative URLs.
 */
class AuthClient {
  private getBaseUrl(): string {
    if (typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
      return '';
    }
    return 'http://127.0.0.1:7850';
  }

  private getHeaders(): Record<string, string> {
    const token = localStorage.getItem('sheep_session_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async checkFirstRun(): Promise<boolean> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/auth/first-run`);
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.is_first_run;
    } catch {
      return false;
    }
  }

  async setupOwner(username: string, password: string): Promise<UserProfile> {
    const res = await fetch(`${this.getBaseUrl()}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    return await res.json();
  }

  async login(username: string, password: string): Promise<[UserProfile, string]> {
    const res = await fetch(`${this.getBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, device: navigator.userAgent }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    const data = await res.json();
    localStorage.setItem('sheep_session_token', data.session_id);
    return [data.user, data.session_id];
  }

  async getMe(): Promise<UserProfile | null> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/auth/me`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${this.getBaseUrl()}/api/auth/logout`, {
        method: 'POST',
        headers: this.getHeaders(),
      });
    } finally {
      localStorage.removeItem('sheep_session_token');
    }
  }

  async updatePassword(userId: string, oldPass: string, newPass: string): Promise<void> {
    const res = await fetch(`${this.getBaseUrl()}/api/auth/password`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ user_id: userId, old_pass: oldPass, new_pass: newPass }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
  }

  async getSessions(userId: string): Promise<UserSession[]> {
    const res = await fetch(`${this.getBaseUrl()}/api/auth/sessions/${userId}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) return [];
    return await res.json();
  }

  async revokeSession(sessionId: string): Promise<void> {
    await fetch(`${this.getBaseUrl()}/api/auth/sessions/revoke/${sessionId}`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
  }

  async deleteAccount(userId: string): Promise<void> {
    await fetch(`${this.getBaseUrl()}/api/auth/delete-account/${userId}`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    localStorage.removeItem('sheep_session_token');
  }

  // Slot Management
  async getSlotStatus(): Promise<SlotStatus> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/slots/status`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) {
        return { activeUsers: 0, maxActiveUsers: 3, userHoldsSlot: false, state: 'available' };
      }
      const raw = await res.json();
      return {
        activeUsers: raw.active_users,
        maxActiveUsers: raw.max_active_users,
        userHoldsSlot: raw.user_holds_slot,
        state: raw.state,
      };
    } catch {
      return { activeUsers: 0, maxActiveUsers: 3, userHoldsSlot: false, state: 'available' };
    }
  }

  async claimSlot(userId: string): Promise<SlotStatus> {
    const token = localStorage.getItem('sheep_session_token') || 'local';
    const res = await fetch(`${this.getBaseUrl()}/api/slots/claim`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ user_id: userId, session_id: token }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    const raw = await res.json();
    return {
      activeUsers: raw.active_users,
      maxActiveUsers: raw.max_active_users,
      userHoldsSlot: raw.user_holds_slot,
      state: raw.state,
    };
  }

  async releaseSlot(userId: string): Promise<SlotStatus> {
    const token = localStorage.getItem('sheep_session_token') || 'local';
    const res = await fetch(`${this.getBaseUrl()}/api/slots/release`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ user_id: userId, session_id: token }),
    });
    const raw = await res.json();
    return {
      activeUsers: raw.active_users,
      maxActiveUsers: raw.max_active_users,
      userHoldsSlot: raw.user_holds_slot,
      state: raw.state,
    };
  }

  async setMaxActiveUsers(limit: number, userId: string): Promise<void> {
    const res = await fetch(`${this.getBaseUrl()}/api/slots/limit`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ limit, user_id: userId }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
  }
}

export const authClient = new AuthClient();
