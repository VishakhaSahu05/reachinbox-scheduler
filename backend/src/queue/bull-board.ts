import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getEmailQueue } from './email-queue.js';

export function createBullBoardRouter(basePath: string) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(basePath);

  createBullBoard({
    queues: [new BullMQAdapter(getEmailQueue())],
    serverAdapter,
    options: { uiConfig: { boardTitle: 'ReachInbox Queues' } },
  });

  return serverAdapter.getRouter();
}
