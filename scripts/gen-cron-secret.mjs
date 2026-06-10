// 生成 CRON_SECRET 写入 .env.local（已存在则不动；密钥不打印到终端）
import fs from "node:fs";
import crypto from "node:crypto";

const file = new URL("../.env.local", import.meta.url);
let text = fs.readFileSync(file, "utf8");
if (/^CRON_SECRET=/m.test(text)) {
  console.log("CRON_SECRET 已存在，跳过");
} else {
  if (!/\n$/.test(text)) text += "\n";
  text += `CRON_SECRET=${crypto.randomBytes(24).toString("hex")}\n`;
  fs.writeFileSync(file, text);
  console.log("CRON_SECRET 已生成并写入 .env.local");
}
