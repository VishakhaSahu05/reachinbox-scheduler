import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env.js';

export const elastic = new Client({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 5_000,
  maxRetries: 1,
});
