// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const baseConfig = require('./.config/jest.config');
const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...baseConfig,
  // Grafana UI pulls marked as an ESM-only dependency in current releases.
  // Keep the scaffolded list and add marked at the project level instead of editing .config directly.
  transformIgnorePatterns: [
    nodeModulesToTransform([
      ...grafanaESModules,
      'marked',
      'react-calendar',
      'get-user-locale',
      'memoize',
      'mimic-function',
      '@wojtekmaj/date-utils',
    ]),
  ],
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    '^monaco-editor$': '<rootDir>/.config/jest/mocks/monaco-editor.js',
    '^monaco-editor/(.*)$': '<rootDir>/.config/jest/mocks/monaco-editor.js',
    '^@monaco-editor/react$': '<rootDir>/.config/jest/mocks/monaco-react.js',
  },
};
