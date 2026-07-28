import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { downloadAttachment } from "../../web/api/api-client";

const window = new Window();
let originalFetch: typeof globalThis.fetch;
let originalClick: typeof window.HTMLAnchorElement.prototype.click;

beforeAll(() => {
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLAnchorElement: window.HTMLAnchorElement,
  });
  originalFetch = globalThis.fetch;
  originalClick = window.HTMLAnchorElement.prototype.click;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.HTMLAnchorElement.prototype.click = originalClick;
  window.localStorage.clear();
  document.body.replaceChildren();
});

describe("attachment download client", () => {
  test("requests one signed ticket and navigates to it without fetching the attachment body", async () => {
    window.localStorage.setItem("yaozuo:auth-token:v1", "unit-test-token");
    const requests: Array<{ url: string; method: string; authorization: string | null; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      });
      return new Response(
        JSON.stringify({
          url: "/api/downloads/signed.ticket.value",
          expiresAt: "2026-07-28T12:00:00.000Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    let clickedHref = "";
    window.HTMLAnchorElement.prototype.click = function click() {
      clickedHref = this.href;
    };

    await downloadAttachment({
      kind: "job-text",
      jobId: "00000000-0000-4000-8000-000000000001",
    });

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:8787/api/downloads/tickets",
        method: "POST",
        authorization: "Bearer unit-test-token",
        body: '{"kind":"job-text","jobId":"00000000-0000-4000-8000-000000000001"}',
      },
    ]);
    expect(clickedHref).toBe("http://127.0.0.1:8787/api/downloads/signed.ticket.value");
  });
});
