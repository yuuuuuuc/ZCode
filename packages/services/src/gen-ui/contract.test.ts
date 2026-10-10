import { describe, expect, it } from "vitest";
import { exampleGenUiPrepare } from "./contract.example.js";
import { IGenUiService } from "./contract.js";

describe("gen-ui-service contract", () => {
  it("描述符绑定 gen-ui 频道", () => {
    expect(IGenUiService.channelName).toBe("gen-ui");
  });

  it("example prepare 参数保留 instanceKey 与 html", () => {
    expect(exampleGenUiPrepare.instanceKey).toBeTruthy();
    expect(exampleGenUiPrepare.html).toContain("chart");
  });
});
