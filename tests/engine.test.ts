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

  // Test 7: Nuclear Silo Arming & 13-tile Blast Damage
  console.log('\nTest 7: Nuclear Silo Launch & 13-tile Blast');
  {
    const blastOffsets: Array<[number, number, number]> = [
      [0, 0, 3],
      [-1, -1, 2],
      [0, -1, 2],
      [1, -1, 2],
      [-1, 0, 2],
      [1, 0, 2],
      [-1, 1, 2],
      [0, 1, 2],
      [1, 1, 2],
      [0, -2, 1],
      [0, 2, 1],
      [-2, 0, 1],
      [2, 0, 1],
    ];

    const players: GameStateData['players'] = {
      p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 5, x: 0, y: 0, isAlive: true, peaceVote: 'no' },
    };
    blastOffsets.forEach(([dx, dy], index) => {
      players[`target${index}`] = {
        id: `target${index}`,
        username: `Target ${index}`,
        avatarUrl: '',
        health: 5,
        points: 1,
        x: 15 + dx,
        y: 15 + dy,
        isAlive: true,
        peaceVote: 'no',
      };
    });
    // Just outside the blast: diagonal at Chebyshev distance 2.
    players['outside'] = {
      id: 'outside',
      username: 'Outside',
      avatarUrl: '',
      health: 5,
      points: 1,
      x: 17,
      y: 17,
      isAlive: true,
      peaceVote: 'no',
    };

    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players,
      buildings: [
        {
          id: 'silo-1',
          type: 'silo',
          ownerId: 'p1',
          x: 1,
          y: 1,
          health: 1,
          isArmed: true,
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
        data: { actionType: 'launch_nuke', buildingId: 'silo-1', x: 15, y: 15, orderIndex: 0 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 3333);
    blastOffsets.forEach(([, , damage], index) => {
      assert.strictEqual(
        result.nextStateData.players[`target${index}`].health,
        5 - damage,
        `Blast tile ${index} must take ${damage} damage`
      );
    });
    assert.strictEqual(result.nextStateData.players['outside'].health, 5, 'Outside tile takes no damage');
    assert.strictEqual(
      result.events.filter((e) => e.type === 'damage').length,
      13,
      'Nuclear blast must damage exactly 13 tiles'
    );
    assert.strictEqual(result.nextStateData.buildings.length, 0, 'Silo consumed upon firing');
    console.log('  Passed: Nuclear strike hit 13 tiles for 3/2/1 damage.');
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

  // Test 11: Bank Claim Uses Current Range (Not Projected/Ghost Range)
  console.log('\nTest 11: Bank Claim Uses Current Range');
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

    // Move right first (5,5 -> 6,5), then try to claim the bank at (8,5).
    // The bank is only in range from the projected (6,5), which is not allowed
    // for building actions.
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
    assert.strictEqual(
      result.nextStateData.buildings.length,
      1,
      'Bank must not be claimed from projected range'
    );
    assert(
      !result.events.some((e) => e.type === 'bank_claimed'),
      'Projected-only bank claim must be cancelled'
    );
    assert(
      result.events.some((e) => e.type === 'cancelled'),
      'Projected-only bank claim should be cancelled'
    );

    // A bank inside the current range still works (claim resolves before move).
    const nearState: GameStateData = JSON.parse(JSON.stringify(baseState));
    nearState.buildings[0].x = 7;
    const nearResult = GameEngine.resolveRound(nearState, actions, 4321);
    assert.strictEqual(nearResult.nextStateData.players['p1'].x, 6, 'Player should still move right');
    assert.strictEqual(nearResult.nextStateData.buildings.length, 0, 'In-range bank should be claimed');
    assert(
      nearResult.events.some((e) => e.type === 'bank_claimed'),
      'In-range bank claim should execute'
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
    console.log('  Passed: Claim uses the current range and rejects projected-only banks.');
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

  // Test 14: Point transfers use current range, never projected move range
  console.log('\nTest 14: Point Transfers Require Current Range');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 5, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
        p2: { id: 'p2', username: 'P2', avatarUrl: '', health: 3, points: 5, x: 9, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
    };

    const actions: ActionSubmission[] = [
      {
        id: 'a-send',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 1,
        data: { actionType: 'send_points', targetPlayerId: 'p2', amount: 2, orderIndex: 0 },
      },
      {
        id: 'a-move-1',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 4,
        data: { actionType: 'move', direction: 'right', orderIndex: 1 },
      },
      {
        id: 'a-move-2',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 4,
        data: { actionType: 'move', direction: 'right', orderIndex: 2 },
      },
    ];

    // P2 is out of range from P1's current position but would be in range from
    // P1's projected position after both moves. Transfers resolve first, so this
    // transfer must be cancelled.
    const projectedOnly = GameEngine.resolveRound(state, actions, 2003);
    assert.strictEqual(projectedOnly.nextStateData.players['p1'].x, 7, 'P1 should still move twice');
    assert(
      !projectedOnly.events.some((e) => e.type === 'send_points'),
      'Transfer must not execute using a projected move position'
    );
    assert.strictEqual(projectedOnly.nextStateData.players['p1'].points, 4, 'Rejected transfer must not spend points');
    assert.strictEqual(projectedOnly.nextStateData.players['p2'].points, 6, 'P2 must not receive projected-range points');

    const nearState: GameStateData = JSON.parse(JSON.stringify(state));
    nearState.players['p2'].x = 7;
    const inRange = GameEngine.resolveRound(nearState, [actions[0]], 2004);
    assert(
      inRange.events.some((e) => e.type === 'send_points'),
      'Transfer within the current range must execute'
    );
    assert.strictEqual(inRange.nextStateData.players['p1'].points, 4, 'In-range transfer spends the requested points');
    assert.strictEqual(inRange.nextStateData.players['p2'].points, 8, 'P2 receives the transfer and round point');
    console.log('  Passed: Transfers use current range and ignore projected move range.');
  }

  // Test 15: Nuclear launches require the exact ready silo selected by the player
  console.log('\nTest 15: Nuclear Silo Selection And Readiness');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 2, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
        p2: { id: 'p2', username: 'P2', avatarUrl: '', health: 5, points: 3, x: 10, y: 10, isAlive: true, peaceVote: 'no' },
      },
      buildings: [
        { id: 'silo-a', type: 'silo', ownerId: 'p1', x: 5, y: 6, health: 1, isArmed: true, isSpent: false },
        { id: 'silo-b', type: 'silo', ownerId: 'p1', x: 5, y: 7, health: 1, isArmed: true, isSpent: false },
        { id: 'silo-unarmed', type: 'silo', ownerId: 'p1', x: 5, y: 8, health: 1, isArmed: false, isSpent: false },
      ],
    };

    const actions: ActionSubmission[] = [
      {
        id: 'a-nuke',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'launch_nuke', buildingId: 'silo-b', x: 10, y: 10, orderIndex: 0 },
      },
    ];

    const result = GameEngine.resolveRound(state, actions, 2005);
    assert(
      result.events.some((e) => e.type === 'nuke_launch'),
      'The exact selected ready silo must launch'
    );
    assert.strictEqual(
      result.nextStateData.buildings.some((b) => b.id === 'silo-b'),
      false,
      'The selected silo must be consumed'
    );
    assert(
      result.nextStateData.buildings.some((b) => b.id === 'silo-a'),
      'Other ready silos must remain untouched'
    );
    assert.strictEqual(result.nextStateData.players['p2'].health, 2, 'P2 takes 3 center damage');
    assert.strictEqual(result.nextStateData.players['p1'].points, 2, 'Launch costs 1 point, then round grant adds 1');

    const unselectedState: GameStateData = JSON.parse(JSON.stringify(state));
    unselectedState.players['p1'].points = 2;
    const unselectedActions: ActionSubmission[] = [
      {
        id: 'a-unselected',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'launch_nuke', x: 10, y: 10, orderIndex: 0 },
      },
    ];
    const unselectedResult = GameEngine.resolveRound(unselectedState, unselectedActions, 2006);
    assert(
      !unselectedResult.events.some((e) => e.type === 'nuke_launch'),
      'A generic launch command without a selected silo must not launch'
    );
    assert(
      unselectedResult.events.some((e) => e.type === 'cancelled'),
      'Launch without a selected silo must be cancelled'
    );
    assert.strictEqual(
      unselectedResult.nextStateData.buildings.length,
      state.buildings.length,
      'No silo should be consumed by a generic launch command'
    );
    assert.strictEqual(
      unselectedResult.nextStateData.players['p1'].points,
      3,
      'Cancelled launch spends no points'
    );
    console.log('  Passed: Nukes require the exact ready silo and consume only that silo.');
  }

  // Test 16: Point transfer partial execution spends only what is available
  console.log('\nTest 16: Partial Point Transfers');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 2, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
        p2: { id: 'p2', username: 'P2', avatarUrl: '', health: 3, points: 5, x: 6, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
    };

    const partial: ActionSubmission[] = [
      {
        id: 'a-send-partial',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 1,
        data: {
          actionType: 'send_points',
          targetPlayerId: 'p2',
          amount: 5,
          allowPartial: true,
          orderIndex: 0,
        },
      },
    ];

    const partialResult = GameEngine.resolveRound(state, partial, 3001);
    const sendEvent = partialResult.events.find((e) => e.type === 'send_points');
    assert(sendEvent, 'Partial transfer must execute');
    assert.strictEqual(sendEvent?.amount, 2, 'Partial transfer sends the remaining points');
    assert.strictEqual(sendEvent?.partial, true, 'Transfer is flagged as partial');
    assert.strictEqual(partialResult.nextStateData.players['p1'].points, 1, 'P1 spent both points then got +1');
    assert.strictEqual(partialResult.nextStateData.players['p2'].points, 8, 'P2 received 2 points plus the round grant');

    const strict: ActionSubmission[] = [
      {
        ...partial[0],
        id: 'a-send-strict',
        data: { ...partial[0].data, allowPartial: false },
      },
    ];
    const strictResult = GameEngine.resolveRound(state, strict, 3002);
    assert(
      !strictResult.events.some((e) => e.type === 'send_points'),
      'Unchecking partial must cancel an unaffordable transfer'
    );
    assert.strictEqual(strictResult.nextStateData.players['p1'].points, 3, 'Cancelled transfer spends no points');
    assert.strictEqual(strictResult.nextStateData.players['p2'].points, 6, 'P2 only receives the round grant');
    console.log('  Passed: Partial transfers scale down, strict transfers cancel.');
  }

  // Test 17: Lifetime mine limits include destroyed mines and grow over time
  console.log('\nTest 17: Lifetime Mine Limits');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 5, x: 5, y: 5, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
      minesPlaced: { p1: 2 },
    };

    const buildMine = (id: string, x: number, y: number, orderIndex: number): ActionSubmission => ({
      id,
      gameId: 'g1',
      day: 1,
      playerId: 'p1',
      priorityGroup: 3,
      data: { actionType: 'build', buildingType: 'mine', x, y, orderIndex },
    });

    // Day 9 limit is still 2. Both earlier mines are gone from the map, but
    // they still count because the lifetime total was persisted.
    const day9 = GameEngine.resolveRound(
      state,
      [buildMine('a-day9', 5, 6, 0)],
      3003,
      undefined,
      undefined,
      undefined,
      2,
      10,
      9
    );
    assert.strictEqual(day9.nextStateData.buildings.length, 0, 'No mine may be built at the Day 9 limit');
    assert(
      day9.events.some((e) => e.type === 'cancelled' && e.reason === 'Mine limit reached'),
      'Over-limit build must be cancelled'
    );
    assert.strictEqual(day9.nextStateData.minesPlaced?.['p1'], 2, 'Lifetime count is unchanged by a rejected build');

    // Day 10 raises the limit to 3, so exactly one of two queued mines succeeds.
    const day10 = GameEngine.resolveRound(
      state,
      [buildMine('a-day10-first', 5, 6, 0), buildMine('a-day10-second', 5, 4, 1)],
      3004,
      undefined,
      undefined,
      undefined,
      2,
      10,
      10
    );
    assert.strictEqual(
      day10.events.filter((e) => e.type === 'build' && e.buildingType === 'mine').length,
      1,
      'Day 10 must allow exactly one more mine'
    );
    assert.strictEqual(day10.nextStateData.minesPlaced?.['p1'], 3, 'Lifetime count increments only on success');
    assert.strictEqual(day10.nextStateData.players['p1'].points, 5, 'Only the successful mine costs a point');
    console.log('  Passed: Mine limits count removed mines and increase on schedule.');
  }

  // Test 18: Assassination ignores range and uses the configured fixed cost
  console.log('\nTest 18: Assassination');
  {
    const state: GameStateData = {
      prioritySeed: 12345,
      playerPriorityOrder: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', username: 'P1', avatarUrl: '', health: 3, points: 5, x: 1, y: 1, isAlive: true, peaceVote: 'no' },
        p2: { id: 'p2', username: 'P2', avatarUrl: '', health: 3, points: 0, x: 25, y: 25, isAlive: true, peaceVote: 'no' },
      },
      buildings: [],
    };

    const actions: ActionSubmission[] = [
      {
        id: 'a-assassinate',
        gameId: 'g1',
        day: 1,
        playerId: 'p1',
        priorityGroup: 5,
        data: { actionType: 'assassinate', targetPlayerId: 'p2', orderIndex: 0 },
      },
    ];

    // Default cost is 3 and the target is far outside any normal attack range.
    const result = GameEngine.resolveRound(state, actions, 3005, 25);
    assert(
      result.events.some((e) => e.type === 'attack' && e.targetPlayerId === 'p2'),
      'Assassination must execute regardless of distance'
    );
    assert.strictEqual(result.nextStateData.players['p2'].health, 2, 'Assassination deals 1 damage');
    assert.strictEqual(result.nextStateData.players['p1'].points, 3, 'Assassination costs 3 points then grants the round point');

    // Admin-configured cost is respected.
    const expensive = GameEngine.resolveRound(
      state,
      actions,
      3006,
      25,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      5
    );
    assert.strictEqual(expensive.nextStateData.players['p1'].points, 1, 'Configured cost of 5 is deducted');
    assert.strictEqual(expensive.nextStateData.players['p2'].health, 2, 'Damage is still 1');

    // Cost 0 disables the action entirely.
    const disabled = GameEngine.resolveRound(
      state,
      actions,
      3007,
      25,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      0
    );
    assert(
      !disabled.events.some((e) => e.type === 'attack'),
      'Disabled assassination must not deal damage'
    );
    assert(
      disabled.events.some((e) => e.type === 'cancelled'),
      'Disabled assassination must be cancelled'
    );
    assert.strictEqual(disabled.nextStateData.players['p2'].health, 3, 'Disabled assassination leaves health unchanged');
    assert.strictEqual(disabled.nextStateData.players['p1'].points, 6, 'Disabled assassination spends no points');

    // Unaffordable assassination is cancelled.
    const poorState: GameStateData = JSON.parse(JSON.stringify(state));
    poorState.players['p1'].points = 2;
    const poor = GameEngine.resolveRound(poorState, actions, 3008, 25);
    assert(
      !poor.events.some((e) => e.type === 'attack'),
      'Unaffordable assassination must not execute'
    );
    assert.strictEqual(poor.nextStateData.players['p2'].health, 3, 'Unaffordable assassination deals no damage');

    console.log('  Passed: Assassination ignores range, respects cost, and can be disabled.');
  }

  console.log('\nAll Game Engine tests passed successfully! [18/18]');
}

runTestSuite();
