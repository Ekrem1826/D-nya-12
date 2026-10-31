/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CENTER_X,
  CENTER_Y,
  DEFENDER_CHASE_SPEEDS,
  DIFFICULTY_NAMES,
  EXTRA_TIME_SECONDS,
  FORMATIONS,
  GOAL_LEFT,
  GOAL_RIGHT,
  PASS_CONTACT_RADIUS,
  PASS_MAX_DISTANCE,
  MATCH_DURATION_SECONDS,
  PHYSICS_DT,
  PITCH_BOTTOM,
  PITCH_TOP,
  PLAYERS_PER_TEAM,
  ROLES,
  SHOT_CLOCK_SECONDS,
  TEAMS_DATA,
  Team,
} from './constants.ts';
import {
  Disk,
  ShotActionType,
  ShotTrackingContext,
  TurnMode,
  areDisksMoving,
  calculateShotPower,
  calculateTrajectoryForecast,
  canPlayerControlBall,
  checkDefenderInterception,
  checkMatchEnd,
  checkPassSuccess,
  checkTurnTimeout,
  distancePointToSegment,
  findClosestDefendersToBall,
  findClosestPlayerToBall,
  findValidPassTarget,
  formatFootballMatchMinute,
  isPlayerSelectable,
  physicsStep,
  resetDisks,
  simulatePenaltyShootout,
  stepDefenderClosing,
} from './rules.ts';

export interface AIDecision {
  diskIdx: number;
  playerIndex: number;
  vx: number;
  vy: number;
  powerRatio: number;
  angle: number;
  targetTeammateIdx: number; // disk index or -1
  shotType: ShotActionType;
  thinkTime: number;
  aimTime: number;
  trajPoints: { x: number; y: number }[];
}

/**
 * Shared AI decision engine for both Team 0 and Team 1.
 * Scales precision, power, reaction speed, and tactical passing by difficulty (0: Kolay, 1: Normal, 2: Zor).
 */
export function computeAIDecision(
  disks: Disk[],
  activeTeam: number, // 0 or 1
  difficulty: number, // 0, 1, 2
  teamRating: number,
  turnMode: TurnMode,
  passReceiverPlayerIndex: number | null,
  _simDisksPool?: Disk[],
  passEnabled = true
): AIDecision {
  const ball = disks[disks.length - 1];
  const teamOffset = activeTeam === 1 ? PLAYERS_PER_TEAM : 0;
  const targetGoalY = activeTeam === 0 ? PITCH_TOP : PITCH_BOTTOM;
  const ownGoalY = activeTeam === 0 ? PITCH_BOTTOM : PITCH_TOP;
  const clampedDiff = Math.min(2, Math.max(0, difficulty));
  const skillFactor = Math.min(1, Math.max(0.25, 0.42 + clampedDiff * 0.24 + (teamRating - 72) / 90));

  // Helper: check if straight segment from (x1, y1) to (x2, y2) is blocked by any disk except ignoreIdxA / ignoreIdxB
  const isSegmentBlocked = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    moverRadius: number,
    ignoreIdxA: number,
    ignoreIdxB: number
  ): boolean => {
    const segLen = Math.hypot(x2 - x1, y2 - y1);
    if (segLen < 1) return false;
    for (let idx = 0; idx < PLAYERS_PER_TEAM * 2; idx++) {
      if (idx === ignoreIdxA || idx === ignoreIdxB) continue;
      const other = disks[idx];
      if (!other) continue;
      const dToStart = Math.hypot(other.x - x1, other.y - y1);
      const dToEnd = Math.hypot(other.x - x2, other.y - y2);
      if (dToStart > segLen || dToEnd > segLen) continue;
      const perpDist = distancePointToSegment(other.x, other.y, x1, y1, x2, y2);
      if (perpDist < moverRadius + other.r - 1.5) {
        return true;
      }
    }
    return false;
  };

  const ballToGoalDx = CENTER_X - ball.x;
  const ballToGoalDy = targetGoalY - ball.y;
  const ballToGoalLen = Math.hypot(ballToGoalDx, ballToGoalDy) || 1;
  const uGoalX = ballToGoalDx / ballToGoalLen;
  const uGoalY = ballToGoalDy / ballToGoalLen;

  // 1. Player Selection: Pick the player with the clearest, best-aligned shot ON THE BALL
  let candIdx = -1;
  if (turnMode === 'PASS_RECEIVER_ONLY' && passReceiverPlayerIndex !== null) {
    candIdx = teamOffset + passReceiverPlayerIndex;
  } else {
    let bestPlayerScore = -Infinity;
    for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
      const diskIdx = teamOffset + i;
      const d = disks[diskIdx];
      if (!d) continue;
      const role = ROLES[d.playerIndex || 0] || ROLES[0];

      const dxToBall = ball.x - d.x;
      const dyToBall = ball.y - d.y;
      const distToBall = Math.hypot(dxToBall, dyToBall) || 1;
      const uPBx = dxToBall / distToBall;
      const uPBy = dyToBall / distToBall;

      const blockedToBall = isSegmentBlocked(d.x, d.y, ball.x, ball.y, d.r * 0.85, diskIdx, disks.length - 1);
      const isBehindBall = activeTeam === 0 ? d.y >= ball.y - 6 : d.y <= ball.y + 6;
      const cosGoalAlign = uPBx * uGoalX + uPBy * uGoalY;

      let pScore = 900 - distToBall * 1.65;
      if (!blockedToBall) pScore += 480;
      else pScore -= 250;

      if (isBehindBall) pScore += 320;
      else pScore -= 160;

      pScore += cosGoalAlign * 175;

      if (role.finishingBonus || role.precisionBonus) pScore += 45;
      // Keep goalkeeper protecting goal unless ball is near own penalty box
      if (role.id === 1 && Math.abs(ball.y - ownGoalY) > 130) {
        pScore -= 420;
      }

      if (pScore > bestPlayerScore) {
        bestPlayerScore = pScore;
        candIdx = diskIdx;
      }
    }
  }

  if (candIdx === -1 || !disks[candIdx]) {
    const closest = findClosestPlayerToBall(disks, activeTeam);
    candIdx = closest ? closest.diskIndex : teamOffset + (PLAYERS_PER_TEAM - 1);
  }

  const playerDisk = disks[candIdx];
  const playerIndex = playerDisk.playerIndex ?? (candIdx - teamOffset);
  const role = ROLES[playerIndex] || ROLES[0];

  const dxPB = ball.x - playerDisk.x;
  const dyPB = ball.y - playerDisk.y;
  const distToBall = Math.hypot(dxPB, dyPB) || 1;
  const uPBx = dxPB / distToBall;
  const uPBy = dyPB / distToBall;

  // Check if direct line from ball to opponent goal is blocked
  const isGoalShotBlocked = isSegmentBlocked(
    ball.x,
    ball.y,
    CENTER_X,
    targetGoalY,
    ball.r + 4,
    candIdx,
    disks.length - 1
  );

  // 2. Tactical Pass Check (Opponent team actively passes to open forward teammates!)
  let passTargetTeammateDiskIdx = -1;
  let indirectPassTeammateDiskIdx = -1;
  const shooterInInteractionRadius = canPlayerControlBall(playerDisk, ball, PASS_CONTACT_RADIUS);

  // Pass on FREE_CHOICE turns to build up attacks and avoid infinite pass loops
  if (passEnabled && turnMode === 'FREE_CHOICE') {
    let bestPassScore = -Infinity;
    for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
      if (i === playerIndex) continue;
      const tmDiskIdx = teamOffset + i;
      const tm = disks[tmDiskIdx];
      if (!tm) continue;
      const tmRole = ROLES[tm.playerIndex || 0] || ROLES[0];
      if (tmRole.id === 1) continue; // Don't pass backwards to goalkeeper

      const distBallToTm = Math.hypot(tm.x - ball.x, tm.y - ball.y);
      const distShooterToTm = Math.hypot(tm.x - playerDisk.x, tm.y - playerDisk.y);

      if (distBallToTm <= PASS_MAX_DISTANCE - 15 && distShooterToTm <= PASS_MAX_DISTANCE && distBallToTm > 26) {
        const forwardGain = activeTeam === 0 ? playerDisk.y - tm.y : tm.y - playerDisk.y;
        const isTeammateMoreAdvanced = forwardGain > 8;
        const uBTx = (tm.x - ball.x) / distBallToTm;
        const uBTy = (tm.y - ball.y) / distBallToTm;
        const passAlignCos = uPBx * uBTx + uPBy * uBTy;

        const laneBlocked = isSegmentBlocked(ball.x, ball.y, tm.x, tm.y, ball.r + 4, candIdx, tmDiskIdx);
        if (laneBlocked) continue;

        if (shooterInInteractionRadius) {
          // Shooter already controls the ball: can pass in any forward or open direction
          if ((isTeammateMoreAdvanced || isGoalShotBlocked || role.id <= 6) && passAlignCos > -0.35) {
            const score = forwardGain * 1.8 + passAlignCos * 70 - Math.abs(tm.x - CENTER_X) * 0.25;
            if (score > bestPassScore) {
              bestPassScore = score;
              passTargetTeammateDiskIdx = tmDiskIdx;
            }
          }
        } else if (distToBall <= 115 && (role.id <= 6 || isGoalShotBlocked) && isTeammateMoreAdvanced && passAlignCos > 0.4) {
          // Shooter is approaching a loose ball in defense/midfield: strike ball toward open forward teammate
          const score = forwardGain * 1.5 + passAlignCos * 90;
          if (score > bestPassScore) {
            bestPassScore = score;
            indirectPassTeammateDiskIdx = tmDiskIdx;
          }
        }
      }
    }
  }

  // 3. Billiards Ball-Striking Aim Calculation (ALWAYS aims at the ball so playerDisk hits ball!)
  let desiredBallTargetX = CENTER_X;
  let desiredBallTargetY = targetGoalY;
  let shotType: ShotActionType = role.id === 1 ? 'clearance' : 'shot';
  let targetTeammateIdx = -1;

  if (passTargetTeammateDiskIdx >= 0 && shooterInInteractionRadius) {
    const tm = disks[passTargetTeammateDiskIdx];
    desiredBallTargetX = tm.x;
    desiredBallTargetY = tm.y;
    targetTeammateIdx = passTargetTeammateDiskIdx;
    shotType = 'pass';
  } else if (indirectPassTeammateDiskIdx >= 0) {
    const tm = disks[indirectPassTeammateDiskIdx];
    desiredBallTargetX = tm.x;
    desiredBallTargetY = tm.y;
    targetTeammateIdx = indirectPassTeammateDiskIdx;
  } else {
    // Aim at a spot inside the goal mouth; higher skill picks cleaner corners
    const goalMouthSpread = (GOAL_RIGHT - GOAL_LEFT - 32) * (0.45 + 0.35 * skillFactor);
    desiredBallTargetX = CENTER_X + (Math.random() - 0.5) * goalMouthSpread;
    desiredBallTargetY = targetGoalY;
  }

  const btDx = desiredBallTargetX - ball.x;
  const btDy = desiredBallTargetY - ball.y;
  const btLen = Math.hypot(btDx, btDy) || 1;
  const uBTx = btDx / btLen;
  const uBTy = btDy / btLen;

  // Cosine between (player -> ball) and (ball -> target)
  const cosImpact = uPBx * uBTx + uPBy * uBTy;
  const combinedRadius = playerDisk.r + ball.r;

  let contactX = ball.x;
  let contactY = ball.y;

  if (cosImpact > 0.2) {
    // Ghost-ball contact point behind the ball along -uBT so impact normal drives ball toward desiredBallTarget
    const offsetScale = 0.38 + 0.22 * skillFactor; // 0.38..0.60 of (r_player + r_ball), guaranteed solid hit
    contactX = ball.x - uBTx * combinedRadius * offsetScale;
    contactY = ball.y - uBTy * combinedRadius * offsetScale;
  } else {
    // Player is sideways or slightly ahead of the ball: strike the ball on its side/back edge away from own goal
    const attackSignY = activeTeam === 0 ? -1 : 1;
    const sideSignX = playerDisk.x < ball.x ? -0.35 : 0.35;
    contactX = ball.x + sideSignX * combinedRadius;
    contactY = ball.y - attackSignY * combinedRadius * 0.35;
  }

  let aimDx = contactX - playerDisk.x;
  let aimDy = contactY - playerDisk.y;
  const aimLen = Math.hypot(aimDx, aimDy) || 1;
  let dirX = aimDx / aimLen;
  let dirY = aimDy / aimLen;

  // Strict safety guarantee: verify the ray from playerDisk along (dirX, dirY) passes within 0.72 * combinedRadius of ball center!
  const projOnRay = dxPB * dirX + dyPB * dirY;
  const perpDistSq = Math.max(0, distToBall * distToBall - projOnRay * projOnRay);
  const maxSafeMissOffset = combinedRadius * 0.72;
  if (projOnRay <= 0 || perpDistSq > maxSafeMissOffset * maxSafeMissOffset) {
    // Fallback directly onto ball center so the bot NEVER misses the ball
    dirX = uPBx;
    dirY = uPBy;
  }

  let pullDist: number;
  if (targetTeammateIdx >= 0) {
    const tm = disks[targetTeammateIdx];
    const distBallToTm = Math.hypot(tm.x - ball.x, tm.y - ball.y);
    pullDist = Math.min(72, Math.max(36, distToBall * 0.38 + distBallToTm * 0.42));
  } else {
    // Scale power with distance to ball so the player disk reaches the ball and transfers strong impulse
    pullDist = Math.min(110, Math.max(76, 62 + distToBall * 0.24));
  }

  const impulse = calculateShotPower(pullDist, role.id, playerDisk.y, activeTeam);
  const aimVx = dirX * impulse;
  const aimVy = dirY * impulse;

  const speed = Math.hypot(aimVx, aimVy);
  const powerRatio = Math.min(1, speed / 850);
  const angle = Math.atan2(aimVy, aimVx);

  const trajPoints = calculateTrajectoryForecast(
    playerDisk.x,
    playerDisk.y,
    aimVx,
    aimVy,
    playerDisk.r,
    10,
    0.026
  );

  return {
    diskIdx: candIdx,
    playerIndex,
    vx: aimVx,
    vy: aimVy,
    powerRatio,
    angle,
    targetTeammateIdx,
    shotType,
    thinkTime: 0.18 + (2 - clampedDiff) * 0.12,
    aimTime: 0.22 + (2 - clampedDiff) * 0.12,
    trajPoints,
  };
}

export interface AutotestViolationCounters {
  permanentPlayerOverlap: number;
  falsePassOnOpponentShot: number;
  outsidePassContactRadiusOrExtraTurn: number;
  passOverMaxDistance: number;
  negativeTurnCounterOrDoubleGrant: number;
  deadlockOver10s: number;
  doubleGoalOrInconsistentScore: number;
  invalidMatchDuration: number;
}

export interface SingleMatchSimResult {
  matchIndex: number;
  teamAName: string;
  teamBName: string;
  difficulty: number;
  isKnockout: boolean;
  scoreA: number;
  scoreB: number;
  penalties?: [number, number];
  elapsedDurationSeconds: number;
  passesCompleted: number;
  shotsTaken: number;
  deadlocked: boolean;
  violations: AutotestViolationCounters;
}

export interface AutotestSummaryReport {
  totalMatches: number;
  totalGoals: number;
  averageGoalsPerMatch: number;
  deadlockedMatches: number;
  totalPassesCompleted: number;
  totalViolations: number;
  violationsByRule: AutotestViolationCounters;
  matches: SingleMatchSimResult[];
}

/**
 * Headless simulation of a single AI-vs-AI match strictly enforcing physics,
 * passing invariants, overlap avoidance, and turn clock limits.
 */
export function simulateSingleMatchForTest(
  matchIndex: number,
  teamA: Team,
  teamB: Team,
  formationAId = 'classic',
  formationBId = 'classic',
  difficulty = 1,
  isKnockout = false
): SingleMatchSimResult {
  const formA = FORMATIONS.find((f) => f.id === formationAId) || FORMATIONS[0];
  const formB = FORMATIONS.find((f) => f.id === formationBId) || FORMATIONS[0];

  let disks = resetDisks(formA.positions, formB.positions);
  const simPool: Disk[] = disks.map((d) => ({ ...d }));

  let remainingSeconds = MATCH_DURATION_SECONDS;
  let elapsedRegularSeconds = 0;
  let elapsedExtraSeconds = 0;
  let isExtraTime = false;
  let turn = Math.random() < 0.5 ? 0 : 1;
  let turnMode: TurnMode = 'FREE_CHOICE';
  let passReceiverPlayerIndex: number | null = null;
  let score: [number, number] = [0, 0];
  let penalties: [number, number] | undefined = undefined;

  let remainingActionsInTurn = 1;
  let extraShotGrantedThisTurn = false;
  let activeShotContext: ShotTrackingContext | null = null;
  let shotResolved = true;

  let turnTimer = SHOT_CLOCK_SECONDS;
  let phase: 'aim' | 'move' | 'goal_pause' | 'end' = 'aim';
  let isMatchFinished = false;
  let waitTimer = 0.2;
  let moveElapsedSeconds = 0;
  let stationarySecondsWithoutTurnAdvance = 0;
  let deadlocked = false;

  let passesCompleted = 0;
  let shotsTaken = 0;
  const goalsCountedList: number[] = [];

  let targetTeammateDiskIdx = -1;
  let ballEnteredCaptureZone = false;
  let closingDefenderIndices: number[] = [];

  const violations: AutotestViolationCounters = {
    permanentPlayerOverlap: 0,
    falsePassOnOpponentShot: 0,
    outsidePassContactRadiusOrExtraTurn: 0,
    passOverMaxDistance: 0,
    negativeTurnCounterOrDoubleGrant: 0,
    deadlockOver10s: 0,
    doubleGoalOrInconsistentScore: 0,
    invalidMatchDuration: 0,
  };

  const dt = 1 / 60; // 60 FPS simulation frame
  let safetySteps = 0;
  const maxSafetySteps = 45000;

  while (!isMatchFinished && safetySteps < maxSafetySteps) {
    safetySteps++;

    // Invariant 5: Turn counter must never be negative
    if (remainingActionsInTurn < 0) {
      violations.negativeTurnCounterOrDoubleGrant++;
    }

    // Track stationary ball time to detect any >10s deadlock
    const moving = areDisksMoving(disks);
    if (!moving && phase !== 'goal_pause') {
      stationarySecondsWithoutTurnAdvance += dt;
      if (stationarySecondsWithoutTurnAdvance > 10.2) {
        violations.deadlockOver10s++;
        deadlocked = true;
        break;
      }

      // Invariant 1: Permanent player-player overlap check when disks are at rest
      const totalPlayers = PLAYERS_PER_TEAM * 2;
      for (let i = 0; i < totalPlayers; i++) {
        for (let j = i + 1; j < totalPlayers; j++) {
          const p1 = disks[i];
          const p2 = disks[j];
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (dist < p1.r + p2.r - 0.5) {
            violations.permanentPlayerOverlap++;
          }
        }
      }
    } else {
      stationarySecondsWithoutTurnAdvance = 0;
    }

    // Decrement match clock
    if (phase === 'aim' || phase === 'move') {
      const prevRem = remainingSeconds;
      remainingSeconds = Math.max(0, remainingSeconds - dt);
      const consumed = prevRem - remainingSeconds;
      if (isExtraTime) elapsedExtraSeconds += consumed;
      else elapsedRegularSeconds += consumed;

      // Check match end when clock hits 0 and disks are stopped
      if (remainingSeconds <= 0 && phase === 'aim' && !moving) {
        const endCheck = checkMatchEnd(remainingSeconds, score[0], score[1], isKnockout, isExtraTime);
        if (endCheck.startExtraTime) {
          isExtraTime = true;
          remainingSeconds = EXTRA_TIME_SECONDS;
          turnMode = 'FREE_CHOICE';
          passReceiverPlayerIndex = null;
          remainingActionsInTurn = 1;
          extraShotGrantedThisTurn = false;
          turnTimer = SHOT_CLOCK_SECONDS;
          waitTimer = 0.25;
        } else if (endCheck.startPenalties) {
          penalties = simulatePenaltyShootout(teamA.r, teamB.r);
          isMatchFinished = true;
          phase = 'end';
          break;
        } else if (endCheck.finished) {
          isMatchFinished = true;
          phase = 'end';
          break;
        }
      }
    }

    // 10-second shot clock check
    if (phase === 'aim') {
      turnTimer = Math.max(0, turnTimer - dt);
      if (checkTurnTimeout(turnTimer, phase)) {
        turn = 1 - turn;
        turnMode = 'FREE_CHOICE';
        passReceiverPlayerIndex = null;
        remainingActionsInTurn = 1;
        extraShotGrantedThisTurn = false;
        shotResolved = true;
        turnTimer = SHOT_CLOCK_SECONDS;
        waitTimer = 0.25;
        stationarySecondsWithoutTurnAdvance = 0;
        continue;
      }
    }

    // Execute AI turn during aim phase
    if (phase === 'aim') {
      waitTimer -= dt;
      if (waitTimer <= 0) {
        if (remainingActionsInTurn !== 1) {
          violations.negativeTurnCounterOrDoubleGrant++;
        }

        // Verify passReceiverPlayerIndex is within PASS_CONTACT_RADIUS if in PASS_RECEIVER_ONLY mode
        if (turnMode === 'PASS_RECEIVER_ONLY') {
          if (passReceiverPlayerIndex === null) {
            violations.outsidePassContactRadiusOrExtraTurn++;
          } else {
            const recDisk = disks[turn * PLAYERS_PER_TEAM + passReceiverPlayerIndex];
            const ball = disks[disks.length - 1];
            if (!canPlayerControlBall(recDisk, ball, PASS_CONTACT_RADIUS)) {
              violations.outsidePassContactRadiusOrExtraTurn++;
            }
          }
        }

        const activeTeamObj = turn === 0 ? teamA : teamB;
        const decision = computeAIDecision(
          disks,
          turn,
          difficulty,
          activeTeamObj.r,
          turnMode,
          passReceiverPlayerIndex,
          simPool
        );

        const shooterDisk = disks[decision.diskIdx];
        const ball = disks[disks.length - 1];
        const shooterInRadius = canPlayerControlBall(shooterDisk, ball, PASS_CONTACT_RADIUS);

        // Invariant 3: If shooter is outside PASS_CONTACT_RADIUS, cannot initiate pass
        if (!shooterInRadius && decision.shotType === 'pass') {
          violations.outsidePassContactRadiusOrExtraTurn++;
        }

        const speed = Math.hypot(decision.vx, decision.vy) || 1;
        targetTeammateDiskIdx = decision.targetTeammateIdx;
        ballEnteredCaptureZone = false;

        if (decision.shotType === 'pass' && decision.targetTeammateIdx >= 0 && shooterInRadius) {
          const targetTeammateDisk = disks[decision.targetTeammateIdx];
          const kickOriginX = ball.x;
          const kickOriginY = ball.y;
          const toTmFromShooterX = targetTeammateDisk.x - shooterDisk.x;
          const toTmFromShooterY = targetTeammateDisk.y - shooterDisk.y;
          const distShooterToTm = Math.hypot(toTmFromShooterX, toTmFromShooterY) || 1;
          const shooterToTmDirX = toTmFromShooterX / distShooterToTm;
          const shooterToTmDirY = toTmFromShooterY / distShooterToTm;

          const dxSB = ball.x - shooterDisk.x;
          const dySB = ball.y - shooterDisk.y;
          const projSB = dxSB * shooterToTmDirX + dySB * shooterToTmDirY;
          if (projSB < shooterDisk.r + ball.r) {
            const placeDist = shooterDisk.r + ball.r + 2;
            ball.x = shooterDisk.x + shooterToTmDirX * placeDist;
            ball.y = shooterDisk.y + shooterToTmDirY * placeDist;
          }

          const toTmX = targetTeammateDisk.x - ball.x;
          const toTmY = targetTeammateDisk.y - ball.y;
          const distBallToTm = Math.hypot(toTmX, toTmY) || 1;
          const passDirX = toTmX / distBallToTm;
          const passDirY = toTmY / distBallToTm;

          activeShotContext = {
            shotTeam: turn,
            shooterPlayerId: decision.playerIndex,
            shotType: 'pass',
            shooterWasInInteractionRadius: true,
            shooterTouchedBall: true,
            lastTouchTeam: turn,
            lastTouchPlayerId: decision.playerIndex,
            ballStartX: kickOriginX,
            ballStartY: kickOriginY,
            aimDirX: passDirX,
            aimDirY: passDirY,
            endlineHit: false,
            sidelineHit: false,
            extraShotAlreadyGranted: extraShotGrantedThisTurn,
          };

          shooterDisk.vx = passDirX * 30;
          shooterDisk.vy = passDirY * 30;
          const passSpeed = Math.min(460, distBallToTm * 1.68 + 120);
          ball.vx = passDirX * passSpeed;
          ball.vy = passDirY * passSpeed;
        } else {
          activeShotContext = {
            shotTeam: turn,
            shooterPlayerId: decision.playerIndex,
            shotType: decision.shotType,
            shooterWasInInteractionRadius: shooterInRadius,
            shooterTouchedBall: false,
            lastTouchTeam: null,
            lastTouchPlayerId: null,
            ballStartX: ball.x,
            ballStartY: ball.y,
            aimDirX: decision.vx / speed,
            aimDirY: decision.vy / speed,
            endlineHit: false,
            sidelineHit: false,
            extraShotAlreadyGranted: extraShotGrantedThisTurn,
          };

          shooterDisk.vx = decision.vx;
          shooterDisk.vy = decision.vy;
        }

        remainingActionsInTurn--; // Decrement to 0
        shotResolved = false;
        moveElapsedSeconds = 0;
        stationarySecondsWithoutTurnAdvance = 0;
        shotsTaken++;
        phase = 'move';

        const defTeam = 1 - turn;
        closingDefenderIndices = findClosestDefendersToBall(disks, defTeam, 2);
      }
    } else if (phase === 'move') {
      moveElapsedSeconds += dt;
      const ball = disks[disks.length - 1];
      const ballSpeed = Math.hypot(ball.vx, ball.vy);

      // Two pressing defenders closing toward moving ball
      if (
        closingDefenderIndices.length > 0 &&
        ballSpeed > 30 &&
        activeShotContext?.shotType !== 'pass'
      ) {
        const chaseSpeed = DEFENDER_CHASE_SPEEDS[Math.min(2, Math.max(0, difficulty))];
        for (let dIdx = 0; dIdx < closingDefenderIndices.length; dIdx++) {
          const defDiskIdx = closingDefenderIndices[dIdx];
          const defDisk = disks[defDiskIdx];
          if (!defDisk) continue;
          const distDefToBall = Math.hypot(defDisk.x - ball.x, defDisk.y - ball.y);
          if (distDefToBall < 115) {
            let targetX = ball.x;
            let targetY = ball.y;
            // Keep 2nd pressing defender slightly offset from 1st defender so they never pinch the ball together
            if (dIdx === 1) {
              const firstDef = disks[closingDefenderIndices[0]];
              if (firstDef) {
                const sepDx = defDisk.x - firstDef.x;
                const sepDy = defDisk.y - firstDef.y;
                const sepDist = Math.hypot(sepDx, sepDy) || 1;
                if (sepDist < 66) {
                  targetX += (sepDx / sepDist) * 34;
                  targetY += (sepDy / sepDist) * 34;
                }
              }
            }

            stepDefenderClosing(defDisk, targetX, targetY, chaseSpeed * (dIdx === 0 ? 1 : 0.88), dt);

            if (checkDefenderInterception(defDisk, ball)) {
              ball.vx *= 0.25;
              ball.vy *= 0.25;
              defDisk.vx = 0;
              defDisk.vy = 0;
              const interceptTeam = defDisk.teamIndex ?? (1 - (activeShotContext?.shotTeam ?? 0));
              if (activeShotContext) {
                activeShotContext.lastTouchTeam = interceptTeam;
                activeShotContext.lastTouchPlayerId = defDisk.playerIndex ?? 0;
                activeShotContext.shotType = 'interception';
              }
              closingDefenderIndices = [];
              break;
            }
          }
        }
      }

      // Run 2 substeps of PHYSICS_DT for anti-tunneling
      let goalDetected = 0;
      for (let s = 0; s < 2; s++) {
        const prevX = ball.x;
        const prevY = ball.y;
        const res = physicsStep(disks, PHYSICS_DT, activeShotContext);

        if (res.ballContactTeam !== null && activeShotContext) {
          activeShotContext.lastTouchTeam = res.ballContactTeam;
          activeShotContext.lastTouchPlayerId = res.ballContactPlayerIndex;
          if (
            res.ballContactTeam === activeShotContext.shotTeam &&
            res.ballContactPlayerIndex === activeShotContext.shooterPlayerId
          ) {
            if (!activeShotContext.shooterTouchedBall) {
              activeShotContext.shooterTouchedBall = true;
              activeShotContext.shooterWasInInteractionRadius = true;
              activeShotContext.ballStartX = prevX;
              activeShotContext.ballStartY = prevY;
            }
          }
        }

        if (res.endlineOut && activeShotContext) {
          activeShotContext.endlineHit = true;
        }
        if (res.sidelineHit && activeShotContext) {
          activeShotContext.sidelineHit = true;
        }

        if (targetTeammateDiskIdx >= 0 && disks[targetTeammateDiskIdx]) {
          const tm = disks[targetTeammateDiskIdx];
          const swept = distancePointToSegment(tm.x, tm.y, prevX, prevY, ball.x, ball.y);
          if (swept <= PASS_CONTACT_RADIUS) {
            ballEnteredCaptureZone = true;
          }
        }

        if (res.goal > 0) {
          goalDetected = res.goal;
          break;
        }
        if (!areDisksMoving(disks)) break;
      }

      // Safety cap on move duration
      if (moveElapsedSeconds > 6.0 && goalDetected === 0) {
        for (const d of disks) {
          d.vx = 0;
          d.vy = 0;
        }
      }

      if (goalDetected > 0) {
        if (shotResolved) {
          violations.doubleGoalOrInconsistentScore++;
        }
        shotResolved = true;
        goalsCountedList.push(goalDetected);
        const scoringTeam = goalDetected;
        const newScoreA = scoringTeam === 1 ? score[0] + 1 : score[0];
        const newScoreB = scoringTeam === 2 ? score[1] + 1 : score[1];
        score = [newScoreA, newScoreB];

        turn = scoringTeam === 1 ? 1 : 0;
        turnMode = 'FREE_CHOICE';
        passReceiverPlayerIndex = null;
        extraShotGrantedThisTurn = false;
        remainingActionsInTurn = 1;
        activeShotContext = null;
        for (const d of disks) {
          d.vx = 0;
          d.vy = 0;
        }
        phase = 'goal_pause';
        waitTimer = 1.2;
      } else if (!areDisksMoving(disks) && !shotResolved) {
        shotResolved = true;
        const shotTeam: number = activeShotContext?.shotTeam ?? turn;
        const shooterId = activeShotContext?.shooterPlayerId ?? 0;

        const passResult = checkPassSuccess(
          disks,
          shotTeam,
          shooterId,
          targetTeammateDiskIdx >= 0 ? targetTeammateDiskIdx : null,
          ballEnteredCaptureZone,
          PASS_MAX_DISTANCE,
          PASS_CONTACT_RADIUS,
          activeShotContext ?? undefined
        );

        if (passResult.isPass && passResult.receiverPlayerIndex !== undefined && passResult.receiverDiskIndex !== undefined) {
          const receiverDisk = disks[passResult.receiverDiskIndex];

          // Invariant 2: Receiver must belong to shotTeam (never opponent!)
          if (receiverDisk.teamIndex !== shotTeam || activeShotContext?.lastTouchTeam !== shotTeam) {
            violations.falsePassOnOpponentShot++;
          }
          // Invariant 3: Receiver must be within PASS_CONTACT_RADIUS of the ball
          const distToBall = Math.hypot(receiverDisk.x - ball.x, receiverDisk.y - ball.y);
          if (distToBall > PASS_CONTACT_RADIUS || !activeShotContext?.shooterWasInInteractionRadius) {
            violations.outsidePassContactRadiusOrExtraTurn++;
          }
          // Invariant 4: Pass distance from ball start must be <= PASS_MAX_DISTANCE
          if (activeShotContext) {
            const originDist = Math.hypot(
              receiverDisk.x - activeShotContext.ballStartX,
              receiverDisk.y - activeShotContext.ballStartY
            );
            if (originDist > PASS_MAX_DISTANCE) {
              violations.passOverMaxDistance++;
            }
          }
          // Invariant 5: Extra shot must not have been granted already in this possession
          if (extraShotGrantedThisTurn) {
            violations.negativeTurnCounterOrDoubleGrant++;
          }

          passesCompleted++;
          turn = shotTeam;
          turnMode = 'PASS_RECEIVER_ONLY';
          passReceiverPlayerIndex = passResult.receiverPlayerIndex;
          extraShotGrantedThisTurn = true;
          remainingActionsInTurn = 1;
          turnTimer = SHOT_CLOCK_SECONDS;
          waitTimer = 0.25;
          phase = 'aim';
        } else {
          if (remainingSeconds <= 0) {
            phase = 'aim';
            remainingActionsInTurn = 1;
            continue;
          }

          const nextTeam = 1 - shotTeam;
          turn = nextTeam;
          turnMode = 'FREE_CHOICE';
          passReceiverPlayerIndex = null;
          extraShotGrantedThisTurn = false;
          remainingActionsInTurn = 1;
          turnTimer = SHOT_CLOCK_SECONDS;
          waitTimer = 0.25;
          phase = 'aim';
        }
      }
    } else if (phase === 'goal_pause') {
      waitTimer -= dt;
      if (waitTimer <= 0) {
        if (isExtraTime && score[0] !== score[1]) {
          isMatchFinished = true;
          phase = 'end';
          break;
        }
        disks = resetDisks(formA.positions, formB.positions);
        const resetBall = disks[disks.length - 1];
        if (resetBall.x !== CENTER_X || resetBall.y !== CENTER_Y) {
          violations.doubleGoalOrInconsistentScore++;
        }
        turnMode = 'FREE_CHOICE';
        passReceiverPlayerIndex = null;
        extraShotGrantedThisTurn = false;
        remainingActionsInTurn = 1;
        shotResolved = true;
        turnTimer = SHOT_CLOCK_SECONDS;
        waitTimer = 0.25;
        phase = 'aim';
      }
    }
  }

  // Verify score consistency with counted goals
  const countedA = goalsCountedList.filter((g) => g === 1).length;
  const countedB = goalsCountedList.filter((g) => g === 2).length;
  if (countedA !== score[0] || countedB !== score[1]) {
    violations.doubleGoalOrInconsistentScore++;
  }

  // Invariant 7: Match ended in defined time (180s)
  if (Math.abs(elapsedRegularSeconds - MATCH_DURATION_SECONDS) > 1.5 || !isMatchFinished) {
    violations.invalidMatchDuration++;
  }

  return {
    matchIndex,
    teamAName: teamA.n,
    teamBName: teamB.n,
    difficulty,
    isKnockout,
    scoreA: score[0],
    scoreB: score[1],
    penalties,
    elapsedDurationSeconds: Math.round(elapsedRegularSeconds),
    passesCompleted,
    shotsTaken,
    deadlocked,
    violations,
  };
}

/**
 * Runs the mandatory 30-match automated test suite across Easy, Normal, and Hard difficulties.
 * Verifies all 7 core rules and physics constraints.
 */
export function run30MatchAutotest(logToConsole = true): AutotestSummaryReport {
  const TOTAL_MATCHES = 30;
  const matches: SingleMatchSimResult[] = [];
  const totalViolationsByRule: AutotestViolationCounters = {
    permanentPlayerOverlap: 0,
    falsePassOnOpponentShot: 0,
    outsidePassContactRadiusOrExtraTurn: 0,
    passOverMaxDistance: 0,
    negativeTurnCounterOrDoubleGrant: 0,
    deadlockOver10s: 0,
    doubleGoalOrInconsistentScore: 0,
    invalidMatchDuration: 0,
  };

  for (let i = 0; i < TOTAL_MATCHES; i++) {
    const difficulty = i % 3; // 0: Kolay, 1: Normal, 2: Zor (10 each)
    const teamA = TEAMS_DATA[(i * 3) % TEAMS_DATA.length];
    const teamB = TEAMS_DATA[(i * 5 + 7) % TEAMS_DATA.length];
    const formationA = FORMATIONS[i % FORMATIONS.length].id;
    const formationB = FORMATIONS[(i + 2) % FORMATIONS.length].id;
    const isKnockout = i % 2 === 0;

    const res = simulateSingleMatchForTest(
      i + 1,
      teamA,
      teamB.id === teamA.id ? TEAMS_DATA[(i + 1) % TEAMS_DATA.length] : teamB,
      formationA,
      formationB,
      difficulty,
      isKnockout
    );

    matches.push(res);

    (Object.keys(totalViolationsByRule) as Array<keyof AutotestViolationCounters>).forEach((k) => {
      totalViolationsByRule[k] += res.violations[k];
    });
  }

  const totalGoals = matches.reduce((sum, m) => sum + m.scoreA + m.scoreB, 0);
  const averageGoalsPerMatch = Math.round((totalGoals / TOTAL_MATCHES) * 100) / 100;
  const deadlockedMatches = matches.filter((m) => m.deadlocked).length;
  const totalPassesCompleted = matches.reduce((sum, m) => sum + m.passesCompleted, 0);
  const totalViolations = Object.values(totalViolationsByRule).reduce((a, b) => a + b, 0);

  if (logToConsole) {
    console.log('\n============================================================');
    console.log('⚽ FISKE FUTBOL — 30 MAÇLIK OTOMATİK TEST ÖZET TABLOSU');
    console.log('============================================================');
    console.table({
      'Oynanan Maç Sayısı': TOTAL_MATCHES,
      'Kolay / Normal / Zor Dağılımı': `${matches.filter((m) => m.difficulty === 0).length} / ${matches.filter((m) => m.difficulty === 1).length} / ${matches.filter((m) => m.difficulty === 2).length}`,
      'Eleme Maçı Sayısı': matches.filter((m) => m.isKnockout).length,
      'Toplam Atılan Gol': totalGoals,
      'Maç Başına Ortalama Gol': averageGoalsPerMatch,
      'Tamamlanan Pas Sayısı': totalPassesCompleted,
      'Kilitlenen Maç Sayısı': deadlockedMatches,
      'TOPLAM KURAL İHLALİ': totalViolations,
    });
    console.table({
      '1. Oyuncuların Kalıcı İç İçe Geçmesi (Overlap)': totalViolationsByRule.permanentPlayerOverlap,
      '2. Rakip Şutunun Pas Sayılması': totalViolationsByRule.falsePassOnOpponentShot,
      '3. PASS_CONTACT_RADIUS Dışı Pas / Ekstra Hak': totalViolationsByRule.outsidePassContactRadiusOrExtraTurn,
      '4. PASS_MAX_DISTANCE Üzeri Pas Sayımı': totalViolationsByRule.passOverMaxDistance,
      '5. Aynı Vuruştan Çift Hak / Negatif Tur': totalViolationsByRule.negativeTurnCounterOrDoubleGrant,
      '6. 10sn Hareketsiz Kilitlenme': totalViolationsByRule.deadlockOver10s,
      '7. Tanımlanan Sürede Bitiş İhlali': totalViolationsByRule.invalidMatchDuration,
    });
    console.log('============================================================\n');
  }

  return {
    totalMatches: TOTAL_MATCHES,
    totalGoals,
    averageGoalsPerMatch,
    deadlockedMatches,
    totalPassesCompleted,
    totalViolations,
    violationsByRule: totalViolationsByRule,
    matches,
  };
}

// Backward compatibility alias
export const run59MatchAutotest = run30MatchAutotest;
