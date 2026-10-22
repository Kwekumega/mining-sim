import { Need, NEEDS } from "./life";

/** Builds an element: h("div.card", {onclick}, child, "text"). */
export function h<T extends HTMLElement = HTMLElement>(
  tag: string,
  props: Record<string, unknown> | null = null,
  ...children: (Node | string | null | false | undefined)[]
): T {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name) as T;
  if (classes.length) el.className = classes.join(" ");
  if (props) {
    for (const [k, val] of Object.entries(props)) {
      if (k.startsWith("on") && typeof val === "function") el.addEventListener(k.slice(2), val as EventListener);
      else if (k === "style" && typeof val === "string") el.setAttribute("style", val);
      else if (typeof val === "boolean") {
        if (val) el.setAttribute(k, "");
      } else if (val !== undefined && val !== null) el.setAttribute(k, String(val));
    }
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

export const NEED_INFO: Record<Need, { icon: string; label: string; colour: string }> = {
  hunger: { icon: "🍲", label: "Hunger", colour: "#f39c32" },
  energy: { icon: "⚡", label: "Energy", colour: "#f2d22e" },
  fun: { icon: "🎉", label: "Fun", colour: "#e05cb5" },
  social: { icon: "💬", label: "Social", colour: "#4fa3f7" },
  hygiene: { icon: "🚿", label: "Hygiene", colour: "#3fd0b8" },
};

export interface Choice {
  label: string;
  sub?: string;
  disabled?: boolean;
  primary?: boolean;
  onPick?: () => void;
  /** Keep the dialog open after picking. */
  stay?: boolean;
}

export interface Tab {
  id: string;
  label: string;
  render: () => HTMLElement;
}

export const cedis = (n: number) => `GH₵ ${Math.round(n).toLocaleString("en-GH")}`;

/** Everything drawn over the 3D world. */
export class Hud {
  readonly root = h("div.hud");
  private readonly money = h("div.money");
  private readonly clock = h("div.clock");
  private readonly jobLine = h("div.jobline");
  private readonly bars = new Map<Need, { fill: HTMLElement; row: HTMLElement }>();
  private readonly goal = h("div.goal");
  private readonly prompt = h("div.prompt", { hidden: true });
  private readonly toasts = h("div.toasts", { "aria-live": "polite" });
  private readonly layer = h("div.layer", { hidden: true });
  private readonly fader = h("div.fader");
  readonly minimap = h<HTMLCanvasElement>("canvas.minimap", { width: 300, height: 300, "aria-label": "Mini map" });
  readonly vehicleBar = h("div.vehiclebar", { hidden: true });
  readonly touch = { x: 0, y: 0, active: false };
  readonly look = { dx: 0, dy: 0 };
  onAct: () => void = () => {};
  onExit: () => void = () => {};
  onPhone: () => void = () => {};
  onMap: () => void = () => {};
  running = false;
  private closeHandler: (() => void) | null = null;
  private dismissable = true;

  constructor(parent: HTMLElement) {
    const needs = h("div.needs");
    for (const n of NEEDS) {
      const info = NEED_INFO[n];
      const fill = h("i");
      fill.style.background = info.colour;
      const row = h("div.need", { title: info.label }, h("span.icon", null, info.icon), h("span.track", null, fill));
      this.bars.set(n, { fill, row });
      needs.append(row);
    }
    const status = h("div.status", null, h("div.statusTop", null, this.money, this.clock), this.jobLine, needs, this.goal);
    const exitBtn = h("button.exit", { onclick: () => this.onExit() }, "Get out ", h("kbd", null, "F"));
    this.vehicleBar.append(exitBtn);
    const buttons = h(
      "div.corner",
      null,
      h("button.round", { onclick: () => this.onMap(), "aria-label": "Map (M)" }, "🗺️", h("small", null, "Map")),
      h("button.round.phone", { onclick: () => this.onPhone(), "aria-label": "Phone (P)" }, "📱", h("small", null, "Phone")),
    );
    const keys = h("div.keys", null, "WASD move · Shift run · ", h("kbd", null, "E"), "act · ", h("kbd", null, "P"), "phone · ", h("kbd", null, "M"), "map · drag to look");
    this.root.append(status, this.minimap, this.toasts, this.prompt, buttons, this.vehicleBar, keys, this.touchControls(), this.layer, this.fader);
    parent.append(this.root);
    this.layer.addEventListener("pointerdown", (e) => {
      if (e.target === this.layer && this.dismissable) this.close();
    });
  }

  private touchControls(): HTMLElement {
    const knob = h("i");
    const stick = h("div.stick", null, knob);
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    stick.addEventListener("pointerdown", (e) => {
      id = e.pointerId;
      stick.setPointerCapture(id);
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      move(e);
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const max = 44;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx *= max / len;
        dy *= max / len;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.x = dx / max;
      this.touch.y = dy / max;
      this.touch.active = true;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = "";
      this.touch.x = this.touch.y = 0;
      this.touch.active = false;
    };
    stick.addEventListener("pointermove", move);
    stick.addEventListener("pointerup", end);
    stick.addEventListener("pointercancel", end);
    const run = h("button.tbtn", { "aria-pressed": "false" }, "Run");
    run.addEventListener("click", () => {
      this.running = !this.running;
      run.setAttribute("aria-pressed", String(this.running));
    });
    const act = h("button.tbtn.act", { onclick: () => this.onAct() }, "E");
    return h("div.touch", null, stick, h("div.tbtns", null, run, act));
  }

  setStats(money: number, clock: string, job: string, needs: Record<Need, number>, onShift: boolean): void {
    this.money.textContent = cedis(money);
    this.clock.textContent = clock;
    this.jobLine.textContent = job;
    this.jobLine.classList.toggle("on", onShift);
    for (const n of NEEDS) {
      const bar = this.bars.get(n)!;
      bar.fill.style.width = `${needs[n]}%`;
      bar.row.classList.toggle("low", needs[n] < 25);
    }
  }

  setGoal(text: string): void {
    if (this.goal.textContent !== text) this.goal.textContent = text;
  }

  setPrompt(text: string | null): void {
    this.prompt.hidden = !text;
    if (text && this.prompt.dataset.text !== text) {
      this.prompt.dataset.text = text;
      this.prompt.replaceChildren(h("kbd", null, "E"), " ", text);
    }
  }

  toast(text: string, kind: "good" | "bad" | "info" | "gold" = "info"): void {
    const t = h(`div.toast.${kind}`, null, text);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add("gone"), 3800);
    setTimeout(() => t.remove(), 4400);
  }

  get open(): boolean {
    return !this.layer.hidden;
  }

  /** A dialog with a title, some content and a list of choices. */
  dialog(title: string, body: Node | string | null, choices: Choice[], opts: { dismissable?: boolean; onClose?: () => void; className?: string } = {}): void {
    const list = h("div.choices");
    for (const c of choices) {
      const b = h(`button.choice${c.primary ? ".primary" : ""}`, { disabled: !!c.disabled }, h("span", null, c.label), c.sub ? h("small", null, c.sub) : null);
      b.addEventListener("click", () => {
        if (!c.stay) this.close(false);
        c.onPick?.();
      });
      list.append(b);
    }
    const card = h(`div.card${opts.className ? "." + opts.className : ""}`, { role: "dialog", "aria-label": title }, h("h2", null, title), typeof body === "string" ? h("p", null, body) : body, choices.length ? list : null);
    this.show(card, opts.dismissable ?? true, opts.onClose);
    (list.querySelector("button:not([disabled])") as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  /** A tabbed sheet, used for the phone. */
  sheet(title: string, tabs: Tab[], active: string, className = "phone-sheet"): void {
    const content = h("div.sheetBody");
    const nav = h("nav.tabs");
    const pick = (id: string) => {
      for (const b of nav.children) b.setAttribute("aria-selected", String((b as HTMLElement).dataset.id === id));
      content.replaceChildren(tabs.find((t) => t.id === id)!.render());
    };
    for (const t of tabs) {
      const b = h<HTMLButtonElement>("button", { "data-id": t.id, role: "tab" }, t.label);
      b.addEventListener("click", () => pick(t.id));
      nav.append(b);
    }
    const closeBtn = h("button.closeX", { "aria-label": "Close", onclick: () => this.close() }, "✕");
    const card = h(`div.card.${className}`, { role: "dialog", "aria-label": title }, h("div.sheetHead", null, h("h2", null, title), closeBtn), nav, content);
    this.show(card, true);
    pick(active);
    this.refreshSheet = () => pick(nav.querySelector("[aria-selected=true]")?.getAttribute("data-id") ?? active);
  }

  refreshSheet: () => void = () => {};

  /** Shows any element in the dialog layer. */
  show(card: HTMLElement, dismissable = true, onClose?: () => void): void {
    this.dismissable = dismissable;
    this.closeHandler = onClose ?? null;
    this.layer.replaceChildren(card);
    this.layer.hidden = false;
  }

  close(runHandler = true): void {
    if (this.layer.hidden) return;
    this.layer.hidden = true;
    this.layer.replaceChildren();
    const handler = this.closeHandler;
    this.closeHandler = null;
    this.refreshSheet = () => {};
    if (runHandler) handler?.();
  }

  /** Fades to black, runs the change, and fades back. */
  fade(during: () => void, text = ""): Promise<void> {
    return new Promise((resolve) => {
      this.fader.textContent = text;
      this.fader.classList.add("on");
      setTimeout(() => {
        during();
        setTimeout(() => {
          this.fader.classList.remove("on");
          resolve();
        }, text ? 900 : 250);
      }, 450);
    });
  }
}
