/**
 * Automated Test Suite for HexGrid Tactical Game Engine
 * Validates all mechanics specified in the Master Prompt
 */
import assert from 'assert';
import { GameEngine } from '../server/engine';
import { GameStateData, ActionSubmission, Building } from '../src/types/game';
import { GAME_RULES, deterministicShuffle } from '../src/game/rules';

function runTestSuite() {
  console.log('=== Starting Game Engine Test Suite ===\n');

  // Test 1: Global Priority Ordering (1: Send, 2: Heal, 3: Build, 4: Move, 5: Attack)
  console.log('Test 1: Global Priority Ordering');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 1, points: 5, x: 2, y: 2, isAlive: true, peaceVote: 'no' },
        p2: { id: 'p2', username: 'P2', avatarUrl: '', health: 3, points: 5, x: 3, y: 2, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
    };

    // P1 attacks P2 (Priority 5) AND P1 heals (Priority 2)
    const actions: ActionSubmission[] = [
      {
        id: 'a1',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'attack', x: 3, y: 2, amount: 2, orderIndex: 0 },
      },
      {
        id: 'a2',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 2,
        data: { actionType: 'heal', amount: 2, orderIndex: 1 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 9999);
    // Events order: heal must happen before attack
    const eventTypes = result.events.map((e) => e.type);
    const healIdx = eventTypes.indexOf('heal');
    const attackIdx = eventTypes.indexOf('attack');
    assert(healIdx !== -1 && attackIdx !== -1, 'Both heal and attack events must be recorded');
    assert(healIdx < attackIdx, 'Heal (priority 2) must execute before Attack (priority 5)');
    console.log('  Passed: Priority 2 executed before Priority 5.');
  }

  // Test 2: Resource validation and Partial-Action scaling
  console.log('\nTest 2: Resource Validation & Partial Execution');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 1, points: 2, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
    };

    // P1 only has 2 points, but requests to heal for 5 points with allowPartial: true
    const actions: ActionSubmission[] = [
      {
        id: 'a1',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 2,
        data: { actionType: 'heal', amount: 5, allowPartial: true, orderIndex: 0 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 8888);
    // P1 converts 2 points to 2 health (from 1 to 3 HP), then receives +1 point for new round => 1 point
    assert.strictEqual(result.nextStateData.players['p1'].health, 3, 'Health should reach 3');
    assert.strictEqual(result.nextStateData.players['p1'].points, 1, 'Points should be 0 + 1 (new round point)');
    console.log('  Passed: Partial action spent all available points and scaled execution.');
  }

  // Test 3: Fixed-cost action cancelled if unaffordable
  console.log('\nTest 3: Fixed-Cost Action Cancellation');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 0, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
    };

    const actions: ActionSubmission[] = [
      {
        id: 'a1',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 4,
        data: { actionType: 'move', direction: 'right', orderIndex: 0 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 7777);
    assert.strictEqual(result.nextStateData.players['p1'].x, 5, 'Player should not have moved');
    const cancelled = result.events.find((e) => e.type === 'cancelled');
    assert(cancelled, 'Cancellation event must be logged');
    console.log('  Passed: Fixed action was safely cancelled with 0 deduction.');
  }

  // Test 4: Mine placement, hidden status, detonation on movement, and consumption
  console.log('\nTest 4: Mine Detonation & Consumption');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 5, x: 10, y: 10, isAlive: true, peaceVote: 'no' },
        p2: { id: 'p2', username: 'P2', avatarUrl: '', health: 3, points: 5, x: 10, y: 11, isAlive: true, peaceVote: 'no' },
      },
      buildings: [
        {
          id: 'mine-1',
          type: 'mine',
          ownerId: 'p1',
          x: 10,
          y: 11,
          health: 1,
        },
      ],
    };

    // P2 moves onto mine at (10, 11) - wait, P2 is at (10, 11) in initial state, let's put mine at (10, 12) and P2 moves down
    state.buildings[0].y = 12;

    const actions: ActionSubmission[] = [
      {
        id: 'a1',
        gameId: 'g1',
        day: 1,
        playerId: 'p2',
        priorityGroup: 4,
        data: { actionType: 'move', direction: 'down', orderIndex: 0 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 6666);
    // P2 moves to (10, 12), triggers mine, takes 1 damage (from 3 to 2 HP)
    assert.strictEqual(result.nextStateData.players['p2'].y, 12, 'P2 moved to tile 12');
    assert.strictEqual(result.nextStateData.players['p2'].health, 2, 'P2 took 1 damage from mine');
    // Mine should be consumed
    assert.strictEqual(result.nextStateData.buildings.length, 0, 'Mine must be removed upon detonation');
    const triggerEvent = result.events.find((e) => e.type === 'mine_triggered');
    assert(triggerEvent, 'Mine trigger event logged');
    console.log('  Passed: Mine detonated, dealt damage, and was consumed.');
  }

  // Test 5: Outpost movement collision
  console.log('\nTest 5: Outpost Movement Blocking');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 5, x: 10, y: 10, isAlive: true, peaceVote: 'no' },
      },
      buildings: [
        {
          id: 'outpost-1',
          type: 'outpost',
          ownerId: 'p2',
          x: 11,
          y: 10,
          health: 2,
        },
      ],
    };

    const actions: ActionSubmission[] = [
      {
        id: 'a1',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 4,
        data: { actionType: 'move', direction: 'right', orderIndex: 0 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 5555);
    assert.strictEqual(result.nextStateData.players['p1'].x, 10, 'Move into outpost must be blocked');
    console.log('  Passed: Outpost blocked player movement.');
  }

  // Test 6: Bank Growth and Claiming
  console.log('\nTest 6: Bank Growth and Claiming');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 2, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [
        {
          id: 'bank-1',
          type: 'bank',
          ownerId: 'p1',
          x: 6,
          y: 5,
          health: 1,
          value: 3, // Current value before transition
        },
      ],
    };

    // Bank value increases by 1 at transition (becomes 4)
    // Then P1 claims it (costs 1 pt, receives 4 pts)
    const actions: ActionSubmission[] = [
      {
        id: 'a1',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 3,
        data: { actionType: 'claim_bank', orderIndex: 0 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 4444);
    // Initial 2 points - 1 claim cost + 4 payout + 1 new round point = 6 points
    assert.strictEqual(result.nextStateData.players['p1'].points, 6, 'Points after claim should be 6');
    assert.strictEqual(result.nextStateData.buildings.length, 0, 'Bank is consumed after claiming');
    console.log('  Passed: Bank grew, was claimed for full value, and was consumed.');
  }

  // Test 7: Nuclear Silo Arming & 3x3 Blast Damage
  console.log('\nTest 7: Nuclear Silo Launch & 3x3 Blast');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 5, x: 0, y: 0, isAlive: true, peaceVote: 'no' },
        target1: { id: 'target1', username: 'Center', avatarUrl: '', health: 3, points: 1, x: 15, y: 15, isAlive: true, peaceVote: 'no' },
        target2: { id: 'target2', username: 'Surround', avatarUrl: '', health: 3, points: 1, x: 16, y: 15, isAlive: true, peaceVote: 'no' },
      },
      buildings: [
        {
          id: 'silo-1',
          type: 'silo',
          ownerId: 'p1',
          x: 1,
          y: 1,
          health: 1,
          isArmed: true, // Armed
        },
      ],
    };

    const actions: ActionSubmission[] = [
      {
        id: 'a1',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'launch_nuke', x: 15, y: 15, orderIndex: 0 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 3333);
    // Center target took 2 damage -> 3 - 2 = 1 HP
    assert.strictEqual(result.nextStateData.players['target1'].health, 1, 'Center target took 2 damage');
    // Surrounding target took 1 damage -> 3 - 1 = 2 HP
    assert.strictEqual(result.nextStateData.players['target2'].health, 2, 'Surround target took 1 damage');
    // Silo is consumed
    assert.strictEqual(result.nextStateData.buildings.length, 0, 'Silo consumed upon firing');
    console.log('  Passed: Nuclear strike dealt 2 center and 1 surround damage.');
  }

  // Test 8: World Peace and Last Player Standing Win Conditions
  console.log('\nTest 8: Win Conditions (World Peace & Last Survivor)');
  {
    const statePeace: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 2, x: 2, y: 2, isAlive: true, peaceVote: 'yes' },
        p2: { id: 'p2', username: 'P2', avatarUrl: '', health: 3, points: 2, x: 4, y: 4, isAlive: true, peaceVote: 'yes' },
      },
      buildings: [],
    };

    const resultPeace = GameEngine.resolveRound(statePeace, [], 2222);
    assert.strictEqual(resultPeace.endReason, 'world_peace', 'All living players voted yes -> World Peace');

    // Last Survivor
    const stateSurvivor: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 2, x: 2, y: 2, isAlive: true, peaceVote: 'no' },
        p2: { id: 'p2', username: 'P2', avatarUrl: '', health: 1, points: 2, x: 3, y: 2, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
    };
    // P1 attacks P2 with 1 point (kills P2)
    const actions: ActionSubmission[] = [
      {
        id: 'a1',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'attack', x: 3, y: 2, amount: 1, orderIndex: 0 },
      },
    ];
    const resultSurvivor = GameEngine.resolveRound(stateSurvivor, actions, 1111);
    assert.strictEqual(resultSurvivor.nextStateData.players['p2'].isAlive, false, 'P2 should be dead');
    assert.strictEqual(resultSurvivor.endReason, 'last_player_standing', 'Only 1 living player remains -> Last Player Standing');
    console.log('  Passed: Win conditions verified.');
  }

  // Test 9: 21-Tile Circular Range (corners excluded, self excluded)
  console.log('\nTest 9: Circular 21-Tile Reach Validation');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 5, x: 10, y: 10, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
    };

    // Corner tile (12, 12) is dx=2, dy=2: MUST be out of range
    const actionsCorner: ActionSubmission[] = [
      {
        id: 'a1',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'attack', x: 12, y: 12, amount: 1, orderIndex: 0 },
      },
    ];
    const resCorner = GameEngine.resolveRound(state, actionsCorner, 123);
    const cancelledCorner = resCorner.events.find((e) => e.type === 'cancelled');
    assert(cancelledCorner, 'Corner tile (12, 12) must be out of range and cancelled');

    // Self tile (10, 10) is dx=0, dy=0: MUST be excluded
    const actionsSelf: ActionSubmission[] = [
      {
        id: 'a2',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'attack', x: 10, y: 10, amount: 1, orderIndex: 0 },
      },
    ];
    const resSelf = GameEngine.resolveRound(state, actionsSelf, 124);
    const cancelledSelf = resSelf.events.find((e) => e.type === 'cancelled');
    assert(cancelledSelf, 'Self tile (10, 10) must be out of reach and cancelled');

    // Valid circular tile (11, 12) is dx=1, dy=2: MUST succeed
    const actionsValid: ActionSubmission[] = [
      {
        id: 'a3',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'attack', x: 11, y: 12, amount: 1, orderIndex: 0 },
      },
    ];
    const resValid = GameEngine.resolveRound(state, actionsValid, 125);
    const attackValid = resValid.events.find((e) => e.type === 'attack');
    assert(attackValid, 'Circular tile (11, 12) must be reached successfully');
    console.log('  Passed: 21-tile circular reach correctly rejected corners/self and permitted circular tiles.');
  }

  // Test 10: Blocked movement causes subsequent out-of-range attack to cancel
  console.log('\nTest 10: Blocked Movement Cancels Out-of-Range Attack');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 5, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [
        // Outpost blocking movement to (6, 5)
        { id: 'b-block', type: 'outpost', ownerId: 'other', x: 6, y: 5, health: 2 },
      ],
    };

    // P1 plans to move right to (6, 5), then attack (8, 5)
    // From (6, 5), (8, 5) is dx=2 (in range)
    // But (6, 5) is blocked by outpost, so P1 stays at (5, 5).
    // From (5, 5), (8, 5) is dx=3 (out of 5x5 range!)
    const actions: ActionSubmission[] = [
      {
        id: 'a-move',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 4,
        data: { actionType: 'move', direction: 'right', orderIndex: 0 },
      },
      {
        id: 'a-attack',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'attack', x: 8, y: 5, amount: 1, orderIndex: 1 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 789);
    assert.strictEqual(result.nextStateData.players['p1'].x, 5, 'Player movement should have been blocked');
    const attackEvent = result.events.find((e) => e.type === 'attack');
    assert.strictEqual(attackEvent, undefined, 'Attack must not have executed');
    const cancelledAttack = result.events.find(
      (e) => e.type === 'cancelled' && e.description.includes('(8, 5)')
    );
    assert(cancelledAttack, 'Attack cancellation event must be recorded');
    console.log('  Passed: Blocked movement kept player at origin and cancelled out-of-range attack.');
  }

  // Test 11: Bank Claim From Projected (Ghost) Range
  console.log('\nTest 11: Bank Claim From Projected Range');
  {
    const baseState: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 3, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [
        { id: 'bank-1', type: 'bank', ownerId: 'p1', x: 8, y: 5, health: 1, value: 2 },
      ],
    };

    // Move right first (5,5 -> 6,5), then claim the bank at (8,5).
    // The bank is out of range from (5,5) but in range from the projected (6,5).
    const actions: ActionSubmission[] = [
      {
        id: 'a-move',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 4,
        data: { actionType: 'move', direction: 'right', orderIndex: 1 },
      },
      {
        id: 'a-claim',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 3,
        data: { actionType: 'claim_bank', buildingId: 'bank-1', orderIndex: 0 },
      },
    ];

    const result = GameEngine.resolveRound(baseState, actions, 4321);
    assert.strictEqual(result.nextStateData.players['p1'].x, 6, 'Player should have moved right');
    assert.strictEqual(result.nextStateData.buildings.length, 0, 'Bank should be claimed from projected range');
    assert(
      result.events.some((e) => e.type === 'bank_claimed'),
      'Bank claim should have executed'
    );

    // Same setup but the bank is too far even from the projected position.
    const farState: GameStateData = JSON.parse(JSON.stringify(baseState));
    farState.buildings[0].x = 9;
    const farResult = GameEngine.resolveRound(farState, actions, 4321);
    assert.strictEqual(farResult.nextStateData.buildings.length, 1, 'Out-of-range bank must not be claimed');
    assert(
      farResult.events.some((e) => e.type === 'cancelled'),
      'Out-of-range bank claim should be cancelled'
    );
    console.log('  Passed: Claim uses projected range and rejects truly out-of-range banks.');
  }

  // Test 12: Custom map size bounds
  console.log('\nTest 12: Custom Map Size Bounds');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 2, x: 10, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
    };

    const actions: ActionSubmission[] = [
      {
        id: 'a-move',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 4,
        data: { actionType: 'move', direction: 'right', orderIndex: 0 },
      },
      {
        id: 'a-attack',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'attack', x: 11, y: 5, amount: 1, orderIndex: 1 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 2001, 10);
    assert.strictEqual(result.nextStateData.players['p1'].x, 10, 'Move outside 10x10 map must be cancelled');
    assert(
      !result.events.some((e) => e.type === 'move'),
      'No movement event should be recorded outside the map'
    );
    assert(
      !result.events.some((e) => e.type === 'attack'),
      'No attack event should be recorded outside the map'
    );
    assert.strictEqual(result.nextStateData.players['p1'].points, 3, 'Only the new-round point is gained');
    console.log('  Passed: Custom map bounds reject out-of-bounds movement and attacks.');
  }

  // Test 13: Disabled building types reject construction and interactions
  console.log('\nTest 13: Disabled Building Types');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 10, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [
        { id: 'bank-1', type: 'bank', ownerId: 'p1', x: 6, y: 5, health: 1, value: 2 },
        { id: 'silo-1', type: 'silo', ownerId: 'p1', x: 4, y: 5, health: 1, isArmed: true },
      ],
    };

    const actions: ActionSubmission[] = [
      {
        id: 'a-build',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 3,
        data: { actionType: 'build', buildingType: 'mine', x: 5, y: 6, orderIndex: 0 },
      },
      {
        id: 'a-claim',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 3,
        data: { actionType: 'claim_bank', buildingId: 'bank-1', orderIndex: 1 },
      },
      {
        id: 'a-nuke',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'launch_nuke', x: 8, y: 8, orderIndex: 2 },
      },
    ];

    const result = GameEngine.resolveRound(
      state,
      actions,
      2002,
      25,
      { mine: false, outpost: true, silo: false, bank: false }
    );

    assert.strictEqual(result.nextStateData.buildings.length, 2, 'Existing buildings remain on the map');
    assert(
      result.nextStateData.buildings.some((b) => b.id === 'bank-1'),
      'Disabled bank must not be claimed'
    );
    assert(
      result.nextStateData.buildings.some((b) => b.id === 'silo-1'),
      'Disabled silo must not launch'
    );
    assert.strictEqual(result.nextStateData.players['p1'].points, 11, 'No points are spent on rejected actions');
    assert(
      result.events.filter((e) => e.type === 'cancelled').length >= 3,
      'Each action involving a disabled building must be cancelled'
    );
    console.log('  Passed: Disabled buildings reject construction, claims and launches.');
  }

  console.log('\nAll Game Engine tests passed successfully! [13/13]');
}

runTestSuite();
