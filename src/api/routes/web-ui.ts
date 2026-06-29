/**
 * Web UI 静态文件服务路由
 *
 * 来源：Task 025 第 5.1 节。Task 035 新增 /assets/* 二进制静态资源路由。
 *
 * 提供：
 *   - GET /           → web/index.html
 *   - GET /styles.css → web/styles.css
 *   - GET /home.js    → web/home.js（Task 038 新增）
 *   - GET /requirement-chat.js → web/requirement-chat.js（Task 038 新增）
 *   - GET /watch-rules-editor.js → web/watch-rules-editor.js
 *   - GET /assets/*   → web/assets/* 二进制静态资源（Logo 等）
 *   - GET /*          → fallback 到 index.html（SPA 模式）
 *
 * 使用 fs.readFileSync + c.body() 实现，兼容性最好（参考附录 C）。
 * 不引入新依赖，用 Node.js 内置 fs + path。
 */

import { Hono } from "hono";
import type { Context } from "hono";
import fs from "fs";
import path from "path";

/** 根据文件扩展名推断 Content-Type */
function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * 创建 Web UI 静态文件服务路由。
 *
 * @returns Hono 实例，挂载到根路径 /
 */
export function webUiRoutes(): Hono {
  const app = new Hono();
  const webDir = path.resolve(process.cwd(), "web");

  /**
   * 返回指定静态文件（文本）。
   * 文件不存在时返回 404 JSON（与全局 404 处理一致）。
   */
  function serveFile(relativePath: string, contentType: string) {
    return (c: Context) => {
      const fullPath = path.join(webDir, relativePath);
      if (!fs.existsSync(fullPath)) {
        return c.json(
          {
            success: false,
            data: null,
            error: {
              code: "NOT_FOUND",
              message: `静态文件不存在: ${relativePath}`,
            },
            duration_ms: 0,
          },
          404,
        );
      }
      const content = fs.readFileSync(fullPath, "utf-8");
      c.header("Content-Type", contentType);
      c.header("Cache-Control", "no-cache");
      return c.body(content);
    };
  }

  /**
   * 返回指定二进制静态资源（Logo 等图片）。
   * 使用 Buffer 读取，避免 utf-8 编码损坏二进制文件。
   */
  function serveBinaryFile(relativePath: string) {
    return (c: Context) => {
      const fullPath = path.join(webDir, relativePath);
      if (!fs.existsSync(fullPath)) {
        return c.json(
          {
            success: false,
            data: null,
            error: {
              code: "NOT_FOUND",
              message: `静态资源不存在: ${relativePath}`,
            },
            duration_ms: 0,
          },
          404,
        );
      }
      const content = fs.readFileSync(fullPath);
      c.header("Content-Type", getContentType(fullPath));
      c.header("Cache-Control", "public, max-age=86400");
      return c.body(content as unknown as ArrayBuffer);
    };
  }

  // 根路径 → index.html
  app.get("/", serveFile("index.html", "text/html; charset=utf-8"));

  // 静态资源
  app.get("/styles.css", serveFile("styles.css", "text/css; charset=utf-8"));
  app.get(
    "/home.js",
    serveFile("home.js", "application/javascript; charset=utf-8"),
  );
  app.get(
    "/requirement-chat.js",
    serveFile("requirement-chat.js", "application/javascript; charset=utf-8"),
  );
  app.get(
    "/watch-rules-editor.js",
    serveFile("watch-rules-editor.js", "application/javascript; charset=utf-8"),
  );

  // 二进制静态资源（Logo 等）：/assets/logo.png → web/assets/logo.png
  app.get("/assets/:filename", (c) => {
    const filename = c.req.param("filename");
    return serveBinaryFile(`assets/${filename}`)(c);
  });

  // 注意：不添加 SPA fallback（/* 通配会捕获 /nonexistent 等路径，
  // 导致全局 404 处理失效）。单页编辑器无需客户端路由。

  return app;
}
