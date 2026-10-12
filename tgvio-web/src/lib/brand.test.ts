import { describe, expect, it } from "vitest";
import { isStockLogo, markLetter } from "./brand";

describe("brand", () => {
  it("spots the stock logo", () => {
    expect(isStockLogo("https://res.oplist.org/logo/logo.svg")).toBe(true);
    expect(isStockLogo("")).toBe(true);
    expect(isStockLogo("https://example.com/me.png")).toBe(false);
  });
  it("takes the first letter", () => {
    expect(markLetter("ppee")).toBe("P");
    expect(markLetter("  片库")).toBe("片");
    expect(markLetter("")).toBe("O");
  });
});
