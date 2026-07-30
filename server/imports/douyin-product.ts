import { mkdirSync } from "node:fs";
import { join } from "node:path";

const productHosts = new Set(["v.douyin.com", "haohuo.jinritemai.com", "fxg.jinritemai.com"]);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export class DouyinProductPreviewError extends Error {
  constructor(
    readonly code:
      | "INVALID_PRODUCT_LINK"
      | "PRODUCT_LINK_UNAVAILABLE"
      | "PRODUCT_METADATA_UNAVAILABLE"
      | "PRODUCT_IMAGE_INVALID",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface DouyinProductPreviewImage {
  id: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
}
export interface DouyinProductPreview {
  id: string;
  title: string;
  images: DouyinProductPreviewImage[];
}
type StoredImage = DouyinProductPreviewImage & { bytes: Uint8Array };
type StoredPreview = DouyinProductPreview & { owner: string; expiresAt: number; stored: StoredImage[] };

function allowed(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && productHosts.has(parsed.hostname);
  } catch {
    return false;
  }
}
function extractDouyinUrl(input: string) {
  const direct = input.trim();
  if (allowed(direct)) return direct;
  const match = input.match(/https:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?(?:\?[^\s\])}]+)?/i);
  return match?.[0];
}
function mime(bytes: Uint8Array): DouyinProductPreviewImage["mimeType"] | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
}

async function render(url: string) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const images: string[] = [];
    page.on("response", (response) => {
      const image = response.url();
      if (
        response.request().resourceType() === "image" &&
        /^https:\/\/p\d+-item\.(?:ecombdimg|byteimg)\.com\/img\/ecom-shop-material\//.test(image)
      )
        images.push(image);
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4_000);
    for (let index = 0; index < 4 && new Set(images).size < 5; index += 1) {
      try {
        await page.mouse.move(320, 250);
        await page.mouse.down();
        await page.mouse.move(70, 250, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(700);
      } catch {
        // The main images already loaded remain valid when a page blocks synthetic gestures.
        break;
      }
    }
    const title = await page.evaluate(() => {
      const goodsDetail = new URL(location.href).searchParams.get("goods_detail");
      if (goodsDetail) {
        try {
          const parsed = JSON.parse(decodeURIComponent(goodsDetail)) as { title?: unknown };
          if (typeof parsed.title === "string" && parsed.title.trim()) return parsed.title.trim();
        } catch {
          // Fall through to the rendered-page text when this share link omits structured details.
        }
      }
      return document.body.innerText
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("【抖音商城】"));
    });
    const unique = [...new Set(images)].slice(0, 5);
    if (!allowed(page.url()) || !title || !unique.length)
      throw new DouyinProductPreviewError("PRODUCT_METADATA_UNAVAILABLE", "未识别到商品标题或主图", false);
    return { title, images: unique };
  } finally {
    await browser.close();
  }
}

export class DouyinProductPreviewService {
  private previews = new Map<string, StoredPreview>();
  constructor(private readonly dataDir: string) {}
  async create(owner: string, url: string): Promise<DouyinProductPreview> {
    const productUrl = extractDouyinUrl(url);
    if (!productUrl || !allowed(productUrl))
      throw new DouyinProductPreviewError("INVALID_PRODUCT_LINK", "请粘贴抖音商品链接或完整分享文案", false);
    let rendered: { title: string; images: string[] };
    try {
      rendered = await render(productUrl);
    } catch (error) {
      if (error instanceof DouyinProductPreviewError) throw error;
      throw new DouyinProductPreviewError("PRODUCT_LINK_UNAVAILABLE", "抖音商品链接无法访问", true);
    }
    const id = crypto.randomUUID();
    const stored: StoredImage[] = [];
    for (const [index, imageUrl] of rendered.images.entries()) {
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const type = mime(bytes);
      if (!response.ok || !type || !imageTypes.has(type) || bytes.byteLength > 20 * 1024 * 1024)
        throw new DouyinProductPreviewError("PRODUCT_IMAGE_INVALID", "商品主图格式无效", false);
      const extension = type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
      const image = {
        id: crypto.randomUUID(),
        name: `${index + 1}.${extension}`,
        mimeType: type,
        size: bytes.byteLength,
        bytes,
      } as StoredImage;
      stored.push(image);
      const directory = join(this.dataDir, "uploads", "product-previews", id);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      await Bun.write(join(directory, image.name), bytes);
    }
    const preview = {
      id,
      title: rendered.title.slice(0, 200),
      images: stored.map(({ bytes: _, ...image }) => image),
      owner,
      expiresAt: Date.now() + 15 * 60_000,
      stored,
    };
    this.previews.set(id, preview);
    return { id, title: preview.title, images: preview.images };
  }
  getImage(owner: string, previewId: string, imageId: string) {
    const preview = this.previews.get(previewId);
    return preview?.owner === owner && preview.expiresAt > Date.now()
      ? preview.stored.find((image) => image.id === imageId)
      : undefined;
  }
}
