const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const UserAgent = require("user-agents");
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("hpagent");

// ĐÃ XÓA stealth plugin

// Biến để giữ instance của electron-store
let proxyStore;

// Đường dẫn đến thư mục profiles
const PROFILES_DIR = path.join(__dirname, "profiles");

// Hàm tạo thư mục profile nếu chưa có
function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Helper function to validate and normalize proxy server URL
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

// Hàm lấy thông tin địa lý từ IP bằng Geolocation API
// Sử dụng ip-api.com vì nó cung cấp timezone
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
      webSecurity: true,
    },
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(async () => {
  ensureDirectory(PROFILES_DIR);
  createWindow();

  // Import electron-store động khi app đã sẵn sàng
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

    const defaultConfig = {
      userAgent: userAgent,
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
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
        "--hide-scrollbars",
        "--mute-audio",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-accelerated-2d-canvas",
        "--disable-accelerated-video-decode",
        "--disable-web-security",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-client-side-phishing-detection",
        "--disable-component-extensions-with-background-pages",
        "--disable-default-apps",
        "--disable-ipc-flooding-protection",
        "--disable-hang-monitor",
        "--no-pings",
        "--disable-reading-from-canvas",
        "--disable-translate",
        "--disable-background-networking",
        "--disable-sync",
        "--metrics-recording-only",
        "--disable-default-apps",
        "--no-first-run",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
      initScripts: [
        `Object.defineProperty(navigator, 'webdriver', { get: () => false });`,
        `Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });`,
        `Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });`,
        `Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });`,
        `Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });`,
        `
        (function() {
          if (window.RTCPeerConnection) delete window.RTCPeerConnection;
          if (window.webkitRTCPeerConnection) delete window.webkitRTCPeerConnection;
          if (window.mozRTCPeerConnection) delete window.mozRTCPeerConnection;
          if (window.RTCSessionDescription) delete window.RTCSessionDescription;
          if (window.RTCIceCandidate) delete window.RTCIceCandidate;
          
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
            navigator.mediaDevices.getUserMedia = function() {
              console.log('WebRTC getUserMedia blocked by custom script.');
              return Promise.reject(new Error('WebRTC is disabled by custom script'));
            };
          }
          if (window.MediaStream) {
            window.MediaStream = function() {
              throw new Error('WebRTC MediaStream is disabled by custom script');
            };
          }
        })();
        `,
        `
        (function() {
          const originalDate = Date;
          window.Date = function(...args) {
            const date = new originalDate(...args);
            return date;
          };
          Date.prototype = originalDate.prototype;
          Date.now = originalDate.now;
          Date.parse = originalDate.parse;
          Date.UTC = originalDate.UTC;
        })();
        `,
        `
        (function() {
          if (typeof WebGLRenderingContext !== 'undefined') {
            const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
            
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
              if (parameter === 37445) return 'Google Inc. (Intel)';
              if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)';
              
              return originalGetParameter.call(this, parameter);
            };
            
            WebGLRenderingContext.prototype.getExtension = function() { return null; };
            WebGLRenderingContext.prototype.getSupportedExtensions = function() { return []; };
          }
        })();
        `,
        `
        (function() {
          const fakeScreen = {
            width: 1366,
            height: 768,
            availWidth: 1366,
            availHeight: 768,
            colorDepth: 24,
            pixelDepth: 24,
            availLeft: 0,
            availTop: 0
          };
          
          Object.defineProperty(window, 'screen', {
            get: () => fakeScreen
          });
          
          Object.defineProperty(window, 'innerWidth', { get: () => 1366 });
          Object.defineProperty(window, 'innerHeight', { get: () => 768 });
          Object.defineProperty(window, 'outerWidth', { get: () => 1382 });
          Object.defineProperty(window, 'outerHeight', { get: () => 816 });
          Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
          
          const originalMatchMedia = window.matchMedia;
          window.matchMedia = function(query) {
            if (query.includes('width') || query.includes('height')) {
                return { matches: false, media: query, addListener: function() {}, removeListener: function() {} };
            }
            return originalMatchMedia.call(this, query);
          };
        })();
        `,
        `
        (function() {
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
          const originalPutImageData = CanvasRenderingContext2D.prototype.putImageData;
          
          HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
            const context = this.getContext('2d');
            if (context) {
              try {
                const imageData = originalGetImageData.call(context, 0, 0, this.width, this.height);
                const data = imageData.data;
                
                for (let i = 0; i < data.length; i += 4) {
                  if (Math.random() > 0.98) {
                    data[i] = data[i] ^ 1;
                    data[i+1] = data[i+1] ^ 1;
                    data[i+2] = data[i+2] ^ 1;
                  }
                }
                
                originalPutImageData.call(context, imageData, 0, 0);
              } catch (e) {
                console.warn('Canvas fingerprinting protection error:', e);
              }
            }
            return originalToDataURL.call(this, type, quality);
          };
          
          CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
            const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
              if (Math.random() > 0.98) {
                data[i] = data[i] ^ 1;
                data[i+1] = data[i+1] ^ 1;
                data[i+2] = data[i+2] ^ 1;
              }
            }
            return imageData;
          };
        })();
        `,
        `
        (function() {
          if (window.AudioContext) {
            const originalCreateBuffer = AudioContext.prototype.createBuffer;
            AudioContext.prototype.createBuffer = function() {
              const buffer = originalCreateBuffer.apply(this, arguments);
              
              const originalGetChannelData = buffer.getChannelData;
              buffer.getChannelData = function(channel) {
                const channelData = originalGetChannelData.call(this, channel);
                
                for (let i = 0; i < channelData.length; i++) {
                  if (Math.random() > 0.995) {
                    channelData[i] += (Math.random() - 0.5) * 0.00001;
                  }
                }
                
                return channelData;
              };
              
              return buffer;
            };
          }
        })();
        `,
        `
        (function() {
          const webrtcObjects = [
            'RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection',
            'RTCSessionDescription', 'RTCIceCandidate', 'RTCPeerConnectionIceEvent',
            'RTCDataChannel', 'RTCDataChannelEvent', 'MediaStream'
          ];
          
          webrtcObjects.forEach(obj => {
            if (window[obj]) {
              console.log('Blocking WebRTC object:', obj);
              delete window[obj];
            }
          });
          
          if (navigator.mediaDevices) {
            if (navigator.mediaDevices.getDisplayMedia) {
              navigator.mediaDevices.getDisplayMedia = function() {
                console.log('navigator.mediaDevices.getDisplayMedia blocked.');
                return Promise.reject(new Error('getDisplayMedia is not supported'));
              };
            }
            if (navigator.mediaDevices.getUserMedia) {
                navigator.mediaDevices.getUserMedia = function() {
                    console.log('navigator.mediaDevices.getUserMedia blocked.');
                    return Promise.reject(new Error('getUserMedia is not supported'));
                };
            }
          }
        })();
        `,
        `
        (function() {
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          Object.defineProperty(navigator, 'oscpu', { get: () => 'Windows NT 10.0; Win64; x64' });
          Object.defineProperty(navigator, 'cpuClass', { get: () => 'x86' });
        })();
        `,
        `
        (function() {
          if (navigator.getBattery) {
            const originalGetBattery = navigator.getBattery;
            navigator.getBattery = async function() {
              return Promise.resolve({
                charging: true,
                chargingTime: 0,
                dischargingTime: Infinity,
                level: 1,
                addEventListener: () => {},
                removeEventListener: () => {}
              });
            };
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

// Mở một trình duyệt mới với profile đã chọn
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

      // Biến để chứa instance của HttpsProxyAgent (nếu cần dùng cho các API Node.js khác)
      let proxyAgent = undefined;
      // Biến để chứa cấu hình proxy theo định dạng của Playwright
      let playwrightProxyConfig = undefined;

      if (profileConfig.proxyName) {
        if (!proxyStore) {
          console.error(
            "proxyStore is not initialized. Cannot retrieve proxies."
          );
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
          let proxyUrl;
          try {
            // Dòng này đã được bảo vệ bởi normalizeProxyServerUrl khi thêm/cập nhật proxy
            proxyUrl = new URL(selectedProxy.server);
          } catch (e) {
            console.error(
              `Invalid proxy server URL in store for '${selectedProxy.name}': ${selectedProxy.server}`,
              e
            );
            return {
              success: false,
              message: `Invalid proxy server URL for '${selectedProxy.name}'. Please check proxy settings.`,
            };
          }

          let proxyServerString = `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`;

          // Khởi tạo HttpsProxyAgent nếu cần dùng cho các yêu cầu fetch của Node.js
          if (selectedProxy.username && selectedProxy.password) {
            proxyAgent = new HttpsProxyAgent({
              proxy: proxyServerString,
              username: selectedProxy.username,
              password: selectedProxy.password,
            });
          } else {
            proxyAgent = new HttpsProxyAgent({ proxy: proxyServerString });
          }

          // Cấu hình proxy cho Playwright (dạng đối tượng đơn giản)
          playwrightProxyConfig = {
            server: selectedProxy.server, // Playwright cần chuỗi URL proxy đầy đủ (ví dụ: http://ip:port)
            username: selectedProxy.username,
            password: selectedProxy.password,
          };

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

      const launchOptions = {
        headless: false,
        args: profileConfig.chromiumArgs || [],
        userAgent: profileConfig.userAgent || undefined,
        acceptDownloads: profileConfig.acceptDownloads,
        ignoreHTTPSErrors: true,
        bypassCSP: true,
        // Sử dụng cấu hình proxy đã chuẩn bị cho Playwright
        proxy: playwrightProxyConfig,
        timezoneId: finalTimezoneId,
        locale: finalLocale,
        viewport: profileConfig.viewport || { width: 1366, height: 768 },
      };

      browserContext = await chromium.launchPersistentContext(
        userDataDir,
        launchOptions
      );

      const page = await browserContext.newPage();

      if (
        finalGeolocation &&
        finalGeolocation.latitude !== undefined &&
        finalGeolocation.longitude !== undefined
      ) {
        await browserContext.setGeolocation(finalGeolocation);
        // THAY THẾ evaluateOnNewDocument BẰNG addInitScript
        await page.addInitScript((geolocation) => {
          navigator.geolocation.getCurrentPosition = (
            successCallback,
            errorCallback,
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
            successCallback(position);
          };
          navigator.geolocation.watchPosition = (
            successCallback,
            errorCallback,
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
            successCallback(position);
            return 1;
          };
          navigator.geolocation.clearWatch = (watchId) => {
            // Do nothing
          };
        }, finalGeolocation);
      } else {
        await browserContext.clearPermissions(["geolocation"]);
      }

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

      if (finalTimezoneId) {
        // THAY THẾ evaluateOnNewDocument BẰNG addInitScript
        await page.addInitScript((tz) => {
          Object.defineProperty(Intl, "DateTimeFormat", {
            value: class DateTimeFormat extends Intl.DateTimeFormat {
              constructor(locale, options) {
                super(locale, { ...options, timeZone: tz });
              }
            },
          });
        }, finalTimezoneId);
      }

      if (
        profileConfig.initScripts &&
        Array.isArray(profileConfig.initScripts)
      ) {
        for (const script of profileConfig.initScripts) {
          try {
            // THAY THẾ evaluateOnNewDocument BẰNG addInitScript
            await page.addInitScript(script);
          } catch (scriptError) {
            console.error(
              `Error injecting script into page for profile '${profileName}': ${scriptError.message}`,
              script
            );
          }
        }
      }

      // API này có thể không tồn tại trong Playwright core, cần bọc trong try-catch
      try {
        await page.setRTCClientHints({
          audio: {
            send: "none",
            receive: "none",
          },
          video: {
            send: "none",
            receive: "none",
          },
        });
      } catch (error) {
        console.warn("setRTCClientHints not available:", error.message);
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
// Xử lý IPC cho Proxy Management (sử dụng electron-store)
// ====================================================================

ipcMain.handle("get-proxies", async () => {
  if (!proxyStore) {
    console.error("proxyStore is not initialized. Cannot retrieve proxies.");
    return [];
  }
  return proxyStore.get("list", []);
});

ipcMain.handle("add-proxy", async (event, proxyConfig) => {
  if (!proxyStore) {
    console.error("proxyStore is not initialized. Cannot add proxy.");
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
  proxyStore.set("list", proxies);
  return { success: true, message: `Proxy '${proxyConfig.name}' added.` };
});

ipcMain.handle("update-proxy", async (event, oldName, newConfig) => {
  if (!proxyStore) {
    console.error("proxyStore is not initialized. Cannot update proxy.");
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
      console.log(
        `Auto-detected geo info for updated proxy ${
          newConfig.name
        }: ${JSON.stringify(geoInfo)}`
      );
    } else {
      console.warn(
        `Could not auto-detect geo info for updated proxy ${newConfig.name}.`
      );
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

// Xóa proxy
ipcMain.handle("delete-proxy", async (event, proxyName) => {
  if (!proxyStore) {
    console.error("proxyStore is not initialized. Cannot delete proxy.");
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
