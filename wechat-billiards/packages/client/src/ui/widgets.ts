import type { Layout, Rect } from "./layout";
import {
  colors,
  font,
  monoFont,
  radius as radii,
  shadow,
  surface,
  typeScale,
  withAlpha,
} from "./theme";

export interface UiButton {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  disabled?: boolean;
  accent?: boolean;
  danger?: boolean;
  clipTop?: number;
  clipBottom?: number;
}

export interface ButtonOptions {
  accent?: boolean;
  danger?: boolean;
  ghost?: boolean;
  disabled?: boolean;
  pill?: boolean;
  fontSize?: number;
  align?: "center" | "left";
}

export interface PanelOptions {
  fill?: string;
  opacity?: number;
  stroke?: string;
  radius?: number;
  highlight?: boolean;
}

export interface ModalOptions {
  maskId?: string;
  fill?: string;
  opacity?: number;
  stroke?: string;
  radius?: number;
}

export interface PlayerCardOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  subline: string;
  avatarColor: string;
  active?: boolean;
  offline?: boolean;
  badge?: string;
  dots?: boolean[];
  thinking?: boolean;
  thinkingLong?: boolean;
  pulse?: number;
  ready?: boolean;
}

export class Ui {
  constructor(
    readonly context: any,
    readonly layout: Layout,
  ) {}

  buttons: UiButton[] = [];

  begin() {
    this.buttons = [];
  }

  clear() {
    this.context.clearRect(0, 0, this.layout.width, this.layout.height);
  }

  save() {
    this.context.save();
  }

  restore() {
    this.context.restore();
  }

  alpha(value: number) {
    this.context.globalAlpha = value;
  }

  path(x: number, y: number, width: number, height: number, radius = 0) {
    const context = this.context;
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.arcTo(x + width, y, x + width, y + r, r);
    context.lineTo(x + width, y + height - r);
    context.arcTo(x + width, y + height, x + width - r, y + height, r);
    context.lineTo(x + r, y + height);
    context.arcTo(x, y + height, x, y + height - r, r);
    context.lineTo(x, y + r);
    context.arcTo(x, y, x + r, y, r);
    context.closePath();
  }

  panelRect(rect: Rect, options: PanelOptions = {}) {
    this.panel(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      options.opacity ?? 0.9,
      options.radius ?? radii.panel,
      options.fill ?? colors.ink800,
      options.stroke ?? withAlpha(colors.ivory100, 0.12),
      options.highlight ?? true,
    );
  }

  panel(
    x: number,
    y: number,
    width: number,
    height: number,
    opacity = 0.9,
    corner: number = radii.panel,
    fill: string = colors.ink800,
    stroke: string = withAlpha(colors.ivory100, 0.12),
    highlight = true,
  ) {
    const context = this.context;
    const clamped = Math.max(0, Math.min(corner, width / 2, height / 2));
    this.path(x, y, width, height, clamped);
    context.fillStyle = withAlpha(fill, opacity);
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.stroke();
    if (highlight && height > 18) {
      context.strokeStyle = withAlpha(colors.ivory100, 0.12);
      context.beginPath();
      context.moveTo(x + clamped, y + 1);
      context.lineTo(x + width - clamped, y + 1);
      context.stroke();
    }
  }

  button(
    id: string,
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options: ButtonOptions = {},
  ) {
    const context = this.context;
    const disabled = options.disabled ?? false;
    const accent = Boolean(options.accent) && !disabled;
    const corner = options.pill
      ? height / 2
      : height >= width
        ? radii.control
        : Math.min(radii.panel, height / 3);
    context.save();
    this.path(x, y, width, height, corner);
    if (accent) {
      const gradient = context.createLinearGradient(x, y, x, y + height);
      gradient.addColorStop(0, colors.brass300);
      gradient.addColorStop(0.45, colors.brass400);
      gradient.addColorStop(1, colors.brass500);
      context.fillStyle = gradient;
    } else if (disabled) {
      context.fillStyle = withAlpha(colors.ink800, 0.72);
    } else if (options.danger) {
      context.fillStyle = surface.buttonDanger;
    } else if (options.ghost) {
      context.fillStyle = surface.buttonGhost;
    } else {
      context.fillStyle = surface.button;
    }
    context.fill();
    context.strokeStyle = disabled
      ? withAlpha(colors.sage500, 0.35)
      : options.danger
        ? withAlpha(colors.danger400, 0.9)
        : accent
          ? withAlpha(colors.ivory100, 0.66)
          : withAlpha(colors.sage300, 0.38);
    context.lineWidth = 1;
    context.stroke();
    if (accent) {
      context.strokeStyle = withAlpha(colors.ivory100, 0.35);
      context.beginPath();
      context.moveTo(x + corner, y + 1);
      context.lineTo(x + width - corner, y + 1);
      context.stroke();
    }
    const size = Math.max(
      18,
      options.fontSize ?? Math.min(23, Math.round(height * 0.36)),
    );
    this.text(
      label,
      options.align === "left" ? x + 18 : x + width / 2,
      y + height / 2 + 1,
      size,
      disabled
        ? colors.sage500
        : accent
          ? colors.ink950
          : options.danger
            ? colors.danger200
            : colors.ivory100,
      options.align ?? "center",
      accent ? 700 : 600,
      width - 20,
    );
    context.restore();
    this.buttons.push({
      id,
      label,
      x,
      y,
      width,
      height,
      disabled,
      accent: options.accent,
      danger: options.danger,
    });
  }

  pill(
    id: string,
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    active = false,
    disabled = false,
  ) {
    this.button(id, label, x, y, width, height, {
      accent: active,
      ghost: !active,
      disabled,
      pill: true,
      fontSize: Math.max(16, Math.min(18, Math.round(height * 0.4))),
    });
  }

  text(
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: "left" | "center" | "right" = "left",
    weight: number | string = 500,
    maxWidth?: number,
  ) {
    const context = this.context;
    let actual = size;
    context.font = font(actual, weight);
    if (maxWidth && maxWidth > 0) {
      const measured = context.measureText(value).width;
      if (measured > maxWidth) {
        actual = Math.max(12, Math.floor((actual * maxWidth) / measured));
        context.font = font(actual, weight);
      }
    }
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = "middle";
    context.fillText(value, x, y);
  }

  measure(value: string, size: number, weight: number | string = 500) {
    this.context.font = font(size, weight);
    return this.context.measureText(value).width;
  }

  monoText(
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: "left" | "center" | "right" = "left",
    weight: number | string = 600,
  ) {
    const context = this.context;
    context.save();
    context.font = monoFont(size, weight);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = "middle";
    context.fillText(value, x, y);
    context.restore();
  }

  wrap(
    value: string,
    maxWidth: number,
    size: number,
    weight: number | string = 500,
    maxLines = 2,
  ) {
    this.context.font = font(size, weight);
    const lines: string[] = [];
    let current = "";
    for (const char of value) {
      const next = current + char;
      if (this.context.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = char;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    if (lines.length > maxLines) {
      let last = lines[maxLines - 1];
      while (
        last.length > 0 &&
        this.context.measureText(`${last}…`).width > maxWidth
      )
        last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}…`;
      return lines.slice(0, maxLines);
    }
    return lines;
  }

  mask(id = "modalMask") {
    this.context.fillStyle = surface.mask;
    this.context.fillRect(0, 0, this.layout.width, this.layout.height);
    this.buttons.push({
      id,
      label: "",
      x: 0,
      y: 0,
      width: this.layout.width,
      height: this.layout.height,
    });
  }

  modal(rect: Rect, options: ModalOptions = {}) {
    const context = this.context;
    this.mask(options.maskId);
    context.save();
    context.shadowColor = shadow.modal.color;
    context.shadowBlur = shadow.modal.blur;
    context.shadowOffsetY = shadow.modal.offsetY;
    this.panel(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      options.opacity ?? 0.99,
      options.radius ?? radii.card,
      options.fill ?? colors.ink900,
      options.stroke ?? withAlpha(colors.brass400, 0.4),
    );
    context.restore();
  }

  divider(x: number, y: number, width: number) {
    this.context.strokeStyle = surface.line;
    this.context.lineWidth = 1;
    this.context.beginPath();
    this.context.moveTo(x, y + 0.5);
    this.context.lineTo(x + width, y + 0.5);
    this.context.stroke();
  }

  dot(x: number, y: number, radius: number, color: string) {
    this.context.fillStyle = color;
    this.context.beginPath();
    this.context.arc(x, y, radius, 0, Math.PI * 2);
    this.context.fill();
  }

  avatar(
    x: number,
    y: number,
    size: number,
    label: string,
    color: string,
    active = false,
  ) {
    if (active) {
      this.context.fillStyle = withAlpha(colors.brass300, 0.16);
      this.context.beginPath();
      this.context.arc(x + size / 2, y + size / 2, size / 2 + 5, 0, Math.PI * 2);
      this.context.fill();
    }
    this.dot(x + size / 2, y + size / 2, size / 2, color);
    this.text(
      label.slice(0, 1),
      x + size / 2,
      y + size / 2 + 1,
      Math.round(size * 0.42),
      colors.ink950,
      "center",
      700,
    );
  }

  playerCard(options: PlayerCardOptions) {
    const {
      x,
      y,
      width,
      height,
      name,
      subline,
      avatarColor,
      active = false,
      offline = false,
      badge,
      dots = [],
      thinking = false,
      thinkingLong = false,
      pulse = 0,
      ready = false,
    } = options;
    const context = this.context;
    this.panel(
      x,
      y,
      width,
      height,
      active ? 0.94 : 0.82,
      radii.card,
      colors.ink800,
      active
        ? withAlpha(colors.brass300, 0.9)
        : withAlpha(colors.ivory100, 0.12),
    );
    if (active) {
      context.save();
      context.shadowColor = withAlpha(colors.brass300, 0.45);
      context.shadowBlur = 16;
      this.path(x, y, width, height, radii.card);
      context.strokeStyle = withAlpha(colors.brass300, 0.9);
      context.lineWidth = 2;
      context.stroke();
      context.restore();
    }
    const avatarSize = height >= 60 ? 40 : 34;
    const left = x + 18;
    this.avatar(
      left,
      y + (height - avatarSize) / 2,
      avatarSize,
      name,
      avatarColor,
      active,
    );
    const textX = left + avatarSize + 14;
    const right = x + width - 16;
    const dotsWidth = dots.length * 9;
    const textWidth = Math.max(80, width - (textX - x) - 16 - dotsWidth);
    this.text(
      name,
      textX,
      y + height * 0.34,
      Math.min(22, Math.round(height * 0.33)),
      active ? colors.brass300 : colors.ivory100,
      "left",
      700,
      textWidth,
    );
    this.text(
      subline,
      textX,
      y + height * 0.68,
      Math.min(16, Math.round(height * 0.24)),
      offline ? withAlpha(colors.danger400, 0.9) : colors.sage300,
      "left",
      500,
      textWidth,
    );
    if (badge)
      this.text(
        badge,
        right,
        y + height * 0.32,
        14,
        colors.brass300,
        "right",
        600,
        dotsWidth > 0 ? dotsWidth + 24 : 90,
      );
    if (ready)
      this.text("已准备", right, y + height * 0.32, 14, colors.success400, "right", 600);
    if (thinking) {
      for (let index = 0; index < 3; index += 1) {
        const offset = (pulse + index * 0.18) % 1;
        const alpha = 0.35 + Math.sin(offset * Math.PI) * 0.65;
        this.dot(
          right - 26 + index * 10,
          y + height * 0.32,
          3,
          withAlpha(colors.sage300, alpha),
        );
      }
    }
    dots.forEach((potted, index) => {
      const cx = right - dotsWidth + 6 + index * 9;
      const cy = y + height * 0.7;
      this.dot(
        cx,
        cy,
        3,
        potted ? withAlpha(colors.sage500, 0.4) : colors.brass300,
      );
    });
    if (thinkingLong)
      this.text(
        "对手思考较久",
        right,
        y + height * 0.68,
        13,
        withAlpha(colors.danger400, 0.9),
        "right",
        500,
      );
    if (active) {
      context.fillStyle = withAlpha(colors.brass300, 0.9);
      context.fillRect(x + radii.card, y + height - 3, width - radii.card * 2, 2);
    }
  }

  powerSlider(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    value: number,
    disabled: boolean,
  ) {
    const context = this.context;
    const corner = width / 2;
    context.save();
    if (disabled) context.globalAlpha = 0.4;
    this.panel(x, y, width, height, 0.85, corner, colors.ink900);
    const fill = Math.max(0, Math.min(1, value));
    const knobY = y + height - fill * height;
    const gradient = context.createLinearGradient(x, y + height, x, y);
    gradient.addColorStop(0, colors.felt600);
    gradient.addColorStop(0.62, colors.brass400);
    gradient.addColorStop(1, colors.danger400);
    context.save();
    this.path(x + 4, y + 4, width - 8, height - 8, corner);
    context.clip();
    context.fillStyle = gradient;
    context.fillRect(x + 4, knobY, width - 8, y + height - 4 - knobY);
    context.restore();
    for (let step = 1; step < 10; step += 1) {
      const tickY = y + height - (height * step) / 10;
      context.strokeStyle =
        step % 5 === 0
          ? withAlpha(colors.ivory100, 0.36)
          : withAlpha(colors.ivory100, 0.16);
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + width - 12, tickY);
      context.lineTo(x + width - 6, tickY);
      context.stroke();
    }
    context.fillStyle = colors.ivory100;
    this.path(x - 7, knobY - 4, width + 14, 8, 4);
    context.fill();
    context.strokeStyle = withAlpha(colors.ink950, 0.5);
    context.stroke();
    const label = fill < 0.05 ? "轻推" : fill > 0.95 ? "满力" : `${Math.round(fill * 100)}%`;
    this.text(
      label,
      x + width + 10,
      knobY,
      18,
      colors.ivory100,
      "left",
      700,
      Math.max(52, this.layout.width - (x + width + 10)),
    );
    context.restore();
    this.buttons.push({
      id,
      label: "力度",
      x: x - 12,
      y: y - 12,
      width: width + 24,
      height: height + 24,
      disabled,
    });
  }

  fineAimSlider(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    offset: number,
    disabled: boolean,
  ) {
    const context = this.context;
    const corner = width / 2;
    context.save();
    if (disabled) context.globalAlpha = 0.4;
    this.panel(x, y, width, height, 0.85, corner, colors.ink900);
    const middle = y + height / 2;
    context.strokeStyle = withAlpha(colors.sage300, 0.45);
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x + 8, middle);
    context.lineTo(x + width - 8, middle);
    context.stroke();
    for (let step = -4; step <= 4; step += 1) {
      if (step === 0) continue;
      const tickY = middle + (height / 10) * step;
      context.strokeStyle = withAlpha(colors.ivory100, 0.16);
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + width - 12, tickY);
      context.lineTo(x + width - 6, tickY);
      context.stroke();
    }
    const knobY = middle + Math.max(-1, Math.min(1, offset)) * (height / 2);
    context.fillStyle = colors.brass300;
    this.path(x - 7, knobY - 4, width + 14, 8, 4);
    context.fill();
    this.text("+", x + width / 2, y + 14, 16, colors.ivory100, "center", 600);
    this.text("−", x + width / 2, y + height - 14, 16, colors.ivory100, "center", 600);
    if (Math.abs(offset) > 0.01) {
      const degrees = (offset * 6).toFixed(1);
      this.text(
        `${offset > 0 ? "+" : ""}${degrees}°`,
        x - 10,
        knobY,
        14,
        colors.sage300,
        "right",
        600,
        70,
      );
    }
    context.restore();
    this.buttons.push({
      id,
      label: "微调",
      x: x - 12,
      y: y - 12,
      width: width + 24,
      height: height + 24,
      disabled,
    });
  }

  segmented(
    prefix: string,
    options: { id: string; label: string }[],
    x: number,
    y: number,
    width: number,
    height: number,
    selected: string,
  ) {
    this.panel(x, y, width, height, 0.72, radii.pill, colors.ink900);
    const gap = 4;
    const itemWidth = (width - gap * (options.length + 1)) / options.length;
    options.forEach((option, index) => {
      const active = option.id === selected;
      this.button(
        `${prefix}:${option.id}`,
        option.label,
        x + gap + index * (itemWidth + gap),
        y + gap,
        itemWidth,
        height - gap * 2,
        {
          accent: active,
          ghost: !active,
          fontSize: 18,
        },
      );
    });
  }

  tabs(
    prefix: string,
    options: { id: string; label: string }[],
    x: number,
    y: number,
    width: number,
    height: number,
    selected: string,
  ) {
    this.segmented(prefix, options, x, y, width, height, selected);
  }

  toast(text: string, y = 150) {
    const width = Math.min(
      this.layout.width - 160,
      Math.max(240, this.measure(text, 18, 600) + 48),
    );
    const x = (this.layout.width - width) / 2;
    this.panel(x, y, width, 40, 0.92, radii.pill, colors.ink950, withAlpha(colors.brass300, 0.45));
    this.text(text, this.layout.width / 2, y + 21, 18, colors.brass300, "center", 600, width - 32);
  }

  statusBar(
    text: string,
    tone: string,
    y: number,
    maxWidth = 760,
    detailsId?: string,
  ) {
    const width = Math.min(maxWidth, this.layout.width - 120);
    const x = (this.layout.width - width) / 2;
    const height = 40;
    this.panel(x, y, width, height, 0.86, radii.pill, colors.ink950, withAlpha(colors.ivory100, 0.12));
    this.dot(x + 20, y + height / 2, 5, tone);
    let reserve = 0;
    if (
      detailsId &&
      this.wrap(text, width - 52, typeScale.body - 1, 500, 3).length > 2
    )
      reserve = 92;
    const lines = this.wrap(
      text,
      width - 52 - reserve,
      typeScale.body - 1,
      500,
      2,
    );
    if (lines.length === 0) return false;
    const lineHeight = 20;
    const startY =
      y + height / 2 - ((lines.length - 1) * lineHeight) / 2 + 1;
    lines.forEach((line, index) =>
      this.text(
        line,
        x + 36,
        startY + index * lineHeight,
        typeScale.body - 1,
        colors.ivory100,
        "left",
        500,
      ),
    );
    if (reserve > 0) {
      const buttonX = x + width - 92;
      this.text(
        "查看详情 ›",
        buttonX + 44,
        y + height / 2 + 1,
        14,
        colors.brass300,
        "center",
        600,
      );
      this.buttons.push({
        id: detailsId!,
        label: "查看详情",
        x: buttonX,
        y: y + 2,
        width: 88,
        height: height - 4,
      });
    }
    return reserve > 0;
  }

  drawerHandle(x: number, y: number, width: number) {
    this.context.fillStyle = withAlpha(colors.ivory100, 0.24);
    this.path(x + width / 2 - 28, y + 10, 56, 4, 2);
    this.context.fill();
  }
}
