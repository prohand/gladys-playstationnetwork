// -----------------------------------------------------------------------------
// The integration's state and its two refresh loops.
//
//   - the PSN loop (every `poll_frequency` seconds): one presence request for
//     the account, one for all the followed friends, the trophy summary every
//     quarter of an hour. It publishes the states, measures the play time and
//     fires the scene triggers (game started / stopped, trophy earned);
//   - the console loop (every 30 seconds): a DDP request to each known console
//     on the LAN, the PSN presence as the fallback (or the other way round when
//     the user turned "Prefer the local connection" off).
//
// Both loops run on the integration's own timers instead of Gladys polling the
// devices: one PSN request serves every player, and Gladys would call `onPoll`
// once per device.
//
// Only the devices the user created receive states and transport badges:
// Gladys drops the others anyway, and they would eat into the 300 states a
// minute it accepts.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { createAuth, PsnAuthError } from './psn/auth.js';
import { createPsnApi } from './psn/api.js';
import { createPlayTracker } from './psn/playtime.js';
import { probeConsole, scanConsoles } from './console/ddp.js';
import {
  DEVICE_TYPES,
  FEATURES,
  accountIds,
  buildAccountDevice,
  buildConsoleDevice,
  buildFriendDevice,
  consoleIds,
  consoleKey,
  deviceParam,
  friendIds,
  parseDeviceExternalId,
} from './devices/index.js';

const logger = createLogger({ name: 'psn' });

/** Scene trigger keys, as declared in the manifest. Never renamed. */
export const TRIGGERS = Object.freeze({
  GAME_STARTED: 'game_started',
  GAME_STOPPED: 'game_stopped',
  TROPHY_EARNED: 'trophy_earned',
});

export const CONSOLE_INTERVAL_MS = 30_000;
export const TROPHY_INTERVAL_MS = 15 * 60_000;
/** A friend nobody has as online ID is looked up again after this delay. */
const MISSING_FRIEND_RETRY_MS = 60 * 60_000;
/** Game icons remembered for onWidgetGetImage. */
const MAX_IMAGES = 100;
/** The text published when there is nothing to say (Gladys refuses an empty text). */
export const NO_TEXT = '-';

const TROPHY_GRADES = ['platinum', 'gold', 'silver', 'bronze'];

const hashOf = (value) => createHash('sha256').update(value).digest('hex');

export class PsnService {
  /**
   * @param {object} deps
   * @param {object} deps.gladys the SDK instance
   * @param {{ load(): Promise<object>, save(v: object): Promise<void> }} deps.tokenStore
   * @param {{ load(): Promise<object>, save(v: object): Promise<void> }} deps.stateStore
   * @param {typeof fetch} [deps.fetch]
   * @param {() => number} [deps.clock]
   * @param {typeof probeConsole} [deps.probe]
   * @param {typeof scanConsoles} [deps.scan]
   */
  constructor({
    gladys,
    tokenStore,
    stateStore,
    fetch = globalThis.fetch,
    clock = Date.now,
    probe = probeConsole,
    scan = scanConsoles,
  }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.clock = clock;
    this.probe = probe;
    this.scan = scan;
    this.stateStore = stateStore;
    this.auth = createAuth({ fetch, store: tokenStore, clock });
    this.api = createPsnApi({ fetch, auth: this.auth });

    this.config = normalizeConfig();
    this.npssoHash = null;
    this.account = null;
    this.friends = new Map();
    this.presences = new Map();
    this.trophies = null;
    this.trophiesAt = 0;
    this.consoles = new Map();
    this.tracker = createPlayTracker();
    this.link = { ok: false, error: null, checkedAt: 0 };
    this.consolesCheckedAt = 0;
    this.images = new Map();

    this.loaded = false;
    this.timers = [];
    this.inFlight = { psn: null, consoles: null };
    this.lastStatusKey = null;
    this.lastSignature = null;
    this.listeners = new Set();
  }

  // --- persistence -----------------------------------------------------------

  async init() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const saved = await this.stateStore.load();
    this.npssoHash = saved.npssoHash ?? null;
    this.account = saved.account?.accountId ? saved.account : null;
    for (const friend of Object.values(saved.friends ?? {})) {
      this.friends.set(friend.onlineId.toLowerCase(), friend);
    }
    for (const console of Object.values(saved.consoles ?? {})) {
      this.consoles.set(consoleKey(console.hostId), { ...console, power: null, status: 'unknown' });
    }
    this.trophies = saved.trophies ?? null;
    this.tracker = createPlayTracker({ state: saved.playtime ?? {} });
  }

  async persist() {
    await this.stateStore.save({
      npssoHash: this.npssoHash,
      account: this.account,
      friends: Object.fromEntries(this.friends),
      consoles: Object.fromEntries(
        [...this.consoles].map(([key, c]) => [
          key,
          { hostId: c.hostId, hostName: c.hostName, hostType: c.hostType, ip: c.ip },
        ]),
      ),
      trophies: this.trophies,
      playtime: this.tracker.toJSON(),
    });
  }

  // --- configuration ---------------------------------------------------------

  /** Take a (new) configuration into account. */
  async applyConfig(raw) {
    await this.init();
    const config = normalizeConfig(raw);
    const hash = config.npsso ? hashOf(config.npsso) : null;
    if (hash !== this.npssoHash) {
      // Another NPSSO may be another account: forget everything learned.
      if (this.npssoHash !== null) {
        logger.info('The NPSSO changed: the account will be read again');
      }
      this.account = null;
      this.presences.clear();
      this.trophies = null;
      this.trophiesAt = 0;
      this.npssoHash = hash;
    }
    this.auth.setNpsso(config.npsso);
    this.tracker.setTimeZone(config.timezone);
    const followed = new Set(config.friendIds.map((id) => id.toLowerCase()));
    for (const key of this.friends.keys()) {
      if (!followed.has(key)) {
        this.friends.delete(key);
      }
    }
    this.tracker.retain(this.playerAccountIds());
    if (config.invalidFriends.length > 0) {
      logger.warn(`Not valid online IDs, ignored: ${config.invalidFriends.join(', ')}`);
    }
    this.config = config;
    await this.persist();
  }

  // --- timers ----------------------------------------------------------------

  start() {
    this.stop();
    const psn = setInterval(
      () => this.refresh().catch(() => {}),
      this.config.poll_frequency * 1000,
    );
    const consoles = setInterval(() => this.refreshConsoles().catch(() => {}), CONSOLE_INTERVAL_MS);
    psn.unref?.();
    consoles.unref?.();
    this.timers = [psn, consoles];
  }

  stop() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
  }

  /** Called with no argument after every refresh that changed what a widget shows. */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- what Gladys knows -----------------------------------------------------

  createdExternalIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  isCreated(externalId) {
    return this.createdExternalIds().has(externalId);
  }

  /** The followed friends whose account id is known. */
  resolvedFriends() {
    return (
      this.config.friendIds
        .map((id) => this.friends.get(id.toLowerCase()))
        // Following oneself would count the same play time twice.
        .filter((friend) => friend?.accountId && friend.accountId !== this.account?.accountId)
    );
  }

  playerAccountIds() {
    return [
      ...(this.account ? [this.account.accountId] : []),
      ...this.resolvedFriends().map((friend) => friend.accountId),
    ];
  }

  buildDiscoveredDevices() {
    return [
      ...(this.account ? [buildAccountDevice(this.gladys, this.account)] : []),
      ...this.resolvedFriends().map((friend) => buildFriendDevice(this.gladys, friend)),
      ...[...this.consoles.values()].map((console) => buildConsoleDevice(this.gladys, console)),
    ];
  }

  async publishDiscoveredDevices() {
    await this.gladys.publishDiscoveredDevices(this.buildDiscoveredDevices());
  }

  // --- the PSN loop ----------------------------------------------------------

  /** Read the PlayStation Network once (concurrent callers share the read). */
  refresh() {
    if (!this.inFlight.psn) {
      this.inFlight.psn = this.doRefresh().finally(() => {
        this.inFlight.psn = null;
      });
    }
    return this.inFlight.psn;
  }

  async doRefresh() {
    await this.init();
    const now = this.clock();
    const events = [];
    try {
      if (!this.config.npsso) {
        throw new PsnAuthError('NPSSO_MISSING', 'No NPSSO token in the configuration');
      }
      const newAccount = await this.ensureAccount();
      await this.resolveFriends(now);

      const own = await this.api.getPresence(this.account.accountId);
      const friends = await this.api.getPresences(
        this.resolvedFriends().map((friend) => friend.accountId),
      );

      const maxGapMs = 2 * this.config.poll_frequency * 1000;
      let stopped = false;
      const players = [
        { kind: DEVICE_TYPES.ACCOUNT, ...this.account, presence: own },
        ...this.resolvedFriends().map((friend) => ({
          kind: DEVICE_TYPES.FRIEND,
          ...friend,
          presence: friends.get(friend.accountId) ?? null,
        })),
      ];
      const states = [];
      for (const player of players) {
        if (!player.presence) {
          // Hidden (privacy, no longer a friend): keep the last known values.
          continue;
        }
        this.presences.set(player.accountId, player.presence);
        const result = this.tracker.observe(player.accountId, player.presence, now, maxGapMs);
        const ids = this.idsOf(player);
        for (const transition of result.transitions) {
          events.push(this.gameEvent(player, ids.device, transition));
          stopped ||= transition.type === 'game_stopped' && player.kind === DEVICE_TYPES.ACCOUNT;
        }
        states.push(...this.presenceStates(ids, player.presence, result));
      }

      if (newAccount || stopped || now - this.trophiesAt >= TROPHY_INTERVAL_MS) {
        const summary = await this.api.getTrophySummary(this.account.accountId);
        events.push(...this.trophyEvents(summary));
        this.trophies = summary;
        this.trophiesAt = now;
      }
      if (this.trophies) {
        states.push(...this.trophyStates());
      }

      await this.publishStates(states);
      if (newAccount) {
        await this.publishDiscoveredDevices();
      }
      this.link = { ok: true, error: null, checkedAt: now };
    } catch (err) {
      this.link = { ok: false, error: err, checkedAt: now };
      // A missing token is said once by the connection status, not at every cycle.
      if (err.code === 'NPSSO_MISSING') {
        logger.debug(err.message);
      } else {
        logger.warn(`PlayStation Network refresh failed: ${err.message}`);
      }
    }

    for (const event of events) {
      await this.fireEvent(event);
    }
    await this.reportLink();
    await this.persist();
    this.notifyIfChanged();
    return this.link;
  }

  async ensureAccount() {
    if (this.account) {
      return false;
    }
    const accountId = await this.api.getMyAccountId();
    const profile = await this.api.getProfile(accountId);
    this.account = {
      accountId,
      onlineId: profile.onlineId || accountId,
      avatarUrl: profile.avatarUrl,
      isPlusMember: profile.isPlusMember,
    };
    logger.info(`Signed in to the PlayStation Network as ${this.account.onlineId}`);
    return true;
  }

  async resolveFriends(now) {
    for (const onlineId of this.config.friendIds) {
      const key = onlineId.toLowerCase();
      const known = this.friends.get(key);
      if (known?.accountId || (known && now - known.checkedAt < MISSING_FRIEND_RETRY_MS)) {
        continue;
      }
      const found = await this.api.lookupOnlineId(onlineId);
      if (found) {
        logger.info(`Following ${found.onlineId}`);
        this.friends.set(key, { onlineId: found.onlineId, accountId: found.accountId });
      } else {
        logger.warn(`No PlayStation Network account is named ${onlineId}`);
        this.friends.set(key, { onlineId, accountId: null, checkedAt: now });
      }
    }
  }

  idsOf(player) {
    return player.kind === DEVICE_TYPES.ACCOUNT
      ? accountIds(this.gladys, player.accountId)
      : friendIds(this.gladys, player.accountId);
  }

  presenceStates(ids, presence, { sessionMinutes, todayMinutes }) {
    return [
      { device_feature_external_id: ids.feature(FEATURES.ONLINE), state: presence.online ? 1 : 0 },
      { device_feature_external_id: ids.feature(FEATURES.IN_GAME), state: presence.inGame ? 1 : 0 },
      {
        device_feature_external_id: ids.feature(FEATURES.GAME),
        text: presence.titleName ?? NO_TEXT,
      },
      {
        device_feature_external_id: ids.feature(FEATURES.PLATFORM),
        text: presence.platform ?? NO_TEXT,
      },
      { device_feature_external_id: ids.feature(FEATURES.SESSION), state: sessionMinutes },
      {
        device_feature_external_id: ids.feature(FEATURES.TODAY),
        state: Math.min(1440, todayMinutes),
      },
    ];
  }

  trophyStates() {
    const ids = accountIds(this.gladys, this.account.accountId);
    return [
      [FEATURES.TROPHY_LEVEL, this.trophies.level],
      [FEATURES.PLATINUM, this.trophies.platinum],
      [FEATURES.GOLD, this.trophies.gold],
      [FEATURES.SILVER, this.trophies.silver],
      [FEATURES.BRONZE, this.trophies.bronze],
    ].map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
  }

  /** Publish the states of the created devices, the unchanged ones skipped. */
  async publishStates(states) {
    const created = this.createdExternalIds();
    const wanted = states.filter((state) =>
      created.has(state.device_feature_external_id.split(':').slice(0, -1).join(':')),
    );
    if (wanted.length === 0) {
      return;
    }
    try {
      // A stable value is re-sent every 30 minutes so it stays recently dated.
      await this.gladys.publishChangedStates(wanted, { heartbeat: 30 * 60_000 });
    } catch (err) {
      // Gladys refused (429, restarting): not a PSN failure. The SDK sends the
      // refused values again with the next call.
      logger.warn(`Gladys refused the states: ${err.message}`);
    }
  }

  gameEvent(player, device, transition) {
    const data = {
      device,
      online_id: player.onlineId,
      game: transition.titleName ?? '',
      title_id: transition.titleId ?? '',
      platform: transition.platform ?? '',
    };
    if (transition.type === 'game_stopped') {
      logger.info(`${player.onlineId} stopped ${data.game} (${transition.durationMinutes} min)`);
      return {
        key: TRIGGERS.GAME_STOPPED,
        data: { ...data, duration_minutes: transition.durationMinutes },
      };
    }
    logger.info(`${player.onlineId} started ${data.game}`);
    return { key: TRIGGERS.GAME_STARTED, data };
  }

  /** One event per grade that grew since the last summary (none on the first). */
  trophyEvents(summary) {
    if (!this.trophies) {
      return [];
    }
    const device = accountIds(this.gladys, this.account.accountId).device;
    return TROPHY_GRADES.filter((grade) => summary[grade] > this.trophies[grade]).map((grade) => {
      logger.info(
        `${this.account.onlineId} earned ${summary[grade] - this.trophies[grade]} ${grade}`,
      );
      return {
        key: TRIGGERS.TROPHY_EARNED,
        data: {
          device,
          online_id: this.account.onlineId,
          grade,
          count: summary[grade] - this.trophies[grade],
          total: summary[grade],
          level: summary.level,
        },
      };
    });
  }

  async fireEvent({ key, data }) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      // 404 on a Gladys too old for the trigger, 429 past 300 events a minute:
      // the states are published anyway, the event alone is lost.
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  /** Connection status + the transport badge of the players. */
  async reportLink() {
    const message = this.link.ok ? undefined : linkMessage(this.link.error);
    const statusKey = JSON.stringify([this.link.ok, message?.en]);
    if (statusKey !== this.lastStatusKey) {
      try {
        await this.gladys.setConnectionStatus(this.link.ok, message);
        this.lastStatusKey = statusKey;
      } catch (err) {
        logger.warn(`Could not report the connection status: ${err.message}`);
      }
    }
    const created = this.createdExternalIds();
    const entries = this.playerAccountIds()
      .flatMap((accountId) => [
        accountIds(this.gladys, accountId).device,
        friendIds(this.gladys, accountId).device,
      ])
      .filter((externalId) => created.has(externalId))
      .map((externalId) => ({
        external_id: externalId,
        transport: this.link.ok ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE,
      }));
    await this.publishTransports(entries);
  }

  async publishTransports(entries) {
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
    } catch (err) {
      logger.warn(`Could not publish the transport badges: ${err.message}`);
    }
  }

  // --- the console loop ------------------------------------------------------

  /** The consoles known from discovery, from the created devices and from the config. */
  knownConsoles() {
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseDeviceExternalId(this.gladys, device.external_id);
      if (parsed?.type !== DEVICE_TYPES.CONSOLE || this.consoles.has(parsed.id)) {
        continue;
      }
      this.consoles.set(parsed.id, {
        hostId: parsed.id,
        hostName: device.name,
        hostType: deviceParam(device, 'HOST_TYPE') ?? 'PS5',
        ip: deviceParam(device, 'IP_ADDRESS'),
        power: null,
        status: 'unknown',
      });
    }
    return [...this.consoles.values()];
  }

  /** Remember a console that answered on the LAN. */
  rememberConsole(reply) {
    const key = consoleKey(reply.hostId);
    const known = this.consoles.get(key) ?? { power: null, status: 'unknown' };
    const updated = {
      ...known,
      hostId: reply.hostId,
      hostName: reply.hostName ?? known.hostName ?? null,
      hostType: reply.hostType,
      ip: reply.ip ?? known.ip ?? null,
    };
    const isNew = !this.consoles.has(key);
    this.consoles.set(key, updated);
    return { console: updated, isNew };
  }

  refreshConsoles() {
    if (!this.inFlight.consoles) {
      this.inFlight.consoles = this.doRefreshConsoles().finally(() => {
        this.inFlight.consoles = null;
      });
    }
    return this.inFlight.consoles;
  }

  async doRefreshConsoles() {
    await this.init();
    let added = false;
    // The IP typed in the configuration: a console the scan may not see (other
    // subnet, broadcast filtered) still answers in unicast.
    const configured = this.config.consoleIp;
    if (configured && !this.knownConsoles().some((console) => console.ip === configured)) {
      const reply = await this.probe(configured);
      if (reply) {
        added = this.rememberConsole(reply).isNew || added;
      }
    }

    const states = [];
    const transports = [];
    for (const console of this.knownConsoles()) {
      const local = console.ip ? await this.probe(console.ip) : null;
      if (local) {
        this.rememberConsole({ ...local, ip: local.ip ?? console.ip });
      }
      const result = this.consoleState(console, local);
      Object.assign(this.consoles.get(consoleKey(console.hostId)), result.console);
      const ids = consoleIds(this.gladys, console.hostId);
      if (result.console.power !== null) {
        states.push({
          device_feature_external_id: ids.feature(FEATURES.POWER),
          state: result.console.power,
        });
      }
      if (this.isCreated(ids.device)) {
        transports.push({ external_id: ids.device, ...result.transport });
      }
    }
    this.consolesCheckedAt = this.clock();
    await this.publishStates(states);
    await this.publishTransports(transports);
    if (added) {
      await this.publishDiscoveredDevices();
      await this.persist();
    }
    this.notifyIfChanged();
  }

  /** The power of a console as the PSN sees it: 1, 0, or null when unknown. */
  cloudPower(hostType) {
    if (!this.link.ok || !this.account) {
      return null;
    }
    const presence = this.presences.get(this.account.accountId);
    if (!presence) {
      return null;
    }
    return presence.online && (!presence.platform || presence.platform === hostType) ? 1 : 0;
  }

  /**
   * Decide the power and the transport badge of one console from the two
   * channels and the user's preference. The preference is a wish: when the
   * preferred channel says nothing, the other one is used and the badge says
   * so (degraded).
   */
  consoleState(console, local) {
    const cloud = this.cloudPower(console.hostType);
    const fromLocal = () => ({
      power: local.status === 'on' ? 1 : 0,
      status: local.status,
    });
    const fromCloud = () => ({ power: cloud, status: cloud ? 'on' : 'off' });
    const unknown = { power: null, status: 'unknown' };

    if (this.config.GLADYS_PREFER_LOCAL) {
      if (local) {
        return { console: fromLocal(), transport: { transport: DEVICE_TRANSPORTS.LOCAL } };
      }
      if (cloud !== null) {
        return {
          console: fromCloud(),
          transport: console.ip
            ? { transport: DEVICE_TRANSPORTS.CLOUD, degraded: true, message: NO_LOCAL_ANSWER }
            : { transport: DEVICE_TRANSPORTS.CLOUD },
        };
      }
      return { console: unknown, transport: { transport: DEVICE_TRANSPORTS.UNREACHABLE } };
    }
    if (cloud !== null) {
      return { console: fromCloud(), transport: { transport: DEVICE_TRANSPORTS.CLOUD } };
    }
    if (local) {
      return {
        console: fromLocal(),
        transport: { transport: DEVICE_TRANSPORTS.LOCAL, degraded: true, message: NO_CLOUD_ANSWER },
      };
    }
    return { console: unknown, transport: { transport: DEVICE_TRANSPORTS.UNREACHABLE } };
  }

  // --- discovery ---------------------------------------------------------------

  /**
   * Find what can be added to Gladys: the account, the friends, and the
   * consoles of the LAN (broadcast through the core, plus the configured IP).
   *
   * @param {object} [options]
   * @param {boolean} [options.scan] broadcast on the LAN (takes ~15 s)
   * @returns {Promise<{ found: object[], scanErrors: string[] }>}
   */
  async discover({ scan = true } = {}) {
    await this.init();
    let found = [];
    let scanErrors = [];
    if (scan) {
      const result = await this.scan(this.gladys);
      found = result.consoles;
      scanErrors = result.errors;
    }
    if (this.config.consoleIp && !found.some((reply) => reply.ip === this.config.consoleIp)) {
      const reply = await this.probe(this.config.consoleIp);
      if (reply) {
        found.push(reply);
      }
    }
    for (const reply of found) {
      this.rememberConsole(reply);
    }
    if (
      this.config.npsso &&
      (!this.account || this.resolvedFriends().length < this.config.friendIds.length)
    ) {
      await this.refresh();
    }
    await this.persist();
    await this.publishDiscoveredDevices();
    return { found, scanErrors };
  }

  // --- views for the actions, the scenes and the widget ------------------------

  /** A player by device external id, the account when none is given. */
  player(externalId) {
    const parsed = externalId ? parseDeviceExternalId(this.gladys, externalId) : null;
    if (parsed?.type === DEVICE_TYPES.FRIEND) {
      const friend = this.resolvedFriends().find((f) => f.accountId === parsed.id);
      return friend ? this.playerView(DEVICE_TYPES.FRIEND, friend) : null;
    }
    if (parsed && parsed.type !== DEVICE_TYPES.ACCOUNT && parsed.type !== DEVICE_TYPES.CONSOLE) {
      return null;
    }
    return this.account ? this.playerView(DEVICE_TYPES.ACCOUNT, this.account) : null;
  }

  playerView(kind, who) {
    const ids =
      kind === DEVICE_TYPES.ACCOUNT
        ? accountIds(this.gladys, who.accountId)
        : friendIds(this.gladys, who.accountId);
    return {
      kind,
      accountId: who.accountId,
      onlineId: who.onlineId,
      isPlusMember: who.isPlusMember ?? null,
      ids,
      created: this.isCreated(ids.device),
      presence: this.presences.get(who.accountId) ?? null,
      ...this.tracker.minutes(who.accountId, this.clock()),
      trophies: kind === DEVICE_TYPES.ACCOUNT ? this.trophies : null,
    };
  }

  /** A console by device external id, the first one when none is given. */
  consoleView(externalId) {
    const consoles = this.knownConsoles();
    if (!externalId) {
      return consoles[0] ?? null;
    }
    const parsed = parseDeviceExternalId(this.gladys, externalId);
    return parsed?.type === DEVICE_TYPES.CONSOLE ? (this.consoles.get(parsed.id) ?? null) : null;
  }

  /** An image key for a game icon, remembered so onWidgetGetImage can serve it. */
  imageKey(url) {
    if (!url) {
      return null;
    }
    const key = `game-${hashOf(url).slice(0, 24)}`;
    this.images.delete(key);
    this.images.set(key, url);
    // Keep the most recent icons only: a Map iterates in insertion order.
    while (this.images.size > MAX_IMAGES) {
      this.images.delete(this.images.keys().next().value);
    }
    return key;
  }

  /** Nudge the widgets when what they show changed. */
  notifyIfChanged() {
    const signature = JSON.stringify([
      this.link.ok,
      [...this.presences.values()].map((p) => [p.online, p.titleName, p.platform]),
      this.trophies,
      [...this.consoles.values()].map((c) => [c.power, c.status]),
    ]);
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      for (const listener of this.listeners) {
        listener();
      }
    }
  }
}

const NO_LOCAL_ANSWER = {
  en: 'The console does not answer on the local network: state read from the PlayStation Network.',
  fr: 'La console ne répond pas sur le réseau local : état lu sur le PlayStation Network.',
  de: 'Die Konsole antwortet nicht im lokalen Netzwerk: Status aus dem PlayStation Network.',
  es: 'La consola no responde en la red local: estado leído de PlayStation Network.',
};

const NO_CLOUD_ANSWER = {
  en: 'PlayStation Network unreachable: state read on the local network.',
  fr: 'PlayStation Network injoignable : état lu sur le réseau local.',
  de: 'PlayStation Network nicht erreichbar: Status aus dem lokalen Netzwerk.',
  es: 'PlayStation Network inaccesible: estado leído en la red local.',
};

/** The message of the Configuration screen for a failed refresh. */
export function linkMessage(error) {
  if (error?.code === 'NPSSO_MISSING') {
    return {
      en: 'Paste your NPSSO token in the configuration (see the documentation).',
      fr: 'Collez votre jeton NPSSO dans la configuration (voir la documentation).',
      de: 'Füge dein NPSSO-Token in der Konfiguration ein (siehe Dokumentation).',
      es: 'Pegue su token NPSSO en la configuración (vea la documentación).',
    };
  }
  if (error?.code === 'NPSSO_INVALID') {
    return {
      en: 'The NPSSO token expired or is wrong: get a new one (see the documentation).',
      fr: 'Le jeton NPSSO a expiré ou est faux : récupérez-en un nouveau (voir la documentation).',
      de: 'Das NPSSO-Token ist abgelaufen oder falsch: Hole ein neues (siehe Dokumentation).',
      es: 'El token NPSSO caducó o es incorrecto: obtenga uno nuevo (vea la documentación).',
    };
  }
  if (error?.status === 429) {
    return {
      en: 'Too many requests to the PlayStation Network: raise the refresh interval.',
      fr: "Trop de requêtes vers le PlayStation Network : augmentez l'intervalle de rafraîchissement.",
      de: 'Zu viele Anfragen an das PlayStation Network: Erhöhe das Aktualisierungsintervall.',
      es: 'Demasiadas solicitudes a PlayStation Network: aumente el intervalo de actualización.',
    };
  }
  if (error?.code === 'NETWORK' || error?.status === 0 || (error?.status ?? 0) >= 500) {
    return {
      en: 'PlayStation Network unreachable for now: retrying at the next refresh.',
      fr: 'PlayStation Network injoignable pour le moment : nouvel essai au prochain rafraîchissement.',
      de: 'PlayStation Network derzeit nicht erreichbar: neuer Versuch bei der nächsten Aktualisierung.',
      es: 'PlayStation Network inaccesible por ahora: nuevo intento en la próxima actualización.',
    };
  }
  const detail = error?.message ? ` (${error.message})` : '';
  return {
    en: `PlayStation Network error${detail}.`,
    fr: `Erreur du PlayStation Network${detail}.`,
    de: `Fehler des PlayStation Network${detail}.`,
    es: `Error de PlayStation Network${detail}.`,
  };
}
