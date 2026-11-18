import {
  CARD_DEFINITIONS,
  cardsForGame,
  createCardState,
  dealCards,
  expireCardEffects,
  shotModifiers,
} from "./cards";
import { MatchEngine } from "./engine";
import type { CardId, CardState, MatchSnapshot } from "./types";
import { Outcome } from "../../../third_party/billiards/src/model/outcome";
import { State } from "../../../third_party/billiards/src/model/ball";
import { R } from "../../../third_party/billiards/src/model/physics/constants";

function cardState(engine: MatchEngine): CardState {
  const cards = engine.state.cards;
  if (!cards) throw new Error("cards disabled");
  return cards;
}

function give(engine: MatchEngine, player: number, cardId: CardId): string {
  const cards = cardState(engine);
  const uid = `test-${cardId}-${player}`;
  cards.hands[player] = [{ uid, cardId }];
  return uid;
}

function cardEngine(
  gameType: "eightball" | "nineball" | "snooker" = "eightball",
  handSize = 3,
  practice = true,
) {
  return new MatchEngine({
    gameType,
    practice,
    mode: "cards",
    cardCount: handSize,
    seed: 1234,
  });
}

describe("card dealing", () => {
  it("deals nothing when N is zero", () => {
    expect(createCardState(2, 0, "eightball", 1)).toBeNull();
    expect(dealCards(2, 0, "eightball", 1)).toEqual([[], []]);
  });

  it.each([
    ["eightball", 14],
    ["nineball", 15],
    ["snooker", 16],
  ] as const)("filters the card pool for %s", (gameType, count) => {
    expect(cardsForGame(gameType)).toHaveLength(count);
    expect(
      cardsForGame(gameType).some((definition) => definition.id === "red_rain"),
    ).toBe(gameType === "snooker");
    expect(
      cardsForGame(gameType).some((definition) => definition.id === "double"),
    ).toBe(gameType === "snooker");
    expect(
      cardsForGame(gameType).some(
        (definition) => definition.id === "second_life",
      ),
    ).toBe(gameType === "eightball");
  });

  it("gives each player at least one common card and unique uids", () => {
    const hands = dealCards(2, 6, "snooker", 42);
    expect(hands).toHaveLength(2);
    hands.forEach((hand) => {
      expect(hand).toHaveLength(6);
      expect(
        hand.some(
          (card) => CARD_DEFINITIONS[card.cardId].rarity === "common",
        ),
      ).toBe(true);
    });
    const uids = hands.flat().map((card) => card.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("is deterministic for the same seed", () => {
    expect(dealCards(2, 3, "eightball", 99)).toEqual(
      dealCards(2, 3, "eightball", 99),
    );
  });

  it("filters opponent-only cards in practice", () => {
    const hands = dealCards(2, 6, "eightball", 7, true);
    const ids = hands.flat().map((card) => card.cardId);
    expect(ids).not.toContain("silence");
    expect(ids).not.toContain("freeze");
    expect(ids).not.toContain("steal");
  });
});

describe("shot modifiers", () => {
  it("aggregates, clamps and ignores the opponent's buffs", () => {
    const cards = createCardState(2, 3, "eightball", 1)!;
    cards.active = [
      {
        effectId: "a",
        cardId: "cannon",
        owner: 0,
        target: null,
        kind: "powerScale",
        value: 1.2,
        expires: "shot",
        createdSeq: 0,
      },
      {
        effectId: "b",
        cardId: "eagle_eye",
        owner: 0,
        target: null,
        kind: "predictionBonus",
        value: 2,
        expires: "shot",
        createdSeq: 0,
      },
      {
        effectId: "c",
        cardId: "freeze",
        owner: 1,
        target: 0,
        kind: "freeze",
        value: 1,
        expires: "targetShot",
        createdSeq: 0,
      },
      {
        effectId: "d",
        cardId: "cannon",
        owner: 1,
        target: null,
        kind: "powerScale",
        value: 1.2,
        expires: "shot",
        createdSeq: 0,
      },
    ];
    const modifiers = shotModifiers(cards, 0);
    expect(modifiers.powerScale).toBeCloseTo(0.72, 6);
    expect(modifiers.predictionBonus).toBe(2);
    expect(modifiers.spinForcedZero).toBe(true);
  });

  it("expires shot effects for the shooter and target", () => {
    const cards = createCardState(2, 3, "eightball", 1)!;
    cards.active = [
      {
        effectId: "shot",
        cardId: "cannon",
        owner: 0,
        target: null,
        kind: "powerScale",
        value: 1.2,
        expires: "shot",
        createdSeq: 0,
      },
      {
        effectId: "freeze",
        cardId: "freeze",
        owner: 1,
        target: 0,
        kind: "freeze",
        value: 1,
        expires: "targetShot",
        createdSeq: 0,
      },
      {
        effectId: "silence",
        cardId: "silence",
        owner: 1,
        target: 0,
        kind: "silence",
        value: 1,
        expires: "targetTurn",
        createdSeq: 0,
      },
    ];
    expireCardEffects(cards, "afterShot", 0);
    expect(cards.active.map((effect) => effect.effectId)).toEqual(["silence"]);
    expireCardEffects(cards, "afterTurn", 0);
    expect(cards.active).toHaveLength(0);
  });
});

describe("playing cards", () => {
  it("applies eagle eye for one shot and then clears it", () => {
    const engine = cardEngine("eightball");
    const uid = give(engine, 0, "eagle_eye");
    engine.playCard(0, { cardUid: uid });
    expect(shotModifiers(engine.state.cards, 0).predictionBonus).toBe(2);
    engine.shoot({ angle: 0, power: 0.2, spinX: 0, spinY: 0, elevation: 0 });
    expect(shotModifiers(engine.state.cards, 0).predictionBonus).toBe(0);
  });

  it("rejects a second card in the same turn", () => {
    const engine = cardEngine("eightball");
    const cards = cardState(engine);
    cards.hands[0] = [
      { uid: "one", cardId: "eagle_eye" },
      { uid: "two", cardId: "cannon" },
    ];
    engine.playCard(0, { cardUid: "one" });
    expect(() => engine.playCard(0, { cardUid: "two" })).toThrow(
      "本回合已经用过卡牌",
    );
    expect(cards.hands[0]).toHaveLength(1);
  });

  it("does not consume a card with an invalid target", () => {
    const engine = cardEngine("nineball");
    const uid = give(engine, 0, "command");
    expect(() => engine.playCard(0, { cardUid: uid })).toThrow("请选择一颗球");
    expect(cardState(engine).hands[0]).toHaveLength(1);
  });

  it("silences the opponent and blocks their card", () => {
    const engine = cardEngine("eightball", 3, false);
    const silence = give(engine, 0, "silence");
    engine.playCard(0, { cardUid: silence });
    const opponentUid = give(engine, 1, "eagle_eye");
    (engine as any).switchPlayer([]);
    expect(engine.state.currentPlayer).toBe(1);
    expect(() => engine.playCard(1, { cardUid: opponentUid })).toThrow(
      "你被沉默",
    );
  });

  it("cancels a snooker foul with a shield", () => {
    const engine = cardEngine("snooker");
    const uid = give(engine, 0, "shield");
    engine.playCard(0, { cardUid: uid });
    (engine as any).applySnooker([], shotModifiers(engine.state.cards, 0));
    expect(engine.state.scores[1]).toBe(0);
    expect(
      cardState(engine).active.some((effect) => effect.kind === "shield"),
    ).toBe(false);
  });

  it("respots the eight on the first losing pot with second life", () => {
    const engine = cardEngine("eightball");
    const uid = give(engine, 0, "second_life");
    engine.playCard(0, { cardUid: uid });
    engine.state.groups = ["solids", "stripes"];
    engine.table.balls.forEach((ball) => {
      if (ball.id !== 0 && ball.id !== 1 && ball.id !== 8) {
        ball.state = State.InPocket;
        ball.pos.set(0, 0, -1);
      }
    });
    const eight = engine.table.balls.find((ball) => ball.label === 8)!;
    eight.state = State.InPocket;
    const outcomes = [
      Outcome.collision(engine.table.cueball, eight, 1, 0),
      Outcome.pot(eight, 1, 1),
    ];
    (engine as any).applyEightBall(outcomes, false);
    expect(engine.state.phase).toBe("aiming");
    expect(eight.onTable()).toBe(true);
    expect(engine.state.winner).toBeNull();
    expect(
      cardState(engine).active.some((effect) => effect.kind === "secondLife"),
    ).toBe(false);
  });

  it("moves a non-key ball with shuffle and rejects key balls", () => {
    const engine = cardEngine("eightball");
    const uid = give(engine, 0, "shuffle");
    engine.table.balls.forEach((entry) => {
      if (entry.id !== 0 && entry.id !== 1) {
        entry.state = State.InPocket;
        entry.pos.set(0, 0, -1);
      }
    });
    const ball = engine.table.balls[1];
    ball.pos.set(0, 0, 0);
    const x = R * 0.5;
    const y = 0;
    engine.playCard(0, {
      cardUid: uid,
      targetBallId: ball.id,
      targetPos: { x, y },
    });
    expect(ball.pos.x).toBeCloseTo(x, 5);

    const engine2 = cardEngine("eightball");
    const uid2 = give(engine2, 0, "shuffle");
    const eight = engine2.table.balls.find((entry) => entry.label === 8)!;
    expect(() =>
      engine2.playCard(0, {
        cardUid: uid2,
        targetBallId: eight.id,
        targetPos: { x: eight.pos.x + 0.01, y: eight.pos.y },
      }),
    ).toThrow("关键球不能移动");
    expect(cardState(engine2).hands[0]).toHaveLength(1);
  });

  it("respots two reds with red rain during the red phase", () => {
    const engine = cardEngine("snooker");
    const uid = give(engine, 0, "red_rain");
    const reds = engine.table.balls.filter((ball) => ball.id >= 7);
    reds.slice(0, 2).forEach((red) => {
      red.state = State.InPocket;
      red.pos.set(0, 0, -1);
    });
    engine.playCard(0, { cardUid: uid });
    expect(
      engine.table.balls.filter((ball) => ball.id >= 7 && ball.onTable())
        .length,
    ).toBe(reds.length);
  });

  it("sets the command ball for nine-ball", () => {
    const engine = cardEngine("nineball");
    const uid = give(engine, 0, "command");
    engine.playCard(0, { cardUid: uid, targetBallId: 5 });
    expect(shotModifiers(engine.state.cards, 0).commandBallId).toBe(5);
    expect(engine.legalTargetBallIds()).toEqual([5]);
  });

  it("applies the remaining shot modifiers", () => {
    for (const [cardId, check] of [
      ["cannon", (modifiers: any) => modifiers.powerScale],
      ["feather", (modifiers: any) => modifiers.powerScale],
      ["deep_spin", (modifiers: any) => modifiers.spinLimit],
      ["spring", (modifiers: any) => modifiers.cushionScale],
    ] as const) {
      const engine = cardEngine("eightball");
      const uid = give(engine, 0, cardId as CardId);
      engine.playCard(0, { cardUid: uid });
      const modifiers = shotModifiers(engine.state.cards, 0);
      expect(check(modifiers)).toBeTruthy();
    }
    const cannon = cardEngine("eightball");
    const cannonUid = give(cannon, 0, "cannon");
    cannon.playCard(0, { cardUid: cannonUid });
    expect(shotModifiers(cannon.state.cards, 0).powerScale).toBeCloseTo(1.2, 6);
    const feather = cardEngine("eightball");
    const featherUid = give(feather, 0, "feather");
    feather.playCard(0, { cardUid: featherUid });
    expect(shotModifiers(feather.state.cards, 0).powerScale).toBeCloseTo(0.65, 6);
    expect(shotModifiers(feather.state.cards, 0).predictionBonus).toBe(1);
    const deep = cardEngine("eightball");
    const deepUid = give(deep, 0, "deep_spin");
    deep.playCard(0, { cardUid: deepUid });
    expect(shotModifiers(deep.state.cards, 0).spinLimit).toBeCloseTo(0.65, 6);
    const spring = cardEngine("eightball");
    const springUid = give(spring, 0, "spring");
    spring.playCard(0, { cardUid: springUid });
    expect(shotModifiers(spring.state.cards, 0).cushionScale).toBeCloseTo(1.15, 6);
    const freeze = cardEngine("eightball", 3, false);
    const freezeUid = give(freeze, 0, "freeze");
    freeze.playCard(0, { cardUid: freezeUid });
    (freeze as any).switchPlayer([]);
    const frozen = shotModifiers(freeze.state.cards, 1);
    expect(frozen.powerScale).toBeCloseTo(0.6, 6);
    expect(frozen.spinForcedZero).toBe(true);
  });

  it("swaps and steals cards between hands", () => {
    const swap = cardEngine("eightball", 3, false);
    const swapUid = give(swap, 0, "swap_hand");
    swap.state.cards!.hands[0].push({ uid: "mine", cardId: "eagle_eye" });
    swap.state.cards!.hands[1] = [{ uid: "enemy", cardId: "cannon" }];
    swap.playCard(0, { cardUid: swapUid });
    expect(swap.state.cards!.hands[0].some((card) => card.uid === "enemy")).toBe(
      true,
    );
    expect(swap.state.cards!.hands[1]).toHaveLength(1);

    const steal = cardEngine("eightball", 3, false);
    const stealUid = give(steal, 0, "steal");
    steal.state.cards!.hands[1] = [{ uid: "enemy-2", cardId: "cannon" }];
    steal.playCard(0, { cardUid: stealUid });
    expect(steal.state.cards!.hands[1]).toHaveLength(0);
    expect(
      steal.state.cards!.hands[0].some((card) => card.uid === "enemy-2"),
    ).toBe(true);
  });

  it("dispels an opponent effect", () => {
    const engine = cardEngine("eightball", 3, false);
    const cards = cardState(engine);
    cards.active.push({
      effectId: "enemy-buff",
      cardId: "spring",
      owner: 1,
      target: null,
      kind: "cushionScale",
      value: 1.15,
      expires: "shot",
      createdSeq: 0,
    });
    const uid = give(engine, 0, "dispel");
    engine.playCard(0, { cardUid: uid, targetEffectId: "enemy-buff" });
    expect(cards.active).toHaveLength(0);
  });

  it("adds bonus points and doubles legal snooker scores", () => {
    const bonus = cardEngine("nineball");
    const bonusUid = give(bonus, 0, "bonus_ball");
    bonus.playCard(0, { cardUid: bonusUid });
    const ball = bonus.table.balls[1];
    ball.state = State.InPocket;
    (bonus as any).applyNineBall(
      [Outcome.collision(bonus.table.cueball, ball, 1, 0), Outcome.pot(ball, 1, 1)],
      false,
      shotModifiers(bonus.state.cards, 0),
    );
    expect(bonus.state.scores[0]).toBe(2);

    const double = cardEngine("snooker");
    const doubleUid = give(double, 0, "double");
    double.playCard(0, { cardUid: doubleUid });
    const red = double.table.balls[7];
    red.state = State.InPocket;
    (double as any).applySnooker(
      [Outcome.collision(double.table.cueball, red, 1, 0), Outcome.pot(red, 1, 1)],
      shotModifiers(double.state.cards, 0),
    );
    expect(double.state.scores[0]).toBe(2);
  });

  it("copies the opponent's last card", () => {
    const engine = cardEngine("eightball", 3, false);
    const enemyUid = give(engine, 1, "cannon");
    engine.state.cards!.hands[1] = [{ uid: enemyUid, cardId: "cannon" }];
    (engine as any).switchPlayer([]);
    engine.playCard(1, { cardUid: enemyUid });
    (engine as any).switchPlayer([]);
    const uid = give(engine, 0, "copy");
    engine.playCard(0, { cardUid: uid });
    expect(
      cardState(engine).hands[0].some((card) => card.cardId === "cannon"),
    ).toBe(true);
  });
});

describe("three-player snooker rules", () => {
  it("awards foul points to the next active player", () => {
    const engine = new MatchEngine({
      gameType: "snooker",
      playerCount: 3,
      playerNames: ["甲", "乙", "丙"],
    });
    (engine as any).applySnooker([]);
    expect(engine.state.scores).toEqual([0, 4, 0]);
    expect(engine.state.currentPlayer).toBe(1);
  });

  it("keeps playing after one player concedes and ranks the rest", () => {
    const engine = new MatchEngine({
      gameType: "snooker",
      playerCount: 3,
      playerNames: ["甲", "乙", "丙"],
    });
    engine.concede(1);
    expect(engine.state.phase).not.toBe("gameOver");
    expect(engine.state.eliminated).toEqual([false, true, false]);
    engine.concede(2);
    expect(engine.state.phase).toBe("gameOver");
    expect(engine.state.winner).toBe(0);
    expect(engine.state.ranking[0]).toBe(0);
  });

  it("breaks a tie by best break and pot count", () => {
    const engine = new MatchEngine({
      gameType: "snooker",
      playerCount: 3,
      playerNames: ["甲", "乙", "丙"],
    });
    engine.state.scores = [10, 10, 4];
    engine.state.bestBreak = [8, 10, 0];
    engine.state.pots = [3, 2, 0];
    const ranking = (engine as any).rankPlayers();
    expect(ranking.slice(0, 2)).toEqual([1, 0]);
    const snapshot = engine.snapshot() as MatchSnapshot;
    expect(snapshot.bestBreak).toHaveLength(3);
  });

  it("starts the requested player and rotates seats", () => {
    const engine = new MatchEngine({
      gameType: "snooker",
      playerCount: 3,
      playerNames: ["甲", "乙", "丙"],
      startingPlayer: 2,
    });
    expect(engine.state.currentPlayer).toBe(2);
    (engine as any).switchPlayer([]);
    expect(engine.state.currentPlayer).toBe(0);
  });
});
