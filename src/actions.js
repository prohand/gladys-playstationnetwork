// -----------------------------------------------------------------------------
// The buttons of the Configuration screen (manifest `actions`).
//
//   - `test_connection`: sign in, read the account, the friends and the
//     trophies, and say in plain words what works and what does not;
//   - `find_consoles`: look for the PS4 / PS5 of the LAN, then publish them so
//     they show up in the Discovery tab.
//
// Each message is written in the four languages of the interface.
// -----------------------------------------------------------------------------

import { localize, pick } from './i18n.js';
import { linkMessage } from './service.js';

const yes = { en: 'yes', fr: 'oui', de: 'ja', es: 'sí' };
const no = { en: 'no', fr: 'non', de: 'nein', es: 'no' };

function describePresence(presence, language) {
  if (!presence) {
    return pick(language, { en: 'hidden', fr: 'masqué', de: 'verborgen', es: 'oculto' });
  }
  if (presence.inGame) {
    return pick(language, {
      en: `playing ${presence.titleName}`,
      fr: `joue à ${presence.titleName}`,
      de: `spielt ${presence.titleName}`,
      es: `jugando a ${presence.titleName}`,
    });
  }
  if (presence.online) {
    return pick(language, { en: 'online', fr: 'en ligne', de: 'online', es: 'en línea' });
  }
  return pick(language, { en: 'offline', fr: 'hors ligne', de: 'offline', es: 'desconectado' });
}

export const ACTIONS = {
  async test_connection(service) {
    const link = await service.refresh();
    if (!link.ok) {
      return linkMessage(link.error);
    }
    const account = service.player();
    const friends = service.config.friendIds.map((onlineId) => {
      const known = service.friends.get(onlineId.toLowerCase());
      return { onlineId, friend: known?.accountId ? known : null };
    });
    return localize((language) => {
      const lines = [
        pick(language, {
          en: `Connected as ${account.onlineId} (PlayStation Plus: ${pick(language, account.isPlusMember ? yes : no)}).`,
          fr: `Connecté en tant que ${account.onlineId} (PlayStation Plus : ${pick(language, account.isPlusMember ? yes : no)}).`,
          de: `Verbunden als ${account.onlineId} (PlayStation Plus: ${pick(language, account.isPlusMember ? yes : no)}).`,
          es: `Conectado como ${account.onlineId} (PlayStation Plus: ${pick(language, account.isPlusMember ? yes : no)}).`,
        }),
        pick(language, {
          en: `Status: ${describePresence(account.presence, language)}${account.presence?.platform ? ` (${account.presence.platform})` : ''}.`,
          fr: `Statut : ${describePresence(account.presence, language)}${account.presence?.platform ? ` (${account.presence.platform})` : ''}.`,
          de: `Status: ${describePresence(account.presence, language)}${account.presence?.platform ? ` (${account.presence.platform})` : ''}.`,
          es: `Estado: ${describePresence(account.presence, language)}${account.presence?.platform ? ` (${account.presence.platform})` : ''}.`,
        }),
      ];
      if (account.trophies) {
        const t = account.trophies;
        lines.push(
          pick(language, {
            en: `Trophy level ${t.level}: ${t.platinum} platinum, ${t.gold} gold, ${t.silver} silver, ${t.bronze} bronze.`,
            fr: `Niveau de trophées ${t.level} : ${t.platinum} platine, ${t.gold} or, ${t.silver} argent, ${t.bronze} bronze.`,
            de: `Trophäenstufe ${t.level}: ${t.platinum} Platin, ${t.gold} Gold, ${t.silver} Silber, ${t.bronze} Bronze.`,
            es: `Nivel de trofeos ${t.level}: ${t.platinum} platino, ${t.gold} oro, ${t.silver} plata, ${t.bronze} bronce.`,
          }),
        );
      }
      for (const { onlineId, friend } of friends) {
        const state = friend
          ? describePresence(service.presences.get(friend.accountId), language)
          : pick(language, {
              en: 'no account with this name',
              fr: 'aucun compte à ce nom',
              de: 'kein Konto mit diesem Namen',
              es: 'ninguna cuenta con este nombre',
            });
        lines.push(`${friend?.onlineId ?? onlineId}: ${state}.`);
      }
      if (service.config.invalidFriends.length > 0) {
        lines.push(
          pick(language, {
            en: `Ignored (not an online ID): ${service.config.invalidFriends.join(', ')}.`,
            fr: `Ignorés (pas un identifiant en ligne) : ${service.config.invalidFriends.join(', ')}.`,
            de: `Ignoriert (keine Online-ID): ${service.config.invalidFriends.join(', ')}.`,
            es: `Ignorados (no es un ID en línea): ${service.config.invalidFriends.join(', ')}.`,
          }),
        );
      }
      if (service.config.friendsTruncated) {
        lines.push(
          pick(language, {
            en: 'Only the first 10 friends are followed.',
            fr: 'Seuls les 10 premiers amis sont suivis.',
            de: 'Nur die ersten 10 Freunde werden verfolgt.',
            es: 'Solo se siguen los 10 primeros amigos.',
          }),
        );
      }
      return lines.join('\n');
    });
  },

  async find_consoles(service) {
    if (service.config.console_ip && !service.config.consoleIp) {
      return {
        en: `"${service.config.console_ip}" is not an IPv4 address.`,
        fr: `« ${service.config.console_ip} » n'est pas une adresse IPv4.`,
        de: `„${service.config.console_ip}“ ist keine IPv4-Adresse.`,
        es: `«${service.config.console_ip}» no es una dirección IPv4.`,
      };
    }
    const { found, scanErrors } = await service.discover({ scan: true });
    await service.refreshConsoles();
    if (found.length === 0) {
      return localize((language) => {
        const lines = [
          pick(language, {
            en: 'No console answered. Check that it is plugged in, and in its power saving settings that "Stay connected to the internet" is on (PS5: also "Enable turning on PS5 from network").',
            fr: "Aucune console n'a répondu. Vérifiez qu'elle est branchée et, dans ses paramètres d'économie d'énergie, que « Rester connecté à Internet » est activé (PS5 : aussi « Activer l'allumage de la PS5 depuis le réseau »).",
            de: 'Keine Konsole hat geantwortet. Prüfe, dass sie eingesteckt ist und in den Energiespareinstellungen „Mit dem Internet verbunden bleiben“ aktiv ist (PS5: auch „Einschalten der PS5 über das Netzwerk aktivieren“).',
            es: 'Ninguna consola respondió. Compruebe que está enchufada y, en sus ajustes de ahorro de energía, que «Permanecer conectado a Internet» está activado (PS5: también «Habilitar el encendido de la PS5 desde la red»).',
          }),
        ];
        if (scanErrors.length > 0) {
          lines.push(
            pick(language, {
              en: `The network scan failed (${scanErrors[0]}): type the console IP in the configuration.`,
              fr: `Le scan réseau a échoué (${scanErrors[0]}) : saisissez l'IP de la console dans la configuration.`,
              de: `Der Netzwerkscan ist fehlgeschlagen (${scanErrors[0]}): Gib die IP der Konsole in der Konfiguration ein.`,
              es: `El escaneo de red falló (${scanErrors[0]}): escriba la IP de la consola en la configuración.`,
            }),
          );
        }
        return lines.join('\n');
      });
    }
    return localize((language) => {
      const status = (reply) =>
        pick(
          language,
          reply.status === 'on'
            ? { en: 'on', fr: 'allumée', de: 'ein', es: 'encendida' }
            : reply.status === 'standby'
              ? { en: 'rest mode', fr: 'en veille', de: 'Ruhemodus', es: 'en reposo' }
              : { en: 'unknown', fr: 'inconnu', de: 'unbekannt', es: 'desconocido' },
        );
      const lines = found.map(
        (reply) =>
          `${reply.hostName ?? reply.hostType} — ${reply.hostType}, ${reply.ip ?? '?'}, ${status(reply)}`,
      );
      lines.push(
        pick(language, {
          en: 'Open the Discovery tab to add them.',
          fr: "Ouvrez l'onglet Découverte pour les ajouter.",
          de: 'Öffne den Tab „Erkennung“, um sie hinzuzufügen.',
          es: 'Abra la pestaña Descubrimiento para añadirlas.',
        }),
      );
      return lines.join('\n');
    });
  },
};
