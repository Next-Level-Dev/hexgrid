import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GameRecord,
  GameStateData,
  Player,
  ActionData,
  ActionType,
  GameEngineEvent,
} from './types/game';
import { Header } from './components/Header';
import { DaySelector } from './components/DaySelector';
import { GridMap } from './components/GridMap';
import { ActionPlanner } from './components/ActionPlanner';
import { PlayerRoster } from './components/PlayerRoster';
import { AdminPanel } from './components/AdminPanel';
import { AnimationPlaybackModal } from './components/AnimationPlaybackModal';
import { triggerVictoryConfetti } from './utils/visualEffects';
import { Clock, History, Play, ShieldAlert, ArrowRight } from 'lucide-react';

export default function App() {
  // Game & Cycle States
  const [game, setGame] = useState<GameRecord | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [viewingDay, setViewingDay] = useState<number>(1);
  const [lastDayViewed, setLastDayViewed] = useState<number>(1);
  const [currentState, setCurrentState] = useState<GameStateData | null>(null);

  // Player & Auth States
  const [player, setPlayer] = useState<Player | null>(null);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(false);
  const [isProcessingRound, setIsProcessingRound] = useState<boolean>(false);

  // Action Planning States
  const [plannedActions, setPlannedActions] = useState<ActionData[]>([]);
  const [selectedActionType, setSelectedActionType] = useState<ActionType | null>('move');
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number } | null>(null);
  const [isSavingActions, setIsSavingActions] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Animation Playback States
  const [playbackEvents, setPlaybackEvents] = useState<GameEngineEvent[] | null>(null);
  const [playbackTargetDay, setPlaybackTargetDay] = useState<number | null>(null);
  const [activeFx, setActiveFx] = useState<any | null>(null);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);

  // Hover states for range inspection
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);

  // 1. Initial Load & Invitation check
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/invite\/([a-zA-Z0-9]+)$/);
    if (match) {
      const token = match[1];
      fetch('/api/auth/redeem-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.player) {
            window.history.replaceState({}, '', '/');
            loadMe();
            loadGameCurrent();
          }
        })
        .catch(console.error);
    } else {
      loadMe();
      loadGameCurrent();
    }
  }, []);

  const loadMe = async () => {
    try {
      const res = await fetch('/api/me');
      const data = await res.json();
      setPlayer(data.player);
      setAllPlayers(data.allPlayers || []);
    } catch (err) {
      console.error('Failed to load user session:', err);
    }
  };

  const loadGameCurrent = async () => {
    try {
      const res = await fetch('/api/game/current');
      const data = await res.json();
      if (data.game) {
        setGame(data.game);
        setSecondsRemaining(data.timer.secondsRemaining);

        if (data.game.currentDay === 0) {
          setViewingDay(0);
          setLastDayViewed(0);
          setCurrentState(null);
        } else {
          const ldv = data.userContext?.lastDayViewed || data.game.currentDay;
          setLastDayViewed(ldv);
          setViewingDay((prev) => (prev === 0 ? ldv : prev));
          loadGameState(ldv);
        }

        if (data.game.phase === 'over') {
          triggerVictoryConfetti();
        }
      }
    } catch (err) {
      console.error('Failed to load current game:', err);
    }
  };

  const loadGameState = async (dayNumber: number) => {
    if (dayNumber <= 0) {
      setCurrentState(null);
      return;
    }
    try {
      const res = await fetch(`/api/game/state/${dayNumber}`);
      const data = await res.json();
      if (data.state) {
        setCurrentState(data.state);
        setViewingDay(dayNumber);
      }
    } catch (err) {
      console.error(`Failed to load state for day ${dayNumber}:`, err);
    }
  };

  const loadPlayerActions = async () => {
    if (!player || !game || game.currentDay === 0) return;
    try {
      const res = await fetch('/api/game/actions');
      const data = await res.json();
      if (Array.isArray(data.actions)) {
        setPlannedActions(data.actions.map((a: any) => a.data));
      }
    } catch (err) {
      console.error('Failed to load actions:', err);
    }
  };

  useEffect(() => {
    if (player && game?.phase === 'open' && game.currentDay > 0) {
      loadPlayerActions();
    }
  }, [player, game?.phase, game?.currentDay]);

  // Timer Tick & Poll
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          loadGameCurrent();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const poll = setInterval(() => {
      loadGameCurrent();
    }, 20000);

    return () => {
      clearInterval(timer);
      clearInterval(poll);
    };
  }, []);

  // Compute Ghost Operative Position based on queued movement actions
  const ghostPosition = useMemo(() => {
    if (!player || !player.isAlive || !game || game.currentDay === 0) return null;
    let gx = player.x;
    let gy = player.y;
    let moved = false;

    for (const act of plannedActions) {
      if (act.actionType === 'move' && act.direction) {
        moved = true;
        if (act.direction === 'up' && gy > 1) gy -= 1;
        else if (act.direction === 'down' && gy < 25) gy += 1;
        else if (act.direction === 'left' && gx > 1) gx -= 1;
        else if (act.direction === 'right' && gx < 25) gx += 1;
      }
    }

    return moved ? { x: gx, y: gy } : null;
  }, [player, plannedActions, game]);

  const handleTogglePeaceVote = async () => {
    if (!player || game?.phase !== 'open' || !player.isAlive || game.currentDay === 0) return;
    const newVote = player.peaceVote === 'yes' ? 'no' : 'yes';
    try {
      const res = await fetch('/api/game/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: newVote }),
      });
      if (res.ok) {
        setPlayer({ ...player, peaceVote: newVote });
        loadGameState(viewingDay);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTileClick = (x: number, y: number) => {
    setSelectedTile({ x, y });
  };

  const handleAddAction = (act: ActionData) => {
    setPlannedActions((prev) => [...prev, act]);
    setSaveSuccess(false);
  };

  const handleRemoveAction = (index: number) => {
    setPlannedActions((prev) => prev.filter((_, i) => i !== index));
    setSaveSuccess(false);
  };

  const handleSubmitActions = async () => {
    if (!player || game?.phase !== 'open' || game.currentDay === 0) return;
    setIsSavingActions(true);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/game/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: plannedActions }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
      } else {
        alert(data.error || 'Failed to submit actions');
      }
    } catch (err: any) {
      alert(err.message || 'Submission error');
    } finally {
      setIsSavingActions(false);
    }
  };

  const handleProgressToNextDay = async () => {
    if (!game || viewingDay >= game.currentDay || game.currentDay === 0) return;
    const nextDay = viewingDay + 1;
    setIsAnimating(true);

    try {
      const res = await fetch(`/api/game/state/${nextDay}`);
      const data = await res.json();
      const events: GameEngineEvent[] = data.state?.events || [];

      setPlaybackEvents(events);
      setPlaybackTargetDay(nextDay);
    } catch (err) {
      console.error('Error fetching progress state:', err);
      setIsAnimating(false);
    }
  };

  const handleCompleteAnimation = async () => {
    if (playbackTargetDay) {
      const target = playbackTargetDay;
      setViewingDay(target);
      loadGameState(target);

      try {
        await fetch('/api/game/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day: target }),
        });
        setLastDayViewed((prev) => Math.max(prev, target));
      } catch (err) {
        console.error(err);
      }
    }
    setPlaybackEvents(null);
    setPlaybackTargetDay(null);
    setActiveFx(null);
    setIsAnimating(false);
  };

  const handleAdminStartGame = async () => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/start-game', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setViewingDay(1);
        setLastDayViewed(1);
        await loadMe();
        await loadGameCurrent();
        setIsAdminOpen(false);
      } else {
        alert(data.error || 'Failed to start game');
      }
    } catch (err: any) {
      alert(err.message || 'Error starting game');
    } finally {
      setIsProcessingRound(false);
    }
  };

  const handleAdminJumpPhase = async () => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/jump-phase', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        await loadGameCurrent();
        setIsAdminOpen(false);
      } else {
        alert(data.error || 'Failed to jump phase');
      }
    } catch (err: any) {
      alert(err.message || 'Error jumping phase');
    } finally {
      setIsProcessingRound(false);
    }
  };

  const handleAdminAdvanceRound = async () => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/advance-round', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        await loadGameCurrent();
        setIsAdminOpen(false);
      } else {
        alert(data.error || 'Failed to advance round');
      }
    } catch (err: any) {
      alert(err.message || 'Advance error');
    } finally {
      setIsProcessingRound(false);
    }
  };

  const handleAdminResetGame = async () => {
    try {
      const res = await fetch('/api/admin/reset-game', { method: 'POST' });
      if (res.ok) {
        setViewingDay(0);
        setLastDayViewed(0);
        await loadGameCurrent();
        setIsAdminOpen(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const isUnstarted = !game || game.currentDay === 0 || game.endReason === 'waiting_to_start';
  const isClosed = game?.phase === 'closed';
  const isGameOver = game?.phase === 'over';
  const isHistorical = game && !isUnstarted ? viewingDay < game.currentDay : false;

  // Closed Phase Display Rule (during live active match):
  // "on the closed phase players shouldnt see anything on day 2, they can only go back to see the previous day, the next one hides the grid and just leaves behind a timer"
  const isNormalPlayerLockedInClosed = !isUnstarted && isClosed && !isHistorical && !player?.isAdmin;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#090b10] text-zinc-100 flex flex-col font-sans select-none">
      {/* 1. Full-Screen Background 25x25 Grid (Always present, acts as the primary background window) */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <GridMap
          state={currentState}
          currentPlayer={player}
          selectedActionType={selectedActionType}
          onTileClick={handleTileClick}
          selectedTile={selectedTile}
          activeFx={activeFx}
          isGameOver={isGameOver}
          ghostPosition={ghostPosition}
          showMyRange={!isUnstarted}
        />
      </div>

      {/* 2. Closed Phase Screen (Veils the grid on live day during Closed Phase, showing only the timer and previous day navigation) */}
      {isNormalPlayerLockedInClosed && (
        <div className="absolute inset-0 z-40 bg-zinc-950/95 backdrop-blur-xl flex flex-col items-center justify-center text-center p-6 gap-6">
          <div className="w-20 h-20 rounded-3xl bg-amber-950/70 border border-amber-600/40 flex items-center justify-center text-amber-400 shadow-2xl shadow-amber-500/20">
            <Clock className="w-10 h-10 animate-pulse" />
          </div>

          <div className="max-w-lg">
            <h2 className="text-2xl font-black text-white tracking-widest uppercase mb-2">
              CLOSED PHASE ACTIVE
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              The live grid is veiled while backend engines process all planned actions, detonations,
              and priority queues. The new round opens at 00:00 UTC.
            </p>
          </div>

          <div className="font-mono text-4xl font-black text-amber-400 tracking-widest bg-zinc-900/90 px-8 py-4 rounded-2xl border border-zinc-800 shadow-inner">
            {Math.floor(secondsRemaining / 3600)}h {Math.floor((secondsRemaining % 3600) / 60)}m {secondsRemaining % 60}s
          </div>

          {game && game.currentDay > 1 && (
            <button
              onClick={() => {
                const prevDay = game.currentDay - 1;
                setViewingDay(prevDay);
                loadGameState(prevDay);
              }}
              className="mt-4 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl border border-zinc-700 shadow-lg flex items-center gap-2"
            >
              <History className="w-4 h-4 text-amber-400" />
              <span>Inspect Previous Day (Day {game.currentDay - 1})</span>
            </button>
          )}
        </div>
      )}

      {/* Unstarted Game Floating Banner */}
      {isUnstarted && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-zinc-900/90 backdrop-blur-md border border-amber-500/40 rounded-2xl px-6 py-3 flex items-center gap-4 shadow-2xl">
          <div className="w-3 h-3 rounded-full bg-amber-400 animate-ping" />
          <div className="text-left">
            <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              Battlefield Staging — Game Waiting to Start
            </h3>
            <p className="text-[11px] text-zinc-400">
              {allPlayers.length} operative(s) registered. All players will spawn when Admin launches Day 1.
            </p>
          </div>
          {player?.isAdmin ? (
            <button
              onClick={() => setIsAdminOpen(true)}
              className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-zinc-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow flex items-center gap-1.5 hover:from-emerald-400 hover:to-teal-400"
            >
              <Play className="w-3.5 h-3.5 fill-zinc-950" />
              Launch Console
            </button>
          ) : (
            <span className="text-xs text-zinc-500 font-mono">Awaiting Administrator</span>
          )}
        </div>
      )}

      {/* Floating Notice if viewing historical day while live game is closed */}
      {!isUnstarted && isClosed && isHistorical && !isAnimating && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 bg-amber-950/80 backdrop-blur-md border border-amber-700/60 rounded-xl px-4 py-2 flex items-center gap-3 text-xs text-amber-200 shadow-xl">
          <Clock className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Viewing Day {viewingDay} archive. Live Day {game?.currentDay} is currently calculating.</span>
          <button
            onClick={() => {
              if (game) {
                setViewingDay(game.currentDay);
                loadGameState(game.currentDay);
              }
            }}
            className="px-2.5 py-1 bg-amber-500 text-zinc-950 rounded font-bold text-[11px] hover:bg-amber-400 flex items-center gap-1"
          >
            Live Timer <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* 3. Floating GUI Windows on top of the Grid (Auto-hidden when animating to reveal the whole grid) */}
      <div
        className={`relative z-30 pointer-events-none w-full h-full flex flex-col justify-between transition-opacity duration-300 ${
          isAnimating ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* Top Header Bar */}
        <div className="pointer-events-auto">
          <Header
            game={game}
            secondsRemaining={secondsRemaining}
            viewingDay={viewingDay}
            player={player}
            onTogglePeaceVote={handleTogglePeaceVote}
            onOpenAdmin={() => setIsAdminOpen(true)}
            onProfileUpdated={loadMe}
            onJumpPhase={handleAdminJumpPhase}
          />
        </div>

        {/* Floating Side Panels (Action Deck on left, Operative Roster on right) */}
        {!isNormalPlayerLockedInClosed && (
          <div className="w-full flex-1 flex justify-between items-end p-6 pointer-events-none">
            {/* Bottom-Left: Floating Action Deck (only in active match) */}
            <div className="pointer-events-auto max-w-md w-full">
              {!isUnstarted ? (
                <ActionPlanner
                  player={player}
                  allPlayers={allPlayers}
                  buildings={currentState?.buildings || []}
                  selectedTile={selectedTile}
                  actions={plannedActions}
                  onAddAction={handleAddAction}
                  onRemoveAction={handleRemoveAction}
                  onSubmitActions={handleSubmitActions}
                  onSelectActionType={(actType) => setSelectedActionType(actType)}
                  selectedActionType={selectedActionType}
                  isClosed={isClosed}
                  isSaving={isSavingActions}
                  saveSuccess={saveSuccess}
                  ghostPosition={ghostPosition}
                />
              ) : (
                <div className="bg-zinc-950/80 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-400">
                  <p className="font-semibold text-zinc-300 mb-1">Staging Area</p>
                  <p>Actions will become available once Day 1 is launched by an administrator.</p>
                </div>
              )}
            </div>

            {/* Bottom-Center: Floating Timeline Scrubber */}
            {!isUnstarted && (
              <div className="pointer-events-auto max-w-xl w-full mb-1">
                <DaySelector
                  currentDay={game?.currentDay || 1}
                  viewingDay={viewingDay}
                  lastDayViewed={lastDayViewed}
                  isGameOver={isGameOver}
                  onSelectDay={(d) => {
                    setViewingDay(d);
                    loadGameState(d);
                  }}
                  onProgressToNextDay={handleProgressToNextDay}
                  isAnimating={isAnimating}
                />
              </div>
            )}

            {/* Top-Right: Floating Operatives Roster */}
            <div className="pointer-events-auto max-w-xs w-full self-start">
              <PlayerRoster
                allPlayers={allPlayers}
                state={currentState}
                currentPlayerId={player?.id}
                onHoverPlayer={(id) => setHoveredPlayerId(id)}
              />
            </div>
          </div>
        )}
      </div>

      {/* 4. Active Animation Playback Controller (Shows during Progress to Next Day) */}
      {playbackEvents && playbackTargetDay && (
        <AnimationPlaybackModal
          events={playbackEvents}
          fromDay={viewingDay}
          toDay={playbackTargetDay}
          onEventStep={(evt) => setActiveFx(evt)}
          onComplete={handleCompleteAnimation}
        />
      )}

      {/* 5. Administrator Modal */}
      <AdminPanel
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        game={game}
        allPlayers={allPlayers}
        onPlayerUpdated={loadMe}
        onAdvanceRound={handleAdminAdvanceRound}
        onJumpPhase={handleAdminJumpPhase}
        onResetGame={handleAdminResetGame}
        onStartGame={handleAdminStartGame}
        isProcessing={isProcessingRound}
      />
    </div>
  );
}
