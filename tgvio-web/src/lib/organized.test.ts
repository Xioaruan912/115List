import { describe, expect, it } from "vitest";
import type { Poster } from "../api/posters";
import { needsOrganizing, safeName } from "./organized";
import type { Obj } from "./types";

const obj = (name: string, is_dir = false): Obj => ({ name, is_dir, size: 0, modified: "", created: "", sign: "", thumb: "", type: 0, hashinfo: "" });
const poster = (title: string, year?: number, kind: "movie" | "tv" = "movie"): Poster => ({ kind, id: 1, title, year });
const none = new Set<string>();

describe("needsOrganizing", () => {
  it("passes folders named the TMDB way", () => {
    expect(needsOrganizing(obj("潜伏 (2009)", true), poster("潜伏", 2009, "tv"), none)).toBe(false);
    expect(needsOrganizing(obj("爱情公寓 第二季 (2011)", true), poster("爱情公寓", 2009, "tv"), none)).toBe(false);
    expect(needsOrganizing(obj("星球大战：曼达洛人与古古 (2026)", true), poster("星球大战: 曼达洛人与古古", 2026), none)).toBe(false);
  });
  it("flags release names, unmatched folders and pending downloads", () => {
    expect(needsOrganizing(obj("Lurk.S01.2160p.WEB-DL", true), poster("潜伏", 2009, "tv"), none)).toBe(true);
    expect(needsOrganizing(obj("数学建模", true), undefined, none)).toBe(true);
    expect(needsOrganizing(obj("犯罪现场", true), poster("犯罪现场", 1986), none)).toBe(true);
    expect(needsOrganizing(obj("葬送的芙莉莲 第二季", true), poster("葬送的芙莉莲", 2023, "tv"), none)).toBe(true);
    expect(needsOrganizing(obj("潜伏 (2009)", true), poster("潜伏", 2009, "tv"), new Set(["潜伏 (2009)"]))).toBe(true);
    // A collection folder that went through 按 TMDB 整理命名 keeps its name and counts as organized.
    expect(needsOrganizing(obj("蜘蛛侠系列 (三部曲)", true), poster("蜘蛛侠", 2002), none, new Set(["蜘蛛侠系列 (三部曲)"]))).toBe(false);
  });
  it("checks videos by film and episode names, ignores side files", () => {
    expect(needsOrganizing(obj("盗梦空间 (2010).mkv"), poster("盗梦空间", 2010), none)).toBe(false);
    expect(needsOrganizing(obj("Inception.2010.1080p.mkv"), poster("盗梦空间", 2010), none)).toBe(true);
    expect(needsOrganizing(obj("潜伏 - S01E05 - 第五集.mp4"), undefined, none)).toBe(false);
    expect(needsOrganizing(obj("盗梦空间 (2010).chs.srt"), undefined, none)).toBe(false);
  });
  it("cleans names like the server", () => {
    expect(safeName(' a: b? "c" ')).toBe("a： b？ 'c'");
  });
});
