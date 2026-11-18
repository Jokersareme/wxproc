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
  shotNumber: number;
  target: SnookerTarget;
  balls: BallSnapshot[];
  winner: PlayerIndex | null;
  endReason: string | null;
  lastMessage: string | null;
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
  | { type: "gameOver"; winner: PlayerIndex; reason: string }
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
}
