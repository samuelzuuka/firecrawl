import { z } from "zod";
import { EngineScrapeResult } from "..";
import { Meta } from "../..";
import { robustFetch } from "../../lib/fetch";
import { getInnerJson } from "@mendable/firecrawl-rs";
import { Logger } from "winston";
import { MockState } from "../../lib/mock";
import { specialtyScrapeCheck } from "../utils/specialtyHandler";

// 请求类型定义
type PlaywrightScrapeRequestCommon = {
  url: string;
  headers?: { [K: string]: string };
  wait_after_load?: number;
  timeout?: number;
  skip_tls_verification?: boolean;
  geolocation?: { country?: string; languages?: string[] };
  priority?: number;
  blockAds?: boolean;
  screenshot?: boolean;
  fullPageScreenshot?: boolean;
  mobileProxy?: boolean;
  saveScrapeResultToGCS?: boolean;
  zeroDataRetention?: boolean;
};

const successSchema = z.object({
  jobId: z.string(),
  state: z.literal("completed"),
  processing: z.literal(false),

  // timeTaken: z.number(),
  content: z.string(),
  url: z.string().optional(),

  pageStatusCode: z.number(),
  pageError: z.string().optional(),

  // TODO: this needs to be non-optional, might need fixes on f-e side to ensure reliability
  responseHeaders: z.record(z.string(), z.string()).optional(),

  // timeTakenCookie: z.number().optional(),
  // timeTakenRequest: z.number().optional(),

  // legacy: playwright only
  screenshot: z.string().optional(),

  // new: actions
  screenshots: z.string().array().optional(),
  actionContent: z
    .object({
      url: z.string(),
      html: z.string(),
    })
    .array()
    .optional(),
  actionResults: z
    .union([
      z.object({
        idx: z.number(),
        type: z.literal("screenshot"),
        result: z.object({
          path: z.string(),
        }),
      }),
      z.object({
        idx: z.number(),
        type: z.literal("scrape"),
        result: z.union([
          z.object({
            url: z.string(),
            html: z.string(),
          }),
          z.object({
            url: z.string(),
            accessibility: z.string(),
          }),
        ]),
      }),
      z.object({
        idx: z.number(),
        type: z.literal("executeJavascript"),
        result: z.object({
          return: z.string(),
        }),
      }),
      z.object({
        idx: z.number(),
        type: z.literal("pdf"),
        result: z.object({
          link: z.string(),
        }),
      }),
    ])
    .array()
    .optional(),

  // chrome-cdp only -- file download handler
  file: z
    .object({
      name: z.string(),
      content: z.string(),
    })
    .optional()
    .or(z.null()),

  docUrl: z.string().optional(),

  usedMobileProxy: z.boolean().optional(),
});

// 返回类型定义
const playwrightResponseSchema = z.object({
  content: z.string(),
  pageStatusCode: z.number(),
  pageError: z.string().optional(),
  contentType: z.string().optional(),
  url: z.string().optional(),
  screenshot: z.string().optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  usedMobileProxy: z.boolean().optional(),
  // chrome-cdp only -- file download handler
  file: z
    .object({
      name: z.string(),
      content: z.string(),
    })
    .optional()
    .or(z.null()),
});

export type PlaywrightScrapeResponse = z.infer<typeof playwrightResponseSchema>;

// 封装请求函数
async function performPlaywrightScrape(
  meta: Meta,
  logger: Logger,
  request: PlaywrightScrapeRequestCommon,
  mock: MockState | null,
  abort?: AbortSignal,
): Promise<PlaywrightScrapeResponse> {
  const response = await robustFetch({
    url: process.env.PLAYWRIGHT_MICROSERVICE_URL!,
    headers: {
      "Content-Type": "application/json",
    },
    body: request,
    method: "POST",
    logger: meta.logger.child("performPlaywrightScrape/robustFetch"),
    schema: playwrightResponseSchema,
    mock: mock,
    abort: abort,
  });

  if (response.contentType?.includes("application/json")) {
    response.content = await getInnerJson(response.content);
  }

  // 处理特殊情况的爬取结果
  if (response.responseHeaders) {
    await specialtyScrapeCheck(
      logger.child({
        method: "performPlaywrightScrape/specialtyScrapeCheck",
      }),
      response.responseHeaders,
      response,
    );
  }

  return response;
}

export async function scrapeURLWithPlaywright(
  meta: Meta,
): Promise<EngineScrapeResult> {
  // 构建请求对象
  const request: PlaywrightScrapeRequestCommon = {
    url: meta.rewrittenUrl ?? meta.url,
    wait_after_load: meta.options.waitFor,
    timeout: meta.abort.scrapeTimeout(),
    headers: meta.options.headers,
    skip_tls_verification: meta.options.skipTlsVerification,
    geolocation: meta.options.location,
    blockAds: meta.options.blockAds,
    screenshot: meta.options.formats?.some(f => f.type === "screenshot"),
    fullPageScreenshot: meta.options.formats?.find(f => f.type === "screenshot")
      ?.fullPage,
    mobileProxy: meta.featureFlags.has("stealthProxy"),
    saveScrapeResultToGCS:
      !meta.internalOptions.zeroDataRetention &&
      meta.internalOptions.saveScrapeResultToGCS,
    zeroDataRetention: meta.internalOptions.zeroDataRetention,
    priority: meta.internalOptions.priority,
  };

  // 调用封装的请求函数
  const response = await performPlaywrightScrape(
    meta,
    meta.logger.child({
      method: "scrapeURLWithPlaywright/performPlaywrightScrape",
      request,
    }),
    request,
    meta.mock,
    meta.abort.asSignal(),
  );

  if (!response.url) {
    meta.logger.warn("Playwright service did not return the response's URL", {
      response,
      sourceURL: meta.url,
    });
  }

  // 返回标准化的结果
  return {
    url: response.url ?? meta.rewrittenUrl ?? meta.url,
    html: response.content,
    statusCode: response.pageStatusCode,
    error: response.pageError,
    contentType: response.contentType,

    proxyUsed: "basic",
  };
}

export function playwrightMaxReasonableTime(meta: Meta): number {
  return (meta.options.waitFor ?? 0) + 30000;
}
