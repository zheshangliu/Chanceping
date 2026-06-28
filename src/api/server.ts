import { serve } from "@hono/node-server";
import { createApp } from "./app";

const port = parseInt(process.env.PORT ?? "3000", 10);
const app = createApp();

console.log(`[ChancePing API] 服务器启动中...`);
console.log(`[ChancePing API] 端口: ${port}`);
console.log(`[ChancePing API] 健康检查: http://localhost:${port}/health`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`[ChancePing API] 服务器已启动`);
