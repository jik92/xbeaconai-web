import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { qianchuanApi } from "./qianchuan-api";

export function QianchuanMerchantBindingPage() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["qianchuan-config"], queryFn: qianchuanApi.config });
  const bindings = useQuery({ queryKey: ["qianchuan-bindings"], queryFn: qianchuanApi.bindings });
  const oauth = useMutation({
    mutationFn: qianchuanApi.startOauth,
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
    onError: (error) => toast.error(error instanceof Error ? error.message : "无法发起千川授权"),
  });
  const setDefault = useMutation({
    mutationFn: ({ bindingId, advertiserId }: { bindingId: string; advertiserId: string }) =>
      qianchuanApi.setDefaultAdvertiser(bindingId, advertiserId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qianchuan-bindings"] });
      toast.success("默认投放账户已更新");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "账户更新失败"),
  });
  const remove = useMutation({
    mutationFn: qianchuanApi.deleteBinding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qianchuan-bindings"] });
      toast.success("千川绑定已解除");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "解除绑定失败"),
  });

  return (
    <main className="flex h-[calc(100vh-56px)] min-h-0 flex-col gap-3 overflow-y-auto bg-white p-4 text-ink">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">千川商户绑定</h1>
        <Button disabled={!config.data?.configured || oauth.isPending} onClick={() => oauth.mutate()}>
          {oauth.isPending ? <LoaderCircle className="animate-spin" /> : <Link2 />}
          授权千川商户
        </Button>
      </header>

      <Card className="gap-3 py-4">
        <CardContent className="grid gap-3 px-4 text-sm sm:grid-cols-3">
          <div>
            <span className="block text-xs text-muted">应用状态</span>
            <b className={config.data?.configured ? "text-success" : "text-warning"}>
              {config.data?.configured ? "已配置" : "未配置"}
            </b>
          </div>
          <div>
            <span className="block text-xs text-muted">APP ID</span>
            <b>{config.data?.appIdMasked ?? "—"}</b>
          </div>
          <div>
            <span className="block text-xs text-muted">回调地址</span>
            <code className="text-xs">{config.data?.callbackUrl ?? "—"}</code>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3">
        {(bindings.data?.bindings ?? []).map((binding) => (
          <Card key={binding.id} className="gap-4 py-4">
            <CardContent className="grid gap-4 px-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <b>{binding.subjectName || `授权用户 ${binding.authUserId}`}</b>
                  <span className="ml-2 rounded-full bg-surface-muted px-2 py-1 text-xs text-muted">
                    {binding.status === "active" ? "授权有效" : "需要重新授权"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm("确定解除这个千川商户绑定？")) remove.mutate(binding.id);
                  }}
                >
                  <Trash2 />
                  解除绑定
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-muted">默认投放账户</span>
                <NativeSelect
                  className="min-w-64"
                  value={binding.defaultAdvertiserId ?? ""}
                  disabled={setDefault.isPending}
                  onChange={(event) => setDefault.mutate({ bindingId: binding.id, advertiserId: event.target.value })}
                >
                  <option value="">请选择账户</option>
                  {binding.advertisers.map((advertiser) => (
                    <option key={advertiser.advertiserId} value={advertiser.advertiserId}>
                      {advertiser.name}（{advertiser.advertiserId}）
                    </option>
                  ))}
                </NativeSelect>
                <span className="text-xs text-muted">
                  Token 到期：{new Date(binding.accessTokenExpiresAt).toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
        {!bindings.isLoading && !bindings.data?.bindings.length && (
          <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-line text-sm text-muted">
            暂无已授权千川商户
          </div>
        )}
        {(config.isLoading || bindings.isLoading) && (
          <div className="grid min-h-40 place-items-center text-muted">
            <LoaderCircle className="animate-spin" />
          </div>
        )}
      </section>

      <footer className="flex items-center gap-2 text-xs text-muted">
        <RefreshCw className="size-3.5" />
        授权完成后会自动同步代理主体和关联投放账户
        <a
          href="https://open.oceanengine.com/labels/34"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary"
        >
          接口文档 <ExternalLink className="size-3" />
        </a>
      </footer>
    </main>
  );
}
