const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// Sử dụng playwright-extra và plugin stealth để tăng cường khả năng ẩn mình
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);

// Thư viện để tạo User-Agent ngẫu nhiên và thực tế
const UserAgent = require("user-agents");

const fetch = require("node-fetch");

let proxyStore;
const PROFILES_DIR = path.join(__dirname, "profiles");

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeProxyServerUrl(serverString) {
  if (!serverString) return "";
  const lowerCaseServerString = serverString.toLowerCase();
  if (
    lowerCaseServerString.startsWith("http://") ||
    lowerCaseServerString.startsWith("https://") ||
    lowerCaseServerString.startsWith("socks5://")
  ) {
    return serverString;
  }
  return `http://${serverString}`;
}

async function getGeoInfoFromIp(ip) {
  try {
    const response = await fetch(`http://ip-api.com/json/${ip}`);
    const data = await response.json();
    if (data.status === "success" && data.timezone) {
      const langCode = data.countryCode.toLowerCase();
      const locale = `${langCode}-${data.countryCode}`; // vd: en-US, vi-VN
      return {
        timezoneId: data.timezone,
        latitude: data.lat,
        longitude: data.lon,
        countryCode: data.countryCode,
        locale: locale,
      };
    } else {
      console.warn(
        `Could not get geo info for IP ${ip}:`,
        data.message || "Unknown error"
      );
      return null;
    }
  } catch (error) {
    console.error(`Failed to fetch geo info for IP ${ip}:`, error);
    return null;
  }
}

/**
 * Hàm tạo vân tay trình duyệt ngẫu nhiên, thực tế và NHẤT QUÁN.
 */
function generateRealisticFingerprint() {
  const userAgentInstance = new UserAgent({
    platform: "Win32",
    deviceCategory: "desktop",
  });
  const userAgent = userAgentInstance.toString();

  const screenResolutions = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 2560, height: 1440 },
  ];
  const screen =
    screenResolutions[Math.floor(Math.random() * screenResolutions.length)];
  const availableHeight = screen.height - Math.floor(Math.random() * 60 + 40);
  const viewport = { width: screen.width, height: availableHeight };

  const hardwareConcurrency = [8, 12, 16][Math.floor(Math.random() * 3)];
  const webGLRenderers = [
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)`,
    },
    {
      vendor: "Google Inc. (Intel)",
      renderer: `ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)`,
    },
    {
      vendor: "Google Inc. (AMD)",
      renderer: `ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)`,
    },
  ];
  const webgl =
    webGLRenderers[Math.floor(Math.random() * webGLRenderers.length)];

  const languageSets = [
    ["en-US", "en"],
    ["fr-FR", "fr", "en-US", "en"],
    ["de-DE", "de", "en-US", "en"],
  ];
  const languages =
    languageSets[Math.floor(Math.random() * languageSets.length)];
  const locale = languages[0];

  const initScript = `
    (function() {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return '${webgl.vendor}';
        if (parameter === 37446) return '${webgl.renderer}';
        return getParameter.apply(this, arguments);
      };
      Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(
        languages
      )} });
      Object.defineProperty(navigator, 'language', { get: () => '${locale}' });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${hardwareConcurrency} });
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      delete navigator.__proto__.webdriver;
    })();
  `;

  return {
    userAgent,
    viewport,
    locale,
    timezoneId: "America/Los_Angeles",
    chromiumArgs: [],
    initScript: initScript.replace(/\s+/g, " ").trim(),
  };
}

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("index.html");
}

app.whenReady().then(async () => {
  ensureDirectory(PROFILES_DIR);
  createWindow();
  try {
    const StoreModule = await import("electron-store");
    proxyStore = new StoreModule.default({ name: "proxies" });
  } catch (error) {
    console.error("Failed to load electron-store:", error);
    app.quit();
    return;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ========================================================================
// IPC Handlers
// ========================================================================

ipcMain.handle("get-profiles", async () => {
  ensureDirectory(PROFILES_DIR);
  try {
    const profileNames = fs
      .readdirSync(PROFILES_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
    return profileNames.map((name) => ({ name }));
  } catch (error) {
    console.error("Error getting profiles:", error);
    return [];
  }
});

ipcMain.handle("create-profile", async (event, profileName) => {
  if (!profileName || typeof profileName !== "string") {
    return { success: false, message: "Invalid profile name." };
  }
  const profilePath = path.join(PROFILES_DIR, profileName);
  if (fs.existsSync(profilePath)) {
    return {
      success: false,
      message: `Profile '${profileName}' already exists.`,
    };
  }
  try {
    fs.mkdirSync(profilePath, { recursive: true });
    const dynamicConfig = generateRealisticFingerprint();
    fs.writeFileSync(
      path.join(profilePath, "config.json"),
      JSON.stringify(dynamicConfig, null, 2)
    );
    fs.mkdirSync(path.join(profilePath, "user-data"));
    return {
      success: true,
      message: `Profile '${profileName}' created successfully.`,
    };
  } catch (error) {
    console.error("Error creating profile:", error);
    return {
      success: false,
      message: `Failed to create profile: ${error.message}`,
    };
  }
});

ipcMain.handle("delete-profile", async (event, profileName) => {
  if (!profileName) return { success: false, message: "Invalid profile name." };
  const profilePath = path.join(PROFILES_DIR, profileName);
  if (!fs.existsSync(profilePath)) {
    return {
      success: false,
      message: `Profile '${profileName}' does not exist.`,
    };
  }
  try {
    fs.rmSync(profilePath, { recursive: true, force: true });
    return {
      success: true,
      message: `Profile '${profileName}' deleted successfully.`,
    };
  } catch (error) {
    console.error("Error deleting profile:", error);
    return {
      success: false,
      message: `Failed to delete profile: ${error.message}`,
    };
  }
});

ipcMain.handle("get-profile-config", async (event, profileName) => {
  const configFile = path.join(PROFILES_DIR, profileName, "config.json");
  if (fs.existsSync(configFile)) {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      return { success: true, config };
    } catch (error) {
      return { success: false, message: "Failed to read profile config." };
    }
  }
  return { success: false, message: "Profile config not found." };
});

ipcMain.handle("update-profile-config", async (event, profileName, config) => {
  const configFile = path.join(PROFILES_DIR, profileName, "config.json");
  if (fs.existsSync(configFile)) {
    try {
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
      return { success: true, message: "Profile config updated successfully." };
    } catch (error) {
      return { success: false, message: "Failed to update profile config." };
    }
  }
  return { success: false, message: "Profile config not found." };
});

ipcMain.handle(
  "open-browser",
  async (event, profileName, url = "https://pixelscan.net/") => {
    const profilePath = path.join(PROFILES_DIR, profileName);
    const userDataDir = path.join(profilePath, "user-data");
    const configFile = path.join(profilePath, "config.json");

    if (!fs.existsSync(configFile)) {
      return {
        success: false,
        message: `Config not found for '${profileName}'.`,
      };
    }

    let browserContext = null;
    try {
      const profileConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));

      let finalTimezoneId = profileConfig.timezoneId;
      let finalLocale = profileConfig.locale;
      let finalGeolocation = undefined;
      let playwrightProxyConfig = undefined;

      if (profileConfig.proxyName) {
        const allProxies = proxyStore.get("list", []);
        const selectedProxy = allProxies.find(
          (p) => p.name === profileConfig.proxyName
        );
        if (selectedProxy) {
          playwrightProxyConfig = {
            server: selectedProxy.server,
            username: selectedProxy.username,
            password: selectedProxy.password,
          };
          if (selectedProxy.timezoneId)
            finalTimezoneId = selectedProxy.timezoneId;
          if (selectedProxy.locale) finalLocale = selectedProxy.locale;
          if (
            selectedProxy.latitude !== undefined &&
            selectedProxy.longitude !== undefined
          ) {
            finalGeolocation = {
              latitude: selectedProxy.latitude,
              longitude: selectedProxy.longitude,
              accuracy: Math.floor(Math.random() * 30 + 10),
            };
          }
        }
      }

      const existingArgs = profileConfig.chromiumArgs || [];
      const newArgs = [
        ...new Set([
          ...existingArgs,
          "--disable-features=WebRTC",
          "--disable-blink-features=AutomationControlled",
          "--mute-audio",
          "--no-first-run",
          "--no-default-browser-check",
        ]),
      ];

      const launchOptions = {
        headless: false,
        args: newArgs,
        userAgent: profileConfig.userAgent,
        acceptDownloads: true,
        ignoreHTTPSErrors: true,
        proxy: playwrightProxyConfig,
        timezoneId: finalTimezoneId,
        locale: finalLocale,
        geolocation: finalGeolocation,
        permissions: ["geolocation"],
        viewport: profileConfig.viewport,
      };

      console.log(
        "Final Launch Options:",
        JSON.stringify(launchOptions, null, 2)
      );

      browserContext = await chromium.launchPersistentContext(
        userDataDir,
        launchOptions
      );
      const page = browserContext.pages().length
        ? browserContext.pages()[0]
        : await browserContext.newPage();

      if (profileConfig.initScript) {
        await page.addInitScript(profileConfig.initScript);
      }

      await page.addInitScript((geoGranted) => {
        if (navigator.permissions && navigator.permissions.query) {
          const originalQuery = navigator.permissions.query;
          const newQuery = (params) => {
            if (
              params &&
              (params.name === "notifications" ||
                params.name === "camera" ||
                params.name === "microphone")
            ) {
              return Promise.resolve({ state: "prompt", onchange: null });
            }
            if (params && params.name === "geolocation") {
              return Promise.resolve({
                state: geoGranted ? "granted" : "prompt",
                onchange: null,
              });
            }
            return originalQuery.call(navigator.permissions, params);
          };
          navigator.permissions.query = newQuery;
        }
      }, !!finalGeolocation);

      await page.goto(url);

      browserContext.on("close", () => {
        console.log(`Browser context for profile '${profileName}' closed.`);
      });
      return { success: true, message: `Browser for '${profileName}' opened.` };
    } catch (error) {
      console.error("Error opening browser:", error);
      if (browserContext) {
        await browserContext
          .close()
          .catch((e) => console.error("Error closing context on failure:", e));
      }
      return {
        success: false,
        message: `Failed to open browser: ${error.message}`,
      };
    }
  }
);

// Proxy Management
ipcMain.handle("get-proxies", async () => {
  if (!proxyStore) return [];
  return proxyStore.get("list", []);
});

ipcMain.handle("add-proxy", async (event, proxyConfig) => {
  if (!proxyStore) return { success: false, message: "Proxy store not ready." };
  let proxies = proxyStore.get("list", []);
  if (!proxyConfig || !proxyConfig.name || !proxyConfig.server) {
    return { success: false, message: "Invalid proxy configuration." };
  }
  if (proxies.some((p) => p.name === proxyConfig.name)) {
    return {
      success: false,
      message: `Proxy '${proxyConfig.name}' already exists.`,
    };
  }
  proxyConfig.server = normalizeProxyServerUrl(proxyConfig.server);
  const ipMatch = proxyConfig.server.match(
    /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/
  );
  if (ipMatch && ipMatch[1]) {
    const geoInfo = await getGeoInfoFromIp(ipMatch[1]);
    if (geoInfo) {
      proxyConfig = { ...proxyConfig, ...geoInfo };
    }
  }
  proxies.push(proxyConfig);
  proxyStore.set("list", proxies);
  return { success: true, message: `Proxy '${proxyConfig.name}' added.` };
});

ipcMain.handle("update-proxy", async (event, oldName, newConfig) => {
  if (!proxyStore) return { success: false, message: "Proxy store not ready." };
  let proxies = proxyStore.get("list", []);
  const index = proxies.findIndex((p) => p.name === oldName);
  if (index === -1) {
    return { success: false, message: `Proxy '${oldName}' not found.` };
  }
  if (
    oldName !== newConfig.name &&
    proxies.some((p) => p.name === newConfig.name)
  ) {
    return {
      success: false,
      message: `Proxy name '${newConfig.name}' already exists.`,
    };
  }

  newConfig.server = normalizeProxyServerUrl(newConfig.server);
  const oldProxy = proxies[index];
  const serverChanged = oldProxy.server !== newConfig.server;

  if (serverChanged) {
    const ipMatch = newConfig.server.match(
      /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/
    );
    if (ipMatch && ipMatch[1]) {
      const geoInfo = await getGeoInfoFromIp(ipMatch[1]);
      if (geoInfo) {
        newConfig = { ...newConfig, ...geoInfo };
      }
    } else {
      // Clear geo info if server is no longer an IP
      delete newConfig.timezoneId;
      delete newConfig.latitude;
      delete newConfig.longitude;
      delete newConfig.locale;
    }
  }

  proxies[index] = { ...oldProxy, ...newConfig };
  proxyStore.set("list", proxies);
  return { success: true, message: `Proxy '${newConfig.name}' updated.` };
});

ipcMain.handle("delete-proxy", async (event, proxyName) => {
  if (!proxyStore) return { success: false, message: "Proxy store not ready." };
  let proxies = proxyStore.get("list", []);
  const initialLength = proxies.length;
  proxies = proxies.filter((p) => p.name !== proxyName);
  if (proxies.length < initialLength) {
    proxyStore.set("list", proxies);
    return { success: true, message: `Proxy '${proxyName}' deleted.` };
  } else {
    return { success: false, message: `Proxy '${proxyName}' not found.` };
  }
});
