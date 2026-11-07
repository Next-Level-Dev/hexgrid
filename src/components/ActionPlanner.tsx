import React, { useEffect, useState } from 'react';
import {
  Move,
  Sword,
  Heart,
  Hammer,
  Send,
  Rocket,
  Trash2,
  AlertCircle,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Footprints,
} from 'lucide-react';
import { ActionData, ActionType, BuildingType, Player, Building } from '../types/game';
import { getActionPriorityGroup, getFixedActionCost } from '../game/rules';

export interface ActionConfig {
  amount: number;
  allowPartial: boolean;
  buildingType: BuildingType;
  targetPlayerId: string;
}

interface ActionPlannerProps {
  player: Player | null;
  allPlayers: Player[];
  buildings: Building[];
  selectedTile: { x: number; y: number } | null;
  actions: ActionData[];
  actionConfig: ActionConfig;
  onActionConfigChange: (patch: Partial<ActionConfig>) => void;
  onAddAction: (action: ActionData) => void;
  onRemoveAction: (index: number) => void;
  onSubmitActions: () => void;
  onSelectActionType: (actionType: ActionType | null) => void;
  selectedActionType: ActionType | null;
  isClosed: boolean;
  isSaving: boolean;
  saveSuccess: boolean;
  ghostPosition?: { x: number; y: number } | null;
}

const ACTION_TABS: Array<{
  id: ActionType;
  label: string;
  icon: React.ElementType;
  cost: string;
  group: number;
}> = [
  { id: 'send_points', label: 'Transfer', icon: Send, cost: 'Var', group: 1 },
  { id: 'heal', label: 'Heal', icon: Heart, cost: 'Var', group: 2 },
  { id: 'build', label: 'Build', icon: Hammer, cost: '1-2', group: 3 },
  { id: 'move', label: 'Move', icon: Move, cost: '1 pt', group: 4 },
  { id: 'attack', label: 'Attack', icon: Sword, cost: 'Var', group: 5 },
];

const GROUP_LABELS: Record<number, string> = {
  1: 'TRANSFER',
  2: 'HEAL',
  3: 'BUILD',
  4: 'MOVE',
  5: 'ATTACK',
};

export const ActionPlanner: React.FC<ActionPlannerProps> = ({
  player,
  allPlayers,
  buildings,
  selectedTile,
  actions,
  actionConfig,
  onActionConfigChange,
  onAddAction,
  onRemoveAction,
  onSubmitActions,
  onSelectActionType,
  selectedActionType,
  isClosed,
  isSaving,
  saveSuccess,
  ghostPosition,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActionType>('move');

  useEffect(() => {
    if (
      selectedActionType &&
      selectedActionType !== 'claim_bank' &&
      selectedActionType !== 'launch_nuke'
    ) {
      setActiveTab(selectedActionType);
    }
  }, [selectedActionType]);

  if (!player) return null;

  const { amount, allowPartial, buildingType, targetPlayerId } = actionConfig;

  // Calculate planned points spent
  let totalCost = 0;
  actions.forEach((act) => {
    const fixed = getFixedActionCost(act.actionType, act.buildingType);
    if (fixed !== null) {
      totalCost += fixed;
    } else {
      totalCost += act.amount || 1;
    }
  });

  const remainingPoints = player.points - totalCost;
  const isOverBudget = remainingPoints < 0;

  // Living targets
  const livingTargets = allPlayers.filter((p) => p.isAlive && p.id !== player.id);

  // Owned assets
  const ownedArmedSilos = buildings.filter(
    (b) => b.type === 'silo' && b.ownerId === player.id && b.isArmed && !b.isSpent
  );

  // Planned actions are always displayed in resolution-priority order, regardless
  // of the order in which they were queued. Keep the original index for deletion.
  const sortedActions = actions
    .map((act, originalIndex) => ({ act, originalIndex }))
    .sort((a, b) => {
      const groupDiff =
        getActionPriorityGroup(a.act.actionType) - getActionPriorityGroup(b.act.actionType);
      return groupDiff !== 0 ? groupDiff : a.originalIndex - b.originalIndex;
    });

  const handleQueueAction = (actType: ActionType, extra: Partial<ActionData> = {}) => {
    onAddAction({
      actionType: actType,
      amount:
        actType === 'attack' || actType === 'send_points' || actType === 'heal'
          ? amount
          : undefined,
      allowPartial:
        actType === 'attack' || actType === 'send_points' || actType === 'heal'
          ? allowPartial
          : undefined,
      buildingType: actType === 'build' ? buildingType : undefined,
      x: selectedTile?.x,
      y: selectedTile?.y,
      targetPlayerId:
        actType === 'send_points' ? targetPlayerId || livingTargets[0]?.id : undefined,
      ...extra,
    });
  };

  const isNukeTargeting = selectedActionType === 'launch_nuke';

  return (
    <div className="bg-zinc-950/90 backdrop-blur-md border border-zinc-800 rounded-2xl shadow-2xl flex flex-col transition-all overflow-hidden max-w-lg w-full">
      {/* Header & Budget status */}
      <div className="flex items-center justify-between p-3.5 border-b border-zinc-800/80 bg-zinc-900/60">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            title={isCollapsed ? 'Expand Action Deck' : 'Collapse Action Deck'}
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <span>ACTION DECK</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-amber-400 border border-zinc-700">
                {actions.length} Queued
              </span>
            </h3>
            {ghostPosition && (
              <div className="text-[10px] text-cyan-400 font-mono flex items-center gap-1">
                <Footprints className="w-3 h-3" />
                Projected Pos: ({ghostPosition.x}, {ghostPosition.y})
              </div>
            )}
          </div>
        </div>

        {/* Budget Pill */}
        <div
          className={`px-2.5 py-1 rounded-xl border text-[11px] font-mono font-bold flex items-center gap-1.5 ${
            isOverBudget
              ? 'bg-red-950/80 text-red-300 border-red-700'
              : 'bg-zinc-900 text-zinc-200 border-zinc-700'
          }`}
        >
          <span>Pts: {player.points}</span>
          <span>•</span>
          <span className={isOverBudget ? 'text-red-400' : 'text-amber-400'}>
            Cost: {totalCost}
          </span>
          <span>•</span>
          <span className={remainingPoints < 0 ? 'text-red-400 font-black' : 'text-emerald-400'}>
            Left: {remainingPoints}
          </span>
        </div>
      </div>

      {/* Expandable Body */}
      {!isCollapsed && (
        <div className="p-3.5 flex flex-col gap-3 max-h-[460px] overflow-y-auto scrollbar-thin">
          {isClosed && (
            <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-2.5 flex items-center gap-2 text-xs text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
              <span>Closed phase active. Changes locked until 00:00 UTC.</span>
            </div>
          )}
          {!player.isAlive && (
            <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-2.5 flex items-center gap-2 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>Operative eliminated. Actions unavailable.</span>
            </div>
          )}

          {/* Action Tabs — ordered by resolution priority group */}
          <div className="grid grid-cols-5 gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            {ACTION_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  disabled={isClosed || !player.isAlive}
                  onClick={() => {
                    setActiveTab(tab.id);
                    onSelectActionType(tab.id);
                  }}
                  className={`relative flex flex-col items-center justify-center py-1.5 px-1 rounded-lg text-[10px] font-semibold transition-all ${
                    isActive
                      ? 'bg-amber-500 text-zinc-950 shadow-md font-bold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span className="absolute top-0.5 left-1 text-[8px] font-mono opacity-70">
                    P{tab.group}
                  </span>
                  <Icon className="w-3.5 h-3.5 mb-0.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Form area based on active tab */}
          <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-xl p-2.5 flex flex-col gap-2">
            {/* MOVE */}
            {activeTab === 'move' && (
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">Movement (1 pt):</span> Moves 1 tile.
                  Click an adjacent highlighted tile or use the D-pad. Your ghost updates after
                  every queued move.
                </div>
                {/* D-Pad */}
                <div className="grid grid-cols-3 gap-1 w-28 shrink-0">
                  <div />
                  <button
                    disabled={isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('move', { direction: 'up' })}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-200"
                    title="Move Up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <div />
                  <button
                    disabled={isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('move', { direction: 'left' })}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-200"
                    title="Move Left"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex items-center justify-center text-[9px] font-mono text-zinc-500">
                    1 pt
                  </div>
                  <button
                    disabled={isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('move', { direction: 'right' })}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-200"
                    title="Move Right"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <div />
                  <button
                    disabled={isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('move', { direction: 'down' })}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-200"
                    title="Move Down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <div />
                </div>
              </div>
            )}

            {/* ATTACK */}
            {activeTab === 'attack' && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">
                    {isNukeTargeting ? 'Nuclear Strike:' : 'Strike:'}
                  </span>{' '}
                  {isNukeTargeting
                    ? 'Click ANY tile to launch a 3×3 nuclear blast from an armed silo.'
                    : 'Click a highlighted tile to strike. 1 pt = 1 damage. Current range is blue; projected range after moves is purple.'}
                </div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-0.5">Target Tile:</label>
                    <div className="text-xs font-mono font-bold text-amber-300 bg-zinc-950 border border-zinc-700 px-2 py-1 rounded">
                      {selectedTile ? `(${selectedTile.x}, ${selectedTile.y})` : 'Click tile on map'}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-0.5">
                      Points ({amount}):
                    </label>
                    <input
                      type="range"
                      min="1"
                      max={Math.max(1, player.points)}
                      value={amount}
                      onChange={(e) =>
                        onActionConfigChange({ amount: parseInt(e.target.value, 10) })
                      }
                      className="w-full accent-amber-500"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowPartial}
                      onChange={(e) => onActionConfigChange({ allowPartial: e.target.checked })}
                      className="accent-amber-500"
                    />
                    <span>Allow partial execution</span>
                  </label>
                  {ownedArmedSilos.length > 0 && (
                    <button
                      disabled={isClosed || !player.isAlive}
                      onClick={() =>
                        onSelectActionType(isNukeTargeting ? 'attack' : 'launch_nuke')
                      }
                      className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 border transition-all ${
                        isNukeTargeting
                          ? 'bg-red-700 text-white border-red-400 shadow-lg shadow-red-900/40'
                          : 'bg-zinc-950 text-red-300 border-red-800/70 hover:bg-red-950/50'
                      }`}
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      {isNukeTargeting ? 'Nuclear Targeting ON' : 'Enable Nuclear Targeting'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* HEAL */}
            {activeTab === 'heal' && (
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">Heal:</span> 1 pt = +1 HP (max 3).
                  Current HP: {player.health}/3.
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="3"
                    value={amount}
                    onChange={(e) =>
                      onActionConfigChange({
                        amount: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-xs text-white text-center font-mono"
                  />
                  <button
                    disabled={isClosed || !player.isAlive || player.health >= 3}
                    onClick={() => handleQueueAction('heal')}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold disabled:opacity-40"
                  >
                    Queue Heal
                  </button>
                </div>
              </div>
            )}

            {/* BUILD */}
            {activeTab === 'build' && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">Build:</span> Click a highlighted tile
                  to build. Click your own bank to claim it as a building action.
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { type: 'mine', label: 'Mine (1 pt)' },
                    { type: 'outpost', label: 'Outpost (1 pt)' },
                    { type: 'silo', label: 'Nuke Silo (2 pt)' },
                    { type: 'bank', label: 'Bank (1 pt)' },
                  ].map((b) => (
                    <button
                      key={b.type}
                      onClick={() => onActionConfigChange({ buildingType: b.type as BuildingType })}
                      className={`p-1.5 rounded border text-center text-[10px] font-bold ${
                        buildingType === b.type
                          ? 'bg-amber-500/20 border-amber-500 text-white'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] font-mono text-zinc-400">
                    Target: {selectedTile ? `(${selectedTile.x}, ${selectedTile.y})` : 'Select tile'}
                  </span>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    {ghostPosition ? 'Blue = current • Purple = projected' : 'Blue = current range'}
                  </span>
                </div>
              </div>
            )}

            {/* TRANSFER */}
            {activeTab === 'send_points' && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">Transfer Points:</span> Click an ally
                  in range, or pick a recipient below. 1 pt = 1 transferred point.
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={targetPlayerId}
                    onChange={(e) => onActionConfigChange({ targetPlayerId: e.target.value })}
                    className="bg-zinc-950 border border-zinc-700 text-xs text-white rounded px-2 py-1 flex-1"
                  >
                    <option value="">Select Ally Recipient</option>
                    {livingTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.username} ({t.x}, {t.y})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, player.points)}
                    value={amount}
                    onChange={(e) =>
                      onActionConfigChange({
                        amount: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1 py-1 text-xs text-white text-center font-mono"
                  />
                  <button
                    disabled={isClosed || !player.isAlive || livingTargets.length === 0}
                    onClick={() => handleQueueAction('send_points')}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold disabled:opacity-40"
                  >
                    Send
                  </button>
                </div>
                <div className="text-[10px] text-cyan-400 font-mono">
                  {ghostPosition
                    ? 'Blue = current range • Purple = projected range after moves'
                    : 'Blue = current range'}
                </div>
              </div>
            )}
          </div>

          {/* Queued Action Items */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-semibold text-zinc-300 flex items-center justify-between">
              <span>Resolution Sequence (Priorities 1→5):</span>
              {saveSuccess && (
                <span className="text-emerald-400 flex items-center gap-1 text-[10px]">
                  <CheckCircle className="w-3 h-3" /> Saved on server
                </span>
              )}
            </div>

            {actions.length === 0 ? (
              <div className="text-center py-4 text-zinc-500 text-[11px] border border-dashed border-zinc-800 rounded-lg">
                No planned actions yet. Click highlighted map tiles or use the controls above.
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto scrollbar-thin">
                {sortedActions.map(({ act, originalIndex }, idx) => {
                  const pGroup = getActionPriorityGroup(act.actionType);
                  const fixed = getFixedActionCost(act.actionType, act.buildingType);
                  const cost = fixed !== null ? fixed : act.amount || 1;
                  const prevGroup =
                    idx > 0
                      ? getActionPriorityGroup(sortedActions[idx - 1].act.actionType)
                      : null;
                  const showGroupHeader = prevGroup !== pGroup;
                  const targetName = act.targetPlayerId
                    ? allPlayers.find((p) => p.id === act.targetPlayerId)?.username
                    : null;

                  return (
                    <React.Fragment key={originalIndex}>
                      {showGroupHeader && (
                        <div className="flex items-center gap-1.5 pt-1 first:pt-0">
                          <span className="text-[9px] font-mono font-bold px-1 rounded bg-zinc-800 text-amber-400 border border-zinc-700">
                            P{pGroup}
                          </span>
                          <span className="text-[9px] font-bold tracking-wider text-zinc-400">
                            {GROUP_LABELS[pGroup]}
                          </span>
                          <span className="flex-1 h-px bg-zinc-800" />
                        </div>
                      )}
                      <div className="flex items-center justify-between bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-800 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-zinc-200 truncate">
                            {act.actionType.toUpperCase().replace(/_/g, ' ')}
                          </span>
                          {act.direction && (
                            <span className="text-zinc-400 font-mono">({act.direction})</span>
                          )}
                          {act.buildingType && (
                            <span className="text-zinc-400">[{act.buildingType}]</span>
                          )}
                          {targetName && (
                            <span className="text-blue-300 truncate">→ {targetName}</span>
                          )}
                          {act.x !== undefined && (
                            <span className="text-zinc-400 font-mono">
                              ({act.x}, {act.y})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-zinc-400 text-[11px]">{cost} pt</span>
                          <button
                            disabled={isClosed}
                            onClick={() => onRemoveAction(originalIndex)}
                            className="p-0.5 rounded text-zinc-400 hover:text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>

          {/* Submit Action */}
          <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2.5">
            <span className="text-[10px] text-zinc-500">
              Resolved by priority group, then round seed.
            </span>
            <button
              onClick={onSubmitActions}
              disabled={isClosed || !player.isAlive || isSaving}
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-zinc-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow disabled:opacity-40 transition-all"
            >
              {isSaving ? 'Submitting...' : 'Confirm Planned Actions'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
