# Ark 私域虚拟人像上传与视频生成设计

## 目标

将桌面虚拟人物图片通过火山方舟 Assets API 上传到私域虚拟人像库，等待素材处理为 `Active` 后，以 `asset://<AssetId>` 作为人物参考调用 Seedance 2.0 Mini，最终把测试视频下载到桌面。

## 数据流

1. 校验本地图片格式、尺寸、比例和大小。
2. 将图片上传到现有私有 TOS 的临时前缀，并生成足够覆盖入库处理时间的短期签名 URL。
3. 使用现有加密保存的火山 AK/SK，以 HMAC-SHA256 调用 Assets OpenAPI：
   - `CreateAssetGroup` 创建 `AIGC` 素材组。
   - `CreateAsset` 向素材组添加图片。
   - `GetAsset` 轮询素材状态。
4. 素材状态变为 `Active` 后，使用现有 Ark API Key 调用 Seedance 2.0 Mini。
5. 下载生成视频到 `.data/results/` 和桌面，使用 FFprobe 和抽帧验证结果。
6. 素材完成入库后清理 TOS 临时对象；方舟 Asset Group 和 Asset 作为本次测试结果保留。

## 固定参数

- Project：`default`
- GroupType：`AIGC`
- AssetType：`Image`
- 模型：`doubao-seedance-2-0-mini-260615`
- 提示词：`固定机位，近景。图片1中的人物面对镜头微笑并轻轻挥手。保持人物脸型、五官和发型一致，无字幕。`
- 分辨率：`720p`
- 比例：`3:4`
- 时长：5 秒
- 音频：关闭
- 水印：关闭

## 代码结构

- 新增独立的 Ark Assets TypeScript 客户端，集中处理 Volcengine OpenAPI 签名、创建与查询请求。
- 扩展真实测试脚本，串联 TOS 暂存、资产上传、状态轮询、视频生成和结果下载。
- 新增单元测试，验证签名请求参数、资产请求体以及创建接口不发生隐式重试。
- 不改变现有 AIHubMix 或一键成片生产路由。

## 错误与安全

- `CreateAssetGroup`、`CreateAsset` 和视频创建均只提交一次，避免重复资源和重复计费。
- `GetAsset` 与视频查询允许有限的只读重试。
- 如果授权函、IAM、高级创作权益包、Project 隔离或素材审核阻止流程，返回真实上游错误，不切换 Provider 或伪造成功。
- AK/SK、Ark API Key 和签名 URL 不写入源码、日志、测试快照或 Git。
- 本地图片、视频、抽帧和 TOS 暂存文件不提交 Git。
