import { Check, FileAudio2, LoaderCircle, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { checkQwenVoiceSample, submitJob } from "@/api/api-client";
import type { Job } from "@/api/generated/types.gen";
import { AttachmentPicker } from "@/components/domain/attachment-picker";
import { SaveLocationPicker } from "@/components/domain/save-location-picker";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { qwenVoiceDialects, qwenVoiceSpeeds, qwenVoiceStyles } from "../../../shared/voice/qwen-voice";

interface QwenVoiceCloneModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (job: Job) => void;
}

export function QwenVoiceCloneModal({ open, onClose, onCreated }: QwenVoiceCloneModalProps) {
  const [sample, setSample] = useState("");
  const [sampleChecking, setSampleChecking] = useState(false);
  const [sampleError, setSampleError] = useState("");
  const [samplePreflight, setSamplePreflight] = useState<Awaited<ReturnType<typeof checkQwenVoiceSample>> | null>(null);
  const [dialect, setDialect] = useState<(typeof qwenVoiceDialects)[number]>("普通话");
  const [style, setStyle] = useState<(typeof qwenVoiceStyles)[number]>("标准播音风格");
  const [speechSpeed, setSpeechSpeed] = useState<(typeof qwenVoiceSpeeds)[number]>("标准");
  const [demoText, setDemoText] = useState("恭喜发财，天天向上。");
  const [outputFolderId, setOutputFolderId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const sampleCheckSequence = useRef(0);

  const close = () => {
    if (!submitting) {
      sampleCheckSequence.current += 1;
      setSample("");
      setSampleChecking(false);
      setSampleError("");
      setSamplePreflight(null);
      onClose();
    }
  };
  const submit = async () => {
    setError("");
    if (!sample) return setError("请选择 5–60 秒的单人声音频");
    if (sampleChecking || !samplePreflight) return setError(sampleError || "请等待录音校验完成");
    if (demoText.trim().length < 4 || demoText.trim().length > 300) return setError("音频转换文本需为 4–300 字");
    setSubmitting(true);
    try {
      const title = `Qwen 音色人物 · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      const job = await submitJob("voice-clone", title, {
        voiceProvider: "qwen",
        operation: "clone",
        sample,
        demoText: demoText.trim(),
        dialect,
        style,
        speechSpeed,
        autoSave: String(Boolean(outputFolderId)),
        outputFolderId,
      });
      onCreated(job);
      onClose();
      setSample("");
      setSamplePreflight(null);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Qwen 音色人物创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ToolCreatorModal open={open} title="新建音色人物" onClose={close}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <Label>声音复刻录音</Label>
          <AttachmentPicker
            accept="audio/*"
            onSelect={async ([asset]) => {
              if (!asset) return;
              const sequence = sampleCheckSequence.current + 1;
              sampleCheckSequence.current = sequence;
              setSample(`asset:${asset.id}:${asset.name}`);
              setSampleChecking(true);
              setSampleError("");
              setSamplePreflight(null);
              try {
                const result = await checkQwenVoiceSample(asset.id);
                if (sampleCheckSequence.current === sequence) setSamplePreflight(result);
              } catch (reason) {
                if (sampleCheckSequence.current === sequence)
                  setSampleError(reason instanceof Error ? reason.message : "录音校验失败");
              } finally {
                if (sampleCheckSequence.current === sequence) setSampleChecking(false);
              }
            }}
            trigger={(openPicker) => (
              <Button type="button" className="upload-zone w-full" onClick={openPicker}>
                <span className="upload-icon">{sample ? <FileAudio2 size={22} /> : <UploadCloud size={22} />}</span>
                <span>
                  <b>{sample ? sample.split(":").slice(2).join(":") : "选择声音复刻录音"}</b>
                  <small className="type-helper">
                    {sampleChecking
                      ? "正在校验录音…"
                      : samplePreflight
                        ? `录音校验通过 · ${samplePreflight.durationSec.toFixed(2)} 秒`
                        : sample
                          ? "已选择，点击可重新选择"
                          : "5–60 秒清晰单人声，最大 10MB"}
                  </small>
                </span>
                {sample && <Check className="ml-auto text-success" size={20} />}
              </Button>
            )}
          />
          {sampleError && <div className="field-error">{sampleError}</div>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="qwen-voice-dialect">官方支持的合成方言</Label>
            <NativeSelect
              id="qwen-voice-dialect"
              className="w-full"
              value={dialect}
              onChange={(event) => setDialect(event.target.value as (typeof qwenVoiceDialects)[number])}
            >
              {qwenVoiceDialects.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qwen-voice-style">配音风格</Label>
            <NativeSelect
              id="qwen-voice-style"
              className="w-full"
              value={style}
              onChange={(event) => setStyle(event.target.value as (typeof qwenVoiceStyles)[number])}
            >
              {qwenVoiceStyles.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qwen-voice-speed">音色速度</Label>
            <NativeSelect
              id="qwen-voice-speed"
              className="w-full"
              value={speechSpeed}
              onChange={(event) => setSpeechSpeed(event.target.value as (typeof qwenVoiceSpeeds)[number])}
            >
              {qwenVoiceSpeeds.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qwen-voice-demo">音频转换文本</Label>
          <textarea
            id="qwen-voice-demo"
            className="min-h-24 w-full resize-y rounded-md border border-line bg-surface px-3 py-2 type-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={demoText}
            maxLength={300}
            onChange={(event) => setDemoText(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qwen-voice-output-folder">保存位置</Label>
          <SaveLocationPicker
            id="qwen-voice-output-folder"
            moduleId="voice-clone"
            value={outputFolderId}
            onChange={setOutputFolderId}
          />
        </div>
        {error && <div className="field-error">{error}</div>}
      </div>
      <div className="flex flex-none justify-end gap-2 border-t border-line p-4">
        <Button variant="outline" disabled={submitting} onClick={close}>
          取消
        </Button>
        <Button disabled={submitting || sampleChecking || !samplePreflight} onClick={submit}>
          {submitting && <LoaderCircle className="animate-spin" />}
          {submitting ? "正在创建…" : "创建并生成试听"}
        </Button>
      </div>
    </ToolCreatorModal>
  );
}
