import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { LoaderCircle, Pause, Play, RefreshCw, Upload } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { fetchLibraryAssets } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { type QianchuanDelivery, qianchuanApi } from "./qianchuan-api";

const fullDaySchedule = "1".repeat(48);
const today = new Date().toISOString().slice(0, 10);

function lookupValue(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "";
}

export function QianchuanPcDeliveryPage() {
  const queryClient = useQueryClient();
  const [bindingId, setBindingId] = useState("");
  const [advertiserId, setAdvertiserId] = useState("");
  const [videoAssetId, setVideoAssetId] = useState("");
  const [imageAssetId, setImageAssetId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    productId: "",
    awemeId: "",
    videoMaterialId: "",
    imageMaterialId: "",
    title: "",
    budget: "300",
    bid: "",
    roiGoal: "",
    startTime: "",
    endTime: "",
    regions: "",
    gender: "ALL",
    age: "",
  });

  const bindings = useQuery({ queryKey: ["qianchuan-bindings"], queryFn: qianchuanApi.bindings });
  const assets = useQuery({
    queryKey: ["asset-library", "media", ""],
    queryFn: () => fetchLibraryAssets("media"),
  });
  const materials = useQuery({
    queryKey: ["qianchuan-materials", advertiserId],
    queryFn: () => qianchuanApi.materials(advertiserId),
    enabled: Boolean(advertiserId),
    refetchInterval: ({ state }) =>
      state.data?.materials.some((item) => item.status === "queued" || item.status === "uploading") ? 2_000 : false,
  });
  const deliveries = useQuery({
    queryKey: ["qianchuan-deliveries"],
    queryFn: qianchuanApi.deliveries,
    refetchInterval: 5_000,
  });
  const reports = useQuery({
    queryKey: ["qianchuan-reports", today],
    queryFn: () => qianchuanApi.reports(today, today),
  });
  const selectedBinding = bindings.data?.bindings.find((item) => item.id === bindingId);
  const lookups = useQuery({
    queryKey: ["qianchuan-lookups", bindingId, advertiserId],
    queryFn: () => qianchuanApi.lookups(bindingId, advertiserId),
    enabled: Boolean(bindingId && advertiserId),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["qianchuan-materials"] }),
      queryClient.invalidateQueries({ queryKey: ["qianchuan-deliveries"] }),
      queryClient.invalidateQueries({ queryKey: ["qianchuan-reports"] }),
    ]);
  };
  const upload = useMutation({
    mutationFn: (input: { assetId: string; kind: "video" | "image" }) =>
      qianchuanApi.uploadMaterial({ bindingId, advertiserId, ...input }),
    onSuccess: async () => {
      await refresh();
      toast.success("素材已进入千川上传队列");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "素材上传失败"),
  });
  const create = useMutation({
    mutationFn: () =>
      qianchuanApi.createDelivery({
        bindingId,
        advertiserId,
        name: form.name,
        productId: form.productId,
        awemeId: form.awemeId,
        videoMaterialId: form.videoMaterialId,
        imageMaterialId: form.imageMaterialId || undefined,
        title: form.title,
        budget: Number(form.budget),
        bid: form.bid ? Number(form.bid) : undefined,
        roiGoal: form.roiGoal ? Number(form.roiGoal) : undefined,
        startTime: form.startTime,
        endTime: form.endTime,
        schedule: fullDaySchedule,
        regions: form.regions
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        gender: form.gender,
        age: form.age
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        marketingGoal: "VIDEO_PROM_GOODS",
        optimizationGoal: "AD_CONVERT_TYPE_SHOPPING",
      }),
    onSuccess: async () => {
      setConfirmOpen(false);
      await refresh();
      toast.success("投放已提交，创建成功后默认暂停");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "投放提交失败"),
  });
  const sync = useMutation({
    mutationFn: qianchuanApi.syncDelivery,
    onSuccess: async () => {
      await refresh();
      toast.success("同步任务已提交");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "同步失败"),
  });
  const status = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => qianchuanApi.updateStatus(id, enabled),
    onSuccess: async () => {
      await refresh();
      toast.success("投放状态已更新");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "状态更新失败"),
  });

  const columns = useMemo<ColumnDef<QianchuanDelivery, unknown>[]>(
    () => [
      { accessorKey: "name", header: "计划" },
      { accessorKey: "advertiserId", header: "账户" },
      { accessorKey: "status", header: "状态" },
      { accessorKey: "campaignId", header: "Campaign ID", cell: ({ row }) => row.original.campaignId ?? "—" },
      { accessorKey: "adId", header: "广告 ID", cell: ({ row }) => row.original.adId ?? "—" },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => sync.mutate(row.original.id)}>
              <RefreshCw />
            </Button>
            {row.original.adId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  status.mutate({
                    id: row.original.id,
                    enabled: !["enabled", "active", "AD_STATUS_DELIVERY_OK"].includes(row.original.status),
                  })
                }
              >
                {["enabled", "active", "AD_STATUS_DELIVERY_OK"].includes(row.original.status) ? <Pause /> : <Play />}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [status, sync],
  );

  const readyVideos =
    materials.data?.materials.filter((item) => item.kind === "video" && item.status === "ready") ?? [];
  const readyImages =
    materials.data?.materials.filter((item) => item.kind === "image" && item.status === "ready") ?? [];
  const valid =
    bindingId &&
    advertiserId &&
    form.name &&
    form.productId &&
    form.awemeId &&
    form.videoMaterialId &&
    form.title &&
    Number(form.budget) > 0 &&
    form.startTime &&
    form.endTime;

  return (
    <main className="flex h-[calc(100vh-56px)] min-h-0 flex-col gap-3 overflow-y-auto bg-white p-4 text-ink">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">千川PC投放</h1>
        <Button variant="outline" onClick={refresh}>
          <RefreshCw />
          刷新
        </Button>
      </header>

      <Card className="gap-4 py-4">
        <CardContent className="grid gap-4 px-4 lg:grid-cols-4">
          <Field label="授权商户">
            <NativeSelect
              value={bindingId}
              onChange={(event) => {
                const next = event.target.value;
                const binding = bindings.data?.bindings.find((item) => item.id === next);
                setBindingId(next);
                setAdvertiserId(binding?.defaultAdvertiserId ?? "");
              }}
            >
              <option value="">请选择</option>
              {bindings.data?.bindings.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.subjectName || item.authUserId}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="投放账户">
            <NativeSelect value={advertiserId} onChange={(event) => setAdvertiserId(event.target.value)}>
              <option value="">请选择</option>
              {selectedBinding?.advertisers.map((item) => (
                <option key={item.advertiserId} value={item.advertiserId}>
                  {item.name}（{item.advertiserId}）
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="千川商品">
            <NativeSelect
              value={form.productId}
              onChange={(event) => setForm({ ...form, productId: event.target.value })}
            >
              <option value="">请选择</option>
              {lookups.data?.products.map((item, index) => {
                const id = lookupValue(item, ["product_id", "productId", "id"]);
                return (
                  <option key={id || index} value={id}>
                    {lookupValue(item, ["name", "product_name", "title"]) || id}
                  </option>
                );
              })}
            </NativeSelect>
          </Field>
          <Field label="授权抖音号">
            <NativeSelect value={form.awemeId} onChange={(event) => setForm({ ...form, awemeId: event.target.value })}>
              <option value="">请选择</option>
              {lookups.data?.awemeAccounts.map((item, index) => {
                const id = lookupValue(item, ["aweme_id", "awemeId", "id"]);
                return (
                  <option key={id || index} value={id}>
                    {lookupValue(item, ["name", "aweme_name", "nickname"]) || id}
                  </option>
                );
              })}
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>

      <Card className="gap-4 py-4">
        <CardContent className="grid gap-4 px-4 lg:grid-cols-4">
          <Field label="视频素材库">
            <div className="flex gap-2">
              <NativeSelect value={videoAssetId} onChange={(event) => setVideoAssetId(event.target.value)}>
                <option value="">选择视频</option>
                {assets.data
                  ?.filter((item) => item.mimeType.startsWith("video/"))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </NativeSelect>
              <Button
                variant="outline"
                disabled={!bindingId || !advertiserId || !videoAssetId || upload.isPending}
                onClick={() => upload.mutate({ assetId: videoAssetId, kind: "video" })}
              >
                <Upload />
              </Button>
            </div>
          </Field>
          <Field label="已上传视频">
            <NativeSelect
              value={form.videoMaterialId}
              onChange={(event) => setForm({ ...form, videoMaterialId: event.target.value })}
            >
              <option value="">请选择</option>
              {readyVideos.map((item) => (
                <option key={item.id} value={item.upstreamMaterialId}>
                  {item.upstreamMaterialId}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="封面素材库">
            <div className="flex gap-2">
              <NativeSelect value={imageAssetId} onChange={(event) => setImageAssetId(event.target.value)}>
                <option value="">选择图片</option>
                {assets.data
                  ?.filter((item) => item.mimeType.startsWith("image/"))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </NativeSelect>
              <Button
                variant="outline"
                disabled={!bindingId || !advertiserId || !imageAssetId || upload.isPending}
                onClick={() => upload.mutate({ assetId: imageAssetId, kind: "image" })}
              >
                <Upload />
              </Button>
            </div>
          </Field>
          <Field label="已上传封面">
            <NativeSelect
              value={form.imageMaterialId}
              onChange={(event) => setForm({ ...form, imageMaterialId: event.target.value })}
            >
              <option value="">不设置</option>
              {readyImages.map((item) => (
                <option key={item.id} value={item.upstreamMaterialId}>
                  {item.upstreamMaterialId}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>

      <Card className="gap-4 py-4">
        <CardContent className="grid gap-4 px-4 md:grid-cols-2 lg:grid-cols-4">
          <TextField label="计划名称" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <TextField label="广告标题" value={form.title} onChange={(title) => setForm({ ...form, title })} />
          <TextField
            label="日预算（元）"
            type="number"
            value={form.budget}
            onChange={(budget) => setForm({ ...form, budget })}
          />
          <TextField label="出价（元）" type="number" value={form.bid} onChange={(bid) => setForm({ ...form, bid })} />
          <TextField
            label="目标 ROI"
            type="number"
            value={form.roiGoal}
            onChange={(roiGoal) => setForm({ ...form, roiGoal })}
          />
          <TextField
            label="开始时间"
            type="datetime-local"
            value={form.startTime}
            onChange={(startTime) => setForm({ ...form, startTime })}
          />
          <TextField
            label="结束时间"
            type="datetime-local"
            value={form.endTime}
            onChange={(endTime) => setForm({ ...form, endTime })}
          />
          <Field label="性别">
            <NativeSelect value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })}>
              <option value="ALL">不限</option>
              <option value="MALE">男</option>
              <option value="FEMALE">女</option>
            </NativeSelect>
          </Field>
          <TextField
            label="地域编码（逗号分隔）"
            value={form.regions}
            onChange={(regions) => setForm({ ...form, regions })}
          />
          <TextField label="年龄枚举（逗号分隔）" value={form.age} onChange={(age) => setForm({ ...form, age })} />
          <div className="flex items-end lg:col-span-2">
            <Button className="w-full" disabled={!valid} onClick={() => setConfirmOpen(true)}>
              提交投放
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-72 gap-2 overflow-hidden py-4">
        <CardContent className="px-4">
          <h2 className="font-medium">投放记录</h2>
        </CardContent>
        <DataTable
          className="px-2"
          height={260}
          columns={columns}
          data={deliveries.data?.deliveries ?? []}
          loading={deliveries.isLoading}
          error={deliveries.error}
          emptyMessage="暂无投放记录"
        />
      </Card>

      <Card className="gap-3 py-4">
        <CardContent className="px-4">
          <h2 className="font-medium">今日报表</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {reports.data?.reports.map((report) => (
              <div key={report.id} className="rounded-lg border border-line p-3 text-xs">
                <b>{report.level}</b>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap text-muted">
                  {JSON.stringify(report.metrics, null, 2)}
                </pre>
              </div>
            ))}
            {!reports.data?.reports.length && <span className="text-sm text-muted">同步投放后显示报表</span>}
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认提交千川投放</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 rounded-lg bg-surface-muted p-3 text-sm">
            <span>计划：{form.name}</span>
            <span>账户：{advertiserId}</span>
            <span>日预算：¥{form.budget}</span>
            <span>
              时间：{form.startTime} 至 {form.endTime}
            </span>
            <b>广告创建成功后默认暂停，需要你手动开启。</b>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending && <LoaderCircle className="animate-spin" />}
              确认提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <Field label={label}>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}
