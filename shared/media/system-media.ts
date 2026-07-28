const PUBLIC_MEDIA_BASE_URL = "https://files.xbeaconai.com";

export interface SystemImageMedia {
  storageKey: string;
  thumbnailUrl: string;
  url: string;
  originalUrl: string;
}

function systemImageMedia(storageKey: string): SystemImageMedia {
  const originalUrl = `${PUBLIC_MEDIA_BASE_URL}/${storageKey}`;
  return {
    storageKey,
    thumbnailUrl: `${originalUrl}?x-tos-process=style/thumbnail`,
    url: `${originalUrl}?x-tos-process=style/preview`,
    originalUrl,
  };
}

export function systemPortraitMedia(portraitId: number) {
  return systemImageMedia(`system/portraits/${portraitId}.png`);
}

export function systemSceneMedia(sceneId: number) {
  return systemImageMedia(`system/scenes/${sceneId}.jpg`);
}
