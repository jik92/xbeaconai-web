import { mkdir, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { auditSdkRegistry } from "../server/sdk-registry";
import { burnSubtitle, composeMedia, denoiseVideo, extractAudio, extractFrame, ffmpegVersion, generateSampleVideo, probeMedia, splitFixed, transcodeVideo } from "../server/media/ffmpeg";

const dir = resolve("artifacts/api-tests/ffmpeg"); await mkdir(dir,{recursive:true});
const sample=resolve(dir,"sample.mp4"), audio=resolve(dir,"audio.wav");
const adapters:Record<string,()=>Promise<Record<string,unknown>>>={
  "test-sample":async()=>{await generateSampleVideo(sample);return{bytes:(await stat(sample)).size}},
  "test-probe":async()=>{const p=await probeMedia(sample);return{duration:p.format.duration,streams:p.streams.length}},
  "test-transcode":async()=>{const path=resolve(dir,"transcoded.mp4");await transcodeVideo(sample,path);const p=await probeMedia(path);return{bytes:(await stat(path)).size,width:p.streams[0]?.width}},
  "test-frame":async()=>{const path=resolve(dir,"frame.jpg");await extractFrame(sample,path);return{bytes:(await stat(path)).size}},
  "test-audio-extract":async()=>{await extractAudio(sample,audio);const p=await probeMedia(audio);return{bytes:(await stat(audio)).size,duration:p.format.duration}},
  "test-split":async()=>{await splitFixed(sample,resolve(dir,"segment-%03d.mp4"));return{segments:(await readdir(dir)).filter(name=>name.startsWith("segment-")).length}},
  "test-compose":async()=>{const path=resolve(dir,"composed.mp4");await composeMedia(sample,audio,path);const p=await probeMedia(path);return{bytes:(await stat(path)).size,streams:p.streams.length}},
  "test-subtitle":async()=>{const path=resolve(dir,"subtitle.mp4");await burnSubtitle(sample,path);return{bytes:(await stat(path)).size}},
  "test-denoise":async()=>{const path=resolve(dir,"denoised.mp4");await denoiseVideo(sample,path);return{bytes:(await stat(path)).size}},
};
const entries=auditSdkRegistry().filter(entry=>entry.kind==="ffmpeg");const evidence=[] as Array<Record<string,unknown>>;
for(const entry of entries){const started=Date.now();try{const result=await adapters[entry.testAdapter]?.();if(!result)throw new Error(`Missing adapter ${entry.testAdapter}`);evidence.push({id:entry.id,status:"local",durationMs:Date.now()-started,result})}catch(error){evidence.push({id:entry.id,status:"failed",durationMs:Date.now()-started,error:error instanceof Error?error.message:String(error)})}}
const report={runId:crypto.randomUUID(),kind:"ffmpeg",version:await ffmpegVersion(),generatedAt:new Date().toISOString(),registered:entries.length,attempted:evidence.length,reported:evidence.length,evidence};
if(!(report.registered===report.attempted&&report.attempted===report.reported))throw new Error("FFmpeg SDK registry coverage mismatch");
await Bun.write(resolve(dir,"report.json"),`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report,null,2));
await mkdir(resolve(".data"),{recursive:true});
await Bun.write(resolve(".data/ffmpeg-capabilities.json"),`${JSON.stringify({generatedAt:report.generatedAt,runId:report.runId,entries:evidence.map(item=>({id:item.id,status:item.status}))},null,2)}\n`);
if(evidence.some(item=>item.status==="failed"))process.exitCode=1;
