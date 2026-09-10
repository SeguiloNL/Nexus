import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InserveClient, InserveApiError } from "@/server/integrations/inserve/client";

describe("InserveClient", () => {
  let fetchSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch" as any);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("a) headers: X-Api-Key + Content-Type JSON", () => {
    it("voegt X-Api-Key header en Content-Type JSON toe, en logt geen key", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }) as any
      );

      const client = new InserveClient("test", "key-abc");
      await client.request("/ping", { method: "GET" });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(calledUrl).toContain("/api/ping");
      expect(calledUrl).toBe("https://test.inserve.nl/api/ping");

      const headers = calledInit.headers as Record<string, string>;
      expect(headers["X-Api-Key"]).toBe("key-abc");
      expect(headers["Content-Type"]).toBe("application/json");

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("b) InserveApiError bij niet-2xx response", () => {
    it("gooit InserveApiError bij 404 met correcte statusCode en responseBody", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json" },
        }) as any
      );

      const client = new InserveClient("test", "key-abc");

      await expect(client.request("/weg")).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(InserveApiError);
        const apiErr = err as InserveApiError;
        expect(apiErr.statusCode).toBe(404);
        expect((apiErr.responseBody as any).message).toBe("Not Found");
        return true;
      });
    });
  });

  describe("c) retry 1x bij 5xx ALLEEN voor GET", () => {
    it("GET /items: retry na 500, tweede call 200 → totaal 2 calls", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "Server Error" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }) as any
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }) as any
        );

      const client = new InserveClient("test", "key-abc");
      const result = await client.request("/items", { method: "GET" });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: [] });
    });

    it("POST /items: 500 → direct falen, GEEN retry (slechts 1 call)", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ error: "Server Error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }) as any
      );

      const client = new InserveClient("test", "key-abc");

      await expect(
        client.request("/items", { method: "POST", body: { name: "x" } })
      ).rejects.toBeInstanceOf(InserveApiError);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("d) retry bij 429 met Retry-After header", () => {
    it("429 met Retry-After=1 → wacht en probeer opnieuw (2x fetch)", async () => {
      vi.useFakeTimers();

      const response429 = new Response(JSON.stringify({ message: "Too Many Requests" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "Retry-After": "1",
        },
      });

      const response200 = new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

      fetchSpy
        .mockResolvedValueOnce(response429 as any)
        .mockResolvedValueOnce(response200 as any);

      const client = new InserveClient("test", "key-abc");
      const reqPromise = client.request("/items", { method: "GET" });

      await vi.runAllTimersAsync();
      const result = await reqPromise;

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true });

      vi.useRealTimers();
    });
  });
});
