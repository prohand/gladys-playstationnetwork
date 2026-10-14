# PlayStation Network

Suivez dans Gladys qui joue sur PlayStation, à quel jeu, combien de temps aujourd'hui, les
trophées de votre compte, et si votre PS4 ou PS5 est allumée, en veille ou éteinte.

> Intégration non officielle, sans lien avec Sony. Sony ne propose pas d'API publique :
> l'intégration lit les mêmes données que l'application PlayStation.

## Avant de commencer

Il vous faut :

- un compte PlayStation Network (celui dont vous voulez suivre les jeux et les trophées) ;
- un ordinateur avec un navigateur web, pour récupérer une fois le **jeton NPSSO** ;
- pour les consoles (facultatif) : une PS4 ou une PS5 sur le même réseau que Gladys.

## Récupérer votre jeton NPSSO

Le NPSSO est un code de 64 caractères qui prouve que vous êtes connecté à votre compte Sony.
L'intégration s'en sert pour se connecter comme le fait l'application PlayStation.

1. Dans votre navigateur, allez sur [playstation.com](https://www.playstation.com/) et
   **connectez-vous** avec votre compte PlayStation Network.
2. Dans le **même navigateur**, ouvrez
   [https://ca.account.sony.com/api/v1/ssocookie](https://ca.account.sony.com/api/v1/ssocookie).
3. La page affiche quelque chose comme `{"npsso":"Ab12...xyz"}`. Copiez la valeur de
   64 caractères entre les guillemets (copier toute la ligne marche aussi : l'intégration
   retrouve la valeur).

Si la page affiche une erreur, vous n'êtes pas connecté : revenez à l'étape 1.

> **Gardez ce jeton secret.** Qui le détient peut utiliser votre compte. Gladys le range dans
> un champ secret et l'intégration ne l'écrit jamais sur le disque ni dans les logs. Si vous
> pensez qu'il a fuité, déconnectez tous les appareils depuis les paramètres de votre compte
> PlayStation, puis récupérez-en un nouveau.

Le jeton dure environ **deux mois**. Quand il expire, l'écran de configuration de
l'intégration le dit : récupérez-en un nouveau de la même façon et collez-le.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Collez le jeton dans **Jeton NPSSO**.
3. **Amis à suivre** (facultatif) : leurs identifiants en ligne, séparés par des virgules,
   10 au plus. Leurs paramètres de confidentialité doivent vous laisser voir leur statut en
   ligne.
4. **Adresse IP de la console** (facultatif) : seulement si « Trouver mes consoles » ne
   trouve pas votre console (voir plus bas).
5. **Intervalle de rafraîchissement** : fréquence de lecture du PlayStation Network,
   120 secondes par défaut (60 minimum : Sony limite le nombre de requêtes).
6. **Fuseau horaire** : « Joué aujourd'hui » repart de zéro à minuit dans ce fuseau
   (`Europe/Paris` par défaut).
7. Enregistrez, puis cliquez sur **Tester la connexion** : elle affiche votre identifiant,
   votre statut, vos trophées et le statut de chaque ami.
8. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus.

## Les appareils

### Votre compte PSN

Les fonctionnalités arrivent dans Gladys avec leur nom anglais (entre parenthèses ci-dessous) : vous pouvez les renommer en ajoutant l'appareil.

| Fonctionnalité                     | Valeur                                           |
| ---------------------------------- | ------------------------------------------------ |
| En ligne (Online)                  | 1 quand en ligne sur une console, 0 sinon        |
| En jeu (In game)                   | 1 quand un jeu tourne                            |
| Jeu en cours (Current game)        | le nom du jeu, `-` s'il n'y en a pas             |
| Plateforme (Platform)              | PS5, PS4…                                        |
| Session en cours (Current session) | minutes depuis le début du jeu en cours          |
| Joué aujourd'hui (Played today)    | minutes de jeu depuis minuit                     |
| Niveau trophées (Trophy level)     | votre niveau de trophées                         |
| Trophées                           | nombre de trophées platine, or, argent et bronze |

Les trophées sont lus toutes les 15 minutes, et à la fin de chaque partie.

### Amis

Chaque ami suivi est un appareil avec les mêmes fonctionnalités que votre compte, sauf les
trophées.

### Consoles

Chaque console trouvée est un appareil avec une fonctionnalité **Alimentation** (Power) : 1 quand
elle est allumée, 0 en veille ou éteinte.

## Les consoles sur le réseau local

Une PS4 ou une PS5 indique sur le réseau local si elle est allumée ou en veille. Pour cela :

- **PS5** : Paramètres → Système → Économie d'énergie → Fonctionnalités disponibles en mode
  repos → activez **Rester connecté à Internet** et **Activer l'allumage de la PS5 depuis le
  réseau** ;
- **PS4** : Paramètres → Paramètres d'économie d'énergie → Définir les fonctions disponibles en
  mode repos → activez **Rester connecté à Internet** et **Activer l'allumage de la PS4 via le
  réseau**.

Cliquez ensuite sur **Trouver mes consoles** dans la configuration : Gladys envoie la requête
de découverte PlayStation sur votre réseau et liste ce qui a répondu. Ouvrez l'onglet
**Découverte** pour ajouter la console.

Si rien ne répond (autre réseau, box qui filtre le broadcast), donnez une adresse IP fixe à
votre console dans votre box, saisissez-la dans **Adresse IP de la console**, puis cliquez de
nouveau sur **Trouver mes consoles**.

### Local ou cloud

Gladys affiche un badge **local** ou **cloud** sur la console :

- **local** : l'état vient de la console elle-même, sur votre réseau ;
- **cloud** : l'état vient de votre présence PSN (en ligne sur la même plateforme = allumée).

Le bouton **Préférer la connexion locale** de la configuration choisit lequel passe en
premier. Quand celui préféré ne dit rien, l'autre est utilisé et le badge affiche un point
orange avec la raison. Sans le réseau local, la veille et l'arrêt ne se distinguent pas, et
une console utilisée par un autre compte est vue éteinte.

L'intégration ne peut pas allumer une console ni la piloter : elle lit seulement son état.

## Scènes

### Déclencheurs

- **Un jeu a démarré** : votre compte ou un ami suivi a lancé un jeu. Variables : identifiant
  en ligne, jeu, identifiant du jeu, plateforme.
- **Un jeu s'est arrêté** : le jeu s'est terminé ou un autre l'a remplacé. Mêmes variables,
  plus la **durée de la session** en minutes.
- **Un trophée a été obtenu** : votre compte a obtenu de nouveaux trophées. Filtre par
  catégorie (platine, or, argent, bronze). Variables : catégorie, nombre de nouveaux trophées,
  total de cette catégorie, niveau de trophées.

Les fonctionnalités des appareils marchent aussi avec les déclencheurs standards de Gladys.
Exemples :

- _quand « Played today » du compte de mon fils dépasse 120, envoie-moi un message_ ;
- _quand « Power » de la PS5 passe à 1 après 22 h, éteins les lumières du salon_.

### Actions

- **Lire le statut d'un joueur** : lit le PlayStation Network maintenant et renvoie en ligne,
  en jeu, jeu, plateforme, session en cours et joué aujourd'hui, pour les actions suivantes de
  la scène (par ex. une condition « seulement si en jeu »).
- **Lire l'état d'une console** : allumée, en veille (`standby`) ou éteinte, lu maintenant.

## Widget du tableau de bord

Ajoutez le widget **PlayStation Network** à un tableau de bord. Il affiche :

- le temps joué aujourd'hui et la session en cours, et pour votre compte le niveau de trophées
  et le nombre de platines ;
- qui joue à quoi, avec les icônes des jeux (ou l'icône de votre jeu si vous ne suivez aucun
  ami) ;
- votre statut, plateforme et jeu, et l'état des consoles ;
- un bouton **Actualiser**.

Dans les réglages du widget, **Joueur** choisit de qui c'est la carte (votre compte par
défaut).

## Dépannage

- **« Le jeton NPSSO a expiré ou est faux »** : récupérez-en un nouveau (voir plus haut). Cela
  arrive aussi après un changement de mot de passe ou une déconnexion de tous les appareils.
- **« Trop de requêtes vers le PlayStation Network »** : augmentez l'intervalle de
  rafraîchissement.
- **Un ami est « masqué »** : ses paramètres de confidentialité ne vous laissent pas voir son
  statut, ou vous n'êtes plus amis.
- **Un ami a « aucun compte à ce nom »** : vérifiez l'identifiant (lettres, chiffres, `-` et
  `_`, 3 à 16 caractères).
- **La console n'est pas trouvée** : vérifiez les paramètres d'économie d'énergie ci-dessus,
  et qu'elle est branchée (complètement éteinte, elle ne répond jamais).
- **« Joué aujourd'hui » semble faible** : le temps est compté entre deux rafraîchissements.
  Quand Gladys ou le PlayStation Network ont été injoignables longtemps, au plus deux fois
  l'intervalle de rafraîchissement est compté pour le trou.
