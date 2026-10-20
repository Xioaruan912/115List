import { describe, expect, it } from "vitest";
import { taskName } from "./taskName";

describe("taskName", () => {
  it("names downloads by the magnet's dn or the file", () => {
    expect(taskName("download magnet:?xt=urn:btih:0F8210B19B5D9BAE385ACEABA5E6ABFE66E12CFB&dn=%E6%BD%9C%E4%BC%8F to (/115/我要看/潜伏 (2009))")).toBe("下载 潜伏 到 /115/我要看/潜伏 (2009)");
    expect(taskName("download magnet:?xt=urn:btih:0F8210B19B5D9BAE385ACEABA5E6ABFE66E12CFB to (/115)")).toBe("下载 磁力 0f8210b1… 到 /115");
    expect(taskName("download http://127.0.0.1:5399/slow.bin to (/本地/空文件夹)")).toBe("下载 slow.bin 到 /本地/空文件夹");
  });
  it("hides temp paths and mount brackets", () => {
    expect(taskName("transfer [](/root/data/temp/SimpleHttp/6cb/slow.bin) to [/本地](/空文件夹)")).toBe("转存 slow.bin 到 /本地/空文件夹");
    expect(taskName("copy [/本地](/影片/a.mp4) to [/备份](/)")).toBe("复制 a.mp4 到 /备份");
    expect(taskName("upload a.zip to [/115](/软件)")).toBe("上传 a.zip 到 /115/软件");
  });
  it("never shows an archive password", () => {
    const name = taskName("decompress [/本地](/压缩包/素材合集.zip)[/] to [/本地](/压缩包) with password <s3cret>");
    expect(name).toBe("解压 素材合集.zip 到 /本地/压缩包");
    expect(taskName("something odd with password <s3cret>")).not.toContain("s3cret");
  });
});
