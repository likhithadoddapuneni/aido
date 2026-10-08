/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Whole-repo runs load every package's tests at once; a generous ceiling keeps CPU contention from looking like a failure.
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  // Workspace packages are TypeScript source reached through pnpm symlinks, so they must be transformed.
  // Only real third-party code (inside node_modules, not our own scope) is skipped.
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-safe-area-context))',
  ],
};
