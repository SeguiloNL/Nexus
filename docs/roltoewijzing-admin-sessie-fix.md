# Roltoewijzing ADMIN sessie-fix

## Hoofdoorzaak

Het systeem gebruikte twee bronnen voor dezelfde gebruikerstoegang:

- `users.role`: legacy enum (`ADMIN`, `EMPLOYEE`, `VIEWER`)
- `users.roleId`: verwijzing naar de echte rol in `roles`

Bij gebruikers waarvan `roleId` al naar de systeemrol `ADMIN` wees, maar `users.role`
nog op `EMPLOYEE` stond, ontstond een inconsistente sessie:

- permissies werden soms wel uit `roleId` afgeleid;
- UI-badges en meerdere guards gebruikten nog `session.user.role`;
- resultaat: badge "Medewerker" en foutmelding bij planning, ondanks admin-rol.

## Oplossing

1. Tijdens login en JWT-refresh wordt de effectieve legacy rol nu centraal afgeleid
   uit de gekoppelde systeemrol.
2. Als `roleId` naar een legacy systeemrol wijst (`ADMIN`, `EMPLOYEE`, `VIEWER`),
   wordt die systeemrol leidend voor `session.user.role`.
3. Bij een mismatch wordt het legacy veld `users.role` automatisch rechtgetrokken,
   zodat bestaande records zichzelf herstellen.
4. Settings-acties gebruiken daarnaast permissies/`roleId` als extra vangnet voor
   planning-gerelateerde autorisatie.

## Gevolg

- ADMIN-gebruikers krijgen weer de juiste badge en settings-toegang.
- Bestaande foutieve accounts herstellen automatisch bij een volgende login of sessie-refresh.
- Nieuwe gebruikers met een systeemrol blijven consistent tussen `role` en `roleId`.
