import { BrowserContext, Route, Request as PlaywrightRequest } from 'playwright';
import UserAgent from 'user-agents';
import logger from './../helpers/logger';
import { BrowserManager } from './BrowserManager';
import { AD_SERVING_DOMAINS, DEFAULT_VIEWPORT } from '../config/constants';
import { ProxyConfig } from '../types';

export class ContextManager {
  private readonly blockMedia: boolean;
  private readonly proxyConfig: ProxyConfig | null;

  constructor() {
    this.blockMedia = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';
    
    const proxyServer = process.env.PROXY_SERVER || null;
    const proxyUsername = process.env.PROXY_USERNAME || null;
    const proxyPassword = process.env.PROXY_PASSWORD || null;
    
    if (proxyServer) {
      this.proxyConfig = {
        server: proxyServer,
        ...(proxyUsername && proxyPassword ? { username: proxyUsername, password: proxyPassword } : {})
      };
    } else {
      this.proxyConfig = null;
    }
  }

  public async createContext(skipTlsVerification: boolean = false): Promise<BrowserContext> {
    const browserManager = BrowserManager.getInstance();
    const browser = await browserManager.getBrowser();
    
    const userAgent = new UserAgent().toString();
    
    const contextOptions: any = {
      userAgent,
      viewport: DEFAULT_VIEWPORT,
      ignoreHTTPSErrors: skipTlsVerification,
    };

    if (this.proxyConfig) {
      contextOptions.proxy = this.proxyConfig;
    }

    const newContext = await browser.newContext(contextOptions);

    if (this.blockMedia) {
      await newContext.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}', 
        async (route: Route, request: PlaywrightRequest) => {
          await route.abort();
        }
      );
    }

    // Intercept all requests to avoid loading ads
    await newContext.route('**/*', (route: Route, request: PlaywrightRequest) => {
      const requestUrl = new URL(request.url());
      const hostname = requestUrl.hostname;

      if (AD_SERVING_DOMAINS.some(domain => hostname.includes(domain))) {
        logger.info(`Blocked ad domain: ${hostname}`);
        return route.abort();
      }
      return route.continue();
    });
    
    return newContext;
  }
}