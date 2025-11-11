const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const Store = require("electron-store");
const { v4: uuidv4 } = require("uuid");

// Bộ công cụ ổn định
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);

// Chỉ sử dụng generator
const { FingerprintGenerator } = require("fingerprint-generator");

let proxyStore;
const PROFILES_DIR = path.join(__dirname, "profiles");

// --- Các hàm tiện ích ---
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
      const locale = `${langCode}-${data.countryCode}`;
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

// --- Cửa sổ chính của Electron ---
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
  proxyStore = new Store({ name: "proxies" });
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
ipcMain.handle("create-profile", async (event, { profileName, proxyName }) => {
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
    const fingerprintGenerator = new FingerprintGenerator({
      devices: ["desktop"],
      operatingSystems: ["windows"],
      browsers: [{ name: "chrome", minVersion: 115 }],
    });
    const fingerprint = fingerprintGenerator.getFingerprint();

    // 🔧 SỬA LỖI: Kiểm tra và đảm bảo navigator tồn tại trước khi set language
    if (!fingerprint.navigator) {
      fingerprint.navigator = {};
    }

    // Đặt ngôn ngữ tiếng Anh
    fingerprint.navigator.language = "en-US";
    fingerprint.navigator.languages = ["en-US", "en"];

    const profileConfig = {
      name: profileName,
      createdAt: new Date().toISOString(),
      proxyName: proxyName || null,
      fingerprint: fingerprint,
    };
    fs.writeFileSync(
      path.join(profilePath, "config.json"),
      JSON.stringify(profileConfig, null, 2)
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

ipcMain.handle(
  "update-profile-config",
  async (event, profileName, newConfigData) => {
    const configFile = path.join(PROFILES_DIR, profileName, "config.json");
    if (fs.existsSync(configFile)) {
      try {
        const existingConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));
        const mergedConfig = { ...existingConfig, ...newConfigData };
        fs.writeFileSync(configFile, JSON.stringify(mergedConfig, null, 2));
        return {
          success: true,
          message: "Profile config updated successfully.",
        };
      } catch (error) {
        console.error(`Error updating config for ${profileName}:`, error);
        return {
          success: false,
          message: `Failed to update profile config: ${error.message}`,
        };
      }
    }
    return { success: false, message: "Profile config not found." };
  }
);

// --- Mở Trình duyệt ---
ipcMain.handle("open-browser", async (event, profileName, url) => {
  const targetUrl = url || "https://whoer.net/";
  const profilePath = path.join(PROFILES_DIR, profileName);
  const userDataDir = path.join(profilePath, "user-data");
  const configFile = path.join(profilePath, "config.json");

  if (!fs.existsSync(configFile)) {
    return {
      success: false,
      message: `Config not found for '${profileName}'.`,
    };
  }

  // --- DỌN DẸP PROFILE ---
  try {
    const defaultProfilePath = path.join(userDataDir, "Default");
    const preferencesPath = path.join(defaultProfilePath, "Preferences");
    if (fs.existsSync(preferencesPath)) {
      fs.rmSync(preferencesPath, { force: true });
    }
    console.log(`Cleaned preferences for profile '${profileName}'.`);
  } catch (e) {
    console.error(
      `Could not clean profile preferences for '${profileName}':`,
      e
    );
  }

  let browserContext = null;
  try {
    const profileConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    const fingerprintData = profileConfig.fingerprint;
    if (!fingerprintData || !fingerprintData.fingerprint) {
      return {
        success: false,
        message: "Fingerprint data is invalid or missing.",
      };
    }
    const fingerprint = fingerprintData.fingerprint;

    let playwrightProxyConfig = undefined;
    let finalTimezone = fingerprint.timezoneId;
    let finalLocale = "en-US"; // Luôn dùng tiếng Anh mặc định
    let finalGeolocation = fingerprint.geolocation;

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
        if (selectedProxy.timezoneId) finalTimezone = selectedProxy.timezoneId;
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

    // Accept-Language header luôn dùng tiếng Anh
    const acceptLanguageHeader = "en-US,en;q=0.9";

    // Đường dẫn đến extension WebRTC Blocker
    const extensionPath = path.join(__dirname, "webrtc-blocker-extension");

    // Đảm bảo không có browser context nào đang chạy trước khi khởi tạo mới
    try {
      const existingContexts = browserContext ? [browserContext] : [];
      for (const context of existingContexts) {
        await context.close().catch(() => {});
      }
    } catch (e) {
      console.log("No existing contexts to close");
    }

    browserContext = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      proxy: playwrightProxyConfig,
      userAgent: fingerprint.navigator.userAgent,
      locale: finalLocale, // Dùng locale tiếng Anh
      timezoneId: finalTimezone,
      geolocation: finalGeolocation,
      viewport: {
        width: Math.round(fingerprint.screen.width),
        height: Math.round(fingerprint.screen.height),
      },
      extraHTTPHeaders: {
        ...fingerprintData.headers,
        "accept-language": acceptLanguageHeader, // Header tiếng Anh
      },
      // --- SIMPLIFIED ARGS ---
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-site-isolation-trials",
      ],
      ignoreDefaultArgs: [
        "--enable-automation",
        "--disable-background-timer-throttling",
      ],
      timeout: 60000,
    });

    // ======================================================
    // HÀM BẢO VỆ WEBRTC NÂNG CAO
    // ======================================================
    const applyEnhancedWebRTCProtection = async (
      targetPage,
      protectionData
    ) => {
      try {
        // Lớp bảo vệ 1: Init Script cơ bản
        await targetPage.addInitScript(
          (args) => {
            const { screen, navigator, videoCard, finalLocale } = args;

            console.log("🛡️ Applying ENHANCED WebRTC protection to page...");

            // --- VÔ HIỆU HÓA WEBRTC HOÀN TOÀN ---
            const webRTCClasses = [
              "RTCPeerConnection",
              "webkitRTCPeerConnection",
              "mozRTCPeerConnection",
              "RTCSessionDescription",
              "RTCIceCandidate",
              "RTCDataChannel",
            ];

            webRTCClasses.forEach((className) => {
              Object.defineProperty(window, className, {
                get: () => {
                  console.warn(`🚫 ${className} is disabled`);
                  return undefined;
                },
                configurable: false,
                enumerable: true,
              });
            });

            // Vô hiệu hóa hoàn toàn mediaDevices
            Object.defineProperty(navigator, "mediaDevices", {
              get: () => ({
                getUserMedia: () => Promise.reject(new Error("WebRTC blocked")),
                enumerateDevices: () => Promise.resolve([]),
                getSupportedConstraints: () => ({}),
              }),
              configurable: false,
              enumerable: true,
            });

            // Vô hiệu hóa các hàm getUserMedia
            ["getUserMedia", "webkitGetUserMedia", "mozGetUserMedia"].forEach(
              (method) => {
                Object.defineProperty(navigator, method, {
                  get: () => () => Promise.reject(new Error("WebRTC blocked")),
                  configurable: false,
                });
              }
            );

            // --- FINGERPRINT BẢO VỆ ---
            Object.defineProperty(navigator, "languages", {
              get: () => [finalLocale, "en"],
              configurable: false,
            });

            Object.defineProperty(window.screen, "width", {
              value: Math.round(screen.width),
              configurable: false,
            });

            Object.defineProperty(window.screen, "height", {
              value: Math.round(screen.height),
              configurable: false,
            });

            Object.defineProperty(window.screen, "availWidth", {
              value: Math.round(screen.availWidth),
              configurable: false,
            });

            Object.defineProperty(window.screen, "availHeight", {
              value: Math.round(screen.availHeight),
              configurable: false,
            });

            Object.defineProperty(window.screen, "colorDepth", {
              value: screen.colorDepth,
              configurable: false,
            });

            Object.defineProperty(window.screen, "pixelDepth", {
              value: screen.pixelDepth,
              configurable: false,
            });

            Object.defineProperty(navigator, "deviceMemory", {
              value: navigator.deviceMemory,
              configurable: false,
            });

            Object.defineProperty(navigator, "hardwareConcurrency", {
              value: navigator.hardwareConcurrency,
              configurable: false,
            });

            Object.defineProperty(navigator, "platform", {
              value: navigator.platform,
              configurable: false,
            });

            console.log("✅ ENHANCED WebRTC protection applied successfully");
          },
          {
            screen: protectionData.screen,
            navigator: protectionData.navigator,
            videoCard: protectionData.videoCard,
            finalLocale: protectionData.finalLocale,
          }
        );

        // ========================
        // TỐI ƯU HÓA CANVAS FINGERPRINT PROTECTION
        // ========================
        await targetPage.addInitScript(() => {
          // Canvas Fingerprint Protection - NÂNG CAO
          const originalGetImageData =
            CanvasRenderingContext2D.prototype.getImageData;
          CanvasRenderingContext2D.prototype.getImageData = function (...args) {
            const imageData = originalGetImageData.apply(this, args);

            // THÊM NOISE MẠNH HƠN VÀ PHỨC TẠP
            const data = imageData.data;
            const width = imageData.width;
            const height = imageData.height;

            // Noise pattern phức tạp hơn
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;

                // Thêm noise dựa trên vị trí pixel
                const noise = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 2;

                // Áp dụng noise có chọn lọc
                if ((x + y) % 3 === 0) {
                  data[index] = (data[index] + noise + Math.random() * 3) % 256;
                  data[index + 1] =
                    (data[index + 1] + noise + Math.random() * 3) % 256;
                  data[index + 2] =
                    (data[index + 2] + noise + Math.random() * 3) % 256;
                }
              }
            }
            return imageData;
          };

          // Override thêm các phương thức Canvas khác
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
            const canvas = this;
            const context = canvas.getContext("2d");

            // Áp dụng noise trước khi trả về data URL
            if (context) {
              try {
                const imageData = context.getImageData(
                  0,
                  0,
                  canvas.width,
                  canvas.height
                );
                context.putImageData(imageData, 0, 0);
              } catch (e) {
                // Bỏ qua lỗi cross-origin
              }
            }
            return originalToDataURL.call(this, type, quality);
          };
        });

        // ========================
        // TỐI ƯU HÓA WEBGL FINGERPRINT PROTECTION
        // ========================
        await targetPage.addInitScript(() => {
          // WebGL Fingerprint Protection - NÂNG CAO
          if (typeof WebGLRenderingContext !== "undefined") {
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function (
              parameter
            ) {
              const value = getParameter.call(this, parameter);

              // TẠO BIẾN THỂ NGẪU NHIÊN CÓ KIỂM SOÁT
              const randomSeed = Math.floor(Math.random() * 1000);
              const stableVariant = randomSeed % 3;

              switch (parameter) {
                case 37445: // VENDOR
                  const vendors = [
                    "Google Inc. (Intel)",
                    "Intel Inc.",
                    "Google Inc. (AMD)",
                  ];
                  return vendors[stableVariant];

                case 37446: // RENDERER
                  const renderers = [
                    "ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)",
                    "Intel Iris OpenGL Engine",
                    "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
                  ];
                  return renderers[stableVariant];

                case 7936: // VERSION
                  return "WebGL 1.0 (OpenGL ES 2.0 Chromium)";

                case 7937: // SHADING_LANGUAGE_VERSION
                  return "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)";

                default:
                  return value;
              }
            };
          }
        });

        // ========================
        // TỐI ƯU HÓA AUDIO CONTEXT PROTECTION
        // ========================
        await targetPage.addInitScript(() => {
          // AudioContext Fingerprint Protection - NÂNG CAO
          if (window.AudioContext || window.webkitAudioContext) {
            const AudioContext =
              window.AudioContext || window.webkitAudioContext;

            // Override createAnalyser
            const originalCreateAnalyser =
              AudioContext.prototype.createAnalyser;
            AudioContext.prototype.createAnalyser = function () {
              const analyser = originalCreateAnalyser.call(this);

              Object.defineProperty(analyser, "frequencyBinCount", {
                get: function () {
                  return 1024 + Math.floor(Math.random() * 3) - 1;
                },
              });

              return analyser;
            };

            // Override createOscillator
            const originalCreateOscillator =
              AudioContext.prototype.createOscillator;
            AudioContext.prototype.createOscillator = function () {
              const oscillator = originalCreateOscillator.call(this);

              const originalStart = oscillator.start;
              oscillator.start = function (when) {
                const randomDelay = (Math.random() - 0.5) * 0.0002;
                return originalStart.call(this, when + randomDelay);
              };

              return oscillator;
            };

            // Override createBuffer với noise
            const originalCreateBuffer = AudioContext.prototype.createBuffer;
            AudioContext.prototype.createBuffer = function (
              numberOfChannels,
              length,
              sampleRate
            ) {
              const audioBuffer = originalCreateBuffer.call(
                this,
                numberOfChannels,
                length,
                sampleRate
              );

              // Thêm noise pattern
              for (let channel = 0; channel < numberOfChannels; channel++) {
                const channelData = audioBuffer.getChannelData(channel);
                for (let i = 0; i < channelData.length; i++) {
                  const positionNoise = Math.sin(i * 0.01) * 0.000001;
                  const randomNoise = (Math.random() - 0.5) * 0.000002;
                  channelData[i] += positionNoise + randomNoise;
                }
              }

              return audioBuffer;
            };
          }
        });

        // Lớp bảo vệ 2: Chặn WebRTC network requests
        await targetPage.route(/stun:|turn:|stuns:|turns:/, (route) => {
          console.log("🚫 Blocked WebRTC server:", route.request().url());
          route.abort();
        });

        console.log("🎯 ĐÃ ÁP DỤNG NÂNG CẤP: Canvas/WebGL/Audio Protection");
      } catch (error) {
        console.error("❌ Error applying optimized protection:", error);
      }
    };

    // ======================================================
    // ÁP DỤNG BẢO VỆ CHO TRANG ĐẦU TIÊN
    // ======================================================
    let page;
    try {
      await browserContext.waitForEvent("page");
      page = browserContext.pages()[0];

      const protectionData = {
        screen: fingerprint.screen,
        navigator: fingerprint.navigator,
        videoCard: fingerprint.videoCard,
        finalLocale: finalLocale,
      };

      await applyEnhancedWebRTCProtection(page, protectionData);
      console.log(`✅ Applied ENHANCED WebRTC protection to initial page`);
    } catch (error) {
      console.error("❌ Error setting up initial page:", error);
      page = await browserContext.newPage();
    }

    // ======================================================
    // ÁP DỤNG BẢO VỆ CHO MỌI TRANG MỚI
    // ======================================================
    browserContext.on("page", async (newPage) => {
      console.log(
        `🔄 New page detected, applying ENHANCED WebRTC protection...`
      );

      try {
        const protectionData = {
          screen: fingerprint.screen,
          navigator: fingerprint.navigator,
          videoCard: fingerprint.videoCard,
          finalLocale: finalLocale,
        };

        await applyEnhancedWebRTCProtection(newPage, protectionData);
        console.log(`✅ Applied ENHANCED WebRTC protection to new page`);
      } catch (error) {
        console.error(`❌ Failed to apply protection to new page:`, error);
      }
    });

    // Chuyển đến URL đích
    if (page) {
      await page.goto(targetUrl);
      console.log(`🌐 Navigated to: ${targetUrl}`);
    }

    browserContext.on("close", () => {
      console.log(`🔚 Browser context for profile '${profileName}' closed.`);
    });

    return { success: true, message: `Browser for '${profileName}' opened.` };
  } catch (error) {
    console.error(
      `❌ Error opening browser for profile ${profileName}:`,
      error
    );
    if (browserContext) {
      try {
        await browserContext.close();
      } catch (e) {
        console.error("Error closing context on failure:", e);
      }
    }
    return {
      success: false,
      message: `Failed to open browser: ${error.message}`,
    };
  }
});

// --- Quản lý Proxy ---
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
