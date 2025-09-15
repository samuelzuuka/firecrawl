import { Page } from 'playwright';
import logger from '../../helpers/logger';
import { ScrapeResult, UrlModel } from '../types';
import { ContextManager } from './ContextManager';
import { UrlValidator } from '../utils/UrlValidator';
import { getError } from '../../helpers/get_error';

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
    checkSelector?: string
  ): Promise<ScrapeResult> {
    logger.info(`Navigating to ${url} with waitUntil: ${waitUntil} and timeout: ${timeout}ms`);
    const response = await page.goto(url, { waitUntil, timeout });

    if (waitAfterLoad > 0) {
      await page.waitForTimeout(waitAfterLoad);
    }

    if (checkSelector) {
      try {
        await page.waitForSelector(checkSelector, { timeout });
      } catch (error) {
        logger.error('Required selector not found', { selector: checkSelector, url });
        throw new Error('Required selector not found');
      }
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

  public async scrape(params: UrlModel): Promise<{
    content: string;
    pageStatusCode: number | null;
    contentType?: string;
    pageError?: string;
  }> {
    const { url, wait_after_load = 0, timeout = 15000, headers, check_selector, skip_tls_verification = false } = params;

    logger.info(`================= Scrape Request =================`);
    logger.info(`URL: ${url}`);
    logger.info(`Wait After Load: ${wait_after_load}`);
    logger.info(`Timeout: ${timeout}`);
    logger.info(`Headers: ${headers ? JSON.stringify(headers) : 'None'}`);
    logger.info(`Check Selector: ${check_selector ? check_selector : 'None'}`);
    logger.info(`Skip TLS Verification: ${skip_tls_verification}`);
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
      result = await this.scrapePage(page, url, 'load', wait_after_load, timeout, check_selector);
    } catch (error) {
      logger.info('Strategy 1 failed, attempting strategy 2: Wait until networkidle');
      try {
        // Strategy 2: Wait until networkidle
        result = await this.scrapePage(page, url, 'networkidle', wait_after_load, timeout, check_selector);
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