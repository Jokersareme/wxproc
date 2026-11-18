import type { GameType, MatchSnapshot } from "@friend-billiards/core";
import type {
  RoomMode,
  RoomState,
  RoomStatus,
} from "@friend-billiards/protocol";

export type Screen = "home" | "friend" | "room" | "game" | "license";
export type HomeSheet = "classic" | "practice" | null;
export type CameraMode = "top" | "follow" | "overview";
export type QualityTier = "high" | "medium" | "low";

export interface HudModel {
  screen: Screen;
  title?: string;
  message?: string;
  snapshot?: MatchSnapshot;
  room?: RoomState;
  roomCode?: string;
  roomStatus: RoomStatus;
  roomMode: RoomMode;
  trial: boolean;
  countdownEnd: number | null;
  roomOverlayOpen: boolean;
  playerIndex?: number;
  power: number;
  spinX: number;
  spinY: number;
  fineAimOffset: number;
  canShoot: boolean;
  animating: boolean;
  canSkip: boolean;
  playbackSpeed: number;
  online: boolean;
  sourceUrl: string;
  menuOpen: boolean;
  spinOpen: boolean;
  soundOn: boolean;
  createPredictionLevel: number;
  predictionLevel: number;
  practicePredictionLevel: number;
  practiceMode: boolean;
  creating: boolean;
  confirm: { action: string; text: string } | null;
  toast?: string;
  homeSheet: HomeSheet;
  homeSheetProgress: number;
  homeGameType: GameType;
  settingsOpen: boolean;
  cameraMode: CameraMode;
  cameraViews: CameraMode[];
  cameraMoving: boolean;
  roomSettingsOpen: boolean;
  reduceMotion: boolean;
  quality: QualityTier;
  showHint: boolean;
  continueRoom?: { roomCode: string; gameType: GameType };
  opponentWaitingSeconds: number;
  eventLog: { at: number; text: string }[];
  eventLogOpen: boolean;
  foulFlashUntil?: number;
}
