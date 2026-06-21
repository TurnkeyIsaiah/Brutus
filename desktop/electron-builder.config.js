// electron-builder configuration.
//
// The base config lives in the package.json "build" field; this wrapper only adds
// macOS notarization, which needs the Apple Team ID passed explicitly. On this
// electron-builder version, `notarize: true` does not read APPLE_TEAM_ID from the
// environment, so notarytool fails with "teamId property is required". Here we read
// it from the env (CI secrets) and enable notarization only when full Apple
// credentials are present — local/dev builds without them still succeed unsigned.
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
    notarize: hasAppleCreds ? { teamId: process.env.APPLE_TEAM_ID } : false,
  },
};
