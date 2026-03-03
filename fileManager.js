// src/utils/fileManager.js — BizTrack Pro v4.2
// Native file save + share for Android.
//
// Strategy (Android Scoped Storage compatible):
//   1. Write to Directory.Cache (always writable, no permissions needed on any API level)
//   2. Open Android share sheet via Share plugin
//      → user picks: WhatsApp, Gmail, Google Drive, Files, Bluetooth, etc.
//
// This avoids ALL storage permission issues on Android 10+ (API 29+).
// Directory.External and Directory.Documents with write can fail on API 30+ due to
// scoped storage enforcement. Cache is always safe.

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

/**
 * Save a base64-encoded file to cache and open the Android share sheet.
 * On web (browser), triggers a normal download instead.
 *
 * @param {string} filename    - e.g. 'biztrack_backup_2026-01-01.json'
 * @param {string} base64data  - base64-encoded file bytes (NO data URI prefix)
 * @param {string} mimeType    - MIME type string
 * @param {string} shareTitle  - Title for share sheet
 * @param {string} shareText   - Body text for share sheet
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
export async function saveAndShare(filename, base64data, mimeType, shareTitle, shareText) {
  // ── Browser / web preview fallback ───────────────────────────────────────
  if (!Capacitor.isNativePlatform()) {
    try {
      const byteChars   = atob(base64data);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { success: true, path: filename };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Android native ─────────────────────────────────────────────────────────
  // Step 1: write to Cache (safe on ALL Android versions, no permission needed)
  let fileUri;
  try {
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64data,          // raw base64 — Capacitor decodes it to binary automatically
      directory: Directory.Cache // NOT Directory.External — that needs permissions on API < 29
      // DO NOT pass encoding here — omitting encoding = binary/base64 mode (correct for PDF/XLSX/JSON)
    });
    fileUri = result.uri;
  } catch (writeErr) {
    console.error('File write failed:', writeErr);
    return { success: false, error: 'Could not write file: ' + writeErr.message };
  }

  // Step 2: share via Android share sheet
  try {
    await Share.share({
      title:       shareTitle  || 'BizTrack Pro — Export',
      text:        shareText   || filename,
      url:         fileUri,
      dialogTitle: shareTitle  || 'Save or share file'
    });
    return { success: true, path: fileUri };
  } catch (shareErr) {
    // Share cancelled or failed — file is still saved, tell user where it is
    console.warn('Share cancelled or failed:', shareErr);
    return {
      success: true,
      path: fileUri,
      note: 'Share cancelled. File saved to app cache: ' + fileUri
    };
  }
}

/**
 * Save a UTF-8 JSON string as a .json file and share it.
 * Handles the UTF-8 → base64 conversion correctly (supports non-ASCII chars).
 */
export async function saveJsonFile(filename, jsonString, shareTitle) {
  // Correct UTF-8 → base64 that handles Unicode characters
  const base64 = btoa(encodeURIComponent(jsonString).replace(/%([0-9A-F]{2})/g,
    (_, p1) => String.fromCharCode(parseInt(p1, 16))));
  return saveAndShare(
    filename,
    base64,
    'application/json',
    shareTitle || 'BizTrack Pro Backup',
    `BizTrack Pro backup file: ${filename}`
  );
}

/**
 * Check if native file sharing is available on this device.
 */
export async function canShare() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await Share.canShare();
    return result.value;
  } catch {
    return true; // assume yes if we can't check
  }
}
