import React, { useState } from 'react';
import {
  Clock,
  Coins,
  Heart,
  Crown,
  Handshake,
  Settings,
  Edit3,
  X,
  Check,
  FastForward,
} from 'lucide-react';
import { Player, GameRecord } from '../types/game';

interface HeaderProps {
  game: GameRecord | null;
  secondsRemaining: number;
  viewingDay: number;
  player: Player | null;
  onTogglePeaceVote: () => void;
  onOpenAdmin: () => void;
  onProfileUpdated: () => void;
  onJumpPhase?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  game,
  secondsRemaining,
  viewingDay,
  player,
  onTogglePeaceVote,
  onOpenAdmin,
  onProfileUpdated,
  onJumpPhase,
}) => {
  const isUnstarted = !game || game.currentDay === 0 || game.endReason === 'waiting_to_start';
  const isHistorical = game && !isUnstarted ? viewingDay < game.currentDay : false;
  const isClosed = game?.phase === 'closed';
  const isGameOver = game?.phase === 'over';

  // Profile Edit modal
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileUsername, setProfileUsername] = useState(player?.username || '');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(player?.avatarUrl || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const formatTimer = (totalSeconds: number) => {
    if (isUnstarted) return 'WAITING TO LAUNCH';
    if (isHistorical) return '00:00:00';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileUsername.trim()) {
      setProfileError('Username cannot be empty');
      return;
    }
    setIsSavingProfile(true);
    setProfileError(null);

    try {
      const res = await fetch('/api/players/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: profileUsername.trim(),
          avatarUrl: profileAvatarUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setIsEditingProfile(false);
        onProfileUpdated();
      } else {
        setProfileError(data.error || 'Failed to update profile');
      }
    } catch (err: any) {
      setProfileError(err.message || 'Error updating profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur sticky top-0 z-40 px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Left: Branding & Day Badge */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-amber-600 to-rose-600 flex items-center justify-center font-black text-white shadow-lg shadow-amber-500/20">
              25
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                HEXGRID TACTICS
                <span className="text-xs px-2 py-0.5 rounded font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {isUnstarted ? 'UNSTARTED' : `DAY ${viewingDay}`}
                  {game && !isUnstarted && viewingDay !== game.currentDay && ` (Live: Day ${game.currentDay})`}
                </span>
              </h1>
              <p className="text-xs text-zinc-400">Turn-based 25×25 tactical strategy</p>
            </div>
          </div>

          {/* Admin button for mobile */}
          <div className="flex md:hidden items-center gap-1">
            {player?.isAdmin && (
              <button
                onClick={onOpenAdmin}
                className="p-2 rounded bg-zinc-800 text-amber-400 hover:bg-zinc-700"
                title="Admin Control"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Center: Large Phase & UTC Countdown Timer */}
        <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 shadow-inner">
          <Clock
            className={`w-5 h-5 ${
              isUnstarted
                ? 'text-amber-400'
                : isClosed
                ? 'text-amber-400 animate-pulse'
                : isGameOver
                ? 'text-purple-400'
                : 'text-emerald-400'
            }`}
          />
          <div className="text-center">
            <div className="flex items-center gap-2 justify-center">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.2 rounded-full ${
                  isUnstarted
                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                    : isGameOver
                    ? 'bg-purple-950 text-purple-300 border border-purple-800'
                    : isClosed
                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                }`}
              >
                {isUnstarted
                  ? 'CLOSED (WAITING TO START)'
                  : isGameOver
                  ? `GAME OVER (${game?.endReason?.replace(/_/g, ' ').toUpperCase()})`
                  : isClosed
                  ? 'CLOSED PHASE (CALCULATING)'
                  : 'OPEN PHASE (ACTIONS OPEN)'}
              </span>
            </div>
            <div className="text-2xl font-mono font-extrabold text-white tracking-widest leading-tight">
              {formatTimer(secondsRemaining)}
            </div>
            <div className="text-[10px] text-zinc-400 font-mono">
              {isUnstarted
                ? 'Stage operatives before launching Day 1'
                : 'UTC Daily Cycle (00:00–20:00 Open | 20:00–00:00 Closed)'}
            </div>
          </div>
        </div>

        {/* Right: Player Profile & Admin Controls */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          {player ? (
            <div className="flex items-center gap-2 bg-zinc-900/90 border border-zinc-800 rounded-xl p-1.5 pr-3">
              {/* Avatar: 1:1 rounded square */}
              <img
                src={player.avatarUrl}
                alt={player.username}
                className="w-9 h-9 rounded-lg bg-zinc-800 object-cover border border-zinc-700"
              />
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-zinc-100 truncate max-w-[110px]">
                    {player.username}
                  </span>
                  {player.isAdmin && (
                    <span title="Administrator">
                      <Crown className="w-3.5 h-3.5 text-amber-400" />
                    </span>
                  )}
                  {!player.isAlive && !isUnstarted && (
                    <span className="text-[10px] bg-red-950 text-red-400 px-1 rounded font-bold">
                      DEAD
                    </span>
                  )}
                  {/* Edit profile button */}
                  <button
                    onClick={() => {
                      setProfileUsername(player.username);
                      setProfileAvatarUrl(player.avatarUrl);
                      setIsEditingProfile(true);
                    }}
                    title="Change Profile"
                    className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                </div>

                {/* Health & Points (if in active game) */}
                {!isUnstarted ? (
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="flex items-center text-red-400" title="Health (Max 3)">
                      <Heart className="w-3 h-3 mr-0.5 fill-red-500/30" />
                      {player.health}/3
                    </span>
                    <span className="flex items-center text-amber-300" title="Action Points">
                      <Coins className="w-3 h-3 mr-0.5 fill-amber-500/30" />
                      {player.points} pts
                    </span>
                  </div>
                ) : (
                  <div className="text-[10px] text-zinc-400 font-mono">
                    Staged for deployment
                  </div>
                )}
              </div>

              {/* World Peace Toggle (only in active game, open phase, alive) */}
              {!isUnstarted && player.isAlive && !isGameOver && (
                <button
                  onClick={onTogglePeaceVote}
                  disabled={isClosed}
                  title="Toggle World Peace Vote"
                  className={`ml-1 text-xs px-2 py-1 rounded-lg border font-medium flex items-center gap-1 transition-colors ${
                    player.peaceVote === 'yes'
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600 hover:bg-emerald-900'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                  } ${isClosed ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Handshake className="w-3.5 h-3.5" />
                  {player.peaceVote === 'yes' ? 'Peace: YES' : 'Peace: NO'}
                </button>
              )}

              {/* Admin Button & Jump Phase */}
              {player.isAdmin && (
                <>
                  {onJumpPhase && !isUnstarted && !isGameOver && (
                    <button
                      onClick={onJumpPhase}
                      title={game?.phase === 'open' ? 'Jump to Closed Phase (Processes actions and starts 4h timer)' : 'Jump to Open Phase (Opens day and starts 20h timer)'}
                      className="hidden lg:flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/25 font-medium ml-1"
                    >
                      <FastForward className="w-3.5 h-3.5 fill-indigo-300" />
                      Jump to {game?.phase === 'open' ? 'Closed (4h)' : 'Open (20h)'}
                    </button>
                  )}
                  <button
                    onClick={onOpenAdmin}
                    className="hidden md:flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 font-medium ml-1"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Admin
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="text-xs text-zinc-400">Not signed in</div>
          )}
        </div>
      </div>

      {/* Edit Profile Popover Modal */}
      {isEditingProfile && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveProfile}
            className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 max-w-sm w-full flex flex-col gap-3 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Edit Operative Profile
              </h3>
              <button
                type="button"
                onClick={() => setIsEditingProfile(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {profileError && (
              <div className="text-xs text-red-400 bg-red-950/50 p-2 rounded border border-red-800">
                {profileError}
              </div>
            )}

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Codename / Username</label>
              <input
                type="text"
                required
                value={profileUsername}
                onChange={(e) => setProfileUsername(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Avatar Image URL</label>
              <input
                type="text"
                value={profileAvatarUrl}
                onChange={(e) => setProfileAvatarUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setIsEditingProfile(false)}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingProfile}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow disabled:opacity-50 flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                {isSavingProfile ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>
      )}
    </header>
  );
};
