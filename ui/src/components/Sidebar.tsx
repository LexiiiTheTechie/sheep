import type React from 'react';
import { 
  MessageSquare, 
  Cpu, 
  Sliders, 
  User, 
  Settings, 
  ShieldAlert, 
  LogOut 
} from 'lucide-react';
import type { TabId, SlotStatus, UserProfile } from '../types';

interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  user: UserProfile | null;
  slotStatus: SlotStatus;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  user,
  slotStatus,
  onLogout,
}) => {
  const isFull = slotStatus.activeUsers >= slotStatus.maxActiveUsers;

  return (
    <aside className="w-64 bg-neutral-900/90 border-r border-neutral-800 flex flex-col justify-between select-none">
      <div>
        {/* Brand Header */}
        <div className="h-14 flex items-center gap-3 px-5 border-b border-neutral-800">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-lg text-white shadow-md shadow-indigo-500/20">
            🐑
          </div>
          <div>
            <div className="font-semibold text-sm leading-none text-neutral-100 tracking-wide">
              Sheep
            </div>
            <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-widest font-mono">
              Desktop AI
            </div>
          </div>
        </div>

        {/* Slot Capacity Status Indicator */}
        <div className="px-4 py-3 mx-3 my-3 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-neutral-400 font-medium">Model Slots</span>
            <span className={`font-mono text-xs font-semibold ${
              isFull ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {slotStatus.activeUsers} / {slotStatus.maxActiveUsers}
            </span>
          </div>
          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 rounded-full ${
                isFull ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, (slotStatus.activeUsers / slotStatus.maxActiveUsers) * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-[10px] text-neutral-500 flex items-center justify-between">
            <span>{slotStatus.userHoldsSlot ? 'Slot claimed by you' : (isFull ? 'Locked (All slots full)' : 'Slot ready')}</span>
            <span className={`w-1.5 h-1.5 rounded-full ${slotStatus.userHoldsSlot ? 'bg-emerald-400 animate-pulse' : (isFull ? 'bg-amber-400' : 'bg-neutral-600')}`} />
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="px-2 space-y-1">
          <button
            onClick={() => onSelectTab('chat')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'chat'
                ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chat</span>
          </button>

          <button
            onClick={() => onSelectTab('model')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'model'
                ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Model</span>
          </button>

          <button
            onClick={() => onSelectTab('parameters')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'parameters'
                ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Parameters</span>
          </button>

          <div className="pt-3 mt-3 border-t border-neutral-800/80" />

          <button
            onClick={() => onSelectTab('account')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'account'
                ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Account</span>
          </button>

          <button
            onClick={() => onSelectTab('settings')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'settings'
                ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>

          {user?.role === 'owner' && (
            <button
              onClick={() => onSelectTab('admin')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'admin'
                  ? 'bg-purple-600/15 text-purple-400 border border-purple-500/30'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Admin</span>
            </button>
          )}
        </nav>
      </div>

      {/* User Footer & Logout */}
      <div className="p-3 border-t border-neutral-800 bg-neutral-950/40 flex items-center justify-between">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-7 h-7 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-semibold text-neutral-300">
            {user?.username ? user.username.slice(0, 2).toUpperCase() : 'U'}
          </div>
          <div className="overflow-hidden">
            <div className="text-xs font-medium text-neutral-200 truncate">
              {user?.username || 'Guest'}
            </div>
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
              {user?.role || 'User'}
            </div>
          </div>
        </div>

        <button
          onClick={onLogout}
          title="Sign out"
          className="p-1.5 rounded-md text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
