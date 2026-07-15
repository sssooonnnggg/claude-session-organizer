import { describe, it, expect, beforeEach } from "vitest";
import { SetStore } from "../src/setStore";
import type { MementoLike } from "../src/types";

function fakeMemento(): MementoLike {
  const map = new Map<string, unknown>();
  return {
    get<T>(key: string, def: T): T { return map.has(key) ? (map.get(key) as T) : def; },
    update(key: string, value: unknown): Thenable<void> { map.set(key, value); return Promise.resolve(); },
  };
}

describe("SetStore", () => {
  let s: SetStore;
  beforeEach(() => { s = new SetStore(fakeMemento(), "k"); });

  it("starts empty", () => { expect(s.list()).toEqual([]); expect(s.has("a")).toBe(false); });
  it("adds and reports membership", async () => { await s.add("a"); expect(s.has("a")).toBe(true); expect(s.list()).toEqual(["a"]); });
  it("does not duplicate", async () => { await s.add("a"); await s.add("a"); expect(s.list()).toEqual(["a"]); });
  it("removes", async () => { await s.add("a"); await s.remove("a"); expect(s.has("a")).toBe(false); });
  it("toggles", async () => { await s.toggle("a"); expect(s.has("a")).toBe(true); await s.toggle("a"); expect(s.has("a")).toBe(false); });
  it("isolates by key on one memento", async () => {
    const m = fakeMemento();
    await new SetStore(m, "k1").add("a");
    expect(new SetStore(m, "k2").has("a")).toBe(false);
  });
});
