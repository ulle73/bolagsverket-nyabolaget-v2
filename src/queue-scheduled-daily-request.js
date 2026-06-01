import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { queueScheduledDailyImportRequest } from './admin-import-requests.js';

function isCliEntrypoint(modulePath, argvPath) {
  if (!argvPath) {
    return false;
  }

  return path.resolve(modulePath) === path.resolve(argvPath);
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await queueScheduledDailyImportRequest();
  process.exitCode = exitCode;
}
