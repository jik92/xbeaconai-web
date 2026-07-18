import { expect, test, type Page } from "@playwright/test";
import { modules } from "../../src/app/routes";
import { isModuleOpen } from "../../src/app/config";

const testPassword="Playwright12345";
async function authorization(page:Page){const token=await page.evaluate(()=>localStorage.getItem("yaozuo:auth-token:v1"));return {Authorization:`Bearer ${token}`}}

test.beforeEach(async({page,request},testInfo)=>{
  const email=`e2e-${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response=await request.post("/api/auth/register",{data:{email,password:testPassword,displayName:"端测用户"}});
  expect(response.status()).toBe(201);
  const {token}=await response.json() as {token:string};
  await page.addInitScript(({token})=>localStorage.setItem("yaozuo:auth-token:v1",token),{token});
});

async function completeField(page: Page, field: (typeof modules)[number]["fields"][number]) {
  if (!field.required) return;
  if (["video", "audio", "image"].includes(field.kind)) {
    await page.locator(`#${field.id}`).setInputFiles({ name: `${field.id}.mp4`, mimeType: field.kind === "audio" ? "audio/mpeg" : "video/mp4", buffer: Buffer.from("mock") });
  } else if (field.kind === "asset-group") {
    await page.locator(`#${field.id}`).setInputFiles({ name: `${field.id}.png`, mimeType: "image/png", buffer: Buffer.from("mock-image") });
    await expect(page.getByText("已上传 1 个素材")).toBeVisible();
  } else if (field.kind === "region" || field.kind === "checkbox") {
    await page.locator(`#${field.id}`).click();
  } else if (field.kind === "select") {
    await page.locator(`#${field.id}`).selectOption({ index: 1 });
  } else if (field.kind === "text" || field.kind === "textarea") {
    await page.locator(`#${field.id}`).fill(`测试${field.label}`);
  }
}

for (const module of modules) {
  if (module.id === "video-remix" || module.id === "ai-generate" || !isModuleOpen(module.id)) continue;
  test(`${module.label} exposes its complete business workflow`, async ({ page }) => {
    await page.goto(module.path);
    await expect(page.getByRole("heading", { name: module.label, exact: true })).toBeVisible();
    for (const step of module.steps) await expect(page.locator(".steps").getByText(step)).toBeVisible();
    const splitAt = Math.ceil(module.fields.length / 2);
    for (const field of module.fields.slice(0, splitAt)) { await expect(page.locator(".field > label").filter({ hasText: field.label }).first()).toBeVisible(); await completeField(page, field); }
    await page.getByRole("button", { name: "下一步" }).click();
    for (const field of module.fields.slice(splitAt)) { await expect(page.locator(".field > label").filter({ hasText: field.label }).first()).toBeVisible(); await completeField(page, field); }
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByRole("heading", { name: "确认创作配置" })).toBeVisible();
    await expect(page.getByRole("button", { name: module.action })).toBeVisible();
    await expect(page.getByText(`预计消耗 ${module.cost} 创作点`)).toBeVisible();
  });
}

test("closed creation workflows show Coming Soon while AI tools stay open", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/tools\/ai-generate$/);
  await expect(page.getByRole("heading",{name:"AI 创作",exact:true})).toBeVisible();
  for(const module of modules.filter(item=>item.group==="创作工作流")){
    await expect(page.getByLabel(`${module.label} Coming Soon`)).toBeVisible();
    await expect(page.getByRole("link",{name:module.label,exact:true})).toHaveCount(0);
    await page.goto(module.path);
    await expect(page.getByText("COMING SOON",{exact:true})).toBeVisible();
    await expect(page.getByRole("heading",{name:module.label,exact:true})).toBeVisible();
  }
});

test("AI creation composer matches the product configuration flow without a paid request",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop","Composer interaction contract is exercised once on desktop");
  await page.goto("/tools/ai-generate");
  await expect(page.getByRole("heading",{name:"AI 创作",exact:true})).toBeVisible();
  await expect(page.getByPlaceholder("请输入创意描述")).toBeVisible();
  await expect(page.getByText("字节 Seedream 5.0 Pro")).toBeVisible();
  await expect(page.getByText("70星点")).toBeVisible();
  await page.locator(".composer-trigger").filter({hasText:"4:3"}).click();
  await expect(page.getByText("W 2304 px")).toBeVisible();
  await expect(page.getByText("H 1728 px")).toBeVisible();
  await page.locator(".composer-trigger").filter({hasText:"4:3"}).click();
  await page.locator(".composer-trigger").filter({hasText:"1张"}).click();
  await expect(page.getByRole("button",{name:"8",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"随机种子"}).click();
  await expect(page.locator(".seed-input input")).not.toHaveValue("");
  await page.locator(".composer-trigger").filter({hasText:"1张"}).click();
  await page.locator(".composer-trigger").filter({hasText:"图片生成"}).click();
  await page.locator(".composer-popover").getByRole("button",{name:"视频生成",exact:true}).click();
  await expect(page.getByPlaceholder(/使用@快速调用参考内容/)).toBeVisible();
  await expect(page.getByText("字节 Seedance 2.0",{exact:true})).toBeVisible();
  await page.locator(".composer-trigger").filter({hasText:"字节 Seedance 2.0"}).click();
  await expect(page.locator(".composer-model-list>button")).toHaveCount(3);
  await expect(page.getByText("字节 Seedance 2.0 Mini",{exact:true})).toBeVisible();
  await expect(page.getByText("字节 Seedance 2.0 Fast",{exact:true})).toBeVisible();
  await page.locator(".composer-trigger").filter({hasText:"字节 Seedance 2.0"}).click();
  await page.locator(".composer-trigger").filter({hasText:"全能参考"}).click();
  await expect(page.getByRole("button",{name:/首帧模式/})).toBeDisabled();
  await expect(page.getByRole("button",{name:/首尾帧模式/})).toBeDisabled();
  await page.locator(".composer-trigger").filter({hasText:"全能参考"}).click();
  await page.locator(".composer-trigger").filter({hasText:"720P"}).click();
  await expect(page.getByRole("button",{name:"1080p",exact:true})).toBeDisabled();
  await page.locator(".composer-trigger").filter({hasText:"720P"}).click();
  await page.locator(".composer-trigger").filter({hasText:"5s"}).click();
  await expect(page.getByRole("button",{name:"2",exact:true})).toBeDisabled();
  await expect(page.locator(".seed-input input")).toBeDisabled();
  await page.locator(".composer-trigger").filter({hasText:"5s"}).click();
  await page.getByPlaceholder(/使用@快速调用参考内容/).fill("镜头缓慢推近一只放在窗边的橙色杯子");
  await page.getByText("提交前手动确认").click();
  await page.getByRole("button",{name:"提交创作"}).click();
  await expect(page.getByRole("heading",{name:"确认视频生成参数"})).toBeVisible();
  await page.getByRole("button",{name:"确认并提交"}).click();
  const videoRow=page.locator("tbody tr").filter({hasText:"视频创作"});
  await expect(videoRow).toBeVisible();
  await expect(videoRow.getByText("已完成",{exact:true})).toBeVisible({timeout:10_000});
  await expect(videoRow.locator(".task-kind.mock")).toBeVisible();
  await page.goto("/tools/video-cut");
  await expect(page.getByText("本地处理，不使用视频生成模型")).toBeVisible();
});

test("AI creation image Mock submission completes through the async queue",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop","Mock creation submission is exercised once on desktop");
  await page.goto("/tools/ai-generate");
  const headers=await authorization(page);
  const before=await (await page.request.get("/api/auth/me",{headers})).json() as {user:{credits:number}};
  await page.getByPlaceholder("请输入创意描述").fill("一只橙色猫咪坐在蓝色窗边，柔和晨光");
  await page.getByRole("button",{name:"提交创作"}).click();
  await expect(page.getByText(/图片创作/).first()).toBeVisible();
  await expect(page.getByText("已完成",{exact:true}).first()).toBeVisible({timeout:10_000});
  await expect(page.locator(".task-kind.mock").first()).toBeVisible();
  const after=await (await page.request.get("/api/auth/me",{headers})).json() as {user:{credits:number}};
  expect(after.user.credits).toBe(before.user.credits-70);
});

test("required field validation blocks an incomplete task", async ({ page }) => {
  test.skip(!isModuleOpen("ad-script"),"口播脚本等待产品验收");
  await page.goto("/tools/ai-generate");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText("请完成此项后再提交")).toHaveCount(3);
});

test("navigation keeps all twelve modules reachable", async ({ page }) => {
  await page.goto("/tools/ai-generate");
  for (const module of modules) if(isModuleOpen(module.id))await expect(page.getByRole("link", { name: new RegExp(module.label) })).toBeVisible();else await expect(page.getByLabel(`${module.label} Coming Soon`)).toBeVisible();
});

test("人像库 loads, filters and opens a portrait dossier", async ({ page }) => {
  await page.goto("/assets/portraits");
  await expect(page.getByRole("heading", { name: "人像库" })).toBeVisible();
  await expect(page.getByText("1,125").first()).toBeVisible();
  await page.getByPlaceholder("搜索职业、年龄或人物描述…").fill("养蜂人");
  await expect(page.getByText(/\d+ 个匹配结果/)).toBeVisible();
  await page.locator(".portrait-card").first().click();
  await expect(page.getByText("PORTRAIT DOSSIER")).toBeVisible();
  await expect(page.getByRole("button", { name: "用于创作" })).toBeVisible();
  await page.getByRole("button", { name: "用于创作" }).click();
  await expect(page).toHaveURL(/\/aigc\/video-remix$/);
  await expect(page.getByText("COMING SOON",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"爆款二创",exact:true})).toBeVisible();
});

test("account workspace supports registration, settings, recharge and password lifecycle",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop","Account lifecycle is exercised once on desktop");
  await page.goto("/tools/ai-generate");
  await expect(page.getByRole("button",{name:"创作中心"})).toHaveCount(0);
  await page.getByRole("button",{name:"个人账号"}).click();
  await page.getByRole("button",{name:"退出登录"}).click();
  await expect(page.getByRole("button",{name:"登录工作台"})).toBeVisible();
  await page.getByRole("button",{name:"注册",exact:true}).click();
  const email=`ui-account-${Date.now()}@example.com`;
  await page.getByPlaceholder("你的工作室或昵称").fill("创作测试账号");
  await page.getByPlaceholder("name@example.com").fill(email);
  await page.getByPlaceholder("至少 10 位，包含字母和数字").fill(testPassword);
  await page.getByRole("button",{name:"创建账号并登录"}).click();
  await expect(page.getByRole("heading",{name:"AI 创作",exact:true})).toBeVisible();

  await page.getByRole("button",{name:"帮助"}).click();
  await expect(page.getByRole("heading",{name:"使用帮助"})).toBeVisible();
  await page.getByRole("button",{name:"关闭"}).click();
  await page.getByRole("button",{name:"偏好设置"}).click();
  await page.getByLabel("默认画面比例").selectOption("16:9");
  await page.getByLabel("自动播放结果").check();
  await page.getByRole("button",{name:"保存设置"}).click();
  await expect(page.getByText("偏好设置已保存")).toBeVisible();
  await page.getByRole("button",{name:"关闭"}).click();

  await page.getByRole("button",{name:"充值"}).click();
  await expect(page.getByText(/不会调用真实支付渠道/)).toBeVisible();
  await page.getByRole("button",{name:"模拟支付"}).first().click();
  await expect(page.getByText(/到账 1,000 创作点/)).toBeVisible();
  await expect(page.getByText("最近订单")).toBeVisible();
  await page.getByRole("button",{name:"关闭"}).click();

  await page.getByRole("button",{name:"个人账号"}).click();
  await page.getByRole("button",{name:/个人资料/}).click();
  await page.getByLabel("头像文字").fill("创");
  await page.getByLabel("显示名称").fill("已更新创作者");
  await page.getByRole("button",{name:"保存个人资料"}).click();
  await expect(page.getByText("个人资料已更新")).toBeVisible();
  await page.getByRole("button",{name:"关闭"}).click();
  await expect(page.getByRole("button",{name:"个人账号"})).toHaveText("创");

  await page.getByRole("button",{name:"通知"}).click();
  await expect(page.getByText("充值成功")).toBeVisible();
  await page.getByRole("button",{name:"全部已读"}).click();
  await expect(page.getByText("0 条未读")).toBeVisible();
  await page.getByRole("button",{name:"关闭"}).click();

  await page.getByRole("button",{name:"个人账号"}).click();
  await page.getByRole("button",{name:/账号与密码/}).click();
  await page.getByLabel("当前密码").fill(testPassword);
  await page.getByLabel("新密码",{exact:true}).fill("Changed12345");
  await page.getByLabel("确认新密码").fill("Changed12345");
  await page.getByRole("button",{name:"修改密码"}).click();
  await expect(page.getByRole("button",{name:"登录工作台"})).toBeVisible();
  await page.getByPlaceholder("name@example.com").fill(email);
  await page.getByPlaceholder("输入密码").fill("Changed12345");
  await page.getByRole("button",{name:"登录工作台"}).click();
  await expect(page.getByRole("heading",{name:"AI 创作",exact:true})).toBeVisible();
});

test("口播脚本 completes from validated brief to result preview", async ({ page }) => {
  test.skip(!isModuleOpen("ad-script"),"口播脚本等待产品验收");
  await page.goto("/aigc/ad-script");
  await page.locator("#product").fill("便携榨汁杯");
  await page.locator("#sellingPoints").fill("轻巧随身\n30 秒出汁\n低噪清洗方便");
  await page.locator("#audience").fill("独居上班族");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.locator("#framework").selectOption({ label: "痛点—方案—证据—行动" });
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "生成 3 版脚本" }).click();
  await expect(page.getByText("已完成", { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: "查看结果" }).first().click();
  await expect(page.getByRole("heading", { name: "口播脚本", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "一键成片" })).toBeVisible();
});

test("active tasks can be cancelled and retried", async ({ page }, testInfo) => {
  test.skip(!isModuleOpen("ad-script"),"口播脚本等待产品验收");
  test.skip(testInfo.project.name !== "desktop", "Shared queue cancellation is exercised once on desktop");
  await page.goto("/aigc/ad-script");
  await page.locator("#product").fill("演示商品");
  await page.locator("#sellingPoints").fill("核心卖点");
  await page.locator("#audience").fill("目标用户");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.locator("#framework").selectOption({ index: 1 });
  await page.getByRole("button", { name: "下一步" }).click();
  const [response]=await Promise.all([page.waitForResponse(item=>item.url().includes("/api/ad-script/jobs")&&item.request().method()==="POST"),page.getByRole("button", { name: "生成 3 版脚本" }).click()]);
  const created=await response.json() as {id:string;title:string};
  await page.locator("tbody tr").filter({hasText:created.title}).getByRole("button", { name: "取消" }).click();
  const headers=await authorization(page);
  await expect.poll(async()=>((await page.request.get(`/api/jobs/${created.id}`,{headers})).json() as Promise<{status:string}>).then(item=>item.status)).toBe("cancelled");
  await page.reload();
  const cancelled=page.locator("tbody tr").filter({hasText:created.title});
  await expect(cancelled.getByText("已取消", { exact: true })).toBeVisible();
  await expect(cancelled.getByRole("button", { name: "重试" })).toBeVisible();
});

test("every generic result action is executable end to end", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Full action matrix is exercised once on desktop");
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin:"http://127.0.0.1:4173" });
  await page.goto("/tools/ai-generate");
  const headers=await authorization(page);
  const generic=modules.filter(module=>module.id!=="video-remix"&&isModuleOpen(module.id));
  const jobs=await Promise.all(generic.map(async module=>{
    const title=`action-matrix-${module.id}-${Date.now()}`;
    const response=await page.request.post(`/api/${module.id}/jobs`,{headers:{...headers,"Idempotency-Key":crypto.randomUUID()},data:{title,values:{type:"图片"},allowMockFallback:true}});
    expect(response.status()).toBe(202);
    return {module,title,id:(await response.json() as {id:string}).id};
  }));
  await Promise.all(jobs.map(async job=>{
    for(let attempt=0;attempt<100;attempt+=1){const response=await page.request.get(`/api/jobs/${job.id}`,{headers});const body=await response.json() as {status:string};if(["succeeded","partially_succeeded"].includes(body.status))return;if(["failed","cancelled"].includes(body.status))throw new Error(`${job.module.id} ended as ${body.status}`);await new Promise(resolve=>setTimeout(resolve,250))}throw new Error(`${job.module.id} timed out`);
  }));
  for(const job of jobs){
    await page.goto(job.module.path);
    const row=page.locator("tbody tr").filter({hasText:job.title});
    await expect(row).toBeVisible();
    const open=async()=>{await row.getByRole("button",{name:"查看结果"}).click();await expect(page.locator(".result-drawer")).toBeVisible()};
    await open();
    for(const action of job.module.result.actions){
      if(!await page.locator(".result-drawer").isVisible())await open();
      const button=page.locator(".result-drawer").getByRole("button",{name:action,exact:true});
      await expect(button).toBeVisible();
      if(action.includes("下载")||action.includes("导出")){await Promise.all([page.waitForEvent("download"),button.click()]);continue}
      await button.click();
      if(action.includes("一键成片")||action.includes("用于混剪")||action.includes("合并片段")){await expect(page).not.toHaveURL(new RegExp(`${job.module.path.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}$`));await page.goto(job.module.path)}
      else if(action.includes("删除")||/再次|重新|调整|改写|变体|替换|编辑|继续/.test(action))await expect(page.locator(".result-drawer")).toBeHidden();
      else await expect(page.locator(".safe-note").last()).toBeVisible();
    }
  }
});

test("every specialized remix control is actionable", async ({ page, context }, testInfo) => {
  test.skip(!isModuleOpen("video-remix"),"爆款二创等待产品验收");
  test.skip(testInfo.project.name !== "desktop", "Specialized control matrix is exercised once on desktop");
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"],{origin:"http://127.0.0.1:4173"});
  await page.goto("/aigc/video-remix");
  await page.getByRole("button",{name:"项目记录"}).click();
  await expect(page.getByText("暂无当前项目任务")).toBeVisible();
  await page.getByRole("button",{name:"新建"}).click();
  await expect(page.getByText("已创建新项目")).toBeVisible();
  await page.getByRole("button",{name:"纯口播模式"}).click();
  await expect(page.getByRole("button",{name:"纯口播模式"})).toHaveClass(/active/);
  await page.getByRole("button",{name:"含商品模式"}).click();
  await page.getByPlaceholder("描述商品卖点、目标人群和希望调整的表达风格…").fill("面向职场新人，强化前三秒冲突");
  await page.locator("#remix-source").setInputFiles({name:"remix-controls.mp4",mimeType:"video/mp4",buffer:Buffer.from("mock")});
  await expect(page.getByText("已安全上传，可重新选择")).toBeVisible();
  await page.getByRole("button",{name:"下一步"}).click();
  await page.getByRole("button",{name:"开始 AI 解析"}).click();
  await expect(page.getByRole("button",{name:"智能修改"})).toBeVisible({timeout:30_000});
  await page.locator(".proof-assets label button").click();
  await expect(page.getByText("已从商品库选择演示商品")).toBeVisible();
  await page.locator(".editor-toolbar .toggle").click();
  await expect(page.locator(".editor-toolbar .toggle")).toHaveClass(/active/);
  await page.getByRole("button",{name:"智能检查"}).click();
  await expect(page.getByText(/智能检查通过/)).toBeVisible();
  await page.getByRole("button",{name:"智能修改"}).click();
  await expect(page.getByText("已完成智能修改")).toBeVisible();
  await page.getByRole("button",{name:"换口播"}).click();
  await expect(page.getByText(/沉稳男声/)).toBeVisible();
  await page.getByRole("button",{name:"编辑文本"}).click();
  await page.locator(".prompt-paper textarea").fill("复审后的二创脚本");
  await page.getByRole("button",{name:"保存文本"}).click();
  await page.getByRole("button",{name:"复制脚本"}).click();
  await expect(page.getByText("脚本已复制")).toBeVisible();
  const refreshed=page.waitForResponse(response=>response.url().includes("/api/video-remix/jobs")&&response.request().method()==="POST");
  await page.locator(".source-card button").click();
  const refreshedJob=await (await refreshed).json() as {id:string};
  const headers=await authorization(page);
  await expect.poll(async()=>((await page.request.get(`/api/jobs/${refreshedJob.id}`,{headers})).json() as Promise<{status:string}>).then(item=>item.status),{timeout:30_000}).toBe("succeeded");
  await page.locator(".editor-bottom").getByRole("button",{name:"下一步"}).click();
  await page.getByRole("button",{name:"智能调整全部"}).click();
  await expect(page.getByText(/已智能调整全部分镜节奏/)).toBeVisible();
  page.once("dialog",dialog=>dialog.accept("更新后的分镜口播"));
  await page.getByRole("button",{name:"编辑分镜"}).first().click();
  await expect(page.getByText("分镜 1 已更新")).toBeVisible();
  await page.locator(".project-footer").getByRole("button",{name:"下一步"}).click();
  await expect(page.getByRole("heading",{name:"确认合并成片"})).toBeVisible();
  await expect(page.getByRole("button",{name:"查看生成结果"})).toBeVisible({timeout:30_000});
  await page.getByRole("button",{name:"预览合成效果"}).click();
  await page.getByRole("button",{name:"对比原片"}).click();
  await page.getByRole("button",{name:"预览成片"}).click();
  await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"导出视频"}).click()]);
  await page.getByRole("button",{name:"再次改写"}).click();
  await expect(page.getByRole("button",{name:"智能修改"})).toBeVisible();
});
