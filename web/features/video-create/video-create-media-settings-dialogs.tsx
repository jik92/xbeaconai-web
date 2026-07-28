import { Check, LoaderCircle, Play, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { directMediaSource, previewVideoCreatePresetVoice } from "@/api/api-client";
import type { VideoCreateInput } from "@/api/generated/types.gen";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  videoCreateSubtitlePresets,
  videoCreateVoiceSpeedOptions,
  videoCreateVoiceStyleOptions,
} from "../../../shared/video-create/media-settings";
import { voicePresetCatalog } from "../../../shared/voice/preset-voices";

type VoiceSettings = NonNullable<VideoCreateInput["voiceSettings"]>;

export function VideoCreateVoiceSettingsDialog(props: {
  open: boolean;
  settings: VoiceSettings;
  providerEnabled: boolean;
  disabledReason?: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: VoiceSettings, generate: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState(props.settings);
  const [previewing, setPreviewing] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (props.open) setDraft(props.settings);
  }, [props.open, props.settings]);

  const preview = async (presetVoiceId: VoiceSettings["presetVoiceId"]) => {
    if (!props.providerEnabled || previewing) return;
    setPreviewing(presetVoiceId);
    setError("");
    try {
      const result = await previewVideoCreatePresetVoice({ ...draft, presetVoiceId });
      const source = directMediaSource(result.url);
      if (!source) throw new Error("音色试听未返回有效的 CDN 地址");
      await new Audio(source).play();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "音色试听失败");
    } finally {
      setPreviewing("");
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b border-line px-6 py-5">
          <DialogTitle>配音设置</DialogTitle>
        </DialogHeader>
        <div className="max-h-[68vh] space-y-6 overflow-y-auto p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {voicePresetCatalog.map((voice) => {
              const selected = draft.presetVoiceId === voice.id;
              return (
                <div
                  key={voice.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border border-line p-4 text-left transition-colors hover:border-ink/30",
                    selected && "border-ink bg-canvas-soft",
                  )}
                >
                  <Button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => setDraft((current) => ({ ...current, presetVoiceId: voice.id }))}
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink type-section-title text-on-primary">
                      {voice.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 type-body-strong text-ink">
                        {voice.name} {selected && <Check className="size-4" />}
                      </span>
                      <span className="mt-1 block type-helper text-muted">{voice.description}</span>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!props.providerEnabled || Boolean(previewing)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void preview(voice.id);
                    }}
                  >
                    {previewing === voice.id ? <LoaderCircle className="animate-spin" /> : <Play />}
                    试听
                  </Button>
                </div>
              );
            })}
          </div>
          <SettingChoice
            label="语速"
            options={videoCreateVoiceSpeedOptions}
            value={draft.speed}
            onChange={(speed) => setDraft((current) => ({ ...current, speed }))}
          />
          <SettingChoice
            label="表达风格"
            options={videoCreateVoiceStyleOptions}
            value={draft.style}
            onChange={(style) => setDraft((current) => ({ ...current, style }))}
          />
          {!props.providerEnabled && (
            <p className="type-body text-warning">{props.disabledReason ?? "火山语音当前不可用"}</p>
          )}
          {error && <p className="type-body text-error">{error}</p>}
        </div>
        <DialogFooter className="border-t border-line px-6 py-4">
          <span className="mr-auto type-helper text-muted">
            当前：{voicePresetCatalog.find((voice) => voice.id === draft.presetVoiceId)?.name}
          </span>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button variant="outline" disabled={props.busy} onClick={() => void props.onSave(draft, false)}>
            保存配置
          </Button>
          <Button disabled={props.busy || !props.providerEnabled} onClick={() => void props.onSave(draft, true)}>
            {props.busy ? <LoaderCircle className="animate-spin" /> : <Volume2 />}
            批量生成配音
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingChoice<T extends string>(props: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="type-section-title text-ink">{props.label}</h3>
      <div className="flex flex-wrap gap-2">
        {props.options.map((option) => (
          <Button
            type="button"
            key={option.id}
            variant="outline"
            className={cn(
              "rounded-full",
              props.value === option.id && "border-ink bg-ink text-on-primary hover:bg-ink/90",
            )}
            onClick={() => props.onChange(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

export function VideoCreateSubtitleSettingsDialog(props: {
  open: boolean;
  value: NonNullable<VideoCreateInput["subtitleStyleId"]>;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: NonNullable<VideoCreateInput["subtitleStyleId"]>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => {
    if (props.open) setDraft(props.value);
  }, [props.open, props.value]);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b border-line px-6 py-5">
          <DialogTitle>字幕样式设置</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[68vh] gap-3 overflow-y-auto p-6 sm:grid-cols-2 lg:grid-cols-3">
          {videoCreateSubtitlePresets.map((preset) => (
            <Button
              type="button"
              key={preset.id}
              className={cn(
                "overflow-hidden rounded-xl border border-line text-left transition-colors hover:border-ink/30",
                draft === preset.id && "border-ink ring-1 ring-ink",
              )}
              onClick={() => setDraft(preset.id)}
            >
              <span className="flex h-24 items-end justify-center bg-surface-dark p-4">
                <span className={preset.previewClassName}>示例字幕</span>
              </span>
              <span className="block p-3">
                <span className="flex items-center gap-2 type-body-strong text-ink">
                  {preset.name} {draft === preset.id && <Check className="size-4" />}
                </span>
                <span className="mt-1 block type-helper text-muted">{preset.description}</span>
              </span>
            </Button>
          ))}
        </div>
        <DialogFooter className="border-t border-line px-6 py-4">
          <span className="mr-auto type-helper text-muted">
            当前：{videoCreateSubtitlePresets.find((preset) => preset.id === draft)?.name}
          </span>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={props.busy} onClick={() => void props.onSave(draft)}>
            {props.busy && <LoaderCircle className="animate-spin" />}保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
