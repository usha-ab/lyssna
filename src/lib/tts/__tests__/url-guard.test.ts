import { describe, it, expect } from "vitest";
import { checkUrl, isPrivateAddress, isBlockedHostname } from "../url-guard";

describe("isPrivateAddress", () => {
  it("känner igen privata IPv4-intervall", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255",
                      "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("släpper igenom publika IPv4-adresser", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "93.184.216.34"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("känner igen privata IPv6-adresser", () => {
    for (const ip of ["::1", "[::1]", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("släpper igenom publika IPv6-adresser", () => {
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("avvisar ogiltiga IPv4-adresser i stället för att gissa", () => {
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
  });
});

describe("isBlockedHostname", () => {
  it("blockerar localhost och interna domäner", () => {
    for (const host of ["localhost", "app.localhost", "db.local", "svc.internal",
                        "metadata.google.internal"]) {
      expect(isBlockedHostname(host), host).toBe(true);
    }
  });

  it("släpper igenom vanliga domäner", () => {
    expect(isBlockedHostname("usha.se")).toBe(false);
    expect(isBlockedHostname("www.dn.se")).toBe(false);
  });
});

describe("checkUrl", () => {
  it("godkänner en vanlig artikeladress", () => {
    const result = checkUrl(" https://usha.se/artikel ");
    expect(result.ok).toBe(true);
  });

  it("avvisar andra protokoll", () => {
    expect(checkUrl("file:///etc/passwd")).toEqual({ ok: false, reason: "protocol" });
    expect(checkUrl("javascript:alert(1)")).toEqual({ ok: false, reason: "protocol" });
  });

  it("avvisar adresser med inloggningsuppgifter", () => {
    expect(checkUrl("https://user:pass@example.com")).toEqual({ ok: false, reason: "credentials" });
  });

  it("avvisar interna adresser", () => {
    expect(checkUrl("http://169.254.169.254/latest/meta-data/")).toEqual({ ok: false, reason: "private" });
    expect(checkUrl("http://localhost:3000/api")).toEqual({ ok: false, reason: "private" });
  });

  it("avvisar tjänsteportar", () => {
    expect(checkUrl("http://example.com:5432/")).toEqual({ ok: false, reason: "port" });
  });

  it("avvisar text som inte är en adress", () => {
    expect(checkUrl("inte en url")).toEqual({ ok: false, reason: "invalid" });
  });
});
