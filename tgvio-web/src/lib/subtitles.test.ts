import { describe, expect, it } from "vitest";
import { cuesAt, decodeSubtitle, parseCues, subtitlesFor } from "./subtitles";

const file = (name: string) => ({ name, is_dir: false });

describe("subtitlesFor", () => {
  it("takes the files named after the video, Chinese first, ASS before SRT", () => {
    const files = ["Show - S01E01.mkv", "Show - S01E01.eng.srt", "Show - S01E01.chs.srt", "Show - S01E01.chs.ass", "Show - S01E02.mkv", "Show - S01E02.chs.ass"].map(file);
    const tracks = subtitlesFor("Show - S01E01.mkv", files);
    expect(tracks.map(t => t.name)).toEqual(["Show - S01E01.chs.ass", "Show - S01E01.chs.srt", "Show - S01E01.eng.srt"]);
    expect(tracks[0].label).toBe("简体中文");
    expect(tracks[2].label).toBe("English");
  });
  it("gives a lone video every subtitle of its folder", () => {
    expect(subtitlesFor("Movie.mkv", [file("Movie.mkv"), file("简体.srt")]).map(t => t.label)).toEqual(["简体中文"]);
    expect(subtitlesFor("A.mkv", [file("A.mkv"), file("B.mkv"), file("x.srt")])).toEqual([]);
  });
});

describe("decodeSubtitle", () => {
  it("reads UTF-8 with a BOM, UTF-16LE and GB18030", () => {
    expect(decodeSubtitle(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]).buffer)).toBe("a");
    expect(decodeSubtitle(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e]).buffer)).toBe("中");
    expect(decodeSubtitle(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]).buffer)).toBe("中文"); // GBK
  });
});

describe("parseCues", () => {
  it("parses SRT and WebVTT and strips markup", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> {\\an8}there\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nSecond\r\n";
    const cues = parseCues(srt);
    expect(cues).toEqual([{ start: 1, end: 2.5, text: "Hello there" }, { start: 3, end: 4, text: "Second" }]);
    const vtt = "WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nVTT line\n";
    expect(parseCues(vtt)).toEqual([{ start: 1, end: 2, text: "VTT line" }]);
    expect(cuesAt(cues, 2).map(c => c.text)).toEqual(["Hello there"]);
    expect(cuesAt(cues, 2.7)).toEqual([]);
  });
});
