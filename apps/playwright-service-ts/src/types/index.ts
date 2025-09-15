import { Browser, BrowserContext, Page } from 'playwright';

export interface ScrapeRequetParam {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  // 改为actions实现
  // check_selector?: string;
  skip_tls_verification?: boolean;
  geolocation?: { country?: string; languages?: string[] };
  priority?: number;
  blockAds?: boolean;
  screenshot?: boolean;
  fullPageScreenshot?: boolean;
  mobileProxy?: boolean;
  saveScrapeResultToGCS?: boolean;
  zeroDataRetention?: boolean;
  actions?: Action[];
}

// 需要添加 Action 类型定义
export type Action = 
  | { type: "wait"; milliseconds?: number; selector?: string }
  | { type: "click"; selector: string; all?: boolean }
  | { type: "screenshot"; fullPage?: boolean; quality?: number }
  | { type: "write"; text: string }
  | { type: "press"; key: string }
  | { type: "scroll"; direction?: "up" | "down"; selector?: string }
  | { type: "scrape" }
  | { type: "executeJavascript"; script: string }
  | { type: "pdf"; landscape?: boolean; scale?: number; format?: string };

export interface ScrapeResult {
  content: string;
  status: number | null;
  headers: any;
  contentType?: string;
}

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}