/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Team {
  id: number;
  n: string; // Name
  f: string; // Flag emoji
  r: number; // Rating (66-94)
  c: string; // Primary kit color
  preferredFormationId: string; // Default tactical formation
}

export interface PlayerRole {
  id: number;
  number: number;
  name: string;
  shortName: string;
  sizeDesc: string;
  radius: number; // base 21 px
  mass: number;
  powerMultiplier: number;
  clearanceBonus?: number;
  blockBonus?: number;
  agilityBonus?: number;
  controlBonus?: number;
  precisionBonus?: number;
  finishingBonus?: number;
  specialAbility: string;
  balanceDesc: string;
  massDesc: string;
  powerDesc: string;
}

export interface TacticalFormation {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  icon: string;
  style: 'balanced' | 'offensive' | 'defensive' | 'wings' | 'possession';
  // 7 coordinates for players [1..7] relative to (PITCH_LEFT, PITCH_TOP)
  // Pitch width = 400, height = 680
  positions: [number, number][];
}

export const PLAYER_RADIUS = 19;
export const BALL_RADIUS = 8; // Reduced ball size for cleaner visual proportion
export const MAX_BALL_SPEED = 680; // Balanced ball speed: crisp but slightly slower and easy to track visually
export const PASS_CONTACT_RADIUS = PLAYER_RADIUS * 3; // 57px (captures ball stopping in front of or touching a teammate)
export const PASS_MAX_DISTANCE = 480; // 480px (allows natural passes to teammates anywhere across the pitch)
export const BASE_RADIUS = PLAYER_RADIUS;
export const PLAYERS_PER_TEAM = 8; // 8 players per team (with 2 Stopers)
export const MATCH_DURATION_SECONDS = 180; // 3 minutes
export const EXTRA_TIME_SECONDS = 45; // Golden goal extra period
export const SHOT_CLOCK_SECONDS = 10; // 10-second shot clock limit per turn
export const INTERACTION_RADIUS = PASS_CONTACT_RADIUS; // Unified interaction radius based on PASS_CONTACT_RADIUS
export const PASS_DIRECTION_MIN_COS = 0.35; // Directional cone for ball travel validation
export const PASS_AIM_LOCK_COS = 0.92; // Tight ~23° cone for 🎯 PAS VER lock-on so shots are never hijacked as passes
export const PLAYER_CAPTURE_RADIUS = PASS_CONTACT_RADIUS; // Alias matching PASS_CONTACT_RADIUS
export const BALL_CONTROL_RADIUS = PASS_CONTACT_RADIUS; // Unified control radius
export const PASS_TARGET_MAX_DISTANCE = PASS_MAX_DISTANCE; // Alias for backward compatibility
export const DEFENDER_CHASE_SPEEDS = [55, 95, 135]; // Defender closing speed (px/s) for Easy, Normal, Hard

export const ROLES: PlayerRole[] = [
  {
    id: 1,
    number: 1,
    name: 'Kaleci',
    shortName: 'KL',
    sizeDesc: 'Geniş Gövde',
    radius: Math.round(PLAYER_RADIUS * 1.32 * 10) / 10, // 25.1px
    mass: 9.2, // Yüksek kütle; rakip taşlara karşı dayanıklı
    powerMultiplier: 0.94, // Dengeli degaj gücü
    clearanceBonus: 1.85, // Topa temas ettiğinde güçlü uzaklaştırma yapar
    specialAbility: 'Kale çizgisine yakınken kalecilik avantajı & güçlü uzaklaştırma',
    balanceDesc: 'Geniş yapısı nedeniyle kale önünü iyi kapatır.',
    massDesc: 'Çok yüksek',
    powerDesc: 'Orta (Topa temasta yüksek uzaklaştırma)',
  },
  {
    id: 2,
    number: 2,
    name: 'Sol Stoper',
    shortName: 'STP',
    sizeDesc: 'Güçlü Fizik',
    radius: Math.round(PLAYER_RADIUS * 1.14 * 10) / 10, // 21.7px
    mass: 6.8, // Yüksek
    powerMultiplier: 1.10, // Güçlü
    blockBonus: 1.55, // Top çarpışmalarında daha güçlü müdahale ve blok
    specialAbility: 'Top çarpışmalarında daha güçlü müdahale ve blok',
    balanceDesc: 'Yavaş ivmelenir, ancak savunma hattında kolay kolay savrulmaz.',
    massDesc: 'Yüksek',
    powerDesc: 'Yüksek',
  },
  {
    id: 3,
    number: 6,
    name: 'Sağ Stoper',
    shortName: 'STP',
    sizeDesc: 'Güçlü Fizik',
    radius: Math.round(PLAYER_RADIUS * 1.14 * 10) / 10, // 21.7px
    mass: 6.8, // Yüksek
    powerMultiplier: 1.10, // Güçlü
    blockBonus: 1.55, // Top çarpışmalarında daha güçlü müdahale ve blok
    specialAbility: 'Top çarpışmalarında daha güçlü müdahale ve merkezi blok',
    balanceDesc: 'Savunma göbeğini partneriyle birlikte kapatır.',
    massDesc: 'Yüksek',
    powerDesc: 'Yüksek',
  },
  {
    id: 4,
    number: 3,
    name: 'Sol Bek',
    shortName: 'BEK',
    sizeDesc: 'Çevik',
    radius: Math.round(PLAYER_RADIUS * 0.95 * 10) / 10, // 18.1px
    mass: 4.5, // Orta-Yüksek
    powerMultiplier: 1.16, // Yüksek
    agilityBonus: 1.25, // Hızlı hareket ve çapraz açıyla müdahale
    specialAbility: 'Hızlı hareket ve sol kanat çapraz açıyla müdahale',
    balanceDesc: 'Hem savunmada hem hücumda kullanılabilir.',
    massDesc: 'Orta',
    powerDesc: 'Yüksek',
  },
  {
    id: 5,
    number: 4,
    name: 'Sağ Bek',
    shortName: 'BEK',
    sizeDesc: 'Çevik',
    radius: Math.round(PLAYER_RADIUS * 0.95 * 10) / 10, // 18.1px
    mass: 4.5, // Orta-Yüksek
    powerMultiplier: 1.16, // Yüksek
    agilityBonus: 1.25, // Hızlı hareket ve sağ kanat çapraz açıyla müdahale
    specialAbility: 'Hızlı hareket ve sağ kanat çapraz açıyla müdahale',
    balanceDesc: 'Hem savunmada hem hücumda kullanılabilir.',
    massDesc: 'Orta',
    powerDesc: 'Yüksek',
  },
  {
    id: 6,
    number: 5,
    name: 'Ön Libero & Merkez',
    shortName: 'ÖNL',
    sizeDesc: 'Dengeli',
    radius: PLAYER_RADIUS, // 19.0px
    mass: 5.0, // Orta-Yüksek
    powerMultiplier: 1.20, // Yüksek
    controlBonus: 1.3, // Top kontrolünde ve pas bağlantılarında avantaj
    specialAbility: 'Top kontrolünde ve pas bağlantılarında avantaj',
    balanceDesc: 'İki yönlü oyunun merkezidir; topu takım arkadaşlarına hazırlamakta iyidir.',
    massDesc: 'Orta',
    powerDesc: 'Yüksek',
  },
  {
    id: 7,
    number: 10,
    name: 'On Numara',
    shortName: 'ON',
    sizeDesc: 'Teknik',
    radius: Math.round(PLAYER_RADIUS * 0.95 * 10) / 10, // 18.1px
    mass: 3.6, // Orta
    powerMultiplier: 1.36, // Çok yüksek
    precisionBonus: 1.6, // İnce açılardan şut ve hassas pas
    specialAbility: 'İnce açılardan şut ve hassas pas desteği',
    balanceDesc: 'Teknik açıdan güçlüdür ama sert çarpışmalarda dezavantajlıdır.',
    massDesc: 'Orta-düşük',
    powerDesc: 'Çok yüksek',
  },
  {
    id: 8,
    number: 7,
    name: 'Forvet',
    shortName: 'FVT',
    sizeDesc: 'Atletik',
    radius: Math.round(PLAYER_RADIUS * 0.9 * 10) / 10, // 17.1px
    mass: 3.0, // Dengeli-Atletik
    powerMultiplier: 1.54, // Maksimum şut gücü
    finishingBonus: 1.45, // Kaleye yakın şutlarda güç ve isabet bonusu
    specialAbility: 'Kaleye yakın şutlarda güç ve isabet bitiricilik bonusu',
    balanceDesc: 'Çabuk hızlanır fakat defans taşlarıyla çarpışınca daha kolay savrulur.',
    massDesc: 'Düşük',
    powerDesc: 'Maksimum',
  },
];

export const WORLD_WIDTH = 500;
export const WORLD_HEIGHT = 820;
export const PITCH_LEFT = 50;
export const PITCH_TOP = 70;
export const PITCH_RIGHT = 450;
export const PITCH_BOTTOM = 750;
export const CENTER_X = 250;
export const CENTER_Y = 410;
export const GOAL_LEFT = 180;
export const GOAL_RIGHT = 320;
export const GOAL_WIDTH = GOAL_RIGHT - GOAL_LEFT; // 140
export const POST_RADIUS = 5;
export const PHYSICS_DT = 1 / 120; // 120Hz fixed timestep (~8.33ms)
export const MAX_SUBSTEPS = 8; // Max physics substeps per render frame
export const MIN_VELOCITY_THRESHOLD = 5.0; // px/s cutoff
export const MIN_VELOCITY_SQ = 25.0; // 5^2 px/s
export const MAX_PULL_DISTANCE = 110;

/**
 * 5 Distinct Tactical Formations for 8 Players (with 2 Stopers)
 */
export const FORMATIONS: TacticalFormation[] = [
  {
    id: 'classic',
    name: 'Klasik 1-4-2-1',
    shortLabel: 'Dengeli',
    description: 'Dengeli saha yerleşimi. Merkezde çift stoper, kanatlarda çift bek ve güçlü merkez bağlantısı.',
    icon: '⚖️',
    style: 'balanced',
    positions: [
      [200, 646], // 1: Kaleci (#1)
      [162, 584], // 2: Sol Stoper (#2)
      [238, 584], // 3: Sağ Stoper (#6)
      [92, 548],  // 4: Sol Bek (#3)
      [308, 548], // 5: Sağ Bek (#4)
      [200, 488], // 6: Ön Libero (#5)
      [200, 432], // 7: On Numara (#10)
      [200, 384], // 8: Forvet (#7)
    ],
  },
  {
    id: 'offensive',
    name: 'Baskı 1-2-2-2-1',
    shortLabel: 'Hücum',
    description: 'İleri hatta agresif pres. Çift stoper geriyi korurken bekler ve hücum hattı önde basar.',
    icon: '🔥',
    style: 'offensive',
    positions: [
      [200, 646], // 1: Kaleci (#1)
      [160, 585], // 2: Sol Stoper (#2)
      [240, 585], // 3: Sağ Stoper (#6)
      [92, 495],  // 4: İleri fırlayan sol bek (#3)
      [308, 495], // 5: İleri fırlayan sağ bek (#4)
      [200, 455], // 6: Ön libero merkez kalkan (#5)
      [150, 400], // 7: On numara (#10)
      [250, 385], // 8: Forvet (#7)
    ],
  },
  {
    id: 'catenaccio',
    name: 'Katenaçyo 1-4-2-1',
    shortLabel: 'Savunma',
    description: 'Çift stoperli çelik savunma duvarı. Kale önünü kapatıp hızlı paslarla kontraya çıkar.',
    icon: '🛡️',
    style: 'defensive',
    positions: [
      [200, 650], // 1: Kaleci (#1)
      [165, 595], // 2: Sol Stoper (#2)
      [235, 595], // 3: Sağ Stoper (#6)
      [102, 580], // 4: Sol Bek (#3)
      [298, 580], // 5: Sağ Bek (#4)
      [155, 515], // 6: Ön libero kalkanı (#5)
      [245, 515], // 7: On numara kontra pas istasyonu (#10)
      [200, 415], // 8: Tek kontra forveti (#7)
    ],
  },
  {
    id: 'wings',
    name: 'Kanat Akını 1-4-1-2',
    shortLabel: 'Kanatlar',
    description: 'Sahanın genişliğini kullanarak kanatlara yayılır ve çapraz pas açıları üretir.',
    icon: '⚡',
    style: 'wings',
    positions: [
      [200, 646], // 1: Kaleci (#1)
      [156, 580], // 2: Sol Stoper (#2)
      [244, 580], // 3: Sağ Stoper (#6)
      [75, 490],  // 4: Sol kanat bek (#3)
      [325, 490], // 5: Sağ kanat bek (#4)
      [200, 505], // 6: Ön libero (#5)
      [140, 420], // 7: On numara (#10)
      [260, 390], // 8: Forvet (#7)
    ],
  },
  {
    id: 'possession',
    name: 'Tiki-Taka 1-2-3-1-1',
    shortLabel: 'Orta Saha',
    description: 'Orta sahada yakın pas üçgenleri kurup takım arkadaşları arasında seri paslaşma sağlar.',
    icon: '🎯',
    style: 'possession',
    positions: [
      [200, 646], // 1: Kaleci (#1)
      [160, 582], // 2: Sol Stoper (#2)
      [240, 582], // 3: Sağ Stoper (#6)
      [112, 512], // 4: Sol iç pasör bek (#3)
      [288, 512], // 5: Sağ iç pasör bek (#4)
      [200, 472], // 6: Ön libero merkez (#5)
      [165, 422], // 7: On numara serbest (#10)
      [235, 388], // 8: Sahte 9 Forvet (#7)
    ],
  },
];

export const DEFAULT_FORMATION_ID = 'classic';

export const TEAMS_DATA: Team[] = [
  { id: 0, n: 'Arjantin', f: '🇦🇷', r: 94, c: '#74acdf', preferredFormationId: 'offensive' },
  { id: 1, n: 'Fransa', f: '🇫🇷', r: 93, c: '#1e40af', preferredFormationId: 'offensive' },
  { id: 2, n: 'İspanya', f: '🇪🇸', r: 92, c: '#dc2626', preferredFormationId: 'possession' },
  { id: 3, n: 'Brezilya', f: '🇧🇷', r: 92, c: '#facc15', preferredFormationId: 'offensive' },
  { id: 4, n: 'İngiltere', f: '🇬🇧', r: 91, c: '#e5e7eb', preferredFormationId: 'wings' },
  { id: 5, n: 'Portekiz', f: '🇵🇹', r: 89, c: '#991b1b', preferredFormationId: 'possession' },
  { id: 6, n: 'Almanya', f: '🇩🇪', r: 89, c: '#374151', preferredFormationId: 'balanced' },
  { id: 7, n: 'Hollanda', f: '🇳🇱', r: 88, c: '#f97316', preferredFormationId: 'possession' },
  { id: 8, n: 'İtalya', f: '🇮🇹', r: 87, c: '#2563eb', preferredFormationId: 'catenaccio' },
  { id: 9, n: 'Hırvatistan', f: '🇭🇷', r: 86, c: '#be123c', preferredFormationId: 'possession' },
  { id: 10, n: 'Belçika', f: '🇧🇪', r: 85, c: '#b91c1c', preferredFormationId: 'wings' },
  { id: 11, n: 'Uruguay', f: '🇺🇾', r: 84, c: '#7dd3fc', preferredFormationId: 'catenaccio' },
  { id: 12, n: 'Kolombiya', f: '🇨🇴', r: 83, c: '#eab308', preferredFormationId: 'wings' },
  { id: 13, n: 'Fas', f: '🇲🇦', r: 82, c: '#15803d', preferredFormationId: 'catenaccio' },
  { id: 14, n: 'Japonya', f: '🇯🇵', r: 82, c: '#1e3a8a', preferredFormationId: 'balanced' },
  { id: 15, n: 'ABD', f: '🇺🇸', r: 81, c: '#4338ca', preferredFormationId: 'wings' },
  { id: 16, n: 'Türkiye', f: '🇹🇷', r: 80, c: '#e30a17', preferredFormationId: 'balanced' },
  { id: 17, n: 'Meksika', f: '🇲🇽', r: 80, c: '#166534', preferredFormationId: 'balanced' },
  { id: 18, n: 'Senegal', f: '🇸🇳', r: 80, c: '#16a34a', preferredFormationId: 'wings' },
  { id: 19, n: 'İsviçre', f: '🇨🇭', r: 79, c: '#ef4444', preferredFormationId: 'catenaccio' },
  { id: 20, n: 'Danimarka', f: '🇩🇰', r: 79, c: '#dc2626', preferredFormationId: 'balanced' },
  { id: 21, n: 'Güney Kore', f: '🇰🇷', r: 78, c: '#f43f5e', preferredFormationId: 'wings' },
  { id: 22, n: 'Polonya', f: '🇵🇱', r: 74, c: '#f87171', preferredFormationId: 'catenaccio' },
  { id: 23, n: 'Avustralya', f: '🇦🇺', r: 73, c: '#fbbf24', preferredFormationId: 'catenaccio' },
  { id: 24, n: 'Mısır', f: '🇪🇬', r: 73, c: '#b91c1c', preferredFormationId: 'wings' },
  { id: 25, n: 'İran', f: '🇮🇷', r: 72, c: '#059669', preferredFormationId: 'catenaccio' },
  { id: 26, n: 'Kanada', f: '🇨🇦', r: 72, c: '#dc2626', preferredFormationId: 'wings' },
  { id: 27, n: 'Nijerya', f: '🇳🇬', r: 74, c: '#22c55e', preferredFormationId: 'offensive' },
  { id: 28, n: 'Gana', f: '🇬🇭', r: 70, c: '#fde047', preferredFormationId: 'balanced' },
  { id: 29, n: 'Suudi Arabistan', f: '🇸🇦', r: 68, c: '#047857', preferredFormationId: 'catenaccio' },
  { id: 30, n: 'Kosta Rika', f: '🇨🇷', r: 67, c: '#1d4ed8', preferredFormationId: 'catenaccio' },
  { id: 31, n: 'Katar', f: '🇶🇦', r: 66, c: '#881337', preferredFormationId: 'catenaccio' },
];

export const DIFFICULTY_NAMES = ['Kolay', 'Normal', 'Zor'];
export const ROUND_NAMES: Record<number, string> = {
  8: 'Son 16',
  4: 'Çeyrek Final',
  2: 'Yarı Final',
  1: 'Final',
};
