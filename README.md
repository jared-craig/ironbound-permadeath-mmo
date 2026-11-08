# Ironbound: Permadeath Chronicles

**Hardcore Mobile-First Quest MMO with Irreversible Permadeath & Fallen Heroes Graveyard**

## Features

- **3 Playable Classes**: Iron Vanguard (`warrior`), Shadow Strider (`ranger`), and Ember Arcanist (`mage`) with 9 active skills and 3 talent trees (`vitality`, `might`, `swiftness`).
- **5 Distinct Zones**: Sunhaven Sanctuary (`safe_haven`), Whispering Woods (`whispering_woods`), Cursed Ruins of Morhollow (`cursed_ruins`), Molten Caverns (`molten_caverns`), and Dragon's Peak Summit (`dragons_peak`).
- **8-Quest Campaign**: Full progression chain across `EXPLORE`, `KILL`, `COLLECT`, and `BOSS` quests up to Ignis the World-Breaker.
- **Deterministic Turn-Based Combat & Irreversible Permadeath**: Armor mitigation (`100 / (100 + DEF * 3)`), 3rd-round heavy boss telegraphs (`1.8x`), health potion cooldowns, flee mechanics, Fallen Heroes Graveyard with custom epitaphs, and generational reincarnation (`Gen II+`).
- **Zero-Dependency Node.js Runtime**: Built-in `node:http`, `node:sqlite` (`DatabaseSync` in WAL mode), and RFC 6455 WebSocket server (`ws.js`) with mobile-first 2D HTML5 Canvas UI (`public/`).

## Quick Start

Requires **Node.js 22.5+** (built-in `node:sqlite`).

```bash
# Start the server (defaults to PORT=3000)
npm start

# Run unit & API integration tests
npm test

# Run 5-tier end-to-end test suite
npm run test:e2e
```
