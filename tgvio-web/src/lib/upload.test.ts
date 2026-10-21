import { describe, expect, it } from "vitest";
import { missingChunks } from "./upload";

describe("missingChunks", () => {
  it("lists every chunk for a fresh session", () => {
    expect(missingChunks({ total_chunks: 4, received: [] })).toEqual([0, 1, 2, 3]);
  });
  it("skips received ranges, inclusive on both ends", () => {
    expect(missingChunks({ total_chunks: 8, received: [[0, 2], [5, 5]] })).toEqual([3, 4, 6, 7]);
  });
  it("ignores ranges past the end", () => {
    expect(missingChunks({ total_chunks: 3, received: [[1, 9]] })).toEqual([0]);
  });
});
