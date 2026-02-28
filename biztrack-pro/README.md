# BizTrack Pro — Android App

A full-featured mobile ERP for small businesses built with Capacitor + SQLite.

## Features

| Feature | Details |
|---------|---------|
| 📊 Dashboard | KPIs, alerts, low stock, recent sales |
| 🧾 Sales | New sale, credit tracking, payment status, customer history |
| 📦 Inventory | Add products, restock, low stock alerts, profit per unit |
| 💸 Expenses | Record expenses by category, supplier management |
| 📈 Reports | P&L engine with date filters, category breakdown |
| 📄 PDF Receipts | Generate receipts, share via WhatsApp or any app |
| 📊 Excel Export | Export all data to .xlsx (Google Sheets / Excel compatible) |
| 🗄️ SQLite Storage | All data stored on-device using CapacitorSQLite |
| 💱 Multi-currency | UGX, KES, USD, EUR, NGN, GHS, TZS, RWF |

---

## Build APK with GitHub Actions

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial BizTrack Pro commit"
git remote add origin https://github.com/YOUR_USERNAME/biztrack-pro.git
git push -u origin main
```

The workflow runs automatically on push to `main` or `develop`.

### 2. Manual trigger

Go to **Actions → Build BizTrack Pro APK → Run workflow** and choose `debug` or `release`.

### 3. Download the APK

After the workflow completes, go to the run page and download the APK from **Artifacts**.

---

## Release (Signed APK) Setup

For a signed release APK, add these **GitHub Secrets** in your repo settings:

| Secret | Description |
|--------|-------------|
| `KEYSTORE_BASE64` | Base64-encoded `.jks` keystore file |
| `KEY_ALIAS` | Key alias in the keystore |
| `KEY_PASSWORD` | Private key password |
| `STORE_PASSWORD` | Keystore store password |

### Generate a keystore

```bash
keytool -genkey -v \
  -keystore biztrack-release.jks \
  -alias biztrack \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

### Encode it to Base64

```bash
# macOS / Linux
base64 -i biztrack-release.jks | pbcopy   # copies to clipboard on macOS

# Windows
certutil -encode biztrack-release.jks keystore_b64.txt
```

Paste the output as the `KEYSTORE_BASE64` secret.

### Trigger a release build

Either push a tag:
```bash
git tag v3.0.0
git push origin v3.0.0
```

Or trigger manually selecting **release** build type.

---

## Local Development

```bash
npm install
npm run dev                 # Web preview
npm run build               # Build web assets
npx cap sync android        # Sync to Android project
npx cap open android        # Open in Android Studio
```

---

## Architecture

```
biztrack-pro/
├── index.html                    # Main SPA (all UI + wiring)
├── src/
│   └── utils/
│       ├── database.js           # SQLite service (all CRUD)
│       ├── pdfReceipt.js         # PDF receipt + P&L PDF generator
│       ├── excelExport.js        # Excel / Google Sheets exporter
│       └── plEngine.js           # Profit & Loss calculation engine
├── android/
│   ├── app/
│   │   ├── build.gradle          # App-level Gradle (signing config)
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       ├── java/...MainActivity.java
│   │       └── res/
│   ├── build.gradle              # Root Gradle
│   ├── settings.gradle           # Subprojects (Capacitor plugins)
│   └── variables.gradle          # SDK versions
├── .github/
│   └── workflows/
│       └── build-apk.yml         # CI/CD pipeline (debug + release APK)
├── capacitor.config.ts           # Capacitor configuration
├── package.json
└── vite.config.js
```

---

## Data Storage

All data is stored using **CapacitorSQLite** in a local SQLite database on the device.

| Table | Description |
|-------|-------------|
| `settings` | Business configuration |
| `inventory` | Products and stock levels |
| `sales` | All sales transactions |
| `expenses` | Business expenses |
| `suppliers` | Supplier directory |
| `customers` | Customer directory |
| `returns_log` | Return/refund records |

---

## Sharing & Export

- **PDF Receipts**: Generated with jsPDF, shared via Android Share sheet (WhatsApp, email, SMS, etc.)
- **Excel Export**: Generated with SheetJS (.xlsx), shared or saved to Documents folder
- **JSON Backup**: Full database backup/restore

---

## Install APK on Android

1. Go to **Settings → Security → Unknown Sources** (or "Install unknown apps")
2. Enable installation from your browser or Files app
3. Open the downloaded APK and tap Install
