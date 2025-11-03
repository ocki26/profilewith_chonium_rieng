const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const UserAgent = require("user-agents");
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("hpagent");

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

  // Mặc định là http nếu không có protocol
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

    // User-Agent nhất quán cho Windows 10 / Chrome
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36";

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
        "--disable-translate",
        "--disable-background-networking",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-first-run",
      ],
      initScripts: [
        // Script chống phát hiện WebDriver nâng cao
        `
        (function () {
          if (navigator.webdriver) {
            Object.defineProperty(navigator, 'webdriver', {
              get: () => false,
              configurable: true
            });
          }

          // Xóa các biến tự động hóa của ChromeDriver
          for (var window_property in window) {
            if (window_property.match(/^\\$cdc_[a-zA-Z0-9_\\$]*$/) || window_property.match(/^[a-zA-Z0-9_\\$]*_cdc$/)) {
              delete window[window_property];
            }
          }

          for (var doc_property in document) {
            if (doc_property.match(/^\\$cdc_[a-zA-Z0-9_\\$]*$/) || doc_property.match(/^[a-zA-Z0-9_\\$]*_cdc$/)) {
              delete document[doc_property];
            }
          }
        })();
        `,

        // Giả lập Plugins và MimeTypes hoàn thiện hơn
        `
        (function() {
          try {
            const MimeType = function(type, suffixes, description, enabledPlugin) {
              this.type = type || '';
              this.suffixes = suffixes || '';
              this.description = description || '';
              this.enabledPlugin = enabledPlugin || null;
            };

            const Plugin = function(name, filename, description, mimeTypes) {
              this.name = name || '';
              this.filename = filename || '';
              this.description = description || '';
              this.length = mimeTypes ? mimeTypes.length : 0;
              if (mimeTypes) {
                for (let i = 0; i < mimeTypes.length; i++) {
                  this[i] = mimeTypes[i];
                  Object.defineProperty(this, mimeTypes[i].type, {
                    value: mimeTypes[i],
                    enumerable: true
                  });
                }
              }
            };
            
            Plugin.prototype.item = function(index) { return this[index] || null; };
            Plugin.prototype.namedItem = function(name) {
              for(let i=0; i<this.length; i++) {
                if(this[i].type === name) return this[i];
              }
              return null;
            };

            const MimeTypeArray = function(items) {
              items = items || [];
              for(let i=0; i<items.length; i++) this[i] = items[i];
              this.length = items.length;
            };

            MimeTypeArray.prototype.item = function(index) { return this[index] || null; };
            MimeTypeArray.prototype.namedItem = function(name) {
              for(let i=0; i<this.length; i++) {
                if(this[i].type === name) return this[i];
              }
              return null;
            };

            const PluginArray = function(items) {
              items = items || [];
              for (let i=0; i<items.length; i++) this[i] = items[i];
              this.length = items.length;
            };

            PluginArray.prototype.item = function(index) { return this[index] || null; };
            PluginArray.prototype.namedItem = function(name) {
              for(let i=0; i<this.length; i++) {
                if(this[i].name === name) return this[i];
              }
              return null;
            };
            PluginArray.prototype.refresh = function(){};

            const pdfMime = new MimeType('application/pdf', 'pdf', 'Portable Document Format');
            const pdfPlugin = new Plugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', [pdfMime]);
            pdfMime.enabledPlugin = pdfPlugin;

            const chromePdfMime = new MimeType('application/x-google-chrome-pdf', 'pdf', 'Portable Document Format');
            const chromePdfPlugin = new Plugin('Chrome PDF Viewer', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', 'Portable Document Format', [chromePdfMime]);
            chromePdfMime.enabledPlugin = chromePdfPlugin;

            const plugins = new PluginArray([pdfPlugin, chromePdfPlugin]);
            const mimeTypes = new MimeTypeArray([pdfMime, chromePdfMime]);

            Object.defineProperty(navigator, 'plugins', { get: () => plugins, enumerable: true, configurable: true });
            Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypes, enumerable: true, configurable: true });
          } catch (e) { console.warn('Failed to shim navigator.plugins/mimeTypes', e); }
        })();
        `,

        // Giả lập Languages nhất quán hơn
        `
        (function() {
          Object.defineProperty(navigator, 'language', { get: () => 'en-US', configurable: true });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
        })();
        `,

        // Cải thiện giả lập WebGL để trông tự nhiên hơn
        `
        (function() {
          if (typeof WebGLRenderingContext !== 'undefined') {
            const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
              if (parameter === 37445) return 'Google Inc. (Intel)';
              if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
              return originalGetParameter.call(this, parameter);
            };

            const originalGetSupportedExtensions = WebGLRenderingContext.prototype.getSupportedExtensions;
            WebGLRenderingContext.prototype.getSupportedExtensions = function() {
              const commonExtensions = [
                "ANGLE_instanced_arrays", "EXT_blend_minmax", "EXT_color_buffer_half_float",
                "EXT_disjoint_timer_query", "EXT_float_blend", "EXT_frag_depth",
                "EXT_shader_texture_lod", "EXT_texture_filter_anisotropic", "WEBKIT_EXT_texture_filter_anisotropic",
                "OES_element_index_uint", "OES_standard_derivatives", "OES_texture_float",
                "OES_texture_float_linear", "OES_texture_half_float", "OES_texture_half_float_linear",
                "OES_vertex_array_object", "WEBGL_color_buffer_float", "WEBGL_compressed_texture_s3tc",
                "WEBKIT_WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_s3tc_srgb",
                "WEBGL_debug_renderer_info", "WEBGL_debug_shaders", "WEBGL_depth_texture",
                "WEBKIT_WEBGL_depth_texture", "WEBGL_draw_buffers", "WEBGL_lose_context", "WEBKIT_WEBGL_lose_context"
              ];
              return commonExtensions;
            };
          }
        })();
        `,

        // Giả lập Platform nhất quán với User Agent (Windows)
        `
        (function() {
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          Object.defineProperty(navigator, 'oscpu', { get: () => 'Windows NT 10.0; Win64; x64', configurable: true });
          const appVersion = "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36";
          Object.defineProperty(navigator, 'appVersion', { get: () => appVersion, configurable: true });
          Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true });
        })();
        `,

        // Script chống fingerprint qua Broken Image Dimensions
        `
        (function() {
          try {
            const H = HTMLImageElement.prototype;
            const ow = Object.getOwnPropertyDescriptor(H, 'width');
            const oh = Object.getOwnPropertyDescriptor(H, 'height');

            if (ow && ow.get && oh && oh.get) {
              Object.defineProperties(H, {
                'width': {
                  get: function() {
                    if (this.complete && this.naturalWidth === 0) return 0;
                    return ow.get.call(this);
                  }
                },
                'height': {
                  get: function() {
                    if (this.complete && this.naturalHeight === 0) return 0;
                    return oh.get.call(this);
                  }
                }
              });
            }
          } catch(e) { console.warn('Failed to patch Broken Image Dimensions', e); }
        })();
        `,

        // Các script cơ bản khác
        `Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });`,
        `Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });`,

        // WebRTC blocking (GHI CHÚ: Extension sẽ xử lý việc này tốt hơn, nhưng giữ lại script này cũng không sao)
        `
        (function() {
          if (window.RTCPeerConnection) delete window.RTCPeerConnection;
          if (window.webkitRTCPeerConnection) delete window.webkitRTCPeerConnection;
          if (window.mozRTCPeerConnection) delete window.mozRTCPeerConnection;
          if (window.RTCSessionDescription) delete window.RTCSessionDescription;
          if (window.RTCIceCandidate) delete window.RTCIceCandidate;
          
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia = function() {
              return Promise.reject(new Error('WebRTC is disabled by custom script'));
            };
          }
        })();
        `,

        // Canvas fingerprint protection
        `
        (function() {
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
            const context = this.getContext('2d');
            if (context) {
              try {
                const imageData = context.getImageData(0, 0, this.width, this.height);
                const data = imageData.data;
                for (let i = 0; i < data.length; i += 4) {
                  if (Math.random() > 0.98) {
                    data[i] = data[i] ^ 1;
                    data[i+1] = data[i+1] ^ 1;
                    data[i+2] = data[i+2] ^ 1;
                  }
                }
                context.putImageData(imageData, 0, 0);
              } catch (e) {}
            }
            return originalToDataURL.call(this, type, quality);
          };
        })();
        `,

        // Screen properties
        `
        (function() {
          const fakeScreen = {
            width: 1366,
            height: 768,
            availWidth: 1366,
            availHeight: 768,
            colorDepth: 24,
            pixelDepth: 24
          };
          Object.defineProperty(window, 'screen', {
            get: () => fakeScreen
          });
        })();
        `,

        // Battery API
        `
        (function() {
          if (navigator.getBattery) {
            navigator.getBattery = async function() {
              return Promise.resolve({
                charging: true,
                chargingTime: 0,
                dischargingTime: Infinity,
                level: 1
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
          playwrightProxyConfig = {
            server: selectedProxy.server,
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

      // =======================================================================
      // BẮT ĐẦU THAY ĐỔI: Tích hợp Extension
      // =======================================================================

      // 1. Xác định đường dẫn đến thư mục extension đã giải nén
      // __dirname là thư mục chứa file main.js
      const pathToExtension = path.join(
        __dirname,
        "extensions",
        "webrtc_control_folder"
      );

      // 2. Kiểm tra xem thư mục extension có tồn tại không để tránh lỗi
      if (!fs.existsSync(pathToExtension)) {
        console.error(
          `Lỗi: Không tìm thấy thư mục extension tại: ${pathToExtension}`
        );
        return {
          success: false,
          message: `Không tìm thấy thư mục extension. Vui lòng kiểm tra lại đường dẫn: ${pathToExtension}`,
        };
      }

      // 3. Thêm các đối số mới để tải extension
      const existingArgs = profileConfig.chromiumArgs || [];
      const newArgs = [
        ...existingArgs,
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ];

      // =======================================================================
      // KẾT THÚC THAY ĐỔI
      // =======================================================================

      const launchOptions = {
        headless: false,
        args: newArgs, // <-- SỬ DỤNG ARGS MỚI Ở ĐÂY
        userAgent: profileConfig.userAgent || undefined,
        acceptDownloads: profileConfig.acceptDownloads,
        ignoreHTTPSErrors: true,
        bypassCSP: true,
        proxy: playwrightProxyConfig,
        timezoneId: finalTimezoneId,
        locale: finalLocale,
        geolocation: finalGeolocation,
        permissions: ["geolocation"],
        viewport: profileConfig.viewport || { width: 1366, height: 768 },
      };

      console.log("==============================================");
      console.log(`Attempting to launch browser for profile: '${profileName}'`);
      console.log(
        "Final Playwright Launch Options:",
        JSON.stringify(launchOptions, null, 2)
      );
      console.log("==============================================");

      browserContext = await chromium.launchPersistentContext(
        userDataDir,
        launchOptions
      );

      const page = browserContext.pages().length
        ? browserContext.pages()[0]
        : await browserContext.newPage();

      // Inject tất cả các script
      const allInitScripts = profileConfig.initScripts || [];
      for (const script of allInitScripts) {
        await page.addInitScript(script);
      }

      // Script cuối cùng để giả lập Permissions API
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
                return Promise.resolve({
                  state: "prompt",
                  onchange: null,
                });
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
        const detailedMessage = `Lỗi kết nối Proxy (ERR_TUNNEL_CONNECTION_FAILED). Vui lòng kiểm tra lại:
1.  **Thông tin Proxy:** Địa chỉ IP, Port, Username, Password có chính xác không?
2.  **Giao thức Proxy:** Nếu là SOCKS5, bạn đã điền 'socks5://' trước địa chỉ chưa? (Ví dụ: socks5://123.45.67.89:1080). Mặc định là HTTP.
3.  **Proxy còn hoạt động:** Proxy có thể đã hết hạn hoặc đang ngoại tuyến.
4.  **Tường lửa/Antivirus:** Phần mềm bảo mật có thể đang chặn kết nối đến proxy.`;

        console.error("Detailed Proxy Error:", detailedMessage);

        return {
          success: false,
          message: detailedMessage,
        };
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

// ====================================================================
// Xử lý IPC cho Proxy Management
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
