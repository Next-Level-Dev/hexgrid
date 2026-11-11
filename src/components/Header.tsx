import React, { useState } from 'react';
import {
  Clock,
  Coins,
  Heart,
  Crown,
  Handshake,
  ShieldAlert,
  Edit3,
  X,
  Check,
} from 'lucide-react';
import { Player, GameRecord } from '../types/game';
import { DEFAULT_MAP_SIZE } from '../game/rules';

interface HeaderProps {
  game: GameRecord | null;
  secondsRemaining: number;
  viewingDay: number;
  player: Player | null;
  onTogglePeaceVote: () => void;
  onOpenAdmin: () => void;
  onProfileUpdated: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  game,
  secondsRemaining,
  viewingDay,
  player,
  onTogglePeaceVote,
  onOpenAdmin,
  onProfileUpdated,
}) => {
  const mapSize = game?.mapSize ?? DEFAULT_MAP_SIZE;
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
    <header className="border-b border-zinc-800 bg-zinc-950/95 backdrop-blur sticky top-0 z-40 px-3 md:px-4 py-2 md:py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2 md:gap-3">
        {/* Left: Branding & Day Badge */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-amber-600 flex items-center justify-center font-black text-white text-sm shrink-0">
              {mapSize}
            </div>
            <div className="min-w-0">
              <h1 className="text-sm md:text-base font-bold tracking-tight text-white flex items-center gap-1.5 truncate">
                HEXGRID TACTICS
                <span className="text-[10px] md:text-xs px-1.5 py-0.5 rounded font-mono bg-zinc-800 text-zinc-300 border border-zinc-700 shrink-0">
                  {isUnstarted ? 'UNSTARTED' : `DAY ${viewingDay}`}
                  {game && !isUnstarted && viewingDay !== game.currentDay && ` (Live: Day ${game.currentDay})`}
                </span>
              </h1>
              <p className="hidden md:block text-xs text-zinc-400">Turn-based {mapSize}×{mapSize} tactical strategy</p>
            </div>
          </div>
        </div>

        {/* Center: Large Phase & UTC Countdown Timer */}
        <div className="w-full md:w-auto flex items-center justify-center gap-2 md:gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-3 md:px-4 py-1.5 md:py-2">
          <Clock
            className={`w-4 h-4 md:w-5 md:h-5 shrink-0 ${
              isUnstarted
                ? 'text-amber-400'
                : isClosed
                ? 'text-amber-400'
                : isGameOver
                ? 'text-purple-400'
                : 'text-emerald-400'
            }`}
          />
          <div className="text-center min-w-0">
            <div className="flex items-center gap-2 justify-center">
              <span
                className={`text-[9px] md:text-[10px] font-bold uppercase tracking-wider px-2 py-0.2 rounded-full ${
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
            <div className="text-lg md:text-2xl font-mono font-extrabold text-white tracking-widest leading-tight">
              {formatTimer(secondsRemaining)}
            </div>
            <div className="hidden md:block text-[10px] text-zinc-400 font-mono">
              {isUnstarted
                ? 'Stage operatives before launching Day 1'
                : 'UTC Daily Cycle (02:00–24:00 Open | 00:00–02:00 Closed)'}
            </div>
          </div>
        </div>

        {/* Right: Player Profile & Admin Controls */}
        <div className="flex items-center gap-2 md:gap-3 w-full md:w-auto justify-end">
          {player ? (
            <div className="flex flex-wrap items-center gap-2 bg-zinc-900/90 border border-zinc-800 rounded-xl p-1.5 md:pr-3">
              {/* Avatar: 1:1 rounded square */}
              <img
                src={player.avatarUrl}
                alt={player.username}
                className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-zinc-800 object-cover border border-zinc-700"
              />
              <div className="text-left min-w-0">
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
                    className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
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
                  className={`text-xs px-2 py-1.5 rounded-lg border font-medium flex items-center gap-1 transition-colors ${
                    player.peaceVote === 'yes'
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600 hover:bg-emerald-900'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                  } ${isClosed ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Handshake className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">
                    {player.peaceVote === 'yes' ? 'Peace: YES' : 'Peace: NO'}
                  </span>
                </button>
              )}

              {/* Admin Console (single icon button, all viewports) */}
              {player.isAdmin && (
                <button
                  onClick={onOpenAdmin}
                  title="Admin Console"
                  className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
                >
                  <ShieldAlert className="w-4 h-4" />
                </button>
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
