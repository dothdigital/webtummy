import { describe, expect, it } from "vitest";
import { isUnsafeNetworkAddress } from "./safePublicFetch.js";

describe("public URL network boundaries", () => {
  it.each(["127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"])("blocks private or reserved IPv4 %s", (address) => {
    expect(isUnsafeNetworkAddress(address)).toBe(true);
  });

  it.each(["::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1"])("blocks private or reserved IPv6 %s", (address) => {
    expect(isUnsafeNetworkAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows public address %s", (address) => {
    expect(isUnsafeNetworkAddress(address)).toBe(false);
  });
});
