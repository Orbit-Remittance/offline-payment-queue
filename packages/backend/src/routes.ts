import { Router, Request, Response } from 'express';
import { SubmitRequest, ReconcileRequest } from '@stellar-queue/shared';
import { submitTransaction, processTransaction, reconcileTransactions, getPendingTransactions } from './reconciliation';

const router = Router();

router.post('/transactions', async (req: Request, res: Response) => {
  const body = req.body as SubmitRequest;
  if (!body.id || !body.xdr || !body.hash || !body.sourceAccount || !body.sequence || !body.maxLedger) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const queued = await submitTransaction(body);
  if (queued.status === 'pending') {
    const result = await processTransaction(body.id);
    return res.json(result);
  }
  return res.json(queued);
});

router.post('/transactions/reconcile', async (req: Request, res: Response) => {
  const body = req.body as ReconcileRequest;
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (body.ids.length > 100) {
    return res.status(400).json({ error: 'Max 100 ids per request' });
  }
  return res.json(await reconcileTransactions(body.ids));
});

router.get('/transactions/:id', async (req: Request, res: Response) => {
  const result = await reconcileTransactions([req.params.id]);
  const tx = result.results[0];
  if (tx.error === 'Not found') return res.status(404).json(tx);
  return res.json(tx);
});

router.get('/transactions', async (_req: Request, res: Response) => {
  return res.json(await getPendingTransactions());
});

export default router;
