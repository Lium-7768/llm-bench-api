import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 本项目是 API 优先的：所有 /api/v1/* 路由都依赖请求体与进程内存状态，
   * 必须每次都实时执行，因此不使用 Next 的 cacheComponents / partialPrefetching，
   * 改为在每个路由文件里显式声明 `export const dynamic = "force-dynamic"`。
   */
  poweredByHeader: false,
};

export default nextConfig;
