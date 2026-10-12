import { describe, expect, it } from "vitest";
import { score } from "./Palette";

describe("palette score", () => {
  it("matches each token on its own", () => {
    expect(score("IMG_0001.jpg", "img 1")).toBeGreaterThan(0);
    expect(score("IMG_0001.jpg", "img x")).toBe(-1);
  });
  it("prefers contiguous hits", () => {
    expect(score("report.pdf", "rep")).toBeGreaterThan(score("r-e-p.pdf", "rep"));
  });
});
