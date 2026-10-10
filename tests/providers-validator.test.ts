import { describe, it, expect } from "vitest";
import {
  buildProviderSettingsSchema,
  flattenProviderSettings,
} from "@/server/validators/provider-setting";

describe("buildProviderSettingsSchema", () => {
  const schema = () => buildProviderSettingsSchema("mock");

  it("accepteert geldige input", () => {
    const result = schema().safeParse({
      baseUrl: "https://api.example.com/v1",
      authMode: "basic",
      username: "user1",
      password: "wachtwoord1234",
      defaultOfferId: "OFF-1",
      endpoints: {
        login: "/auth/login",
        sims: "/sims",
        simActivate: "/sims/activate",
      },
    });
    expect(result.success).toBe(true);
  });

  it("weigert ongeldige URL voor baseUrl", () => {
    const r = schema().safeParse({
      baseUrl: "geen-url",
    });
    expect(r.success).toBe(false);
  });

  it("laat baseUrl NIET leeg", () => {
    const r = schema().safeParse({ baseUrl: "" });
    expect(r.success).toBe(false);
  });

  it("authMode accepteert basis-waardes", () => {
    for (const m of ["basic", "bearer", "apikey", "none"] as const) {
      const r = schema().safeParse({
        baseUrl: "https://example.com",
        authMode: m,
      });
      expect(r.success).toBe(true);
    }
    // Ongeldige waarde
    const r2 = schema().safeParse({ baseUrl: "https://x.com", authMode: "oauth" });
    expect(r2.success).toBe(false);
  });

  it("wachtwoord moet minimaal 4 tekens zijn (indien opgegeven)", () => {
    const r = schema().safeParse({
      baseUrl: "https://example.com",
      password: "abc",
    });
    expect(r.success).toBe(false);
    const r2 = schema().safeParse({
      baseUrl: "https://example.com",
      password: "",
    });
    expect(r2.success).toBe(true); // leeg = niet wijzigen
    const r3 = schema().safeParse({
      baseUrl: "https://example.com",
      password: "abcd",
    });
    expect(r3.success).toBe(true);
  });
});

describe("flattenProviderSettings", () => {
  it("maakt endpoints plat (endpoint.login, enz.)", () => {
    const flat = flattenProviderSettings({
      baseUrl: "https://x.com",
      authMode: "basic",
      endpoints: {
        login: "/auth/login",
        sims: "/sims",
        simActivate: "/a",
      },
    } as any);
    expect(flat.baseUrl).toBe("https://x.com");
    expect(flat["endpoint.login"]).toBe("/auth/login");
    expect(flat["endpoint.sims"]).toBe("/sims");
    expect(flat["endpoint.simActivate"]).toBe("/a");
  });

  it("null/undefined fields worden undefined (save stap overslaan)", () => {
    const flat = flattenProviderSettings({
      baseUrl: "https://x.com",
      password: null,
      webhookSecret: undefined,
    } as any);
    expect(flat.password).toBeUndefined();
    expect(flat.webhookSecret).toBeUndefined();
    expect(flat.baseUrl).toBe("https://x.com");
  });
});
