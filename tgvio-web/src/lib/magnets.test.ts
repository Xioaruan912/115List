// @vitest-environment jsdom
import { describe as group, expect, it } from "vitest";
import { describe, folderName, fromHTML, fromList, fromSeed, fromText, parseSize, rank, seriesName } from "./magnets";

const H1 = "0f8210b19b5d9bae385aceaba5e6abfe66e12cfb";
const H2 = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
const H3 = "ffffffffffffffffffffffffffffffffffffffff";

group("magnets", () => {
  it("reads sizes", () => {
    expect(parseSize("12.5 GB")).toBe(Math.round(12.5 * 2 ** 30));
    expect(parseSize("800MB")).toBe(800 * 2 ** 20);
    expect(parseSize("no size")).toBeUndefined();
    expect(parseSize("Lurk 4K HDR")).toBeUndefined();
    expect(parseSize("900KB")).toBe(900 * 2 ** 10);
  });

  it("puts Chinese subtitles first", () => {
    const items = rank(fromText([
      `潜伏.Lurk.2009.E01.1080p.WEB-DL 2.1GB magnet:?xt=urn:btih:${H1}`,
      `潜伏.2009.全30集.国语中字.1080p.WEB-DL magnet:?xt=urn:btih:${H2}&dn=x`,
      `Lurk.2009.2160p.WEB-DL magnet:?xt=urn:btih:${H3}`,
    ].join("\n")));
    expect(items.map(item => item.hash)).toEqual([H2, H3, H1]);
  });

  it("takes the title from dn when there is one", () => {
    const [item] = fromText(`magnet:?xt=urn:btih:${H1}&dn=${encodeURIComponent("潜伏 全30集 简繁中字")}&xl=1073741824`);
    expect(item.title).toBe("潜伏 全30集 简繁中字");
    expect(item.size).toBe(2 ** 30);
    expect(item.tags).toContain("中字");
    expect(item.collection).toBe(true);
  });

  it("drops repeats of the same hash", () => {
    expect(rank(fromText(`a magnet:?xt=urn:btih:${H1}\nb magnet:?xt=urn:btih:${H1.toUpperCase()}`))).toHaveLength(1);
  });

  it("tells a season pack from an episode", () => {
    expect(describe("Lurk.S01.1080p").collection).toBe(true);
    expect(describe("Lurk.S01E05.1080p").collection).toBe(false);
    expect(describe("潜伏 第一季").collection).toBe(true);
    expect(describe("潜伏 第5集").collection).toBe(false);
    expect(describe("Lurk.S01-S03.Complete").collection).toBe(true);
    expect(describe("潜伏.2009.EP01-30.HD1080P").collection).toBe(true);
  });

  it("reads a copied web page", () => {
    const html = `<ul class="seeds">
      <li><a href="magnet:?xt=urn:btih:${H1}" title="潜伏.2009.1080p.简繁中字">潜伏</a><span class="size">35.2 GB</span><span class="seed-feature">1080P</span></li>
      <li><a href="magnet:?xt=urn:btih:${H2}" title="Lurk.2009.720p">Lurk</a><span class="size">8 GB</span></li>
    </ul>`;
    const items = rank(fromHTML(html));
    expect(items[0].hash).toBe(H1);
    expect(items[0].title).toBe("潜伏.2009.1080p.简繁中字");
    expect(items[0].size).toBe(Math.round(35.2 * 2 ** 30));
  });

  it("reads a bookmarklet list", () => {
    const [item] = fromList([{ u: `magnet:?xt=urn:btih:${H1}`, t: "潜伏 国语", x: "潜伏 国语 20GB" }]);
    expect(item.tags).toContain("国语");
    expect(item.size).toBe(20 * 2 ** 30);
  });

  it("reads a server-read seed", () => {
    const item = fromSeed("seedhub", { id: "11", title: "潜伏[全30集][国语配音+中文字幕].Lurk.S01.2160p", size: "174.33G", features: ["4K"] });
    expect(item.tags).toEqual(expect.arrayContaining(["中字", "国语", "4K", "合集"]));
    expect(item.size).toBe(Math.round(174.33 * 2 ** 30));
    expect(item.url).toBe("");
  });

  it("names a series folder after what the titles share", () => {
    expect(seriesName(["招魂", "招魂2", "招魂3：恶魔迫我"])).toBe("招魂");
    expect(seriesName(["蜘蛛侠", "神探夏洛克"])).toBe("蜘蛛侠");
  });

  it("names folders the library can match", () => {
    expect(folderName("潜伏: 特别版", 2009)).toBe("潜伏 特别版 (2009)");
  });
});
