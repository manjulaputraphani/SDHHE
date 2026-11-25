// The pricing screen imports the SAME pure module the web app and Worker use
// (`../src/logic/pricing.ts`). Metro must watch that folder because it sits
// outside the Expo project root.
//
// Do NOT add the parent repo's node_modules here: this project is nested in
// the web repo, which has its own (slightly different) React copy. The shared
// pricing module has no imports, so only its source folder is needed.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(projectRoot, "../src"),
];

module.exports = config;
