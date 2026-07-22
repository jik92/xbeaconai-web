export interface StrictUploadItem {
  file: File;
  localPath: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StrictUploadOperations {
  writeLocal: (item: StrictUploadItem) => Promise<void>;
  uploadObject: (item: StrictUploadItem) => Promise<void>;
  removeLocal: (localPath: string) => Promise<void>;
  deleteObject: (storageKey: string) => Promise<void>;
}

export async function rollbackUploadedObjects(storageKeys: string[], deleteObject: (key: string) => Promise<void>) {
  await Promise.allSettled(storageKeys.map((key) => deleteObject(key)));
}

export async function uploadFilesStrictly(items: StrictUploadItem[], operations: StrictUploadOperations) {
  const uploadedKeys: string[] = [];
  try {
    for (const item of items) {
      await operations.writeLocal(item);
      await operations.uploadObject(item);
      uploadedKeys.push(item.storageKey);
    }
    return uploadedKeys;
  } catch (error) {
    await rollbackUploadedObjects(uploadedKeys, operations.deleteObject);
    throw error;
  } finally {
    await Promise.allSettled(items.map((item) => operations.removeLocal(item.localPath)));
  }
}
