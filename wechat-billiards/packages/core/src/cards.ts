import type {
  ActiveEffect,
  CardDefinition,
  CardEffectKind,
  CardId,
  CardInstance,
  CardState,
  GameType,
  PlayerIndex,
  ShotModifiers,
} from "./types";

export const CARD_IDS: CardId[] = [
  "eagle_eye",
  "cannon",
  "feather",
  "deep_spin",
  "silence",
  "shield",
  "shuffle",
  "swap_hand",
  "dispel",
  "spring",
  "bonus_ball",
  "copy",
  "freeze",
  "steal",
  "second_life",
  "double",
  "command",
  "red_rain",
];

export const CARD_DEFINITIONS: Record<CardId, CardDefinition> = {
  eagle_eye: {
    id: "eagle_eye",
    name: "鹰眼",
    glyph: "眼",
    rarity: "common",
    timing: "shot",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "本杆预测线 +2 档",
    description: "本杆预测线档位 +2，最高 5 档；与房间档位、轻推叠加。",
    weight: 6,
  },
  cannon: {
    id: "cannon",
    name: "重炮",
    glyph: "炮",
    rarity: "common",
    timing: "shot",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "本杆力度上限 +20%",
    description: "本杆力度上限 ×1.2，最高 1.4 倍；与冻结相乘。",
    weight: 6,
  },
  feather: {
    id: "feather",
    name: "轻推",
    glyph: "轻",
    rarity: "common",
    timing: "shot",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "力度 -35%，预测 +1 档",
    description: "本杆力度上限 ×0.65，预测线 +1 档；适合防守和轻推。",
    weight: 6,
  },
  deep_spin: {
    id: "deep_spin",
    name: "强塞",
    glyph: "塞",
    rarity: "common",
    timing: "shot",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "本杆杆法上限提升",
    description: "杆法上限从 0.45 提升到 0.65，本杆有效。",
    weight: 6,
  },
  silence: {
    id: "silence",
    name: "沉默",
    glyph: "默",
    rarity: "common",
    timing: "targetTurn",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "对手下回合不能出牌",
    description: "对手下一回合不能使用卡牌，回合结束后解除。",
    weight: 6,
  },
  shield: {
    id: "shield",
    name: "护盾",
    glyph: "盾",
    rarity: "rare",
    timing: "frame",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "抵消一次犯规",
    description:
      "本局第一次犯规不罚分；黑八/九球对手不获得自由球，母球落袋则放回开球点。",
    weight: 3,
  },
  shuffle: {
    id: "shuffle",
    name: "移形换位",
    glyph: "移",
    rarity: "rare",
    timing: "instant",
    target: "objectBall",
    modes: ["eightball", "nineball", "snooker"],
    short: "移动一颗非关键球",
    description:
      "把一颗非关键球移动到 1.5 个球半径内的合法位置；不能进袋、重叠或越界。",
    weight: 3,
  },
  swap_hand: {
    id: "swap_hand",
    name: "换手",
    glyph: "换",
    rarity: "rare",
    timing: "instant",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "与对手随机换一张牌",
    description: "双方各随机一张手牌交换；对手没有手牌时卡牌退回。",
    weight: 3,
  },
  dispel: {
    id: "dispel",
    name: "识破",
    glyph: "破",
    rarity: "rare",
    timing: "instant",
    target: "effect",
    modes: ["eightball", "nineball", "snooker"],
    short: "移除对手一个持续效果",
    description: "移除对手一个持续效果（沉默、冻结、护盾、弹性、奖金、双倍、续命）。",
    weight: 3,
  },
  spring: {
    id: "spring",
    name: "弹性增强",
    glyph: "弹",
    rarity: "rare",
    timing: "shot",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "本杆库边更弹",
    description: "本杆库边恢复系数 ×1.15，走位和翻袋更强。",
    weight: 3,
  },
  bonus_ball: {
    id: "bonus_ball",
    name: "奖金球",
    glyph: "金",
    rarity: "rare",
    timing: "shot",
    target: "none",
    modes: ["nineball", "snooker"],
    short: "本杆进球额外 +1 分",
    description: "本杆每次合法进球额外 +1 分；犯规则无效。",
    weight: 3,
  },
  copy: {
    id: "copy",
    name: "复制",
    glyph: "复",
    rarity: "rare",
    timing: "instant",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "复制对手最后一张牌",
    description: "复制对手最后使用的一张牌加入手牌；对手还没出过牌时退回。",
    weight: 3,
  },
  freeze: {
    id: "freeze",
    name: "冻结",
    glyph: "冻",
    rarity: "epic",
    timing: "targetShot",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "对手下杆力度 -40%，无杆法",
    description: "对手下一杆力度上限 ×0.6，杆法强制为 0，击球后解除。",
    weight: 1,
  },
  steal: {
    id: "steal",
    name: "偷天换日",
    glyph: "偷",
    rarity: "epic",
    timing: "instant",
    target: "none",
    modes: ["eightball", "nineball", "snooker"],
    short: "随机夺走对手一张牌",
    description: "随机获得对手一张手牌；对手没有手牌时退回。",
    weight: 1,
  },
  second_life: {
    id: "second_life",
    name: "续命",
    glyph: "续",
    rarity: "epic",
    timing: "frame",
    target: "none",
    modes: ["eightball"],
    short: "第一次黑八误进不判负",
    description: "本局第一次因提前或犯规打进黑八时，黑八重摆、不判负；随后按正常犯规处理。",
    weight: 1,
  },
  double: {
    id: "double",
    name: "双倍",
    glyph: "双",
    rarity: "epic",
    timing: "shot",
    target: "none",
    modes: ["snooker"],
    short: "本杆得分翻倍",
    description: "本杆合法得分 ×2；本杆犯规则效果作废。仅斯诺克可用。",
    weight: 1,
  },
  command: {
    id: "command",
    name: "号令",
    glyph: "令",
    rarity: "rare",
    timing: "shot",
    target: "objectBall",
    modes: ["nineball"],
    short: "指定本杆最低号球",
    description: "指定任意一颗台面上的球为本杆首碰目标；合法进球后继续击球。",
    weight: 3,
  },
  red_rain: {
    id: "red_rain",
    name: "红球雨",
    glyph: "雨",
    rarity: "epic",
    timing: "instant",
    target: "none",
    modes: ["snooker"],
    short: "放回 2 颗红球",
    description: "把最多 2 颗已落袋红球放回台面合法位置，仅红球阶段可用。",
    weight: 1,
  },
};

export class CardRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CardRuleError";
  }
}

export function cardsForGame(gameType: GameType): CardDefinition[] {
  return CARD_IDS.map((id) => CARD_DEFINITIONS[id]).filter((definition) =>
    definition.modes.includes(gameType),
  );
}

export function defFor(id: CardId): CardDefinition {
  return CARD_DEFINITIONS[id];
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function practiceCardPool(gameType: GameType): CardDefinition[] {
  const blocked: CardId[] = [
    "silence",
    "shield",
    "swap_hand",
    "dispel",
    "freeze",
    "steal",
    "copy",
  ];
  return cardsForGame(gameType).filter(
    (definition) => !blocked.includes(definition.id),
  );
}

export function dealCards(
  playerCount: number,
  handSize: number,
  gameType: GameType,
  seed: number,
  practice = false,
): CardInstance[][] {
  const players = Math.max(1, Math.floor(playerCount));
  if (handSize <= 0) return Array.from({ length: players }, () => []);
  const definitions = practice
    ? practiceCardPool(gameType)
    : cardsForGame(gameType);
  const pool: CardId[] = [];
  definitions.forEach((definition) => {
    const copies = definition.rarity === "common" ? 2 : 1;
    for (let index = 0; index < copies; index += 1) pool.push(definition.id);
  });
  const random = mulberry32(seed);
  const deck = shuffled(pool, random);
  const commons = deck.filter((id) => CARD_DEFINITIONS[id].rarity === "common");
  const others = deck.filter((id) => CARD_DEFINITIONS[id].rarity !== "common");
  const hands: CardId[][] = Array.from({ length: players }, () => []);
  let commonIndex = 0;
  let otherIndex = 0;
  for (let player = 0; player < players; player += 1) {
    if (handSize >= 1 && commonIndex < commons.length)
      hands[player].push(commons[commonIndex++]);
  }
  for (let round = 1; round < handSize; round += 1) {
    for (let player = 0; player < players; player += 1) {
      const id =
        otherIndex < others.length
          ? others[otherIndex++]
          : commonIndex < commons.length
            ? commons[commonIndex++]
            : undefined;
      if (id) hands[player].push(id);
    }
  }
  return hands.map((hand, player) =>
    hand.slice(0, handSize).map((cardId, index) => ({
      uid: `${seed}-${player}-${index}`,
      cardId,
    })),
  );
}

export function createCardState(
  playerCount: number,
  handSize: number,
  gameType: GameType,
  seed: number,
  practice = false,
): CardState | null {
  if (handSize <= 0) return null;
  const safeSeed = seed >>> 0;
  return {
    enabled: true,
    handSize,
    hands: dealCards(playerCount, handSize, gameType, safeSeed, practice),
    active: [],
    used: Array.from({ length: playerCount }, () => []),
    lastPlayed: Array.from({ length: playerCount }, () => null),
    discard: [],
    playedThisTurn: false,
    rngSeed: (safeSeed ^ 0x9e3779b9) >>> 0,
    dealSeed: safeSeed,
  };
}

type ModifierAccumulator = {
  predictionBonus: number;
  powerScale: number;
  spinLimit: number;
  cushionScale: number;
  bonusPerPot: number;
  scoreMultiplier: number;
  commandBallId: number | null;
  spinForcedZero: boolean;
};

export function effectApplies(
  effect: ActiveEffect,
  player: PlayerIndex,
): boolean {
  return (
    (effect.target === null && effect.owner === player) ||
    effect.target === player
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function shotModifiers(
  cards: CardState | null,
  player: PlayerIndex,
): ShotModifiers {
  const result: ModifierAccumulator = {
    predictionBonus: 0,
    powerScale: 1,
    spinLimit: 0.45,
    cushionScale: 1,
    bonusPerPot: 0,
    scoreMultiplier: 1,
    commandBallId: null,
    spinForcedZero: false,
  };
  if (!cards?.enabled) return result;
  for (const effect of cards.active) {
    if (!effectApplies(effect, player)) continue;
    switch (effect.kind) {
      case "predictionBonus":
        result.predictionBonus += effect.value;
        break;
      case "powerScale":
        result.powerScale *= effect.value;
        break;
      case "spinLimit":
        result.spinLimit = Math.max(result.spinLimit, effect.value);
        break;
      case "cushionScale":
        result.cushionScale *= effect.value;
        break;
      case "bonusPerPot":
        result.bonusPerPot += effect.value;
        break;
      case "scoreMultiplier":
        result.scoreMultiplier *= effect.value;
        break;
      case "commandBall":
        if (result.commandBallId === null)
          result.commandBallId = Math.round(effect.value);
        break;
      case "freeze":
        result.spinForcedZero = true;
        result.powerScale *= 0.6;
        break;
      default:
        break;
    }
  }
  return {
    predictionBonus: clamp(result.predictionBonus, 0, 5),
    powerScale: clamp(result.powerScale, 0.4, 1.4),
    spinLimit: clamp(result.spinLimit, 0.45, 0.65),
    cushionScale: clamp(result.cushionScale, 1, 1.15),
    bonusPerPot: Math.max(0, Math.floor(result.bonusPerPot)),
    scoreMultiplier: clamp(result.scoreMultiplier, 1, 2),
    commandBallId: result.commandBallId,
    spinForcedZero: result.spinForcedZero,
  };
}

export function expireCardEffects(
  cards: CardState | null,
  phase: "afterShot" | "afterTurn",
  player: PlayerIndex,
): void {
  if (!cards?.enabled) return;
  cards.active = cards.active.filter((effect) => {
    if (
      phase === "afterShot" &&
      effect.expires === "shot" &&
      effect.owner === player
    )
      return false;
    if (
      phase === "afterShot" &&
      effect.expires === "targetShot" &&
      effect.target === player
    )
      return false;
    if (
      phase === "afterTurn" &&
      effect.expires === "targetTurn" &&
      effect.target === player
    )
      return false;
    return true;
  });
}

export function effectKindLabel(kind: CardEffectKind): string {
  switch (kind) {
    case "predictionBonus":
      return "鹰眼";
    case "powerScale":
      return "力度";
    case "spinLimit":
      return "强塞";
    case "cushionScale":
      return "弹性";
    case "silence":
      return "沉默";
    case "shield":
      return "护盾";
    case "freeze":
      return "冻结";
    case "bonusPerPot":
      return "奖金";
    case "scoreMultiplier":
      return "双倍";
    case "commandBall":
      return "号令";
    case "secondLife":
      return "续命";
  }
}

export function effectExpiryLabel(effect: ActiveEffect): string {
  if (effect.expires === "shot") return "本杆";
  if (effect.expires === "targetShot") return "下杆";
  if (effect.expires === "targetTurn") return "下回合";
  return "本局";
}
