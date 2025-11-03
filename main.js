const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// =======================================================================
// BẮT ĐẦU THAY ĐỔI (CORE IMPROVEMENT)
// =======================================================================
// Thay thế playwright gốc bằng playwright-extra và kích hoạt plugin stealth
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
// Sử dụng user-agents để tạo UA ngẫu nhiên, hiện đại
const UserAgent = require("user-agents");
// =======================================================================
// KẾT THÚC THAY ĐỔI
// =======================================================================

const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("hpagent");

let proxyStore;
const PROFILES_DIR = path.join(__dirname, "profiles");

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeProxyServerUrl(serverString) {
  const lowerCaseServerString = serverString.toLowerCase();
  if (
    lowerCaseServerString.startsWith("http://") ||
    lowerCaseServerString.startsWith("https://") ||
    lowerCaseServerString.startsWith("socks://") ||
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
      return {
        timezoneId: data.timezone,
        latitude: data.lat,
        longitude: data.lon,
        countryCode: data.countryCode,
        region: data.regionName,
        city: data.city,
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

// =======================================================================
// BẮT ĐẦU THAY ĐỔI (CORE IMPROVEMENT)
// Hàm tạo vân tay trình duyệt ngẫu nhiên và thực tế
// =======================================================================
function generateRealisticFingerprint() {
  // 1. User Agent
  const userAgentInstance = new UserAgent({
    platform: "Win32",
    deviceCategory: "desktop",
  });
  const userAgent = userAgentInstance.toString();
  let chromeVersion = "142";
  if (
    userAgentInstance.data.version &&
    typeof userAgentInstance.data.version === "string"
  ) {
    chromeVersion = userAgentInstance.data.version.split(".")[0];
  } else {
    console.warn(
      `Could not parse version from User Agent: "${userAgent}". Falling back to version "${chromeVersion}".`
    );
  }

  // 2. Màn hình
  const screenResolutions = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 2560, height: 1440 },
  ];
  const screen =
    screenResolutions[Math.floor(Math.random() * screenResolutions.length)];
  const availableHeight = screen.height - Math.floor(Math.random() * 50 + 70);
  const viewport = { width: screen.width, height: availableHeight };

  // 3. Phần cứng
  const hardwareConcurrency = [8, 12, 16][Math.floor(Math.random() * 3)];
  const webGLRenderers = [
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)`,
    },
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer: `ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)`,
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

  // 4. Ngôn ngữ
  const languageSets = [
    ["en-US", "en"],
    ["en-US", "en", "vi"],
    ["fr-FR", "fr", "en-US", "en"],
    ["de-DE", "de", "en-US", "en"],
  ];
  const languages =
    languageSets[Math.floor(Math.random() * languageSets.length)];
  const languagesString = JSON.stringify(languages);

  // 5. InitScripts
  const initScripts = [
    `(function() { /* ... WebGL script ... */ })();`,
    `(function() { /* ... Languages script ... */ })();`,
    `(function() { /* ... Platform script ... */ })();`,
    `/* ... HardwareConcurrency script ... */`,
    `(function() { /* ... Screen script ... */ })();`,
    `(function () { /* ... Webdriver script ... */ })();`,
  ].map((s) => s.replace(/\s+/g, " ")); // Minify scripts slightly

  // 6. Trả về đối tượng config hoàn chỉnh
  return {
    userAgent: userAgent,
    viewport: viewport,
    locale: languages[0],
    timezoneId: "America/Los_Angeles",
    // =======================================================================
    // SỬA LỖI Ở ĐÂY: Xóa hoàn toàn dòng "geolocation"
    // Khi key này không tồn tại, nó sẽ là `undefined` theo mặc định,
    // và Playwright sẽ bỏ qua nó một cách chính xác.
    // =======================================================================
    proxyName: null,
    acceptDownloads: true,
    chromiumArgs: [
      /* ... (giữ nguyên args của bạn) ... */
    ],
    initScripts: initScripts,
  };
}
// =======================================================================
// KẾT THÚC THAY ĐỔI
// =======================================================================

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Dòng này rất quan trọng, nó nạp file "cầu nối" của chúng ta
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true, // Giữ nguyên các thiết lập bảo mật này
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
    console.log("electron-store loaded successfully.");
  } catch (error) {
    console.error("Failed to load electron-store:", error);
    app.quit();
    return;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Xử lý IPC

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

// ========================================================================
// ĐÂY LÀ ĐOẠN MÃ BẠN ĐANG BỊ THIẾU - HÃY THÊM NÓ VÀO
// ========================================================================
ipcMain.handle("create-profile", async (event, profileName) => {
  if (!profileName || typeof profileName !== "string") {
    return { success: false, message: "Invalid profile name." };
  }
  const profilePath = path.join(PROFILES_DIR, profileName);
  const userDataDir = path.join(profilePath, "user-data");
  const configFile = path.join(profilePath, "config.json");

  if (fs.existsSync(profilePath)) {
    return {
      success: false,
      message: `Profile '${profileName}' already exists.`,
    };
  }

  try {
    fs.mkdirSync(profilePath);
    fs.mkdirSync(userDataDir);

    // Gọi hàm tạo fingerprint động đã viết trước đó
    const dynamicConfig = generateRealisticFingerprint();
    fs.writeFileSync(configFile, JSON.stringify(dynamicConfig, null, 2));

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

// ... Các hàm ipcMain khác (delete-profile, get-profile-config, update-profile-config, open-browser, và các hàm proxy) ...
// ... GIỮ NGUYÊN KHÔNG THAY ĐỔI ...
// ... Bạn có thể copy và paste toàn bộ phần còn lại của file main.js cũ vào đây ...
// ĐOẠN MÃ DƯỚI ĐÂY LÀ PHẦN CÒN LẠI ĐỂ BẠN TIỆN SAO CHÉP

ipcMain.handle("delete-profile", async (event, profileName) => {
  if (!profileName || typeof profileName !== "string") {
    return { success: false, message: "Invalid profile name." };
  }
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
      console.error("Error reading profile config:", error);
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
      console.error("Error updating profile config:", error);
      return { success: false, message: "Failed to update profile config." };
    }
  }
  return { success: false, message: "Profile config not found." };
});

ipcMain.handle(
  "open-browser",
  async (event, profileName, url = "https://bot.sannysoft.com/") => {
    if (!profileName || typeof profileName !== "string") {
      return { success: false, message: "Invalid profile name." };
    }
    const profilePath = path.join(PROFILES_DIR, profileName);
    const userDataDir = path.join(profilePath, "user-data");
    const configFile = path.join(profilePath, "config.json");

    if (!fs.existsSync(configFile)) {
      return {
        success: false,
        message: `Profile config file not found for '${profileName}'.`,
      };
    }

    let browserContext = null;
    try {
      const profileConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      let finalTimezoneId = profileConfig.timezoneId;
      let finalLocale = profileConfig.locale;
      let finalGeolocation = profileConfig.geolocation;
      let playwrightProxyConfig = undefined;

      if (profileConfig.proxyName) {
        if (!proxyStore) {
          return {
            success: false,
            message: "Proxy store not ready. Please restart the app.",
          };
        }
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
              accuracy: profileConfig.geolocation?.accuracy || 20,
            };
          }
        } else {
          console.warn(
            `Selected proxy '${profileConfig.proxyName}' not found. Using profile's default network settings.`
          );
        }
      }

      const existingArgs = profileConfig.chromiumArgs || [];
      const newArgs = [
        ...existingArgs,

        // Vô hiệu hóa hoàn toàn tính năng WebRTC để ngăn rò rỉ IP
        // Đây là cách giải quyết triệt để và đáng tin cậy nhất.
        "--disable-features=WebRTC",

        // Các tham số khác của bạn (nếu có)
        "--mute-audio", // Ví dụ: tắt tiếng
        "--disable-infobars", // Ví dụ: tắt thanh thông báo
      ];

      const launchOptions = {
        headless: false,
        args: newArgs,
        userAgent: profileConfig.userAgent || undefined,
        acceptDownloads: profileConfig.acceptDownloads,
        ignoreHTTPSErrors: true,
        bypassCSP: true,
        proxy: playwrightProxyConfig,
        timezoneId: finalTimezoneId,
        locale: finalLocale,
        geolocation: finalGeolocation,
        permissions: ["geolocation"],
        viewport: profileConfig.viewport, // Giờ nó sẽ đọc viewport động từ config
      };

      console.log(
        "Final Playwright Launch Options:",
        JSON.stringify(launchOptions, null, 2)
      );

      browserContext = await chromium.launchPersistentContext(
        userDataDir,
        launchOptions
      );

      const page = browserContext.pages().length
        ? browserContext.pages()[0]
        : await browserContext.newPage();

      const allInitScripts = profileConfig.initScripts || [];
      for (const script of allInitScripts) {
        await page.addInitScript(script);
      }

      await page.addInitScript((geoGranted) => {
        try {
          if (navigator.permissions && navigator.permissions.query) {
            const originalQuery = navigator.permissions.query;
            navigator.permissions.query = (params) => {
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
          }
        } catch (e) {
          console.warn("Error in final initScript stealth shim", e);
        }
      }, !!finalGeolocation);

      await page.goto(url);

      browserContext.on("close", () => {
        console.log(`Browser context for profile '${profileName}' closed.`);
      });
      return {
        success: true,
        message: `Browser for profile '${profileName}' opened.`,
      };
    } catch (error) {
      console.error("Error opening browser:", error);
      if (
        error.message &&
        error.message.includes("net::ERR_TUNNEL_CONNECTION_FAILED")
      ) {
        const detailedMessage = `Lỗi kết nối Proxy (ERR_TUNNEL_CONNECTION_FAILED). Vui lòng kiểm tra lại:\n1.  **Thông tin Proxy:** Địa chỉ IP, Port, Username, Password có chính xác không?\n2.  **Giao thức Proxy:** Nếu là SOCKS5, bạn đã điền 'socks5://' trước địa chỉ chưa? (Ví dụ: socks5://123.45.67.89:1080). Mặc định là HTTP.\n3.  **Proxy còn hoạt động:** Proxy có thể đã hết hạn hoặc đang ngoại tuyến.\n4.  **Tường lửa/Antivirus:** Phần mềm bảo mật có thể đang chặn kết nối đến proxy.`;
        return { success: false, message: detailedMessage };
      }
      if (browserContext) {
        await browserContext
          .close()
          .catch((e) =>
            console.error("Error closing browser context after failure:", e)
          );
      }
      return {
        success: false,
        message: `Failed to open browser: ${error.message}`,
      };
    }
  }
);

ipcMain.handle("get-proxies", async () => {
  if (!proxyStore) {
    console.error("proxyStore is not initialized. Cannot retrieve proxies.");
    return [];
  }
  return proxyStore.get("list", []);
});

ipcMain.handle("add-proxy", async (event, proxyConfig) => {
  if (!proxyStore) {
    return {
      success: false,
      message: "Proxy store not ready. Please restart the app.",
    };
  }
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
      proxyConfig.timezoneId = geoInfo.timezoneId;
      proxyConfig.latitude = geoInfo.latitude;
      proxyConfig.longitude = geoInfo.longitude;
      proxyConfig.locale = `${geoInfo.countryCode}-${geoInfo.region}`;
    }
  }
  proxies.push(proxyConfig);
  proxyStore.set("list", proxies);
  return { success: true, message: `Proxy '${proxyConfig.name}' added.` };
});

ipcMain.handle("update-proxy", async (event, oldName, newConfig) => {
  if (!proxyStore) {
    return {
      success: false,
      message: "Proxy store not ready. Please restart the app.",
    };
  }
  let proxies = proxyStore.get("list", []);
  const index = proxies.findIndex((p) => p.name === oldName);
  if (index === -1) {
    return { success: false, message: `Proxy '${oldName}' not found.` };
  }
  if (
    oldName !== newConfig.name &&
    proxies.some((p) => p.name === newConfig.name && p.name !== oldName)
  ) {
    return {
      success: false,
      message: `Proxy name '${newConfig.name}' already exists.`,
    };
  }
  const oldProxy = proxies[index];
  newConfig.server = normalizeProxyServerUrl(newConfig.server);
  const serverChanged = oldProxy.server !== newConfig.server;
  const ipMatch = newConfig.server.match(
    /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/
  );
  if (serverChanged && ipMatch && ipMatch[1]) {
    const geoInfo = await getGeoInfoFromIp(ipMatch[1]);
    if (geoInfo) {
      newConfig.timezoneId = geoInfo.timezoneId;
      newConfig.latitude = geoInfo.latitude;
      newConfig.longitude = geoInfo.longitude;
      newConfig.locale = `${geoInfo.countryCode}-${geoInfo.region}`;
    } else {
      delete newConfig.timezoneId;
      delete newConfig.latitude;
      delete newConfig.longitude;
      delete newConfig.locale;
    }
  } else if (serverChanged && (!ipMatch || !ipMatch[1])) {
    delete newConfig.timezoneId;
    delete newConfig.latitude;
    delete newConfig.longitude;
    delete newConfig.locale;
  }
  newConfig.timezoneId =
    newConfig.timezoneId !== undefined
      ? newConfig.timezoneId
      : oldProxy.timezoneId;
  newConfig.latitude =
    newConfig.latitude !== undefined ? newConfig.latitude : oldProxy.latitude;
  newConfig.longitude =
    newConfig.longitude !== undefined
      ? newConfig.longitude
      : oldProxy.longitude;
  newConfig.locale =
    newConfig.locale !== undefined ? newConfig.locale : oldProxy.locale;
  proxies[index] = { ...oldProxy, ...newConfig };
  proxyStore.set("list", proxies);
  return { success: true, message: `Proxy '${newConfig.name}' updated.` };
});

ipcMain.handle("delete-proxy", async (event, proxyName) => {
  if (!proxyStore) {
    return {
      success: false,
      message: "Proxy store not ready. Please restart the app.",
    };
  }
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
