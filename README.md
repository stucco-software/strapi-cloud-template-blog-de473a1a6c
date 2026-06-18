# AREAA Strapi CMS

Headless CMS (Strapi v5) powering the AREAA website — chapters, microsite pages,
events, partners, members, and global site settings. The Astro frontend
(`../areaa-frontend`) fetches content from this app's REST API.

## Local Development

**Prerequisites:** Node 20–24, npm, and `openssl` (preinstalled on macOS/Linux).

```bash
make setup   # one-time: npm install + generate .env with fresh secrets
make seed    # populate sample content + grant Public read permissions
make dev     # serve admin + REST API at http://localhost:1337
```

Run `make seed` while `make dev` is **stopped** — both open the same SQLite file.
On the first `make dev`, create your admin account at <http://localhost:1337/admin>.

`make help` lists every target:

| Target | Description |
|--------|-------------|
| `make setup` | Install deps + generate `.env` (idempotent) |
| `make env`   | Generate `.env` with fresh secrets (no-op if it exists) |
| `make seed`  | Seed sample content + Public read permissions (idempotent) |
| `make fresh` | Wipe the SQLite DB and re-seed from scratch |
| `make dev`   | Start Strapi in develop mode |
| `make clean` | Remove the local SQLite DB |

The dev database is **SQLite** (`.tmp/data.db`) — no external DB required. The seed
grants the **Public** role read access so the token-less SSR frontend can fetch
content; without it the REST API returns `403`.

---

# 🚀 Strapi CLI reference

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>
