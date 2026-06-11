// T6 验收：长按语音输入全链路（无头环境注入 mock 识别引擎，验证交互链路本身）
//   ① 长按输入框 → 录音浮层出现（含波形/计时/提示）
//   ② 识别文本实时显示在浮层
//   ③ 松开 → 文本回填输入框（不直接发送）
//   ④ 上滑超过阈值 → 取消态提示 → 松开丢弃，输入框不变
//   ⑤ 构建产物无 MiniMax key 泄漏（语音纯前端，顺带全量核查）
// 真机项（iOS Safari 触感/微信内浏览器降级提示/真实 Siri 识别质量）→ 验收清单标「待人工真机复核」
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
// 注入 mock 识别引擎：start 后 600ms 吐 interim、1200ms 吐 final
await ctx.addInitScript(() => {
  class MockSR {
    constructor() { this.onresult = null; this.onerror = null; this._t = []; }
    start() {
      this._t.push(setTimeout(() => {
        this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "我想找一本" }], { isFinal: false })] });
      }, 600));
      this._t.push(setTimeout(() => {
        this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "我想找一本讲历史的书" }], { isFinal: true })] });
      }, 1200));
    }
    stop() { this._t.forEach(clearTimeout); }
    abort() { this.stop(); }
  }
  window.__AIL_SR = MockSR;
  // 无头环境没有真麦克风：getUserMedia 直接拒绝，走"匀速呼吸"波形回退（也是被测路径）
});
const page = await ctx.newPage();
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => (document.body.textContent || "").includes("热门") || !!document.querySelector("textarea"), { timeout: 20000 });
await page.waitForTimeout(1500);

const ta = page.locator("textarea");
const box = await ta.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

/* ①②③ 长按 → 实时文本 → 松开回填 */
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.waitForTimeout(900); // 350ms 长按阈值 + 启动余量
const overlayUp = await page.evaluate(() => (document.body.textContent || "").includes("上滑取消"));
ok(overlayUp, "① 长按出现录音浮层");
const hasTimer = await page.evaluate(() => /\d{2}:\d{2}/.test(document.body.textContent || ""));
ok(hasTimer, "①b 浮层含计时");
await page.waitForTimeout(800); // 等 mock 吐 final
const liveText = await page.evaluate(() => (document.body.textContent || "").includes("我想找一本讲历史的书"));
ok(liveText, "② 识别文本实时显示在浮层");
await page.mouse.up();
await page.waitForTimeout(500);
const filled = await ta.inputValue();
ok(filled === "我想找一本讲历史的书", "③ 松开后文本回填输入框（确认后才发送）", `输入框=${filled}`);
const notSent = await page.evaluate(() => !document.querySelector(".rounded-tr-sm")); // 没有用户消息气泡
ok(notSent, "③b 未直接发送（无用户消息气泡）");
fs.mkdirSync(".e2e/ui-review", { recursive: true });

/* ④ 上滑取消 */
await ta.fill(""); // 清空再测取消路径
await page.evaluate(() => document.querySelector("textarea")?.blur()); // fill 会聚焦输入框，聚焦态下长按不触发语音（设计如此）
await page.waitForTimeout(200);
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.waitForTimeout(900);
await page.mouse.move(cx, cy - 120, { steps: 8 }); // 上滑超过 90px 阈值
await page.waitForTimeout(300);
const cancelHint = await page.evaluate(() => (document.body.textContent || "").includes("取消这段话"));
ok(cancelHint, "④ 上滑进入取消态（红色提示）");
await page.screenshot({ path: ".e2e/ui-review/T6-语音-取消态.png" });
await page.mouse.up();
await page.waitForTimeout(400);
const stillEmpty = (await ta.inputValue()) === "";
ok(stillEmpty, "④b 取消后输入框为空（识别文本被丢弃）");

await browser.close();

/* ⑤ 构建产物 key 泄漏检查 */
const chunks = fs.readdirSync(".next/static/chunks").filter((f) => f.endsWith(".js"));
let leak = false;
for (const f of chunks) {
  const s = fs.readFileSync(`.next/static/chunks/${f}`, "utf8");
  if (/MINIMAX_API_KEY|sk-cp-|SUPABASE_SERVICE_ROLE/.test(s)) { leak = true; console.log("   泄漏于", f); }
}
ok(!leak, "⑤ 客户端 bundle 无 MiniMax key / service_role 泄漏", `检查 ${chunks.length} 个 chunk`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
