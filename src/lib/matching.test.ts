import { describe, expect, it } from "vitest";
import type { EventData } from "./api";
import { buildMatchModel, clearWinner, expectedPassMs, fitOffsetToPicks, rankCandidates, suggestOffset, type RunWindow } from "./matching";
import { parseExifDateTime, wallTimeToUtcMs } from "./time";
import fixture from "./fixtures/asu26.json";
import exif from "../../test-images/exif.json";

const data = fixture as unknown as EventData;
const model = buildMatchModel(data);
const skate = new Set(["skateboarding"]);
const photoMs = (exif as { DateTimeOriginal: string; SubSecTimeOriginal: string }[]).map((e) =>
  wallTimeToUtcMs(parseExifDateTime(e.DateTimeOriginal, e.SubSecTimeOriginal)!, "America/Asuncion"),
);

describe("buildMatchModel", () => {
  it("builds athletes and run windows from the ASU26 snapshot", () => {
    expect(model.athletes.size).toBeGreaterThan(150);
    expect(model.windows.length).toBe(data.runs.length);
    const w = model.windows[0];
    expect(w.endMs - w.startMs).toBeGreaterThan(30_000);
    // Windows are sorted by start time.
    for (let i = 1; i < model.windows.length; i++) expect(model.windows[i].startMs).toBeGreaterThanOrEqual(model.windows[i - 1].startMs);
  });
  it("derives a plausible split fraction from run_splits", () => {
    const f = model.splitFraction.get("skateboarding")!;
    expect(f).toBeGreaterThan(0.3);
    expect(f).toBeLessThan(0.6);
    expect(model.windows.some((w) => w.splitMs !== null)).toBe(true);
  });
  it("treats riders without suit colors as null", () => {
    expect([...model.athletes.values()].some((a) => a.suitColors === null)).toBe(true);
    expect([...model.athletes.values()].some((a) => a.suitColors?.helmet)).toBe(true);
  });
});

describe("expectedPassMs", () => {
  const w: RunWindow = { id: "x", kind: "qualifying", profileIds: ["p"], discipline: "d", category: null, label: "", startMs: 0, endMs: 100_000, splitMs: 30_000, dnf: false };
  it("is linear without split info", () => {
    expect(expectedPassMs({ ...w, splitMs: null }, 0.5, 0.4)).toBe(50_000);
  });
  it("is piecewise around the split", () => {
    expect(expectedPassMs(w, 0.4, 0.4)).toBe(30_000);
    expect(expectedPassMs(w, 0.2, 0.4)).toBe(15_000);
    expect(expectedPassMs(w, 1, 0.4)).toBe(100_000);
  });
});

describe("suggestOffset", () => {
  it("finds the sample camera's clock error (~36 min fast)", () => {
    const s = suggestOffset(photoMs, model.windows, skate)!;
    expect(s.offsetMs).toBeLessThan(-33 * 60_000);
    expect(s.offsetMs).toBeGreaterThan(-39 * 60_000);
    expect(s.matched).toBeGreaterThanOrEqual(25);
    // Uncorrected, very few photos fall inside a run.
    const inside = photoMs.filter((t) => rankCandidates(t, model, { disciplines: skate, position: null, toleranceMs: 1 }).some((c) => c.score > 0.99));
    expect(inside.length).toBeLessThan(10);
  });
  it("recovers a synthetic offset", () => {
    const truth = model.windows.filter((w) => w.discipline === "skateboarding").slice(0, 40).map((w) => (w.startMs + w.endMs) / 2);
    const shifted = truth.map((t) => t + 17 * 60_000);
    const s = suggestOffset(shifted, model.windows, skate)!;
    expect(s.matched).toBe(40);
    // Overlapping riders make a band of offsets equally good; it should still be within ~2 min.
    expect(Math.abs(s.offsetMs + 17 * 60_000)).toBeLessThan(120_000);
  });
  it("returns null without data", () => {
    expect(suggestOffset([], model.windows, skate)).toBeNull();
    expect(suggestOffset(photoMs, model.windows, new Set())).toBeNull();
  });
});

describe("rankCandidates", () => {
  it("ranks the rider whose run contains the photo first", () => {
    const w = model.windows.find((w) => w.discipline === "skateboarding" && w.splitMs !== null)!;
    const t = expectedPassMs(w, 0.5, model.splitFraction.get("skateboarding"));
    const c = rankCandidates(t, model, { disciplines: skate, position: 0.5, toleranceMs: 3000 });
    expect(c[0].profileId).toBe(w.profileIds[0]);
    expect(c[0].score).toBeCloseTo(1, 5);
    expect(c[0].runFraction).toBeGreaterThan(0.3);
  });
  it("lists several riders on course when position is unknown", () => {
    const s = suggestOffset(photoMs, model.windows, skate)!;
    const counts = photoMs.map((t) => rankCandidates(t + s.offsetMs, model, { disciplines: skate, position: null, toleranceMs: 15_000 }).filter((c) => c.score > 0.99).length);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(3);
  });
  it("respects the discipline filter", () => {
    const w = model.windows.find((w) => w.discipline === "inline")!;
    expect(rankCandidates(w.startMs + 1000, model, { disciplines: skate, position: null, toleranceMs: 1000 }).every((c) => c.window.discipline === "skateboarding")).toBe(true);
  });
});

describe("clearWinner", () => {
  const w = model.windows[0];
  const c = (score: number) => ({ profileId: String(score), score, window: w, deltaMs: 0, runFraction: 0.5, clipOffsetMs: 0 });
  it("only picks a clearly leading candidate", () => {
    expect(clearWinner([c(0.9), c(0.2)])?.score).toBe(0.9);
    expect(clearWinner([c(0.9), c(0.8)])).toBeNull();
    expect(clearWinner([c(0.3)])).toBeNull();
    expect(clearWinner([])).toBeNull();
  });
});

describe("fitOffsetToPicks", () => {
  it("finds an offset consistent with all confirmed picks", () => {
    const ws = model.windows.filter((w) => w.discipline === "skateboarding").slice(10, 13);
    const pairs = ws.map((w) => ({ window: w, media: (w.startMs + w.endMs) / 2 + 600_000 }));
    const off = fitOffsetToPicks(pairs, null, model)!;
    for (const p of pairs) {
      expect(p.media + off).toBeGreaterThanOrEqual(p.window.startMs);
      expect(p.media + off).toBeLessThanOrEqual(p.window.endMs);
    }
    expect(fitOffsetToPicks([], null, model)).toBeNull();
  });
});

describe("video clips (time spans)", () => {
  const w = model.windows.find((w) => w.discipline === "skateboarding" && w.endMs - w.startMs > 60_000)!;
  const opts = { disciplines: skate, position: null, toleranceMs: 2000 };

  it("matches a rider whose run overlaps any part of the clip", () => {
    // Clip starts 30 s before the run and ends 5 s into it.
    const clip = { startMs: w.startMs - 30_000, durationMs: 35_000 };
    const c = rankCandidates(clip, model, opts, 50).find((c) => c.profileId === w.profileIds[0])!;
    expect(c.score).toBe(1);
    expect(c.deltaMs).toBe(0);
    // The rider appears once their run starts, 30 s into the clip.
    expect(c.clipOffsetMs).toBe(30_000);
    expect(c.runFraction).toBeCloseTo(0, 5);
  });

  it("does not match a clip that ended long before the run", () => {
    const clip = { startMs: w.startMs - 90_000, durationMs: 30_000 };
    expect(rankCandidates(clip, model, opts, 50).some((c) => c.window === w)).toBe(false);
  });

  it("tells you when in the clip a rider passes a known position", () => {
    const e = expectedPassMs(w, 0.5, model.splitFraction.get("skateboarding"));
    const clip = { startMs: e - 12_000, durationMs: 60_000 };
    const c = rankCandidates(clip, model, { ...opts, position: 0.5 }, 50).find((c) => c.window === w)!;
    expect(c.score).toBe(1);
    expect(c.clipOffsetMs).toBe(12_000);
  });

  it("finds the clock offset with clips as well as photos", () => {
    // Clips spread over the whole day, as real footage is (session gaps make the offset unambiguous).
    const runs = model.windows.filter((w) => w.discipline === "skateboarding").filter((_, i) => i % 6 === 0).slice(0, 30);
    const clips = runs.map((w) => ({ startMs: w.startMs + 20 * 60_000 - 5_000, durationMs: 10_000 }));
    const s = suggestOffset(clips, model.windows, skate)!;
    expect(s.matched).toBe(30);
    expect(Math.abs(s.offsetMs + 20 * 60_000)).toBeLessThan(120_000);
  });

  it("fits the offset to a tagged clip", () => {
    const off = fitOffsetToPicks([{ media: { startMs: w.endMs + 600_000, durationMs: 20_000 }, window: w }], null, model)!;
    const start = w.endMs + 600_000 + off;
    expect(start + 20_000).toBeGreaterThanOrEqual(w.startMs);
    expect(start).toBeLessThanOrEqual(w.endMs);
  });
});
