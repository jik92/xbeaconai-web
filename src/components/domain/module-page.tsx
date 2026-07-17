import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronRight, Clock3, Copy, Download, FileAudio2, FileVideo2, ImagePlus, LoaderCircle, Play, RotateCcw, Sparkles, UploadCloud, WandSparkles, X } from "lucide-react";
import type { MockTask, TaskStatus } from "@/entities/types";
import type { FieldSpec, ModuleConfig } from "@/app/routes";
import { db } from "@/lib/db";
import { runMockTask, type MockScenario } from "@/mocks/adapter";
import { transitionTask } from "@/mocks/task-machine";

const statusMap: Record<TaskStatus, string> = { draft:"草稿", validating:"校验中", uploading:"上传中", queued:"排队中", processing:"生成中", succeeded:"已完成", partially_succeeded:"部分完成", failed:"失败", cancelled:"已取消" };
function UploadField({ field, value, onChange }: { field: FieldSpec; value: string; onChange: (value:string)=>void }) {
  const Icon = field.kind === "audio" ? FileAudio2 : field.kind === "image" ? ImagePlus : FileVideo2;
  return <label className="upload-zone">
    <input className="sr-only" type="file" accept={`${field.kind}/*`} onChange={(e)=>onChange(e.target.files?.[0]?.name ?? "")} />
    <span className="upload-icon">{value ? <Icon size={22}/> : <UploadCloud size={22}/>}</span>
    <span><b>{value || field.label}</b><small>{value ? "点击可重新选择" : field.hint || "点击选择或将文件拖到这里"}</small></span>
    {value && <Check className="ml-auto text-emerald-600" size={20}/>} 
  </label>;
}

function BusinessField({ field, value, onChange, invalid }: { field:FieldSpec; value:string; onChange:(value:string)=>void; invalid:boolean }) {
  const wrap=(control:React.ReactNode)=><div className={`field ${invalid?"field-invalid":""}`}><label htmlFor={field.id}>{field.label}<em>{field.required?"必填":"可选"}</em></label>{control}{field.hint&&field.kind!=="video"&&field.kind!=="audio"&&<small className="field-hint">{field.hint}</small>}{invalid&&<small className="field-error">请完成此项后再提交</small>}</div>;
  if (["video","audio","image"].includes(field.kind)) return wrap(<UploadField field={field} value={value} onChange={onChange}/>);
  if (field.kind==="asset-group") return wrap(<button id={field.id} type="button" className="asset-uploader" onClick={()=>onChange(value?"":"已选择 6 个素材")}><span className="asset-stack"><i/><i/><i/></span><span><b>{value||"从素材库选择或本地上传"}</b><small>{field.hint}</small></span><em>{value?"重新选择":"添加素材"}</em></button>);
  if (field.kind==="segmented") return wrap(<div id={field.id} className="segmented">{field.options?.map(option=><button type="button" key={option} className={value===option?"active":""} onClick={()=>onChange(option)}>{option}</button>)}</div>);
  if (field.kind==="select") return wrap(<select id={field.id} value={value} onChange={e=>onChange(e.target.value)}><option value="" disabled>请选择</option>{field.options?.map(option=><option key={option}>{option}</option>)}</select>);
  if (field.kind==="textarea") return wrap(<textarea id={field.id} value={value} onChange={e=>onChange(e.target.value)} placeholder={field.placeholder}/>);
  if (field.kind==="number") return wrap(<div className="number-input"><button type="button" onClick={()=>onChange(String(Math.max(field.min??0,Number(value||field.min||0)-1)))}>−</button><input id={field.id} type="number" min={field.min} max={field.max} value={value} onChange={e=>onChange(e.target.value)}/><span>{field.unit}</span><button type="button" onClick={()=>onChange(String(Math.min(field.max??99,Number(value||field.min||0)+1)))}>＋</button></div>);
  if (field.kind==="checkbox") return wrap(<button id={field.id} type="button" role="checkbox" aria-checked={value==="true"} className="check-field" onClick={()=>onChange(value==="true"?"":"true")}><i>{value==="true"&&<Check size={13}/>}</i><span>{field.label}</span></button>);
  if (field.kind==="region") return wrap(<button id={field.id} type="button" className="region-picker" onClick={()=>onChange("底部 24% 区域")}><span className={value?"selected":""}/><b>{value||"点击画面框选字幕区域"}</b></button>);
  return wrap(<input id={field.id} type="text" value={value} onChange={e=>onChange(e.target.value)} placeholder={field.placeholder}/>);
}

function TaskTable({ tasks, retry, preview, cancel }: { tasks: MockTask[]; retry: (t:MockTask)=>void; preview:(t:MockTask)=>void; cancel:(t:MockTask)=>void }) {
  const column = createColumnHelper<MockTask>();
  const columns = useMemo(() => [
    column.accessor("title", { header:"任务名称", cell: i => <div><b>{i.getValue()}</b><small className="block">{new Date(i.row.original.createdAt).toLocaleString()}</small></div> }),
    column.accessor("status", { header:"状态", cell:i => <span className={`status status-${i.getValue()}`}>{i.getValue()==="processing" && <LoaderCircle size={13} className="animate-spin"/>}{statusMap[i.getValue()]}</span> }),
    column.accessor("progress", { header:"进度", cell:i => <div className="progress"><span style={{width:`${i.getValue()}%`}}/><em>{i.getValue()}%</em></div> }),
    column.display({ id:"actions", header:"操作", cell:i => <div className="row-actions">{i.row.original.status === "succeeded" || i.row.original.status === "partially_succeeded" ? <><button onClick={()=>preview(i.row.original)}><Play size={14}/>查看结果</button>{i.row.original.status === "partially_succeeded"?<button onClick={()=>retry(i.row.original)}><RotateCcw size={14}/>重试未完成</button>:<button><Download size={14}/>导出</button>}</> : i.row.original.status === "failed" || i.row.original.status === "cancelled" ? <button onClick={()=>retry(i.row.original)}><RotateCcw size={14}/>重试</button> : <button onClick={()=>cancel(i.row.original)}><X size={14}/>取消</button>}</div> }),
  ], [column, retry, preview, cancel]);
  const table = useReactTable({ data:tasks, columns, getCoreRowModel:getCoreRowModel() });
  return <div className="table-wrap"><table><thead>{table.getHeaderGroups().map(g=><tr key={g.id}>{g.headers.map(h=><th key={h.id}>{flexRender(h.column.columnDef.header,h.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(r=><tr key={r.id}>{r.getVisibleCells().map(c=><td key={c.id}>{flexRender(c.column.columnDef.cell,c.getContext())}</td>)}</tr>)}</tbody></table></div>;
}

function AssetStrip() {
  const parent = useRef<HTMLDivElement>(null); const assets = Array.from({length:80},(_,i)=>({id:i,name:`灵感素材 ${String(i+1).padStart(2,"0")}`}));
  const virtual = useVirtualizer({ horizontal:true, count:assets.length, getScrollElement:()=>parent.current, estimateSize:()=>132, overscan:5 });
  return <div ref={parent} className="asset-strip"><div style={{width:virtual.getTotalSize(),height:92,position:"relative"}}>{virtual.getVirtualItems().map(v=><button className="asset-card" key={v.key} style={{transform:`translateX(${v.start}px)`}}><ImagePlus size={20}/><span>{assets[v.index].name}</span></button>)}</div></div>;
}

export function ModulePage({ config }: { config: ModuleConfig }) {
  const initialValues=()=>Object.fromEntries(config.fields.map(field=>[field.id,field.kind==="number"?String(field.min??1):field.kind==="segmented"?field.options?.[0]??"":""]));
  const controllers=useRef(new Map<string,AbortController>()); const [tasks,setTasks]=useState<MockTask[]>([]); const [running,setRunning]=useState(false); const [advanced,setAdvanced]=useState(false); const [scenario,setScenario]=useState<MockScenario>("success"); const [values,setValues]=useState<Record<string,string>>(initialValues); const [hydrated,setHydrated]=useState(false); const [submitted,setSubmitted]=useState(false); const [selectedTask,setSelectedTask]=useState<MockTask|null>(null);
  const { data: restored=[] } = useQuery({ queryKey:["tasks",config.id], queryFn:()=>db.tasks.where("moduleId").equals(config.id).reverse().sortBy("createdAt") });
  useEffect(()=>setTasks(restored),[restored]);
  useEffect(()=>{let active=true;setHydrated(false);void db.drafts.get(config.id).then(draft=>{if(!active)return;setValues(draft?.values??initialValues());setHydrated(true)});return()=>{active=false}},[config.id]);
  useEffect(()=>{if(!hydrated)return;const timer=setTimeout(()=>void db.drafts.put({id:config.id,values,updatedAt:Date.now()}),250);return()=>clearTimeout(timer)},[config.id,hydrated,values]);
  const missing=config.fields.filter(field=>field.required&&!values[field.id]);
  const setValue=(id:string,value:string)=>setValues(old=>({...old,[id]:value}));
  const submit=async()=>{setSubmitted(true);if(missing.length)return;setRunning(true);const controller=new AbortController();await runMockTask(config.id,`${config.label} · ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`,t=>{controllers.current.set(t.id,controller);setTasks(old=>[t,...old.filter(x=>x.id!==t.id)])},scenario,controller.signal);setRunning(false)};
  const retry=(task:MockTask)=>{void runMockTask(config.id,`${task.title}（重试）`,t=>setTasks(old=>[t,...old.filter(x=>x.id!==t.id)]))};
  const cancel=async(task:MockTask)=>{const controller=controllers.current.get(task.id);if(controller){controller.abort();return}const cancelled=transitionTask(task,{type:"CANCEL"});await db.tasks.put(cancelled);setTasks(old=>old.map(item=>item.id===task.id?cancelled:item))};
  return <div className="module-page">
    <header className="page-head"><div><span>{config.eyebrow}</span><h1>{config.label}</h1><p>{config.description}</p></div><div className="head-chip"><WandSparkles size={16}/> MOCK 工作流</div></header>
    <div className="workspace-grid"><section className="work-card">
      <div className="steps">{config.steps.map((step,index)=><span className={index===0?"active":""} key={step}><i>{index+1}</i>{step}{index<config.steps.length-1&&<ChevronRight/>}</span>)}</div>
      <div className="form-stack">{hydrated?config.fields.map(field=><BusinessField key={field.id} field={field} value={values[field.id]??""} onChange={value=>setValue(field.id,value)} invalid={Boolean(submitted&&field.required&&!values[field.id])}/>):<><div className="form-skeleton"/><div className="form-skeleton"/><div className="form-skeleton wide"/></>}</div>
      <button className="advanced" onClick={()=>setAdvanced(v=>!v)}><span>高级设置</span><small>{advanced?"收起":"展开更多生成参数"}</small></button>
      {advanced&&<div className="advanced-panel"><label>生成策略<select><option>创意优先</option><option>稳定优先</option></select></label><label>演示场景<select value={scenario} onChange={e=>setScenario(e.target.value as MockScenario)}><option value="success">正常完成</option><option value="fail-analysis">素材分析失败</option><option value="partial-batch">批量任务部分成功</option><option value="insufficient-credits">创作点不足</option></select></label></div>}
      <div className="submit-bar"><div><b>预计消耗 {config.cost} 创作点</b><small>{hydrated?"已自动保存草稿":"正在恢复草稿…"} · {config.duration}</small></div><button disabled={running||!hydrated} onClick={submit}>{running?<LoaderCircle className="animate-spin"/>:<WandSparkles/>}{running?"正在创作…":config.action}</button></div>
    </section><aside className="guide-card"><div className="visual"><config.icon size={42}/><span/><span/></div><h3>获得更好的结果</h3><ol>{config.tips.map(tip=><li key={tip}>{tip}</li>)}</ol><div className="safe-note"><Clock3 size={17}/><span><b>异步生成</b><small>{config.duration}</small></span></div></aside></div>
    {config.id==="ai-generate"&&<section className="asset-section"><div className="section-title"><div><span>灵感素材</span><h2>从已有素材开始</h2></div><button>查看素材库</button></div><AssetStrip/></section>}
    <section className="tasks-section"><div className="section-title"><div><span>任务中心</span><h2>最近创作</h2></div><small>共 {tasks.length} 个任务</small></div>{tasks.length?<TaskTable tasks={tasks} retry={retry} preview={setSelectedTask} cancel={cancel}/>:<div className="empty"><X size={24}/><b>还没有创作记录</b><span>完成上方配置并提交，任务进度会显示在这里</span></div>}</section>
    {selectedTask&&<div className="result-backdrop" onMouseDown={()=>setSelectedTask(null)}><section className="result-drawer" onMouseDown={e=>e.stopPropagation()}><header><div><span>生成结果</span><h2>{config.result.label}</h2></div><button onClick={()=>setSelectedTask(null)} aria-label="关闭"><X/></button></header><div className={`result-preview result-${config.result.kind}`}><config.icon size={48}/><Sparkles size={20}/><b>{selectedTask.title}</b><span>{config.result.kind==="script"?"“真正打动用户的，不是参数，而是使用它之后生活发生的变化……”":"独立 Mock 结果已生成，可继续进入下游工作流"}</span></div><div className="result-actions">{config.result.actions.map((action,index)=><button key={action} className={index===0?"primary":""}>{action.includes("复制")?<Copy/>:action.includes("下载")||action.includes("导出")?<Download/>:<Play/>}{action}</button>)}</div><div className="result-meta"><span>生成模型<b>曜作 Mock Engine</b></span><span>任务状态<b>已完成</b></span><span>消耗<b>{config.cost} 创作点</b></span></div></section></div>}
  </div>;
}
