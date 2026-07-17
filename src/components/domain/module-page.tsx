import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronRight, Clock3, Download, FileVideo2, ImagePlus, LoaderCircle, Play, RotateCcw, UploadCloud, WandSparkles, X } from "lucide-react";
import type { MockTask, TaskStatus } from "@/entities/types";
import type { ModuleConfig } from "@/app/routes";
import { db } from "@/lib/db";
import { runMockTask } from "@/mocks/adapter";

const statusMap: Record<TaskStatus, string> = { draft:"草稿", validating:"校验中", uploading:"上传中", queued:"排队中", processing:"生成中", succeeded:"已完成", partially_succeeded:"部分完成", failed:"失败", cancelled:"已取消" };
const fieldKind = (label: string) => label.includes("上传") || label.includes("添加") || label.includes("素材") || label.includes("母版");

function UploadField({ label }: { label: string }) {
  const [file, setFile] = useState("");
  return <label className="upload-zone">
    <input className="sr-only" type="file" accept="video/*,audio/*,image/*" onChange={(e)=>setFile(e.target.files?.[0]?.name ?? "")} />
    <span className="upload-icon">{file ? <FileVideo2 size={22}/> : <UploadCloud size={22}/>}</span>
    <span><b>{file || label}</b><small>{file ? "点击可重新选择" : "点击选择或将文件拖到这里"}</small></span>
    {file && <Check className="ml-auto text-emerald-600" size={20}/>} 
  </label>;
}

function TaskTable({ tasks, retry }: { tasks: MockTask[]; retry: (t:MockTask)=>void }) {
  const column = createColumnHelper<MockTask>();
  const columns = useMemo(() => [
    column.accessor("title", { header:"任务名称", cell: i => <div><b>{i.getValue()}</b><small className="block">{new Date(i.row.original.createdAt).toLocaleString()}</small></div> }),
    column.accessor("status", { header:"状态", cell:i => <span className={`status status-${i.getValue()}`}>{i.getValue()==="processing" && <LoaderCircle size={13} className="animate-spin"/>}{statusMap[i.getValue()]}</span> }),
    column.accessor("progress", { header:"进度", cell:i => <div className="progress"><span style={{width:`${i.getValue()}%`}}/><em>{i.getValue()}%</em></div> }),
    column.display({ id:"actions", header:"操作", cell:i => <div className="row-actions">{i.row.original.status === "succeeded" ? <><button><Play size={14}/>预览</button><button><Download size={14}/>导出</button></> : <button onClick={()=>retry(i.row.original)}><RotateCcw size={14}/>重试</button>}</div> }),
  ], [column, retry]);
  const table = useReactTable({ data:tasks, columns, getCoreRowModel:getCoreRowModel() });
  return <div className="table-wrap"><table><thead>{table.getHeaderGroups().map(g=><tr key={g.id}>{g.headers.map(h=><th key={h.id}>{flexRender(h.column.columnDef.header,h.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(r=><tr key={r.id}>{r.getVisibleCells().map(c=><td key={c.id}>{flexRender(c.column.columnDef.cell,c.getContext())}</td>)}</tr>)}</tbody></table></div>;
}

function AssetStrip() {
  const parent = useRef<HTMLDivElement>(null); const assets = Array.from({length:80},(_,i)=>({id:i,name:`灵感素材 ${String(i+1).padStart(2,"0")}`}));
  const virtual = useVirtualizer({ horizontal:true, count:assets.length, getScrollElement:()=>parent.current, estimateSize:()=>132, overscan:5 });
  return <div ref={parent} className="asset-strip"><div style={{width:virtual.getTotalSize(),height:92,position:"relative"}}>{virtual.getVirtualItems().map(v=><button className="asset-card" key={v.key} style={{transform:`translateX(${v.start}px)`}}><ImagePlus size={20}/><span>{assets[v.index].name}</span></button>)}</div></div>;
}

export function ModulePage({ config }: { config: ModuleConfig }) {
  const [tasks,setTasks]=useState<MockTask[]>([]); const [running,setRunning]=useState(false); const [advanced,setAdvanced]=useState(false); const [scenario,setScenario]=useState<"success"|"fail-analysis">("success");
  const { data: restored=[] } = useQuery({ queryKey:["tasks",config.id], queryFn:()=>db.tasks.where("moduleId").equals(config.id).reverse().sortBy("createdAt") });
  useEffect(()=>setTasks(restored),[restored]);
  const submit=async()=>{setRunning(true); await runMockTask(config.id,`${config.label} · ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`,t=>setTasks(old=>[t,...old.filter(x=>x.id!==t.id)]),scenario); setRunning(false)};
  const retry=(task:MockTask)=>{void runMockTask(config.id,`${task.title}（重试）`,t=>setTasks(old=>[t,...old.filter(x=>x.id!==t.id)]))};
  return <div className="module-page">
    <header className="page-head"><div><span>{config.eyebrow}</span><h1>{config.label}</h1><p>{config.description}</p></div><div className="head-chip"><WandSparkles size={16}/> MOCK 工作流</div></header>
    <div className="workspace-grid"><section className="work-card">
      <div className="steps"><span className="active"><i>1</i>准备素材</span><ChevronRight/><span><i>2</i>配置参数</span><ChevronRight/><span><i>3</i>生成作品</span></div>
      <div className="form-stack">{config.inputs.map((label,index)=>fieldKind(label)?<div className="field" key={label}><label>{label}<em>{index===0?"必填":"可选"}</em></label><UploadField label={label}/></div>:<div className="field" key={label}><label>{label}<em>{index===0?"必填":"可选"}</em></label>{label.includes("选择")||label.includes("设置")||label.includes("时长")?<select defaultValue=""><option value="" disabled>请选择合适的参数</option><option>智能推荐</option><option>标准模式</option><option>精细模式</option></select>:<textarea placeholder={`请${label}，描述越具体，生成效果越好`} />}</div>)}</div>
      <button className="advanced" onClick={()=>setAdvanced(v=>!v)}><span>高级设置</span><small>{advanced?"收起":"展开更多生成参数"}</small></button>
      {advanced&&<div className="advanced-panel"><label>生成策略<select><option>创意优先</option><option>稳定优先</option></select></label><label>演示场景<select value={scenario} onChange={e=>setScenario(e.target.value as typeof scenario)}><option value="success">正常完成</option><option value="fail-analysis">模拟分析失败（可重试）</option></select></label></div>}
      <div className="submit-bar"><div><b>预计消耗 8 创作点</b><small>任务将保存在本机，可在刷新后继续查看</small></div><button disabled={running} onClick={submit}>{running?<LoaderCircle className="animate-spin"/>:<WandSparkles/>}{running?"正在创作…":config.action}</button></div>
    </section><aside className="guide-card"><div className="visual"><config.icon size={42}/><span/><span/></div><h3>获得更好的结果</h3><ol><li>使用画面清晰、主体明确的原始素材</li><li>在描述中写明受众、语气和发布场景</li><li>任务进行中可以离开，完成后自动保留</li></ol><div className="safe-note"><Clock3 size={17}/><span><b>异步生成</b><small>通常需要 1–3 分钟</small></span></div></aside></div>
    {config.id==="ai-generate"&&<section className="asset-section"><div className="section-title"><div><span>灵感素材</span><h2>从已有素材开始</h2></div><button>查看素材库</button></div><AssetStrip/></section>}
    <section className="tasks-section"><div className="section-title"><div><span>任务中心</span><h2>最近创作</h2></div><small>共 {tasks.length} 个任务</small></div>{tasks.length?<TaskTable tasks={tasks} retry={retry}/>:<div className="empty"><X size={24}/><b>还没有创作记录</b><span>完成上方配置并提交，任务进度会显示在这里</span></div>}</section>
  </div>;
}
