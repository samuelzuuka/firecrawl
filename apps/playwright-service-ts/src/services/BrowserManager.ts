import { Browser, chromium } from 'playwright';
import logger from './../helpers/logger';
import { BROWSER_LAUNCH_OPTIONS } from '../config/constants';

export class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;

  private constructor() {}

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  public async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      await this.initialize();
    }
    return this.browser!;
  }

  public async initialize(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch(BROWSER_LAUNCH_OPTIONS);
      logger.info('Browser initialized');
    }
  }

  public async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Browser closed');
    }
  }
}