/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_RADIUS,
  BALL_RADIUS,
  MAX_BALL_SPEED,
  PASS_CONTACT_RADIUS,
  PASS_MAX_DISTANCE,
  BASE_RADIUS,
  ROLES,
  MATCH_DURATION_SECONDS,
  SHOT_CLOCK_SECONDS,
  FORMATIONS,
  PLAYERS_PER_TEAM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PITCH_BOTTOM,
} from './constants.ts';
import {
  resetDisks,
  calculateShotPower,
  formatTimeMMSS,
  formatFootballMatchMinute,
  checkMatchEnd,
  physicsStep,
  checkPassSuccess,
  findClosestDefendersToBall,
  findClosestPlayerToBall,
  canPlayerControlBall,
  isPlayerSelectable,
  distancePointToSegment,
  stepDefenderClosing,
  checkDefenderInterception,
  calculateTrajectoryForecast,
  predictBallImpactDirection,
  checkTurnTimeout,
  ShotTrackingContext,
} from './rules.ts';
import { run30MatchAutotest } from './autotest.ts';

test('Each team has 8 players including 2 Stopers (total 17 disks with ball)', () => {
  assert.equal(PLAYERS_PER_TEAM, 8);
  const disks = resetDisks();
  assert.equal(disks.length, 17);

  // 8 User players
  for (let i = 0; i < 8; i++) {
    assert.equal(disks[i].teamIndex, 0);
    assert.equal(disks[i].playerIndex, i);
  }

  // 8 Bot players
  for (let i = 8; i < 16; i++) {
    assert.equal(disks[i].teamIndex, 1);
    assert.equal(disks[i].playerIndex, i - 8);
  }

  // Ball is disk 16
  assert.equal(disks[16].ball, true);
  assert.equal(disks[16].r, BALL_RADIUS);
  assert.equal(BALL_RADIUS, 8);
  assert.equal(disks[16].m, 0.56);
  assert.equal(disks[16].k, 1.68);
  assert.equal(disks[0].k, 2.50);

  // Verify balanced strong player shot power
  const strikerFullShot = calculateShotPower(110, 8, 250, 0);
  assert.ok(strikerFullShot > 1450 && strikerFullShot < 1650, `Expected balanced strong striker shot power (1450-1650), got ${strikerFullShot}`);
});

test('Tactical formations all contain exactly 8 player positions', () => {
  assert.equal(FORMATIONS.length, 5);
  FORMATIONS.forEach((f) => {
    assert.equal(f.positions.length, 8, `Formation ${f.name} should have 8 coordinates`);
  });
});

test('Pass detection succeeds when ball stops within PASS_CONTACT_RADIUS of a teammate within PASS_MAX_DISTANCE', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // Shooter was user player #7 (Forvet, index 7)
  // Position teammate #2 (Sol Stoper, index 1) within PASS_MAX_DISTANCE
  disks[7].x = 200;
  disks[7].y = 540;
  disks[1].x = 200;
  disks[1].y = 450;

  // Move ball within PASS_CONTACT_RADIUS (36px) of teammate #2 (even with Stoper radius 18.4 + ball 8 = 26.4px!)
  ball.x = disks[1].x + 26;
  ball.y = disks[1].y;

  const passResult = checkPassSuccess(disks, 0, 7, PASS_MAX_DISTANCE);
  assert.equal(passResult.isPass, true);
  assert.equal(passResult.receiverPlayerIndex, 1);
  assert.ok(passResult.distance !== undefined && passResult.distance <= PASS_CONTACT_RADIUS);
});

test('Pass detection fails if ball stops outside PASS_CONTACT_RADIUS from teammates', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // Place ball in isolated space far from all players
  ball.x = 250;
  ball.y = 410; // center circle, far from all players (> 50px)

  const passResult = checkPassSuccess(disks, 0, 7, PASS_MAX_DISTANCE);
  assert.equal(passResult.isPass, false);
});

test('Pass detection fails if opponent intercepts (closer to ball)', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // Teammate at (200, 450)
  disks[2].x = 200;
  disks[2].y = 450;

  // Ball at (200, 470) -> distance to teammate = 20px
  ball.x = 200;
  ball.y = 470;

  // Opponent placed right between at (200, 465) -> closer! (15px)
  disks[9].x = 200;
  disks[9].y = 465;

  const passResult = checkPassSuccess(disks, 0, 7, PASS_MAX_DISTANCE);
  assert.equal(passResult.isPass, false);
});

test('Match duration is configured to 3 minutes (180 seconds)', () => {
  assert.equal(MATCH_DURATION_SECONDS, 180);
  assert.equal(formatTimeMMSS(180), '03:00');
  assert.equal(formatTimeMMSS(90), '01:30');
});

test('All 8 roles have defined stats and attributes including 2 Stopers and #10 On Numara', () => {
  assert.equal(ROLES.length, 8);
  assert.equal(PLAYER_RADIUS, 19);
  assert.equal(PASS_CONTACT_RADIUS, 57);
  assert.equal(PASS_MAX_DISTANCE, 480);
  assert.equal(ROLES[0].name, 'Kaleci');
  assert.equal(ROLES[1].name, 'Sol Stoper');
  assert.equal(ROLES[2].name, 'Sağ Stoper');
  assert.equal(ROLES[3].name, 'Sol Bek');
  assert.equal(ROLES[4].name, 'Sağ Bek');
  assert.equal(ROLES[5].name, 'Ön Libero & Merkez');
  assert.equal(ROLES[6].name, 'On Numara');
  assert.equal(ROLES[6].number, 10);
  assert.equal(ROLES[7].name, 'Forvet');
});

test('Ball bounces off goal post and triggers postHit flag', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // Aim directly at top-left goal post (GOAL_LEFT = 180, PITCH_TOP = 70)
  ball.x = 180;
  ball.y = 81; // within collision distance (post r=5 + ball r=8 -> minD=13)
  ball.vx = 0;
  ball.vy = -180; // moving up towards post

  const result = physicsStep(disks, 1 / 120);
  assert.equal(result.postHit, true);
  assert.ok(ball.vy > 0, 'Ball velocity y should reverse on post impact');
});

test('Circle-circle collision between players: position separation and momentum transfer', () => {
  const disks = resetDisks();
  const p1 = disks[0]; // Kaleci
  const p2 = disks[1]; // Sol Stoper

  // Place player 1 directly moving towards player 2
  p1.x = 200;
  p1.y = 500;
  p1.vx = 0;
  p1.vy = -300; // moving upwards towards p2

  p2.x = 200;
  p2.y = 500 - (p1.r + p2.r - 4); // slightly overlapping
  p2.vx = 0;
  p2.vy = 0; // stationary

  // Run a physics step
  physicsStep(disks, 1 / 120);

  // 1. Position separation: disks must no longer overlap
  const postDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  assert.ok(postDist >= p1.r + p2.r - 0.1, 'Players must be separated and not overlap');

  // 2. Momentum transfer: p2 must receive upward velocity from p1
  assert.ok(p2.vy < 0, 'Stationary player must receive momentum and move upwards');
});

test('Spawn relaxation guarantees ZERO player-player overlap at kickoff', () => {
  const disks = resetDisks();
  const totalPlayers = PLAYERS_PER_TEAM * 2;
  for (let i = 0; i < totalPlayers; i++) {
    for (let j = i + 1; j < totalPlayers; j++) {
      const p1 = disks[i];
      const p2 = disks[j];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      assert.ok(
        dist >= p1.r + p2.r,
        `Spawn overlap detected between player #${i} and #${j}: dist=${dist.toFixed(1)}, min=${p1.r + p2.r}`
      );
    }
  }
});

test('Opponent shot or deflection NEVER counts as a pass for the other team', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // Teammate at (200, 500)
  disks[1].x = 200;
  disks[1].y = 500;

  // Ball stops within PASS_CONTACT_RADIUS of User player #2 (index 1)
  ball.x = disks[1].x + 18;
  ball.y = disks[1].y;

  // Context: Opponent (team 1) took the shot, but ball landed near team 0
  const opponentShotCtx: ShotTrackingContext = {
    shotTeam: 1,
    shooterPlayerId: 7,
    shotType: 'shot',
    shooterWasInInteractionRadius: true,
    shooterTouchedBall: true,
    lastTouchTeam: 1,
    lastTouchPlayerId: 7,
    ballStartX: 250,
    ballStartY: 350,
    aimDirX: 0,
    aimDirY: 1,
    endlineHit: false,
    sidelineHit: false,
    extraShotAlreadyGranted: false,
  };

  // Must NOT be a pass for Team 0 (it was opponent shot!)
  const resForTeam0 = checkPassSuccess(disks, 0, 7, null, false, PASS_MAX_DISTANCE, PASS_CONTACT_RADIUS, opponentShotCtx);
  assert.equal(resForTeam0.isPass, false);
  assert.equal(resForTeam0.reason, 'wrong_touch_team');
});

test('Pass outside PASS_CONTACT_RADIUS cannot be received or award extra turn', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // Move all teammates far away, then place Shooter at (200, 520), ball at (200, 505), and Teammate #2 68px away (> PASS_CONTACT_RADIUS = 57px)
  for (let i = 0; i < 8; i++) {
    disks[i].x = 80;
    disks[i].y = 660;
  }
  disks[7].x = 200;
  disks[7].y = 520;
  ball.x = 200;
  ball.y = 505;
  disks[1].x = 200;
  disks[1].y = 437;

  const shotCtx: ShotTrackingContext = {
    shotTeam: 0,
    shooterPlayerId: 7,
    shotType: 'pass',
    shooterWasInInteractionRadius: true,
    shooterTouchedBall: true,
    lastTouchTeam: 0,
    lastTouchPlayerId: 7,
    ballStartX: 200,
    ballStartY: 520,
    aimDirX: 0,
    aimDirY: -1,
    endlineHit: false,
    sidelineHit: false,
    extraShotAlreadyGranted: false,
  };

  const res = checkPassSuccess(disks, 0, 7, 1, false, PASS_MAX_DISTANCE, PASS_CONTACT_RADIUS, shotCtx);
  assert.equal(res.isPass, false);
  assert.equal(res.reason, 'not_captured');
});

test('Pass over PASS_MAX_DISTANCE fails', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // Teammate is 510px away (> PASS_MAX_DISTANCE = 480px)
  disks[7].x = 200;
  disks[7].y = 680;
  disks[1].x = 200;
  disks[1].y = 170;
  ball.x = 200;
  ball.y = 170; // ball is at teammate, but travel was 510px!

  const shotCtx: ShotTrackingContext = {
    shotTeam: 0,
    shooterPlayerId: 7,
    shotType: 'pass',
    shooterWasInInteractionRadius: true,
    shooterTouchedBall: true,
    lastTouchTeam: 0,
    lastTouchPlayerId: 7,
    ballStartX: 200,
    ballStartY: 680, // dist = 510px
    aimDirX: 0,
    aimDirY: -1,
    endlineHit: false,
    sidelineHit: false,
    extraShotAlreadyGranted: false,
  };

  const res = checkPassSuccess(disks, 0, 7, 1, false, PASS_MAX_DISTANCE, PASS_CONTACT_RADIUS, shotCtx);
  assert.equal(res.isPass, false);
  assert.equal(res.reason, 'out_of_range');
});

test('Manual shot (shotType = shot, without pre-selecting pass target) that reaches a teammate traps and counts as a pass', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // Shooter (#5, index 5) hits the ball forward toward Teammate (#10, index 6) without locking onto a pass target
  disks[5].x = 250;
  disks[5].y = 560;
  disks[6].x = 250;
  disks[6].y = 445;
  disks[6].vx = 0;
  disks[6].vy = 0;

  // Ball is moving fast (420 px/s) from a manual shot right into Teammate #10's control zone
  ball.x = 266;
  ball.y = 445;
  ball.vx = 0;
  ball.vy = -420;

  const manualShotCtx: ShotTrackingContext = {
    shotTeam: 0,
    shooterPlayerId: 5,
    shotType: 'shot', // NOT pre-selected as 'pass'!
    shooterWasInInteractionRadius: true,
    shooterTouchedBall: true,
    lastTouchTeam: 0,
    lastTouchPlayerId: 5,
    ballStartX: 250,
    ballStartY: 540,
    aimDirX: 0,
    aimDirY: -1,
    endlineHit: false,
    sidelineHit: false,
    extraShotAlreadyGranted: false,
  };

  physicsStep(disks, 1 / 120, manualShotCtx);

  assert.equal(ball.vx, 0, 'Teammate must trap the ball even when shotType started as shot');
  assert.equal(ball.vy, 0, 'Teammate must trap the ball even when shotType started as shot');

  const res = checkPassSuccess(disks, 0, 5, null, false, PASS_MAX_DISTANCE, PASS_CONTACT_RADIUS, manualShotCtx);
  assert.equal(res.isPass, true, 'Manual shot reaching a teammate must register as a completed pass');
  assert.equal(res.receiverPlayerIndex, 6);
});

test('Consecutive 2nd pass in a chain succeeds and aiming at goal does not hijack shot into a pass', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // Player A (#5, idx 5) at (250, 560), Player B (#10, idx 6) at (250, 440), Player C (#7, idx 7) at (250, 320)
  disks[5].x = 250;
  disks[5].y = 560;
  disks[6].x = 250;
  disks[6].y = 440;
  disks[7].x = 250;
  disks[7].y = 320;

  // 1st Pass: Player A -> Player B
  ball.x = 250;
  ball.y = 460; // within 20px of Player B (PASS_CONTACT_RADIUS = 36px)
  const pass1Ctx: ShotTrackingContext = {
    shotTeam: 0,
    shooterPlayerId: 5,
    shotType: 'pass',
    shooterWasInInteractionRadius: true,
    shooterTouchedBall: true,
    lastTouchTeam: 0,
    lastTouchPlayerId: 5,
    ballStartX: 250,
    ballStartY: 540,
    aimDirX: 0,
    aimDirY: -1,
    endlineHit: false,
    sidelineHit: false,
    extraShotAlreadyGranted: false,
  };
  const res1 = checkPassSuccess(disks, 0, 5, 6, true, PASS_MAX_DISTANCE, PASS_CONTACT_RADIUS, pass1Ctx);
  assert.equal(res1.isPass, true);
  assert.equal(res1.receiverPlayerIndex, 6);

  // 2nd Pass: Player B -> Player C (new flick has extraShotAlreadyGranted: false)
  ball.x = 250;
  ball.y = 342; // within 22px of Player C
  const pass2Ctx: ShotTrackingContext = {
    shotTeam: 0,
    shooterPlayerId: 6,
    shotType: 'pass',
    shooterWasInInteractionRadius: true,
    shooterTouchedBall: true,
    lastTouchTeam: 0,
    lastTouchPlayerId: 6,
    ballStartX: 250,
    ballStartY: 460,
    aimDirX: 0,
    aimDirY: -1,
    endlineHit: false,
    sidelineHit: false,
    extraShotAlreadyGranted: false,
  };
  const res2 = checkPassSuccess(disks, 0, 6, 7, true, PASS_MAX_DISTANCE, PASS_CONTACT_RADIUS, pass2Ctx);
  assert.equal(res2.isPass, true);
  assert.equal(res2.receiverPlayerIndex, 7);
});

test('Magnetic Pass Reception (Snap-to-Control), Anti-Pinch Ball De-Wedging, and 2 Pressing Defenders', () => {
  const disks = resetDisks();
  const ball = disks[disks.length - 1];

  // 1. Two pressing defenders returned by findClosestDefendersToBall
  const twoDefenders = findClosestDefendersToBall(disks, 1, 2);
  assert.equal(twoDefenders.length, 2, 'Must return 2 closest outfield pressing defenders');
  assert.notEqual(twoDefenders[0], twoDefenders[1], 'Two pressing defenders must be distinct players');

  // 2. Magnetic Pass Reception ("Snap-to-Control"):
  // Shooter (index 5) passes near teammate (index 6 at x=250, y=420).
  // Ball travels along x=282 (32px sideways from teammate center — outside direct collision radius 26px,
  // but inside magnetic control range <= 44px) and snaps cleanly to teammate control!
  disks[5].x = 282;
  disks[5].y = 540;
  disks[6].x = 250;
  disks[6].y = 420;
  disks[6].vx = 0;
  disks[6].vy = 0;

  ball.x = 282;
  ball.y = 425;
  ball.vx = 0;
  ball.vy = -240;

  const snapCtx: ShotTrackingContext = {
    shotTeam: 0,
    shooterPlayerId: 5,
    shotType: 'pass',
    shooterWasInInteractionRadius: true,
    shooterTouchedBall: true,
    lastTouchTeam: 0,
    lastTouchPlayerId: 5,
    ballStartX: 282,
    ballStartY: 520,
    aimDirX: 0,
    aimDirY: -1,
    endlineHit: false,
    sidelineHit: false,
    extraShotAlreadyGranted: false,
  };

  physicsStep(disks, 1 / 120, snapCtx);

  const distAfterSnap = Math.hypot(ball.x - disks[6].x, ball.y - disks[6].y);
  assert.ok(
    distAfterSnap <= PASS_CONTACT_RADIUS,
    `Ball should snap into teammate control range, got dist=${distAfterSnap}`
  );
  assert.equal(ball.vx, 0, 'Snapped ball should stop cleanly at receiver feet');
  assert.equal(ball.vy, 0, 'Snapped ball should stop cleanly at receiver feet');

  const snapPassRes = checkPassSuccess(disks, 0, 5, null, false, PASS_MAX_DISTANCE, PASS_CONTACT_RADIUS, snapCtx);
  assert.equal(snapPassRes.isPass, true, 'Snapped ball must be recognized as a completed pass');
  assert.equal(snapPassRes.receiverPlayerIndex, 6);

  // 3. Anti-Pinch / Anti-Wedge Resolver:
  // Place two opponent players sandwiching the ball at rest
  const opp1 = disks[PLAYERS_PER_TEAM + 2];
  const opp2 = disks[PLAYERS_PER_TEAM + 3];
  ball.x = 250;
  ball.y = 300;
  ball.vx = 0;
  ball.vy = 0;
  opp1.x = 250 - (opp1.r + ball.r);
  opp1.y = 300;
  opp2.x = 250 + (opp2.r + ball.r);
  opp2.y = 300;

  physicsStep(disks, 1 / 120, null);
  const gapAfter = Math.hypot(opp2.x - opp1.x, opp2.y - opp1.y);
  assert.ok(
    gapAfter > opp1.r + opp2.r + ball.r * 2,
    `Two players pinching the ball must be separated so ball is never trapped, gapAfter=${gapAfter}`
  );

  // 4. Optional Pass Mode disabled (passDisabled: true):
  assert.equal(PLAYER_RADIUS, 19, 'Player base radius must be increased to 19px');
  const noPassRes = checkPassSuccess(disks, 0, 5, null, false, PASS_MAX_DISTANCE, PASS_CONTACT_RADIUS, {
    ...snapCtx,
    passDisabled: true,
  });
  assert.equal(noPassRes.isPass, false, 'When pass mode is disabled, checkPassSuccess must return false');

  // Verify ball does NOT stick/trap onto a teammate when passDisabled is true
  const teammate = disks[6];
  teammate.x = 250;
  teammate.y = 400;
  teammate.vx = 0;
  teammate.vy = 0;
  ball.x = 250;
  ball.y = 400 + teammate.r + ball.r - 1; // overlapping slightly, moving into teammate
  ball.vx = 0;
  ball.vy = -220;
  physicsStep(disks, 1 / 120, {
    ...snapCtx,
    passDisabled: true,
  });
  assert.ok(
    Math.hypot(ball.vx, ball.vy) > 50,
    `When passDisabled is true, ball must bounce off teammate and never stick (speed=${Math.hypot(ball.vx, ball.vy)})`
  );

  // 5. Verify predictBallImpactDirection computes outgoing ball direction when player aims at ball:
  const striker = disks[7];
  striker.x = 250;
  striker.y = 500;
  ball.x = 250;
  ball.y = 430;
  const hitPred = predictBallImpactDirection(striker, ball, 0, -1, 0.8);
  assert.equal(hitPred.willHitBall, true, 'Aiming straight at the ball must predict a hit');
  assert.ok(hitPred.ballDirY < -0.95, `Ball outgoing direction should point straight up, got ${hitPred.ballDirY}`);
  assert.ok(hitPred.ballTrajectory.length > 0, 'Ball trajectory points must be generated');

  const missPred = predictBallImpactDirection(striker, ball, 1, 0, 0.8);
  assert.equal(missPred.willHitBall, false, 'Aiming perpendicular away from ball must predict no hit');

  // 6. Verify MAX_BALL_SPEED clamping prevents excessive invisible ball velocity:
  striker.x = 250;
  striker.y = 430 + striker.r + ball.r - 1;
  striker.vx = 0;
  striker.vy = -1200;
  ball.x = 250;
  ball.y = 430;
  ball.vx = 0;
  ball.vy = 0;
  physicsStep(disks, 1 / 120, null);
  assert.ok(
    Math.hypot(ball.vx, ball.vy) <= MAX_BALL_SPEED + 0.1,
    `Ball speed must be clamped to MAX_BALL_SPEED (${MAX_BALL_SPEED}), got ${Math.hypot(ball.vx, ball.vy)}`
  );
});

test('Mandatory 30-Match Automated AI-vs-AI Simulation completes with ZERO rule violations', () => {
  const report = run30MatchAutotest(true);
  assert.equal(report.totalMatches, 30);
  assert.equal(report.deadlockedMatches, 0, 'No match may deadlock');
  assert.ok(report.totalPassesCompleted > 40, `Expected active AI passing (>40 passes), got ${report.totalPassesCompleted}`);
  assert.equal(report.violationsByRule.permanentPlayerOverlap, 0, '0 player overlaps');
  assert.equal(report.violationsByRule.falsePassOnOpponentShot, 0, '0 false pass on opponent shots');
  assert.equal(report.violationsByRule.outsidePassContactRadiusOrExtraTurn, 0, '0 passes outside PASS_CONTACT_RADIUS');
  assert.equal(report.violationsByRule.passOverMaxDistance, 0, '0 passes over PASS_MAX_DISTANCE');
  assert.equal(report.violationsByRule.negativeTurnCounterOrDoubleGrant, 0, '0 double extra turns');
  assert.equal(report.violationsByRule.deadlockOver10s, 0, '0 deadlocks over 10s');
  assert.equal(report.violationsByRule.invalidMatchDuration, 0, '0 invalid match durations');
  assert.equal(report.totalViolations, 0, `Expected 0 total violations across 30 matches, got ${report.totalViolations}`);
});

