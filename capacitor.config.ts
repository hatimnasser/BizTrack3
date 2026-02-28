import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.biztrackpro.app',
  appName: 'BizTrack Pro',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      iosKeychainPrefix: 'biztrack',
      iosBiometric: {
        biometricAuth: false
      },
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

export default config;
