import { describe, expect, it } from "vitest";
import { basename, decodePath, encodePath, isInside, join, normalize, parent } from "./path";

describe("path", () => {
  it("normalises", () => {
    expect(normalize("")).toBe("/");
    expect(normalize("a//b/./c/../d/")).toBe("/a/b/d");
  });
  it("joins and splits", () => {
    expect(join("/115", "影片", "a b.mp4")).toBe("/115/影片/a b.mp4");
    expect(parent("/115/影片")).toBe("/115");
    expect(parent("/115")).toBe("/");
    expect(basename("/115/影片")).toBe("影片");
  });
  it("round-trips odd names through the URL", () => {
    const path = "/115/50% off #1?/x";
    expect(encodePath(path)).toBe("/115/50%25%20off%20%231%3F/x");
    expect(decodePath(encodePath(path))).toBe(path);
    expect(encodePath("/")).toBe("/");
  });
  it("keeps undecodable segments", () => {
    expect(decodePath("/a/%E0%A4%A/b")).toBe("/a/%E0%A4%A/b");
  });
  it("tests containment by whole segments", () => {
    expect(isInside("/115/a/b", "/115/a")).toBe(true);
    expect(isInside("/115/ab", "/115/a")).toBe(false);
    expect(isInside("/x", "/")).toBe(true);
  });
});
