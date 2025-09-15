import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import logger from './helpers/logger';
import { BrowserManager } from './services/BrowserManager';
import { ScrapeService } from './services/ScrapeService';
import { ScrapeRequetParam } from './types';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const scrapeService = new ScrapeService();
const browserManager = BrowserManager.getInstance();

app.use(bodyParser.json());

app.get('/health', async (req: Request, res: Response) => {
  try {
    await browserManager.initialize();
    const isHealthy = await scrapeService.healthCheck();
    
    if (isHealthy) {
      logger.info('Health check successful');
      res.status(200).json({ status: 'healthy' });
    } else {
      res.status(503).json({ status: 'unhealthy' });
    }
  } catch (error) {
    logger.error('Health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

app.post('/scrape', async (req: Request, res: Response) => {
  try {
    const params: ScrapeRequetParam = req.body;
    await browserManager.initialize();
    const result = await scrapeService.scrape(params);
    res.json(result);
  } catch (error) {
    logger.error('Scrape error', { error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(400).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
});

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
  browserManager.initialize().then(() => {
    logger.info(`Browser initialized`);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received. Closing browser...');
  browserManager.shutdown().then(() => {
    process.exit(0);
  });
});