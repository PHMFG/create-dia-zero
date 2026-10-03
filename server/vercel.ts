import { handle } from 'hono/vercel';
import { app } from './app';
export const handler=handle(app);
