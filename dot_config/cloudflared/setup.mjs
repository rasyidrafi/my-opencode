import { manage } from './service.mjs';

try { manage('setup'); } catch (error) { console.error(error.message); process.exitCode = 1; }
