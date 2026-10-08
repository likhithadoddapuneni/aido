const { getDefaultConfig } = require('expo/metro-config');

// Expo's default config already watches the workspace root and resolves pnpm's symlinked packages.
// Nothing is overridden here until a measured need appears; see docs/mobile.md.
module.exports = getDefaultConfig(__dirname);
