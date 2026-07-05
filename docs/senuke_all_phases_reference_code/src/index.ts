import express from 'express';
import cors from 'cors';
import { env } from './modules/core/env.js';
import { projectsRouter } from './routes/projects.js';
import { modulesRouter } from './routes/modules.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, app: 'SEnuke AI Reference API' }));
app.use('/api/projects', projectsRouter);
app.use('/api/modules', modulesRouter);

// Central error handler. Production should log to the admin/error monitoring system.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err.message ?? 'Unknown error' });
});

app.listen(env.PORT, () => {
  console.log(`SEnuke AI reference API running on port ${env.PORT}`);
});
