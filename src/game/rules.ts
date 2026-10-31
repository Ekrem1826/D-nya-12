/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PLAYER_RADIUS,
  BALL_RADIUS,
  MAX_BALL_SPEED,
  PASS_CONTACT_RADIUS,
  PASS_MAX_DISTANCE,
  BASE_RADIUS,
  ROLES,
  PlayerRole,
  PITCH_LEFT,
  PITCH_TOP,
  PITCH_RIGHT,
  PITCH_BOTTOM,
  GOAL_LEFT,
  GOAL_RIGHT,
  CENTER_X,
  CENTER_Y,
  PHYSICS_DT,
  MAX_PULL_DISTANCE,
  MATCH_DURATION_SECONDS,
  SHOT_CLOCK_SECONDS,
  FORMATIONS,
  PLAYERS_PER_TEAM,
  INTERACTION_RADIUS,
  PASS_DIRECTION_MIN_COS,
  PASS_AIM_LOCK_COS,
  PLAYER_CAPTURE_RADIUS,
  BALL_CONTROL_RADIUS,
  PASS_TARGET_MAX_DISTANCE,
  DEFENDER_CHASE_SPEEDS,
  POST_RADIUS,
  MIN_VELOCITY_THRESHOLD,
  MIN_VELOCITY_SQ,
} from './constants.ts';

export interface Disk {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  k: number; // friction drag coefficient
  f: number; // Math.exp(-k * DT)
  ball?: boolean;
  roleId?: number; // 1..7
  teamIndex?: number; // 0: User, 1: Bot
  playerIndex?: number; // 0..6
}

export const BALL_INDEX = PLAYERS_PER_TEAM * 2; // 14

export type ShotActionType = 'pass' | 'shot' | 'clearance' | 'interception';

export interface ShotTrackingContext {
  shotTeam: number; // 0 or 1
  shooterPlayerId: number; // 0..6
  shotType: ShotActionType;
  shooterWasInInteractionRadius: boolean;
  shooterTouchedBall: boolean;
  lastTouchTeam: number | null;
  lastTouchPlayerId: number | null;
  ballStartX: number;
  ballStartY: number;
  aimDirX: number;
  aimDirY: number;
  endlineHit: boolean;
  sidelineHit: boolean;
  extraShotAlreadyGranted: boolean;
  passDisabled?: boolean;
}

/**
 * Creates disk representation.
 */
export function createDisk(
  x: number,
  y: number,
  r: number,
  m: number,
  k: number,
  ball = false,
  roleId?: number,
  teamIndex?: number,
  playerIndex?: number
): Disk {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    r,
    m,
    k,
    f: Math.exp(-k * PHYSICS_DT),
    ball,
    roleId,
    teamIndex,
    playerIndex,
  };
}

/**
 * Resets the 15 disks on the field:
 * Disks 0..6: User's 7 players (bottom half with formationA)
 * Disks 7..13: Bot's 7 players (top half with formationB)
 * Disk 14: Ball (center)
 *
 * Executes an iterative relaxation solver so that NO players ever spawn overlapping,
 * and all players maintain a safe clearance from the center ball and boundaries.
 */
export function resetDisks(
  formationA: [number, number][] = FORMATIONS[0].positions,
  formationB: [number, number][] = FORMATIONS[0].positions
): Disk[] {
  const disks: Disk[] = [];
  const ballRadius = BALL_RADIUS;

  // 1. Initial placement from formation coordinates
  // Team 0 (User - bottom half)
  formationA.forEach((p, idx) => {
    const role = ROLES[idx] || ROLES[ROLES.length - 1];
    disks.push(
      createDisk(
        PITCH_LEFT + p[0],
        PITCH_TOP + p[1],
        role.radius,
        role.mass,
        2.50, // heavier ground friction for player disks
        false,
        role.id,
        0,
        idx
      )
    );
  });

  // Team 1 (Bot - top half, mirrored)
  formationB.forEach((p, idx) => {
    const role = ROLES[idx] || ROLES[ROLES.length - 1];
    disks.push(
      createDisk(
        PITCH_LEFT + p[0],
        PITCH_TOP + 680 - p[1],
        role.radius,
        role.mass,
        2.50,
        false,
        role.id,
        1,
        idx
      )
    );
  });

  // Disk 16: Ball (Exact center of pitch, balanced mass & friction)
  disks.push(createDisk(CENTER_X, CENTER_Y, ballRadius, 0.56, 1.68, true));

  // 2. Iterative spawn separation (24 relaxation passes)
  // Ensures 0 initial overlap between any two players, ball clearance, and pitch containment
  const totalPlayers = PLAYERS_PER_TEAM * 2;
  for (let iter = 0; iter < 24; iter++) {
    // A) Separate player pairs
    for (let i = 0; i < totalPlayers; i++) {
      for (let j = i + 1; j < totalPlayers; j++) {
        const p1 = disks[i];
        const p2 = disks[j];
        let dx = p2.x - p1.x;
        let dy = p2.y - p1.y;
        let dist = Math.hypot(dx, dy);
        const minDist = p1.r + p2.r + 3; // 3px safety margin

        if (dist < minDist) {
          if (dist < 0.001) {
            dx = 1;
            dy = 0;
            dist = 1;
          }
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          p1.x -= nx * overlap * 0.5;
          p1.y -= ny * overlap * 0.5;
          p2.x += nx * overlap * 0.5;
          p2.y += ny * overlap * 0.5;
        }
      }
    }

    // B) Clearance around center ball
    for (let i = 0; i < totalPlayers; i++) {
      const p = disks[i];
      let dx = p.x - CENTER_X;
      let dy = p.y - CENTER_Y;
      let dist = Math.hypot(dx, dy);
      const minBallClearance = p.r + ballRadius + 16; // safe distance from center circle

      if (dist < minBallClearance) {
        if (dist < 0.001) {
          dy = p.teamIndex === 0 ? 1 : -1;
          dx = 0;
          dist = 1;
        }
        const pushDirY = p.teamIndex === 0 ? 1 : -1;
        p.y = CENTER_Y + pushDirY * minBallClearance;
      }

      // C) Pitch boundary containment
      p.x = Math.max(PITCH_LEFT + p.r + 2, Math.min(PITCH_RIGHT - p.r - 2, p.x));
      p.y = Math.max(PITCH_TOP + p.r + 2, Math.min(PITCH_BOTTOM - p.r - 2, p.y));
    }
  }

  // Ensure ball is at exact center
  const ball = disks[disks.length - 1];
  ball.x = CENTER_X;
  ball.y = CENTER_Y;
  ball.vx = 0;
  ball.vy = 0;

  return disks;
}

export interface StepResult {
  goal: number; // 0: none, 1: team A goal (top net), 2: team B goal (bottom net)
  highestCollisionImpulse: number;
  ballContactRoleId: number | null;
  ballContactTeam: number | null;
  ballContactPlayerIndex: number | null;
  postHit: boolean;
  endlineOut: boolean;
  sidelineHit: boolean;
}

// 4 Goal posts (X, Y)
const GOAL_POSTS: [number, number][] = [
  [GOAL_LEFT, PITCH_TOP],
  [GOAL_RIGHT, PITCH_TOP],
  [GOAL_LEFT, PITCH_BOTTOM],
  [GOAL_RIGHT, PITCH_BOTTOM],
];

/**
 * 2D multi-body physics step with circle-circle rigid body collision,
 * position separation by inverse mass, momentum-conserving elastic impulses,
 * multi-iteration solver (8 iterations) to eliminate clipping/tunneling,
 * damping/friction, teammate first-touch ball trapping, and post/boundary constraints.
 */
export function physicsStep(
  disks: Disk[],
  dt = PHYSICS_DT,
  shotContext?: ShotTrackingContext | null
): StepResult {
  let goal = 0;
  let highestImpulse = 0;
  let ballContactRoleId: number | null = null;
  let ballContactTeam: number | null = null;
  let ballContactPlayerIndex: number | null = null;
  let postHit = false;
  let endlineOut = false;
  let sidelineHit = false;

  const ball = disks[disks.length - 1];

  // 1. Position Integration & Natural Deceleration (Damping / Friction)
  for (let i = 0; i < disks.length; i++) {
    const o = disks[i];
    if (o.vx === 0 && o.vy === 0) continue;

    o.x += o.vx * dt;
    o.y += o.vy * dt;

    // Time-independent exponential friction decay
    const f = dt === PHYSICS_DT ? o.f : Math.exp(-o.k * dt);
    const sp = Math.hypot(o.vx, o.vy);
    const minSpeedLoss = o.ball ? 19 : 45;
    const ns = Math.max(0, sp * f - minSpeedLoss * dt);

    if (ns < MIN_VELOCITY_THRESHOLD) {
      o.vx = 0;
      o.vy = 0;
    } else {
      o.vx *= ns / sp;
      o.vy *= ns / sp;
    }

    if (o.vx * o.vx + o.vy * o.vy < MIN_VELOCITY_SQ) {
      o.vx = 0;
      o.vy = 0;
    }
  }

  // 2. Multi-iteration constraint and collision solver (8 iterations per step)
  const SOLVER_ITERATIONS = 8;

  for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
    // 0) Anti-Pinch / Anti-Wedge Resolver on iteration 0:
    // If the ball is wedged/sandwiched between 2+ players, push the players apart and pop the ball out
    if (iter === 0 && ball) {
      const pinchingPlayers: { disk: Disk; dist: number }[] = [];
      for (let i = 0; i < disks.length - 1; i++) {
        const p = disks[i];
        if (p.ball) continue;
        const dist = Math.hypot(p.x - ball.x, p.y - ball.y);
        if (dist <= p.r + ball.r + 4.5) {
          pinchingPlayers.push({ disk: p, dist });
        }
      }
      if (pinchingPlayers.length >= 2) {
        pinchingPlayers.sort((a, b) => a.dist - b.dist);
        const p1 = pinchingPlayers[0].disk;
        const p2 = pinchingPlayers[1].disk;
        let dxP = p2.x - p1.x;
        let dyP = p2.y - p1.y;
        let distP = Math.hypot(dxP, dyP);
        if (distP < 0.001) {
          dxP = 1;
          dyP = 0;
          distP = 1;
        }
        const ux = dxP / distP;
        const uy = dyP / distP;
        const minSafePlayerGap = p1.r + p2.r + ball.r * 2 + 4;
        if (distP < minSafePlayerGap) {
          const push = (minSafePlayerGap - distP) * 0.5 + 2;
          p1.x = Math.max(PITCH_LEFT + p1.r, Math.min(PITCH_RIGHT - p1.r, p1.x - ux * push));
          p1.y = Math.max(PITCH_TOP + p1.r, Math.min(PITCH_BOTTOM - p1.r, p1.y - uy * push));
          p2.x = Math.max(PITCH_LEFT + p2.r, Math.min(PITCH_RIGHT - p2.r, p2.x + ux * push));
          p2.y = Math.max(PITCH_TOP + p2.r, Math.min(PITCH_BOTTOM - p2.r, p2.y + uy * push));

          // Escape normal pointing towards pitch center
          let escX = -uy;
          let escY = ux;
          if (escX * (CENTER_X - ball.x) + escY * (CENTER_Y - ball.y) < 0) {
            escX = -escX;
            escY = -escY;
          }
          ball.x = Math.max(PITCH_LEFT + ball.r, Math.min(PITCH_RIGHT - ball.r, ball.x + escX * 6));
          ball.y = Math.max(PITCH_TOP + ball.r, Math.min(PITCH_BOTTOM - ball.r, ball.y + escY * 6));
          if (Math.hypot(ball.vx, ball.vy) < 85) {
            ball.vx += escX * 85;
            ball.vy += escY * 85;
          }
        }
      }
    }

    // A) Circle-to-Circle Collision between ALL pairs (players and ball)
    for (let i = 0; i < disks.length; i++) {
      for (let j = i + 1; j < disks.length; j++) {
        const a = disks[i];
        const b = disks[j];

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;

        if (d2 < rr * rr) {
          let d = Math.sqrt(d2);
          if (d < 0.0001) {
            dx = 1;
            dy = 0;
            d = 1;
          }

          const nx = dx / d;
          const ny = dy / d;
          const overlap = rr - d;

          // Inverse mass based separation
          const imA = 1 / a.m;
          const imB = 1 / b.m;
          const imSum = imA + imB;

          // Position projection separation (proportional to inverse mass)
          const sepA = (overlap * imA) / imSum;
          const sepB = (overlap * imB) / imSum;

          a.x -= nx * sepA;
          a.y -= ny * sepA;
          b.x += nx * sepB;
          b.y += ny * sepB;

          // Momentum-conserving elastic impulse along normal
          const isBallCollision = Boolean(a.ball || b.ball);
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0 || isBallCollision) {
            if (vn < 0) {
              highestImpulse = Math.max(highestImpulse, -vn);
            }

            let eRest = isBallCollision ? 0.84 : 0.60;
            let isTeammatePassTrap = false;
            let wasFirstShooterStrike = false;

            // Role-based dynamics & Teammate Pass Trap when colliding with ball
            if (isBallCollision) {
              const playerDisk = a.ball ? b : a;
              if (playerDisk && playerDisk.roleId) {
                ballContactRoleId = playerDisk.roleId;
                ballContactTeam = playerDisk.teamIndex ?? null;
                ballContactPlayerIndex = playerDisk.playerIndex ?? null;

                if (shotContext) {
                  if (
                    playerDisk.teamIndex === shotContext.shotTeam &&
                    playerDisk.playerIndex === shotContext.shooterPlayerId
                  ) {
                    if (!shotContext.shooterTouchedBall) {
                      wasFirstShooterStrike = true;
                      shotContext.shooterTouchedBall = true;
                      shotContext.shooterWasInInteractionRadius = true;
                      shotContext.ballStartX = ball.x;
                      shotContext.ballStartY = ball.y;
                    }
                    shotContext.lastTouchTeam = playerDisk.teamIndex;
                    shotContext.lastTouchPlayerId = playerDisk.playerIndex ?? null;
                  } else {
                    shotContext.lastTouchTeam = playerDisk.teamIndex ?? null;
                    shotContext.lastTouchPlayerId = playerDisk.playerIndex ?? null;
                  }
                }

                // Check if this is a teammate receiving ANY ball kicked by the active shooter
                // (Only skip trapping if the teammate is inside the opponent's goal mouth and the ball is flying into the net)
                const isGoalLineTapIn =
                  ball.x > GOAL_LEFT - 8 &&
                  ball.x < GOAL_RIGHT + 8 &&
                  ((shotContext?.shotTeam === 0 && playerDisk.y < PITCH_TOP + 45 && ball.vy < -100) ||
                    (shotContext?.shotTeam === 1 && playerDisk.y > PITCH_BOTTOM - 45 && ball.vy > 100));

                const passDistFromStart = shotContext
                  ? Math.hypot(
                      playerDisk.x - shotContext.ballStartX,
                      playerDisk.y - shotContext.ballStartY
                    )
                  : 0;

                if (
                  shotContext &&
                  !shotContext.passDisabled &&
                  !shotContext.extraShotAlreadyGranted &&
                  !isGoalLineTapIn &&
                  passDistFromStart <= PASS_MAX_DISTANCE &&
                  playerDisk.teamIndex === shotContext.shotTeam &&
                  playerDisk.playerIndex !== shotContext.shooterPlayerId &&
                  shotContext.shooterTouchedBall &&
                  shotContext.lastTouchTeam === shotContext.shotTeam
                ) {
                  isTeammatePassTrap = true;
                  eRest = 0.0; // First-touch trap so the ball stays right at teammate's feet!
                } else {
                  const pRole = ROLES.find((r) => r.id === playerDisk.roleId);
                  if (pRole?.clearanceBonus) {
                    const isNearOwnGoal =
                      playerDisk.teamIndex === 0
                        ? playerDisk.y > 610
                        : playerDisk.y < 210;
                    eRest = isNearOwnGoal ? 1.18 : 1.02;
                  } else if (pRole?.blockBonus) {
                    eRest = 0.98;
                  } else if (pRole?.controlBonus) {
                    eRest = 0.78;
                  } else if (pRole?.finishingBonus) {
                    const inOffensiveHalf =
                      playerDisk.teamIndex === 0
                        ? playerDisk.y < CENTER_Y
                        : playerDisk.y > CENTER_Y;
                    if (inOffensiveHalf) {
                      eRest = 1.10;
                    }
                  }
                }
              }
            }

            if (vn < 0 && !isTeammatePassTrap) {
              const impulse = -((1 + eRest) * vn) / imSum;
              a.vx -= impulse * nx * imA;
              a.vy -= impulse * ny * imA;
              b.vx += impulse * nx * imB;
              b.vy += impulse * ny * imB;

              // Strike transfer & heavy shooter follow-through damping
              if (isBallCollision && ball) {
                const playerDisk = a.ball ? b : a;
                if (
                  shotContext &&
                  playerDisk?.teamIndex === shotContext.shotTeam &&
                  playerDisk?.playerIndex === shotContext.shooterPlayerId
                ) {
                  if (shotContext.shotType === 'shot' || shotContext.shotType === 'clearance') {
                    ball.vx *= 1.03;
                    ball.vy *= 1.03;
                  }
                  if (wasFirstShooterStrike) {
                    // Heavy stone feel: shooter transfers momentum into the ball and decelerates
                    playerDisk.vx *= 0.52;
                    playerDisk.vy *= 0.52;
                  }
                }
                const bSpd = Math.hypot(ball.vx, ball.vy);
                if (bSpd > MAX_BALL_SPEED) {
                  const scale = MAX_BALL_SPEED / bSpd;
                  ball.vx *= scale;
                  ball.vy *= scale;
                }
              }
            }

            // If teammate trapped a pass (or any shot going to a teammate), stop ball and receiver immediately
            if (isTeammatePassTrap) {
              const playerDisk = a.ball ? b : a;
              const dxTB = ball.x - playerDisk.x;
              const dyTB = ball.y - playerDisk.y;
              const lenTB = Math.hypot(dxTB, dyTB) || 1;
              const trapDist = playerDisk.r + ball.r + 2.0;
              ball.x = Math.max(
                PITCH_LEFT + ball.r,
                Math.min(PITCH_RIGHT - ball.r, playerDisk.x + (dxTB / lenTB) * trapDist)
              );
              ball.y = Math.max(
                PITCH_TOP + ball.r,
                Math.min(PITCH_BOTTOM - ball.r, playerDisk.y + (dyTB / lenTB) * trapDist)
              );
              ball.vx = 0;
              ball.vy = 0;
              playerDisk.vx = 0;
              playerDisk.vy = 0;
              if (shotContext) {
                shotContext.shotType = 'pass';
                const shooterOffset = shotContext.shotTeam === 1 ? PLAYERS_PER_TEAM : 0;
                const shooterDisk = disks[shooterOffset + shotContext.shooterPlayerId];
                if (shooterDisk) {
                  shooterDisk.vx *= 0.15;
                  shooterDisk.vy *= 0.15;
                }
              }
            }
          }
        }
      }
    }

    // B) Circular Goal Posts Collision for ALL disks (players cannot clip through posts)
    for (let i = 0; i < disks.length; i++) {
      const d = disks[i];
      for (const [px, py] of GOAL_POSTS) {
        const dx = d.x - px;
        const dy = d.y - py;
        const dist = Math.hypot(dx, dy);
        const minD = d.r + POST_RADIUS;

        if (dist < minD && dist > 0.0001) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minD - dist;

          d.x = px + nx * minD;
          d.y = py + ny * minD;

          const vn = d.vx * nx + d.vy * ny;
          if (vn < 0) {
            d.vx -= 1.7 * vn * nx;
            d.vy -= 1.7 * vn * ny;
            if (d.ball) {
              postHit = true;
              highestImpulse = Math.max(highestImpulse, -vn * 1.5);
            }
          }
        }
      }
    }

    // C) Pitch Boundary Constraints for ALL disks
    for (let i = 0; i < disks.length; i++) {
      const o = disks[i];
      const r = o.r;
      const e = o.ball ? 0.82 : 0.50;

      // Left & right sidelines
      if (o.x < PITCH_LEFT + r) {
        o.x = PITCH_LEFT + r;
        if (o.vx < 0) {
          o.vx = -o.vx * e;
          if (o.ball) sidelineHit = true;
        }
      } else if (o.x > PITCH_RIGHT - r) {
        o.x = PITCH_RIGHT - r;
        if (o.vx > 0) {
          o.vx = -o.vx * e;
          if (o.ball) sidelineHit = true;
        }
      }

      // Top & bottom goal mouth or endlines
      if (o.ball && o.x > GOAL_LEFT + 2 && o.x < GOAL_RIGHT - 2) {
        // Goal net entry
        if (o.y < PITCH_TOP) {
          goal = 1; // Team 0 scored into Team 1's goal
          if (o.y < PITCH_TOP - 32) {
            o.y = PITCH_TOP - 32;
            o.vy = Math.abs(o.vy) * 0.25;
          }
          if (o.x < GOAL_LEFT + r) {
            o.x = GOAL_LEFT + r;
            o.vx = Math.abs(o.vx) * 0.3;
          } else if (o.x > GOAL_RIGHT - r) {
            o.x = GOAL_RIGHT - r;
            o.vx = -Math.abs(o.vx) * 0.3;
          }
        } else if (o.y > PITCH_BOTTOM) {
          goal = 2; // Team 1 scored into Team 0's goal
          if (o.y > PITCH_BOTTOM + 32) {
            o.y = PITCH_BOTTOM + 32;
            o.vy = -Math.abs(o.vy) * 0.25;
          }
          if (o.x < GOAL_LEFT + r) {
            o.x = GOAL_LEFT + r;
            o.vx = Math.abs(o.vx) * 0.3;
          } else if (o.x > GOAL_RIGHT - r) {
            o.x = GOAL_RIGHT - r;
            o.vx = -Math.abs(o.vx) * 0.3;
          }
        }
      } else {
        // Normal endline bounce (cannot be pushed off pitch)
        if (o.y < PITCH_TOP + r) {
          o.y = PITCH_TOP + r;
          if (o.vy < 0) {
            o.vy = -o.vy * e;
            if (o.ball) endlineOut = true;
          }
        } else if (o.y > PITCH_BOTTOM - r) {
          o.y = PITCH_BOTTOM - r;
          if (o.vy > 0) {
            o.vy = -o.vy * e;
            if (o.ball) endlineOut = true;
          }
        }
      }
    }
  }

  // 3. Magnetic Pass Reception ("Snap-to-Control"):
  // Works for BOTH locked passes AND manual shots/kicks! Whenever a ball kicked by the active team
  // passes within a teammate's control zone, the teammate traps and controls the ball at their feet.
  if (
    goal === 0 &&
    ball &&
    shotContext &&
    !shotContext.passDisabled &&
    !shotContext.extraShotAlreadyGranted &&
    shotContext.shooterTouchedBall &&
    shotContext.lastTouchTeam === shotContext.shotTeam
  ) {
    const ballSpeed = Math.hypot(ball.vx, ball.vy);
    const isGoalMouthShot =
      ball.x > GOAL_LEFT - 10 &&
      ball.x < GOAL_RIGHT + 10 &&
      ((shotContext.shotTeam === 0 && ball.y < PITCH_TOP + 55 && ball.vy < -100) ||
        (shotContext.shotTeam === 1 && ball.y > PITCH_BOTTOM - 55 && ball.vy > 100));

    const travelFromStart = Math.hypot(
      ball.x - shotContext.ballStartX,
      ball.y - shotContext.ballStartY
    );

    if (
      !isGoalMouthShot &&
      travelFromStart >= 20 &&
      (shotContext.shotType === 'pass' || ballSpeed <= 520)
    ) {
      let bestTm: Disk | null = null;
      let bestTmDist = Infinity;
      let closestOppDist = Infinity;

      for (let i = 0; i < disks.length - 1; i++) {
        const d = disks[i];
        if (d.ball) continue;
        const dist = Math.hypot(d.x - ball.x, d.y - ball.y);
        if (d.teamIndex === shotContext.shotTeam) {
          if (d.playerIndex !== shotContext.shooterPlayerId) {
            const originDist = Math.hypot(
              d.x - shotContext.ballStartX,
              d.y - shotContext.ballStartY
            );
            const snapThreshold = Math.min(PASS_CONTACT_RADIUS - 2, d.r + ball.r + 22); // ~48-52px magnetic reception zone
            const dotMovement = (ball.x - d.x) * ball.vx + (ball.y - d.y) * ball.vy;
            const canTrapNow =
              shotContext.shotType === 'pass' ||
              ballSpeed <= 250 ||
              dist <= d.r + ball.r + 12 ||
              dotMovement >= -15;

            if (
              canTrapNow &&
              dist <= snapThreshold &&
              originDist <= PASS_MAX_DISTANCE &&
              dist < bestTmDist
            ) {
              bestTmDist = dist;
              bestTm = d;
            }
          }
        } else {
          if (dist < closestOppDist) {
            closestOppDist = dist;
          }
        }
      }

      if (bestTm && closestOppDist > bestTmDist + 4) {
        // Snap ball cleanly to the teammate's control range (just outside collision radius so 0 overlap)
        const dxTB = ball.x - bestTm.x;
        const dyTB = ball.y - bestTm.y;
        const lenTB = Math.hypot(dxTB, dyTB) || 1;
        const snapDist = bestTm.r + ball.r + 2.5;
        ball.x = Math.max(
          PITCH_LEFT + ball.r,
          Math.min(PITCH_RIGHT - ball.r, bestTm.x + (dxTB / lenTB) * snapDist)
        );
        ball.y = Math.max(
          PITCH_TOP + ball.r,
          Math.min(PITCH_BOTTOM - ball.r, bestTm.y + (dyTB / lenTB) * snapDist)
        );
        ball.vx = 0;
        ball.vy = 0;
        bestTm.vx = 0;
        bestTm.vy = 0;
        shotContext.shotType = 'pass';
        const shooterOffset = shotContext.shotTeam === 1 ? PLAYERS_PER_TEAM : 0;
        const shooterDisk = disks[shooterOffset + shotContext.shooterPlayerId];
        if (shooterDisk) {
          shooterDisk.vx *= 0.15;
          shooterDisk.vy *= 0.15;
        }
        ballContactRoleId = bestTm.roleId ?? null;
        ballContactTeam = bestTm.teamIndex ?? null;
        ballContactPlayerIndex = bestTm.playerIndex ?? null;
      }
    }
  }

  return {
    goal,
    highestCollisionImpulse: highestImpulse,
    ballContactRoleId,
    ballContactTeam,
    ballContactPlayerIndex,
    postHit,
    endlineOut,
    sidelineHit,
  };
}

/**
 * Checks if any disk has active velocity above threshold.
 */
export function areDisksMoving(disks: Disk[], minSpeedSq = MIN_VELOCITY_SQ): boolean {
  for (let i = 0; i < disks.length; i++) {
    const o = disks[i];
    if (o.vx * o.vx + o.vy * o.vy > minSpeedSq) return true;
  }
  return false;
}

export interface PassResult {
  isPass: boolean;
  receiverPlayerIndex?: number;
  receiverDiskIndex?: number;
  distance?: number;
  reason?:
    | 'success'
    | 'out_of_range'
    | 'intercepted_by_opponent'
    | 'no_ball'
    | 'not_captured'
    | 'wrong_touch_team'
    | 'shooter_not_in_radius'
    | 'wrong_angle'
    | 'out_of_bounds'
    | 'extra_shot_limit';
}

/**
 * Finds the closest player disk to the ball (optionally filtered by team).
 */
export function findClosestPlayerToBall(
  disks: Disk[],
  teamIndex?: number
): { diskIndex: number; playerIndex: number; teamIndex: number; distance: number } | null {
  const ball = disks[disks.length - 1];
  if (!ball || !ball.ball) return null;

  let minDist = Infinity;
  let bestDiskIdx = -1;
  let bestPlayerIdx = -1;
  let bestTeamIdx = -1;

  for (let i = 0; i < disks.length - 1; i++) {
    const d = disks[i];
    if (d.ball) continue;
    if (teamIndex !== undefined && d.teamIndex !== teamIndex) continue;

    const dist = Math.hypot(d.x - ball.x, d.y - ball.y);
    if (dist < minDist) {
      minDist = dist;
      bestDiskIdx = i;
      bestPlayerIdx = d.playerIndex ?? (i % PLAYERS_PER_TEAM);
      bestTeamIdx = d.teamIndex ?? 0;
    }
  }

  if (bestDiskIdx === -1) return null;
  return {
    diskIndex: bestDiskIdx,
    playerIndex: bestPlayerIdx,
    teamIndex: bestTeamIdx,
    distance: minDist,
  };
}

/**
 * Finds the top N closest outfield defenders on the specified team to press the ball.
 * Excludes the Goalkeeper (roleId === 1) so the keeper stays protecting the goal.
 */
export function findClosestDefendersToBall(
  disks: Disk[],
  teamIndex: number,
  count = 2
): number[] {
  const ball = disks[disks.length - 1];
  if (!ball || !ball.ball) return [];

  const candidates: { diskIndex: number; dist: number }[] = [];
  for (let i = 0; i < disks.length - 1; i++) {
    const d = disks[i];
    if (d.ball || d.teamIndex !== teamIndex) continue;
    if (d.roleId === 1) continue; // Keep goalkeeper in goal
    const dist = Math.hypot(d.x - ball.x, d.y - ball.y);
    candidates.push({ diskIndex: i, dist });
  }

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, count).map((c) => c.diskIndex);
}

/**
 * Determines whether a player disk is within PASS_CONTACT_RADIUS of the ball.
 * Distance is measured strictly from player center to ball center and compared
 * against PASS_CONTACT_RADIUS.
 * A player outside this radius cannot initiate a pass, receive a pass, control the ball,
 * or earn an extra shot.
 */
export function canPlayerControlBall(
  playerDisk: Disk,
  ballDisk: Disk,
  controlRadius = PASS_CONTACT_RADIUS
): boolean {
  if (!playerDisk || !ballDisk) return false;
  const dist = Math.hypot(playerDisk.x - ballDisk.x, playerDisk.y - ballDisk.y);
  const maxAllowedDist = Math.max(controlRadius, (playerDisk.r || PLAYER_RADIUS) * 3);
  return dist <= maxAllowedDist && dist <= controlRadius;
}

export type TurnMode = 'FREE_CHOICE' | 'PASS_RECEIVER_ONLY';

/**
 * Checks whether a player on the active team can be selected to shoot based on turnMode.
 * - In 'FREE_CHOICE': When a team gains the turn, the user can select ANY player on their team.
 *   The system does NOT force selecting only the closest player!
 * - In 'PASS_RECEIVER_ONLY': Only the designated receiver player (who must be within PASS_CONTACT_RADIUS) can shoot!
 */
export function isPlayerSelectable(
  playerIndex: number,
  turnMode: TurnMode,
  passReceiverPlayerIndex: number | null,
  disks?: Disk[],
  activeTeam?: number
): boolean {
  if (turnMode === 'PASS_RECEIVER_ONLY') {
    if (passReceiverPlayerIndex === null || playerIndex !== passReceiverPlayerIndex) {
      return false;
    }
    if (disks && activeTeam !== undefined) {
      const receiverDisk = disks[activeTeam * PLAYERS_PER_TEAM + passReceiverPlayerIndex];
      const ball = disks[disks.length - 1];
      if (!receiverDisk || !ball || !canPlayerControlBall(receiverDisk, ball, PASS_CONTACT_RADIUS)) {
        return false;
      }
    }
    return true;
  }
  // In FREE_CHOICE, user can select any player of their team
  return true;
}

/**
 * Calculates perpendicular distance from a point to a 2D line segment.
 */
export function distancePointToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x0, py - y0);
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
  const projX = x0 + t * dx;
  const projY = y0 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Finds a valid pass target teammate when aiming a flick.
 * Enforces:
 * 1. Shooter MUST be within PASS_CONTACT_RADIUS (or close enough to kick the ball).
 * 2. Teammate MUST be within PASS_MAX_DISTANCE of both the shooter and the ball.
 * 3. Teammate MUST be within the forward directional cone (dot >= PASS_DIRECTION_MIN_COS).
 */
export function findValidPassTarget(
  disks: Disk[],
  activeTeam: number,
  shooterPlayerIndex: number,
  aimDirX: number,
  aimDirY: number,
  maxPassDistance = PASS_MAX_DISTANCE,
  interactionRadius = PASS_CONTACT_RADIUS
): { playerIndex: number; diskIndex: number; distance: number } | null {
  const ball = disks[disks.length - 1];
  const teamOffset = activeTeam === 1 ? PLAYERS_PER_TEAM : 0;
  const shooterDisk = disks[teamOffset + shooterPlayerIndex];
  if (!ball || !shooterDisk) return null;

  const shooterToBallDist = Math.hypot(shooterDisk.x - ball.x, shooterDisk.y - ball.y);
  // Shooter must be within interactionRadius (or within strike range of the ball) to initiate a pass
  if (shooterToBallDist > Math.max(interactionRadius, 62)) {
    return null;
  }

  let bestTargetPlayerIdx = -1;
  let bestTargetDiskIdx = -1;
  let bestTargetDist = Infinity;
  let bestDot = PASS_AIM_LOCK_COS;

  for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
    if (i === shooterPlayerIndex) continue;
    const diskIdx = teamOffset + i;
    const tm = disks[diskIdx];
    if (!tm) continue;

    const distFromBall = Math.hypot(tm.x - ball.x, tm.y - ball.y);
    const distFromShooter = Math.hypot(tm.x - shooterDisk.x, tm.y - shooterDisk.y);

    // Teammate must be strictly within PASS_MAX_DISTANCE
    if (
      distFromBall <= maxPassDistance &&
      distFromShooter <= maxPassDistance &&
      distFromBall > 16
    ) {
      const vecFromShooterX = tm.x - shooterDisk.x;
      const vecFromShooterY = tm.y - shooterDisk.y;
      const vecShooterLen = Math.hypot(vecFromShooterX, vecFromShooterY);
      if (vecShooterLen < 1) continue;

      const dotShooter =
        (aimDirX * vecFromShooterX + aimDirY * vecFromShooterY) / vecShooterLen;

      // Perpendicular distance from teammate center to the user's aim ray
      const perpDist =
        vecShooterLen * Math.sqrt(Math.max(0, 1 - Math.min(1, dotShooter * dotShooter)));
      const maxLockRadius = (tm.r || PLAYER_RADIUS) + 14; // ~30px corridor around teammate

      if (dotShooter >= bestDot && perpDist <= maxLockRadius) {
        bestDot = dotShooter;
        bestTargetPlayerIdx = i;
        bestTargetDiskIdx = diskIdx;
        bestTargetDist = distFromBall;
      }
    }
  }

  if (bestTargetPlayerIdx === -1) return null;
  return {
    playerIndex: bestTargetPlayerIdx,
    diskIndex: bestTargetDiskIdx,
    distance: Math.round(bestTargetDist),
  };
}

/**
 * Evaluates whether a shot resulted in a successful pass to a teammate.
 * Strict conditions:
 * a) Ball last touched by teammate A: lastTouchTeam must be activeTeam (never opponent).
 * b) Ball entered or stopped in PASS_CONTACT_RADIUS of teammate B (measured player center to ball center).
 * c) Distance between A and B must NOT exceed PASS_MAX_DISTANCE.
 * d) Opponent last touch NEVER counts as pass.
 * e) No double extra turns from the same shot.
 */
export function checkPassSuccess(
  disks: Disk[],
  activeTeam: number,
  shooterPlayerIndex: number,
  targetTeammateDiskIndex: number | null = null,
  didBallEnterCaptureArea = false,
  maxDistance = PASS_MAX_DISTANCE,
  captureRadius = PASS_CONTACT_RADIUS,
  shotContext?: ShotTrackingContext
): PassResult {
  const ball = disks[disks.length - 1];
  if (!ball || !ball.ball) return { isPass: false, reason: 'no_ball' };

  // Legacy overload compatibility
  let resolvedTargetDiskIdx = targetTeammateDiskIndex;
  let resolvedMaxDistance = maxDistance;
  if (typeof targetTeammateDiskIndex === 'number' && targetTeammateDiskIndex >= disks.length) {
    resolvedMaxDistance = targetTeammateDiskIndex;
    resolvedTargetDiskIdx = null;
  }

  // Strict Context validation
  if (shotContext) {
    if (shotContext.passDisabled) {
      return { isPass: false, reason: 'not_captured' };
    }
    if (shotContext.extraShotAlreadyGranted) {
      return { isPass: false, reason: 'extra_shot_limit' };
    }
    // Condition d: Opponent shot/touch NEVER counts as pass
    if (shotContext.shotTeam !== activeTeam || shotContext.lastTouchTeam !== activeTeam) {
      return { isPass: false, reason: 'wrong_touch_team' };
    }
    // Condition a: Shooter A was in interaction range and touched the ball
    if (!shotContext.shooterWasInInteractionRadius || !shotContext.shooterTouchedBall) {
      return { isPass: false, reason: 'shooter_not_in_radius' };
    }
    if (shotContext.shotType === 'interception') {
      return { isPass: false, reason: 'wrong_touch_team' };
    }
  }

  const teamOffset = activeTeam === 1 ? PLAYERS_PER_TEAM : 0;
  const shooterDisk = disks[teamOffset + shooterPlayerIndex];

  let closestTeammateDist = Infinity;
  let closestTeammateDiskIdx = -1;
  let closestOpponentDist = Infinity;

  for (let i = 0; i < disks.length - 1; i++) {
    const d = disks[i];
    if (d.ball) continue;
    const distToBallCenter = Math.hypot(d.x - ball.x, d.y - ball.y);

    if (d.teamIndex === activeTeam) {
      if (d.playerIndex !== shooterPlayerIndex) {
        if (distToBallCenter < closestTeammateDist) {
          closestTeammateDist = distToBallCenter;
          closestTeammateDiskIdx = i;
        }
      }
    } else {
      if (distToBallCenter < closestOpponentDist) {
        closestOpponentDist = distToBallCenter;
      }
    }
  }

  const validateCandidateReceiver = (candDiskIdx: number): PassResult => {
    const receiver = disks[candDiskIdx];
    if (!receiver || receiver.teamIndex !== activeTeam || receiver.playerIndex === shooterPlayerIndex) {
      return { isPass: false, reason: 'not_captured' };
    }

    // Condition b: Distance measured from player center to ball center <= PASS_CONTACT_RADIUS
    const distToBall = Math.hypot(receiver.x - ball.x, receiver.y - ball.y);
    const maxAllowedBallDist = Math.max(captureRadius, (receiver.r || PLAYER_RADIUS) * 3);

    if (distToBall > maxAllowedBallDist || distToBall > PASS_CONTACT_RADIUS) {
      return {
        isPass: false,
        receiverPlayerIndex: receiver.playerIndex,
        distance: Math.round(distToBall),
        reason: 'not_captured',
      };
    }

    // Condition c: Distance from ball start point to receiver B must be <= PASS_MAX_DISTANCE
    if (shotContext) {
      const passOriginDist = Math.hypot(
        receiver.x - shotContext.ballStartX,
        receiver.y - shotContext.ballStartY
      );

      if (passOriginDist > resolvedMaxDistance) {
        return {
          isPass: false,
          receiverPlayerIndex: receiver.playerIndex,
          distance: Math.round(passOriginDist),
          reason: 'out_of_range',
        };
      }
    } else if (shooterDisk) {
      const distAtoB = Math.hypot(receiver.x - shooterDisk.x, receiver.y - shooterDisk.y);
      if (distAtoB > resolvedMaxDistance || distToBall > resolvedMaxDistance) {
        return {
          isPass: false,
          receiverPlayerIndex: receiver.playerIndex,
          distance: Math.round(distAtoB),
          reason: 'out_of_range',
        };
      }
    }

    // Opponent interception check: Opponent cannot be closer to ball than receiver
    if (closestOpponentDist <= distToBall) {
      return {
        isPass: false,
        receiverPlayerIndex: receiver.playerIndex,
        distance: Math.round(distToBall),
        reason: 'intercepted_by_opponent',
      };
    }

    return {
      isPass: true,
      receiverPlayerIndex: receiver.playerIndex,
      receiverDiskIndex: candDiskIdx,
      distance: Math.round(distToBall),
      reason: 'success',
    };
  };

  if (resolvedTargetDiskIdx !== null && disks[resolvedTargetDiskIdx]) {
    const targetedRes = validateCandidateReceiver(resolvedTargetDiskIdx);
    if (targetedRes.isPass || closestTeammateDiskIdx === -1 || closestTeammateDiskIdx === resolvedTargetDiskIdx) {
      return targetedRes;
    }
    // If targeted receiver wasn't the one who received the ball, check if another teammate captured it
    return validateCandidateReceiver(closestTeammateDiskIdx);
  }

  if (closestTeammateDiskIdx !== -1) {
    return validateCandidateReceiver(closestTeammateDiskIdx);
  }

  return { isPass: false, reason: 'out_of_range' };
}

/**
 * Smoothly advances a defending player disk towards the ball or intercept point without teleporting.
 * Constrains the defender to valid pitch bounds.
 */
export function stepDefenderClosing(
  defender: Disk,
  targetX: number,
  targetY: number,
  speedPxSec: number,
  dt: number
): void {
  const dx = targetX - defender.x;
  const dy = targetY - defender.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 1.0) return;

  const moveDist = Math.min(dist, speedPxSec * dt);
  defender.x += (dx / dist) * moveDist;
  defender.y += (dy / dist) * moveDist;

  // Pitch constraints
  defender.x = Math.max(PITCH_LEFT + defender.r, Math.min(PITCH_RIGHT - defender.r, defender.x));
  defender.y = Math.max(PITCH_TOP + defender.r, Math.min(PITCH_BOTTOM - defender.r, defender.y));
}

/**
 * Checks if the defending player disk made physical contact with the moving ball (interception).
 */
export function checkDefenderInterception(defender: Disk, ball: Disk): boolean {
  if (!defender || !ball) return false;
  const dx = ball.x - defender.x;
  const dy = ball.y - defender.y;
  const dist = Math.hypot(dx, dy);
  return dist <= defender.r + ball.r + 2.0;
}

/**
 * Computes a dotted trajectory forecast showing simulated path with side wall reflections.
 */
export function calculateTrajectoryForecast(
  startX: number,
  startY: number,
  vx: number,
  vy: number,
  radius = 10,
  maxPoints = 14,
  dt = 0.025
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let cx = startX;
  let cy = startY;
  let cvx = vx;
  let cvy = vy;

  for (let i = 0; i < maxPoints; i++) {
    cx += cvx * dt;
    cy += cvy * dt;
    cvx *= 0.96;
    cvy *= 0.96;

    // Pitch side wall bounce reflection
    if (cx < PITCH_LEFT + radius) {
      cx = PITCH_LEFT + radius;
      cvx = -cvx * 0.8;
    } else if (cx > PITCH_RIGHT - radius) {
      cx = PITCH_RIGHT - radius;
      cvx = -cvx * 0.8;
    }

    // Top/Bottom boundary limit
    if (cy < PITCH_TOP + radius) {
      cy = PITCH_TOP + radius;
      cvy = -cvy * 0.8;
    } else if (cy > PITCH_BOTTOM - radius) {
      cy = PITCH_BOTTOM - radius;
      cvy = -cvy * 0.8;
    }

    points.push({ x: cx, y: cy });
    if (cvx * cvx + cvy * cvy < 40) break;
  }

  return points;
}

export interface BallImpactPrediction {
  willHitBall: boolean;
  impactPlayerX: number;
  impactPlayerY: number;
  ballDirX: number;
  ballDirY: number;
  ballTrajectory: { x: number; y: number }[];
}

/**
 * Predicts whether a flicked player disk along (aimDirX, aimDirY) will hit the ball,
 * and computes the resulting outgoing ball direction vector and bounce trajectory.
 */
export function predictBallImpactDirection(
  playerDisk: Disk,
  ballDisk: Disk,
  aimDirX: number,
  aimDirY: number,
  pullRatio: number,
  isDirectKickOrPass = false,
  directDirX?: number,
  directDirY?: number
): BallImpactPrediction {
  const estBallSpeed = Math.min(MAX_BALL_SPEED, 190 + pullRatio * 460);

  if (isDirectKickOrPass) {
    const bDx = directDirX ?? aimDirX;
    const bDy = directDirY ?? aimDirY;
    const len = Math.hypot(bDx, bDy) || 1;
    const ux = bDx / len;
    const uy = bDy / len;
    return {
      willHitBall: true,
      impactPlayerX: ballDisk.x - ux * (playerDisk.r + ballDisk.r),
      impactPlayerY: ballDisk.y - uy * (playerDisk.r + ballDisk.r),
      ballDirX: ux,
      ballDirY: uy,
      ballTrajectory: calculateTrajectoryForecast(
        ballDisk.x,
        ballDisk.y,
        ux * estBallSpeed,
        uy * estBallSpeed,
        ballDisk.r,
        14,
        0.028
      ),
    };
  }

  const dx = ballDisk.x - playerDisk.x;
  const dy = ballDisk.y - playerDisk.y;
  const distToBall = Math.hypot(dx, dy);
  const combinedRadius = playerDisk.r + ballDisk.r;

  const proj = dx * aimDirX + dy * aimDirY;
  const perpDistSq = Math.max(0, distToBall * distToBall - proj * proj);
  const maxReachDist = 130 + pullRatio * 360;

  if (proj <= 0 || perpDistSq >= combinedRadius * combinedRadius) {
    return {
      willHitBall: false,
      impactPlayerX: playerDisk.x,
      impactPlayerY: playerDisk.y,
      ballDirX: aimDirX,
      ballDirY: aimDirY,
      ballTrajectory: [],
    };
  }

  const tImpact = Math.max(
    0,
    proj - Math.sqrt(Math.max(0, combinedRadius * combinedRadius - perpDistSq))
  );

  if (tImpact > maxReachDist) {
    return {
      willHitBall: false,
      impactPlayerX: playerDisk.x,
      impactPlayerY: playerDisk.y,
      ballDirX: aimDirX,
      ballDirY: aimDirY,
      ballTrajectory: [],
    };
  }

  const impactPlayerX = playerDisk.x + aimDirX * tImpact;
  const impactPlayerY = playerDisk.y + aimDirY * tImpact;
  const normX = ballDisk.x - impactPlayerX;
  const normY = ballDisk.y - impactPlayerY;
  const normLen = Math.hypot(normX, normY) || 1;
  const ballDirX = normX / normLen;
  const ballDirY = normY / normLen;

  return {
    willHitBall: true,
    impactPlayerX,
    impactPlayerY,
    ballDirX,
    ballDirY,
    ballTrajectory: calculateTrajectoryForecast(
      ballDisk.x,
      ballDisk.y,
      ballDirX * estBallSpeed,
      ballDirY * estBallSpeed,
      ballDisk.r,
      14,
      0.028
    ),
  };
}

/**
 * Calculates shot impulse based on pull length and player role.
 */
export function calculateShotPower(
  pullDistance: number,
  roleId: number,
  diskY: number,
  teamIndex: number
): number {
  const clampedPull = Math.min(pullDistance, MAX_PULL_DISTANCE);
  const baseImpulse = 110 + 710 * Math.pow(clampedPull / MAX_PULL_DISTANCE, 1.30);
  const role = ROLES.find((r) => r.id === roleId) || ROLES[4];

  let power = baseImpulse * role.powerMultiplier;

  // Forvet: Finishing power bonus in attacking half
  if (role.finishingBonus) {
    const isAttackingHalf =
      teamIndex === 0 ? diskY < CENTER_Y : diskY > CENTER_Y;
    if (isAttackingHalf) {
      power *= 1.2;
    }
  }

  // On Numara: Technique finesse bonus
  if (role.precisionBonus) {
    power *= 1.1;
  }

  return power;
}

/**
 * Formats time in seconds to mm:ss format.
 */
export function formatTimeMMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Converts real match seconds to simulated football match minute (0' to 90'+).
 */
export function formatFootballMatchMinute(
  remainingSeconds: number,
  totalSeconds = MATCH_DURATION_SECONDS,
  isExtraTime = false
): string {
  if (isExtraTime) {
    return 'Uzatma (Altın Gol)';
  }
  const elapsed = Math.max(0, totalSeconds - remainingSeconds);
  const minute = Math.min(90, Math.ceil((elapsed / totalSeconds) * 90));
  if (minute >= 90 && remainingSeconds <= 0) {
    return "90'+";
  }
  return `${Math.max(1, minute)}'`;
}

/**
 * Evaluates match end conditions.
 */
export function checkMatchEnd(
  remainingSeconds: number,
  scoreA: number,
  scoreB: number,
  isKnockout: boolean,
  isExtraTime: boolean
): { finished: boolean; startExtraTime: boolean; startPenalties: boolean } {
  if (remainingSeconds > 0) {
    return { finished: false, startExtraTime: false, startPenalties: false };
  }

  const isTied = scoreA === scoreB;

  if (!isKnockout) {
    return { finished: true, startExtraTime: false, startPenalties: false };
  }

  if (!isTied) {
    return { finished: true, startExtraTime: false, startPenalties: false };
  }

  if (!isExtraTime) {
    return { finished: false, startExtraTime: true, startPenalties: false };
  } else {
    return { finished: false, startExtraTime: false, startPenalties: true };
  }
}

/**
 * Evaluates whether the 10-second shot clock has expired.
 */
export function checkTurnTimeout(
  turnTimer: number,
  phase: string
): boolean {
  if (phase !== 'aim' && phase !== 'bot_thinking' && phase !== 'bot_aiming') {
    return false;
  }
  return turnTimer <= 0;
}

/**
 * Simulates a full penalty shootout between two teams.
 */
export function simulatePenaltyShootout(teamARating = 80, teamBRating = 80): [number, number] {
  let scoreA = 0;
  let scoreB = 0;
  const probA = Math.min(0.85, Math.max(0.55, 0.72 + (teamARating - teamBRating) * 0.005));
  const probB = Math.min(0.85, Math.max(0.55, 0.72 + (teamBRating - teamARating) * 0.005));

  for (let round = 0; round < 5; round++) {
    if (Math.random() < probA) scoreA++;
    const remA = 4 - round;
    const remB = 5 - round;
    if (scoreA > scoreB + remB || scoreB > scoreA + remA) break;

    if (Math.random() < probB) scoreB++;
    const remAfterB = 4 - round;
    if (scoreA > scoreB + remAfterB || scoreB > scoreA + remAfterB) break;
  }

  let suddenDeathSafety = 0;
  while (scoreA === scoreB && suddenDeathSafety < 25) {
    suddenDeathSafety++;
    const goalA = Math.random() < probA;
    const goalB = Math.random() < probB;
    if (goalA !== goalB) {
      if (goalA) scoreA++;
      else scoreB++;
    } else if (suddenDeathSafety === 25) {
      if (teamARating >= teamBRating) scoreA++;
      else scoreB++;
    }
  }

  return [scoreA, scoreB];
}
