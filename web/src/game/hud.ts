import type { Role } from "../sim/mine";

export interface Controls {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  act: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The DOM layer over the game: stats bar, role picker, event feed, prompts, panels and touch controls. */
export class Hud {
  /** Touch buttons write here; the scene reads it with the keyboard. */
  readonly touch: Controls = { up: false, down: false, left: false, right: false, act: false };
  onRole: (role: Role) => void = () => {};
  onSpeed: (speed: number) => void = () => {};
  onAct: () => void = () => {};
  private modalClose: (() => void) | null = null;

  constructor() {
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-role]"))
      button.addEventListener("click", () => this.onRole(button.dataset.role as Role));
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-speed]"))
      button.addEventListener("click", () => {
        this.onSpeed(Number(button.dataset.speed));
        for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) b.setAttribute("aria-pressed", String(b === button));
      });
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-touch]")) {
      const key = button.dataset.touch as keyof Controls;
      const set = (v: boolean) => (e: Event) => {
        e.preventDefault();
        if (v && !this.touch[key] && key === "act") this.onAct();
        this.touch[key] = v;
      };
      button.addEventListener("pointerdown", set(true));
      for (const ev of ["pointerup", "pointerleave", "pointercancel"]) button.addEventListener(ev, set(false));
    }
    $("modal-close").addEventListener("click", () => this.closeModal());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeModal();
    });
  }

  get modalOpen(): boolean {
    return !$("modal").hidden;
  }

  setRole(role: Role): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-role]")) b.setAttribute("aria-pressed", String(b.dataset.role === role));
  }

  setStats(stats: Record<string, string>): void {
    for (const [id, text] of Object.entries(stats)) {
      const el = document.getElementById(`stat-${id}`);
      if (el && el.textContent !== text) el.textContent = text;
    }
  }

  prompt(text: string | null): void {
    const el = $("prompt");
    el.hidden = !text;
    if (text && el.innerHTML !== text) el.innerHTML = text;
  }

  toast(text: string, kind: "info" | "good" | "bad" | "gold" = "info"): void {
    const feed = $("feed");
    const item = document.createElement("li");
    item.className = kind;
    item.textContent = text;
    feed.prepend(item);
    while (feed.children.length > 6) feed.lastElementChild!.remove();
    window.setTimeout(() => item.classList.add("old"), 9000);
  }

  /** Opens a panel. `mount` wires its controls and may return a refresh function called while open. */
  openModal(title: string, html: string, mount: (root: HTMLElement) => (() => void) | void): void {
    $("modal-title").textContent = title;
    const body = $("modal-body");
    body.innerHTML = html;
    $("modal").hidden = false;
    const refresh = mount(body);
    let timer = 0;
    if (refresh) {
      refresh();
      timer = window.setInterval(refresh, 300);
    }
    this.modalClose = () => window.clearInterval(timer);
  }

  closeModal(): void {
    $("modal").hidden = true;
    this.modalClose?.();
    this.modalClose = null;
  }
}
