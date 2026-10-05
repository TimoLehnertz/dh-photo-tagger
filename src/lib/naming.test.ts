import { describe, expect, it } from "vitest";
import { athleteLabel, isImageName, parseSidecar, resolveOriginals, splitExt, taggedFileName } from "./naming";

describe("naming", () => {
  it("builds tagged file names, keeping extension case", () => {
    expect(taggedFileName("03_10_DOWNHILL_SKB_TIMETRIAL-0271.jpg", ["Enric-Umbert"])).toBe(
      "03_10_DOWNHILL_SKB_TIMETRIAL-0271_Enric-Umbert.jpg",
    );
    expect(taggedFileName("IMG.JPG", ["A-B", "C-D"])).toBe("IMG_A-B_C-D.JPG");
    expect(taggedFileName("IMG.JPG", [])).toBe("IMG.JPG");
  });
  it("makes names file-system safe", () => {
    expect(athleteLabel("Enric", "Umbert")).toBe("Enric-Umbert");
    expect(athleteLabel("José María", "Ñúñez/López")).toBe("Jose-Maria-Nunez-Lopez");
    expect(athleteLabel(" Max ", "Groß")).toBe("Max-Gross");
  });
  it("recognises image files case-insensitively", () => {
    expect(isImageName("a.JPG")).toBe(true);
    expect(isImageName("a.jpeg")).toBe(true);
    expect(isImageName("a.txt")).toBe(false);
    expect(isImageName(".hidden")).toBe(false);
    expect(splitExt("a.b.c")).toEqual({ stem: "a.b", ext: ".c" });
  });
  it("maps renamed files back to originals", () => {
    const sc = parseSidecar(JSON.stringify({ version: 1, files: { "a.jpg": { current: "a_X-Y.jpg", picks: ["p1"], names: ["X Y"] } } }));
    const m = resolveOriginals(["a_X-Y.jpg", "b.jpg"], sc);
    expect(m.get("a_X-Y.jpg")?.original).toBe("a.jpg");
    expect(m.get("a_X-Y.jpg")?.entry?.picks).toEqual(["p1"]);
    expect(m.get("b.jpg")).toEqual({ original: "b.jpg" });
    expect(parseSidecar("not json").files).toEqual({});
  });
});
