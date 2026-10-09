# Nikki subscription updates

This fork can enable the existing Nikki CGI bridge independently for each Clash/Mihomo backend. It does not install the bridge, change Nikki configuration, or extend dae capabilities.

## Configure a backend

Open **Manage backends → Edit backend**, or **Add backend**, and enable **Enable Nikki subscription updates**.

- **CGI path:** defaults to `/cgi-bin/nikki-refresh`.
- **Bridge origin:** optional, for example `http://router.example:8080` or `https://router.example:8443`. Leave it empty to use the backend protocol and hostname with the Web server's default port (HTTP 80 / HTTPS 443). The controller port and secondary path are never used for the CGI address.
- Check the displayed **Request URL**, then save.

The backend record contains:

```json
{
  "nikkiIntegration": {
    "enabled": true,
    "refreshPath": "/cgi-bin/nikki-refresh",
    "bridgeOrigin": "https://router.example:8443"
  }
}
```

`bridgeOrigin` can be omitted. An absent configuration is disabled. Existing backends must be enabled explicitly after upgrading; there is no IP-based migration or device whitelist. URL-based backend initialization also remains disabled by default.

Configure each device separately. Switching the active backend immediately changes whether **Update Subscription** is available. New devices do not require a code change.

## URL and security boundaries

- IPv4, domain names, bracketed and unbracketed IPv6 backend hosts are supported. The host field must not contain a port or path.
- `refreshPath` is a literal path beginning with one `/`; only letters, digits, `/`, `_`, `.`, `~` and `-` are accepted. Full URLs, `//` authorities, backslashes, percent escapes, query strings, fragments and `.` / `..` segments are rejected.
- An explicit bridge origin may change the protocol or port, but **must use the same hostname as the controller**. A different hostname, even if it resolves to the same device, is rejected. Use a matching hostname/reverse proxy for both services if necessary.
- The request retains the existing CGI protocol: `POST` with the controller secret as the raw body; a successful HTTP response must contain JSON `{"success":true}`. It does not send cookies or a referrer, and refuses redirects.
- HTTP sends that secret without encryption. The form warns about this; use it only on a trusted device/network and prefer HTTPS. An HTTPS dashboard cannot use an HTTP bridge: the form and API block mixed content before sending the secret.
- Same-host validation is not proof that a port/service or DNS record is trustworthy. You must trust the explicitly selected Web service. The bridge must independently authenticate the request and provide appropriate CORS responses. No browser CORS workaround is included.
- A successful action still schedules the existing configuration/rules/proxies refresh after 3000 ms and uses `ArrowsUpDownIcon`.

## Persistence and settings backups

Integration configuration is stored inside each backend in the existing `setup/api-list` localStorage record. Editing uses an independent copy, so cancel does not modify the saved configuration.

The normal **Dashboard settings → Export settings to file** flow includes a `config/nikki-integrations` snapshot containing integration fields and controller identity, **not passwords or tokens**. File import, URL import and existing settings synchronization can restore it onto already configured matching backends. Matching uses UUID plus controller identity, or a unique controller identity when the UUID differs. Unknown devices are ignored and ambiguous matches are rejected. The snapshot does not create backends or restore their credentials: add them separately when moving to a new browser.

## Verification

```sh
node --test test/nikki.mjs
pnpm build
CHROME_BIN=/path/to/chrome node test/nikki-ui.mjs
CHROME_BIN=/path/to/chrome pnpm test:verify
```

The unit tests exercise the real TypeScript helpers/API with mocked fetch. Browser checks reuse this project's CDP/Chrome harness and local mock controller, covering configuration, saving, cancel, reopening, backend switching and normal settings-file export/import. They do not contact production Nikki devices or prove a new device's real CGI deployment.
