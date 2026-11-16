import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GameRecord,
  GameStateData,
  Player,
  ActionData,
  ActionType,
  GameEngineEvent,
  Building,
} from './types/game';
import { Header } from './components/Header';
import { DaySelector } from './components/DaySelector';
import { GridMap } from './components/GridMap';
import { ActionPlanner, ActionConfig } from './components/ActionPlanner';
import { PlayerRoster } from './components/PlayerRoster';
import { AdminPanel } from './components/AdminPanel';
import { AnimationPlaybackModal } from './components/AnimationPlaybackModal';
import { triggerVictoryConfetti } from './utils/visualEffects';
import {
  GAME_RULES,
  DEFAULT_MAP_SIZE,
  DEFAULT_PLAYER_HEALTH,
  DEFAULT_MINE_LIMIT,
  DEFAULT_MINE_LIMIT_INCREASE_DAYS,
  DEFAULT_ASSASSINATION_COST,
  createDefaultBuildingConfig,
  getActionPriorityGroup,
  getMineLimitForDay,
  getNextMineLimitIncreaseDay,
  isSquareInPlayerRange,
} from './game/rules';
import { Clock, History, ArrowRight, Swords, Users, AlertTriangle } from 'lucide-react';
import { useIsMobile } from './utils/useIsMobile';
import { useI18n } from './i18n';

/**
 * The newest day a player is allowed to inspect. While the closed phase is
 * running, the day currently being calculated stays sealed until the next open
 * phase begins.
 */
function getHighestVisibleDay(game: GameRecord | null): number {
  if (!game || game.currentDay <= 0) return 0;
  if (game.phase === 'closed') return Math.max(1, game.currentDay - 1);
  return game.currentDay;
}

export default function App() {
  const { t } = useI18n();

  // Game & Cycle States
  const [game, setGame] = useState<GameRecord | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [viewingDay, setViewingDay] = useState<number>(1);
  const [lastDayViewed, setLastDayViewed] = useState<number>(1);
  const [currentState, setCurrentState] = useState<GameStateData | null>(null);
  const [loadedStateDay, setLoadedStateDay] = useState<number>(0);

  // Player & Auth States
  const [player, setPlayer] = useState<Player | null>(null);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(false);
  const [isProcessingRound, setIsProcessingRound] = useState<boolean>(false);

  // Action Planning States
  const [plannedActions, setPlannedActions] = useState<ActionData[]>([]);
  const [selectedActionType, setSelectedActionType] = useState<ActionType | null>(null);
  const [selectedNukeSiloId, setSelectedNukeSiloId] = useState<string | null>(null);
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number } | null>(null);
  const [isSavingActions, setIsSavingActions] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  // Canonical JSON of the actions as they exist on the server; compared
  // against the local plan to detect unsubmitted changes.
  const [savedActionsJson, setSavedActionsJson] = useState<string>('[]');
  const [actionConfig, setActionConfig] = useState<ActionConfig>({
    amount: 1,
    allowPartial: true,
    buildingType: 'outpost',
    targetPlayerId: '',
    assassinationTargetId: '',
  });
  const [flashTile, setFlashTile] = useState<{
    x: number;
    y: number;
    kind: 'valid' | 'invalid';
  } | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const viewingDayRef = useRef<number>(viewingDay);
  const currentStateDayRef = useRef<number>(0);
  const loadStateRequestRef = useRef<number>(0);
  const hasLoadedGameRef = useRef<boolean>(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState<number>(0);

  // Animation Playback States
  const [playbackEvents, setPlaybackEvents] = useState<GameEngineEvent[] | null>(null);
  const [playbackTargetDay, setPlaybackTargetDay] = useState<number | null>(null);
  const [playbackBasePlayers, setPlaybackBasePlayers] = useState<
    Record<string, GameStateData['players'][string]> | null
  >(null);
  const [playbackEventIndex, setPlaybackEventIndex] = useState<number>(-1);
  const [playbackAutoPlay, setPlaybackAutoPlay] = useState<boolean>(false);
  const [fullReplayEndDay, setFullReplayEndDay] = useState<number | null>(null);
  const [activeFx, setActiveFx] = useState<any | null>(null);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);

  // Closed-phase inspection (timer screen is the default during closed phase)
  const [isInspectingClosedPhase, setIsInspectingClosedPhase] = useState<boolean>(false);

  // Hover states for range inspection
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);

  // Mobile layout: breakpoint-driven panel placement + bottom sheet state
  const isMobile = useIsMobile();
  const [mobileSheet, setMobileSheet] = useState<'plan' | 'roster' | null>('plan');

  useEffect(() => {
    viewingDayRef.current = viewingDay;
  }, [viewingDay]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const updateHeight = () => setHeaderHeight(el.getBoundingClientRect().height);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
          setLoadedStateDay(0);
          currentStateDayRef.current = 0;
        } else {
          const ldv = data.userContext?.lastDayViewed || data.game.currentDay;
          setLastDayViewed(ldv);

          // The day being calculated during the closed phase stays hidden until
          // the open phase begins, so never target it while the game is closed.
          const highestVisibleDay = getHighestVisibleDay(data.game);
          const previousView = viewingDayRef.current;
          const target = Math.max(
            1,
            Math.min(
              hasLoadedGameRef.current && previousView > 0 ? previousView : ldv,
              highestVisibleDay || 1
            )
          );
          hasLoadedGameRef.current = true;

          if (previousView !== target) setViewingDay(target);
          if (currentStateDayRef.current !== target) loadGameState(target);
        }
      }
    } catch (err) {
      console.error('Failed to load current game:', err);
    }
  };

  const loadGameState = async (dayNumber: number) => {
    const requestId = ++loadStateRequestRef.current;

    if (dayNumber <= 0) {
      setCurrentState(null);
      setLoadedStateDay(0);
      currentStateDayRef.current = 0;
      return;
    }
    try {
      const res = await fetch(`/api/game/state/${dayNumber}`);
      if (requestId !== loadStateRequestRef.current) return;
      if (!res.ok) {
        throw new Error(`Day ${dayNumber} state is not available`);
      }
      const data = await res.json();
      if (requestId !== loadStateRequestRef.current) return;
      if (data.state) {
        setCurrentState(data.state);
        setLoadedStateDay(dayNumber);
        setViewingDay(dayNumber);
        currentStateDayRef.current = dayNumber;
      }
    } catch (err) {
      if (requestId !== loadStateRequestRef.current) return;
      console.error(`Failed to load state for day ${dayNumber}:`, err);
    }
  };

  // Canonical serialized form of a plan (resolution-priority order, same
  // ordering the submit endpoint receives) used for the unsaved-changes check.
  const canonicalActionsJson = (actions: ActionData[]) =>
    JSON.stringify(
      actions
        .map((act, originalIndex) => ({ act, originalIndex }))
        .sort((a, b) => {
          const groupDiff =
            getActionPriorityGroup(a.act.actionType) - getActionPriorityGroup(b.act.actionType);
          return groupDiff !== 0 ? groupDiff : a.originalIndex - b.originalIndex;
        })
        .map(({ act }) => act)
    );

  const loadPlayerActions = async (dayNumber: number) => {
    if (!player || !game || game.currentDay === 0 || dayNumber < 1) return;
    try {
      const res = await fetch(`/api/game/actions?day=${dayNumber}`);
      const data = await res.json();
      if (Array.isArray(data.actions)) {
        const ordered = data.actions
          .slice()
          .sort(
            (a: any, b: any) =>
              (a.data?.orderIndex ?? 0) - (b.data?.orderIndex ?? 0)
          )
          .map((a: any) => a.data);
        setPlannedActions(ordered);
        setSavedActionsJson(canonicalActionsJson(ordered));
      }
    } catch (err) {
      console.error('Failed to load actions:', err);
    }
  };

  useEffect(() => {
    if (player && game && game.currentDay > 0 && viewingDay >= 1) {
      loadPlayerActions(viewingDay);
    }
  }, [player, game?.currentDay, viewingDay]);

  // Any day change starts a fresh planning selection.
  useEffect(() => {
    setSelectedActionType(null);
    setSelectedNukeSiloId(null);
    setSelectedTile(null);
  }, [viewingDay]);

  // Nuclear targeting only exists while a specific ready silo is selected.
  useEffect(() => {
    if (selectedActionType !== 'launch_nuke') setSelectedNukeSiloId(null);
  }, [selectedActionType]);

  // The closed phase always starts on the timer screen; inspection is opt-in.
  useEffect(() => {
    setSelectedActionType(null);
    setSelectedTile(null);
    setIsInspectingClosedPhase(false);
  }, [game?.phase, game?.currentDay]);

  // Refresh the persistent token balance when a game finishes.
  const previousPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const phase = game?.phase ?? null;
    if (phase === 'over' && previousPhaseRef.current !== 'over') {
      loadMe();
    }
    previousPhaseRef.current = phase;
  }, [game?.phase]);

  // Celebrate only once the final day has actually been opened. The confetti
  // must not fire while the last round is still sealed behind the replay.
  const victoryCelebratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!game || game.phase !== 'over') return;
    if (viewingDay !== game.currentDay || loadedStateDay !== game.currentDay) return;
    const key = `${game.id}:${game.currentDay}`;
    if (victoryCelebratedRef.current === key) return;
    victoryCelebratedRef.current = key;
    triggerVictoryConfetti();
  }, [game?.id, game?.phase, game?.currentDay, viewingDay, loadedStateDay]);

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

  // Merge the authoritative day snapshot into the session player so ranges,
  // ghosts and click handling always use the latest position/health/points.
  const activePlayer = useMemo<Player | null>(() => {
    if (!player) return null;
    const snap = currentState?.players?.[player.id];
    return snap ? { ...player, ...snap } : player;
  }, [player, currentState]);

  const rosterPlayers = useMemo<Player[]>(() => {
    if (!currentState) return allPlayers;
    return allPlayers.map((p) => {
      const snap = currentState.players[p.id];
      return snap ? { ...p, ...snap } : p;
    });
  }, [allPlayers, currentState]);

  const mapSize = game?.mapSize ?? DEFAULT_MAP_SIZE;
  const maxHealth = game?.playerHealth ?? DEFAULT_PLAYER_HEALTH;
  const mineLimit = getMineLimitForDay(
    game?.mineLimit ?? DEFAULT_MINE_LIMIT,
    viewingDay,
    game?.mineLimitIncreaseDays ?? DEFAULT_MINE_LIMIT_INCREASE_DAYS
  );
  const nextMineLimitDay = getNextMineLimitIncreaseDay(
    viewingDay,
    game?.mineLimitIncreaseDays ?? DEFAULT_MINE_LIMIT_INCREASE_DAYS
  );
  const minesPlaced = currentState?.minesPlaced?.[activePlayer?.id ?? ''] ?? 0;

  // Compute Ghost Operative Position based on queued movement actions
  const ghostPosition = useMemo(() => {
    if (!activePlayer || !activePlayer.isAlive || !game || game.currentDay === 0) return null;
    let gx = activePlayer.x;
    let gy = activePlayer.y;
    let moved = false;

    for (const act of plannedActions) {
      if (act.actionType === 'move' && act.direction) {
        moved = true;
        if (act.direction === 'up' && gy > 1) gy -= 1;
        else if (act.direction === 'down' && gy < mapSize) gy += 1;
        else if (act.direction === 'left' && gx > 1) gx -= 1;
        else if (act.direction === 'right' && gx < mapSize) gx += 1;
      }
    }

    return moved && (gx !== activePlayer.x || gy !== activePlayer.y) ? { x: gx, y: gy } : null;
  }, [activePlayer, plannedActions, game, mapSize]);

  const canPlanActions =
    !!game &&
    game.currentDay > 0 &&
    game.endReason !== 'waiting_to_start' &&
    game.phase === 'open' &&
    viewingDay === game.currentDay &&
    loadedStateDay === viewingDay &&
    !!currentState &&
    !isAnimating;

  const isViewingHistoricalDay =
    !!game && game.currentDay > 0 && viewingDay !== game.currentDay;

  // True when the local plan differs from what is stored on the server.
  const hasUnsavedChanges =
    canPlanActions && canonicalActionsJson(plannedActions) !== savedActionsJson;

  // Any time planning becomes unavailable (closed phase, day change, replay)
  // the current action selection is dropped so the grid cannot be clicked.
  useEffect(() => {
    if (!canPlanActions) {
      setSelectedActionType(null);
      setSelectedTile(null);
    }
  }, [canPlanActions]);

  useEffect(() => {
    if (isViewingHistoricalDay) {
      setMobileSheet((cur) => (cur === 'plan' ? null : cur));
    }
  }, [isViewingHistoricalDay]);

  const activeActionType = canPlanActions ? selectedActionType : null;
  const showActionRange = canPlanActions && activeActionType !== null;
  const effectiveGhostPosition = showActionRange ? ghostPosition : null;

  // Build the player snapshot shown during replay by applying events up to the
  // currently displayed one. Positions change on move events, which lets the
  // map layer tween tokens between tiles instead of teleporting them.
  const animationPlayers = useMemo<
    Record<string, GameStateData['players'][string]> | null
  >(() => {
    if (!isAnimating || !playbackBasePlayers) return null;
    const players: Record<string, GameStateData['players'][string]> = {};
    for (const [id, p] of Object.entries(playbackBasePlayers)) {
      players[id] = { ...p };
    }

    const events = playbackEvents ?? [];
    for (let i = 0; i <= playbackEventIndex && i < events.length; i++) {
      const evt = events[i];
      const affected = evt.playerId ? players[evt.playerId] : undefined;

      if (evt.type === 'move' && affected && evt.toX !== undefined && evt.toY !== undefined) {
        affected.x = evt.toX;
        affected.y = evt.toY;
      } else if (
        (evt.type === 'damage' || evt.type === 'mine_triggered') &&
        affected
      ) {
        affected.health = Math.max(0, affected.health - (evt.damage || 0));
        if (affected.health <= 0) affected.isAlive = false;
      } else if (evt.type === 'heal' && affected) {
        affected.health = Math.min(
          game?.playerHealth ?? DEFAULT_PLAYER_HEALTH,
          affected.health + (evt.amount || 0)
        );
      } else if (evt.type === 'death' && affected) {
        affected.isAlive = false;
      }
    }

    return players;
  }, [
    isAnimating,
    playbackBasePlayers,
    playbackEvents,
    playbackEventIndex,
    game?.playerHealth,
  ]);

  const flashTileAt = useCallback((x: number, y: number, kind: 'valid' | 'invalid') => {
    setFlashTile({ x, y, kind });
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setFlashTile(null);
      flashTimerRef.current = null;
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

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

  const queueAction = (act: ActionData) => {
    setPlannedActions((prev) => [...prev, act]);
    setSaveSuccess(false);
  };

  const handleSelectNukeSilo = (silo: Building) => {
    const p = activePlayer;
    if (
      !canPlanActions ||
      !p?.isAlive ||
      !game?.enabledBuildings.silo ||
      silo.type !== 'silo' ||
      silo.ownerId !== p.id ||
      !silo.isArmed ||
      silo.isSpent
    ) {
      flashTileAt(silo.x, silo.y, 'invalid');
      return;
    }

    setSelectedNukeSiloId(silo.id);
    setSelectedActionType('launch_nuke');
    setSelectedTile(null);
    flashTileAt(silo.x, silo.y, 'valid');
  };

  const handleTileClick = (x: number, y: number) => {
    const p = activePlayer;
    if (!p) return;

    // Grid interaction only exists while an action is selected for live planning.
    if (!selectedActionType || !canPlanActions || !p.isAlive) {
      return;
    }

    const origin = ghostPosition || { x: p.x, y: p.y };
    const inCurrentRange = isSquareInPlayerRange(p.x, p.y, x, y, mapSize);
    const inGhostRange = ghostPosition
      ? isSquareInPlayerRange(ghostPosition.x, ghostPosition.y, x, y, mapSize)
      : false;
    const inRange = inCurrentRange || inGhostRange;
    const dayBuildings = currentState?.buildings || [];

    if (selectedActionType === 'move') {
      const dx = x - origin.x;
      const dy = y - origin.y;
      let direction: ActionData['direction'];
      if (dx === 0 && dy === -1) direction = 'up';
      else if (dx === 0 && dy === 1) direction = 'down';
      else if (dx === -1 && dy === 0) direction = 'left';
      else if (dx === 1 && dy === 0) direction = 'right';

      if (!direction) {
        flashTileAt(x, y, 'invalid');
        return;
      }

      const occupiedByPlayer = rosterPlayers.some(
        (op) => op.isAlive && op.x === x && op.y === y
      );
      const blockingBuilding = dayBuildings.some(
        (b) => b.x === x && b.y === y && GAME_RULES.BUILDINGS[b.type].blocksMovement
      );
      if (occupiedByPlayer || blockingBuilding) {
        flashTileAt(x, y, 'invalid');
        return;
      }

      setSelectedTile({ x, y });
      queueAction({ actionType: 'move', direction });
      flashTileAt(x, y, 'valid');
      return;
    }

    if (selectedActionType === 'attack') {
      if (!inRange) {
        flashTileAt(x, y, 'invalid');
        return;
      }
      setSelectedTile({ x, y });
      queueAction({
        actionType: 'attack',
        x,
        y,
        amount: actionConfig.amount,
        allowPartial: actionConfig.allowPartial,
      });
      flashTileAt(x, y, 'valid');
      return;
    }

    if (selectedActionType === 'build') {
      if (!inCurrentRange || !game?.enabledBuildings[actionConfig.buildingType]) {
        flashTileAt(x, y, 'invalid');
        return;
      }

      if (actionConfig.buildingType === 'mine') {
        const plannedMines = plannedActions.filter(
          (act) => act.actionType === 'build' && act.buildingType === 'mine'
        ).length;
        if (minesPlaced + plannedMines >= mineLimit) {
          flashTileAt(x, y, 'invalid');
          return;
        }
      }

      const ownBank = game?.enabledBuildings.bank
        ? dayBuildings.find(
            (b) =>
              b.type === 'bank' && b.ownerId === p.id && !b.isSpent && b.x === x && b.y === y
          )
        : undefined;

      if (ownBank) {
        setSelectedTile({ x, y });
        queueAction({ actionType: 'claim_bank', buildingId: ownBank.id, x, y });
        flashTileAt(x, y, 'valid');
        return;
      }

      const occupiedByPlayer = rosterPlayers.some((op) => op.isAlive && op.x === x && op.y === y);
      const occupiedByBuilding = dayBuildings.some((b) => b.x === x && b.y === y);
      // A second build on a tile that already has a planned (unbuilt) build
      // would fail resolution anyway — block it at queue time.
      const alreadyPlannedBuild = plannedActions.some(
        (a) => a.actionType === 'build' && a.x === x && a.y === y
      );
      if (occupiedByPlayer || occupiedByBuilding || alreadyPlannedBuild) {
        flashTileAt(x, y, 'invalid');
        return;
      }

      setSelectedTile({ x, y });
      queueAction({ actionType: 'build', buildingType: actionConfig.buildingType, x, y });
      flashTileAt(x, y, 'valid');
      return;
    }

    if (selectedActionType === 'send_points') {
      if (!inCurrentRange) {
        flashTileAt(x, y, 'invalid');
        return;
      }
      const target = rosterPlayers.find(
        (op) => op.isAlive && op.id !== p.id && op.x === x && op.y === y
      );
      if (!target) {
        flashTileAt(x, y, 'invalid');
        return;
      }
      setSelectedTile({ x, y });
      setActionConfig((cfg) => ({ ...cfg, targetPlayerId: target.id }));
      queueAction({
        actionType: 'send_points',
        targetPlayerId: target.id,
        amount: actionConfig.amount,
        allowPartial: actionConfig.allowPartial,
      });
      flashTileAt(x, y, 'valid');
      return;
    }

    if (selectedActionType === 'launch_nuke') {
      const silo = selectedNukeSiloId
        ? dayBuildings.find(
            (b) =>
              b.id === selectedNukeSiloId &&
              b.type === 'silo' &&
              b.ownerId === p.id &&
              b.isArmed &&
              !b.isSpent
          )
        : undefined;
      if (!silo) {
        flashTileAt(x, y, 'invalid');
        return;
      }
      setSelectedTile({ x, y });
      queueAction({ actionType: 'launch_nuke', buildingId: silo.id, x, y });
      setSelectedActionType(null);
      setSelectedNukeSiloId(null);
      flashTileAt(x, y, 'valid');
      return;
    }
  };

  const handleRemoveAction = (index: number) => {
    setPlannedActions((prev) => prev.filter((_, i) => i !== index));
    setSaveSuccess(false);
  };

  const handleSubmitActions = async () => {
    if (!player || !canPlanActions || viewingDay !== game?.currentDay) return;
    setIsSavingActions(true);
    setSaveSuccess(false);
    try {
      // Submit in resolution-priority order so orderIndex mirrors what the UI shows.
      const orderedActions = plannedActions
        .map((act, originalIndex) => ({ act, originalIndex }))
        .sort((a, b) => {
          const groupDiff =
            getActionPriorityGroup(a.act.actionType) - getActionPriorityGroup(b.act.actionType);
          return groupDiff !== 0 ? groupDiff : a.originalIndex - b.originalIndex;
        })
        .map(({ act }) => act);

      const res = await fetch('/api/game/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: orderedActions }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedActionsJson(canonicalActionsJson(plannedActions));
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
      } else {
        alert(data.error || t('Failed to submit actions'));
      }
    } catch (err: any) {
      alert(err.message || t('Submission error'));
    } finally {
      setIsSavingActions(false);
    }
  };

  const startReplayDay = async (
    fromDay: number,
    nextDay: number,
    options: { autoPlay?: boolean; fullReplay?: boolean } = {}
  ) => {
    if (!game || fromDay < 1 || nextDay <= fromDay) return false;

    if (!options.fullReplay) {
      setSelectedActionType(null);
      setSelectedTile(null);
      setSaveSuccess(false);
    }

    loadStateRequestRef.current += 1;

    let baseState = options.fullReplay
      ? null
      : currentStateDayRef.current === fromDay
        ? currentState
        : null;
    if (!baseState) {
      try {
        const baseRes = await fetch(`/api/game/state/${fromDay}`);
        if (!baseRes.ok) throw new Error(`Failed to load Day ${fromDay} state`);
        const baseData = await baseRes.json();
        if (!baseData.state) throw new Error(`Day ${fromDay} state missing`);
        baseState = baseData.state as GameStateData;
        setCurrentState(baseState);
        setLoadedStateDay(fromDay);
        currentStateDayRef.current = fromDay;
      } catch (err) {
        console.error('Error fetching base state for replay:', err);
        loadGameCurrent();
        return false;
      }
    }

    setPlaybackBasePlayers(baseState.players);
    setPlaybackEvents(null);
    setPlaybackTargetDay(null);
    setPlaybackEventIndex(-1);
    setActiveFx(null);
    setIsAnimating(true);

    try {
      const res = await fetch(`/api/game/state/${nextDay}`);
      if (!res.ok) throw new Error(`Failed to load Day ${nextDay} state`);
      const data = await res.json();
      if (!data.state) throw new Error(`Day ${nextDay} state missing`);
      const rawEvents: GameEngineEvent[] = data.state.events || [];
      const events = rawEvents.filter((evt) => {
        const isMineBuild = evt.type === 'build' && evt.buildingType === 'mine';
        if (!isMineBuild) return true;
        return game?.phase === 'over' || evt.playerId === player?.id;
      });

      setPlaybackAutoPlay(Boolean(options.autoPlay));
      setPlaybackEvents(events);
      setPlaybackTargetDay(nextDay);
      return true;
    } catch (err) {
      console.error('Error fetching progress state:', err);
      setPlaybackEvents(null);
      setPlaybackTargetDay(null);
      setPlaybackBasePlayers(null);
      setPlaybackEventIndex(-1);
      setPlaybackAutoPlay(false);
      setActiveFx(null);
      setIsAnimating(false);
      loadGameCurrent();
      return false;
    }
  };

  const handleProgressToNextDay = async () => {
    if (!game || game.currentDay === 0 || isAnimating) return;
    if (game.phase !== 'open' && game.phase !== 'over') return;

    const highestVisibleDay = getHighestVisibleDay(game);
    const fromDay = viewingDay;
    if (fromDay < 1 || fromDay >= highestVisibleDay) return;

    setFullReplayEndDay(null);
    await startReplayDay(fromDay, fromDay + 1);
  };

  const handleFullMatchReplay = async () => {
    if (!game || !player?.isAdmin || game.phase !== 'over' || isAnimating) return;

    const finalDay = game.currentDay;
    if (finalDay < 2) {
      setViewingDay(Math.max(1, finalDay));
      await loadGameState(Math.max(1, finalDay));
      return;
    }

    setFullReplayEndDay(finalDay);
    setViewingDay(1);
    setSelectedActionType(null);
    setSelectedTile(null);
    setSaveSuccess(false);

    const started = await startReplayDay(1, 2, {
      autoPlay: true,
      fullReplay: true,
    });
    if (!started) setFullReplayEndDay(null);
  };

  const handleAnimationStep = (evt: GameEngineEvent | null, index: number) => {
    setActiveFx(evt);
    setPlaybackEventIndex(index);
  };

  const handleCompleteAnimation = async () => {
    if (!playbackTargetDay) return;

    const target = playbackTargetDay;
    const isFullReplay = fullReplayEndDay !== null;

    setViewingDay(target);
    await loadGameState(target);

    if (!isFullReplay) {
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

    if (isFullReplay && fullReplayEndDay && target < fullReplayEndDay) {
      setPlaybackEvents(null);
      setPlaybackTargetDay(null);
      setPlaybackBasePlayers(null);
      setPlaybackEventIndex(-1);
      setActiveFx(null);

      const started = await startReplayDay(target, target + 1, {
        autoPlay: true,
        fullReplay: true,
      });
      if (!started) {
        setPlaybackAutoPlay(false);
        setFullReplayEndDay(null);
        setIsAnimating(false);
      }
      return;
    }

    setPlaybackEvents(null);
    setPlaybackTargetDay(null);
    setPlaybackBasePlayers(null);
    setPlaybackEventIndex(-1);
    setPlaybackAutoPlay(false);
    setFullReplayEndDay(null);
    setActiveFx(null);
    setSelectedActionType(null);
    setSelectedTile(null);
    setIsAnimating(false);
  };

  const handleAdminStartGame = async (config?: {
    mapSize: number;
    playerHealth: number;
    rewardPool: number;
    enabledBuildings: Record<string, boolean>;
    mineLimit: number;
    mineLimitIncreaseDays: number;
    assassinationCost: number;
  }) => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/start-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config || {}),
      });
      const data = await res.json();
      if (res.ok) {
        setViewingDay(1);
        setLastDayViewed(1);
        await loadMe();
        await loadGameCurrent();
        setIsAdminOpen(false);
      } else {
        alert(data.error || t('Failed to start game'));
      }
    } catch (err: any) {
      alert(err.message || t('Error starting game'));
    } finally {
      setIsProcessingRound(false);
    }
  };

  const handleAdminToggleBuilding = async (buildingType: string, enabled: boolean) => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/game/buildings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildingType, enabled }),
      });
      const data = await res.json();
      if (res.ok) {
        await loadGameCurrent();
      } else {
        alert(data.error || t('Failed to update building setting'));
      }
    } catch (err: any) {
      alert(err.message || t('Error updating building setting'));
    } finally {
      setIsProcessingRound(false);
    }
  };

  const handleAdminUpdateRewardPool = async (rewardPool: number) => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/game/reward-pool', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardPool }),
      });
      const data = await res.json();
      if (res.ok && data.game) {
        setGame(data.game);
      } else {
        alert(data.error || t('Failed to update reward pool'));
      }
    } catch (err: any) {
      alert(err.message || t('Error updating reward pool'));
    } finally {
      setIsProcessingRound(false);
    }
  };

  const handleAdminUpdateMineRules = async (
    mineLimit: number,
    mineLimitIncreaseDays: number
  ) => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/game/mine-rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mineLimit, mineLimitIncreaseDays }),
      });
      const data = await res.json();
      if (res.ok && data.game) {
        setGame(data.game);
      } else {
        alert(data.error || t('Failed to update mine rules'));
      }
    } catch (err: any) {
      alert(err.message || t('Error updating mine rules'));
    } finally {
      setIsProcessingRound(false);
    }
  };

  const handleAdminUpdateAssassinationCost = async (assassinationCost: number) => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/game/assassination-cost', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assassinationCost }),
      });
      const data = await res.json();
      if (res.ok && data.game) {
        setGame(data.game);
      } else {
        alert(data.error || t('Failed to update assassination cost'));
      }
    } catch (err: any) {
      alert(err.message || t('Error updating assassination cost'));
    } finally {
      setIsProcessingRound(false);
    }
  };

  const handleAdminResolveDay = async () => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/resolve-day', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        await loadGameCurrent();
        setIsAdminOpen(false);
      } else {
        alert(data.error || t('Failed to resolve current day'));
      }
    } catch (err: any) {
      alert(err.message || t('Error resolving current day'));
    } finally {
      setIsProcessingRound(false);
    }
  };

  const handleAdminEndGameWorldPeace = async () => {
    setIsProcessingRound(true);
    try {
      const res = await fetch('/api/admin/end-game-world-peace', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        await loadMe();
        await loadGameCurrent();
        setIsAdminOpen(false);
      } else {
        alert(data.error || t('Failed to end the game'));
      }
    } catch (err: any) {
      alert(err.message || t('Error ending the game'));
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

  // During the closed phase the day currently being calculated must remain
  // sealed off; only the previous day can be inspected.
  const highestVisibleDay = getHighestVisibleDay(game);

  // During the closed phase the timer is the default screen for everyone.
  // Inspecting the previous day (and your submitted actions) is opt-in.
  const showClosedPhaseOverlay = !isUnstarted && isClosed && !isInspectingClosedPhase;

  const handleSelectDay = (day: number) => {
    if (day < 1 || day > highestVisibleDay) return;
    setSelectedActionType(null);
    setSelectedTile(null);
    setViewingDay(day);
    loadGameState(day);
  };

  return (
    <div className="relative w-full h-dvh overflow-hidden bg-[#090b10] text-zinc-100 flex flex-col font-sans select-none">
      {/* 1. Full-Screen Background Grid (Always present, acts as the primary background window) */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <GridMap
          state={currentState}
          currentPlayer={activePlayer}
          selectedActionType={activeActionType}
          onTileClick={handleTileClick}
          onSelectSilo={handleSelectNukeSilo}
          selectedNukeSiloId={selectedNukeSiloId}
          selectedTile={showActionRange ? selectedTile : null}
          activeFx={activeFx}
          isGameOver={isGameOver}
          ghostPosition={effectiveGhostPosition}
          showMyRange={showActionRange}
          flashTile={flashTile}
          mapSize={mapSize}
          maxHealth={maxHealth}
          playersOverride={isAnimating ? animationPlayers : null}
          inspectPlayerId={hoveredPlayerId}
          plannedActions={canPlanActions ? plannedActions : []}
          isPlayback={isAnimating}
          topInset={isAnimating ? 0 : headerHeight}
        />
      </div>

      {/* 2. Closed Phase Screen (Veils the grid on live day during Closed Phase, showing only the timer and previous day navigation) */}
      {showClosedPhaseOverlay && (
        <div className="absolute inset-0 z-40 bg-zinc-950/95 backdrop-blur-xl flex flex-col items-center justify-center text-center p-4 md:p-6 gap-4 md:gap-6">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-3xl bg-amber-950/70 border border-amber-600/40 flex items-center justify-center text-amber-400">
            <Clock className="w-8 h-8 md:w-10 md:h-10" />
          </div>

          <div className="max-w-lg">
            <h2 className="text-lg md:text-2xl font-black text-white tracking-widest uppercase mb-2">
              {t('CLOSED PHASE ACTIVE')}
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {t('The live grid is veiled while backend engines process all planned actions, detonations, and priority queues. The new round opens at 02:00 UTC.')}
            </p>
          </div>

          <div className="font-mono text-2xl md:text-4xl font-black text-amber-400 tracking-widest bg-zinc-900/90 px-6 md:px-8 py-3 md:py-4 rounded-2xl border border-zinc-800">
            {t('{h}h {m}m {s}s', {
              h: Math.floor(secondsRemaining / 3600),
              m: Math.floor((secondsRemaining % 3600) / 60),
              s: secondsRemaining % 60,
            })}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {game && game.currentDay > 1 && (
              <button
                onClick={() => {
                  const prevDay = game.currentDay - 1;
                  setIsInspectingClosedPhase(true);
                  setViewingDay(prevDay);
                  loadGameState(prevDay);
                }}
                className="px-5 md:px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl border border-zinc-700 flex items-center gap-2"
              >
                <History className="w-4 h-4 text-amber-400" />
                <span>{t('View Previous Day & My Actions (Day {day})', { day: game.currentDay - 1 })}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top-of-screen notices: anchored below the measured header so the
          sticky header can never cover them. */}
      {!isAnimating && (
        <div
          className="pointer-events-none absolute inset-x-0 z-50 flex flex-col items-center gap-2 px-3"
          style={{
            top: headerHeight + 8,
            visibility: headerHeight > 0 ? 'visible' : 'hidden',
          }}
        >
          {hasUnsavedChanges && (
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-red-700/70 bg-red-950/90 px-3 py-1.5 shadow-xl backdrop-blur-md">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />
              <span className="text-[11px] md:text-xs font-semibold text-red-200 text-left">
                {t("Unsaved plan changes — your edits haven't been submitted to the server.")}
              </span>
              <button
                onClick={handleSubmitActions}
                disabled={isSavingActions}
                className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold rounded-lg disabled:opacity-50 shrink-0"
              >
                {isSavingActions ? t('Saving…') : t('Submit Now')}
              </button>
            </div>
          )}

          {isUnstarted && (
            <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-amber-500/40 bg-zinc-900/90 px-4 py-3 shadow-2xl backdrop-blur-md">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <div className="text-left flex-1 min-w-[180px]">
                <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  {t('Battlefield Staging — Game Waiting to Start')}
                </h3>
                <p className="text-[11px] text-zinc-400">
                  {t('{count} operative(s) registered. All players will spawn when the game is launched for Day 1.', {
                    count: allPlayers.length,
                  })}
                </p>
              </div>
              {player?.isAdmin ? (
                <span className="text-xs text-zinc-400 font-mono">
                  {t('Launch Day 1 via the Admin Console (header icon)')}
                </span>
              ) : (
                <span className="text-xs text-zinc-500 font-mono">{t('Awaiting Administrator')}</span>
              )}
            </div>
          )}

          {!isUnstarted && isClosed && isInspectingClosedPhase && (
            <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-xl border border-amber-700/60 bg-amber-950/80 px-3 py-2 text-xs text-amber-200 shadow-xl backdrop-blur-md">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="flex-1 min-w-[160px]">
                {t('Viewing Day {day} archive. Live Day {live} is currently calculating.', {
                  day: viewingDay,
                  live: game?.currentDay ?? viewingDay,
                })}
              </span>
              <button
                onClick={() => {
                  setIsInspectingClosedPhase(false);
                  if (game) {
                    const prevDay = Math.max(1, game.currentDay - 1);
                    setViewingDay(prevDay);
                    loadGameState(prevDay);
                  }
                }}
                className="px-2.5 py-1 bg-amber-500 text-zinc-950 rounded font-bold text-[11px] hover:bg-amber-400 flex items-center gap-1"
              >
                {t('Live Timer')} <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3. Floating GUI Windows on top of the Grid (Auto-hidden when animating to reveal the whole grid) */}
      <div
        className={`relative z-30 pointer-events-none w-full h-full flex flex-col justify-between transition-opacity duration-300 ${
          isAnimating ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* Top Header Bar */}
        <div ref={headerRef} className="pointer-events-auto">
          <Header
            game={game}
            secondsRemaining={secondsRemaining}
            viewingDay={viewingDay}
            player={activePlayer}
            onTogglePeaceVote={handleTogglePeaceVote}
            onOpenAdmin={() => setIsAdminOpen(true)}
            onProfileUpdated={loadMe}
          />
        </div>

        {/* Desktop: Floating Side Panels (Action Deck left, Timeline center, Roster right) */}
        {!isMobile && !showClosedPhaseOverlay && (
          <div className="w-full flex-1 flex justify-between items-end p-6 pointer-events-none">
            {/* Bottom-Left: Floating Action Deck (only in active match) */}
            <div className="pointer-events-auto max-w-md w-full">
              {!isUnstarted ? (
                isViewingHistoricalDay ? (
                  <div className="bg-zinc-950/80 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-400">
                    <p className="font-semibold text-zinc-300 mb-1">
                      {t('Viewing Day {day} Archive', { day: viewingDay })}
                    </p>
                    <p>
                      {t('Actions can only be planned for the live day (Day {day}).', {
                        day: game?.currentDay ?? viewingDay,
                      })}
                    </p>
                  </div>
                ) : (
                <ActionPlanner
                  player={activePlayer}
                  allPlayers={rosterPlayers}
                  buildings={currentState?.buildings || []}
                  selectedTile={selectedTile}
                  actions={plannedActions}
                  actionConfig={actionConfig}
                  onActionConfigChange={(patch) =>
                    setActionConfig((cfg) => ({ ...cfg, ...patch }))
                  }
                  onAddAction={queueAction}
                  onRemoveAction={handleRemoveAction}
                  onSubmitActions={handleSubmitActions}
                  onSelectActionType={(actType) => {
                    if (!canPlanActions) return;
                    setSelectedActionType(actType);
                    setSelectedTile(null);
                  }}
                  selectedActionType={activeActionType}
                  isClosed={!canPlanActions}
                  isSaving={isSavingActions}
                  saveSuccess={saveSuccess}
                  ghostPosition={effectiveGhostPosition}
                  enabledBuildings={game?.enabledBuildings ?? createDefaultBuildingConfig()}
                  mapSize={mapSize}
                  selectedNukeSiloId={selectedNukeSiloId}
                  mineLimit={mineLimit}
                  minesPlaced={minesPlaced}
                  nextMineLimitDay={nextMineLimitDay}
                  assassinationCost={game?.assassinationCost ?? DEFAULT_ASSASSINATION_COST}
                />
                )
              ) : (
                <div className="bg-zinc-950/80 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-400">
                  <p className="font-semibold text-zinc-300 mb-1">{t('Staging Area')}</p>
                  <p>{t('Actions will become available once Day 1 is launched by an administrator.')}</p>
                </div>
              )}
            </div>

            {/* Bottom-Center: Floating Timeline Scrubber */}
            {!isUnstarted && (
              <div className="pointer-events-auto max-w-2xl w-full mb-1">
                <DaySelector
                  currentDay={game?.currentDay || 1}
                  viewingDay={viewingDay}
                  lastDayViewed={lastDayViewed}
                  isGameOver={isGameOver}
                  onSelectDay={handleSelectDay}
                  onProgressToNextDay={handleProgressToNextDay}
                  onPlayFullTimeline={player?.isAdmin ? handleFullMatchReplay : undefined}
                  isAnimating={isAnimating}
                  isClosed={isClosed}
                  maxVisibleDay={highestVisibleDay}
                  isStateReady={loadedStateDay === viewingDay && !!currentState}
                />
              </div>
            )}

            {/* Top-Right: Floating Operatives Roster */}
            <div className="pointer-events-auto max-w-xs w-full self-start">
              <PlayerRoster
                allPlayers={allPlayers}
                state={currentState}
                currentPlayerId={player?.id}
                inspectedPlayerId={hoveredPlayerId}
                onHoverPlayer={(id) => setHoveredPlayerId(id)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mobile: bottom dock — bottom sheets (Plan / Players), timeline, tab bar */}
      {isMobile && !showClosedPhaseOverlay && (
        <div
          className={`fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 px-2 pt-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-zinc-950/95 via-zinc-950/80 to-transparent transition-opacity duration-300 ${
            isAnimating ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {/* Sheet content */}
          {mobileSheet === 'plan' &&
            (!isUnstarted ? (
              isViewingHistoricalDay ? (
                <div className="bg-zinc-950/90 backdrop-blur-md border border-zinc-800 rounded-2xl p-3 text-xs text-zinc-400">
                  <p className="font-semibold text-zinc-300 mb-1">
                    {t('Viewing Day {day} Archive', { day: viewingDay })}
                  </p>
                  <p>
                    {t('Actions can only be planned for the live day (Day {day}).', {
                      day: game?.currentDay ?? viewingDay,
                    })}
                  </p>
                </div>
              ) : (
                <ActionPlanner
                  player={activePlayer}
                  allPlayers={rosterPlayers}
                  buildings={currentState?.buildings || []}
                  selectedTile={selectedTile}
                  actions={plannedActions}
                  actionConfig={actionConfig}
                  onActionConfigChange={(patch) =>
                    setActionConfig((cfg) => ({ ...cfg, ...patch }))
                  }
                  onAddAction={queueAction}
                  onRemoveAction={handleRemoveAction}
                  onSubmitActions={handleSubmitActions}
                  onSelectActionType={(actType) => {
                    if (!canPlanActions) return;
                    setSelectedActionType(actType);
                    setSelectedTile(null);
                  }}
                  selectedActionType={activeActionType}
                  isClosed={!canPlanActions}
                  isSaving={isSavingActions}
                  saveSuccess={saveSuccess}
                  ghostPosition={effectiveGhostPosition}
                  enabledBuildings={game?.enabledBuildings ?? createDefaultBuildingConfig()}
                  maxHealth={maxHealth}
                  mapSize={mapSize}
                  selectedNukeSiloId={selectedNukeSiloId}
                  mineLimit={mineLimit}
                  minesPlaced={minesPlaced}
                  nextMineLimitDay={nextMineLimitDay}
                  assassinationCost={game?.assassinationCost ?? DEFAULT_ASSASSINATION_COST}
                />
              )
            ) : (
              <div className="bg-zinc-950/90 backdrop-blur-md border border-zinc-800 rounded-2xl p-3 text-xs text-zinc-400">
                <p className="font-semibold text-zinc-300 mb-1">{t('Staging Area')}</p>
                <p>{t('Actions will become available once Day 1 is launched by an administrator.')}</p>
              </div>
            ))}

          {mobileSheet === 'roster' && (
            <PlayerRoster
              allPlayers={allPlayers}
              state={currentState}
              currentPlayerId={player?.id}
              inspectedPlayerId={hoveredPlayerId}
              onHoverPlayer={(id) => setHoveredPlayerId(id)}
              maxHealth={maxHealth}
            />
          )}

          {/* Timeline Scrubber */}
          {!isUnstarted && (
            <DaySelector
              currentDay={game?.currentDay || 1}
              viewingDay={viewingDay}
              lastDayViewed={lastDayViewed}
              isGameOver={isGameOver}
              onSelectDay={handleSelectDay}
              onProgressToNextDay={handleProgressToNextDay}
              onPlayFullTimeline={player?.isAdmin ? handleFullMatchReplay : undefined}
              isAnimating={isAnimating}
              isClosed={isClosed}
              maxVisibleDay={highestVisibleDay}
              isStateReady={loadedStateDay === viewingDay && !!currentState}
            />
          )}

          {/* Tab bar */}
          <div className="flex gap-2">
            <button
              onClick={() => setMobileSheet((cur) => (cur === 'plan' ? null : 'plan'))}
              disabled={isViewingHistoricalDay}
              className={`flex-1 min-h-11 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed ${
                mobileSheet === 'plan'
                  ? 'bg-amber-600 border-amber-600 text-zinc-950'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-200'
              }`}
            >
              <Swords className="w-4 h-4" />
              {t('Plan')}
              {plannedActions.length > 0 && !isViewingHistoricalDay && (
                <span
                  className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                    mobileSheet === 'plan' ? 'bg-zinc-950/20 text-zinc-950' : 'bg-amber-500 text-zinc-950'
                  }`}
                >
                  {plannedActions.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setMobileSheet((cur) => (cur === 'roster' ? null : 'roster'))}
              className={`flex-1 min-h-11 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider ${
                mobileSheet === 'roster'
                  ? 'bg-amber-600 border-amber-600 text-zinc-950'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-200'
              }`}
            >
              <Users className="w-4 h-4" />
              {t('Players')}
            </button>
          </div>
        </div>
      )}

      {/* 4. Active Animation Playback Controller (Shows during Progress to Next Day) */}
      {playbackEvents && playbackTargetDay && (
        <AnimationPlaybackModal
          events={playbackEvents}
          fromDay={viewingDay}
          toDay={playbackTargetDay}
          autoPlay={playbackAutoPlay}
          onEventStep={handleAnimationStep}
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
        onResolveDay={handleAdminResolveDay}
        onResetGame={handleAdminResetGame}
        onStartGame={handleAdminStartGame}
        onToggleBuilding={handleAdminToggleBuilding}
        onUpdateRewardPool={handleAdminUpdateRewardPool}
        onUpdateMineRules={handleAdminUpdateMineRules}
        onUpdateAssassinationCost={handleAdminUpdateAssassinationCost}
        onEndGameWorldPeace={handleAdminEndGameWorldPeace}
        isProcessing={isProcessingRound}
      />
    </div>
  );
}
