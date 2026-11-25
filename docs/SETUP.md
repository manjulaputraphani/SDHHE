# SETUP — install everything (do once per laptop)

## 1. Common (all OS)
- Node.js 20 LTS+ — nodejs.org
- Rust — rustup.rs (`rustup default stable`)
- Git — git-scm.com
- VS Code + extensions: Tauri, rust-analyzer, ESLint, Prettier, Tailwind CSS IntelliSense
- Ollama — ollama.com → then `ollama signin` (for cloud models)
- Accounts: GitHub, Neon (neon.com)

## 2. OS extras
- Windows: Visual Studio Build Tools → tick "Desktop development with C++". WebView2 (built into Win 11).
- macOS: `xcode-select --install`
- Ubuntu: `sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

## 3. Verify
`node -v` · `npm -v` · `rustc --version` · `cargo --version` · `git --version` · `ollama -v`

## 4. Model (Ollama Cloud)
- `ollama list` / check ollama.com for the exact tag of GLM 5.3 Flash (e.g. `glm-5.3-flash:cloud` — use what Ollama shows).
- For hard tasks (FIFO, T-4.5 replay, Tauri/Rust errors) switch to a stronger model (e.g. GLM-5.1 or Kimi K2.7 Code) for that task only.

## 5A. OpenCode with Ollama
- Install: see opencode.ai (e.g. `npm i -g opencode-ai`).
- Put `opencode.json` (in this kit) in the project root; set the model tag to the one from `ollama list`.
- Or use Ollama's launcher if your version has it: `ollama launch opencode`.
- OpenCode reads `AGENTS.md` automatically.

## 5B. Claude Code with Ollama
- Install: `npm i -g @anthropic-ai/claude-code`
- Ollama launcher (if available in your version): `ollama launch claude`
- Or manual (Ollama's Anthropic-compatible API):
  - macOS/Linux: `export ANTHROPIC_BASE_URL=http://localhost:11434` and `export ANTHROPIC_AUTH_TOKEN=ollama`
  - Windows PowerShell: `$env:ANTHROPIC_BASE_URL="http://localhost:11434"; $env:ANTHROPIC_AUTH_TOKEN="ollama"`
  - then `claude --model <glm tag>`
- Claude Code reads `CLAUDE.md` (which imports AGENTS.md).
- If these steps change, check docs.ollama.com → Integrations.

## 6. Neon
- New project "stock-tracker", region Asia Pacific (Singapore).
- Create branch `dev` for development/testing. `main` = your real data.
- Copy `dev` connection string into `.env` → `DATABASE_URL=...` (gitignored). Never paste it into AI chat.

## 7. Database migrations
- New tables/columns are in `drizzle/*.sql`; apply them with `npx drizzle-kit push` on the **dev branch**.
- 2026-11-24: the Green Coffee Pricing Calculator adds `pricing_calculations`
  (`drizzle/0021_pricing_calculations.sql`). Applying it is additive — it does not change existing tables.

## 8. Mobile app (React Native + Expo)
- `cd mobile && npm install`
- `npx tsc --noEmit` — typecheck (must be clean before an EAS update/build).
- `mobile/metro.config.js` watches `../src` so the native app imports the shared
  `src/logic/pricing.ts` instead of copying formulas.
- Pricing needs `@react-native-async-storage/async-storage` (offline saved quotes) and
  `expo-network` (online/offline sync); both are in `mobile/package.json`.
- Publish with `eas update` for JS-only changes, or `eas build` for a new APK/IPA.
