import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, type FurnaceEntity } from "../blockEntities.js";
import { SMELT_TIME, craft, fuelOf, smelt } from "../crafting.js";
import type { Icons } from "../icons.js";
import { ARMOR_FOR, ARMOR_SLOTS, HOTBAR_SLOTS, INVENTORY_SLOTS, arraySlot, click, gather, moveInto, type Inventory, type Slot } from "../inventory.js";
import { CREATIVE, ITEMS, stacksWith, type Item, type ItemStack } from "../items.js";
import { h } from "./dom.js";

/** What the screens need of the game. */
export interface ItemScreenHost {
  icons: Icons;
  inventory: Inventory;
  /** Throws out a stack that has nowhere else to go. */
  spill(stack: ItemStack): void;
}

/** A crafting grid's result slot: taking from it uses one of everything in the grid. */
class ResultSlot implements Slot {
  readonly limit = 64;
  constructor(
    private readonly grid: (ItemStack | null)[],
    private readonly width: number,
  ) {}

  get(): ItemStack | null {
    return craft(this.grid, this.width);
  }

  set(): void {}

  accepts(): boolean {
    return false;
  }

  /** Uses up one of each ingredient. */
  consume(): void {
    for (let i = 0; i < this.grid.length; i++) {
      const s = this.grid[i];
      if (s) this.grid[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
    }
  }
}

type Section = { slots: Slot[]; columns: number; label?: string; kind?: "result" | "armor" };

/**
 * A screen for something that works items or energy (a furnace, a generator, the industry's machines, a
 * battery box): a slot over a gauge over a slot, an arrow to an output if it has one, and a line of text.
 */
export interface ProcessView {
  title: string;
  /** The slot over the gauge (an input, fuel, a battery to charge), the one under it, the output. */
  top: Slot | null;
  bottom: Slot | null;
  output: Slot | null;
  /** What shift sends into the top or bottom slot from the inventory. */
  acceptsTop: (s: ItemStack) => boolean;
  acceptsBottom: (s: ItemStack) => boolean;
  /** The gauge: a flame (burning) or a bar of energy. */
  bar: "flame" | "energy";
  /** Every frame: how far along the arrow is (0-1), how full the gauge, what the text says. */
  gauges: () => { arrow: number; bar: number; text: string };
}

/**
 * The screens over the game that hold items: the inventory (with its 2 x 2 crafting grid and armor), a
 * crafting table (3 x 3), a chest (or double chest), a furnace, and the creative list of every item. Items
 * move as in Minecraft: the left button picks up and puts down stacks, the right one halves a stack or
 * puts down one, shift moves a stack to the other part of the screen, a double click gathers.
 */
export class ItemScreen {
  /** Whether a screen is up. */
  open: boolean = false;
  /** Called when it closes (the game goes back to playing). */
  onClose: (() => void) | null = null;
  private cursor: ItemStack | null = null;
  private readonly cursorEl: HTMLElement;
  private grid: (ItemStack | null)[] = [];
  private gridWidth = 0;
  private sections: Section[] = [];
  private title = "";
  private process: ProcessView | null = null;
  private search = "";
  private creative = false;
  private body: HTMLElement | null = null;
  private progress: { arrow: HTMLElement | null; bar: HTMLElement; text: HTMLElement } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ItemScreenHost,
  ) {
    this.cursorEl = h("div", { class: "slot cursor-stack", hidden: true });
    document.body.append(this.cursorEl);
    document.addEventListener("mousemove", (e) => {
      this.cursorEl.style.transform = `translate(${e.clientX - 22}px, ${e.clientY - 22}px)`;
    });
  }

  private inventorySlot(i: number): Slot {
    return this.host.inventory.slot(i);
  }

  private get main(): Slot[] {
    return Array.from({ length: INVENTORY_SLOTS - HOTBAR_SLOTS }, (_, i) => this.inventorySlot(HOTBAR_SLOTS + i));
  }

  private get hotbar(): Slot[] {
    return Array.from({ length: HOTBAR_SLOTS }, (_, i) => this.inventorySlot(i));
  }

  /** The player's inventory with its crafting grid and armor. */
  showInventory(): void {
    this.start("Inventory", 2);
    const armor = ARMOR_SLOTS.map((i) => this.inventorySlot(i));
    this.sections = [
      { slots: armor, columns: 1, kind: "armor" },
      this.gridSection(),
      this.resultSection(),
      { slots: this.main, columns: 9 },
      { slots: this.hotbar, columns: 9 },
    ];
    this.render();
  }

  /** A crafting table: a 3 x 3 grid. */
  showTable(): void {
    this.start("Crafting", 3);
    this.sections = [this.gridSection(), this.resultSection(), { slots: this.main, columns: 9 }, { slots: this.hotbar, columns: 9 }];
    this.render();
  }

  /** A chest's (or double chest's) slots, as given (they write through to wherever the chest is kept). */
  showChest(slots: Slot[], title: string): void {
    this.start(title, 0);
    this.sections = [{ slots, columns: 9 }, { slots: this.main, columns: 9 }, { slots: this.hotbar, columns: 9 }];
    this.render();
  }

  /** A furnace: its input, fuel and output slots (given), with how far it is along. */
  showFurnace(slots: Slot[], furnace: FurnaceEntity): void {
    this.showProcess({
      title: "Furnace",
      top: slots[FURNACE_INPUT],
      bottom: slots[FURNACE_FUEL],
      output: slots[FURNACE_OUTPUT],
      acceptsTop: (s) => smelt(s.item) !== null,
      acceptsBottom: (s) => fuelOf(s.item) > 0,
      bar: "flame",
      gauges: () => ({ arrow: furnace.cook / SMELT_TIME, bar: furnace.burnTotal > 0 ? furnace.burn / furnace.burnTotal : 0, text: "" }),
    });
  }

  /** Something that works items or energy (see ProcessView); its gauges are read every frame. */
  showProcess(view: ProcessView): void {
    this.start(view.title, 0);
    this.process = view;
    this.sections = [
      { slots: view.top ? [view.top] : [], columns: 1 },
      { slots: view.bottom ? [view.bottom] : [], columns: 1 },
      { slots: view.output ? [view.output] : [], columns: 1, kind: "result" },
      { slots: this.main, columns: 9 },
      { slots: this.hotbar, columns: 9 },
    ];
    this.render();
  }

  /** The creative list: every item, a click putting a stack of it into the selected hotbar slot. */
  showCreative(): void {
    this.start("Items", 0);
    this.creative = true;
    this.sections = [{ slots: this.hotbar, columns: 9 }];
    this.render();
  }

  private start(title: string, gridWidth: number): void {
    this.open = true;
    this.title = title;
    this.gridWidth = gridWidth;
    this.grid = new Array(gridWidth * gridWidth).fill(null);
    this.process = null;
    this.creative = false;
    this.search = "";
    this.progress = null;
  }

  private gridSection(): Section {
    return { slots: this.grid.map((_, i) => arraySlot(this.grid, i)), columns: this.gridWidth };
  }

  private resultSection(): Section {
    return { slots: [new ResultSlot(this.grid, this.gridWidth)], columns: 1, kind: "result" };
  }

  /** Closes the screen: what is left in the crafting grid and on the cursor goes back into the inventory. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    for (const s of [...this.grid, this.cursor]) {
      if (!s) continue;
      const left = this.host.inventory.add(s);
      if (left) this.host.spill(left);
    }
    this.grid = [];
    this.cursor = null;
    this.cursorEl.hidden = true;
    this.body = null;
    this.onClose?.();
  }

  /** Every frame while up: a furnace's or machine's gauges, and its slots. */
  tick(): void {
    if (!this.open || !this.process || !this.progress) return;
    const g = this.process.gauges();
    if (this.progress.arrow) this.progress.arrow.style.width = `${Math.min(1, g.arrow) * 100}%`;
    this.progress.bar.style.height = `${Math.min(1, g.bar) * 100}%`;
    this.progress.text.textContent = g.text;
    this.refreshSlots();
  }

  /** Redraws what the slots hold (after changes from elsewhere). */
  refreshSlots(): void {
    if (!this.body) return;
    this.body.querySelectorAll<HTMLElement>(".slot[data-slot]").forEach((el) => {
      const [a, b] = el.dataset.slot!.split(":").map(Number);
      this.paint(el, this.sections[a].slots[b].get());
    });
    this.paint(this.cursorEl, this.cursor);
    this.cursorEl.hidden = !this.cursor;
  }

  private paint(el: HTMLElement, s: ItemStack | null): void {
    const bg = s ? this.host.icons.background(s.item) : null;
    el.style.setProperty("--icon", bg ?? (s ? `linear-gradient(${ITEMS[s.item].color} 0 38%, ${ITEMS[s.item].color} 38% 100%)` : "none"));
    // What holds energy says how much
    const charge = s ? ITEMS[s.item].charge : null;
    el.title = s ? (charge ? `${ITEMS[s.item].label} (${Math.floor(charge.capacity - s.damage).toLocaleString("en")} / ${charge.capacity.toLocaleString("en")} EU)` : ITEMS[s.item].label) : "";
    const count = s && s.count > 1 ? String(s.count) : "";
    const durability = s ? ITEMS[s.item].durability : 0;
    el.replaceChildren(h("b", {}, count), s && s.damage > 0 && durability > 0 ? h("i", { style: `--wear: ${1 - s.damage / durability}` }) : "");
  }

  private render(): void {
    const slotEl = (a: number, b: number, extra: string = ""): HTMLElement => {
      const el = h("div", {
        class: `slot ${extra}`,
        "data-slot": `${a}:${b}`,
        onmousedown: (e: MouseEvent) => {
          e.preventDefault();
          this.onSlot(a, b, e.button === 2, e.shiftKey);
        },
        ondblclick: () => this.onDouble(),
        oncontextmenu: (e: Event) => e.preventDefault(),
      });
      return el;
    };
    const grid = (a: number): HTMLElement => {
      const sec = this.sections[a];
      return h("div", { class: "slots", style: `grid-template-columns: repeat(${sec.columns}, 44px)` }, ...sec.slots.map((_, b) => slotEl(a, b, sec.kind ?? "")));
    };
    const parts: (HTMLElement | null)[] = [];
    if (this.creative) {
      const input = h("input", { type: "search", placeholder: "Search", value: this.search, autofocus: true });
      const list = h("div", { class: "slots creative" });
      const fill = (): void => {
        const q = input.value.trim().toLowerCase();
        list.replaceChildren(
          ...CREATIVE.filter((i) => !q || ITEMS[i].label.includes(q)).map((item) => {
            const el = h("div", { class: "slot", onmousedown: (e: MouseEvent) => (e.preventDefault(), this.pickCreative(item, e.shiftKey)) });
            this.paint(el, { item, count: 1, damage: 0 });
            return el;
          }),
        );
      };
      input.addEventListener("input", () => {
        this.search = input.value;
        fill();
      });
      fill();
      parts.push(input, list, h("p", { class: "muted" }, "Click an item to put a stack of it in the selected hotbar slot. E or Esc goes back."), grid(0));
    } else if (this.process) {
      const p = this.process;
      const arrow = p.output ? h("div", { class: "gauge arrow" }, h("span")) : null;
      const bar = h("div", { class: `gauge ${p.bar}` }, h("span"));
      const text = h("p", { class: "muted" });
      this.progress = { arrow: arrow ? (arrow.firstElementChild as HTMLElement) : null, bar: bar.firstElementChild as HTMLElement, text };
      parts.push(h("div", { class: "furnace" }, h("div", { class: "column" }, grid(0), bar, grid(1)), ...(arrow ? [arrow, grid(2)] : [])), text, grid(3), grid(4));
    } else if (this.gridWidth > 0) {
      // The inventory has its armor first, then the grid; a crafting table starts with the grid
      const g = this.gridWidth === 2 ? 1 : 0;
      parts.push(h("div", { class: "crafting" }, ...(g === 1 ? [grid(0)] : []), grid(g), h("span", { class: "arrow-sign" }, "→"), grid(g + 1)), grid(g + 2), grid(g + 3));
    } else {
      parts.push(grid(0), grid(1), grid(2));
    }
    this.body = h("div", { class: "screen wide items" }, h("h2", {}, this.title), ...parts.filter((p): p is HTMLElement => p !== null));
    this.root.replaceChildren(this.body);
    this.root.querySelector<HTMLElement>("[autofocus]")?.focus();
    this.refreshSlots();
    this.tick();
  }

  private pickCreative(item: Item, shift: boolean): void {
    const inv = this.host.inventory;
    const s: ItemStack = { item, count: shift ? 1 : ITEMS[item].maxStack, damage: 0 };
    inv.put(inv.selected, s);
    this.refreshSlots();
  }

  /** A press on slot b of section a: shift moves the stack across, otherwise as click() says. */
  private onSlot(a: number, b: number, right: boolean, shift: boolean): void {
    const sec = this.sections[a];
    const slot = sec.slots[b];
    if (slot instanceof ResultSlot || (sec.kind === "result" && this.process)) {
      this.takeResult(slot, shift);
    } else if (this.creative && sec.slots === this.sections[0].slots && !this.cursor) {
      // The creative hotbar: a click selects the slot, shift empties it
      if (shift) slot.set(null);
      else this.host.inventory.select(b);
    } else if (shift) {
      const s = slot.get();
      if (s) {
        slot.set(null);
        const left = moveInto(s, this.targets(a, s));
        if (left) slot.set(left);
      }
    } else {
      this.cursor = click(slot, this.cursor, right);
    }
    this.refreshSlots();
  }

  /** Taking a crafting result (one craft, or as many as fit with shift) or a furnace's output. */
  private takeResult(slot: Slot, shift: boolean): void {
    if (!(slot instanceof ResultSlot)) {
      // A furnace's output: picked up or moved, never put into
      const s = slot.get();
      if (!s) return;
      if (shift) {
        slot.set(moveInto(s, [...this.hotbar, ...this.main]));
      } else if (!this.cursor || (stacksWith(this.cursor, s) && this.cursor.count + s.count <= ITEMS[s.item].maxStack)) {
        this.cursor = this.cursor ? { ...this.cursor, count: this.cursor.count + s.count } : s;
        slot.set(null);
      }
      return;
    }
    for (let n = 0; n < (shift ? 64 : 1); n++) {
      const made = slot.get();
      if (!made) return;
      if (shift) {
        const left = moveInto(made, [...this.hotbar, ...this.main].reverse());
        if (left) {
          // Didn't all fit: what did stays, the rest is not made (ingredients kept)
          if (left.count === made.count) return;
        }
      } else if (!this.cursor) {
        this.cursor = made;
      } else if (stacksWith(this.cursor, made) && this.cursor.count + made.count <= ITEMS[made.item].maxStack) {
        this.cursor = { ...this.cursor, count: this.cursor.count + made.count };
      } else {
        return;
      }
      slot.consume();
    }
  }

  /** Where shift sends a stack from section a. */
  private targets(a: number, s: ItemStack): Slot[] {
    const sec = this.sections[a];
    const inventoryPart = sec.slots === this.sections[this.sections.length - 1].slots || sec.slots === this.sections[this.sections.length - 2].slots;
    const isHotbar = sec.slots === this.sections[this.sections.length - 1].slots;
    if (!inventoryPart) return [...this.main, ...this.hotbar];
    // From the inventory: armor to its slot, into the open container, or between hotbar and the rest
    const armor = ITEMS[s.item].armor;
    if (armor && this.gridWidth === 2) return [this.inventorySlot(ARMOR_SLOTS[ARMOR_FOR.indexOf(armor)])];
    if (this.process) {
      if (this.process.top && this.process.acceptsTop(s)) return this.sections[0].slots;
      if (this.process.bottom && this.process.acceptsBottom(s)) return this.sections[1].slots;
    } else if (this.gridWidth === 0 && !this.creative && this.sections.length === 3) {
      return this.sections[0].slots;
    }
    return isHotbar ? this.main : this.hotbar;
  }

  /** A double click gathers the cursor's item from the slots onto it. */
  private onDouble(): void {
    if (!this.cursor) return;
    const all = this.sections.flatMap((s) => (s.kind === "result" ? [] : s.slots));
    this.cursor = gather(this.cursor, all);
    this.refreshSlots();
  }
}
