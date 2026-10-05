import { describe, expect, it } from "vitest";
import type { EventData } from "./api";
import { applyFilters, buildRoster, colorNames, type Filters } from "./roster";
import fixture from "./fixtures/asu26.json";

const roster = buildRoster([fixture as unknown as EventData]);
const all = new Set(["skateboarding", "inline", "street_luge"]);
const base: Filters = { disciplines: all, raceFrom: null, raceTo: null, suit: {}, query: "" };
const byBib = (bib: string) => [...roster.athletes.values()].find((a) => a.registrations.some((r) => r.bib === bib))!;

describe("buildRoster", () => {
  it("lists every registered athlete once", () => {
    expect(roster.athletes.size).toBeGreaterThan(150);
    expect(byBib("268").name).toBe("Lisa Peters");
  });
  it("builds a chronological schedule of qualifying sessions", () => {
    const skate = roster.races.filter((r) => r.discipline === "skateboarding").map((r) => r.label);
    expect(skate).toEqual(["Q1A", "Q2", "Q3"]);
    for (let i = 1; i < roster.races.length; i++) expect(roster.races[i].startMs!).toBeGreaterThanOrEqual(roster.races[i - 1].startMs!);
    const q2 = roster.races.find((r) => r.discipline === "skateboarding" && r.label === "Q2")!;
    expect(q2.profileIds.has(byBib("343").profileId)).toBe(true);
    expect(q2.categories.sort()).toEqual(["ws-men", "ws-women"]);
  });
});

describe("applyFilters", () => {
  it("applies the filters one after another", () => {
    const r = applyFilters(roster, { ...base, disciplines: new Set(["skateboarding"]), query: "peters" });
    expect(r.stages.map((s) => s.label)).toEqual(["Events", "Disciplines", "Races", "Suit", "Search"]);
    const counts = r.stages.map((s) => s.count);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[1]).toBe(107);
    expect(r.athletes.map((a) => a.name)).toEqual(["Lisa Peters"]);
  });
  it("keeps only riders of the selected race range", () => {
    const skate = new Set(["skateboarding"]);
    const sched = applyFilters(roster, { ...base, disciplines: skate }).schedule;
    const q1a = sched.find((r) => r.label === "Q1A")!.id;
    const r = applyFilters(roster, { ...base, disciplines: skate, raceFrom: q1a, raceTo: q1a });
    expect(r.range).toEqual([0, 0]);
    // Lisa Peters and Adrien Paynel have no recorded Q1A run.
    expect(r.athletes.some((a) => a.name === "Lisa Peters")).toBe(false);
    expect(r.stages[2].count).toBe(97);
    const q2 = sched.find((r) => r.label === "Q2")!.id;
    const r2 = applyFilters(roster, { ...base, disciplines: skate, raceFrom: q1a, raceTo: q2 });
    expect(r2.athletes.some((a) => a.name === "Lisa Peters")).toBe(true);
  });
  it("searches by bib (prefix, optional #) and by name without accents", () => {
    expect(applyFilters(roster, { ...base, query: "#343" }).athletes.map((a) => a.name)).toEqual(["Adrien Paynel"]);
    expect(applyFilters(roster, { ...base, query: "machacna" }).athletes.map((a) => a.name)).toEqual(["Mariana Machačná"]);
  });
  it("filters by suit colours per body part", () => {
    const red = applyFilters(roster, { ...base, suit: { chest: ["red"] } });
    expect(red.athletes.length).toBeGreaterThan(0);
    expect(red.athletes.length).toBeLessThan(roster.athletes.size);
    for (const a of red.athletes) expect(a.suitColors).not.toBeNull();
    const redYellowHelmet = applyFilters(roster, { ...base, suit: { chest: ["red"], helmet: ["yellow"] } });
    expect(redYellowHelmet.athletes.length).toBeLessThanOrEqual(red.athletes.length);
    expect(redYellowHelmet.athletes.every((a) => red.athletes.includes(a))).toBe(true);
  });
});

describe("colorNames", () => {
  const n = (hex: string) => [...colorNames(hex)].sort();
  it("names common suit colours", () => {
    expect(n("#171717")).toEqual(["black"]);
    expect(n("#ffffff")).toEqual(["white"]);
    expect(n("#ef4444")).toEqual(["red"]);
    expect(n("#3b82f6")).toEqual(["blue"]);
    expect(n("#facc15")).toEqual(["yellow"]);
    expect(n("#f97316")).toEqual(["orange"]);
    expect(n("#22c55e")).toEqual(["green"]);
    expect(n("#06b6d4")).toEqual(["turquoise"]);
    expect(n("#ec4899")).toEqual(["pink"]);
    expect(n("#60198c")).toEqual(["purple"]);
    expect(n("#71717a")).toEqual(["grey"]);
  });
  it("gives borderline shades more than one name", () => {
    expect(n("#131540")).toEqual(["black", "blue"]);
    expect(n("#5a1f2c")).toContain("brown");
    expect(n("#ffb6c4")).toContain("pink");
  });
});
