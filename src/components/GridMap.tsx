import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Maximize2, ZoomIn, ZoomOut, Crosshair, Footprints } from 'lucide-react';
import { GameStateData, Player, Building, BuildingType, ActionData } from '../types/game';
import { GAME_RULES, getBankClaimValue, isSquareInPlayerRange } from '../game/rules';
import { ParticleLayer } from './ParticleLayer';

type GridPlayer = GameStateData['players'][string];

interface ActiveFx {
  type: string;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  targetX?: number;
  targetY?: number;
  amount?: number;
  damage?: number;
  description?: string;
}

const BUILDING_ICON_SRC: Record<BuildingType, string> = {
  mine: '/assets/buildings/mine.svg',
  outpost: '/assets/buildings/outpost.svg',
  silo: '/assets/buildings/silo.svg',
  bank: '/assets/buildings/bank.svg',
};

const MINE_EXPLOSION_GIF = '/assets/explosions/mine.gif';
const NUKE_EXPLOSION_GIF = '/assets/explosions/nuke.gif';
const EXPLOSION_DURATION_MS = 1500;

// Preload explosion GIFs so they play instantly on the first detonation.
if (typeof window !== 'undefined') {
  for (const src of [MINE_EXPLOSION_GIF, NUKE_EXPLOSION_GIF]) {
    const img = new Image();
    img.src = src;
  }
}

interface Explosion {
  id: number;
  kind: 'mine' | 'nuke';
  x: number;
  y: number;
}

interface GridMapProps {
  state: GameStateData | null;
  currentPlayer: Player | null;
  selectedActionType?: string | null;
  onTileClick: (x: number, y: number) => void;
  selectedTile: { x: number; y: number } | null;
  activeFx?: ActiveFx | null;
  isGameOver?: boolean;
  ghostPosition?: { x: number; y: number } | null;
  showMyRange?: boolean;
  flashTile?: { x: number; y: number; kind: 'valid' | 'invalid' } | null;
  mapSize: number;
  playersOverride?: Record<string, GridPlayer> | null;
  inspectPlayerId?: string | null;
  plannedActions?: ActionData[];
}

export const GridMap: React.FC<GridMapProps> = ({
  state,
  currentPlayer,
  selectedActionType,
  onTileClick,
  selectedTile,
  activeFx,
  isGameOver = false,
  ghostPosition = null,
  showMyRange = true,
  flashTile = null,
  mapSize,
  playersOverride = null,
  inspectPlayerId = null,
  plannedActions = [],
}) => {
  const [zoom, setZoom] = useState(1);
  const [smoothZoom, setSmoothZoom] = useState(true);
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);
  const [explosions, setExplosions] = useState<Explosion[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Pending zoom anchor (viewport point + content fraction to keep in place)
  const anchorRef = useRef<{ px: number; py: number; fx: number; fy: number } | null>(null);
  // Active mouse-drag pan state (desktop)
  const dragRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const explosionIdRef = useRef(0);
  const explosionTimersRef = useRef<number[]>([]);

  const GRID_SIZE = mapSize;
  const CELL_SIZE = 36; // px per cell

  // Natural (unscaled) grid canvas size: coordinate labels gutter plus board.
  const LABELS_LEFT = 28; // ml-7 column-label gutter (matches row labels 24px + mr-1)
  const LABELS_TOP = 18; // 14px column-label row (h-3.5) + mb-1
  const CONTENT_W = LABELS_LEFT + GRID_SIZE * CELL_SIZE;
  const CONTENT_H = LABELS_TOP + GRID_SIZE * CELL_SIZE;

  // Map entities lookup
  const playerRecord = playersOverride ?? state?.players;
  const playersByCoord: Record<string, any> = {};
  if (playerRecord) {
    Object.values(playerRecord).forEach((p) => {
      if (p.isAlive) {
        playersByCoord[`${p.x},${p.y}`] = p;
      }
    });
  }

  const buildingsByCoord: Record<string, Building[]> = {};
  if (state?.buildings) {
    state.buildings.forEach((b) => {
      const key = `${b.x},${b.y}`;
      if (!buildingsByCoord[key]) buildingsByCoord[key] = [];
      buildingsByCoord[key].push(b);
    });
  }

  // Planned (queued, unresolved) actions keyed by target tile for ghost markers
  const plannedByCoord: Record<string, ActionData[]> = {};
  plannedActions.forEach((a) => {
    if (a.x === undefined || a.y === undefined) return;
    const key = `${a.x},${a.y}`;
    if (!plannedByCoord[key]) plannedByCoord[key] = [];
    plannedByCoord[key].push(a);
  });

  // Player whose range is being inspected — via tap on the map (hoveredPlayerId)
  // or via the roster (inspectPlayerId).
  const effectiveInspectId = hoveredPlayerId ?? inspectPlayerId;
  const hoveredPlayer =
    effectiveInspectId && state?.players ? state.players[effectiveInspectId] : null;

  // Actual position vs. projected (ghost) position after queued moves
  const actualPlayerPos = currentPlayer ? { x: currentPlayer.x, y: currentPlayer.y } : null;
  const effectivePlayerPos = ghostPosition || actualPlayerPos;

  const isRangeAction =
    selectedActionType === 'attack' ||
    selectedActionType === 'build' ||
    selectedActionType === 'send_points';
  const isMoveAction = selectedActionType === 'move';
  const isNukeAction = selectedActionType === 'launch_nuke';
  const hasActiveAction = Boolean(selectedActionType);

  // Zoom anchored to a viewport point (cursor / pinch midpoint / view center)
  // so the content under that point stays put while the scale changes.
  const setZoomAnchored = (
    nextZoom: number,
    clientX?: number,
    clientY?: number,
    smooth = true
  ) => {
    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    const clamped = Math.min(2.5, Math.max(0.4, nextZoom));
    setSmoothZoom(smooth);
    if (!container || !wrapper) {
      setZoom(clamped);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const wRect = wrapper.getBoundingClientRect();
    const px = clientX !== undefined ? clientX - cRect.left : cRect.width / 2;
    const py = clientY !== undefined ? clientY - cRect.top : cRect.height / 2;
    const fx = wRect.width > 0 ? (px - (wRect.left - cRect.left)) / wRect.width : 0.5;
    const fy = wRect.height > 0 ? (py - (wRect.top - cRect.top)) / wRect.height : 0.5;
    anchorRef.current = {
      px,
      py,
      fx: Math.min(1, Math.max(0, fx)),
      fy: Math.min(1, Math.max(0, fy)),
    };
    setZoom(clamped);
  };

  // After a zoom re-render, shift the scroll offsets so the anchored content
  // fraction lands back under the same viewport point.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) return;
    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    if (!container || !wrapper) return;
    const cRect = container.getBoundingClientRect();
    const wRect = wrapper.getBoundingClientRect();
    const curX = wRect.left - cRect.left + anchor.fx * wRect.width;
    const curY = wRect.top - cRect.top + anchor.fy * wRect.height;
    container.scrollLeft += curX - anchor.px;
    container.scrollTop += curY - anchor.py;
  }, [zoom]);

  // Desktop: mouse wheel zooms the map, anchored at the cursor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoomAnchored(zoomRef.current * factor, e.clientX, e.clientY, false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Desktop: drag-to-pan the grid viewport.
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      moved: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    const el = containerRef.current;
    if (!drag || !el) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      setIsPanning(true);
    }
    el.scrollLeft = drag.scrollLeft - dx;
    el.scrollTop = drag.scrollTop - dy;
  };

  const endDrag = () => {
    if (dragRef.current?.moved) {
      // Suppress the click that follows the mouseup so a pan never queues an
      // action. The click dispatches before this timeout clears the flag.
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragRef.current = null;
    setIsPanning(false);
  };

  // Pinch-to-zoom on the map (two fingers). Single-finger panning stays native.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let pinch: { startDist: number; startZoom: number } | null = null;
    const touchDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      pinch = e.touches.length === 2 ? { startDist: touchDist(e.touches), startZoom: zoomRef.current } : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch) {
        e.preventDefault();
        const scale = touchDist(e.touches) / pinch.startDist;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        setZoomAnchored(pinch.startZoom * scale, midX, midY, false);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // Detonation GIFs: mines and nukes play their explosion asset on top of the
  // particle effects whenever their engine event becomes active.
  useEffect(() => {
    if (!activeFx) return;
    let kind: 'mine' | 'nuke' | null = null;
    let x = 0;
    let y = 0;
    if (
      activeFx.type === 'mine_triggered' &&
      activeFx.fromX !== undefined &&
      activeFx.fromY !== undefined
    ) {
      kind = 'mine';
      x = activeFx.fromX;
      y = activeFx.fromY;
    } else if (
      activeFx.type === 'nuke_launch' &&
      activeFx.toX !== undefined &&
      activeFx.toY !== undefined
    ) {
      kind = 'nuke';
      x = activeFx.toX;
      y = activeFx.toY;
    }
    if (!kind) return;

    const id = ++explosionIdRef.current;
    setExplosions((prev) => [...prev, { id, kind: kind!, x, y }]);
    const timer = window.setTimeout(() => {
      setExplosions((prev) => prev.filter((e) => e.id !== id));
    }, EXPLOSION_DURATION_MS);
    explosionTimersRef.current.push(timer);
  }, [activeFx]);

  useEffect(() => {
    return () => {
      explosionTimersRef.current.forEach((t) => window.clearTimeout(t));
      explosionTimersRef.current = [];
    };
  }, []);

  // Check if tile is in current player's actual 21-tile circular range
  const isTileInCurrentRange = (x: number, y: number) => {
    if (!hasActiveAction || !showMyRange || !actualPlayerPos || !currentPlayer?.isAlive) return false;
    return isSquareInPlayerRange(actualPlayerPos.x, actualPlayerPos.y, x, y, GRID_SIZE);
  };

  // Check if tile is in the projected 21-tile circular range (from the ghost position)
  const isTileInGhostRange = (x: number, y: number) => {
    if (!hasActiveAction || !ghostPosition || !currentPlayer?.isAlive) return false;
    return isSquareInPlayerRange(ghostPosition.x, ghostPosition.y, x, y, GRID_SIZE);
  };

  // Check if tile is a cardinal neighbor of the effective position (move candidates)
  const isMoveCandidate = (x: number, y: number) => {
    if (!hasActiveAction || !isMoveAction || !effectivePlayerPos || !currentPlayer?.isAlive) {
      return false;
    }
    const isCardinalNeighbor =
      (Math.abs(x - effectivePlayerPos.x) === 1 && y === effectivePlayerPos.y) ||
      (Math.abs(y - effectivePlayerPos.y) === 1 && x === effectivePlayerPos.x);
    if (!isCardinalNeighbor) return false;

    const occupiedByPlayer = !!playersByCoord[`${x},${y}`];
    const blockingBuilding = (buildingsByCoord[`${x},${y}`] || []).some(
      (b) => GAME_RULES.BUILDINGS[b.type].blocksMovement
    );
    return !occupiedByPlayer && !blockingBuilding;
  };

  // Check if tile is in the inspected player's circular range (tap or roster)
  const isTileInHoveredRange = (x: number, y: number) => {
    if (!hoveredPlayer || !hoveredPlayer.isAlive) {
      return false;
    }
    return isSquareInPlayerRange(hoveredPlayer.x, hoveredPlayer.y, x, y, GRID_SIZE);
  };

  const animatePlayerTokens = playersOverride !== null;
  const animatedPlayers = playerRecord
    ? Object.values(playerRecord).filter((p) => p.isAlive)
    : [];

  const renderPlayerToken = (tokenPlayer: GridPlayer) => (
    <div className="relative z-20 flex flex-col items-center group">
      {/* 1:1 Rounded Square Avatar */}
      <div
        className={`w-7 h-7 rounded-lg overflow-hidden border bg-zinc-800 relative ${
          tokenPlayer.id === currentPlayer?.id
            ? 'border-2 border-amber-400'
            : 'border-zinc-600'
        }`}
      >
        <img
          src={tokenPlayer.avatarUrl}
          alt={tokenPlayer.username}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>

      {/* Health dots indicator */}
      <div className="absolute -top-2 flex gap-0.5 bg-zinc-950/90 px-1 py-0.2 rounded-full border border-zinc-800">
        {Array.from({ length: 3 }).map((_, hIdx) => (
          <span
            key={hIdx}
            className={`w-1.5 h-1.5 rounded-full ${
              hIdx < tokenPlayer.health ? 'bg-red-500' : 'bg-zinc-700'
            }`}
          />
        ))}
      </div>

      {/* Username tooltip underneath */}
      <div className="absolute top-7 pointer-events-none whitespace-nowrap bg-zinc-900/90 text-zinc-200 text-[9px] font-medium px-1.5 py-0.5 rounded shadow border border-zinc-700 opacity-90 group-hover:opacity-100 z-30">
        {tokenPlayer.username}
      </div>
    </div>
  );

  const getCellCenterPx = (x: number, y: number) => {
    return {
      cx: (x - 1) * CELL_SIZE + CELL_SIZE / 2,
      cy: (y - 1) * CELL_SIZE + CELL_SIZE / 2,
    };
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center select-none overflow-hidden">
      {/* Desktop: Grid Map Controls Toolbar (mobile uses the side zoom cluster) */}
      <div className="hidden md:flex absolute top-16 left-6 z-20 items-center gap-2 bg-zinc-950/80 backdrop-blur border border-zinc-800 rounded-xl px-3 py-1.5 shadow-lg text-xs">
        <Crosshair className="w-4 h-4 text-amber-400" />
        <span className="font-bold text-zinc-200">{GRID_SIZE}×{GRID_SIZE} SECTOR GRID</span>
        {hoverCoord && (
          <span className="font-mono text-amber-300 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700 text-[11px]">
            ({hoverCoord.x}, {hoverCoord.y})
          </span>
        )}
        {selectedTile && (
          <span className="font-mono text-emerald-400 bg-emerald-950/70 px-2 py-0.5 rounded border border-emerald-800 text-[11px]">
            Target: ({selectedTile.x}, {selectedTile.y})
          </span>
        )}
        {ghostPosition && (
          <span className="font-mono text-cyan-400 bg-cyan-950/70 px-2 py-0.5 rounded border border-cyan-800 text-[11px] flex items-center gap-1">
            <Footprints className="w-3 h-3" />
            Ghost: ({ghostPosition.x}, {ghostPosition.y})
          </span>
        )}

        {isRangeAction && (
          <div className="flex items-center gap-2 border-l border-zinc-800 pl-2 ml-1 text-[9px] font-semibold text-zinc-300">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-sky-500/70 ring-1 ring-sky-300/60" />
              Current
            </span>
            {ghostPosition && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-fuchsia-500/70 ring-1 ring-fuchsia-300/60" />
                Projected
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 border-l border-zinc-800 pl-2 ml-1">
          <button
            onClick={() => setZoomAnchored(zoom - 0.1)}
            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-[10px] text-zinc-400 w-8 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoomAnchored(zoom + 0.1)}
            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoomAnchored(1)}
            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
            title="Reset Zoom"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Mobile: floating zoom cluster (pinch gestures also work) */}
      <div className="md:hidden absolute right-2 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1 bg-zinc-950/90 backdrop-blur border border-zinc-800 rounded-xl p-1 shadow-lg">
        <button
          onClick={() => setZoomAnchored(zoom + 0.1)}
          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoomAnchored(1)}
          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
          title="Reset Zoom"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoomAnchored(zoom - 0.1)}
          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
      </div>

      {/* Grid Canvas Scrollport: freely scrollable in every direction.
          The grid centers itself (margin auto) while it fits the viewport and
          stays fully reachable — including left and up — once zoomed in.
          Desktop pans by dragging and zooms with the mouse wheel. */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        className="w-full h-full flex overflow-auto overscroll-contain scrollbar-thin p-3 md:p-6"
        style={{
          touchAction: 'pan-x pan-y',
          cursor: hasActiveAction ? undefined : isPanning ? 'grabbing' : 'grab',
        }}
      >
        <div
          ref={wrapperRef}
          className="m-auto shrink-0 relative"
          style={{ width: CONTENT_W * zoom, height: CONTENT_H * zoom }}
        >
          <div
            className="absolute top-0 left-0"
            style={{
              width: CONTENT_W,
              height: CONTENT_H,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              transition: smoothZoom ? 'transform 0.15s ease-out' : 'none',
            }}
          >
            {/* Top Column Coordinate Labels (1..25) */}
            <div className="flex ml-7 mb-1 h-3.5">
              {Array.from({ length: GRID_SIZE }, (_, i) => (
                <div
                  key={`col-${i + 1}`}
                  style={{ width: CELL_SIZE }}
                  className="text-center font-mono text-[9px] text-zinc-500 font-bold"
                >
                  {i + 1}
                </div>
              ))}
            </div>

          <div className="flex">
            {/* Left Row Coordinate Labels (1..25) */}
            <div className="flex flex-col mr-1">
              {Array.from({ length: GRID_SIZE }, (_, j) => (
                <div
                  key={`row-${j + 1}`}
                  style={{ height: CELL_SIZE, width: 24 }}
                  className="flex items-center justify-end pr-1 font-mono text-[9px] text-zinc-500 font-bold"
                >
                  {j + 1}
                </div>
              ))}
            </div>

            {/* 25x25 Board Tiles */}
            <div
              className="relative grid border border-zinc-800/80 bg-zinc-950/90 shadow-xl"
              style={{
                gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
                gridTemplateRows: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
                width: GRID_SIZE * CELL_SIZE,
                height: GRID_SIZE * CELL_SIZE,
              }}
            >
              {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, idx) => {
                const x = (idx % GRID_SIZE) + 1; // 1 to 25
                const y = Math.floor(idx / GRID_SIZE) + 1; // 1 to 25
                const coordKey = `${x},${y}`;
                const playerOnTile = playersByCoord[coordKey];
                const buildingsOnTile = buildingsByCoord[coordKey] || [];
                const plannedOnTile = plannedByCoord[coordKey] || [];
                const plannedAttack = plannedOnTile.find((a) => a.actionType === 'attack');
                const plannedClaim = plannedOnTile.find((a) => a.actionType === 'claim_bank');
                const plannedBuild = plannedOnTile.find(
                  (a) => a.actionType === 'build' && a.buildingType
                );

                const inCurrentRange = isTileInCurrentRange(x, y);
                const inGhostRange = isTileInGhostRange(x, y);
                const moveCandidate = isMoveCandidate(x, y);
                const inHoveredRange = isTileInHoveredRange(x, y);

                const isGhostTile =
                  hasActiveAction &&
                  !!ghostPosition &&
                  ghostPosition.x === x &&
                  ghostPosition.y === y;
                const isFlashTile = flashTile?.x === x && flashTile?.y === y;

                const isSelectable = !hasActiveAction
                  ? false
                  : isMoveAction
                  ? moveCandidate
                  : isNukeAction
                  ? true
                  : inCurrentRange || inGhostRange;

                let tileTone = 'hover:bg-zinc-800/40';
                if (inCurrentRange && inGhostRange) {
                  tileTone = isRangeAction
                    ? 'bg-violet-500/20 ring-1 ring-violet-400/50 hover:bg-violet-500/30'
                    : 'bg-cyan-500/10 ring-1 ring-cyan-500/25';
                } else if (inGhostRange) {
                  tileTone = isRangeAction
                    ? 'bg-fuchsia-500/15 ring-1 ring-fuchsia-400/45 hover:bg-fuchsia-500/25'
                    : 'bg-fuchsia-500/10 ring-1 ring-fuchsia-500/25';
                } else if (inCurrentRange) {
                  tileTone = isRangeAction
                    ? 'bg-sky-500/15 ring-1 ring-sky-400/45 hover:bg-sky-500/25'
                    : 'bg-cyan-500/10 ring-1 ring-cyan-500/25';
                } else if (moveCandidate) {
                  tileTone = 'bg-emerald-500/15 ring-1 ring-emerald-400/45 hover:bg-emerald-500/25';
                } else if (inHoveredRange) {
                  tileTone = 'bg-red-500/15 ring-1 ring-red-500/30';
                }

                return (
                  <div
                    key={coordKey}
                    onClick={() => {
                      // Ignore clicks that belong to a finished drag-pan.
                      if (suppressClickRef.current) return;
                      if (hasActiveAction && isSelectable) {
                        onTileClick(x, y);
                      } else if (!hasActiveAction) {
                        // Inspection mode (tap a player to highlight their range)
                        setHoverCoord({ x, y });
                        if (playerOnTile) {
                          setHoveredPlayerId((cur) =>
                            cur === playerOnTile.id ? null : playerOnTile.id
                          );
                        } else {
                          setHoveredPlayerId(null);
                        }
                      }
                    }}
                    onMouseEnter={() => {
                      setHoverCoord({ x, y });
                      if (playerOnTile) setHoveredPlayerId(playerOnTile.id);
                    }}
                    onMouseLeave={() => {
                      if (playerOnTile && hoveredPlayerId === playerOnTile.id) {
                        setHoveredPlayerId(null);
                      }
                    }}
                    style={{ width: CELL_SIZE, height: CELL_SIZE }}
                    className={`relative border border-zinc-800/35 transition-all flex items-center justify-center touch-manipulation ${
                      hasActiveAction
                        ? isSelectable
                          ? 'cursor-crosshair'
                          : 'cursor-not-allowed'
                        : '' /* inherit the map pan cursor */
                    } ${tileTone}`}
                  >
                    {/* Buildings Layer (SVG icons from public/assets/buildings) */}
                    {buildingsOnTile.map((b) => (
                      <div
                        key={b.id}
                        className={`absolute inset-0 flex items-center justify-center ${
                          (b as any).transparent ? 'opacity-40' : ''
                        }`}
                        title={
                          b.type === 'bank'
                            ? `BANK (HP: ${b.health}) — Value: ${b.value ?? 1} (claim next round: ${getBankClaimValue(
                                b.value ?? 1
                              )})`
                            : `${b.type.toUpperCase()} (HP: ${b.health})`
                        }
                      >
                        {b.type === 'mine' && (
                          <img
                            src={BUILDING_ICON_SRC.mine}
                            alt="mine"
                            draggable={false}
                            className="w-5 h-5 select-none"
                          />
                        )}
                        {b.type === 'outpost' && (
                          <div className="p-0.5 rounded bg-zinc-900/95 border border-zinc-600">
                            <img
                              src={BUILDING_ICON_SRC.outpost}
                              alt="outpost"
                              draggable={false}
                              className="w-4 h-4 select-none"
                            />
                          </div>
                        )}
                        {b.type === 'silo' && (
                          <div
                            className={`p-0.5 rounded border ${
                              b.isArmed
                                ? 'bg-red-950/90 border-red-500/70'
                                : 'bg-zinc-900/95 border-zinc-600'
                            }`}
                          >
                            <img
                              src={BUILDING_ICON_SRC.silo}
                              alt="silo"
                              draggable={false}
                              className="w-4 h-4 select-none"
                            />
                          </div>
                        )}
                        {b.type === 'bank' && (
                          <div className="relative group/bank p-0.5 rounded bg-zinc-900/95 border border-zinc-600">
                            <img
                              src={BUILDING_ICON_SRC.bank}
                              alt="bank"
                              draggable={false}
                              className="w-4 h-4 select-none"
                            />
                            <span className="absolute -bottom-1 -right-1 text-[8px] font-mono font-bold bg-amber-500 text-zinc-950 rounded px-0.5 leading-none">
                              {b.value ?? 1}
                            </span>
                            <div className="pointer-events-none absolute left-1/2 bottom-full z-50 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-amber-700 bg-zinc-950/95 px-2 py-1 text-[9px] font-normal text-amber-200 shadow-xl group-hover/bank:block">
                              <div className="font-bold text-amber-300">BANK</div>
                              <div>
                                Value now: <span className="font-mono font-bold">{b.value ?? 1}</span>
                              </div>
                              <div>
                                Claim next round:{' '}
                                <span className="font-mono font-bold text-emerald-300">
                                  {getBankClaimValue(b.value ?? 1)}
                                </span>
                              </div>
                              {b.ownerId === currentPlayer?.id && (
                                <div className="font-semibold text-cyan-300">
                                  Click with Build to claim
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Planned Action Ghost Markers (queued, unresolved) */}
                    {plannedAttack && (
                      <div
                        className="absolute inset-[2px] rounded-sm border-2 border-red-500/80 bg-red-500/10 pointer-events-none z-10"
                        title={`Planned Attack${plannedAttack.targetPlayerId ? ' on enemy operative' : ''}`}
                      />
                    )}
                    {plannedClaim && (
                      <div
                        className="absolute inset-[2px] rounded-sm border-2 border-dashed border-amber-400/80 pointer-events-none z-10"
                        title="Planned Bank Claim"
                      />
                    )}
                    {plannedBuild && (
                      <div
                        className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
                        title={`Planned ${plannedBuild.buildingType}`}
                      >
                        <img
                          src={BUILDING_ICON_SRC[plannedBuild.buildingType!]}
                          alt={`planned ${plannedBuild.buildingType}`}
                          draggable={false}
                          className="w-3.5 h-3.5 opacity-60 select-none"
                        />
                      </div>
                    )}

                    {/* Actual Player Token Layer */}
                    {playerOnTile && !animatePlayerTokens && renderPlayerToken(playerOnTile)}

                    {/* Ghost Operative Token (Projected Future Position) */}
                    {isGhostTile && (
                      <div className="relative z-20 flex flex-col items-center pointer-events-none">
                        <div className="w-7 h-7 rounded-lg border-2 border-dashed border-cyan-400 bg-cyan-500/20 flex items-center justify-center">
                          <Footprints className="w-4 h-4 text-cyan-300" />
                        </div>
                        <div className="absolute top-7 whitespace-nowrap bg-cyan-950/90 text-cyan-300 text-[8px] font-mono font-bold px-1 rounded border border-cyan-700/80 shadow">
                          PLANNED POS
                        </div>
                      </div>
                    )}

                    {/* Brief confirmation flash when a tile is queued / rejected */}
                    {isFlashTile && flashTile && (
                      <div
                        className={`absolute inset-0 z-40 pointer-events-none rounded-md ${
                          flashTile.kind === 'valid'
                            ? 'tile-flash-valid'
                            : 'tile-flash-invalid'
                        }`}
                      />
                    )}
                  </div>
                );
              })}

              {/* Animated Player Tokens (tweened between tiles during replay) */}
              {animatePlayerTokens && (
                <div className="absolute inset-0 pointer-events-none z-20">
                  {animatedPlayers.map((p) => (
                    <div
                      key={p.id}
                      className="absolute left-0 top-0 flex items-center justify-center"
                      style={{
                        width: CELL_SIZE,
                        height: CELL_SIZE,
                        transform: `translate(${(p.x - 1) * CELL_SIZE}px, ${
                          (p.y - 1) * CELL_SIZE
                        }px)`,
                        transition: 'transform 800ms ease-in-out',
                        willChange: 'transform',
                      }}
                    >
                      {renderPlayerToken(p)}
                    </div>
                  ))}
                </div>
              )}

              {/* Detonation GIF Layer (plays over the particle effects) */}
              {explosions.map((e) => {
                const size = (e.kind === 'nuke' ? 3.6 : 2.4) * CELL_SIZE;
                const cx = (e.x - 1) * CELL_SIZE + CELL_SIZE / 2;
                const cy = (e.y - 1) * CELL_SIZE + CELL_SIZE / 2;
                return (
                  <img
                    key={e.id}
                    src={e.kind === 'nuke' ? NUKE_EXPLOSION_GIF : MINE_EXPLOSION_GIF}
                    alt=""
                    draggable={false}
                    className="absolute pointer-events-none z-40 select-none"
                    style={{
                      width: size,
                      height: size,
                      left: cx - size / 2,
                      top: cy - size / 2,
                    }}
                  />
                );
              })}

              {/* Dynamic SVG Visual FX Layer */}
              <svg
                className="absolute inset-0 pointer-events-none z-30"
                style={{
                  width: GRID_SIZE * CELL_SIZE,
                  height: GRID_SIZE * CELL_SIZE,
                }}
              >
                <defs>
                  <marker
                    id="arrow-yellow"
                    viewBox="0 0 10 10"
                    refX="5"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
                  </marker>
                  <marker
                    id="arrow-red"
                    viewBox="0 0 10 10"
                    refX="5"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                  </marker>
                </defs>

                {/* Planned Nuclear Strikes: dashed 3x3 blast outlines */}
                {plannedActions
                  .filter((a) => a.actionType === 'launch_nuke')
                  .map((a, i) => {
                    if (a.x === undefined || a.y === undefined) return null;
                    const left = Math.max(0, (a.x - 2) * CELL_SIZE);
                    const top = Math.max(0, (a.y - 2) * CELL_SIZE);
                    const right = Math.min(GRID_SIZE * CELL_SIZE, (a.x + 1) * CELL_SIZE);
                    const bottom = Math.min(GRID_SIZE * CELL_SIZE, (a.y + 1) * CELL_SIZE);
                    return (
                      <rect
                        key={`planned-nuke-${i}`}
                        x={left}
                        y={top}
                        width={Math.max(0, right - left)}
                        height={Math.max(0, bottom - top)}
                        fill="rgba(239, 68, 68, 0.12)"
                        stroke="#ef4444"
                        strokeWidth="2"
                        strokeDasharray="4 3"
                        opacity="0.9"
                      />
                    );
                  })}

                {/* Trajectory from Actual Pos to Ghost Pos */}
                {ghostPosition && currentPlayer && (
                  <g>
                    {(() => {
                      const p1 = getCellCenterPx(currentPlayer.x, currentPlayer.y);
                      const p2 = getCellCenterPx(ghostPosition.x, ghostPosition.y);
                      return (
                        <line
                          x1={p1.cx}
                          y1={p1.cy}
                          x2={p2.cx}
                          y2={p2.cy}
                          stroke="#06b6d4"
                          strokeWidth="2"
                          strokeDasharray="4 3"
                          opacity="0.8"
                        />
                      );
                    })()}
                  </g>
                )}

                {/* Active Events FX */}
                {activeFx && (
                  <>
                    {/* Point Transfer: Yellow Arrow */}
                    {activeFx.type === 'send_points' &&
                      activeFx.fromX !== undefined &&
                      activeFx.toX !== undefined && (
                        <g>
                          {(() => {
                            const p1 = getCellCenterPx(activeFx.fromX!, activeFx.fromY!);
                            const p2 = getCellCenterPx(activeFx.toX!, activeFx.toY!);
                            return (
                              <>
                                <line
                                  x1={p1.cx}
                                  y1={p1.cy}
                                  x2={p2.cx}
                                  y2={p2.cy}
                                  stroke="#f59e0b"
                                  strokeWidth="3"
                                  strokeDasharray="6 4"
                                  markerEnd="url(#arrow-yellow)"
                                />
                                <circle
                                  cx={p2.cx}
                                  cy={p2.cy}
                                  r="22"
                                  fill="none"
                                  stroke="#f59e0b"
                                  strokeWidth="2.5"
                                />
                              </>
                            );
                          })()}
                        </g>
                      )}

                    {/* Attack: Red Arrow & Impact Reticle */}
                    {activeFx.type === 'attack' &&
                      activeFx.fromX !== undefined &&
                      activeFx.toX !== undefined && (
                        <g>
                          {(() => {
                            const p1 = getCellCenterPx(activeFx.fromX!, activeFx.fromY!);
                            const p2 = getCellCenterPx(activeFx.toX!, activeFx.toY!);
                            return (
                              <>
                                <line
                                  x1={p1.cx}
                                  y1={p1.cy}
                                  x2={p2.cx}
                                  y2={p2.cy}
                                  stroke="#ef4444"
                                  strokeWidth="3"
                                  markerEnd="url(#arrow-red)"
                                />
                                <circle
                                  cx={p2.cx}
                                  cy={p2.cy}
                                  r="18"
                                  fill="rgba(239, 68, 68, 0.3)"
                                  stroke="#ef4444"
                                  strokeWidth="2"
                                />
                              </>
                            );
                          })()}
                        </g>
                      )}

                    {/* Mine Detonation FX (GIF + particles do the visual work) */}
                    {activeFx.type === 'mine_triggered' && activeFx.fromX !== undefined && (
                      <g>
                        {(() => {
                          const p = getCellCenterPx(activeFx.fromX!, activeFx.fromY!);
                          return (
                            <text
                              x={p.cx}
                              y={p.cy - 16}
                              fill="#ef4444"
                              fontSize="12"
                              fontWeight="black"
                              textAnchor="middle"
                            >
                              EXPLOSION! -1 HP
                            </text>
                          );
                        })()}
                      </g>
                    )}

                    {/* Nuclear Launch 3x3 Impact Box */}
                    {activeFx.type === 'nuke_launch' && activeFx.toX !== undefined && (
                      <g>
                        {(() => {
                          const targetX = activeFx.toX!;
                          const targetY = activeFx.toY!;
                          const minX = Math.max(1, targetX - 1);
                          const minY = Math.max(1, targetY - 1);
                          const maxX = Math.min(GRID_SIZE, targetX + 1);
                          const maxY = Math.min(GRID_SIZE, targetY + 1);

                          const rectX = (minX - 1) * CELL_SIZE;
                          const rectY = (minY - 1) * CELL_SIZE;
                          const rectW = (maxX - minX + 1) * CELL_SIZE;
                          const rectH = (maxY - minY + 1) * CELL_SIZE;

                          return (
                            <>
                              <rect
                                x={rectX}
                                y={rectY}
                                width={rectW}
                                height={rectH}
                                fill="rgba(239, 68, 68, 0.4)"
                                stroke="#ef4444"
                                strokeWidth="3"
                                strokeDasharray="4 2"
                              />
                              <text
                                x={rectX + rectW / 2}
                                y={rectY + rectH / 2}
                                fill="#fff"
                                fontSize="14"
                                fontWeight="black"
                                textAnchor="middle"
                                alignmentBaseline="central"
                              >
                                ☢ NUCLEAR BLAST ☢
                              </text>
                            </>
                          );
                        })()}
                      </g>
                    )}
                  </>
                )}
              </svg>

              <ParticleLayer activeFx={activeFx} mapSize={GRID_SIZE} cellSize={CELL_SIZE} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
