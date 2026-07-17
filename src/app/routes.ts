import { Clapperboard, Film, FileText, Sparkles, Scissors, ScanSearch, Shuffle, AudioLines, Wrench, Eraser, BadgeCheck, Layers3, type LucideIcon } from "lucide-react";
import type { ModuleId } from "@/entities/types";

export interface ModuleConfig { id: ModuleId; path: string; label: string; group: "创作工作流" | "AI 工具箱"; icon: LucideIcon; eyebrow: string; description: string; inputs: string[]; action: string; }
export const modules: ModuleConfig[] = [
  { id:"video-remix", path:"/aigc/video-remix", label:"爆款二创", group:"创作工作流", icon:Clapperboard, eyebrow:"热门内容再创作", description:"拆解爆款视频的结构与节奏，快速生成符合账号风格的二创版本。", inputs:["上传参考视频","选择数字人","设置改写方向"], action:"开始智能二创" },
  { id:"video-create", path:"/aigc/video-create", label:"一键成片", group:"创作工作流", icon:Film, eyebrow:"从想法到完整视频", description:"输入主题或文案，自动匹配素材、配音、字幕与转场。", inputs:["输入创作主题","选择成片比例","选择配音音色"], action:"生成完整视频" },
  { id:"ad-script", path:"/aigc/ad-script", label:"口播脚本", group:"创作工作流", icon:FileText, eyebrow:"高转化脚本生成器", description:"围绕产品卖点和目标人群，产出自然、有节奏的口播脚本。", inputs:["输入产品名称","补充核心卖点","选择脚本时长"], action:"生成口播脚本" },
  { id:"ai-generate", path:"/tools/ai-generate", label:"AI 创作", group:"AI 工具箱", icon:Sparkles, eyebrow:"多模态灵感画布", description:"通过对话生成图片、文案和视频创意，支持连续追问与版本管理。", inputs:["描述你的创意","选择生成类型","添加参考素材"], action:"发送创作指令" },
  { id:"video-cut", path:"/tools/video-cut", label:"视频分割", group:"AI 工具箱", icon:Scissors, eyebrow:"镜头级智能切分", description:"自动识别场景变化，将长视频拆分为可复用的独立片段。", inputs:["上传待分割视频","设置最短片段","选择识别精度"], action:"开始视频分割" },
  { id:"media-understand", path:"/tools/media-understand", label:"素材理解", group:"AI 工具箱", icon:ScanSearch, eyebrow:"看懂每一份素材", description:"识别视频内容、人物、场景、对白与可用卖点，生成结构化分析。", inputs:["上传图片或视频","选择分析维度","填写关注重点"], action:"分析素材内容" },
  { id:"video-mashup", path:"/tools/video-mashup", label:"视频混剪", group:"AI 工具箱", icon:Shuffle, eyebrow:"批量组合高效出片", description:"按脚本段落与素材标签智能匹配，生成多套差异化混剪。", inputs:["添加主视频","添加素材组","设置生成数量"], action:"创建混剪任务" },
  { id:"voice-clone", path:"/tools/voice-clone", label:"音色克隆", group:"AI 工具箱", icon:AudioLines, eyebrow:"还原自然声线", description:"通过清晰语音样本创建专属音色，用于后续配音任务。", inputs:["上传语音样本","填写音色名称","确认授权声明"], action:"开始克隆音色" },
  { id:"video-renewal", path:"/tools/video-renewal", label:"视频修复", group:"AI 工具箱", icon:Wrench, eyebrow:"修复受损画面", description:"处理卡顿、抖动、噪点与局部缺损，让旧素材恢复可用。", inputs:["上传待修复视频","选择问题类型","设置修复强度"], action:"提交修复任务" },
  { id:"subtitle-erase", path:"/tools/subtitle-erase", label:"字幕擦除", group:"AI 工具箱", icon:Eraser, eyebrow:"智能移除画面文字", description:"识别并擦除硬字幕、贴纸和水印区域，自动补全背景。", inputs:["上传带字幕视频","框选字幕区域","选择填充质量"], action:"开始擦除字幕" },
  { id:"video-enhancement", path:"/tools/video-enhancement", label:"画质增强", group:"AI 工具箱", icon:BadgeCheck, eyebrow:"清晰度与质感升级", description:"提升分辨率、锐度与色彩表现，适配多平台发布标准。", inputs:["上传原始视频","选择目标清晰度","开启人脸增强"], action:"增强视频画质" },
  { id:"kickart", path:"/tools/kickart", label:"爆款裂变", group:"AI 工具箱", icon:Layers3, eyebrow:"一次创作，多版本分发", description:"围绕同一卖点批量改写标题、镜头与包装，形成内容矩阵。", inputs:["选择母版作品","设置裂变数量","配置差异化维度"], action:"启动批量裂变" },
];
export const defaultPath = modules[0].path;
