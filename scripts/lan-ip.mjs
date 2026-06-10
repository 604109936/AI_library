// 打印本机局域网 IPv4（手机验收用地址）
import os from "node:os";
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  for (const a of addrs ?? []) {
    if (a.family === "IPv4" && !a.internal) console.log(`${name}: http://${a.address}:3000`);
  }
}
