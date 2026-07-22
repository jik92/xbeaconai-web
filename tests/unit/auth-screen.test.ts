import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("compact auth screen", () => {
  test("shares shadcn controls across all auth views without legacy auth CSS", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/account/auth-screen.tsx")).text();
    const css = await Bun.file(resolve(import.meta.dir, "../../web/styles/account.css")).text();

    expect(source).toContain('login: "登录"');
    expect(source).toContain('register: "注册"');
    expect(source).toContain('forgot: "忘记密码"');
    expect(source).toContain('setup: "设置登录密码"');
    expect(source).toContain('from "@/components/ui/button"');
    expect(source).toContain('from "@/components/ui/card"');
    expect(source).toContain('from "@/components/ui/input"');
    expect(source).toContain('from "@/components/ui/label"');
    expect(source).toContain('className="h-[480px] w-full max-w-sm');
    expect(source).toContain("当前验证码：");
    expect(source).not.toContain("一个账号，连接你的全部创作任务与素材");
    expect(source).not.toContain("本地工作台 · 数据保存在当前设备的 SQLite 中");
    expect(css).not.toContain(".auth-");
  });
});
