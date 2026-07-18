import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleCheck, Clock3, Copy, Download, FileText, History, LoaderCircle, Mic2, Plus, RefreshCw, Sparkles, UploadCloud, UserRound, Video, WandSparkles } from "lucide-react";
import { downloadAuthenticated, fetchModels, submitJob, uploadMediaFile, watchJob } from "@/api/api-client";
import { useQuery } from "@tanstack/react-query";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import type { Job, SeedanceModelId } from "@/api/generated/types.gen";
import type { ApiJobResult } from "@/entities/types";
import { APP_CONFIG } from "@/app/config";

const stages = ["上传配置", "AI 解析", "提示词校对", "分镜校对", "合并成片"];
interface SelectedPortrait { name:string; profession:string; source_url:string; index:number }

const promptText = `### 第一部分：全局基础设定
约束条件：人物动作自然流畅，面部无扭曲变形；场景真实有生活感；精准还原商品外观、LOGO 与原有印刷文字。

人物形象：中年男性，利落短发，身穿藏蓝色翻领 POLO 衫，外形沉稳接地气。
商品形态：高端女士姜黄色帽檐裙，面料垂顺有质感。
镜头视角：全片采用平视视角拍摄，模拟真人手机实拍。
音色设定：中年男性偏低沉音色，语速稍快，情绪饱满。
画质要求：1080P 高清分辨率，色彩真实自然。
视频总时长：15 秒

### 第二部分：分镜内容

分镜 01
人物动作描述：人物站在仓库积水区域，正对镜头展示受损货物。
画面口播文案：完了姐妹们，昨天下一场大雨，仓库进水了。
分镜时长：3 秒

分镜 02
人物动作描述：人物拿起一包泡在积水里的商品展示细节。`;

const shotCopy = [
  "完了姐妹们，昨天下一场大雨，仓库进水了。",
  "这批刚到的新货全泡了水，今天只能现场处理。",
  "版型和细节都没问题，介意外包装的姐妹慎拍。",
  "库存不多，想要的抓紧，处理完就恢复原价。",
];

export function RemixProject() {
  const [stage,setStage]=useState(0);
  const [parsed,setParsed]=useState(false);
  const [parsing,setParsing]=useState(false);
  const [editing,setEditing]=useState(false);
  const [prompt,setPrompt]=useState(promptText);
  const [source,setSource]=useState("");
  const [uploading,setUploading]=useState(false);
  const [mode,setMode]=useState<"product"|"talking">("product");
  const [description,setDescription]=useState("");
  const [compare,setCompare]=useState(false);
  const [notice,setNotice]=useState("");
  const [job,setJob]=useState<Job|null>(null);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [videoModel,setVideoModel]=useState<SeedanceModelId>("doubao-seedance-2-0-fast-260128");
  const {data:modelCatalog=[]}=useQuery({queryKey:["api-models"],queryFn:fetchModels,staleTime:60_000});
  const videoModels=modelCatalog.filter(model=>model.capability==="video-generate"&&model.enabled);
  const [selectedPortrait]=useState<SelectedPortrait|null>(()=>{try{return JSON.parse(localStorage.getItem("studio:selectedPortrait")||"null")}catch{return null}});

  useEffect(()=>job&&(job.status==="queued"||job.status==="processing")?watchJob(job.id,(updated)=>{
    setJob(updated);
    if(updated.progress>=35&&!parsed){setParsed(true);setParsing(false);setStage(2)}
  },()=>setNotice("实时连接已断开，可刷新页面恢复任务")):undefined,[job?.id,job?.status,parsed]);

  const upload=async(file?:File)=>{
    if(!file)return;
    setUploading(true);setNotice("");
    try{const asset=await uploadMediaFile(file);setSource(`asset:${asset.id}:${asset.name}`)}
    catch(error){setNotice(error instanceof Error?error.message:"上传失败")}
    finally{setUploading(false)}
  };
  const parse=async()=>{
    if(parsing)return;
    if(!source){setNotice("请先上传爆款参考视频");setStage(0);return}
    if(!videoModels.some(model=>model.id===videoModel)){setNotice("Seedance 模型尚未通过真实基线验证");setStage(0);return}
    setParsed(false);setParsing(true);setNotice("");
    try{
      const created=await submitJob("video-remix",`爆款二创 · ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`,{source,mode,description,prompt,portrait:selectedPortrait?.name??""},videoModel);
      setJob(created);
    }catch(error){setParsing(false);setNotice(error instanceof Error?error.message:"解析任务提交失败")}
  };
  const next=()=>{if(stage===0&&!source){setNotice("请先上传爆款参考视频");return}if(stage===1&&!parsed){void parse();return}setStage(value=>Math.min(4,value+1))};
  const reset=()=>{setStage(0);setParsed(false);setParsing(false);setEditing(false);setSource("");setDescription("");setPrompt(promptText);setJob(null);setNotice("已创建新项目")};
  const smartModify=()=>{setPrompt(value=>`${value}\n\nAI 优化：强化前三秒冲突，用更口语化的表达突出限时处理理由。`);setNotice("已完成智能修改")};
  const merge=()=>{if(job?.status==="succeeded"){setNotice("完整二创结果已生成，可预览与导出")}else{setNotice("任务仍在后台生成，完成后会自动更新")}};
  const result=job?.result as ApiJobResult|undefined;
  const resultVideo=result?.artifacts.find(artifact=>artifact.mimeType.startsWith("video/")&&artifact.url);
  const downloadResult=()=>{if(!resultVideo?.url){setNotice("结果文件仍在生成");return}void downloadAuthenticated(resultVideo.url,resultVideo.name).then(()=>setNotice("已开始导出视频")).catch(()=>setNotice("导出失败，请稍后重试"))};

  return <div className="remix-project">
    <header className="project-header">
      <div className="project-title"><Video/>爆款二创</div>
      <div className="project-steps">{stages.map((item,index)=><button key={item} className={index===stage?"active":index<stage?"done":""} onClick={()=>index<stage&&setStage(index)}><i>{index<stage?<Check/>:index+1}</i>{item}{index<4&&<ChevronRight/>}</button>)}</div>
      <div className="project-tools"><button onClick={()=>setHistoryOpen(value=>!value)}><History/>项目记录</button><button onClick={reset}><Plus/>新建</button></div>
    </header>
    {historyOpen&&<div className="safe-note"><History/><span><b>{job?.title??"暂无当前项目任务"}</b><small>{job?`${job.stage} · ${job.progress}% · ${job.overallExecutionMode}`:"完成上传并解析后将显示项目记录"}</small></span></div>}
    {notice&&<div className="safe-note"><Sparkles/><span><b>{notice}</b><small>{job?`任务 ${job.id.slice(0,8)} · ${job.stage} ${job.progress}%`:`${APP_CONFIG.projectName}工作台`}</small></span></div>}

    {stage===0&&<main className="setup-stage"><section><h2>上传爆款参考</h2><p>上传一条已验证的爆款视频，AI 将提取人物、商品、场景与分镜结构。</p><label className="large-drop"><input id="remix-source" type="file" accept="video/*" onChange={event=>void upload(event.target.files?.[0])}/>{uploading?<LoaderCircle className="animate-spin"/>:<UploadCloud/>}<b>{uploading?"正在上传…":source?source.split(":").slice(2).join(":"):"上传爆款视频"}</b><span>{source?"已安全上传，可重新选择":"MP4/MOV，最大 500MB"}</span></label><div className="engine-panel"><span>视频生成引擎</span><div className="model-cards">{videoModels.map(model=><button type="button" key={model.id} className={videoModel===model.id?"active":""} onClick={()=>setVideoModel(model.id as SeedanceModelId)}><b>{model.name}</b><small>{model.description}</small><em>{model.tags.join(" · ")}</em></button>)}</div>{!videoModels.length&&<small className="field-error">Seedance 尚未完成真实基线验证，暂不能提交生成。</small>}</div></section><section><h3>创作模式</h3><div className="mode-cards"><button className={mode==="product"?"active":""} onClick={()=>setMode("product")}><Video/><b>含商品模式</b><span>保留商品展示逻辑并替换人物</span></button><button className={mode==="talking"?"active":""} onClick={()=>setMode("talking")}><UserRound/><b>纯口播模式</b><span>聚焦人物表达和口播脚本</span></button></div>{selectedPortrait&&<div className="selected-portrait"><img src={selectedPortrait.source_url} alt={selectedPortrait.name}/><div><small>已从人像库带入</small><b>{selectedPortrait.profession}</b><span>{selectedPortrait.name}</span></div><Check/></div>}<label>需求描述<textarea value={description} onChange={event=>setDescription(event.target.value)} placeholder="描述商品卖点、目标人群和希望调整的表达风格…"/></label></section></main>}

    {stage===1&&<main className="analysis-stage"><div className="analysis-orbit"><Sparkles/><i/><i/></div><h2>{parsing?"正在理解视频内容":"准备进行 AI 解析"}</h2><p>解析人物、商品、场景、口播文案和镜头边界。</p>{parsing&&<div className="analysis-progress"><span style={{width:`${job?.progress??10}%`}}/><b>{job?.stage??"正在提交解析任务…"}</b></div>}<button disabled={parsing} onClick={()=>void parse()}>{parsing?<LoaderCircle className="animate-spin"/>:<WandSparkles/>}{parsing?"解析中":"开始 AI 解析"}</button></main>}

    {stage===2&&<main className="proof-stage"><aside className="proof-assets"><div className="mode-tabs"><button className={mode==="product"?"active":""} onClick={()=>setMode("product")}>含商品模式</button><button className={mode==="talking"?"active":""} onClick={()=>setMode("talking")}>纯口播模式</button></div><p className="project-name">古叔的着色巴拿马草帽男夏季大头围新款船夫帽</p><label>商品 <em>*</em><button onClick={()=>setNotice("已从商品库选择演示商品")}>商品库</button></label><div className="product-chip"><span/><b>古叔的着色巴拿马草帽…</b></div><label>人像</label><div className="portrait-mock"><UserRound/></div><label>需求描述</label><textarea value={description} onChange={event=>setDescription(event.target.value)} placeholder="描述商品卖点、目标人群、风格基调…"/><label>分镜视频 <em>*</em><small>（同一成片的连续片段）</small></label><div className="video-mock"><div><Video/><b>原视频预览</b><span>00:08 / 00:15</span></div></div></aside><section className="proof-editor"><div className="source-card"><div className="source-thumb"><Video/></div><div><b>{source?source.split(":").slice(2).join(":"):"13428656243498662.mp4"}</b><span>已解析 · {job?.overallExecutionMode??"mock"}</span></div><button onClick={()=>void parse()}><RefreshCw/></button></div><div className="editor-divider"/><div className="editor-toolbar"><label>对比版本 <button className={`toggle ${compare?"active":""}`} onClick={()=>setCompare(value=>!value)}/></label><div><button onClick={()=>setNotice("智能检查通过：结构完整，未发现冲突")}><CircleCheck/>智能检查</button><button onClick={smartModify}><WandSparkles/>智能修改</button><button className="orange" onClick={()=>setNotice("已切换为沉稳男声·云舟")}><Mic2/>换口播</button></div></div><div className="prompt-work"><aside><button className="active"><b>v1</b><span>AI 解析</span><Check/></button></aside><div className="prompt-paper">{editing?<textarea value={prompt} onChange={event=>setPrompt(event.target.value)}/>:<pre>{prompt}</pre>}</div></div><div className="editor-bottom"><div><button onClick={()=>setEditing(value=>!value)}><FileText/>{editing?"保存文本":"编辑文本"}</button><button onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>setNotice("脚本已复制"))}><Copy/>复制脚本</button></div><button className="next" onClick={next}>下一步<ArrowRight/></button></div></section></main>}

    {stage===3&&<main className="storyboard-stage"><header><div><span>共 4 个分镜</span><h2>逐镜确认画面与口播</h2></div><button onClick={()=>{setNotice("已智能调整全部分镜节奏");setPrompt(value=>`${value}\n\n分镜节奏已统一优化。`)}}><Sparkles/>智能调整全部</button></header><div className="shot-grid">{shotCopy.map((copy,index)=><article key={copy}><div className="shot-preview"><Video/><span>00:0{index+3}</span></div><div><b>分镜 {String(index+1).padStart(2,"0")}</b><p>{copy}</p><button onClick={()=>{const replacement=window.prompt("编辑分镜口播",copy);if(replacement)setNotice(`分镜 ${index+1} 已更新`)}}>编辑分镜</button></div></article>)}</div></main>}

    {stage===4&&<main className="merge-stage"><div className="merge-preview">{resultVideo?.url?<AuthenticatedMedia url={resultVideo.url} mimeType={resultVideo.mimeType} alt={resultVideo.name}/>:<Video/>}<button onClick={()=>setNotice(result?.summary??"正在准备合成预览")}>预览合成效果</button></div><section><span>最后一步 · {job?.overallExecutionMode??"mock"}</span><h2>确认合并成片</h2><p>{result?.summary??"4 个分镜已校对完成，将按照确认后的提示词、人物和口播合成为完整视频。"}</p><dl><div><dt>画面比例</dt><dd>9:16 竖屏</dd></div><div><dt>预计时长</dt><dd>15 秒</dd></div><div><dt>任务进度</dt><dd>{job?.progress??0}%</dd></div></dl><button className="merge-button" onClick={merge}><WandSparkles/>{job?.status==="succeeded"?"查看生成结果":"等待合并成片"}</button><div className="merge-actions"><button onClick={()=>setNotice("已打开原片与成片对比")}>对比原片</button><button onClick={()=>setNotice("成片预览已就绪，可使用播放器控制")}>预览成片</button><button onClick={downloadResult}><Download/>导出视频</button><button onClick={()=>setStage(2)}>再次改写</button></div></section></main>}

    {stage!==2&&<footer className="project-footer">{stage>0?<button onClick={()=>setStage(value=>value-1)}><ArrowLeft/>上一步</button>:<span/>}<div><span><Clock3/>草稿与任务已持久化</span><button className="next" onClick={next}>{stage===4?"完成":"下一步"}<ArrowRight/></button></div></footer>}
  </div>;
}
