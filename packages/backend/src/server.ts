import express from 'express';
import cors from 'cors';
import routes from './routes';

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
  app.use(express.json());
  app.use('/api', routes);
  app.get('/health', (_req, res) => res.json({ ok: true }));
  return app;
}

if (require.main === module) {
  const app = createApp();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
}
