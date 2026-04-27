import path from 'node:path';
import { fileURLToPath } from 'node:url';

function isCliEntrypoint(modulePath, argvPath) {
  if (!argvPath) {
    return false;
  }

  return path.resolve(modulePath) === path.resolve(argvPath);
}

export async function runAllabolagEnrichmentCli(
  args = process.argv.slice(2),
  {
    write = (message) => process.stdout.write(message),
  } = {},
) {
  if (args.includes('--help') || args.includes('-h')) {
    write('Allabolag-berikning är avstängd. Kör npm run process för SCB -> Supabase/export-flödet.\n');
    return 0;
  }

  write('Allabolag-berikning är avstängd. Inga externa uppslagningar kördes.\n');
  write('Kör npm run process för att hämta SCB-data, publicera snapshot och skapa exportfiler.\n');
  return 0;
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await runAllabolagEnrichmentCli();
  process.exitCode = exitCode;
}
