const child = Bun.spawn(["ffmpeg", "-hide_banner", "-filters"], { stdout: "pipe", stderr: "pipe" });
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
if (exitCode !== 0) throw new Error(`FFmpeg 不可用：${stderr.slice(-1_000)}`);
if (!/\bsubtitles\b/.test(stdout)) throw new Error("FFmpeg 缺少 subtitles/libass 滤镜，请安装启用 libass 的 FFmpeg");
const fonts = Bun.spawn(["fc-list", ":lang=zh", "family"], { stdout: "pipe", stderr: "pipe" });
const [fontList, fontExitCode] = await Promise.all([new Response(fonts.stdout).text(), fonts.exited]);
if (fontExitCode !== 0 || !fontList.trim()) throw new Error("系统缺少中文字体，请安装 fonts-noto-cjk");
console.log("FFmpeg production check passed: subtitles/libass and Chinese fonts available");

export {};
