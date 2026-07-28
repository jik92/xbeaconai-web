import { createHash } from "node:crypto";
import { type VideoCreateVoiceSettings, videoCreateVoiceSettingsKey } from "../../shared/video-create/media-settings";

export function voicePreviewStorageKey(input: {
  ownerUserId: string;
  voiceSettings: VideoCreateVoiceSettings;
  text: string;
}) {
  const digest = createHash("sha256")
    .update(JSON.stringify([input.ownerUserId, videoCreateVoiceSettingsKey(input.voiceSettings), input.text]))
    .digest("hex");
  return `ephemeral/voice-previews/${input.ownerUserId}/${digest}.mp3`;
}
