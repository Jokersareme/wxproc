export type GameType = "eightball" | "nineball" | "snooker";
export type PlayerIndex = number;
export type MatchPhase = "aiming" | "ballInHand" | "shooting" | "gameOver";
export type BallGroup = "open" | "solids" | "stripes";
export type Vec3Data = [number, number, number];

export interface ShotInput {
  angle: number;
  power: number;
  spinX: number;
  spinY: number;
  elevation: number;
}

export interface BallSnapshot {
  id: number;
  label: number | null;
  pos: Vec3Data;
  vel: Vec3Data;
  rvel: Vec3Data;
  state: string;
}

export interface SnookerTarget {
  targetIsRed: boolean;
  previousPotRed: boolean;
  freeBall: boolean;
  nominatedBall: number | null;
  respottedBlack: boolean;
  /** Colour on in the final sequence, 1=yellow … 6=black. */
  nextColour: number;
}

export type CardId =
  | "eagle_eye"
  | "cannon"
  | "feather"
  | "deep_spin"
  | "silence"
  | "shield"
  | "shuffle"
  | "swap_hand"
  | "dispel"
  | "spring"
  | "bonus_ball"
  | "copy"
  | "freeze"
  | "steal"
  | "second_life"
  | "double"
  | "command"
  | "red_rain";

export type CardRarity = "common" | "rare" | "epic";
export type CardTiming =
  | "instant"
  | "shot"
  | "targetShot"
  | "targetTurn"
  | "frame";
export type CardTarget = "none" | "objectBall" | "effect";

export interface CardDefinition {
  id: CardId;
  name: string;
  glyph: string;
  rarity: CardRarity;
  timing: CardTiming;
  target: CardTarget;
  modes: GameType[];
  short: string;
  description: string;
  weight: number;
}

export interface CardInstance {
  uid: string;
  cardId: CardId;
}

export type CardEffectKind =
  | "predictionBonus"
  | "powerScale"
  | "spinLimit"
  | "cushionScale"
  | "silence"
  | "shield"
  | "freeze"
  | "bonusPerPot"
  | "scoreMultiplier"
  | "commandBall"
  | "secondLife";

export interface ActiveEffect {
  effectId: string;
  cardId: CardId;
  owner: PlayerIndex;
  target: PlayerIndex | null;
  kind: CardEffectKind;
  value: number;
  expires: "shot" | "targetShot" | "targetTurn" | "frame";
  createdSeq: number;
}

export interface CardState {
  enabled: boolean;
  handSize: number;
  hands: CardInstance[][];
  active: ActiveEffect[];
  used: CardId[][];
  lastPlayed: (CardId | null)[];
  discard: CardId[];
  playedThisTurn: boolean;
  rngSeed: number;
  dealSeed: number;
}

export type CardEvent =
  | { type: "played"; cardId: CardId; player: PlayerIndex }
  | { type: "returned"; cardId: CardId; reason: string }
  | {
      type: "ballMoved";
      ballId: number;
      from: [number, number];
      to: [number, number];
    }
  | { type: "handChanged"; player: PlayerIndex; count: number }
  | {
      type: "effectApplied";
      effectId: string;
      kind: CardEffectKind;
      target: PlayerIndex | null;
    }
  | { type: "effectRemoved"; effectId: string }
  | { type: "shieldUsed"; player: PlayerIndex }
  | { type: "secondLife"; player: PlayerIndex; ballId: number }
  | { type: "redsRespot"; ballIds: number[] };

export interface CardPlayRequest {
  cardUid: string;
  targetBallId?: number;
  targetPos?: { x: number; y: number };
  targetEffectId?: string;
}

export interface CardPlayResult {
  snapshot: MatchSnapshot;
  events: CardEvent[];
  cardId: CardId;
  targetBallId: number | null;
  targetPos: { x: number; y: number } | null;
  targetEffectId: string | null;
}

export interface ShotModifiers {
  predictionBonus: number;
  powerScale: number;
  spinLimit: number;
  cushionScale: number;
  bonusPerPot: number;
  scoreMultiplier: number;
  commandBallId: number | null;
  spinForcedZero: boolean;
}

export interface MatchSnapshot {
  version: 2;
  gameType: GameType;
  phase: MatchPhase;
  canRepositionCue: boolean;
  practice: boolean;
  playerCount: number;
  currentPlayer: PlayerIndex;
  players: string[];
  groups: BallGroup[];
  scores: number[];
  eliminated: boolean[];
  /** Final order once the match ends; empty while playing. */
  ranking: PlayerIndex[];
  currentBreak: number;
  bestBreak: number[];
  /** Object balls potted by each player, used for three-player tie-breaks. */
  pots: number[];
  shotNumber: number;
  target: SnookerTarget;
  balls: BallSnapshot[];
  winner: PlayerIndex | null;
  endReason: string | null;
  lastMessage: string | null;
  cards: CardState | null;
}

export interface PhysicsEvent {
  type: "collision" | "cushion" | "pot";
  timestamp: number;
  ballA: number;
  ballB: number | null;
  incidentSpeed: number;
  cushion?: string;
}

export type RuleEvent =
  | { type: "foul"; player: PlayerIndex; reason: string; penalty: number }
  | { type: "turn"; player: PlayerIndex }
  | { type: "ballInHand"; player: PlayerIndex }
  | { type: "groups"; groups: BallGroup[] }
  | { type: "score"; player: PlayerIndex; score: number; currentBreak: number }
  | { type: "respot"; ballIds: number[] }
  | { type: "freeBall"; player: PlayerIndex }
  | { type: "gameOver"; winner: PlayerIndex | null; reason: string }
  | { type: "info"; message: string };

export interface FrameBall {
  id: number;
  pos: Vec3Data;
  state: string;
}

export interface ShotFrame {
  time: number;
  balls: FrameBall[];
}

export interface ShotResult {
  input: ShotInput;
  events: PhysicsEvent[];
  ruleEvents: RuleEvent[];
  cardEvents: CardEvent[];
  snapshot: MatchSnapshot;
  stateHash: string;
  durationMs: number;
  frames?: ShotFrame[];
}

export interface CreateMatchOptions {
  gameType: GameType;
  playerNames?: string[];
  playerCount?: number;
  practice?: boolean;
  mode?: "classic" | "cards";
  cardCount?: number;
  seed?: number;
  startingPlayer?: PlayerIndex;
}
