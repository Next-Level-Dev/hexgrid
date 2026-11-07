import React, { useState } from 'react';
import {
  Move,
  Sword,
  Heart,
  Hammer,
  Send,
  Landmark,
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
import { GAME_RULES, getActionPriorityGroup, getFixedActionCost } from '../game/rules';

interface ActionPlannerProps {
  player: Player | null;
  allPlayers: Player[];
  buildings: Building[];
  selectedTile: { x: number; y: number } | null;
  actions: ActionData[];
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

export const ActionPlanner: React.FC<ActionPlannerProps> = ({
  player,
  allPlayers,
  buildings,
  selectedTile,
  actions,
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
  const [amount, setAmount] = useState<number>(1);
  const [allowPartial, setAllowPartial] = useState<boolean>(true);
  const [buildingType, setBuildingType] = useState<BuildingType>('outpost');
  const [targetPlayerId, setTargetPlayerId] = useState<string>('');

  if (!player) return null;

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
  const livingTargets = allPlayers.filter(
    (p) => p.isAlive && p.id !== player.id
  );

  // Owned assets
  const ownedBanks = buildings.filter(
    (b) => b.type === 'bank' && b.ownerId === player.id && !b.isSpent
  );
  const ownedArmedSilos = buildings.filter(
    (b) => b.type === 'silo' && b.ownerId === player.id && b.isArmed && !b.isSpent
  );

  const handleQueueAction = (actType: ActionType, extra: Partial<ActionData> = {}) => {
    onAddAction({
      actionType: actType,
      amount: actType === 'attack' || actType === 'send_points' || actType === 'heal' ? amount : undefined,
      allowPartial: actType === 'attack' || actType === 'send_points' || actType === 'heal' ? allowPartial : undefined,
      buildingType: actType === 'build' ? buildingType : undefined,
      x: selectedTile?.x,
      y: selectedTile?.y,
      targetPlayerId: actType === 'send_points' ? (targetPlayerId || livingTargets[0]?.id) : undefined,
      ...extra,
    });
  };

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

          {/* Action Tabs */}
          <div className="grid grid-cols-6 gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            {[
              { id: 'move', label: 'Move', icon: Move, cost: '1 pt' },
              { id: 'attack', label: 'Attack', icon: Sword, cost: 'Var' },
              { id: 'heal', label: 'Heal', icon: Heart, cost: 'Var' },
              { id: 'build', label: 'Build', icon: Hammer, cost: '1-2' },
              { id: 'send_points', label: 'Transfer', icon: Send, cost: 'Var' },
              { id: 'claim_bank', label: 'Bank', icon: Landmark, cost: '1 pt' },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  disabled={isClosed || !player.isAlive}
                  onClick={() => {
                    setActiveTab(tab.id as ActionType);
                    onSelectActionType(tab.id as ActionType);
                  }}
                  className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-lg text-[10px] font-semibold transition-all ${
                    isActive
                      ? 'bg-amber-500 text-zinc-950 shadow-md font-bold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
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
                  <span className="font-semibold text-white">Movement (1 pt):</span> Moves 1 tile. Updates your ghost position for chained actions.
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
                  <span className="font-semibold text-white">Strike:</span> 21-tile circle range radiating from {ghostPosition ? 'your ghost position' : 'operative'}. 1 pt = 1 damage. (If movement is blocked and strike falls out of range, strike is cancelled).
                </div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-0.5">Target Tile:</label>
                    <div className="text-xs font-mono font-bold text-amber-300 bg-zinc-950 border border-zinc-700 px-2 py-1 rounded">
                      {selectedTile ? `(${selectedTile.x}, ${selectedTile.y})` : 'Click tile on map'}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-0.5">Points ({amount}):</label>
                    <input
                      type="range"
                      min="1"
                      max={Math.max(1, player.points)}
                      value={amount}
                      onChange={(e) => setAmount(parseInt(e.target.value, 10))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowPartial}
                      onChange={(e) => setAllowPartial(e.target.checked)}
                      className="accent-amber-500"
                    />
                    <span>Allow partial execution</span>
                  </label>
                  <button
                    disabled={!selectedTile || isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('attack')}
                    className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold disabled:opacity-40"
                  >
                    Queue Strike ({amount} pts)
                  </button>
                </div>
              </div>
            )}

            {/* HEAL */}
            {activeTab === 'heal' && (
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">Heal:</span> 1 pt = +1 HP (max 3). Current HP: {player.health}/3.
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="3"
                    value={amount}
                    onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value, 10) || 1))}
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
                  <span className="font-semibold text-white">Build:</span> 21-tile circle reach. Select structure and coordinate.
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
                      onClick={() => setBuildingType(b.type as BuildingType)}
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
                  <button
                    disabled={!selectedTile || isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('build')}
                    className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded text-xs font-bold disabled:opacity-40"
                  >
                    Queue Build
                  </button>
                </div>
              </div>
            )}

            {/* TRANSFER */}
            {activeTab === 'send_points' && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">Transfer Points:</span> 21-tile circle reach. Send points to an ally.
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={targetPlayerId}
                    onChange={(e) => setTargetPlayerId(e.target.value)}
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
                    onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1 py-1 text-xs text-white text-center font-mono"
                  />
                  <button
                    disabled={isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('send_points')}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold disabled:opacity-40"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}

            {/* BANK & NUKE */}
            {activeTab === 'claim_bank' && (
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={ownedBanks.length === 0 || isClosed || !player.isAlive}
                  onClick={() => handleQueueAction('claim_bank')}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold disabled:opacity-40 flex items-center gap-1"
                >
                  <Landmark className="w-3.5 h-3.5" />
                  Claim Bank ({ownedBanks.length > 0 ? `+${ownedBanks[0].value} pts (1 pt cost)` : 'No bank'})
                </button>
                <button
                  disabled={ownedArmedSilos.length === 0 || !selectedTile || isClosed || !player.isAlive}
                  onClick={() => handleQueueAction('launch_nuke')}
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded text-xs font-bold disabled:opacity-40 flex items-center gap-1"
                >
                  <Rocket className="w-3.5 h-3.5" />
                  Launch Nuclear Strike (Cost 1 pt, Unlimited Range, Priority 5)
                </button>
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
                No planned actions yet. Click controls above or map tiles.
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto scrollbar-thin">
                {actions.map((act, index) => {
                  const pGroup = getActionPriorityGroup(act.actionType);
                  const fixed = getFixedActionCost(act.actionType, act.buildingType);
                  const cost = fixed !== null ? fixed : act.amount || 1;

                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-800 text-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono px-1 rounded font-bold uppercase bg-zinc-800 text-amber-400">
                          P{pGroup}
                        </span>
                        <span className="font-semibold text-zinc-200">
                          {act.actionType.toUpperCase().replace(/_/g, ' ')}
                        </span>
                        {act.direction && (
                          <span className="text-zinc-400 font-mono">({act.direction})</span>
                        )}
                        {act.buildingType && (
                          <span className="text-zinc-400">[{act.buildingType}]</span>
                        )}
                        {act.x !== undefined && (
                          <span className="text-zinc-400 font-mono">({act.x}, {act.y})</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-zinc-400 text-[11px]">{cost} pt</span>
                        <button
                          disabled={isClosed}
                          onClick={() => onRemoveAction(index)}
                          className="p-0.5 rounded text-zinc-400 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Submit Action */}
          <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2.5">
            <span className="text-[10px] text-zinc-500">
              Resolved in order of priority & seed.
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
