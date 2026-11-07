import React, { useState, useRef } from 'react';
import {
  Shield,
  Bomb,
  Landmark,
  Rocket,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Footprints,
  Eye,
} from 'lucide-react';
import { GameStateData, Player, Building } from '../types/game';
import { GAME_RULES, getBankClaimValue, isSquareInPlayerRange } from '../game/rules';

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
}) => {
  const [zoom, setZoom] = useState(1);
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const GRID_SIZE = GAME_RULES.GRID_SIZE; // 25
  const CELL_SIZE = 36; // px per cell

  // Map entities lookup
  const playersByCoord: Record<string, any> = {};
  if (state?.players) {
    Object.values(state.players).forEach((p) => {
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

  // Find player whose range is being inspected via hover
  const hoveredPlayer = hoveredPlayerId && state?.players ? state.players[hoveredPlayerId] : null;

  // Actual position vs. projected (ghost) position after queued moves
  const actualPlayerPos = currentPlayer ? { x: currentPlayer.x, y: currentPlayer.y } : null;
  const effectivePlayerPos = ghostPosition || actualPlayerPos;

  const isRangeAction =
    selectedActionType === 'attack' ||
    selectedActionType === 'build' ||
    selectedActionType === 'send_points';
  const isMoveAction = selectedActionType === 'move';
  const isNukeAction = selectedActionType === 'launch_nuke';

  // Check if tile is in current player's actual 21-tile circular range
  const isTileInCurrentRange = (x: number, y: number) => {
    if (!showMyRange || !actualPlayerPos || !currentPlayer?.isAlive) return false;
    return isSquareInPlayerRange(actualPlayerPos.x, actualPlayerPos.y, x, y);
  };

  // Check if tile is in the projected 21-tile circular range (from the ghost position)
  const isTileInGhostRange = (x: number, y: number) => {
    if (!ghostPosition || !currentPlayer?.isAlive) return false;
    return isSquareInPlayerRange(ghostPosition.x, ghostPosition.y, x, y);
  };

  // Check if tile is a cardinal neighbor of the effective position (move candidates)
  const isMoveCandidate = (x: number, y: number) => {
    if (!isMoveAction || !effectivePlayerPos || !currentPlayer?.isAlive) return false;
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

  // Check if tile is in hovered player's circular range
  const isTileInHoveredRange = (x: number, y: number) => {
    if (!hoveredPlayer || !hoveredPlayer.isAlive) return false;
    return isSquareInPlayerRange(hoveredPlayer.x, hoveredPlayer.y, x, y);
  };

  const getCellCenterPx = (x: number, y: number) => {
    return {
      cx: (x - 1) * CELL_SIZE + CELL_SIZE / 2,
      cy: (y - 1) * CELL_SIZE + CELL_SIZE / 2,
    };
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center select-none overflow-hidden">
      {/* Background Ambience / Grid Map Controls Toolbar */}
      <div className="absolute top-16 left-6 z-20 flex items-center gap-2 bg-zinc-950/80 backdrop-blur border border-zinc-800 rounded-xl px-3 py-1.5 shadow-xl text-xs">
        <Crosshair className="w-4 h-4 text-amber-400" />
        <span className="font-bold text-zinc-200">25×25 SECTOR GRID</span>
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
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-[10px] text-zinc-400 w-8 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
            title="Reset Zoom"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Grid Canvas Wrapper */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center p-6 overflow-auto scrollbar-thin"
      >
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            transition: 'transform 0.15s ease-out',
          }}
          className="relative my-auto"
        >
          {/* Top Column Coordinate Labels (1..25) */}
          <div className="flex ml-7 mb-1">
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
              className="relative grid border border-zinc-800/80 bg-zinc-950/90 shadow-2xl"
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

                const inCurrentRange = isTileInCurrentRange(x, y);
                const inGhostRange = isTileInGhostRange(x, y);
                const moveCandidate = isMoveCandidate(x, y);
                const inHoveredRange = isTileInHoveredRange(x, y);

                const isGhostTile = ghostPosition && ghostPosition.x === x && ghostPosition.y === y;
                const isFlashTile = flashTile?.x === x && flashTile?.y === y;

                const isSelectable = !selectedActionType
                  ? true
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
                    onClick={() => onTileClick(x, y)}
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
                    className={`relative border border-zinc-800/35 transition-all flex items-center justify-center ${
                      isSelectable
                        ? selectedActionType
                          ? 'cursor-crosshair'
                          : 'cursor-pointer'
                        : 'cursor-not-allowed'
                    } ${tileTone}`}
                  >
                    {/* Buildings Layer */}
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
                          <div className="relative">
                            <Bomb className="w-4 h-4 text-rose-500 animate-pulse" />
                            <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-rose-500" />
                          </div>
                        )}
                        {b.type === 'outpost' && (
                          <div className="p-1 rounded bg-zinc-800/95 border border-zinc-600 text-zinc-300">
                            <Shield className="w-3.5 h-3.5 text-blue-400" />
                          </div>
                        )}
                        {b.type === 'silo' && (
                          <div
                            className={`p-1 rounded bg-zinc-800 border ${
                              b.isArmed ? 'border-red-500 text-red-400' : 'border-zinc-700 text-zinc-500'
                            }`}
                          >
                            <Rocket className="w-3.5 h-3.5" />
                          </div>
                        )}
                        {b.type === 'bank' && (
                          <div className="relative group/bank p-1 rounded bg-amber-950/80 border border-amber-600 text-amber-300">
                            <Landmark className="w-3.5 h-3.5" />
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

                    {/* Actual Player Token Layer */}
                    {playerOnTile && (
                      <div className="relative z-20 flex flex-col items-center group">
                        {/* 1:1 Rounded Square Avatar */}
                        <div
                          className={`w-7 h-7 rounded-lg overflow-hidden border shadow-md relative bg-zinc-800 ${
                            playerOnTile.id === currentPlayer?.id
                              ? 'border-amber-400 ring-2 ring-amber-400/60'
                              : 'border-zinc-600'
                          }`}
                        >
                          <img
                            src={playerOnTile.avatarUrl}
                            alt={playerOnTile.username}
                            className="w-full h-full object-cover"
                          />
                        </div>

                        {/* Health dots indicator */}
                        <div className="absolute -top-2 flex gap-0.5 bg-zinc-950/90 px-1 py-0.2 rounded-full border border-zinc-800">
                          {Array.from({ length: 3 }).map((_, hIdx) => (
                            <span
                              key={hIdx}
                              className={`w-1.5 h-1.5 rounded-full ${
                                hIdx < playerOnTile.health ? 'bg-red-500' : 'bg-zinc-700'
                              }`}
                            />
                          ))}
                        </div>

                        {/* Username tooltip underneath */}
                        <div className="absolute top-7 pointer-events-none whitespace-nowrap bg-zinc-900/90 text-zinc-200 text-[9px] font-medium px-1.5 py-0.5 rounded shadow border border-zinc-700 opacity-90 group-hover:opacity-100 z-30">
                          {playerOnTile.username}
                        </div>
                      </div>
                    )}

                    {/* Ghost Operative Token (Translucent Holographic Future Position) */}
                    {isGhostTile && (
                      <div className="relative z-20 flex flex-col items-center pointer-events-none">
                        <div className="w-7 h-7 rounded-lg border-2 border-dashed border-cyan-400 bg-cyan-500/20 shadow-lg shadow-cyan-500/30 flex items-center justify-center animate-pulse">
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
                                  className="animate-pulse"
                                />
                                <circle
                                  cx={p2.cx}
                                  cy={p2.cy}
                                  r="22"
                                  fill="none"
                                  stroke="#f59e0b"
                                  strokeWidth="2.5"
                                  className="animate-ping"
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
                                  className="animate-pulse"
                                />
                              </>
                            );
                          })()}
                        </g>
                      )}

                    {/* Mine Detonation FX */}
                    {activeFx.type === 'mine_triggered' && activeFx.fromX !== undefined && (
                      <g>
                        {(() => {
                          const p = getCellCenterPx(activeFx.fromX!, activeFx.fromY!);
                          return (
                            <>
                              <circle
                                cx={p.cx}
                                cy={p.cy}
                                r="26"
                                fill="rgba(249, 115, 22, 0.45)"
                                stroke="#f97316"
                                strokeWidth="3"
                                className="animate-ping"
                              />
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
                            </>
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
                                className="animate-pulse"
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
