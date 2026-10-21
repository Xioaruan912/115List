import { describe, expect, it } from "vitest";
import { needsOrganizing } from "./organized";
import type { Obj } from "./types";

const obj = (name: string, is_dir = false): Obj => ({ name, is_dir, size: 0, modified: "", created: "", sign: "", thumb: "", type: 0, hashinfo: "" });
const none = new Set<string>();

describe("needsOrganizing", () => {
  it("compares with the name the server says it should have", () => {
    expect(needsOrganizing(obj("校外 第一季 (2026)", true), "校外 第一季 (2026)", none)).toBe(false);
    expect(needsOrganizing(obj("犯罪现场", true), "犯罪现场 (1986)", none)).toBe(true);
    expect(needsOrganizing(obj("数学建模", true), "", none)).toBe(true);
    expect(needsOrganizing(obj("盗梦空间 (2010).mkv"), "盗梦空间 (2010).mkv", none)).toBe(false);
    expect(needsOrganizing(obj("Inception.2010.1080p.mkv"), "盗梦空间 (2010).mkv", none)).toBe(true);
  });
  it("judges episodes by their own names", () => {
    expect(needsOrganizing(obj("潜伏 - S01E05 - 第五集.mp4"), "~", none)).toBe(false);
    expect(needsOrganizing(obj("Lurk.E05.1080p.mp4"), "~", none)).toBe(true);
  });
  it("follows the server's pending and done marks, and ignores side files", () => {
    expect(needsOrganizing(obj("潜伏 (2009)", true), "潜伏 (2009)", new Set(["潜伏 (2009)"]))).toBe(true);
    expect(needsOrganizing(obj("蜘蛛侠系列 (三部曲)", true), "蜘蛛侠 (2002)", none, new Set(["蜘蛛侠系列 (三部曲)"]))).toBe(false);
    expect(needsOrganizing(obj("盗梦空间 (2010).chs.srt"), undefined, none)).toBe(false);
    expect(needsOrganizing(obj("还没查", true), undefined, none)).toBe(false);
  });
});
