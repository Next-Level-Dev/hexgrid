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
  HelpCircle,
  Crosshair,
} from 'lucide-react';
import { ActionData, ActionType, BuildingType, Player, Building } from '../types/game';
import {
  GAME_RULES,
  DEFAULT_MAP_SIZE,
  DEFAULT_PLAYER_HEALTH,
  DEFAULT_MINE_LIMIT,
  DEFAULT_ASSASSINATION_COST,
  ASSASSINATION_DAMAGE,
  getActionPriorityGroup,
  getFixedActionCost,
  isSquareInPlayerRange,
} from '../game/rules';
import { useI18n } from '../i18n';

export interface ActionConfig {
  amount: number;
  allowPartial: boolean;
  buildingType: BuildingType;
  targetPlayerId: string;
  assassinationTargetId: string;
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
  enabledBuildings: Record<BuildingType, boolean>;
  maxHealth?: number;
  mapSize?: number;
  selectedNukeSiloId?: string | null;
  mineLimit?: number;
  minesPlaced?: number;
  nextMineLimitDay?: number | null;
  assassinationCost?: number;
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
  { id: 'assassinate', label: 'Assassin', icon: Crosshair, cost: 'Fixed', group: 5 },
];

const GROUP_LABELS: Record<number, string> = {
  1: 'TRANSFER',
  2: 'HEAL',
  3: 'BUILD',
  4: 'MOVE',
  5: 'ATTACK',
};

const PartialExecutionToggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ checked, onChange }) => {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-300">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-amber-500"
          />
          <span>{t('Allow partial execution')}</span>
        </label>
        <button
          type="button"
          onClick={() => setShowHelp((cur) => !cur)}
          className="text-zinc-500 hover:text-zinc-300"
          title={t('If checked, this action spends whatever points you have left at resolution instead of being cancelled when you cannot afford the full amount.')}
          aria-label={t('Partial execution explanation')}
          aria-expanded={showHelp}
        >
          <HelpCircle className="w-3 h-3" />
        </button>
      </div>
      {showHelp && (
        <div className="text-[10px] leading-snug text-zinc-400 bg-zinc-950/80 border border-zinc-800 rounded-lg px-2 py-1.5">
          {t('If checked, this action spends whatever points you have left when it resolves instead of being cancelled because you could not afford the full amount. It never spends more than you have.')}
        </div>
      )}
    </div>
  );
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
  enabledBuildings,
  maxHealth = DEFAULT_PLAYER_HEALTH,
  mapSize = DEFAULT_MAP_SIZE,
  selectedNukeSiloId = null,
  mineLimit = DEFAULT_MINE_LIMIT,
  minesPlaced = 0,
  nextMineLimitDay = null,
  assassinationCost = DEFAULT_ASSASSINATION_COST,
}) => {
  const { t, language } = useI18n();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActionType>('move');

  useEffect(() => {
    if (!selectedActionType) return;
    if (selectedActionType === 'launch_nuke') {
      setActiveTab('attack');
    } else if (selectedActionType === 'claim_bank') {
      setActiveTab('build');
    } else {
      setActiveTab(selectedActionType);
    }
  }, [selectedActionType]);

  if (!player) return null;

  const { amount, allowPartial, buildingType, targetPlayerId, assassinationTargetId } =
    actionConfig;

  // Calculate planned points spent
  let totalCost = 0;
  actions.forEach((act) => {
    const fixed = getFixedActionCost(act.actionType, act.buildingType, assassinationCost);
    if (fixed !== null) {
      totalCost += fixed;
    } else {
      totalCost += act.amount || 1;
    }
  });

  const remainingPoints = player.points - totalCost;
  const isOverBudget = remainingPoints < 0;
  const mineLimitReached = minesPlaced >= mineLimit;

  // Living targets
  const livingTargets = allPlayers.filter((p) => p.isAlive && p.id !== player.id);
  const transferTargets = livingTargets.filter((target) =>
    isSquareInPlayerRange(player.x, player.y, target.x, target.y, mapSize)
  );
  const selectedTransferTarget = transferTargets.find((target) => target.id === targetPlayerId);
  const assassinationTargets = livingTargets;
  const selectedAssassinationTarget = assassinationTargets.find(
    (target) => target.id === assassinationTargetId
  );
  const isAssassinationDisabled = assassinationCost <= 0;

  // Owned assets
  const ownedArmedSilos = buildings.filter(
    (b) => b.type === 'silo' && b.ownerId === player.id && b.isArmed && !b.isSpent
  );
  const selectedNukeSilo = selectedNukeSiloId
    ? buildings.find((b) => b.id === selectedNukeSiloId)
    : null;

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
      x: actType === 'assassinate' ? undefined : selectedTile?.x,
      y: actType === 'assassinate' ? undefined : selectedTile?.y,
      targetPlayerId:
        actType === 'send_points'
          ? selectedTransferTarget?.id
          : actType === 'assassinate'
          ? selectedAssassinationTarget?.id
          : undefined,
      ...extra,
    });
  };

  const isNukeTargeting = selectedActionType === 'launch_nuke';

  return (
    <div className="bg-zinc-950/95 backdrop-blur-md border border-zinc-800 rounded-2xl shadow-xl flex flex-col transition-all overflow-hidden w-full max-w-lg">
      {/* Header & Budget status */}
      <div className="flex items-center justify-between gap-2 p-3 md:p-3.5 border-b border-zinc-800/80 bg-zinc-900/60">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0"
            title={isCollapsed ? t('Expand Action Deck') : t('Collapse Action Deck')}
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <span className="truncate">{t('ACTION DECK')}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-amber-400 border border-zinc-700 shrink-0">
                {t('{count} Queued', { count: actions.length })}
              </span>
            </h3>
            {ghostPosition && (
              <div className="text-[10px] text-cyan-400 font-mono flex items-center gap-1">
                <Footprints className="w-3 h-3" />
                {t('Projected Pos: ({x}, {y})', { x: ghostPosition.x, y: ghostPosition.y })}
              </div>
            )}
          </div>
        </div>

        {/* Budget Pill */}
        <div
          className={`px-2.5 py-1 rounded-xl border text-[11px] font-mono font-bold flex items-center gap-1.5 shrink-0 ${
            isOverBudget
              ? 'bg-red-950/80 text-red-300 border-red-700'
              : 'bg-zinc-900 text-zinc-200 border-zinc-700'
          }`}
        >
          <span>{t('Pts: {points}', { points: player.points })}</span>
          <span>•</span>
          <span className={isOverBudget ? 'text-red-400' : 'text-amber-400'}>
            {t('Cost: {cost}', { cost: totalCost })}
          </span>
          <span>•</span>
          <span className={remainingPoints < 0 ? 'text-red-400 font-black' : 'text-emerald-400'}>
            {t('Left: {left}', { left: remainingPoints })}
          </span>
        </div>
      </div>

      {/* Over-budget warning (always visible, even when collapsed) */}
      {isOverBudget && (
        <div className="bg-red-950/50 border-t border-b border-red-800/60 px-3 py-2 flex items-center gap-2 text-[11px] text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span>
            {t("Your points aren't enough for your currently planned actions — you might want to reconsider, unless someone will send you points this round.")}
          </span>
        </div>
      )}

      {/* Expandable Body */}
      {!isCollapsed && (
        <div className="p-3 md:p-3.5 flex flex-col gap-3 max-h-[460px] max-md:max-h-[38vh] overflow-y-auto scrollbar-thin">
          {isClosed && (
            <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-2.5 flex items-center gap-2 text-xs text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{t('Closed phase active. Changes locked until 02:00 UTC.')}</span>
            </div>
          )}
          {!player.isAlive && (
            <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-2.5 flex items-center gap-2 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{t('Operative eliminated. Actions unavailable.')}</span>
            </div>
          )}

          {/* Action Tabs — ordered by resolution priority group */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            {ACTION_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive =
                selectedActionType === tab.id ||
                (tab.id === 'attack' && selectedActionType === 'launch_nuke');
              return (
                <button
                  key={tab.id}
                  disabled={
                    isClosed ||
                    !player.isAlive ||
                    (tab.id === 'assassinate' && isAssassinationDisabled)
                  }
                  onClick={() => {
                    const next = isActive ? null : tab.id;
                    if (next) setActiveTab(tab.id);
                    onSelectActionType(next);
                  }}
                  className={`relative flex flex-col items-center justify-center py-2 md:py-1.5 px-1 rounded-lg text-[10px] font-semibold transition-all ${
                    isActive
                      ? 'bg-amber-500 text-zinc-950 font-bold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span className="absolute top-0.5 left-1 text-[8px] font-mono opacity-70">
                    P{tab.group}
                  </span>
                  <Icon className="w-4 h-4 mb-0.5" />
                  <span>{t(tab.label)}</span>
                </button>
              );
            })}
          </div>

          {/* Form area based on selected action */}
          {selectedActionType ? (
          <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-xl p-2.5 flex flex-col gap-2">
            {/* MOVE */}
            {activeTab === 'move' && (
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">{t('Movement (1 pt):')}</span>{' '}
                  {t('Moves 1 tile. Click an adjacent highlighted tile or use the D-pad. Your ghost updates after every queued move.')}
                </div>
                {/* D-Pad */}
                <div className="grid grid-cols-3 gap-1 w-28 md:w-28 shrink-0">
                  <div />
                  <button
                    disabled={isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('move', { direction: 'up' })}
                    className="p-2 md:p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-200 active:bg-zinc-600"
                    title={t('Move Up')}
                  >
                    <ArrowUp className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  </button>
                  <div />
                  <button
                    disabled={isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('move', { direction: 'left' })}
                    className="p-2 md:p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-200 active:bg-zinc-600"
                    title={t('Move Left')}
                  >
                    <ArrowLeft className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  </button>
                  <div className="flex items-center justify-center text-[9px] font-mono text-zinc-500">
                    {t('1 pt')}
                  </div>
                  <button
                    disabled={isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('move', { direction: 'right' })}
                    className="p-2 md:p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-200 active:bg-zinc-600"
                    title={t('Move Right')}
                  >
                    <ArrowRight className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  </button>
                  <div />
                  <button
                    disabled={isClosed || !player.isAlive}
                    onClick={() => handleQueueAction('move', { direction: 'down' })}
                    className="p-2 md:p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-200 active:bg-zinc-600"
                    title={t('Move Down')}
                  >
                    <ArrowDown className="w-4 h-4 md:w-3.5 md:h-3.5" />
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
                    {isNukeTargeting ? t('Nuclear Strike:') : t('Strike:')}
                  </span>{' '}
                  {isNukeTargeting
                    ? selectedNukeSilo
                      ? t('Silo at ({x}, {y}) selected. Click any tile to assign its target; it launches next round.', {
                          x: selectedNukeSilo.x,
                          y: selectedNukeSilo.y,
                        })
                      : t('Click a ready silo on the map to select its launch target.')
                    : t('Click a highlighted tile to strike. 1 pt = 1 damage. Current range is blue; projected range after moves is purple (attacks only).')}
                </div>
                {isNukeTargeting ? (
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-0.5">{t('Target Tile:')}</label>
                      <div className="text-xs font-mono font-bold text-amber-300 bg-zinc-950 border border-zinc-700 px-2 py-1 rounded">
                        {selectedTile ? `(${selectedTile.x}, ${selectedTile.y})` : t('Click tile on map')}
                      </div>
                    </div>
                    <div className="text-[10px] text-red-300/90 font-mono leading-tight">
                      {t('Fixed launch cost: {cost} pt.', { cost: GAME_RULES.BUILDINGS.silo.launchCost })}
                      <br />
                      {t('The selected armed silo is consumed on launch.')}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 items-center">
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-0.5">
                          {t('Target Tile:')}
                        </label>
                        <div className="text-xs font-mono font-bold text-amber-300 bg-zinc-950 border border-zinc-700 px-2 py-1 rounded">
                          {selectedTile
                            ? `(${selectedTile.x}, ${selectedTile.y})`
                            : t('Click tile on map')}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-0.5">
                          {t('Points ({points}):', { points: amount })}
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
                      <PartialExecutionToggle
                        checked={allowPartial}
                        onChange={(checked) => onActionConfigChange({ allowPartial: checked })}
                      />
                    </div>
                    {enabledBuildings.silo && ownedArmedSilos.length > 0 && (
                      <div className="flex items-center gap-1.5 text-[10px] text-red-300/90 font-mono">
                        <Rocket className="w-3 h-3 shrink-0" />
                        {t('Ready silo{plural}: click a red silo on the map ({positions}), then pick its target tile.', {
                          plural: ownedArmedSilos.length > 1 ? 's' : '',
                          positions: ownedArmedSilos.map((s) => `(${s.x}, ${s.y})`).join(', '),
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ASSASSINATE */}
            {activeTab === 'assassinate' && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">{t('Assassinate:')}</span>{' '}
                  {isAssassinationDisabled
                    ? t('This action is disabled for the current game.')
                    : t('No range limit. Pick a living opponent to deal {damage} guaranteed damage for {cost} pt.', {
                        damage: ASSASSINATION_DAMAGE,
                        cost: assassinationCost,
                      })}
                </div>
                {!isAssassinationDisabled && (
                  <>
                    <div className="flex items-center gap-2">
                      <select
                        value={assassinationTargetId}
                        onChange={(e) =>
                          onActionConfigChange({ assassinationTargetId: e.target.value })
                        }
                        className="bg-zinc-950 border border-zinc-700 text-xs text-white rounded px-2 py-1 flex-1"
                      >
                        <option value="">{t('Select Target')}</option>
                        {assassinationTargets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.username} ({target.x}, {target.y}) - {target.health} HP
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={
                          isClosed || !player.isAlive || !selectedAssassinationTarget
                        }
                        onClick={() => handleQueueAction('assassinate')}
                        className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold disabled:opacity-40"
                      >
                        {t('Assassinate')}
                      </button>
                    </div>
                    <div className="text-[10px] text-red-300/90 font-mono">
                      {t('Fixed cost: {cost} pt. Damage: {damage} HP. Range: unlimited.', {
                        cost: assassinationCost,
                        damage: ASSASSINATION_DAMAGE,
                      })}
                    </div>
                    {assassinationTargets.length === 0 && (
                      <div className="text-[10px] text-zinc-400 font-mono">
                        {t('No living opponents available.')}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* HEAL */}
            {activeTab === 'heal' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-zinc-300">
                    <span className="font-semibold text-white">{t('Heal:')}</span>{' '}
                    {t('1 pt = +1 HP (max {max}). Current HP: {health}/{max}.', {
                      max: maxHealth,
                      health: player.health,
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max={maxHealth}
                      value={amount}
                      onChange={(e) =>
                        onActionConfigChange({
                          amount: Math.max(1, parseInt(e.target.value, 10) || 1),
                        })
                      }
                      className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-xs text-white text-center font-mono"
                    />
                    <button
                      disabled={isClosed || !player.isAlive || player.health >= maxHealth}
                      onClick={() => handleQueueAction('heal')}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold disabled:opacity-40"
                    >
                      {t('Queue Heal')}
                    </button>
                  </div>
                </div>
                <PartialExecutionToggle
                  checked={allowPartial}
                  onChange={(checked) => onActionConfigChange({ allowPartial: checked })}
                />
              </div>
            )}

            {/* BUILD */}
            {activeTab === 'build' && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">{t('Build:')}</span>{' '}
                  {t('Click a highlighted tile in your current range to build. Click your own bank in range to claim it. Queued moves do not extend building range.')}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { type: 'mine', label: 'Mine (1 pt)' },
                    { type: 'outpost', label: 'Outpost (1 pt)' },
                    { type: 'silo', label: 'Nuke Silo (2 pt)' },
                    { type: 'bank', label: 'Bank (1 pt)' },
                  ].map((b) => {
                    const isBuildingEnabled = enabledBuildings[b.type as BuildingType];
                    const isMineAtLimit = b.type === 'mine' && mineLimitReached;
                    return (
                      <button
                        key={b.type}
                        disabled={!isBuildingEnabled || isMineAtLimit}
                        onClick={() =>
                          onActionConfigChange({ buildingType: b.type as BuildingType })
                        }
                        title={
                          !isBuildingEnabled
                            ? t('{type} is disabled in this game', { type: t(b.type) })
                            : isMineAtLimit
                              ? t('Mine limit reached ({placed}/{limit}). Detonated mines still count.', {
                                  placed: minesPlaced,
                                  limit: mineLimit,
                                })
                              : t(b.label)
                        }
                        className={`p-1.5 md:py-1.5 rounded border text-center text-[10px] font-bold ${
                          buildingType === b.type && isBuildingEnabled && !isMineAtLimit
                            ? 'bg-amber-500/20 border-amber-500 text-white'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        {t(b.label)}
                      </button>
                    );
                  })}
                </div>
                {enabledBuildings.mine && (
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-mono">
                    <span className={mineLimitReached ? 'text-red-300' : 'text-zinc-400'}>
                      {t('Mines: {placed}/{limit} placed', {
                        placed: minesPlaced,
                        limit: mineLimit,
                      })}
                      {mineLimitReached ? t(' (limit reached)') : ''}
                    </span>
                    <span className="text-zinc-500">
                      {nextMineLimitDay
                        ? t('+1 on Day {day}', { day: nextMineLimitDay })
                        : t('No further increases')}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] font-mono text-zinc-400">
                    {t('Target: {target}', {
                      target: selectedTile
                        ? `(${selectedTile.x}, ${selectedTile.y})`
                        : t('Select tile'),
                    })}
                  </span>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    {ghostPosition ? t('Blue = current · Purple = projected') : t('Blue = current range')}
                  </span>
                </div>
              </div>
            )}

            {/* TRANSFER */}
            {activeTab === 'send_points' && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-zinc-300">
                  <span className="font-semibold text-white">{t('Transfer Points:')}</span>{' '}
                  {t('Click an ally in your current range, or pick a recipient below. Transfers resolve before movement, so only the blue current range counts. 1 pt = 1 transferred point.')}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedTransferTarget?.id ?? ''}
                    onChange={(e) => onActionConfigChange({ targetPlayerId: e.target.value })}
                    className="bg-zinc-950 border border-zinc-700 text-xs text-white rounded px-2 py-1 flex-1"
                  >
                    <option value="">{t('Select Ally Recipient')}</option>
                    {transferTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.username} ({t.x}, {t.y})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={amount}
                    onChange={(e) =>
                      onActionConfigChange({
                        amount: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1 py-1 text-xs text-white text-center font-mono"
                    title={t('You can plan any amount, even if you do not have enough points yet')}
                  />
                  <button
                    disabled={isClosed || !player.isAlive || !selectedTransferTarget}
                    onClick={() => handleQueueAction('send_points')}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold disabled:opacity-40"
                  >
                    {t('Send')}
                  </button>
                </div>
                <PartialExecutionToggle
                  checked={allowPartial}
                  onChange={(checked) => onActionConfigChange({ allowPartial: checked })}
                />
                <div className="text-[10px] text-cyan-400 font-mono">
                  {transferTargets.length === 0
                    ? t('No living allies in your current range.')
                    : t('Blue = current range (transfers happen before movement).')}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {t('You can queue a transfer even if you do not have enough points yet (for example, if an ally is sending points this round).')}
                </div>
              </div>
            )}
          </div>
          ) : (
            <div className="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-xl p-3 text-center text-[11px] text-zinc-500">
              {t('Select an action above to plan it. Click the selected action again to deselect.')}
            </div>
          )}

          {/* Queued Action Items */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-semibold text-zinc-300 flex items-center justify-between">
              <span>{t('Resolution Sequence (Priorities 1→5):')}</span>
              {saveSuccess && (
                <span className="text-emerald-400 flex items-center gap-1 text-[10px]">
                  <CheckCircle className="w-3 h-3" /> {t('Saved on server')}
                </span>
              )}
            </div>

            {actions.length === 0 ? (
              <div className="text-center py-4 text-zinc-500 text-[11px] border border-dashed border-zinc-800 rounded-lg">
                {t('No planned actions yet. Click highlighted map tiles or use the controls above.')}
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto scrollbar-thin">
                {sortedActions.map(({ act, originalIndex }, idx) => {
                  const pGroup = getActionPriorityGroup(act.actionType);
                  const fixed = getFixedActionCost(
                    act.actionType,
                    act.buildingType,
                    assassinationCost
                  );
                  const cost = fixed !== null ? fixed : act.amount || 1;
                  const prevGroup =
                    idx > 0
                      ? getActionPriorityGroup(sortedActions[idx - 1].act.actionType)
                      : null;
                  const showGroupHeader = prevGroup !== pGroup;
                  const targetName = act.targetPlayerId
                    ? allPlayers.find((p) => p.id === act.targetPlayerId)?.username
                    : null;
                  const nukeSilo =
                    act.actionType === 'launch_nuke' && act.buildingId
                      ? buildings.find((b) => b.id === act.buildingId)
                      : null;

                  return (
                    <React.Fragment key={originalIndex}>
                      {showGroupHeader && (
                        <div className="flex items-center gap-1.5 pt-1 first:pt-0">
                          <span className="text-[9px] font-mono font-bold px-1 rounded bg-zinc-800 text-amber-400 border border-zinc-700">
                            P{pGroup}
                          </span>
                          <span className="text-[9px] font-bold tracking-wider text-zinc-400">
                            {t(GROUP_LABELS[pGroup])}
                          </span>
                          <span className="flex-1 h-px bg-zinc-800" />
                        </div>
                      )}
                      <div className="flex items-center justify-between bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-800 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-zinc-200 truncate">
                            {t(act.actionType.replace(/_/g, ' ')).toLocaleUpperCase(
                              language === 'tr' ? 'tr-TR' : 'en-US'
                            )}
                          </span>
                          {act.direction && (
                            <span className="text-zinc-400 font-mono">({t(act.direction)})</span>
                          )}
                          {act.buildingType && (
                            <span className="text-zinc-400">[{t(act.buildingType)}]</span>
                          )}
                          {targetName && (
                            <span className="text-blue-300 truncate">→ {targetName}</span>
                          )}
                          {nukeSilo && (
                            <span className="text-red-300 font-mono">
                              {t('from ({x}, {y})', { x: nukeSilo.x, y: nukeSilo.y })}
                            </span>
                          )}
                          {act.allowPartial && (
                            <span
                              className="text-[8px] font-mono font-bold px-1 rounded bg-amber-950/70 text-amber-300 border border-amber-800/70"
                              title={t('Will spend remaining points if the full amount is unaffordable')}
                            >
                              {t('PARTIAL OK')}
                            </span>
                          )}
                          {act.x !== undefined && (
                            <span className="text-zinc-400 font-mono">
                              ({act.x}, {act.y})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-zinc-400 text-[11px]">
                            {t('{cost} pt', { cost })}
                          </span>
                          <button
                            disabled={isClosed}
                            onClick={() => onRemoveAction(originalIndex)}
                            className="p-1.5 rounded text-zinc-400 hover:text-red-400 active:bg-zinc-800"
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
              {t('Resolved by priority group, then round seed.')}
            </span>
            <button
              onClick={onSubmitActions}
              disabled={isClosed || !player.isAlive || isSaving}
              className="min-h-11 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-zinc-950 font-bold text-xs uppercase tracking-wider rounded-xl disabled:opacity-40 transition-all active:scale-[0.98]"
            >
              {isSaving ? t('Submitting...') : t('Confirm Planned Actions')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
