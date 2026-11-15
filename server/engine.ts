/**
 * Authoritative Server-Side Game Resolution Engine
 * Conforms to Master Specification Sections 4, 5, 6, 7, 8, 9, 10, 11, 14
 */
import { v4 as uuidv4 } from 'uuid';
import {
  GameStateData,
  ActionSubmission,
  GameEngineEvent,
  Building,
  BuildingType,
  WinReason,
} from '../src/types/game';
import {
  GAME_RULES,
  MIN_COORD,
  DEFAULT_MAP_SIZE,
  DEFAULT_MINE_LIMIT,
  DEFAULT_MINE_LIMIT_INCREASE_DAYS,
  DEFAULT_ASSASSINATION_COST,
  ASSASSINATION_DAMAGE,
  createDefaultBuildingConfig,
  getActionPriorityGroup,
  getFixedActionCost,
  getMineLimitForDay,
  NUKE_BLAST_OFFSETS,
  isSquareInPlayerRange,
  deterministicShuffle,
} from '../src/game/rules';

export interface ResolutionResult {
  nextStateData: GameStateData;
  events: GameEngineEvent[];
  endReason: WinReason;
}

export class GameEngine {
  /**
   * Resolves Day N actions to produce Day N+1 state and ordered playback events.
   */
  static resolveRound(
    currentState: GameStateData,
    actions: ActionSubmission[],
    nextPrioritySeed: number,
    mapSize: number = DEFAULT_MAP_SIZE,
    enabledBuildings: Record<BuildingType, boolean> = createDefaultBuildingConfig(),
    maxHealth: number = GAME_RULES.MAX_HEALTH,
    mineLimit: number = DEFAULT_MINE_LIMIT,
    mineLimitIncreaseDays: number = DEFAULT_MINE_LIMIT_INCREASE_DAYS,
    roundDay: number = 1,
    assassinationCost: number = DEFAULT_ASSASSINATION_COST
  ): ResolutionResult {
    const events: GameEngineEvent[] = [];
    const currentMineLimit = getMineLimitForDay(
      mineLimit,
      roundDay,
      mineLimitIncreaseDays
    );
    const minesPlaced: Record<string, number> = {
      ...(currentState.minesPlaced ?? {}),
    };
    for (const playerId of Object.keys(currentState.players)) {
      minesPlaced[playerId] = minesPlaced[playerId] ?? 0;
    }

    // Deep clone players and buildings
    const players: GameStateData['players'] = JSON.parse(
      JSON.stringify(currentState.players)
    );
    let buildings: Building[] = JSON.parse(
      JSON.stringify(currentState.buildings)
    );

    // 1. Advance building states at round transition:
    // - Surviving banks increase in value by +1 (max 5)
    // - Unarmed silos built on earlier days become armed
    for (const b of buildings) {
      if (b.type === 'bank' && (b.value ?? 1) < GAME_RULES.BUILDINGS.bank.maxValue) {
        b.value = (b.value ?? 1) + GAME_RULES.BUILDINGS.bank.valueIncreasePerDay;
      }
      if (b.type === 'silo' && !b.isArmed) {
        b.isArmed = true;
      }
    }

    // 2. Establish deterministic player priority order for the round using current state's seed
    const activePlayerIds = Object.keys(players).filter((id) => players[id].isAlive);
    const roundSeed = currentState.prioritySeed || 1337;
    const playerPriorityOrder = deterministicShuffle(activePlayerIds, roundSeed);
    const playerPriorityMap = new Map<string, number>();
    playerPriorityOrder.forEach((pid, idx) => playerPriorityMap.set(pid, idx));

    // 3. Sort submitted actions:
    // Primary: Action Priority Group (1 to 5)
    // Secondary: Player Priority Rank (lower index = earlier)
    // Tertiary: Player submission orderIndex
    const sortedActions = [...actions].sort((a, b) => {
      const pGroupA = getActionPriorityGroup(a.data.actionType);
      const pGroupB = getActionPriorityGroup(b.data.actionType);
      if (pGroupA !== pGroupB) return pGroupA - pGroupB;

      const rankA = playerPriorityMap.get(a.playerId) ?? 9999;
      const rankB = playerPriorityMap.get(b.playerId) ?? 9999;
      if (rankA !== rankB) return rankA - rankB;

      const orderA = a.data.orderIndex ?? 0;
      const orderB = b.data.orderIndex ?? 0;
      return orderA - orderB;
    });

    // Buildings and transfers resolve from the player's current position.
    // Only attacks may use the projected (ghost) position, because movement
    // happens before priority 5.
    const isInCurrentReach = (
      currentX: number,
      currentY: number,
      targetX: number,
      targetY: number
    ) => isSquareInPlayerRange(currentX, currentY, targetX, targetY, mapSize);

    // Helper functions
    const isOccupiedByLivingPlayer = (x: number, y: number, excludePlayerId?: string) => {
      return Object.values(players).some(
        (p) => p.isAlive && p.x === x && p.y === y && p.id !== excludePlayerId
      );
    };

    const isOccupiedByBlockingBuilding = (x: number, y: number) => {
      return buildings.some(
        (b) => b.x === x && b.y === y && b.type !== 'mine'
      );
    };

    const recordDeath = (player: GameStateData['players'][string], reason: string) => {
      player.isAlive = false;
      player.health = 0;
      events.push({
        id: uuidv4(),
        type: 'death',
        playerId: player.id,
        fromX: player.x,
        fromY: player.y,
        description: `${player.username} was eliminated (${reason})`,
      });
    };

    // 4. Execute actions sequentially
    for (const act of sortedActions) {
      const actor = players[act.playerId];
      if (!actor || !actor.isAlive) {
        events.push({
          id: uuidv4(),
          type: 'cancelled',
          playerId: act.playerId,
          reason: 'Player is deceased',
          description: `Action cancelled: player is eliminated`,
        });
        continue;
      }

      const actionType = act.data.actionType;

      // Reject actions that involve a building type disabled for this game.
      const buildingTypeForAction: BuildingType | null =
        actionType === 'build'
          ? act.data.buildingType ?? null
          : actionType === 'claim_bank'
          ? 'bank'
          : actionType === 'launch_nuke'
          ? 'silo'
          : null;
      if (buildingTypeForAction && !enabledBuildings[buildingTypeForAction]) {
        events.push({
          id: uuidv4(),
          type: 'cancelled',
          playerId: actor.id,
          reason: 'Building type disabled for this game',
          description: `${actor.username}'s ${actionType.replace(/_/g, ' ')} was cancelled: ${buildingTypeForAction} is disabled in this game`,
        });
        continue;
      }

      const fixedCost = getFixedActionCost(
        actionType,
        act.data.buildingType,
        assassinationCost
      );

      // Point Validation
      if (fixedCost !== null) {
        if (actor.points < fixedCost) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Insufficient points for fixed-cost action',
            description: `${actor.username} could not afford ${actionType} (needs ${fixedCost} pts, has ${actor.points})`,
          });
          continue;
        }
      }

      // Variable action point calculation
      let paidPoints = 0;
      if (fixedCost === null) {
        const requested = Math.max(1, act.data.amount || 1);
        if (actor.points >= requested) {
          paidPoints = requested;
        } else if (act.data.allowPartial && actor.points > 0) {
          paidPoints = actor.points;
        } else {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Insufficient points for variable-amount action',
            description: `${actor.username} could not afford ${actionType} (${requested} pts requested, ${actor.points} available)`,
          });
          continue;
        }
      }

      // --- Priority 1: SEND POINTS ---
      if (actionType === 'send_points') {
        const targetId = act.data.targetPlayerId;
        const target = targetId ? players[targetId] : null;

        if (!target || !target.isAlive) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Target player not found or deceased',
            description: `${actor.username}'s point transfer cancelled: target unavailable`,
          });
          continue;
        }

        if (!isSquareInPlayerRange(actor.x, actor.y, target.x, target.y, mapSize)) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Target out of current circular range (5x5 excluding corners/self)',
            description: `${actor.username}'s point transfer cancelled: target must be within the current 21-square circular range because transfers resolve before movement`,
          });
          continue;
        }

        actor.points -= paidPoints;
        target.points += paidPoints;
        events.push({
          id: uuidv4(),
          type: 'send_points',
          playerId: actor.id,
          targetPlayerId: target.id,
          fromX: actor.x,
          fromY: actor.y,
          toX: target.x,
          toY: target.y,
          amount: paidPoints,
          partial: paidPoints < (act.data.amount || 1),
          description: `${actor.username} transferred ${paidPoints} pt(s) to ${target.username}`,
        });
      }

      // --- Priority 2: HEAL ---
      else if (actionType === 'heal') {
        if (actor.health >= maxHealth) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Already at maximum health',
            description: `${actor.username} is already at full health (${maxHealth}/${maxHealth})`,
          });
          continue;
        }

        const maxHealAllowed = maxHealth - actor.health;
        const healthRestored = Math.min(paidPoints, maxHealAllowed);
        // Deduct points used for health
        actor.points -= healthRestored;
        actor.health += healthRestored;

        events.push({
          id: uuidv4(),
          type: 'heal',
          playerId: actor.id,
          fromX: actor.x,
          fromY: actor.y,
          amount: healthRestored,
          description: `${actor.username} converted ${healthRestored} pt(s) into +${healthRestored} health (${actor.health}/${maxHealth})`,
        });
      }

      // --- Priority 3: BUILD ---
      else if (actionType === 'build') {
        const bType = act.data.buildingType;
        const targetX = act.data.x;
        const targetY = act.data.y;

        if (!bType || targetX === undefined || targetY === undefined) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Invalid build parameters',
            description: `${actor.username}'s build order had missing parameters`,
          });
          continue;
        }

        // Validate coordinates
        if (
          targetX < MIN_COORD ||
          targetX > mapSize ||
          targetY < MIN_COORD ||
          targetY > mapSize
        ) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Target out of bounds',
            description: `${actor.username}'s construction was outside the ${mapSize}x${mapSize} grid`,
          });
          continue;
        }

        // Validate circular range from the current position (builds resolve
        // before movement and may not use the projected ghost position)
        if (!isInCurrentReach(actor.x, actor.y, targetX, targetY)) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Target out of circular 21-tile reach',
            description: `${actor.username}'s build location is beyond range (must be within circular 21-tile perimeter)`,
          });
          continue;
        }

        // Cannot build under any living player
        if (isOccupiedByLivingPlayer(targetX, targetY)) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Cannot build underneath a player',
            description: `${actor.username} cannot build on tile occupied by a player`,
          });
          continue;
        }

        // Cannot build on top of an existing building
        if (buildings.some((b) => b.x === targetX && b.y === targetY)) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Tile already contains a building',
            description: `${actor.username} cannot build on an occupied tile`,
          });
          continue;
        }

        // Mines are limited per player for the whole game. Detonated or
        // destroyed mines still count toward this lifetime total.
        if (bType === 'mine') {
          const used = minesPlaced[actor.id] ?? 0;
          if (used >= currentMineLimit) {
            events.push({
              id: uuidv4(),
              type: 'cancelled',
              playerId: actor.id,
              reason: 'Mine limit reached',
              description: `${actor.username} has reached the mine limit (${used}/${currentMineLimit}) for Day ${roundDay}`,
            });
            continue;
          }
        }

        const cost = GAME_RULES.BUILDINGS[bType].cost;
        actor.points -= cost;

        const newBuilding: Building = {
          id: uuidv4(),
          type: bType,
          ownerId: actor.id,
          x: targetX,
          y: targetY,
          health: GAME_RULES.BUILDINGS[bType].health,
          isArmed: bType === 'silo' ? false : undefined,
          value: bType === 'bank' ? GAME_RULES.BUILDINGS.bank.initialValue : undefined,
        };
        buildings.push(newBuilding);
        if (bType === 'mine') {
          minesPlaced[actor.id] = (minesPlaced[actor.id] ?? 0) + 1;
        }

        events.push({
          id: uuidv4(),
          type: 'build',
          playerId: actor.id,
          buildingId: newBuilding.id,
          buildingType: bType,
          toX: targetX,
          toY: targetY,
          description: `${actor.username} constructed a ${bType} at (${targetX}, ${targetY})`,
        });
      }

      // --- Priority 3: CLAIM BANK (queued by clicking an owned bank) ---
      else if (actionType === 'claim_bank') {
        const requestedBankId = act.data.buildingId;
        const bank = requestedBankId
          ? buildings.find(
              (b) =>
                b.id === requestedBankId &&
                b.type === 'bank' &&
                b.ownerId === actor.id &&
                !b.isSpent
            )
          : buildings.find((b) => b.type === 'bank' && b.ownerId === actor.id && !b.isSpent);

        if (!bank) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'No active bank owned by player',
            description: `${actor.username} has no active bank to claim`,
          });
          continue;
        }

        if (!isInCurrentReach(actor.x, actor.y, bank.x, bank.y)) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Bank out of circular 21-tile reach',
            description: `${actor.username}'s bank claim at (${bank.x}, ${bank.y}) was out of range`,
          });
          continue;
        }

        actor.points -= GAME_RULES.BUILDINGS.bank.claimCost;
        const payout = bank.value ?? 1;
        actor.points += payout;

        // Consume bank
        buildings = buildings.filter((b) => b.id !== bank.id);

        events.push({
          id: uuidv4(),
          type: 'bank_claimed',
          playerId: actor.id,
          buildingId: bank.id,
          fromX: bank.x,
          fromY: bank.y,
          amount: payout,
          description: `${actor.username} claimed bank at (${bank.x}, ${bank.y}) for +${payout} pts`,
        });
      }

      // --- Priority 4: MOVE ---
      else if (actionType === 'move') {
        const dir = act.data.direction;
        let newX = actor.x;
        let newY = actor.y;

        if (dir === 'up') newY -= 1;
        else if (dir === 'down') newY += 1;
        else if (dir === 'left') newX -= 1;
        else if (dir === 'right') newX += 1;
        else {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Invalid movement direction',
            description: `${actor.username}'s move direction was invalid`,
          });
          continue;
        }

        // Bounds check
        if (
          newX < MIN_COORD ||
          newX > mapSize ||
          newY < MIN_COORD ||
          newY > mapSize
        ) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Cannot move outside grid boundaries',
            description: `${actor.username} tried to move outside the grid`,
          });
          continue;
        }

        // Collision: other player
        if (isOccupiedByLivingPlayer(newX, newY, actor.id)) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Destination tile occupied by another player',
            description: `${actor.username}'s move to (${newX}, ${newY}) was blocked by another player`,
          });
          continue;
        }

        // Collision: blocking building (outpost, silo, bank)
        if (isOccupiedByBlockingBuilding(newX, newY)) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Destination blocked by building',
            description: `${actor.username}'s move to (${newX}, ${newY}) was blocked by a fortification`,
          });
          continue;
        }

        // Deduct movement point
        actor.points -= 1;
        const oldX = actor.x;
        const oldY = actor.y;
        actor.x = newX;
        actor.y = newY;

        events.push({
          id: uuidv4(),
          type: 'move',
          playerId: actor.id,
          fromX: oldX,
          fromY: oldY,
          toX: newX,
          toY: newY,
          description: `${actor.username} moved ${dir} to (${newX}, ${newY})`,
        });

        // Check Mine Trigger (any mine placed on destination tile not owned by actor)
        const mineIndex = buildings.findIndex(
          (b) => b.type === 'mine' && b.x === newX && b.y === newY && b.ownerId !== actor.id
        );

        if (mineIndex !== -1 && enabledBuildings.mine) {
          const mine = buildings[mineIndex];
          // Detonate mine
          buildings.splice(mineIndex, 1);
          actor.health = Math.max(0, actor.health - GAME_RULES.BUILDINGS.mine.damageOnTrigger);

          events.push({
            id: uuidv4(),
            type: 'mine_triggered',
            playerId: actor.id,
            buildingId: mine.id,
            fromX: newX,
            fromY: newY,
            damage: GAME_RULES.BUILDINGS.mine.damageOnTrigger,
            description: `A mine detonated under ${actor.username} at (${newX}, ${newY})! -1 HP`,
          });

          if (actor.health <= 0) {
            recordDeath(actor, 'stepped on a hidden mine');
          }
        }
      }

      // --- Priority 5: ASSASSINATE ---
      else if (actionType === 'assassinate') {
        if (assassinationCost <= 0) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Assassination is disabled',
            description: `${actor.username}'s assassination was cancelled: the action is disabled in this game`,
          });
          continue;
        }

        const targetId = act.data.targetPlayerId;
        const target = targetId ? players[targetId] : null;

        if (!target || !target.isAlive || target.id === actor.id) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Assassination target unavailable',
            description: `${actor.username}'s assassination was cancelled: target is unavailable`,
          });
          continue;
        }

        actor.points -= assassinationCost;
        target.health = Math.max(0, target.health - ASSASSINATION_DAMAGE);

        events.push({
          id: uuidv4(),
          type: 'attack',
          playerId: actor.id,
          targetPlayerId: target.id,
          fromX: actor.x,
          fromY: actor.y,
          toX: target.x,
          toY: target.y,
          amount: assassinationCost,
          damage: ASSASSINATION_DAMAGE,
          description: `${actor.username} assassinated ${target.username} for ${ASSASSINATION_DAMAGE} damage (${assassinationCost} pt)`,
        });
        events.push({
          id: uuidv4(),
          type: 'damage',
          playerId: target.id,
          fromX: target.x,
          fromY: target.y,
          damage: ASSASSINATION_DAMAGE,
          description: `${target.username} sustained ${ASSASSINATION_DAMAGE} damage (${target.health}/${maxHealth} HP remaining)`,
        });
        if (target.health <= 0) {
          recordDeath(target, `assassinated by ${actor.username}`);
        }
      }

      // --- Priority 5: ATTACK ---
      else if (actionType === 'attack') {
        const targetX = act.data.x;
        const targetY = act.data.y;

        if (targetX === undefined || targetY === undefined) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Missing target coordinates',
            description: `${actor.username}'s attack order was missing coordinates`,
          });
          continue;
        }

        // Check range from player's ACTUAL position at execution time
        // If movement was blocked, the player stayed in place and the attack will cancel if out of reach!
        if (!isSquareInPlayerRange(actor.x, actor.y, targetX, targetY, mapSize)) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Target coordinate out of reach from player actual position',
            description: `${actor.username}'s strike at (${targetX}, ${targetY}) cancelled: target is out of range from current location (${actor.x}, ${actor.y})`,
          });
          continue;
        }

        actor.points -= paidPoints;
        const damage = paidPoints * GAME_RULES.DAMAGE_PER_POINT;

        events.push({
          id: uuidv4(),
          type: 'attack',
          playerId: actor.id,
          fromX: actor.x,
          fromY: actor.y,
          toX: targetX,
          toY: targetY,
          amount: paidPoints,
          damage,
          description: `${actor.username} attacked coordinate (${targetX}, ${targetY}) with ${paidPoints} pt(s) (${damage} dmg)`,
        });

        // Hit entities at target position:
        // 1. Players
        for (const p of Object.values(players)) {
          if (p.isAlive && p.x === targetX && p.y === targetY) {
            p.health = Math.max(0, p.health - damage);
            events.push({
              id: uuidv4(),
              type: 'damage',
              playerId: p.id,
              fromX: targetX,
              fromY: targetY,
              damage,
              description: `${p.username} sustained ${damage} damage (${p.health}/${maxHealth} HP remaining)`,
            });
            if (p.health <= 0) {
              recordDeath(p, `struck by ${actor.username}'s attack`);
            }
          }
        }

        // 2. Buildings
        for (let i = buildings.length - 1; i >= 0; i--) {
          const b = buildings[i];
          if (b.x === targetX && b.y === targetY) {
            b.health -= damage;
            if (b.health <= 0) {
              buildings.splice(i, 1);
              events.push({
                id: uuidv4(),
                type: 'building_destroyed',
                buildingId: b.id,
                buildingType: b.type,
                fromX: b.x,
                fromY: b.y,
                description: `${b.type.toUpperCase()} at (${b.x}, ${b.y}) was destroyed by the attack`,
              });
            }
          }
        }
      }

      // --- Priority 5: NUCLEAR LAUNCH ---
      else if (actionType === 'launch_nuke') {
        const siloId = act.data.buildingId;
        const silo = siloId ? buildings.find((b) => b.id === siloId) : undefined;

        if (
          !silo ||
          silo.type !== 'silo' ||
          silo.ownerId !== actor.id ||
          !silo.isArmed ||
          silo.isSpent
        ) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Selected nuclear silo is not ready',
            description: `${actor.username}'s nuclear launch cancelled: the selected silo is missing, unarmed, spent, or not owned by the player`,
          });
          continue;
        }

        const targetX = act.data.x;
        const targetY = act.data.y;
        if (targetX === undefined || targetY === undefined) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Target coordinate not specified',
            description: `${actor.username}'s nuclear strike target was missing`,
          });
          continue;
        }

        if (
          !Number.isInteger(targetX) ||
          !Number.isInteger(targetY) ||
          targetX < MIN_COORD ||
          targetX > mapSize ||
          targetY < MIN_COORD ||
          targetY > mapSize
        ) {
          events.push({
            id: uuidv4(),
            type: 'cancelled',
            playerId: actor.id,
            reason: 'Target coordinate out of map bounds',
            description: `${actor.username}'s nuclear strike target (${targetX}, ${targetY}) is outside the map`,
          });
          continue;
        }

        actor.points -= GAME_RULES.BUILDINGS.silo.launchCost;
        // Silo is consumed upon launch
        buildings = buildings.filter((b) => b.id !== silo.id);

        events.push({
          id: uuidv4(),
          type: 'nuke_launch',
          playerId: actor.id,
          fromX: silo.x,
          fromY: silo.y,
          toX: targetX,
          toY: targetY,
          description: `TACTICAL NUKE LAUNCHED by ${actor.username} targeting (${targetX}, ${targetY})!`,
        });

        // 13-tile blast: 3x3 core plus the four cardinal tips.
        for (const { dx, dy, damage: blastDamage } of NUKE_BLAST_OFFSETS) {
          const bx = targetX + dx;
          const by = targetY + dy;
          if (
            bx < MIN_COORD ||
            bx > mapSize ||
            by < MIN_COORD ||
            by > mapSize
          ) {
            continue;
          }

          // Damage players in blast
          for (const p of Object.values(players)) {
            if (p.isAlive && p.x === bx && p.y === by) {
              p.health = Math.max(0, p.health - blastDamage);
              events.push({
                id: uuidv4(),
                type: 'damage',
                playerId: p.id,
                fromX: bx,
                fromY: by,
                damage: blastDamage,
                description: `${p.username} hit by nuclear shockwave at (${bx}, ${by}) (-${blastDamage} HP)`,
              });
              if (p.health <= 0) {
                recordDeath(p, 'vaporized in nuclear blast');
              }
            }
          }

          // Damage buildings in blast
          for (let i = buildings.length - 1; i >= 0; i--) {
            const b = buildings[i];
            if (b.x === bx && b.y === by) {
              b.health -= blastDamage;
              if (b.health <= 0) {
                buildings.splice(i, 1);
                events.push({
                  id: uuidv4(),
                  type: 'building_destroyed',
                  buildingId: b.id,
                  buildingType: b.type,
                  fromX: b.x,
                  fromY: b.y,
                  description: `${b.type.toUpperCase()} at (${b.x}, ${b.y}) destroyed in nuclear strike`,
                });
              }
            }
          }
        }
      }
    }

    // 5. Award +1 point to every living player for the new round
    for (const p of Object.values(players)) {
      if (p.isAlive) {
        p.points += GAME_RULES.POINTS_PER_ROUND;
      }
    }

    // 6. Check Win / End Conditions
    let endReason: WinReason = null;
    const livingPlayers = Object.values(players).filter((p) => p.isAlive);
    const totalPlayersCount = Object.keys(players).length;

    // Condition A: World Peace (all living players vote 'yes')
    if (
      livingPlayers.length > 0 &&
      livingPlayers.every((p) => p.peaceVote === 'yes')
    ) {
      endReason = 'world_peace';
    }
    // Condition B: Last Player Standing (only 1 survivor left in a multi-player game)
    else if (totalPlayersCount > 1 && livingPlayers.length === 1) {
      endReason = 'last_player_standing';
    } else if (totalPlayersCount > 1 && livingPlayers.length === 0) {
      endReason = 'last_player_standing'; // Mutual elimination
    }

    // Next round seed & deterministic priority order for next round
    const nextPlayerOrder = deterministicShuffle(
      Object.keys(players).filter((id) => players[id].isAlive),
      nextPrioritySeed
    );

    const nextStateData: GameStateData = {
      prioritySeed: nextPrioritySeed,
      playerPriorityOrder: nextPlayerOrder,
      players,
      buildings,
      minesPlaced,
      events,
    };

    return {
      nextStateData,
      events,
      endReason,
    };
  }
}
