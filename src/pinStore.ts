import type { MementoLike } from "./types";
import { SetStore } from "./setStore";

/** Persists the set of pinned session ids. */
export class PinStore extends SetStore {
  constructor(memento: MementoLike) {
    super(memento, "pinnedSessions");
  }
  async pin(sessionId: string): Promise<void> {
    await this.add(sessionId);
  }
  async unpin(sessionId: string): Promise<void> {
    await this.remove(sessionId);
  }
}
