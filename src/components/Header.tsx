import React from 'react';
import {
  Clock,
  Coins,
  Gem,
  Heart,
  Crown,
  Handshake,
  ShieldAlert,
  Languages,
  LogIn,
  LogOut,
} from 'lucide-react';
import { Player, GameRecord } from '../types/game';
import { DEFAULT_MAP_SIZE, DEFAULT_PLAYER_HEALTH } from '../game/rules';
import { useI18n } from '../i18n';

interface HeaderProps {
  game: GameRecord | null;
  secondsRemaining: number;
  viewingDay: number;
  player: Player | null;
  onTogglePeaceVote: () => void;
  onOpenAdmin: () => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  game,
  secondsRemaining,
  viewingDay,
  player,
  onTogglePeaceVote,
  onOpenAdmin,
  onOpenLogin,
  onLogout,
}) => {
  const { language, toggleLanguage, t } = useI18n();
  const mapSize = game?.mapSize ?? DEFAULT_MAP_SIZE;
  const maxHealth = game?.playerHealth ?? DEFAULT_PLAYER_HEALTH;
  const isUnstarted = !game || game.currentDay === 0 || game.endReason === 'waiting_to_start';
  const isHistorical = game && !isUnstarted ? viewingDay < game.currentDay : false;
  const isClosed = game?.phase === 'closed';
  const isGameOver = game?.phase === 'over';
  const endReasonLabel = game?.endReason
    ? (
        game.endReason === 'world_peace'
          ? t('World Peace')
          : game.endReason === 'last_player_standing'
          ? t('Last One Standing')
          : game.endReason === 'waiting_to_start'
          ? t('waiting to start')
          : ''
      ).toLocaleUpperCase(language === 'tr' ? 'tr-TR' : 'en-US')
    : '';

  const formatTimer = (totalSeconds: number) => {
    if (isUnstarted) return t('WAITING TO LAUNCH');
    if (isHistorical) return '00:00:00';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
                  {isUnstarted ? t('UNSTARTED') : t('DAY {day}', { day: viewingDay })}
                  {game && !isUnstarted && viewingDay !== game.currentDay && t(' (Live: Day {day})', { day: game.currentDay })}
                </span>
              </h1>
              <p className="hidden md:block text-xs text-zinc-400">
                {t('Turn-based {size}×{size} tactical strategy', { size: mapSize })}
              </p>
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
                  ? t('CLOSED (WAITING TO START)')
                  : isGameOver
                  ? t('GAME OVER ({reason})', { reason: endReasonLabel })
                  : isClosed
                  ? t('CLOSED PHASE (CALCULATING)')
                  : t('OPEN PHASE (ACTIONS OPEN)')}
              </span>
            </div>
            <div className="text-lg md:text-2xl font-mono font-extrabold text-white tracking-widest leading-tight">
              {formatTimer(secondsRemaining)}
            </div>
            <div className="hidden md:block text-[10px] text-zinc-400 font-mono">
              {isUnstarted
                ? t('Stage operatives before launching Day 1')
                : t('UTC Daily Cycle (02:00–24:00 Open | 00:00–02:00 Closed)')}
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
                    <span title={t('Administrator')}>
                      <Crown className="w-3.5 h-3.5 text-amber-400" />
                    </span>
                  )}
                  {!player.isAlive && !isUnstarted && (
                    <span className="text-[10px] bg-red-950 text-red-400 px-1 rounded font-bold">
                      {t('DEAD')}
                    </span>
                  )}
                </div>

                {/* Health & Points (if in active game) */}
                {!isUnstarted ? (
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span
                      className="flex items-center text-red-400"
                      title={t('Health (Max {max})', { max: maxHealth })}
                    >
                      <Heart className="w-3 h-3 mr-0.5 fill-red-500/30" />
                      {player.health}/{maxHealth}
                    </span>
                    <span className="flex items-center text-amber-300" title={t('Action Points')}>
                      <Coins className="w-3 h-3 mr-0.5 fill-amber-500/30" />
                      {player.points} {t('pts')}
                    </span>
                    <span className="flex items-center text-cyan-300" title={t('Persistent Tokens')}>
                      <Gem className="w-3 h-3 mr-0.5 fill-cyan-500/20" />
                      {player.tokens} {t('tokens')}
                    </span>
                  </div>
                ) : (
                  <div className="text-[10px] text-zinc-400 font-mono">
                    {t('Staged for deployment · {tokens} tokens', { tokens: player.tokens })}
                  </div>
                )}
              </div>

              {/* World Peace Toggle (only in active game, open phase, alive) */}
              {!isUnstarted && player.isAlive && !isGameOver && (
                <button
                  onClick={onTogglePeaceVote}
                  disabled={isClosed}
                  title={t('Toggle World Peace Vote')}
                  className={`text-xs px-2 py-1.5 rounded-lg border font-medium flex items-center gap-1 transition-colors ${
                    player.peaceVote === 'yes'
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600 hover:bg-emerald-900'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                  } ${isClosed ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Handshake className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">
                    {player.peaceVote === 'yes' ? t('Peace: YES') : t('Peace: NO')}
                  </span>
                </button>
              )}

              {/* Language Toggle */}
              <button
                onClick={toggleLanguage}
                title={t('Switch Language')}
                className="p-2 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 hover:text-white flex items-center gap-1"
              >
                <Languages className="w-4 h-4" />
                <span className="text-[10px] font-bold">{language.toUpperCase()}</span>
              </button>

              {/* Admin Console (single icon button, all viewports) */}
              {player.isAdmin && (
                <button
                  onClick={onOpenAdmin}
                  title={t('Admin Console')}
                  className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
                >
                  <ShieldAlert className="w-4 h-4" />
                </button>
              )}

              <button
                onClick={onLogout}
                title={t('Sign out')}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 hover:text-white text-[11px] font-semibold flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                {t('Sign out')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={toggleLanguage}
                title={t('Switch Language')}
                className="p-2 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 hover:text-white flex items-center gap-1"
              >
                <Languages className="w-4 h-4" />
                <span className="text-[10px] font-bold">{language.toUpperCase()}</span>
              </button>
              <button
                onClick={onOpenLogin}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <LogIn className="w-3.5 h-3.5" />
                {t('Not signed in')} · {t('Sign in')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
