import { Page } from 'playwright';
import logger from './../helpers/logger';
import { ScrapeResult, ScrapeRequetParam,Action } from '../types';
import { ContextManager } from './ContextManager';
import { UrlValidator } from '../utils/UrlValidator';
import { getError } from './../helpers/get_error';

export class ScrapeService {
  private readonly contextManager: ContextManager;

  constructor() {
    this.contextManager = new ContextManager();
  }

  private async scrapePage(
    page: Page, 
    url: string, 
    waitUntil: 'load' | 'networkidle', 
    waitAfterLoad: number, 
    timeout: number, 
    actions?: Action[]
  ): Promise<ScrapeResult> {
    logger.info(`Navigating to ${url} with waitUntil: ${waitUntil} and timeout: ${timeout}ms`);
    const response = await page.goto(url, { waitUntil, timeout });

    if (waitAfterLoad > 0) {
      await page.waitForTimeout(waitAfterLoad);
    }

    // if (checkSelector) {
    //   try {
    //     await page.waitForSelector(checkSelector, { timeout });
    //   } catch (error) {
    //     logger.error('Required selector not found', { selector: checkSelector, url });
    //     throw new Error('Required selector not found');
    //   }
    // }
    
    if (actions) {
      await this.executeActions(page, actions);
    }


    let headers = null, content = await page.content();
    let ct: string | undefined = undefined;
    if (response) {
      headers = await response.allHeaders();
      ct = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
      if (ct && (ct.toLowerCase().includes("application/json") || ct.toLowerCase().includes("text/plain"))) {
        content = (await response.body()).toString("utf8"); // TODO: determine real encoding
      }
    }

    return {
      content,
      status: response ? response.status() : null,
      headers,
      contentType: ct,
    };
  }

  /**
   * 执行一系列动作
   * @param page Playwright Page 对象
   * @param actions 要执行的动作数组
   */
  private async executeActions(page: Page, actions: Action[]): Promise<void> {
    for (const action of actions) {
      logger.info(`Executing action: ${action.type}`, { action });
      
      try {
        switch (action.type) {
          case "wait":
            if (action.selector) {
              await page.waitForSelector(action.selector, { timeout: 30000 });
              logger.info(`Action[${action}]->Waited for selector: ${action.selector}`);
            } else {
              await page.waitForTimeout(action.milliseconds || 1000);
              logger.info(`Action[${action}]->Waited for ${action.milliseconds || 1000}ms`);
            }
            continue;
            
          case "click":
            if (action.all) {
              // 点击所有匹配的元素
              const elements = await page.$$(action.selector);
              logger.info(`Action[${action}]->Clicking ${elements.length} elements matching selector: ${action.selector}`);
              for (const element of elements) {
                await element.click();
              }
            } else {
              await page.click(action.selector);
              logger.info(`Action[${action}]->Clicked element: ${action.selector}`);
            }
            continue;
            
          case "screenshot":
            const screenshotPath = `screenshot_${Date.now()}.png`;
            await page.screenshot({ 
              path: screenshotPath,
              fullPage: action.fullPage || false,
              quality: action.quality
            });
            logger.info(`Action[${action}]->Screenshot saved to: ${screenshotPath}`);
            continue;
            
          // case "write":
          //   if (!action.selector) {
          //     logger.warn(`Action[${action}]->Missing selector for write action`);
          //     continue;
          //   }
          //   await page.fill(action.selector, action.text);
          //   logger.info(`Action[${action}]->Wrote text to element: ${action.selector}`);
          //   continue;
            
          // case "press":
          //   if (!action.selector) {
          //     logger.warn(`Action[${action}]->Missing selector for press action`);
          //     break;
          //   }
          //   await page.press(action.selector, action.key);
          //   logger.info(`Action[${action}]->Pressed key ${action.key} on element: ${action.selector}`);
          //   break;
            
          // case "scroll":
          //   if (action.selector) {
          //     // 滚动特定元素
          //     await page.evaluate((selector, direction) => {
          //       const element = document.querySelector(selector);
          //       if (element) {
          //         element.scrollBy(0, direction === "up" ? -300 : 300);
          //       }
          //     }, action.selector, action.direction || "down");
          //     logger.info(`Action[${action}]->Scrolled element ${action.selector} ${action.direction || "down"}`);
          //   } else {
          //     // 滚动整个页面
          //     await page.evaluate((direction) => {
          //       window.scrollBy(0, direction === "up" ? -300 : 300);
          //     }, action.direction || "down");
          //     logger.info(`Scrolled page ${action.direction || "down"}`);
          //   }
          //   break;
            
          // case "scrape":
          //   // 这里不需要做任何事情，因为我们已经在方法结束时获取页面内容
          //   logger.info(`Action[${action}]->Scrape action - content will be captured at the end`);
          //   break;
            
          case "executeJavascript":
            await page.evaluate(action.script);
            logger.info(`Action[${action}]->Executed custom JavaScript`);
            continue;
            
          case "pdf":
            const pdfPath = `output_${Date.now()}.pdf`;
            await page.pdf({ 
              path: pdfPath,
              landscape: action.landscape || false,
              scale: action.scale || 1,
              format: action.format as any || "A4"
            });
            logger.info(`Action[${action}]->PDF saved to: ${pdfPath}`);
            continue;
            
          default:
            logger.warn(`Action[${action}]->Unknown action type: ${(action as any).type}`);
        }
      } catch (error) {
        logger.error(`Action[${action}]->Error executing action ${action.type}:`, { 
          error: error instanceof Error ? error.message : 'Unknown error',
          action 
        });
        throw new Error(`Action[${action}]->Failed to execute action ${action.type}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  public async scrape(params: ScrapeRequetParam): Promise<{
    content: string;
    pageStatusCode: number | null;
    contentType?: string;
    pageError?: string;
  }> {
    const { url, wait_after_load = 0, timeout = 15000, headers, skip_tls_verification = false,actions } = params;

    logger.info(`================= Scrape Request =================`);
    logger.info(`URL: ${url}`);
    logger.info(`Wait After Load: ${wait_after_load}`);
    logger.info(`Timeout: ${timeout}`);
    logger.info(`Headers: ${headers ? JSON.stringify(headers) : 'None'}`);
    logger.info(`Skip TLS Verification: ${skip_tls_verification}`);
    logger.info(`Geolocation: ${params.geolocation ? JSON.stringify(params.geolocation) : 'None'}`);
    logger.info(`Priority: ${params.priority}`);
    logger.info(`Block Ads: ${params.blockAds}`);
    logger.info(`Screenshot: ${params.screenshot}`);
    logger.info(`Full Page Screenshot: ${params.fullPageScreenshot}`);
    logger.info(`Mobile Proxy: ${params.mobileProxy}`);
    logger.info(`Save Scrape Result to GCS: ${params.saveScrapeResultToGCS}`);
    logger.info(`Zero Data Retention: ${params.zeroDataRetention}`);
    logger.info(`Actions: ${params.actions ? JSON.stringify(params.actions) : 'None'}`);
    logger.info(`==================================================`);

    if (!url) {
      throw new Error('URL is required');
    }

    if (!UrlValidator.isValid(url)) {
      throw new Error('Invalid URL');
    }

    if (!process.env.PROXY_SERVER) {
      logger.warn('No proxy server provided. IP address may be blocked.');
    }

    const requestContext = await this.contextManager.createContext(skip_tls_verification);
    const page = await requestContext.newPage();

    // Set headers if provided
    if (headers) {
      await page.setExtraHTTPHeaders(headers);
    }

    let result: ScrapeResult;
    try {
      // Strategy 1: Normal
      logger.info('Attempting strategy 1: Normal load');
      result = await this.scrapePage(page, url, 'load', wait_after_load, timeout, actions);
    } catch (error) {
      logger.info('Strategy 1 failed, attempting strategy 2: Wait until networkidle');
      try {
        // Strategy 2: Wait until networkidle
        result = await this.scrapePage(page, url, 'networkidle', wait_after_load, timeout, actions);
      } catch (finalError) {
        await page.close();
        await requestContext.close();
        throw new Error('An error occurred while fetching the page.');
      }
    }

    const pageError = result.status !== 200 ? getError(result.status) : undefined;

    if (!pageError) {
      logger.info(`✅ Scrape successful!`);
    } else {
      logger.info(`🚨 Scrape failed with status code: ${result.status} ${pageError}`);
    }

    await page.close();
    await requestContext.close();

    return {
      content: result.content,
      pageStatusCode: result.status,
      contentType: result.contentType,
      ...(pageError && { pageError })
    };
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const contextManager = new ContextManager();
      const testContext = await contextManager.createContext();
      const testPage = await testContext.newPage();
      await testPage.close();
      await testContext.close();
      return true;
    } catch (error) {
      logger.error('Health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  }
}