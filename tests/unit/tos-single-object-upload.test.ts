import { describe, expect, test } from "bun:test";
import { type LibraryObjectUploadClient, putLibraryObject } from "../../server/storage/ossutils";

function client(input: {
  upload?: LibraryObjectUploadClient["putObjectFromFile"];
  head?: LibraryObjectUploadClient["headObject"];
  remove?: LibraryObjectUploadClient["deleteObject"];
}) {
  return {
    putObjectFromFile: input.upload ?? (async () => ({})),
    headObject:
      input.head ??
      (async () => ({
        headers: {
          "content-length": "1024",
          "x-tos-server-side-encryption": "AES256",
        },
      })),
    deleteObject: input.remove ?? (async () => ({})),
  } satisfies LibraryObjectUploadClient;
}

describe("TOS single-object library upload", () => {
  test("uploads one file without multipart and verifies the stored object", async () => {
    const calls: string[] = [];
    const progress: number[] = [];

    await putLibraryObject(
      client({
        upload: async (input) => {
          calls.push(`put:${input.key}`);
          input.progress?.(0.5);
          input.progress?.(1);
          return {};
        },
        head: async (input) => {
          calls.push(`head:${input.key}`);
          return {
            headers: {
              "content-length": "1024",
              "x-tos-server-side-encryption": "AES256",
            },
          };
        },
      }),
      {
        bucket: "bucket",
        filePath: "/tmp/result.mp4",
        key: "results/result.mp4",
        mimeType: "video/mp4",
        sizeBytes: 1024,
        onProgress: (percent) => progress.push(percent),
      },
    );

    expect(calls).toEqual(["put:results/result.mp4", "head:results/result.mp4"]);
    expect(progress).toEqual([0.5, 1]);
  });

  test("deletes an invalid object when post-upload verification fails", async () => {
    const removed: string[] = [];

    await expect(
      putLibraryObject(
        client({
          head: async () => ({
            headers: {
              "content-length": "512",
              "x-tos-server-side-encryption": "AES256",
            },
          }),
          remove: async (input) => {
            removed.push(input.key);
            return {};
          },
        }),
        {
          bucket: "bucket",
          filePath: "/tmp/result.mp4",
          key: "results/result.mp4",
          mimeType: "video/mp4",
          sizeBytes: 1024,
        },
      ),
    ).rejects.toThrow("TOS 上传完成后的文件大小校验失败");
    expect(removed).toEqual(["results/result.mp4"]);
  });

  test("deletes a possibly created object when the single upload fails", async () => {
    const removed: string[] = [];

    await expect(
      putLibraryObject(
        client({
          upload: async () => {
            throw new Error("network timeout");
          },
          remove: async (input) => {
            removed.push(input.key);
            return {};
          },
        }),
        {
          bucket: "bucket",
          filePath: "/tmp/result.mp4",
          key: "results/result.mp4",
          mimeType: "video/mp4",
          sizeBytes: 1024,
        },
      ),
    ).rejects.toThrow("network timeout");
    expect(removed).toEqual(["results/result.mp4"]);
  });
});
