import { gutter, safeBottom, safeTop } from "../layout";
import type { HudModel } from "../model";
import { colors, typeScale, withAlpha } from "../theme";
import type { Ui } from "../widgets";

const paragraphs = [
  "黑八：开球后开放球局，合法落袋确定全色/花色；先碰错误球、无球碰库或母球落袋为犯规。",
  "九球：每杆先碰最低号球，合法打进九号球获胜；犯规时九号球重摆，对手获得自由球。",
  "斯诺克：15 红球，红彩交替后按黄绿棕蓝粉黑清彩；犯规罚 4–7 分，彩球按规则复位。",
  "自由球采用几何遮挡检测；裁判裁量的 miss/复位不重放在本版不作为自动规则。",
  "本项目使用 tailuge/billiards 的 GPLv3 物理与规则算法，并包含修改及新增代码。",
  "完整 GPLv3 文本随源码提供。对应源码地址：",
];

export function drawLicense(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const margin = gutter(layout);
  const top = safeTop(layout);
  const bottom = safeBottom(layout);
  drawBackdrop(ui);

  ui.button("back", "← 返回", margin, top + 24, 100, 44, {
    ghost: true,
    fontSize: 16,
  });
  ui.text("关于与许可", margin, top + 98, typeScale.h1, colors.ivory100, "left", 700);
  ui.text(
    "规则细节以本页和实际对局为准",
    margin,
    top + 136,
    16,
    colors.sage500,
    "left",
    500,
  );

  let y = top + 180;
  const width = layout.width - margin * 2;
  paragraphs.slice(0, 5).forEach((paragraph) => {
    const lines = ui.wrap(paragraph, width, 17, 500, 3);
    lines.forEach((line) => {
      ui.text(line, margin, y, 17, colors.ivory100, "left", 500);
      y += 24;
    });
    y += 8;
  });

  ui.text("完整 GPLv3 文本随源码提供。对应源码地址：", margin, y, 17, colors.sage300, "left", 500);
  y += 26;
  ui.text(
    model.sourceUrl || "发布前必须配置真实公开源码地址",
    margin,
    y,
    15,
    model.sourceUrl ? colors.info400 : colors.danger400,
    "left",
    500,
    width,
  );
  y += 28;
  ui.button("copySource", "复制源码地址", margin, y, 220, 48, {
    ghost: true,
    fontSize: 16,
    disabled: !model.sourceUrl,
  });
  ui.button("back", "返回", margin + 240, y, 160, 48, {
    accent: true,
    fontSize: 17,
  });

  const noteY = layout.height - bottom - 92;
  ui.text(
    "不使用腾讯商标、美术、音频或私有协议。",
    margin,
    noteY,
    15,
    colors.sage500,
    "left",
    500,
    width,
  );
  ui.text(
    "欢畅台球 v0.3.1 · GPL-3.0-only",
    margin,
    noteY + 24,
    13,
    withAlpha(colors.sage500, 0.8),
    "left",
    500,
  );
}

function drawBackdrop(ui: Ui) {
  const { layout } = ui;
  const context = ui.context;
  const gradient = context.createLinearGradient(0, 0, 0, layout.height);
  gradient.addColorStop(0, colors.ink900);
  gradient.addColorStop(1, colors.ink950);
  context.fillStyle = gradient;
  context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = withAlpha(colors.felt600, 0.06);
  context.beginPath();
  context.arc(layout.width * 0.86, layout.height * 0.2, 300, 0, Math.PI * 2);
  context.fill();
}
