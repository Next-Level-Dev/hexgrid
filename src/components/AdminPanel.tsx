import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  UserPlus,
  ShieldAlert,
  FastForward,
  RotateCcw,
  Copy,
  Check,
  Edit2,
  Lock,
  Terminal,
  Link,
  Play,
  Key,
  Handshake,
  AlertTriangle,
} from 'lucide-react';
import { Player, GameRecord, BuildingType } from '../types/game';
import {
  ALL_BUILDING_TYPES,
  DEFAULT_MAP_SIZE,
  DEFAULT_PLAYER_HEALTH,
  DEFAULT_REWARD_POOL,
  DEFAULT_MINE_LIMIT,
  DEFAULT_MINE_LIMIT_INCREASE_DAYS,
  DEFAULT_ASSASSINATION_COST,
  MAP_SIZE_OPTIONS,
  PLAYER_HEALTH_OPTIONS,
  createDefaultBuildingConfig,
} from '../game/rules';

const BUILDING_LABELS: Record<BuildingType, string> = {
  mine: 'Mine',
  outpost: 'Outpost',
  silo: 'Nuclear Silo',
  bank: 'Bank',
};

interface StartGameConfig {
  mapSize: number;
  playerHealth: number;
  rewardPool: number;
  enabledBuildings: Record<BuildingType, boolean>;
  mineLimit: number;
  mineLimitIncreaseDays: number;
  assassinationCost: number;
}

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  game: GameRecord | null;
  allPlayers: Player[];
  onPlayerUpdated: () => void;
  onResolveDay: () => void;
  onResetGame: () => void;
  onStartGame: (config: StartGameConfig) => void;
  onToggleBuilding: (buildingType: BuildingType, enabled: boolean) => void;
  onUpdateRewardPool: (rewardPool: number) => void;
  onUpdateMineRules: (mineLimit: number, mineLimitIncreaseDays: number) => void;
  onUpdateAssassinationCost: (assassinationCost: number) => void;
  onEndGameWorldPeace: () => void;
  isProcessing: boolean;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  isOpen,
  onClose,
  game,
  allPlayers,
  onPlayerUpdated,
  onResolveDay,
  onResetGame,
  onStartGame,
  onToggleBuilding,
  onUpdateRewardPool,
  onUpdateMineRules,
  onUpdateAssassinationCost,
  onEndGameWorldPeace,
  isProcessing,
}) => {
  // Create player form state
  const [newUsername, setNewUsername] = useState('');
  const [newAvatarUrl, setNewAvatarUrl] = useState('');
  const [createSuccessMsg, setCreateSuccessMsg] = useState<string | null>(null);
  const [createErrorMsg, setCreateErrorMsg] = useState<string | null>(null);
  const [isCreatingPlayer, setIsCreatingPlayer] = useState(false);

  // Auth link per player map: { [playerId]: { token: string; url: string; expiresAt: string } }
  const [authLinks, setAuthLinks] = useState<Record<string, { token: string; url: string; expiresAt: string }>>({});
  const [copiedPlayerId, setCopiedPlayerId] = useState<string | null>(null);
  const [generatingLinkForId, setGeneratingLinkForId] = useState<string | null>(null);

  // Edit player state
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Audit logs
  const [auditLogs, setAuditLogs] = useState<Array<{ timestamp: string; level: string; message: string }>>([]);
  const [showLogs, setShowLogs] = useState(false);

  // Next-game settings
  const [startMapSize, setStartMapSize] = useState<number>(DEFAULT_MAP_SIZE);
  const [startPlayerHealth, setStartPlayerHealth] = useState<number>(DEFAULT_PLAYER_HEALTH);
  const [startRewardPool, setStartRewardPool] = useState<number>(DEFAULT_REWARD_POOL);
  const [activeRewardPool, setActiveRewardPool] = useState<number>(DEFAULT_REWARD_POOL);
  const [startMineLimit, setStartMineLimit] = useState<number>(DEFAULT_MINE_LIMIT);
  const [startMineLimitIncreaseDays, setStartMineLimitIncreaseDays] = useState<number>(
    DEFAULT_MINE_LIMIT_INCREASE_DAYS
  );
  const [activeMineLimit, setActiveMineLimit] = useState<number>(DEFAULT_MINE_LIMIT);
  const [activeMineLimitIncreaseDays, setActiveMineLimitIncreaseDays] = useState<number>(
    DEFAULT_MINE_LIMIT_INCREASE_DAYS
  );
  const [startAssassinationCost, setStartAssassinationCost] = useState<number>(
    DEFAULT_ASSASSINATION_COST
  );
  const [activeAssassinationCost, setActiveAssassinationCost] = useState<number>(
    DEFAULT_ASSASSINATION_COST
  );
  const [startBuildings, setStartBuildings] = useState<Record<BuildingType, boolean>>(
    createDefaultBuildingConfig()
  );

  // Early world-peace flow: 5s hold, then a yes-clicked-twice confirmation.
  const [holdProgress, setHoldProgress] = useState<number>(0);
  const [showEndPrompt, setShowEndPrompt] = useState<boolean>(false);
  const [endConfirmStep, setEndConfirmStep] = useState<number>(0);
  const holdIntervalRef = useRef<number | null>(null);

  const stopHold = () => {
    if (holdIntervalRef.current !== null) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setHoldProgress(0);
  };

  useEffect(() => {
    return () => {
      if (holdIntervalRef.current !== null) {
        window.clearInterval(holdIntervalRef.current);
        holdIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopHold();
      setShowEndPrompt(false);
      setEndConfirmStep(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (game && game.currentDay > 0 && game.phase !== 'over') {
      setActiveRewardPool(game.rewardPool);
      setActiveMineLimit(game.mineLimit);
      setActiveMineLimitIncreaseDays(game.mineLimitIncreaseDays);
      setActiveAssassinationCost(game.assassinationCost);
    }
  }, [
    game?.id,
    game?.currentDay,
    game?.phase,
    game?.rewardPool,
    game?.mineLimit,
    game?.mineLimitIncreaseDays,
    game?.assassinationCost,
  ]);

  if (!isOpen) return null;

  const isUnstarted = !game || game.currentDay === 0 || game.endReason === 'waiting_to_start';
  const isGameOver = game?.phase === 'over';
  const isStagingNextGame = isUnstarted || isGameOver;
  const activeBuildings = game?.enabledBuildings ?? createDefaultBuildingConfig();
  const shownBuildings = isStagingNextGame ? startBuildings : activeBuildings;
  const shownMapSize = isStagingNextGame ? startMapSize : game?.mapSize ?? DEFAULT_MAP_SIZE;
  const shownPlayerHealth = isStagingNextGame
    ? startPlayerHealth
    : game?.playerHealth ?? DEFAULT_PLAYER_HEALTH;
  const shownRewardPool = isStagingNextGame ? startRewardPool : activeRewardPool;
  const shownMineLimit = isStagingNextGame ? startMineLimit : activeMineLimit;
  const shownMineLimitIncreaseDays = isStagingNextGame
    ? startMineLimitIncreaseDays
    : activeMineLimitIncreaseDays;
  const mineRulesChanged =
    !isStagingNextGame &&
    (activeMineLimit !== game?.mineLimit ||
      activeMineLimitIncreaseDays !== game?.mineLimitIncreaseDays);
  const shownAssassinationCost = isStagingNextGame
    ? startAssassinationCost
    : activeAssassinationCost;
  const assassinationCostChanged =
    !isStagingNextGame && activeAssassinationCost !== game?.assassinationCost;

  const startHold = () => {
    if (isUnstarted || isGameOver || isProcessing || showEndPrompt) return;
    if (holdIntervalRef.current !== null) return;

    const startedAt = Date.now();
    holdIntervalRef.current = window.setInterval(() => {
      const progress = Math.min(100, ((Date.now() - startedAt) / 5000) * 100);
      setHoldProgress(progress);
      if (progress >= 100) {
        stopHold();
        setEndConfirmStep(0);
        setShowEndPrompt(true);
      }
    }, 50);
  };

  const handleConfirmEnd = () => {
    if (endConfirmStep === 0) {
      setEndConfirmStep(1);
      return;
    }
    setShowEndPrompt(false);
    setEndConfirmStep(0);
    onEndGameWorldPeace();
  };

  const cancelEndPrompt = () => {
    setShowEndPrompt(false);
    setEndConfirmStep(0);
  };

  const handleBuildingToggle = (type: BuildingType) => {
    if (isStagingNextGame) {
      setStartBuildings((prev) => ({ ...prev, [type]: !prev[type] }));
      return;
    }
    onToggleBuilding(type, !activeBuildings[type]);
  };

  const handleCreatePlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;
    setIsCreatingPlayer(true);
    setCreateSuccessMsg(null);
    setCreateErrorMsg(null);

    try {
      const res = await fetch('/api/admin/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          avatarUrl: newAvatarUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreateSuccessMsg(`Player "${data.player.username}" created successfully.`);
        setNewUsername('');
        setNewAvatarUrl('');
        onPlayerUpdated();
        setTimeout(() => setCreateSuccessMsg(null), 4000);
      } else {
        setCreateErrorMsg(data.error || 'Failed to create player');
      }
    } catch (err: any) {
      setCreateErrorMsg(err.message || 'Error creating player');
    } finally {
      setIsCreatingPlayer(false);
    }
  };

  const handleGenerateAuthLink = async (playerId: string) => {
    setGeneratingLinkForId(playerId);
    try {
      const res = await fetch(`/api/admin/players/${playerId}/auth-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.invitation) {
        const fullUrl = `${window.location.origin}${data.invitation.inviteUrl}`;
        setAuthLinks((prev) => ({
          ...prev,
          [playerId]: {
            token: data.invitation.token,
            url: fullUrl,
            expiresAt: data.invitation.expiresAt,
          },
        }));
      } else {
        alert(data.error || 'Failed to generate auth link');
      }
    } catch (err: any) {
      alert(err.message || 'Error generating auth link');
    } finally {
      setGeneratingLinkForId(null);
    }
  };

  const handleUpdatePlayer = async (playerId: string) => {
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/admin/players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: editUsername.trim() || undefined,
          avatarUrl: editAvatar.trim() || undefined,
        }),
      });
      if (res.ok) {
        setEditingPlayerId(null);
        onPlayerUpdated();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update player');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update player');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleResetSessions = async (playerId: string) => {
    if (!confirm('Revoke all sessions for this player?')) return;
    try {
      await fetch(`/api/admin/players/${playerId}/reset-sessions`, { method: 'POST' });
      alert('All sessions for player revoked.');
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await fetch('/api/admin/audit-logs');
      const data = await res.json();
      setAuditLogs(data.logs || []);
      setShowLogs(true);
    } catch (err) {
      console.error(err);
    }
  };

  const copyToClipboard = (text: string, playerId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPlayerId(playerId);
    setTimeout(() => setCopiedPlayerId(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 md:p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-3 md:p-5 flex flex-col gap-3 md:gap-5 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              ADMINISTRATIVE COMMAND CONSOLE
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. Game Lifecycle & Round Controls */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300">
              Game Lifecycle & Operational Triggers
            </h4>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
              {isUnstarted ? 'STATUS: CLOSED (UNSTARTED)' : `STATUS: DAY ${game?.currentDay} (${game?.phase.toUpperCase()})`}
            </span>
          </div>

          <p className="text-xs text-zinc-400">
            {isUnstarted
              ? 'The game is currently unstarted. When all operatives are provisioned, launch Day 1 to spawn all players.'
              : 'The game is active. Resolve the current day to calculate planned actions and advance to the next day, or reset back to unstarted.'}
          </p>

          {/* Per-game settings */}
          <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold text-zinc-200">Map Size</div>
                <div className="text-[10px] text-zinc-500">
                  {isStagingNextGame
                    ? 'Choose the board size for the next game.'
                    : 'Map size is fixed once the game has started.'}
                </div>
              </div>
              {isStagingNextGame ? (
                <select
                  value={startMapSize}
                  onChange={(e) => setStartMapSize(parseInt(e.target.value, 10))}
                  className="bg-zinc-950 border border-zinc-700 text-xs text-white rounded-lg px-2 py-1.5"
                >
                  {MAP_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size} × {size}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs font-mono text-amber-300 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5">
                  {shownMapSize} × {shownMapSize}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold text-zinc-200">Player Health</div>
                <div className="text-[10px] text-zinc-500">
                  {isStagingNextGame
                    ? 'Starting and maximum HP for every operative.'
                    : 'Health is fixed once the game has started.'}
                </div>
              </div>
              {isStagingNextGame ? (
                <select
                  value={startPlayerHealth}
                  onChange={(e) => setStartPlayerHealth(parseInt(e.target.value, 10))}
                  className="bg-zinc-950 border border-zinc-700 text-xs text-white rounded-lg px-2 py-1.5"
                >
                  {PLAYER_HEALTH_OPTIONS.map((health) => (
                    <option key={health} value={health}>
                      {health} HP
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs font-mono text-amber-300 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5">
                  {shownPlayerHealth} HP
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold text-zinc-200">Token Reward Pool</div>
                <div className="text-[10px] text-zinc-500">
                  {isStagingNextGame
                    ? 'Tokens split equally among surviving winners. Default: 100.'
                    : 'Editable mid-game. Split equally among survivors, rounded down.'}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={shownRewardPool}
                  disabled={isProcessing}
                  onChange={(e) => {
                    const next = Math.max(0, parseInt(e.target.value, 10) || 0);
                    if (isStagingNextGame) setStartRewardPool(next);
                    else setActiveRewardPool(next);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isStagingNextGame) {
                      onUpdateRewardPool(activeRewardPool);
                    }
                  }}
                  className="w-24 bg-zinc-950 border border-zinc-700 text-xs text-white rounded-lg px-2 py-1.5 text-right font-mono disabled:opacity-50"
                />
                {!isStagingNextGame && activeRewardPool !== game?.rewardPool && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => onUpdateRewardPool(activeRewardPool)}
                    className="px-2 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[11px] font-bold rounded-lg disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold text-zinc-200">Mine Limit</div>
                <div className="text-[10px] text-zinc-500">
                  {isStagingNextGame
                    ? 'Mines each player may place over the whole game. Destroyed mines still count.'
                    : 'Editable mid-game. Destroyed mines still count toward the total.'}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <input
                  type="number"
                  min="0"
                  max="99"
                  step="1"
                  value={shownMineLimit}
                  disabled={isProcessing}
                  onChange={(e) => {
                    const next = Math.max(0, parseInt(e.target.value, 10) || 0);
                    if (isStagingNextGame) setStartMineLimit(next);
                    else setActiveMineLimit(next);
                  }}
                  className="w-16 bg-zinc-950 border border-zinc-700 text-xs text-white rounded-lg px-2 py-1.5 text-right font-mono disabled:opacity-50"
                  title="Base mines per player"
                />
                <span className="text-[10px] text-zinc-500">mines, +1 every</span>
                <input
                  type="number"
                  min="1"
                  max="999"
                  step="1"
                  value={shownMineLimitIncreaseDays}
                  disabled={isProcessing}
                  onChange={(e) => {
                    const next = Math.max(1, parseInt(e.target.value, 10) || 1);
                    if (isStagingNextGame) setStartMineLimitIncreaseDays(next);
                    else setActiveMineLimitIncreaseDays(next);
                  }}
                  className="w-16 bg-zinc-950 border border-zinc-700 text-xs text-white rounded-lg px-2 py-1.5 text-right font-mono disabled:opacity-50"
                  title="Days between mine limit increases"
                />
                <span className="text-[10px] text-zinc-500">days</span>
                {!isStagingNextGame && mineRulesChanged && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() =>
                      onUpdateMineRules(activeMineLimit, activeMineLimitIncreaseDays)
                    }
                    className="px-2 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[11px] font-bold rounded-lg disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold text-zinc-200">Assassination Cost</div>
                <div className="text-[10px] text-zinc-500">
                  {isStagingNextGame
                    ? 'Points for 1 guaranteed damage with unlimited range. 0 disables it.'
                    : 'Editable mid-game. 0 disables assassination.'}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  max="99"
                  step="1"
                  value={shownAssassinationCost}
                  disabled={isProcessing}
                  onChange={(e) => {
                    const next = Math.max(0, parseInt(e.target.value, 10) || 0);
                    if (isStagingNextGame) setStartAssassinationCost(next);
                    else setActiveAssassinationCost(next);
                  }}
                  className="w-16 bg-zinc-950 border border-zinc-700 text-xs text-white rounded-lg px-2 py-1.5 text-right font-mono disabled:opacity-50"
                  title="Assassination cost in points (0 = disabled)"
                />
                <span className="text-[10px] text-zinc-500">pts</span>
                {!isStagingNextGame && assassinationCostChanged && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => onUpdateAssassinationCost(activeAssassinationCost)}
                    className="px-2 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[11px] font-bold rounded-lg disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-zinc-200 mb-1">Buildings</div>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_BUILDING_TYPES.map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-2 text-[11px] text-zinc-300 bg-zinc-900/70 border border-zinc-800 rounded-lg px-2 py-1.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={shownBuildings[type]}
                      disabled={isProcessing}
                      onChange={() => handleBuildingToggle(type)}
                      className="accent-amber-500"
                    />
                    <span>{BUILDING_LABELS[type]}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">
                Disabling a building blocks new construction and interactions with existing ones.
                Existing buildings stay on the map.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Start Game Button (if unstarted or game over) */}
            {(isUnstarted || isGameOver) && (
              <button
                disabled={isProcessing}
                onClick={() =>
                  onStartGame({
                    mapSize: startMapSize,
                    playerHealth: startPlayerHealth,
                    rewardPool: startRewardPool,
                    enabledBuildings: startBuildings,
                    mineLimit: startMineLimit,
                    mineLimitIncreaseDays: startMineLimitIncreaseDays,
                    assassinationCost: startAssassinationCost,
                  })
                }
                className="min-h-11 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-xs uppercase tracking-wider rounded-lg flex items-center gap-1.5 disabled:opacity-40"
              >
                <Play className="w-4 h-4 fill-zinc-950" />
                {isProcessing ? 'Starting...' : `Launch Game (Spawn ${allPlayers.length} Operative${allPlayers.length === 1 ? '' : 's'})`}
              </button>
            )}

            {/* Resolve Current Day Button (only during the open phase) */}
            {!isUnstarted && !isGameOver && game?.phase === 'open' && (
              <button
                disabled={isProcessing}
                onClick={onResolveDay}
                className="min-h-11 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg flex items-center gap-1.5 disabled:opacity-40"
                title="Instantly calculates today's planned actions and advances to the next day. The timer stays the same — the new day still ends at its scheduled UTC boundary."
              >
                <FastForward className="w-4 h-4 fill-white" />
                {isProcessing ? 'Resolving Day...' : 'Resolve Current Day'}
              </button>
            )}

            {/* End the game early with World Peace (5s hold + double confirmation) */}
            {!isUnstarted && !isGameOver && (
              <button
                type="button"
                disabled={isProcessing}
                onPointerDown={startHold}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                onContextMenu={(e) => e.preventDefault()}
                title="Hold for 5 seconds, then confirm twice. Ends the game and splits tokens equally among surviving winners."
                className="relative overflow-hidden min-h-11 px-4 py-2 bg-red-950 hover:bg-red-900 text-red-200 font-bold text-xs uppercase tracking-wider rounded-lg border border-red-700/70 flex items-center gap-1.5 disabled:opacity-40 select-none touch-none"
              >
                <span
                  className="absolute inset-y-0 left-0 bg-red-600/60 transition-[width] duration-75"
                  style={{ width: `${holdProgress}%` }}
                />
                <span className="relative z-10 flex items-center gap-1.5">
                  <Handshake className="w-4 h-4" />
                  {holdProgress > 0
                    ? `Hold... ${Math.floor(holdProgress)}%`
                    : 'Hold 5s: World Peace'}
                </span>
              </button>
            )}

            {/* Reset to unstarted state */}
            {!isUnstarted && (
              <button
                onClick={() => {
                  if (confirm('Reset to unstarted closed state? Active game state will be cleared.')) {
                    onResetGame();
                  }
                }}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg border border-zinc-700 flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                Reset to Waiting State
              </button>
            )}

            <button
              onClick={fetchAuditLogs}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700 flex items-center gap-1.5"
            >
              <Terminal className="w-4 h-4" />
              View Logs
            </button>
          </div>
        </div>

        {/* Audit Logs Viewer */}
        {showLogs && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300">Audit & Failure Logs</span>
              <button
                onClick={() => setShowLogs(false)}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Close Logs
              </button>
            </div>
            <div className="bg-zinc-950 p-2 rounded-lg max-h-40 overflow-y-auto font-mono text-[10px] text-zinc-400 space-y-1">
              {auditLogs.map((l, i) => (
                <div key={i} className={l.level === 'error' ? 'text-red-400' : 'text-zinc-400'}>
                  [{l.timestamp.slice(11, 19)}] {l.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Early End Confirmation: YES must be clicked twice */}
        {showEndPrompt && (
          <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-950 border border-red-700/70 rounded-2xl w-full max-w-md p-5 flex flex-col gap-4 shadow-2xl">
              <div className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-sm font-bold uppercase tracking-wider">
                  End Game In World Peace?
                </h3>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                This immediately ends the current game. The reward pool of{' '}
                <span className="font-mono font-bold text-amber-300">
                  {game?.rewardPool ?? DEFAULT_REWARD_POOL} tokens
                </span>{' '}
                will be split equally among surviving winners, rounded down, and the game will be
                marked as finished.
              </p>
              <p className="text-[11px] text-red-300 bg-red-950/60 border border-red-800 rounded-lg p-2">
                This cannot be undone. You must click <span className="font-bold">YES</span> twice
                to confirm.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelEndPrompt}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmEnd}
                  disabled={isProcessing}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg disabled:opacity-50 ${
                    endConfirmStep === 0
                      ? 'bg-red-600 hover:bg-red-500 text-white'
                      : 'bg-amber-500 hover:bg-amber-400 text-zinc-950'
                  }`}
                >
                  {endConfirmStep === 0 ? 'Yes' : 'Yes — Click Again'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2. Create Player Section ONLY for creating new players */}
        <form onSubmit={handleCreatePlayer} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
            <UserPlus className="w-4 h-4 text-emerald-400" />
            Create New Operative
          </h4>
          <p className="text-xs text-zinc-400">
            Registers a new operative in the database. Generating auth links and profile editing can be done for any existing player below.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Operative Codename *</label>
              <input
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. Ghost_01"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Avatar Image URL (Optional)</label>
              <input
                type="text"
                value={newAvatarUrl}
                onChange={(e) => setNewAvatarUrl(e.target.value)}
                placeholder="https://... or leave blank for auto"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-zinc-500 max-w-[280px]">
              Admin accounts are provisioned by the server. New players never receive administrator rights.
            </p>

            <button
              type="submit"
              disabled={isCreatingPlayer}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow disabled:opacity-50"
            >
              {isCreatingPlayer ? 'Creating...' : 'Create Player'}
            </button>
          </div>

          {createSuccessMsg && (
            <div className="text-xs text-emerald-400 bg-emerald-950/60 p-2 rounded-lg border border-emerald-800">
              {createSuccessMsg}
            </div>
          )}

          {createErrorMsg && (
            <div className="text-xs text-red-400 bg-red-950/60 p-2 rounded-lg border border-red-800">
              {createErrorMsg}
            </div>
          )}
        </form>

        {/* 3. Manage Existing Players & Generate Auth Links */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Registered Operatives ({allPlayers.length})
            </h4>
            <span className="text-[11px] text-zinc-500">
              Generate links or edit profiles for any player
            </span>
          </div>

          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto scrollbar-thin">
            {allPlayers.map((p) => {
              const isEditing = editingPlayerId === p.id;
              const linkInfo = authLinks[p.id];
              const isGenerating = generatingLinkForId === p.id;

              return (
                <div
                  key={p.id}
                  className="flex flex-col p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs gap-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={p.avatarUrl}
                        alt={p.username}
                        className="w-9 h-9 rounded-lg bg-zinc-800 object-cover border border-zinc-700"
                      />
                      <div>
                        {isEditing ? (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editUsername}
                                onChange={(e) => setEditUsername(e.target.value)}
                                placeholder="Codename"
                                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                              />
                              <input
                                type="text"
                                value={editAvatar}
                                onChange={(e) => setEditAvatar(e.target.value)}
                                placeholder="Avatar URL"
                                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-white w-48"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleUpdatePlayer(p.id)}
                                disabled={isSavingEdit}
                                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold"
                              >
                                {isSavingEdit ? 'Saving...' : 'Save Profile'}
                              </button>
                              <button
                                onClick={() => setEditingPlayerId(null)}
                                className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded text-[11px]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
                              <span>{p.username}</span>
                              {p.isAdmin && <span className="text-[10px] text-amber-400 font-bold">[ADMIN]</span>}
                              {!p.isAlive && !isUnstarted && (
                                <span className="text-[10px] bg-red-950 text-red-400 px-1 rounded font-bold">
                                  ELIMINATED
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-400 font-mono">
                              ID: {p.id.slice(0, 8)}... | Matches: {p.stats.gamesPlayed} | Deaths:{' '}
                              {p.stats.deaths} | Tokens: {p.tokens}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-1.5">
                        {/* Generate Auth Link Button (admin links are console-only) */}
                        {p.isAdmin ? (
                          <span
                            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 text-xs font-semibold flex items-center gap-1"
                            title="Admin auth links can only be generated from the server console (npm run admin:link)"
                          >
                            <Key className="w-3.5 h-3.5" />
                            <span>Console only</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleGenerateAuthLink(p.id)}
                            disabled={isGenerating}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-950/70 border border-emerald-700/60 hover:bg-emerald-900 text-emerald-300 text-xs font-semibold flex items-center gap-1"
                            title="Generate one-time invite / auth link"
                          >
                            <Key className="w-3.5 h-3.5" />
                            <span>{isGenerating ? 'Generating...' : 'Auth Link'}</span>
                          </button>
                        )}

                        {/* Edit Profile Button */}
                        <button
                          onClick={() => {
                            setEditingPlayerId(p.id);
                            setEditUsername(p.username);
                            setEditAvatar(p.avatarUrl);
                          }}
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                          title="Edit Player Profile"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Revoke Sessions */}
                        <button
                          onClick={() => handleResetSessions(p.id)}
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-red-400 border border-zinc-700"
                          title="Revoke Player Sessions"
                        >
                          <Lock className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Render generated auth link if available */}
                  {linkInfo && (
                    <div className="mt-1 bg-zinc-950 border border-emerald-500/40 rounded-lg p-2 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[10px] text-emerald-400 font-bold uppercase">
                        <span>One-Time Auth / Invite Link for {p.username}:</span>
                        <span className="text-zinc-500 font-normal">Valid for 7 days</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={linkInfo.url}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => copyToClipboard(linkInfo.url, p.id)}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded font-bold flex items-center gap-1 shrink-0 shadow"
                        >
                          {copiedPlayerId === p.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedPlayerId === p.id ? 'Copied' : 'Copy Link'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
