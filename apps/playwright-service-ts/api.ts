import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { chromium, Browser, BrowserContext, Route, Request as PlaywrightRequest, Page } from 'playwright';
import dotenv from 'dotenv';
import UserAgent from 'user-agents';
import { getError } from './helpers/get_error';
import logger from './helpers/logger';

dotenv.config();

const app = express();
const port = process.env.PORT || 3003;

app.use(bodyParser.json());

const BLOCK_MEDIA = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';

const PROXY_SERVER = process.env.PROXY_SERVER || null;
const PROXY_USERNAME = process.env.PROXY_USERNAME || null;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || null;

const AD_SERVING_DOMAINS = [
  'doubleclick.net',
  'adservice.google.com',
  'googlesyndication.com',
  'googletagservices.com',
  'googletagmanager.com',
  'google-analytics.com',
  'adsystem.com',
  'adservice.com',
  'adnxs.com',
  'ads-twitter.com',
  'facebook.net',
  'fbcdn.net',
  'amazon-adsystem.com'
];

interface UrlModel {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  check_selector?: string;
  skip_tls_verification?: boolean;
}

let browser: Browser;

const initializeBrowser = async () => {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });
  logger.info('Browser initialized');
};

const createContext = async (skipTlsVerification: boolean = false) => {
  const userAgent = new UserAgent().toString();
  const viewport = { width: 1280, height: 800 };

  const contextOptions: any = {
    userAgent,
    viewport,
    ignoreHTTPSErrors: skipTlsVerification,
  };

  if (PROXY_SERVER && PROXY_USERNAME && PROXY_PASSWORD) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
      username: PROXY_USERNAME,
      password: PROXY_PASSWORD,
    };
  } else if (PROXY_SERVER) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
    };
  }

  const newContext = await browser.newContext(contextOptions);

  if (BLOCK_MEDIA) {
    await newContext.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}', async (route: Route, request: PlaywrightRequest) => {
      await route.abort();
    });
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
};

const shutdownBrowser = async () => {
  if (browser) {
    await browser.close();
  }
};

const isValidUrl = (urlString: string): boolean => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

const scrapePage = async (page: Page, url: string, waitUntil: 'load' | 'networkidle', waitAfterLoad: number, timeout: number, checkSelector: string | undefined) => {
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
};

app.get('/health', async (req: Request, res: Response) => {
  try {
    if (!browser) {
      await initializeBrowser();
    }
    
    const testContext = await createContext();
    const testPage = await testContext.newPage();
    await testPage.close();
    await testContext.close();
    
    logger.info('Health check successful');
    res.status(200).json({ status: 'healthy' });
  } catch (error) {
    logger.error('Health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

app.post('/scrape', async (req: Request, res: Response) => {
  const { url, wait_after_load = 0, timeout = 15000, headers, check_selector, skip_tls_verification = false }: UrlModel = req.body;

  logger.info(`================= Scrape Request =================`);
  logger.info(`URL: ${url}`);
  logger.info(`Wait After Load: ${wait_after_load}`);
  logger.info(`Timeout: ${timeout}`);
  logger.info(`Headers: ${headers ? JSON.stringify(headers) : 'None'}`);
  logger.info(`Check Selector: ${check_selector ? check_selector : 'None'}`);
  logger.info(`Skip TLS Verification: ${skip_tls_verification}`);
  logger.info(`==================================================`);

  if (!url) {
    logger.warn('Scrape request missing URL');
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!isValidUrl(url)) {
    logger.warn('Invalid URL provided', { url });
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!PROXY_SERVER) {
    logger.warn('No proxy server provided. IP address may be blocked.');
  }

  if (!browser) {
    await initializeBrowser();
  }

  const requestContext = await createContext(skip_tls_verification);
  const page = await requestContext.newPage();

  // Set headers if provided
  if (headers) {
    await page.setExtraHTTPHeaders(headers);
  }

  let result: Awaited<ReturnType<typeof scrapePage>>;
  try {
    // Strategy 1: Normal
    logger.info('Attempting strategy 1: Normal load');
    result = await scrapePage(page, url, 'load', wait_after_load, timeout, check_selector);
  } catch (error) {
    logger.info('Strategy 1 failed, attempting strategy 2: Wait until networkidle');
    try {
      // Strategy 2: Wait until networkidle
      result = await scrapePage(page, url, 'networkidle', wait_after_load, timeout, check_selector);
    } catch (finalError) {
      await page.close();
      await requestContext.close();
      return res.status(500).json({ error: 'An error occurred while fetching the page.' });
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

  res.json({
    content: result.content,
    pageStatusCode: result.status,
    contentType: result.contentType,
    ...(pageError && { pageError })
  });
});

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
  initializeBrowser().then(() => {
    logger.info(`Browser initialized`);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received. Closing browser...');
  shutdownBrowser().then(() => {
    logger.info('Browser closed');
    process.exit(0);
  });
});
