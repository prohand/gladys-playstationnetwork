// -----------------------------------------------------------------------------
// Dashboard widget (Gladys 5.1+): who plays what, at a glance.
//
// One card per player (the account by default, or the player picked in the
// widget settings):
//   - tiles: played today, current session, and for the account the trophy
//     level and platinum count — bound to the device features when the device
//     exists (live, no refresh), computed otherwise;
//   - the focal part: the list of the followed players with their game icon
//     when friends are followed, the icon of the current game otherwise;
//   - a status list: PSN link, status, platform, game, consoles;
//   - buttons: refresh now, documentation.
//
// The content is declarative (the core renders it, no HTML): see the "Dashboard
// widgets" section of the SDK README for the vocabulary and the budget.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES, FEATURES, friendIds } from '../devices/index.js';

/** Key of the manifest widget. Never renamed: dashboards store it. */
export const PSN_WIDGET = 'psn_status';

/** The widget actions. */
export const WIDGET_ACTIONS = Object.freeze({ REFRESH: 'refresh' });

const DOCS_URL = 'https://github.com/prohand/gladys-playstationnetwork/blob/main/docs/en.md';

const clip = (text, max) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const STATUS = {
  inGame: {
    value: { en: 'In game', fr: 'En jeu', de: 'Im Spiel', es: 'Jugando' },
    color: WIDGET_COLORS.SUCCESS,
  },
  online: {
    value: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
    color: WIDGET_COLORS.INFO,
  },
  offline: {
    value: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Desconectado' },
    color: WIDGET_COLORS.NEUTRAL,
  },
  unknown: {
    value: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
    color: WIDGET_COLORS.NEUTRAL,
  },
};

function statusOf(presence) {
  if (!presence) {
    return STATUS.unknown;
  }
  if (presence.inGame) {
    return STATUS.inGame;
  }
  return presence.online ? STATUS.online : STATUS.offline;
}

const CONSOLE_STATUS = {
  on: {
    value: { en: 'On', fr: 'Allumée', de: 'Ein', es: 'Encendida' },
    color: WIDGET_COLORS.SUCCESS,
  },
  standby: {
    value: { en: 'Rest mode', fr: 'En veille', de: 'Ruhemodus', es: 'En reposo' },
    color: WIDGET_COLORS.INFO,
  },
  off: {
    value: { en: 'Off', fr: 'Éteinte', de: 'Aus', es: 'Apagada' },
    color: WIDGET_COLORS.NEUTRAL,
  },
  unknown: STATUS.unknown,
};

/** A short date in the reader's language and the configured time zone. */
function formatDate(iso, language, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat(language || 'en', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** A tile: live when the feature exists in Gladys, computed otherwise. */
function tile(player, key, value, label, icon, unit) {
  if (player.created) {
    return { type: 'value', device_feature: player.ids.feature(key), label, icon };
  }
  return { type: 'value', value, ...(unit ? { unit } : {}), label, icon };
}

function setupNotice(service) {
  if (!service.config.npsso) {
    return {
      en: 'Paste your NPSSO token in the configuration.',
      fr: 'Collez votre jeton NPSSO dans la configuration.',
      de: 'Füge dein NPSSO-Token in der Konfiguration ein.',
      es: 'Pegue su token NPSSO en la configuración.',
    };
  }
  if (!service.link.ok && service.link.checkedAt > 0) {
    if (service.link.error?.code === 'NPSSO_INVALID') {
      return {
        en: 'NPSSO token expired: paste a new one.',
        fr: 'Jeton NPSSO expiré : collez-en un nouveau.',
        de: 'NPSSO-Token abgelaufen: Füge ein neues ein.',
        es: 'Token NPSSO caducado: pegue uno nuevo.',
      };
    }
    return {
      en: 'PlayStation Network unreachable for now.',
      fr: 'PlayStation Network injoignable pour le moment.',
      de: 'PlayStation Network derzeit nicht erreichbar.',
      es: 'PlayStation Network inaccesible por ahora.',
    };
  }
  return null;
}

function playerRow(service, player) {
  const presence = player.presence;
  const { value, color } = statusOf(presence);
  const subtitle = presence?.inGame
    ? clip(presence.titleName, 60)
    : presence?.online
      ? (presence.platform ?? '')
      : '';
  return {
    title: clip(player.onlineId, 60),
    ...(subtitle ? { subtitle } : {}),
    ...(presence?.inGame && presence.iconUrl ? { image: service.imageKey(presence.iconUrl) } : {}),
    badge: { text: value, color },
  };
}

/**
 * The content of the `psn_status` widget.
 *
 * @param {import('../service.js').PsnService} service
 * @param {object} [request] what onWidgetGet receives
 * @param {object} [request.settings]
 * @param {string} [request.language]
 */
export function buildPsnWidget(service, { settings = {}, language = 'en' } = {}) {
  const components = [];
  const notice = setupNotice(service);
  if (notice) {
    components.push({ type: 'text', variant: 'caption', text: notice });
  }

  const player = service.player(settings.player);
  if (player) {
    const presence = player.presence;
    components.push(
      tile(player, FEATURES.TODAY, player.todayMinutes, LABELS.today, 'clock', 'min'),
      tile(player, FEATURES.SESSION, player.sessionMinutes, LABELS.session, 'play', 'min'),
    );
    if (player.kind === DEVICE_TYPES.ACCOUNT && player.trophies) {
      components.push(
        tile(player, FEATURES.TROPHY_LEVEL, player.trophies.level, LABELS.level, 'award'),
        tile(player, FEATURES.PLATINUM, player.trophies.platinum, LABELS.platinum, 'star'),
      );
    }

    // The focal part: the followed players, or the current game's icon.
    const friends = service.resolvedFriends();
    if (friends.length > 0) {
      const rows = [
        service.player(),
        ...friends.map((friend) =>
          service.player(friendIds(service.gladys, friend.accountId).device),
        ),
      ].filter(Boolean);
      components.push({
        type: 'card-list',
        display: 'list',
        items: rows.slice(0, 8).map((row) => playerRow(service, row)),
      });
    } else if (presence?.inGame && presence.iconUrl) {
      components.push({
        type: 'image',
        key: service.imageKey(presence.iconUrl),
        alt: clip(presence.titleName, 120),
        fit: 'contain',
      });
    }

    const items = [
      {
        label: LABELS.player,
        value: clip(player.onlineId, 40),
        icon: 'user',
        color: WIDGET_COLORS.NEUTRAL,
      },
      { label: LABELS.status, icon: 'activity', ...statusOf(presence) },
    ];
    if (presence?.platform) {
      items.push({
        label: LABELS.platform,
        value: presence.platform,
        icon: 'monitor',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    if (presence?.inGame) {
      items.push({
        label: LABELS.game,
        value: clip(presence.titleName, 40),
        icon: 'play-circle',
        color: WIDGET_COLORS.SUCCESS,
      });
    } else if (presence?.lastOnline && !presence.online) {
      const date = formatDate(presence.lastOnline, language, service.config.timezone);
      if (date) {
        items.push({
          label: LABELS.lastSeen,
          value: date,
          icon: 'clock',
          color: WIDGET_COLORS.NEUTRAL,
        });
      }
    }
    for (const console of service.knownConsoles().slice(0, 3)) {
      const { value, color } = CONSOLE_STATUS[console.status] ?? CONSOLE_STATUS.unknown;
      items.push({
        label: clip(console.hostName ?? console.hostType, 40),
        value,
        color,
        icon: 'tv',
      });
    }
    components.push({ type: 'status', items: items.slice(0, 10) });
  } else if (service.config.npsso) {
    components.push({
      type: 'status',
      items: [{ label: LABELS.link, icon: 'wifi', ...STATUS.unknown }],
    });
  }

  components.push(
    {
      type: 'button',
      label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
      icon: 'refresh-cw',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.REFRESH },
    },
    {
      type: 'button',
      label: { en: 'Documentation', fr: 'Documentation', de: 'Dokumentation', es: 'Documentación' },
      icon: 'book-open',
      style: 'secondary',
      link: { url: DOCS_URL },
    },
  );

  return { ttl_seconds: 120, components };
}

const LABELS = {
  today: { en: 'Played today', fr: "Joué aujourd'hui", de: 'Heute gespielt', es: 'Jugado hoy' },
  session: { en: 'Session', fr: 'Session', de: 'Sitzung', es: 'Sesión' },
  level: { en: 'Trophy level', fr: 'Niveau trophées', de: 'Trophäenstufe', es: 'Nivel trofeos' },
  platinum: { en: 'Platinum', fr: 'Platine', de: 'Platin', es: 'Platino' },
  player: { en: 'Player', fr: 'Joueur', de: 'Spieler', es: 'Jugador' },
  status: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  platform: { en: 'Platform', fr: 'Plateforme', de: 'Plattform', es: 'Plataforma' },
  game: { en: 'Game', fr: 'Jeu', de: 'Spiel', es: 'Juego' },
  lastSeen: {
    en: 'Last seen',
    fr: 'Vu la dernière fois',
    de: 'Zuletzt gesehen',
    es: 'Visto por última vez',
  },
  link: {
    en: 'PlayStation Network',
    fr: 'PlayStation Network',
    de: 'PlayStation Network',
    es: 'PlayStation Network',
  },
};

export const WIDGETS = {
  [PSN_WIDGET]: {
    async get(service, request) {
      return buildPsnWidget(service, request);
    },

    async action(service, { actionKey }) {
      if (actionKey !== WIDGET_ACTIONS.REFRESH) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const link = await service.refresh();
      await service.refreshConsoles();
      return link.ok
        ? { en: 'Refreshed', fr: 'Actualisé', de: 'Aktualisiert', es: 'Actualizado' }
        : {
            en: 'PlayStation Network unreachable',
            fr: 'PlayStation Network injoignable',
            de: 'PlayStation Network nicht erreichbar',
            es: 'PlayStation Network inaccesible',
          };
    },
  },
};
