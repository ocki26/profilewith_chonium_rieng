const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const UserAgent = require("user-agents");
const fetch = require("node-fetch");

// Áp dụng stealth plugin cho chromium
chromium.use(stealth);

// Đường dẫn đến thư mục profiles và file proxies
const PROFILES_DIR = path.join(__dirname, "profiles");
const PROXIES_FILE = path.join(__dirname, "proxies.json");

// Hàm tạo thư mục profile nếu chưa có
function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Hàm đọc cấu hình proxy
function readProxies() {
  ensureDirectory(path.dirname(PROXIES_FILE));
  if (fs.existsSync(PROXIES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROXIES_FILE, "utf-8"));
    } catch (error) {
      console.error("Error reading proxies.json:", error);
      return [];
    }
  }
  return [];
}

// Hàm ghi cấu hình proxy
function writeProxies(proxies) {
  ensureDirectory(path.dirname(PROXIES_FILE));
  fs.writeFileSync(PROXIES_FILE, JSON.stringify(proxies, null, 2));
}

// Lấy múi giờ từ IP bằng Geolocation API
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

// Tạo cửa sổ chính của Electron
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

app.whenReady().then(() => {
  ensureDirectory(PROFILES_DIR);
  createWindow();

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

// ====================================================================
// Xử lý IPC (Inter-Process Communication) từ Renderer Process
// ====================================================================

// Lấy danh sách profiles hiện có
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

// Tạo một profile mới
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

    const userAgent = new UserAgent({ deviceCategory: "desktop" }).toString();

    // Ghi cấu hình mặc định ban đầu
    const defaultConfig = {
      userAgent: userAgent,
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
      timezoneId: "America/New_York",
      geolocation: {
        latitude: 34.052235,
        longitude: -118.243683,
        accuracy: 20,
      },
      proxyName: null,
      acceptDownloads: true,
      chromiumArgs: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--use-fake-location",
        "--hide-scrollbars",
        "--mute-audio",
      ],
      initScripts: [
        `Object.defineProperty(navigator, 'webdriver', { get: () => false });`,
        `
        (function() {
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
              value: function() {
                  const context = this.getContext('2d');
                  if (context) {
                      const imageData = context.getImageData(0, 0, 1, 1);
                      const data = imageData.data;
                      data[0] = (data[0] + Math.floor(Math.random() * 5)) % 256;
                      data[1] = (data[1] + Math.floor(Math.random() * 5)) % 256;
                      data[2] = (data[2] + Math.floor(Math.random() * 5)) % 256;
                      context.putImageData(imageData, 0, 0);
                  }
                  return originalToDataURL.apply(this, arguments);
              },
              writable: true,
              configurable: true
          });
        })();
        `,
        `
        (function() {
          if (window.AudioContext) {
              const originalGetChannelData = AudioBuffer.prototype.getChannelData;
              Object.defineProperty(AudioBuffer.prototype, 'getChannelData', {
                  value: function() {
                      const result = originalGetChannelData.apply(this, arguments);
                      if (result.length > 0) {
                          result[0] = result[0] + Math.random() * 0.000000001;
                      }
                      return result;
                  },
                  writable: true,
                  configurable: true
              });
          }
        })();
        `,
      ],
    };
    fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2));

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

// Xóa một profile
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

// Lấy thông tin cấu hình của một profile
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

// Cập nhật thông tin cấu hình của một profile
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

// Mở một trình duyệt mới với profile đã chọn - ĐÃ SỬA TẤT CẢ LỖI
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
      let finalProxyConfig = null;
      let finalTimezoneId = profileConfig.timezoneId;
      let finalLocale = profileConfig.locale;
      let finalGeolocation = profileConfig.geolocation;

      // Nếu có proxyName được chọn trong profile, hãy tìm proxy đó
      if (profileConfig.proxyName) {
        const allProxies = readProxies();
        const selectedProxy = allProxies.find(
          (p) => p.name === profileConfig.proxyName
        );
        if (selectedProxy) {
          finalProxyConfig = {
            server: selectedProxy.server,
            username: selectedProxy.username || undefined,
            password: selectedProxy.password || undefined,
          };
          // Cập nhật múi giờ, locale VÀ GEOLOCATION từ proxy nếu có
          if (selectedProxy.timezoneId) {
            finalTimezoneId = selectedProxy.timezoneId;
          }
          if (selectedProxy.locale) {
            finalLocale = selectedProxy.locale;
          }
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

      // Tạo args array và thêm timezone/locale nếu có
      const args = [...(profileConfig.chromiumArgs || [])];

      // Thêm timezone và locale vào Chromium arguments
      if (finalTimezoneId) {
        args.push(`--timezone=${finalTimezoneId}`);
      }
      if (finalLocale) {
        args.push(`--lang=${finalLocale}`);
      }

      // Thêm geolocation vào Chromium arguments
      if (
        finalGeolocation &&
        finalGeolocation.latitude !== undefined &&
        finalGeolocation.longitude !== undefined
      ) {
        args.push(`--use-fake-ui-for-media-stream`);
        args.push(`--use-fake-device-for-media-stream`);
      }

      const launchOptions = {
        headless: false,
        args: args, // Sử dụng args đã được cập nhật
        proxy: finalProxyConfig || undefined,
        userAgent: profileConfig.userAgent || undefined,
        acceptDownloads: profileConfig.acceptDownloads,
      };

      browserContext = await chromium.launchPersistentContext(
        userDataDir,
        launchOptions
      );

      const page = await browserContext.newPage();

      // SỬA LỖI: Thay thế evaluateOnNewDocument bằng evaluate để set geolocation
      if (
        finalGeolocation &&
        finalGeolocation.latitude !== undefined &&
        finalGeolocation.longitude !== undefined
      ) {
        // Override the geolocation API using standard evaluate
        await page.evaluate((geolocation) => {
          // Override geolocation functions
          navigator.geolocation.getCurrentPosition = (
            success,
            error,
            options
          ) => {
            const position = {
              coords: {
                latitude: geolocation.latitude,
                longitude: geolocation.longitude,
                accuracy: geolocation.accuracy || 20,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            };
            success(position);
          };

          navigator.geolocation.watchPosition = (success, error, options) => {
            const position = {
              coords: {
                latitude: geolocation.latitude,
                longitude: geolocation.longitude,
                accuracy: geolocation.accuracy || 20,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            };
            success(position);
            return 1; // return a watchId
          };

          navigator.geolocation.clearWatch = (watchId) => {
            // Do nothing
          };
        }, finalGeolocation);
      }

      // Cấu hình Viewport nếu có
      if (
        profileConfig.viewport &&
        profileConfig.viewport.width &&
        profileConfig.viewport.height
      ) {
        await page.setViewportSize({
          width: profileConfig.viewport.width,
          height: profileConfig.viewport.height,
        });
      }

      // Tiêm các script khởi tạo
      if (
        profileConfig.initScripts &&
        Array.isArray(profileConfig.initScripts)
      ) {
        for (const script of profileConfig.initScripts) {
          try {
            await page.evaluate(script);
          } catch (scriptError) {
            console.error(
              `Error injecting script into page for profile '${profileName}': ${scriptError.message}`,
              script
            );
          }
        }
      }

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
      // Đảm bảo đóng trình duyệt nếu có lỗi trong quá trình khởi tạo
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

// ====================================================================
// Xử lý IPC cho Proxy Management
// ====================================================================

ipcMain.handle("get-proxies", async () => {
  return readProxies();
});

ipcMain.handle("add-proxy", async (event, proxyConfig) => {
  let proxies = readProxies();

  if (!proxyConfig || !proxyConfig.name || !proxyConfig.server) {
    return { success: false, message: "Invalid proxy configuration." };
  }
  if (proxies.some((p) => p.name === proxyConfig.name)) {
    return {
      success: false,
      message: `Proxy '${proxyConfig.name}' already exists.`,
    };
  }

  const ipMatch = proxyConfig.server.match(
    /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/
  );
  if (ipMatch && ipMatch[1]) {
    const geoInfo = await getGeoInfoFromIp(ipMatch[1]);
    if (geoInfo) {
      proxyConfig.timezoneId = geoInfo.timezoneId;
      proxyConfig.latitude = geoInfo.latitude;
      proxyConfig.longitude = geoInfo.longitude;
      console.log(
        `Auto-detected geo info for proxy ${proxyConfig.name}: ${JSON.stringify(
          geoInfo
        )}`
      );
    } else {
      console.warn(
        `Could not auto-detect geo info for proxy ${proxyConfig.name}.`
      );
    }
  } else {
    console.warn(
      `Could not extract IP from proxy server string for ${proxyConfig.name}.`
    );
  }

  proxies.push(proxyConfig);
  writeProxies(proxies);
  return { success: true, message: `Proxy '${proxyConfig.name}' added.` };
});

ipcMain.handle("update-proxy", async (event, oldName, newConfig) => {
  let proxies = readProxies();
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
      console.log(
        `Auto-detected geo info for updated proxy ${
          newConfig.name
        }: ${JSON.stringify(geoInfo)}`
      );
    } else {
      console.warn(
        `Could not auto-detect geo info for updated proxy ${newConfig.name}.`
      );
      // Xóa các trường geo info nếu không lấy được
      delete newConfig.timezoneId;
      delete newConfig.latitude;
      delete newConfig.longitude;
    }
  } else if (!serverChanged) {
    // Nếu server không thay đổi, giữ lại geo info cũ
    newConfig.timezoneId = oldProxy.timezoneId;
    newConfig.latitude = oldProxy.latitude;
    newConfig.longitude = oldProxy.longitude;
    newConfig.locale = oldProxy.locale;
  } else if (serverChanged && (!ipMatch || !ipMatch[1])) {
    // Nếu server thay đổi nhưng không có IP, xóa geo info cũ
    delete newConfig.timezoneId;
    delete newConfig.latitude;
    delete newConfig.longitude;
    delete newConfig.locale;
  }

  proxies[index] = { ...newConfig };
  writeProxies(proxies);
  return { success: true, message: `Proxy '${newConfig.name}' updated.` };
});

// Xóa proxy
ipcMain.handle("delete-proxy", async (event, proxyName) => {
  let proxies = readProxies();
  const initialLength = proxies.length;
  proxies = proxies.filter((p) => p.name !== proxyName);

  if (proxies.length < initialLength) {
    writeProxies(proxies);
    return { success: true, message: `Proxy '${proxyName}' deleted.` };
  } else {
    return { success: false, message: `Proxy '${proxyName}' not found.` };
  }
});
