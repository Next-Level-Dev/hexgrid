## 1. Grid Coordinates & Player Range
- **Size**: Exactly 25 × 25 tiles.
- **Coordinate System**: 1-indexed integers, $X \in [1, 25]$ and $Y \in [1, 25]$. $(1, 1)$ is top-left, $(25, 25)$ is bottom-right.
- **Player Action Range (Attacking, Building, Sending Points)**:
  - 5 × 5 bounding box centered on player ($|dx| \le 2$ and $|dy| \le 2$).
  - **4 Corners Excluded**: $(\pm 2, \pm 2)$ cannot be reached.
  - **Own Square Excluded**: $(0, 0)$ cannot be acted upon.
  - **Total Accessible Squares**: Exactly 21 squares (or 20 external squares excluding self), forming a distinctive circular tactical perimeter.
  - Formally:
    $$\text{in\_range}(x_1, y_1, x_2, y_2) \iff |x_2 - x_1| \le 2 \land |y_2 - y_1| \le 2 \land \neg(|x_2 - x_1| = 2 \land |y_2 - y_1| = 2) \land (x_1 \ne x_2 \lor y_1 \ne y_2)$$

## 1.1 Initial Player Spawning Algorithm
- Players are randomly distributed on the 25 × 25 grid.
- **Outer 2 Layers Protected**: Players are NEVER spawned in the outermost 2 layers ($X \in [3, 23]$ and $Y \in [3, 23]$).
- **Separation Distance**: Players are never placed directly adjacent to each other ($\max(|x_1 - x_2|, |y_1 - y_2|) > 1$).

## 1.2 Ghost Positioning & Movement-Attack Dependency
- When players queue movement actions, they can see a translucent "ghost" of their future position and target actions within that projected circular range.
- If their movement is blocked at resolution time (e.g., by collision or obstacle), the player remains at their original square. If their planned attack falls out of range from their actual location, the attack is cancelled.
- Competing movement to the same square: Resolved by that round's deterministic player priority. The earlier player moves into the square; the subsequent player's move is cancelled.
- **Initial Health**: 3.
- **Maximum Health**: 3. Health cannot exceed 3 under any circumstance.
- **Points per Round**: Exactly +1 point awarded to every living player at the start of each new round (after processing).
- **Initial Starting Points**: 1 point on Day 1.
- **Dead Players**:
  - A player dies when their health reaches 0.
  - Deaths are immediately recorded in their persistent statistics (`stats.deaths += 1`).
  - Dead players are removed from the active map grid.
  - Dead players remain visible in the player leaderboard / list with a "DEAD" status.
  - Dead players cannot submit actions, move, attack, build, or vote. They can only observe.
  - Dead players are excluded from the World Peace quorum (only living players count).

---

## 3. Action Priority & Scheduling
Actions resolve globally in 5 strict priority tiers:
1. **Priority 1 — Send Points**: Sender transfers points to a target player within range.
2. **Priority 2 — Heal**: Player converts points to health.
3. **Priority 3 — Building & Bank Claim**: Constructing mines, outposts, silos, banks, or claiming a bank.
4. **Priority 4 — Movement**: Moving 1 tile (Up, Down, Left, Right). Competing moves to the same square resolved by player priority.
5. **Priority 5 — Attacks**: Targeted position attacks and nuclear silo launches.

### Player Priority Determinism
- Each round has a stored random integer `priority_seed`.
- The player priority list is derived by a deterministic pseudo-random shuffle (seeded mulberry32 PRNG) of active player IDs.
- The order is permanent for the round and does not mutate on reload or restart.
- Players with lower rank numbers act earlier within each action priority group.

---

## 4. Resource Deduction & Partial Execution
- Fixed-cost actions (Move: 1 pt, Mine: 1 pt, Outpost: 1 pt, Silo: 2 pts, Bank: 1 pt, Claim Bank: 1 pt):
  - Must be paid in full at execution time.
  - If player has fewer points than required, action is cancelled with 0 point deduction.
- Variable-amount actions (Send points, Heal, Attack):
  - If `allow_partial === true`:
    - If points $\ge$ requested amount: executes in full.
    - If $0 < \text{points} < \text{requested amount}$: player spends all remaining points, action amount scaled to points actually spent.
    - If points $= 0$: cancelled with 0 deduction.
  - If `allow_partial === false`:
    - Cancelled if points $<$ requested amount.

---

## 5. Action Ranges & Conversion Formulas
- **Heal**:
  - Cost: 1 point per 1 health restored.
  - Capped at maximum health (3). Any points allocated beyond $(3 - \text{current\_health})$ are not consumed or capped to needed amount.
- **Send Points**:
  - Range: Within 4 tiles (Chebyshev distance $\le 4$).
  - Target must be a living player.
- **Build**:
  - Range: Within 2 tiles of current player position (Chebyshev distance $\le 2$).
  - Cannot build on occupied tile (player or building).
- **Movement**:
  - Cost: 1 point.
  - Directions: Up $(0, -1)$, Down $(0, 1)$, Left $(-1, 0)$, Right $(1, 0)$.
  - Cannot move out of grid or into a tile occupied by another player or blocking building (Outpost, Bank, Silo).
  - Stepping on an enemy Mine triggers it immediately.
- **Attack**:
  - Range: Within 3 tiles (Chebyshev distance $\le 3$).
  - Damage Formula: 1 point = 1 direct damage to all entities occupying the targeted coordinate (players and buildings).
  - Attacks target the coordinate, not a player handle.

---

## 6. Buildings Lifecycle & Details
- **Mine**:
  - Cost: 1 pt. Health: 1.
  - Visibility: Hidden from other players (only owner sees it). In finished/over games, rendered transparently for everyone.
  - Collision: Does NOT block movement.
  - Trigger: When another player enters its tile, the mine detonates immediately: the entering player takes 1 damage, and the mine is consumed (removed). Plays explosion animation.
  - Can also be destroyed by attacks.
- **Outpost**:
  - Cost: 1 pt. Health: 2.
  - Blocks movement. Removed when health reaches 0.
- **Nuclear Silo**:
  - Cost: 2 pts. Health: 1.
  - Lifecycle: Built on Day D (unarmed). Arms automatically at start of Day D+1.
  - Launch Action: Once armed, owner can queue a Nuke Launch targeting ANY coordinate on the 25x25 map (unlimited range).
  - Launch Cost: 1 point.
  - Silo is consumed / spent upon firing.
  - Damage Area: 3 × 3 centered at target $(X, Y)$:
    - Center tile: 2 damage.
    - Surrounding 8 tiles: 1 damage each.
- **Bank**:
  - Cost: 1 pt. Health: 1.
  - Initial Value: 1 point.
  - Growth: Value increases by +1 each day transition at start of Open Phase (up to maximum 5).
  - Claim Action: Priority 3. Costs 1 pt. Owner receives the current bank value in points. The bank is consumed upon claiming.

---

## 7. Daily Schedule & UTC Transitions
- **Open Phase**: 00:00 UTC to 20:00 UTC (20 hours). Players view state, queue actions, update peace votes.
- **Closed Phase**: 20:00 UTC to 00:00 UTC (4 hours). Board hidden to normal players, actions processed atomically.
- **Admin Manual Override**:
  - For debugging, testing, and manual game management, administrators have an authorized API (`/api/admin/advance-round`) to trigger atomic round processing immediately.

---

## 8. Win Conditions
- **World Peace**: If all living players have set their vote to "yes" during the open phase:
  - Game ends with phase = 'over', winner = 'world_peace'.
  - All players receive $+1$ `games_played`.
  - All surviving living players receive $+1$ `world_peaces`.
- **Last Player Standing**: If only 1 living player remains alive:
  - Game ends with phase = 'over', winner = 'last_player_standing'.
  - Surviving player receives $+1$ `last_one_standings`.
  - All players receive $+1$ `games_played`.
