import React, { useState } from 'react';
import {
  Heart,
  Coins,
  Skull,
  Crown,
  ListOrdered,
  Info,
  ChevronDown,
  ChevronUp,
  Users,
} from 'lucide-react';
import { Player, GameStateData } from '../types/game';
import { DEFAULT_PLAYER_HEALTH } from '../game/rules';

interface PlayerRosterProps {
  allPlayers: Player[];
  state: GameStateData | null;
  currentPlayerId?: string;
  inspectedPlayerId?: string | null;
  onHoverPlayer?: (playerId: string | null) => void;
  maxHealth?: number;
}

export const PlayerRoster: React.FC<PlayerRosterProps> = ({
  allPlayers,
  state,
  currentPlayerId,
  inspectedPlayerId,
  onHoverPlayer,
  maxHealth = DEFAULT_PLAYER_HEALTH,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const statePlayers = state?.players || {};
  const priorityOrder = state?.playerPriorityOrder || [];

  return (
    <div className="bg-zinc-950/95 backdrop-blur-md border border-zinc-800 rounded-2xl shadow-xl flex flex-col transition-all overflow-hidden w-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 md:p-3.5 border-b border-zinc-800/80 bg-zinc-900/60">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            OPERATIVES ({Object.values(statePlayers).filter((p) => p.isAlive).length} Active)
          </h3>
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          title={isCollapsed ? 'Expand Roster' : 'Collapse Roster'}
        >
          {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {!isCollapsed && (
        <div className="p-3 md:p-3.5 flex flex-col gap-3 max-h-[500px] max-md:max-h-[38vh] overflow-y-auto scrollbar-thin">
          {/* Operatives List */}
          <div className="flex flex-col gap-1.5">
            {allPlayers.map((p) => {
              const snap = statePlayers[p.id];
              const isAlive = snap ? snap.isAlive : p.isAlive;
              const health = snap ? snap.health : p.health;
              const points = snap ? snap.points : p.points;
              const peaceVote = snap ? snap.peaceVote : p.peaceVote;
              const isCurrent = p.id === currentPlayerId;
              const isInspected = p.id === inspectedPlayerId;

              return (
                <div
                  key={p.id}
                  onMouseEnter={() => onHoverPlayer && onHoverPlayer(p.id)}
                  onMouseLeave={() => onHoverPlayer && onHoverPlayer(null)}
                  onClick={() =>
                    onHoverPlayer &&
                    onHoverPlayer(inspectedPlayerId === p.id ? null : p.id)
                  }
                  className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : isInspected
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-zinc-900 border-zinc-800/80 hover:bg-zinc-800/80'
                  } ${!isAlive ? 'opacity-60 bg-red-950/20 border-red-900/30' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <img
                        src={p.avatarUrl}
                        alt={p.username}
                        className="w-7 h-7 rounded-lg bg-zinc-800 object-cover border border-zinc-700"
                      />
                      {!isAlive && (
                        <div className="absolute inset-0 bg-red-950/80 rounded-lg flex items-center justify-center">
                          <Skull className="w-3.5 h-3.5 text-red-400" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-semibold text-zinc-200">
                          {p.username}
                        </span>
                        {p.isAdmin && <Crown className="w-3 h-3 text-amber-400" />}
                        {isCurrent && (
                          <span className="text-[8px] bg-amber-400/20 text-amber-300 px-1 rounded font-bold">
                            YOU
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-zinc-400 font-mono">
                        {isAlive ? `(${snap?.x ?? p.x}, ${snap?.y ?? p.y})` : 'ELIMINATED'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Health */}
                    <div className="flex items-center text-[11px] font-mono text-red-400" title="Health">
                      <Heart className="w-3 h-3 mr-0.5 fill-red-500/20" />
                      <span>{health}/{maxHealth}</span>
                    </div>

                    {/* Points */}
                    <div className="flex items-center text-[11px] font-mono text-amber-300" title="Points">
                      <Coins className="w-3 h-3 mr-0.5 fill-amber-500/20" />
                      <span>{points}</span>
                    </div>

                    {/* Peace Vote */}
                    <span
                      className={`text-[9px] font-mono px-1 py-0.2 rounded font-bold ${
                        peaceVote === 'yes'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                      title="World Peace Vote"
                    >
                      {peaceVote === 'yes' ? 'PEACE' : 'WAR'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Player Priority Order */}
          <div className="border-t border-zinc-800 pt-2 flex flex-col gap-1.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1">
              <ListOrdered className="w-3 h-3" />
              <span>ROUND RESOLUTION PRIORITY</span>
            </h4>
            <div className="flex flex-col gap-1">
              {priorityOrder.map((pid, idx) => {
                const playerObj = allPlayers.find((p) => p.id === pid);
                if (!playerObj) return null;
                return (
                  <div
                    key={pid}
                    className="flex items-center justify-between bg-zinc-900 px-2 py-1 rounded border border-zinc-800 text-[10px] font-mono"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-zinc-800 text-amber-400 font-bold flex items-center justify-center text-[9px]">
                        #{idx + 1}
                      </span>
                      <span className="text-zinc-300 truncate max-w-[120px]">{playerObj.username}</span>
                    </div>
                    <span className="text-zinc-500">{idx === 0 ? 'Acts 1st' : `Rank #${idx + 1}`}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 21-Square Circular Reach Info */}
          <div className="bg-zinc-900/60 p-2 rounded-xl text-[10px] text-zinc-400 border border-zinc-800/80">
            <div className="font-semibold text-zinc-200 mb-0.5 flex items-center gap-1">
              <Info className="w-3 h-3 text-cyan-400" />
              <span>Circular 21-Square Tactical Range</span>
            </div>
            <p>5×5 perimeter excluding 4 corners and self. Tap or hover any operative to see their circular reach.</p>
          </div>
        </div>
      )}
    </div>
  );
};
