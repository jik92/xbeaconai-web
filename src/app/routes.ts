import { Clapperboard, Film, FileText, Sparkles, Scissors, ScanSearch, Shuffle, AudioLines, Wrench, Eraser, BadgeCheck, Layers3, type LucideIcon } from "lucide-react";
import type { ModuleId } from "@/entities/types";

export type FieldKind = "video" | "audio" | "image" | "text" | "textarea" | "select" | "segmented" | "number" | "checkbox" | "region" | "asset-group";
export interface FieldSpec { id: string; label: string; kind: FieldKind; required?: boolean; hint?: string; placeholder?: string; options?: string[]; min?: number; max?: number; unit?: string; }
export interface ResultSpec { kind: "remix-video" | "finished-video" | "script" | "conversation" | "clips" | "analysis" | "batch-videos" | "voice" | "restored-video" | "clean-video" | "enhanced-video" | "variant-matrix"; label: string; actions: string[]; }
export interface ModuleConfig { id: ModuleId; path: string; label: string; group: "创作工作流" | "AI 工具箱"; icon: LucideIcon; eyebrow: string; description: string; steps: string[]; fields: FieldSpec[]; action: string; cost: number; duration: string; result: ResultSpec; tips: string[]; }

const module = (config: ModuleConfig) => config;
export const modules: ModuleConfig[] = [
  module({ id:"video-remix", path:"/aigc/video-remix", label:"爆款二创", group:"创作工作流", icon:Clapperboard, eyebrow:"热门内容再创作", description:"拆解爆款视频的结构、文案与节奏，保留有效表达并生成符合账号风格的新版本。", steps:["上传爆款","拆解改写","合成视频"], fields:[
    {id:"source",label:"爆款参考视频",kind:"video",required:true,hint:"MP4/MOV，≤ 500MB，建议 15–180 秒"},
    {id:"rewrite",label:"二创方式",kind:"segmented",required:true,options:["智能重构","保留结构","仅改文案"]},
    {id:"persona",label:"出镜数字人",kind:"select",required:true,options:["自然讲解员·宁宁","专业主播·景舟","不使用数字人"]},
    {id:"tone",label:"改写方向",kind:"textarea",placeholder:"例如：面向职场新人，开头冲突更强，语气口语化"},
    {id:"ratio",label:"画面比例",kind:"segmented",required:true,options:["9:16 竖屏","16:9 横屏","1:1 方形"]},
  ], action:"开始智能二创", cost:8, duration:"约 2–5 分钟", result:{kind:"remix-video",label:"二创视频",actions:["对比原片","预览成片","导出视频","再次改写"]}, tips:["参考视频要有明确的钩子和完整表达","改写方向应包含目标受众与语气","生成后可对文案和镜头继续微调"] }),
  module({ id:"video-create", path:"/aigc/video-create", label:"一键成片", group:"创作工作流", icon:Film, eyebrow:"从想法到完整视频", description:"输入主题或完整文案，自动匹配素材、配音、字幕与转场，形成可发布视频。", steps:["编写内容","设置包装","智能成片"], fields:[
    {id:"topic",label:"视频主题或文案",kind:"textarea",required:true,placeholder:"写一个主题，或直接粘贴完整口播文案"},
    {id:"sourceMode",label:"素材来源",kind:"segmented",required:true,options:["AI 智能匹配","使用我的素材","纯数字人口播"]},
    {id:"ratio",label:"成片比例",kind:"segmented",required:true,options:["9:16 竖屏","16:9 横屏","1:1 方形"]},
    {id:"voice",label:"配音音色",kind:"select",required:true,options:["元气女声·小满","沉稳男声·云舟","使用我的克隆音色"]},
    {id:"caption",label:"字幕样式",kind:"select",options:["醒目综艺字","简约白字","品牌强调色"]},
  ], action:"生成完整视频", cost:12, duration:"约 3–6 分钟", result:{kind:"finished-video",label:"完整成片",actions:["预览成片","编辑分镜","替换素材","导出视频"]}, tips:["完整文案会让叙事更可控","竖屏适合短视频平台","可在分镜编辑中替换不满意的素材"] }),
  module({ id:"ad-script", path:"/aigc/ad-script", label:"口播脚本", group:"创作工作流", icon:FileText, eyebrow:"高转化脚本生成器", description:"围绕产品卖点、目标人群和发布场景，产出自然、有节奏且可直接拍摄的口播脚本。", steps:["填写商品","选择策略","生成脚本"], fields:[
    {id:"product",label:"产品名称",kind:"text",required:true,placeholder:"例如：便携榨汁杯"},
    {id:"sellingPoints",label:"核心卖点",kind:"textarea",required:true,placeholder:"每行一个卖点，例如：轻巧、静音、30 秒出汁"},
    {id:"audience",label:"目标人群",kind:"text",required:true,placeholder:"例如：租房独居的上班族"},
    {id:"framework",label:"脚本结构",kind:"select",required:true,options:["痛点—方案—证据—行动","反常识开场","测评对比","故事种草"]},
    {id:"duration",label:"口播时长",kind:"segmented",required:true,options:["15 秒","30 秒","60 秒","90 秒"]},
  ], action:"生成 3 版脚本", cost:3, duration:"约 10–20 秒", result:{kind:"script",label:"口播脚本",actions:["复制全文","逐段改写","生成同款","一键成片"]}, tips:["卖点要具体并可被画面证明","目标人群越清晰，表达越精准","默认生成三种不同开场供选择"] }),
  module({ id:"ai-generate", path:"/tools/ai-generate", label:"AI 创作", group:"AI 工具箱", icon:Sparkles, eyebrow:"多模态灵感画布", description:"通过连续对话生成图片、视频概念与营销文案，支持参考素材和版本追问。", steps:["描述创意","选择模型","连续迭代"], fields:[
    {id:"prompt",label:"创作指令",kind:"textarea",required:true,placeholder:"描述主体、场景、风格、镜头和用途…"},
    {id:"type",label:"生成类型",kind:"segmented",required:true,options:["图片","视频","营销文案"]},
    {id:"references",label:"参考素材",kind:"asset-group",hint:"最多添加 4 个图片或视频参考"},
    {id:"model",label:"创作模型",kind:"select",required:true,options:["曜影 Pro","曜图 4.0","极速草稿"]},
  ], action:"发送创作指令", cost:6, duration:"约 30–90 秒", result:{kind:"conversation",label:"对话作品",actions:["继续追问","创建变体","收藏作品","下载"]}, tips:["描述主体、环境、光线和镜头语言","可引用上一版结果继续调整","参考素材只用于控制构图和风格"] }),
  module({ id:"video-cut", path:"/tools/video-cut", label:"视频分割", group:"AI 工具箱", icon:Scissors, eyebrow:"镜头级智能切分", description:"识别镜头边界、静音区间或固定时长，将长视频拆成可复用片段。", steps:["上传长视频","设置切分","导出片段"], fields:[
    {id:"source",label:"待分割视频",kind:"video",required:true,hint:"支持最长 3 小时的视频"},
    {id:"method",label:"切分方式",kind:"segmented",required:true,options:["按镜头变化","按静音区间","按固定时长"]},
    {id:"minLength",label:"最短片段",kind:"number",required:true,min:2,max:60,unit:"秒"},
    {id:"keepAudio",label:"保留原始音频",kind:"checkbox"},
  ], action:"开始视频分割", cost:4, duration:"约为视频时长的 15%", result:{kind:"clips",label:"镜头片段",actions:["批量选择","合并片段","下载选中","加入素材库"]}, tips:["镜头切分适合剧情和 Vlog","静音切分适合访谈与课程","过短片段会降低后续混剪效率"] }),
  module({ id:"media-understand", path:"/tools/media-understand", label:"素材理解", group:"AI 工具箱", icon:ScanSearch, eyebrow:"看懂每一份素材", description:"识别人物、场景、对白、商品和情绪，生成时间轴标签与可检索摘要。", steps:["添加素材","选择维度","查看洞察"], fields:[
    {id:"source",label:"图片或视频素材",kind:"asset-group",required:true,hint:"单次最多分析 20 个素材"},
    {id:"dimensions",label:"分析维度",kind:"segmented",required:true,options:["人物与场景","对白与摘要","商品与卖点","全量分析"]},
    {id:"focus",label:"重点关注",kind:"textarea",placeholder:"例如：找出所有产品近景和用户痛点表达"},
    {id:"language",label:"输出语言",kind:"select",options:["简体中文","English","自动识别"]},
  ], action:"分析素材内容", cost:5, duration:"约 1–3 分钟", result:{kind:"analysis",label:"素材洞察",actions:["查看时间轴","复制摘要","导出标签","用于混剪"]}, tips:["全量分析会生成更丰富的时间轴标签","可通过关注重点缩小分析范围","分析结果能直接进入视频混剪"] }),
  module({ id:"video-mashup", path:"/tools/video-mashup", label:"视频混剪", group:"AI 工具箱", icon:Shuffle, eyebrow:"批量组合高效出片", description:"按脚本段落与素材标签自动匹配，控制去重率并批量生成差异化混剪。", steps:["建立素材池","配置混剪","批量出片"], fields:[
    {id:"main",label:"主叙事或配音",kind:"audio",required:true,hint:"可上传口播音频或配音视频"},
    {id:"assets",label:"混剪素材组",kind:"asset-group",required:true,hint:"建议添加 10–50 个已完成理解的片段"},
    {id:"count",label:"生成数量",kind:"number",required:true,min:1,max:20,unit:"条"},
    {id:"diversity",label:"镜头差异度",kind:"segmented",required:true,options:["30% 稳定","60% 均衡","90% 裂变"]},
    {id:"ratio",label:"画面比例",kind:"select",options:["9:16 竖屏","16:9 横屏","跟随主视频"]},
  ], action:"创建混剪任务", cost:10, duration:"约 3–8 分钟", result:{kind:"batch-videos",label:"混剪批次",actions:["批量预览","对比差异","下载全部","重新混剪"]}, tips:["素材越丰富，成片重复度越低","主叙事决定整体时长和节奏","均衡模式适合常规账号日更"] }),
  module({ id:"voice-clone", path:"/tools/voice-clone", label:"音色克隆", group:"AI 工具箱", icon:AudioLines, eyebrow:"还原自然声线", description:"通过清晰语音样本提取声纹和表达特征，创建可复用的专属配音音色。", steps:["录制样本","验证授权","训练音色"], fields:[
    {id:"sample",label:"语音样本",kind:"audio",required:true,hint:"普通话清晰录音，10–60 秒，无音乐和混响"},
    {id:"name",label:"音色名称",kind:"text",required:true,placeholder:"给音色取一个易识别的名字"},
    {id:"language",label:"主要语言",kind:"select",required:true,options:["普通话","粤语","English","多语言"]},
    {id:"consent",label:"我确认拥有该声音的合法授权",kind:"checkbox",required:true},
  ], action:"开始克隆音色", cost:20, duration:"约 5–10 分钟", result:{kind:"voice",label:"克隆音色",actions:["试听音色","输入文本测试","设为常用","删除音色"]}, tips:["录音中只保留一个人的声音","保持自然语速和稳定距离","未经授权不得克隆他人声音"] }),
  module({ id:"video-renewal", path:"/tools/video-renewal", label:"视频修复", group:"AI 工具箱", icon:Wrench, eyebrow:"修复受损画面", description:"检测卡顿、抖动、噪点、闪烁与局部缺损，按问题类型执行针对性修复。", steps:["检测问题","选择方案","修复对比"], fields:[
    {id:"source",label:"待修复视频",kind:"video",required:true},
    {id:"issues",label:"问题类型",kind:"segmented",required:true,options:["自动检测","画面抖动","噪点闪烁","缺帧卡顿"]},
    {id:"strength",label:"修复强度",kind:"segmented",required:true,options:["自然","均衡","强力"]},
    {id:"keepGrain",label:"保留原始胶片质感",kind:"checkbox"},
  ], action:"提交修复任务", cost:9, duration:"约 3–8 分钟", result:{kind:"restored-video",label:"修复视频",actions:["前后对比","预览修复","下载视频","调整强度"]}, tips:["自动检测适合存在多种问题的素材","强力修复可能损失少量细节","可使用前后对比检查关键画面"] }),
  module({ id:"subtitle-erase", path:"/tools/subtitle-erase", label:"字幕擦除", group:"AI 工具箱", icon:Eraser, eyebrow:"智能移除画面文字", description:"追踪字幕、贴纸和水印区域，逐帧擦除并使用邻近画面补全背景。", steps:["上传视频","框选区域","擦除补全"], fields:[
    {id:"source",label:"带字幕视频",kind:"video",required:true},
    {id:"region",label:"字幕所在区域",kind:"region",required:true,hint:"拖动选框覆盖需要擦除的区域"},
    {id:"tracking",label:"区域跟踪",kind:"segmented",required:true,options:["固定区域","智能跟随","全画面检测"]},
    {id:"quality",label:"背景填充质量",kind:"select",options:["标准填充","精细补全","极速预览"]},
  ], action:"开始擦除字幕", cost:8, duration:"约 2–6 分钟", result:{kind:"clean-video",label:"无字幕视频",actions:["前后对比","检查关键帧","下载视频","重新框选"]}, tips:["选框应略大于文字边缘","移动水印建议使用智能跟随","复杂背景使用精细补全效果更自然"] }),
  module({ id:"video-enhancement", path:"/tools/video-enhancement", label:"画质增强", group:"AI 工具箱", icon:BadgeCheck, eyebrow:"清晰度与质感升级", description:"提升分辨率、锐度、色彩与人脸细节，使低清素材达到平台发布标准。", steps:["评估画质","设置增强","输出高清"], fields:[
    {id:"source",label:"原始视频",kind:"video",required:true},
    {id:"resolution",label:"目标清晰度",kind:"segmented",required:true,options:["1080P","2K","4K"]},
    {id:"mode",label:"增强模式",kind:"select",required:true,options:["通用画质","人像优先","动漫线条","老片修复"]},
    {id:"face",label:"开启人脸细节增强",kind:"checkbox"},
    {id:"fps",label:"智能补帧",kind:"select",options:["保持原帧率","补至 30fps","补至 60fps"]},
  ], action:"增强视频画质", cost:12, duration:"约 5–12 分钟", result:{kind:"enhanced-video",label:"高清视频",actions:["分屏对比","100% 放大","下载视频","调整参数"]}, tips:["2K 是清晰度与成本的平衡选择","人像优先会重点修复五官细节","补帧适合运动和镜头移动画面"] }),
  module({ id:"kickart", path:"/tools/kickart", label:"爆款裂变", group:"AI 工具箱", icon:Layers3, eyebrow:"一次创作，多版本分发", description:"围绕同一母版批量替换钩子、标题、镜头与包装，构建可测试的内容矩阵。", steps:["选择母版","设计变量","生成矩阵"], fields:[
    {id:"master",label:"母版作品",kind:"video",required:true,hint:"选择已验证有效的完整视频"},
    {id:"count",label:"裂变数量",kind:"number",required:true,min:3,max:50,unit:"条"},
    {id:"variables",label:"差异化维度",kind:"segmented",required:true,options:["开场钩子","标题与字幕","镜头顺序","全部维度"]},
    {id:"audiences",label:"目标人群组",kind:"textarea",placeholder:"每行一个人群，例如：宝妈、学生、职场新人"},
    {id:"duplicate",label:"平台查重策略",kind:"select",required:true,options:["标准去重","强力去重","保持母版"]},
  ], action:"启动批量裂变", cost:18, duration:"约 8–20 分钟", result:{kind:"variant-matrix",label:"裂变矩阵",actions:["矩阵对比","筛选版本","批量下载","继续裂变"]}, tips:["建议一次只测试 1–2 个核心变量","目标人群组会影响标题与表达","生成后先筛选再进入发布流程"] }),
];

export const defaultPath = modules[0].path;
