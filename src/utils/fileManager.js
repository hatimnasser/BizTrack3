// src/utils/fileManager.js
// BizTrack Pro - Native File Manager
// Handles saving files to Android storage and sharing them
// Works for: JSON backup, Excel exports, PDF reports

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

/**
 * Save a file to device Documents folder and open the share sheet.
 * On web, triggers a browser download instead.
 *
 * @param {string} filename    - e.g. 'biztrack_backup_2026-01-01.json'
 * @param {string} base64data  - base64 encoded file content
 * @param {string} mimeType    - e.g. 'application/json', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
 * @param {string} shareTitle  - Title shown in Android share sheet
 * @param {string} shareText   - Body text in share sheet
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
export async function saveAndShare(filename, base64data, mimeType, shareTitle, shareText) {
  if (!Capacitor.isNativePlatform()) {
    // Web fallback — browser download
    try {
      const byteChars = atob(base64data);
      const byteNumbers = Array.from(byteChars, c => c.charCodeAt(0));
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true, path: filename };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  try {
    // Save to Documents directory (visible in Files app)
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64data,
      directory: Directory.Documents,
      recursive: true
    });

    // Open Android share sheet — user can choose WhatsApp, Gmail, Drive, Files, etc.
    await Share.share({
      title: shareTitle,
      text: shareText,
      url: result.uri,
      dialogTitle: shareTitle
    });

    return { success: true, path: result.uri };
  } catch (err) {
    // If share fails, try just saving and notify user of path
    console.error('Share failed:', err);
    try {
      const saved = await Filesystem.writeFile({
        path: filename,
        data: base64data,
        directory: Directory.Documents,
        recursive: true
      });
      return { success: true, path: saved.uri };
    } catch (saveErr) {
      return { success: false, error: saveErr.message };
    }
  }
}

/**
 * Save JSON string to file
 */
export async function saveJsonFile(filename, jsonString, shareTitle) {
  // Convert string to base64
  const base64 = btoa(unescape(encodeURIComponent(jsonString)));
  return saveAndShare(
    filename,
    base64,
    'application/json',
    shareTitle || 'BizTrack Pro Backup',
    `Your BizTrack Pro backup: ${filename}`
  );
}

/**
 * Get a human-readable file path for display to user
 */
export async function getDocumentsPath() {
  try {
    const result = await Filesystem.getUri({
      path: '',
      directory: Directory.Documents
    });
    return result.uri;
  } catch {
    return 'Documents folder';
  }
}

/**
 * Request storage permissions (Android)
 */
export async function requestStoragePermission() {
  try {
    const { Permissions } = await import('@capacitor/core');
    // Capacitor handles permissions automatically on writeFile
    return true;
  } catch {
    return true;
  }
}
