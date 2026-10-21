import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { explain } from "./errors";

describe("explain", () => {
  it("turns driver errors into plain words", () => {
    const iso = explain(new ApiError(500, "failed to list archive [/a/大话西游.iso]/: UDF volumes are not supported: UDF volumes are not supported"));
    expect(iso.title).toBe("这个光盘镜像打不开");
    expect(iso.retry).toBe(false);
    expect(explain(new Error("Post \"https://proapi.115.com/app/uploadinfo\": net/http: TLS handshake timeout")).title).toBe("网盘连接不稳定");
    expect(explain(new ApiError(500, "object not found")).title).toBe("找不到这个文件");
    expect(explain(new ApiError(500, "wrong archive password")).title).toBe("压缩包密码不对");
    expect(explain(new TypeError("Failed to fetch")).title).toBe("网络断开了");
  });
  it("never echoes the raw message", () => {
    const raw = "something odd happened at /secret/path";
    const result = explain(new ApiError(500, raw));
    expect(result.title + result.hint).not.toContain("/secret/path");
    expect(result.raw).toBe(raw);
  });
});
