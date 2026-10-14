// -----------------------------------------------------------------------------
// Entry point of the PlayStation Network integration for Gladys Assistant.
//
// Builds the SDK client and connects it; every handler lives in src/app.js.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createIntegration } from './src/app.js';

const gladys = new GladysIntegration();
createIntegration(gladys);

logger.info('Starting the PlayStation Network integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
