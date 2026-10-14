// -----------------------------------------------------------------------------
// SDK wiring: every handler is registered here, before connect().
//
// Kept out of index.js so the tests can run the whole integration against the
// SDK's fake Gladys (`createFakeGladys`) — index.js only builds the real
// client and connects it.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ACTIONS } from './actions.js';
import { SCENE_ACTIONS } from './capabilities/scenes.js';
import { WIDGETS } from './capabilities/widget.js';
import { fetchWidgetImage } from './capabilities/images.js';
import { PsnService } from './service.js';
import { createJsonStore } from './store.js';

const logger = createLogger({ name: 'app' });

/**
 * Register the handlers of the integration on a Gladys client.
 *
 * @param {object} gladys a GladysIntegration (or the SDK's fake one)
 * @param {object} [deps] overrides for the tests (fetch, stores, probe, scan, clock)
 * @returns {{ service: PsnService }}
 */
export function createIntegration(gladys, deps = {}) {
  const service = new PsnService({
    gladys,
    tokenStore: deps.tokenStore ?? createJsonStore('tokens.json'),
    stateStore: deps.stateStore ?? createJsonStore('state.json'),
    ...deps,
  });
  const fetchImage = deps.fetch ?? globalThis.fetch;

  // Widgets follow what the loops learn, without waiting for their TTL.
  service.onChange(() => refreshWidgets(gladys));

  // --- Discovery -----------------------------------------------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> looking for the account, the friends and the consoles');
    await service.discover({ scan: true });
  });

  // --- Commands: nothing here can be controlled ----------------------------
  gladys.onSetValue(async (device, feature) => {
    throw new Error(`${feature.external_id} is read-only`);
  });

  // --- A device was just created: give it its states now ---------------------
  gladys.onDeviceCreated(async () => {
    await service.refresh();
    await service.refreshConsoles();
  });

  // --- Configuration screen buttons ------------------------------------------
  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(key, (fields) => handler(service, fields));
  }

  // --- Scene actions -----------------------------------------------------------
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(service, fields ?? {}));
  }

  // --- Dashboard widget --------------------------------------------------------
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(service, request ?? {}));
    gladys.onWidgetAction(key, (actionKey, params, extra) =>
      widget.action(service, { actionKey, params, ...extra }),
    );
  }
  gladys.onWidgetGetImage(async (imageKey) => {
    const url = service.images.get(imageKey);
    if (!url) {
      throw new Error(`Unknown image ${imageKey}`);
    }
    return fetchWidgetImage(fetchImage, url);
  });

  // --- Configuration updated by the user ---------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    await service.applyConfig(newConfig);
    service.start();
    await service.refresh();
    await service.refreshConsoles();
    await service.publishDiscoveredDevices();
    refreshWidgets(gladys);
  });

  // --- Connection lifecycle ------------------------------------------------------
  gladys.on('connected', async () => {
    try {
      await service.applyConfig(await gladys.getConfig());
      await service.refresh();
      await service.refreshConsoles();
      await service.publishDiscoveredDevices();
      service.start();
      refreshWidgets(gladys);
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
          de: 'Initialisierung fehlgeschlagen, prüfe die Logs der Integration.',
          es: 'La inicialización falló, revise los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  gladys.on('disconnected', () => {
    service.stop();
  });

  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    service.stop();
    await service.persist();
  });

  return { service };
}

/** Ask the core to re-pull every widget now (rate-limited core-side). */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
