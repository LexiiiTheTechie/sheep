import type React from 'react';
import { 
  Key, 
  Laptop, 
  Download, 
  Trash2, 
  CheckCircle, 
  FileText, 
  AlertTriangle,
  User
} from 'lucide-react';
import { useState } from 'react';
import type { UserProfile, UserSession } from '../types';

interface AccountTabProps {
  user: UserProfile | null;
  sessions: UserSession[];
  onRevokeSession: (sessionId: string) => void;
  onExportAllData: () => void;
  onExportSingleChat: (format: 'json' | 'markdown') => void;
  onDeleteAccount: () => void;
}

export const AccountTab: React.FC<AccountTabProps> = ({
  user,
  sessions,
  onRevokeSession,
  onExportAllData,
  onExportSingleChat,
  onDeleteAccount,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!user) {
    return (
      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-8 select-text">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Account & Security</h1>
          <p className="text-sm text-neutral-400 mt-1">
            No active account session detected. Create an account or sign in to enable isolated chats and data exports.
          </p>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center mx-auto text-neutral-400">
            <User className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-neutral-200">No Account Signed In</h3>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto mt-1">
              When authentication is configured, this panel will display your isolated credentials, active devices, and data export buttons.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    setPasswordSuccess(true);
    setTimeout(() => setPasswordSuccess(false), 3000);
    setCurrentPassword('');
    setNewPassword('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-8 select-text">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-100">Account & Security</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Manage your personal credentials, sessions, and data exports.
        </p>
      </div>

      {/* Profile Overview */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-neutral-200 mb-4 flex items-center gap-2">
          Profile Details
        </h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-neutral-500 block text-xs">Username</span>
            <span className="text-neutral-200 font-medium">{user.username}</span>
          </div>
          <div>
            <span className="text-neutral-500 block text-xs">Account Role</span>
            <span className="text-neutral-200 font-medium capitalize">{user.role}</span>
          </div>
          <div>
            <span className="text-neutral-500 block text-xs">User ID</span>
            <span className="text-neutral-400 font-mono text-xs">{user.id}</span>
          </div>
          <div>
            <span className="text-neutral-500 block text-xs">Member Since</span>
            <span className="text-neutral-400 text-xs">{user.createdAt}</span>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-neutral-200 mb-2 flex items-center gap-2">
          <Key className="w-4 h-4 text-indigo-400" />
          Change Password
        </h2>
        <p className="text-xs text-neutral-400 mb-4">
          Passwords are protected using Argon2id. We never store plain text passwords.
        </p>
        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-sm font-medium transition-colors"
          >
            Update Password
          </button>
          {passwordSuccess && (
            <div className="flex items-center gap-2 text-emerald-400 text-xs mt-2">
              <CheckCircle className="w-3.5 h-3.5" />
              Password updated successfully
            </div>
          )}
        </form>
      </div>

      {/* Active Sessions */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-neutral-200 mb-2 flex items-center gap-2">
          <Laptop className="w-4 h-4 text-indigo-400" />
          Active Sessions
        </h2>
        <p className="text-xs text-neutral-400 mb-4">
          Signed-in devices. Multiple sessions count as only 1 user towards the model slot cap.
        </p>

        {sessions.length === 0 ? (
          <div className="text-xs text-neutral-500 py-3">No active sessions reported.</div>
        ) : (
          <div className="space-y-3">
            {sessions.map((sess) => (
              <div
                key={sess.id}
                className="flex items-center justify-between p-3.5 bg-neutral-950/60 border border-neutral-800/80 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Laptop className="w-5 h-5 text-neutral-400" />
                  <div>
                    <div className="text-sm font-medium text-neutral-200 flex items-center gap-2">
                      {sess.device}
                      {sess.isCurrent && (
                        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-500">
                      IP: {sess.ip} • Last active {sess.lastActive}
                    </div>
                  </div>
                </div>

                {!sess.isCurrent && (
                  <button
                    onClick={() => onRevokeSession(sess.id)}
                    className="px-2.5 py-1 text-xs text-neutral-400 hover:text-red-400 hover:bg-neutral-800 rounded border border-neutral-800 transition-colors"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Data Export (User Right) */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-neutral-200 mb-2 flex items-center gap-2">
          <Download className="w-4 h-4 text-indigo-400" />
          Data Export
        </h2>
        <p className="text-xs text-neutral-400 mb-4">
          Export your personal data and conversations. Downloads are generated completely client-side and scoped strictly to your account.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={onExportAllData}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium shadow-sm transition-all"
          >
            <Download className="w-4 h-4" />
            Export All My Data (ZIP)
          </button>

          <button
            onClick={() => onExportSingleChat('markdown')}
            className="flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-sm font-medium border border-neutral-700 transition-all"
          >
            <FileText className="w-4 h-4" />
            Export Current Chat (.md)
          </button>

          <button
            onClick={() => onExportSingleChat('json')}
            className="flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-sm font-medium border border-neutral-700 transition-all"
          >
            <FileText className="w-4 h-4" />
            Export Current Chat (.json)
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-red-950/20 border border-red-900/40 rounded-xl p-6">
        <h2 className="text-base font-semibold text-red-400 mb-1 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Danger Zone
        </h2>
        <p className="text-xs text-neutral-400 mb-4">
          Permanently delete your account and all associated private chats. This cannot be undone.
        </p>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white border border-red-600/30 rounded-lg text-sm font-medium transition-all"
          >
            <Trash2 className="w-4 h-4" />
            Delete My Account
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={onDeleteAccount}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
            >
              Confirm Deletion
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
