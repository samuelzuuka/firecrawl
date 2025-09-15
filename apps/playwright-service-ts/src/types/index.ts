import { Browser, BrowserContext, Page } from 'playwright';

export interface UrlModel {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  check_selector?: string;
  skip_tls_verification?: boolean;
}

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