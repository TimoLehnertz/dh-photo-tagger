import { describe, expect, it } from "vitest";
import { numbersIn } from "./bibs";

describe("numbersIn", () => {
  it("keeps free-standing digit groups", () => {
    expect(numbersIn("386")).toEqual(["386"]);
    expect(numbersIn("No 12 / 7")).toEqual(["12", "7"]);
    expect(numbersIn("#343")).toEqual(["343"]);
  });
  it("ignores logos, decimals and long numbers", () => {
    expect(numbersIn("ASU26")).toEqual([]);
    expect(numbersIn("WORLDSKATE")).toEqual([]);
    expect(numbersIn("9.81")).toEqual([]);
    expect(numbersIn("123456")).toEqual([]);
  });
  it("reads O and I as digits only inside numeric tokens", () => {
    expect(numbersIn("3O1")).toEqual(["301"]);
    expect(numbersIn("I07")).toEqual(["107"]);
    expect(numbersIn("ROTIN")).toEqual([]);
  });
});
