/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'com.biztrackpro.app',
  appName: 'BizTrack Pro',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
      androidBiometric: {
        biometricAuth: false
      }
    }
  },
  android: {
    buildOptions: {
      releaseType: 'APK'
    }
  }
};

module.exports = config;
