# 上海 TOS 资源预览 CORS 修复设计

## 背景

生产资源已迁移到上海私有 Bucket `xbeacon-shanghai`。服务端内网读取和公网签名 URL 均可用，但浏览器中的图片、音频和视频预览不可用。线上检查确认北京源 Bucket 有 CORS 规则，而上海 Bucket 尚未配置 CORS。

当前生产通过 `http://118.196.101.57:9000` 访问，备案域名暂不作为允许来源。

## 方案

只为上海 Bucket 配置精确的生产 IP Origin：

- AllowedOrigins: `http://118.196.101.57:9000`
- AllowedMethods: `GET`、`HEAD`、`PUT`
- AllowedHeaders: `*`
- ExposeHeaders: `ETag`、`x-tos-request-id`、`x-tos-hash-crc64ecma`
- MaxAgeSeconds: `3600`

不使用通配 Origin，不修改北京回滚 Bucket，不调整数据库和对象内容。

## 验证

配置后执行真实请求验证：

1. 读取并回查 Bucket CORS 配置。
2. 使用生产 IP Origin 对签名图片、音频和视频执行预检与 Range 请求。
3. 确认响应包含正确的 `Access-Control-Allow-Origin`。
4. 使用生产 IP Origin 对公网签名上传 URL 执行一次测试上传，再由生产服务器经上海内网校验内容并删除测试对象。
5. 确认 API、Worker、Redis 和 Nginx 保持运行。

## 回滚

若新规则造成异常，删除上海 Bucket 的 CORS 配置即可回到变更前状态；对象、数据库和北京 Bucket 均不受影响。
