// electron-builder configuration.
//
// The base config lives in the package.json "build" field; this wrapper only turns
// macOS notarization on when the full Apple credential set is in the environment.
// electron-builder 26 takes `notarize` as a boolean and reads APPLE_ID,
// APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID itself (CI secrets, see
// .github/workflows/release.yml). Local builds without them still succeed unsigned.
const { build } = require('./package.json');

const hasAppleCreds = Boolean(
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
);

module.exports = {
  ...build,
  mac: {
    ...build.mac,
    notarize: hasAppleCreds,
  },
};
