import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleCheck, Clock3, Copy, FileText, History, LoaderCircle, Mic2, Plus, RefreshCw, Sparkles, UploadCloud, UserRound, Video, WandSparkles } from "lucide-react";

const stages = ["上传配置", "AI 解析", "提示词校对", "分镜校对", "合并成片"];
const promptText = `### 第一部分：全局基础设定
约束条件：人物动作自然流畅，面部无扭曲变形；场景真实有生活感，无多余杂物穿模；精准还原商品外观、LOGO 与原有印刷文字，不新增任何字幕。

人物形象：中年男性，利落短发，身穿藏蓝色翻领 POLO 衫，搭配黑色西裤与黑色皮鞋，领口佩戴黑色领夹麦，外形沉稳地气。
人物神态：面部充满自然微表情，每 3–4 秒自然眨眼一次，眼球缓慢转动，目光柔和，嘴角松弛，神态生动不死板。
商品形态：高端女士姜黄色帽檐裙，松紧腰头配金属蝴蝶标识，侧边装饰串珠流苏挂饰，面料垂顺有质感。
镜头视角：全片采用平视视角拍摄，镜头稳定无晃动，模拟真人手机实拍视角。
背景描述：大型钢结构仓储空间，顶部为钢结构桁架搭配采光板与 LED 照明灯管，两侧摆放货物，地面有自然光线反射。
音色设定：中年男性偏低沉的接地气音色，语速稍快，情绪饱满有感染力。
画质要求：1080P 高清分辨率，色彩真实自然，无过度滤镜修饰。
视频总时长：15 秒

---

### 第二部分：分镜内容

分镜 01
人物动作描述：中年男性站在仓库积水区域，正对镜头，双臂微微向身体两侧摊开，手势示意身后的积水地面。
画面口播文案：完了姐妹们，昨天下一场大雨，仓库进水了。
人物说话神态：自然眨眼，眉头微蹙，神情略带焦急惋惜。
音色语气设定：语气焦急带点无奈，语速稍快。
分镜时长：3 秒
景别：近景
画面构图：人物居中，上半身占据画面主要区域，身后露出部分积水地面与堆放的货物。

分镜 02
人物动作描述：人物身体转向侧面，右手指向地面上的货物，随后弯腰拿起一包泡在积水里的裙子展示。`;

export function RemixProject() {
  const [stage,setStage]=useState(0); const [parsed,setParsed]=useState(false); const [parsing,setParsing]=useState(false); const [editing,setEditing]=useState(false); const [prompt,setPrompt]=useState(promptText);
  const parse=()=>{setParsing(true);setTimeout(()=>{setParsing(false);setParsed(true);setStage(2)},900)};
  const next=()=>{if(stage===1&&!parsed){parse();return}setStage(value=>Math.min(4,value+1))};
  return <div className="remix-project">
    <header className="project-header"><div className="project-title"><Video/>爆款二创</div><div className="project-steps">{stages.map((item,index)=><button key={item} className={index===stage?"active":index<stage?"done":""} onClick={()=>index<stage&&setStage(index)}><i>{index<stage?<Check/>:index+1}</i>{item}{index<4&&<ChevronRight/>}</button>)}</div><div className="project-tools"><button><History/>项目记录</button><button><Plus/>新建</button></div></header>
    {stage===0&&<main className="setup-stage"><section><h2>上传爆款参考</h2><p>上传一条已验证的爆款视频，AI 将提取人物、商品、场景与分镜结构。</p><label className="large-drop"><input type="file" accept="video/*"/><UploadCloud/><b>上传爆款视频</b><span>MP4/MOV，最大 500MB</span></label></section><section><h3>创作模式</h3><div className="mode-cards"><button className="active"><Video/><b>含商品模式</b><span>保留商品展示逻辑并替换人物</span></button><button><UserRound/><b>纯口播模式</b><span>聚焦人物表达和口播脚本</span></button></div><label>需求描述<textarea placeholder="描述商品卖点、目标人群和希望调整的表达风格…"/></label></section></main>}
    {stage===1&&<main className="analysis-stage"><div className="analysis-orbit"><Sparkles/><i/><i/></div><h2>{parsing?"正在理解视频内容":"准备进行 AI 解析"}</h2><p>解析人物、商品、场景、口播文案和镜头边界，预计需要 30–60 秒。</p>{parsing&&<div className="analysis-progress"><span/><b>正在识别分镜结构…</b></div>}<button disabled={parsing} onClick={parse}>{parsing?<LoaderCircle className="animate-spin"/>:<WandSparkles/>}{parsing?"解析中":"开始 AI 解析"}</button></main>}
    {stage===2&&<main className="proof-stage"><aside className="proof-assets"><div className="mode-tabs"><button className="active">含商品模式</button><button>纯口播模式</button></div><p className="project-name">古叔的着色巴拿马草帽男夏季大头围新款船夫帽休闲复古平顶草编帽</p><label>商品 <em>*</em><button>商品库</button></label><div className="product-chip"><span/><b>古叔的着色巴拿马草帽…</b></div><label>人像</label><div className="portrait-mock"><UserRound/></div><label>需求描述</label><textarea placeholder="描述商品卖点、目标人群、风格基调…"/><label>分镜视频 <em>*</em><small>（同一成片的连续片段）</small></label><div className="video-mock"><div><Video/><b>原视频预览</b><span>00:08 / 00:15</span></div></div></aside><section className="proof-editor"><div className="source-card"><div className="source-thumb"><Video/></div><div><b>13428656243498662.mp4</b><span>已解析</span></div><RefreshCw/></div><div className="editor-divider"/><div className="editor-toolbar"><label>对比版本 <button className="toggle"/></label><div><button><CircleCheck/>智能检查</button><button><WandSparkles/>智能修改</button><button className="orange"><Mic2/>换口播</button></div></div><div className="prompt-work"><aside><button className="active"><b>v1</b><span>AI 解析</span><Check/></button></aside><div className="prompt-paper">{editing?<textarea value={prompt} onChange={e=>setPrompt(e.target.value)}/>:<pre>{prompt}</pre>}</div></div><div className="editor-bottom"><div><button onClick={()=>setEditing(value=>!value)}><FileText/>{editing?"保存文本":"编辑文本"}</button><button><Copy/>复制脚本</button></div><button className="next" onClick={next}>下一步<ArrowRight/></button></div></section></main>}
    {stage===3&&<main className="storyboard-stage"><header><div><span>共 4 个分镜</span><h2>逐镜确认画面与口播</h2></div><button><Sparkles/>智能调整全部</button></header><div className="shot-grid">{[1,2,3,4].map((shot)=><article key={shot}><div className="shot-preview"><Video/><span>00:0{shot+2}</span></div><div><b>分镜 {String(shot).padStart(2,"0")}</b><p>{shot===1?"完了姐妹们，昨天下一场大雨，仓库进水了。":"展示商品细节并说明本次限时处理方案。"}</p><button>编辑分镜</button></div></article>)}</div></main>}
    {stage===4&&<main className="merge-stage"><div className="merge-preview"><Video/><button>预览合成效果</button></div><section><span>最后一步</span><h2>确认合并成片</h2><p>4 个分镜已校对完成，将按照确认后的提示词、人物和口播合成为完整视频。</p><dl><div><dt>画面比例</dt><dd>9:16 竖屏</dd></div><div><dt>预计时长</dt><dd>15 秒</dd></div><div><dt>预计消耗</dt><dd>8 创作点</dd></div></dl><button className="merge-button"><WandSparkles/>开始合并成片</button></section></main>}
    {stage!==2&&<footer className="project-footer">{stage>0?<button onClick={()=>setStage(value=>value-1)}><ArrowLeft/>上一步</button>:<span/>}<div><span><Clock3/>草稿已自动保存</span><button className="next" onClick={next}>{stage===4?"完成":"下一步"}<ArrowRight/></button></div></footer>}
  </div>;
}
