# Security policy

## Supported versions

Only the latest release of the PlayStation Network integration receives security
fixes. Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-playstationnetwork](https://github.com/prohand/gladys-playstationnetwork/security),
then **Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove tokens, NPSSO values, account ids and addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), the
PlayStation Network and the consoles (report to Sony).

## How the integration handles your account

- The **NPSSO token** is as good as your PlayStation account password for whoever holds
  it. It is stored by Gladys in a secret field, sent only to Sony's sign-in server
  (`ca.account.sony.com`), never written to disk and never logged.
- The access and refresh tokens obtained with it are kept in `/data/tokens.json`
  (owner-only permissions), the only writable volume of the container. Only a hash of
  the NPSSO is stored next to them, to notice when you change it.
- The integration only **reads**: profile, presence, trophy summary. It sends no
  message, no friend request and makes no purchase.
- On the local network, it only sends the PlayStation discovery request (UDP 987 and 9302) to find the consoles and read whether they are on. It cannot turn them on or
  control them.

## Good practices for users

- Keep the NPSSO only in the integration's secret field: never paste it in a forum,
  a ticket or a log.
- If you think it leaked, sign out of all devices from your PlayStation account
  settings: every token made from it stops working. Then paste a new NPSSO.
- Keep Gladys and the integration up to date.
