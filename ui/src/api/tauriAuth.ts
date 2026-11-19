import { invoke } from '@tauri-apps/api/core';
import type { UserProfile, UserSession, SlotStatus } from '../types';

export const tauriAuth = {
  async checkFirstRun(): Promise<boolean> {
    try {
      return await invoke<boolean>('check_first_run');
    } catch {
      return false;
    }
  },

  async setupOwner(username: string, password: string): Promise<UserProfile> {
    return await invoke<UserProfile>('setup_owner', { username, password });
  },

  async login(username: string, password: string): Promise<[UserProfile, string]> {
    return await invoke<[UserProfile, string]>('login', { username, password });
  },

  async getCurrentUser(sessionId: string): Promise<UserProfile | null> {
    return await invoke<UserProfile | null>('get_current_user', { sessionId });
  },

  async logout(sessionId: string, userId?: string): Promise<void> {
    await invoke('logout', { sessionId, userId });
  },

  async getUserSessions(userId: string, currentSession: string): Promise<UserSession[]> {
    return await invoke<UserSession[]>('get_user_sessions', { userId, currentSession });
  },

  async revokeSession(sessionId: string): Promise<void> {
    await invoke('revoke_session', { sessionId });
  },

  async updatePassword(userId: string, oldPass: string, newPass: string): Promise<void> {
    await invoke('update_password', { userId, oldPass, newPass });
  },

  async deleteAccount(userId: string): Promise<void> {
    await invoke('delete_account', { userId });
  },

  // Slot Management
  async getSlotStatus(userId?: string): Promise<SlotStatus> {
    const raw = await invoke<{
      active_users: number;
      max_active_users: number;
      user_holds_slot: boolean;
      state: 'available' | 'locked' | 'in-use';
    }>('get_slot_status', { userId });

    return {
      activeUsers: raw.active_users,
      maxActiveUsers: raw.max_active_users,
      userHoldsSlot: raw.user_holds_slot,
      state: raw.state,
    };
  },

  async claimSlot(userId: string, sessionId: string): Promise<SlotStatus> {
    const raw = await invoke<{
      active_users: number;
      max_active_users: number;
      user_holds_slot: boolean;
      state: 'available' | 'locked' | 'in-use';
    }>('claim_slot', { userId, sessionId });

    return {
      activeUsers: raw.active_users,
      maxActiveUsers: raw.max_active_users,
      userHoldsSlot: raw.user_holds_slot,
      state: raw.state,
    };
  },

  async releaseSlot(userId: string, sessionId?: string): Promise<SlotStatus> {
    const raw = await invoke<{
      active_users: number;
      max_active_users: number;
      user_holds_slot: boolean;
      state: 'available' | 'locked' | 'in-use';
    }>('release_slot', { userId, sessionId });

    return {
      activeUsers: raw.active_users,
      maxActiveUsers: raw.max_active_users,
      userHoldsSlot: raw.user_holds_slot,
      state: raw.state,
    };
  },

  async adminForceRelease(userId: string, callerId: string): Promise<void> {
    await invoke('admin_force_release', { userId, callerId });
  },

  async setMaxActiveUsers(limit: number, userId: string): Promise<void> {
    await invoke('set_max_active_users', { limit, userId });
  },
};
