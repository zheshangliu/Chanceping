/**
 * E2E 测试全局类型声明
 *
 * 来源：Task 041 验收修复
 *
 * 用途：
 *   - 声明 puppeteer 模块类型（optionalDependencies，可能未安装）
 *   - 声明 DOM 全局类型（tsconfig.json 的 lib 不含 "DOM"）
 *
 * 注意：仅在 scripts/ 目录生效，不影响 src/ 代码
 */

// ============================================================
// puppeteer 模块声明（optionalDependencies，可能未安装）
// ============================================================

declare module "puppeteer" {
  export interface Page {
    goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
    type(selector: string, text: string): Promise<void>;
    click(selector: string): Promise<void>;
    $(selector: string): Promise<ElementHandle | null>;
    $$(selector: string): Promise<ElementHandle[]>;
    $eval(selector: string, fn: (el: any) => any): Promise<any>;
    $$eval(selector: string, fn: (els: any[]) => any): Promise<any>;
    evaluate(fn: () => any): Promise<any>;
    waitForSelector(selector: string, options?: Record<string, unknown>): Promise<ElementHandle>;
    waitForFunction(fn: () => boolean, options?: Record<string, unknown>): Promise<void>;
    screenshot(options: Record<string, unknown>): Promise<void>;
    setViewport(options: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
  }

  export interface ElementHandle {
    click(): Promise<void>;
    dispose(): Promise<void>;
  }

  export interface Browser {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  const _default: {
    launch(options?: Record<string, unknown>): Promise<Browser>;
  };
  export default _default;
}
