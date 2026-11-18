import type { GameType, MatchSnapshot } from "@friend-billiards/core";

export function gameName(gameType: GameType) {
  return gameType === "eightball"
    ? "黑八"
    : gameType === "nineball"
      ? "九球"
      : "斯诺克";
}

export function groupName(group: string) {
  return group === "solids"
    ? "全色球"
    : group === "stripes"
      ? "花色球"
      : "开放球局";
}

export function predictionName(level?: number) {
  if (level === undefined || level <= 0) return "关闭";
  return `${level} 档`;
}

const snookerColours = ["黄球", "绿球", "棕球", "蓝球", "粉球", "黑球"];

function snookerColourName(id: number) {
  return snookerColours[id - 1] ?? `${id} 号球`;
}

export function snookerTarget(snapshot: MatchSnapshot) {
  if (snapshot.target.freeBall)
    return snapshot.target.nominatedBall
      ? `自由球：${snookerColourName(snapshot.target.nominatedBall)}`
      : "自由球：请提名";
  if (snapshot.target.respottedBlack) return "黑球（重摆决胜）";
  if (snapshot.target.targetIsRed) return "红球";
  if (snapshot.target.previousPotRed) return "任意彩球";
  return snookerColourName(snapshot.target.nextColour);
}

export function remainingGroupBalls(
  snapshot: MatchSnapshot,
  player: number,
) {
  const group = snapshot.groups[player];
  if (group === "open")
    return snapshot.balls.filter(
      (ball) => ball.id !== 0 && ball.label !== 8 && ball.state !== "InPocket",
    ).length;
  const labels = group === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
  return snapshot.balls.filter(
    (ball) =>
      ball.label !== null &&
      labels.includes(ball.label) &&
      ball.state !== "InPocket",
  ).length;
}

export function groupDots(snapshot: MatchSnapshot, player: number) {
  const group = snapshot.groups[player];
  if (snapshot.gameType === "nineball") {
    return Array.from({ length: 9 }, (_, index) => {
      const label = index + 1;
      return !snapshot.balls.some(
        (ball) => ball.label === label && ball.state !== "InPocket",
      );
    });
  }
  if (snapshot.gameType === "snooker") return [];
  if (group === "open") return Array.from({ length: 7 }, () => false);
  const labels = group === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
  return labels.map(
    (label) =>
      !snapshot.balls.some(
        (ball) => ball.label === label && ball.state !== "InPocket",
      ),
  );
}

export function playerSubline(snapshot: MatchSnapshot, player: 0 | 1) {
  if (snapshot.gameType === "snooker") {
    return `${snapshot.scores[player]} 分 · 单杆 ${snapshot.currentBreak}`;
  }
  if (snapshot.gameType === "nineball") {
    const lowest = snapshot.balls
      .filter(
        (ball) =>
          ball.id !== 0 &&
          ball.label !== null &&
          ball.label >= 1 &&
          ball.label <= 9 &&
          ball.state !== "InPocket",
      )
      .map((ball) => ball.label!)
      .sort((a, b) => a - b)[0];
    return lowest ? `最低 ${lowest} 号` : "清台中";
  }
  const group = snapshot.groups[player];
  if (group === "open") return "开放球局";
  return `${groupName(group)} · 剩 ${remainingGroupBalls(snapshot, player)}`;
}

export function targetBrief(snapshot: MatchSnapshot) {
  if (snapshot.gameType === "snooker") return snookerTarget(snapshot);
  if (snapshot.gameType === "nineball") {
    const lowest = snapshot.balls
      .filter(
        (ball) =>
          ball.id !== 0 &&
          ball.label !== null &&
          ball.label >= 1 &&
          ball.label <= 9 &&
          ball.state !== "InPocket",
      )
      .map((ball) => ball.label!)
      .sort((a, b) => a - b)[0];
    return lowest ? `${lowest} 号球` : "清台中";
  }
  const player = snapshot.currentPlayer;
  const group = snapshot.groups[player];
  if (group === "open") return "任意球";
  if (remainingGroupBalls(snapshot, player) === 0) return "黑 8";
  return groupName(group);
}

export function targetLabel(snapshot: MatchSnapshot) {
  if (snapshot.gameType === "snooker" && snapshot.target.freeBall)
    return snookerTarget(snapshot);
  if (
    snapshot.gameType === "eightball" &&
    snapshot.groups[snapshot.currentPlayer] === "open"
  )
    return "目标：任意球（先进定色）";
  return `目标：${targetBrief(snapshot)}`;
}
