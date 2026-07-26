# 上海 TOS 迁移设计

## 目标

将生产账号 `17688743518` 的 TOS 数据从北京 Bucket `xbeacon` 迁移到上海 Bucket
`xbeacon-shanghai`，使上海生产服务器的服务端上传和下载使用同地域内网，同时保持浏览器、Seedance、
MediaKit 等外部调用方使用公网签名 URL。

北京 Bucket 不删除，作为回滚数据源。其他账号的数据不迁移。

## 当前状态

- 生产 ECS 地域：`cn-shanghai`
- 当前 Bucket：北京 `xbeacon`
- 目标账号 owner ID：`74631de1-9e42-4cca-9a99-679edc8f8bb6`
- 迁移前缀：`74631de1-9e42-4cca-9a99-679edc8f8bb6/`
- 待迁移对象：12 个，约 42.1 MiB
- 其中 9 个有效文件、3 个零字节目录标记
- 数据库只保存对象 Key，不保存 Bucket 名，因此迁移时不修改业务记录

## 架构

创建上海私有 Bucket `xbeacon-shanghai`，保持原对象 Key 不变。

TOS 访问拆分为两个客户端：

- 服务端数据客户端：`cn-shanghai`、`tos-cn-shanghai.ivolces.com`、`xbeacon-shanghai`
- 公网签名客户端：`cn-shanghai`、`tos-cn-shanghai.volces.com`、`xbeacon-shanghai`

服务端上传、下载、对象校验和清理使用内网客户端。浏览器直传、素材预览，以及传给 Seedance、MediaKit、
Qwen 等外部 Provider 的预签名 URL 使用公网客户端。

生产配置通过环境变量提供地域、Bucket、内网 Endpoint 和公网 Endpoint，避免再次将部署地域硬编码进业务代码。

## 数据迁移

1. 在上海创建私有 Bucket `xbeacon-shanghai`。
2. 从北京 `xbeacon` 的公网 Endpoint 读取目标账号前缀。
3. 将对象按原 Key 上传到上海内网 Endpoint，并保留 MIME 类型和 AES256 服务端加密。
4. 对源和目标逐对象比较 Key、大小与 SHA-256。
5. 首轮复制在线进行，不影响现有服务。
6. 切换前短暂停止 API 和 Worker，重新列举源前缀并补齐新增或变化对象。

未完成的分片上传不属于正式对象，不迁移。

## 切换

代码和配置验证通过后，短暂停止 API 和 Worker：

1. 完成最后一次增量复制与校验。
2. 将生产配置切换到上海 Bucket 和双 Endpoint。
3. 启动 API 和 Worker。
4. 验证健康检查、现有素材读取、新对象上传、外部公网签名 URL 和 Worker 内网上传。

预计停写窗口为 2 至 5 分钟。

## 回滚

北京 `xbeacon` 保持不变。若上海切换验证失败：

1. 停止 API 和 Worker。
2. 恢复北京 Bucket、地域和公网 Endpoint 配置。
3. 启动服务并验证原素材读取。

对象 Key 和数据库记录均未改变，因此回滚不需要迁移数据库。

## 验收标准

- 上海 Bucket 中目标前缀的对象数量、总大小和逐对象 SHA-256 与北京源一致。
- 数据库引用的 9 个 TOS 文件均存在并可读取。
- 服务端 TOS 请求连接到上海内网地址。
- 浏览器和外部 Provider 的预签名 URL 使用上海公网域名。
- 新上传文件能够写入、读取并安全删除测试对象。
- Seedance 与 MediaKit 使用公网签名 URL，Worker 结果保存使用内网客户端。
- API 与 Worker 为 active，API 健康检查通过。
- 北京 Bucket 未删除，回滚配置可用。
