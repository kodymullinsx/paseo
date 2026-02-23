import { describe, expect, it } from "vitest";
import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";
import { buildConnectionFailureCopy } from "./connection-failure-copy";

describe("buildConnectionFailureCopy", () => {
  it("maps protocol incompatibility to a version mismatch warning", () => {
    const error = new DaemonConnectionTestError("Transport error", {
      reason: "Transport error",
      lastError: "Incompatible protocol version",
    });

    const copy = buildConnectionFailureCopy("localhost:6767", error);

    expect(copy.title).toContain("localhost:6767");
    expect(copy.raw).toContain("Incompatible protocol version");
    expect(copy.detail).toContain("protocol versions are incompatible");
  });

  it("maps timeout failures to timeout-specific guidance", () => {
    const copy = buildConnectionFailureCopy(
      "localhost:6767",
      new Error("Connection timed out after 6s")
    );

    expect(copy.detail).toBe("Connection timed out. Check the host/port and your network.");
  });

  it("maps connection refused failures to daemon availability guidance", () => {
    const copy = buildConnectionFailureCopy(
      "localhost:6767",
      new Error("connect ECONNREFUSED 127.0.0.1:6767")
    );

    expect(copy.detail).toBe("Connection was refused. Is the daemon running on that host and port?");
  });
});
