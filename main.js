const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

// Đường dẫn đến thư mục profiles
const PROFILES_DIR = path.join(__dirname, "profiles");

// Hàm tạo thư mục profile nếu chưa có
function ensureProfilesDirectory() {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR);
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
      contextIsolation: true, // Bảo mật hơn
      nodeIntegration: false, // Bảo mật hơn
    },
  });

  mainWindow.loadFile("index.html");

  // Mở DevTools khi khởi động (chỉ dùng khi phát triển)
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  ensureProfilesDirectory();
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
  ensureProfilesDirectory();
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

    // Ghi cấu hình mặc định ban đầu với nhiều thông số fingerprint hơn
    const defaultConfig = {
      // User Agent: Rất quan trọng, nên thay đổi cho từng profile.
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,

      // Kích thước cửa sổ (viewport): Nên khác nhau để tạo sự đa dạng.
      viewport: { width: 1366, height: 768 },

      // Ngôn ngữ: Thay đổi ngôn ngữ mà trình duyệt báo cáo.
      locale: "en-US", // Ví dụ: 'en-US', 'vi-VN', 'fr-FR'

      // Múi giờ: Quan trọng để khớp với IP hoặc địa lý mong muốn.
      timezoneId: "America/New_York", // Ví dụ: 'Asia/Ho_Chi_Minh', 'Europe/London'

      // Geolocation: Tọa độ địa lý (cần cờ --use-fake-location cho Chromium để hoạt động)
      geolocation: {
        latitude: 34.052235,
        longitude: -118.243683,
        accuracy: 20,
      }, // Los Angeles

      // Proxy: Cấu hình proxy riêng cho từng profile (nếu bạn có proxy)
      // Cấu trúc có thể là { server: 'http://ip:port', username: 'user', password: 'password' }
      proxy: null, // Mặc định là null, bạn có thể chỉnh sửa trong config.json

      // Các thông số khác mà Playwright có thể điều khiển trực tiếp
      acceptDownloads: true, // Cho phép tải xuống

      // Các cờ CLI cho Chromium: Ảnh hưởng đến hành vi cấp thấp hơn
      // Đây là một mảng string, mỗi phần tử là một cờ CLI.
      chromiumArgs: [
        "--no-sandbox", // Luôn nên có khi chạy với root hoặc trong môi trường docker
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // Hữu ích cho môi trường Linux/Docker
        "--disable-accelerated-2d-canvas", // Có thể ảnh hưởng đến Canvas fingerprinting
        "--disable-gpu", // Vô hiệu hóa GPU, ảnh hưởng đến WebGL
        "--use-fake-location", // Quan trọng cho Geolocation giả mạo
        // '--blink-settings=imagesEnabled=false', // Tắt hình ảnh (ví dụ)
        // '--enable-features=NetworkServiceInProcess', // Giảm thiểu rò rỉ WebRTC
        // '--use-fake-ui-for-media-stream', // Để tránh popup camera/mic
        // '--use-fake-device-for-media-stream', // Sử dụng thiết bị giả cho media stream
        // '--window-size=1366,768', // Kích thước cửa sổ cũng có thể đặt ở đây hoặc qua viewport
      ],

      // Các script JavaScript để tiêm vào mọi trang để spoofing các API DOM
      // Đây là mảng các chuỗi code JavaScript hoặc đường dẫn đến file JS
      initScripts: [
        // Ghi đè navigator.webdriver để ẩn việc là bot
        `Object.defineProperty(navigator, 'webdriver', { get: () => false });`,
        // Ghi đè các hàm để spoofing Canvas API (đây chỉ là ví dụ đơn giản)
        // Cần phức tạp hơn để thực sự hiệu quả.
        `
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function() {
            console.log('Spoofing Canvas toDataURL!');
            // Thêm nhiễu hoặc thay đổi dữ liệu canvas ở đây
            return originalToDataURL.apply(this, arguments); // Vẫn gọi hàm gốc
        };
        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
            const context = originalGetContext.apply(this, arguments);
            if (contextType === 'webgl' || contextType === 'webgl2') {
                // Có thể spoof các hàm của WebGL context ở đây
                // Ví dụ: context.getParameter = (param) => { if (param === context.RENDERER) return 'WebGL Renderer (spoofed)'; return originalGetParameter.call(context, param); };
            }
            return context;
        };
        `,
        // Thêm script để spoof WebGL, AudioContext, Fonts, v.v. tại đây
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
    const profilePath = path.join(PROFILES_DIR, profileName);
    const userDataDir = path.join(profilePath, "user-data");
    const configFile = path.join(profilePath, "config.json");

    if (
      !fs.existsSync(profilePath) ||
      !fs.existsSync(userDataDir) ||
      !fs.existsSync(configFile)
    ) {
      return {
        success: false,
        message: `Profile '${profileName}' not found or incomplete.`,
      };
    }

    try {
      const profileConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));

      // Các tùy chọn khởi chạy Persistent Context
      const launchOptions = {
        headless: false, // Mở trình duyệt có giao diện
        // Áp dụng các cờ CLI từ cấu hình profile
        args: profileConfig.chromiumArgs || [],
        // Cấu hình Proxy nếu có
        proxy: profileConfig.proxy || undefined,
        // Áp dụng User Agent từ cấu hình profile
        userAgent: profileConfig.userAgent || undefined,
        // Áp dụng Locale (ngôn ngữ)
        locale: profileConfig.locale || undefined,
        // Áp dụng Múi giờ
        timezoneId: profileConfig.timezoneId || undefined,
        // Cho phép tải xuống
        acceptDownloads: profileConfig.acceptDownloads,

        // Geolocation được đặt trực tiếp ở context level khi khởi tạo
        // Đảm bảo `--use-fake-location` có trong profileConfig.chromiumArgs để cái này hoạt động
        ...(profileConfig.geolocation &&
          profileConfig.geolocation.latitude !== undefined && {
            geolocation: profileConfig.geolocation,
          }),
        // Thêm các thông số khác có thể cấu hình trực tiếp ở context level
      };

      const browserContext = await chromium.launchPersistentContext(
        userDataDir,
        launchOptions
      );

      // Tạo một trang mới trong ngữ cảnh này
      const page = await browserContext.newPage();

      // Áp dụng Viewport nếu có trong cấu hình
      if (
        profileConfig.viewport &&
        profileConfig.viewport.width &&
        profileConfig.viewport.height
      ) {
        await page.setViewportSize(profileConfig.viewport);
      }

      // Tiêm các script khởi tạo nếu có trong cấu hình
      if (
        profileConfig.initScripts &&
        Array.isArray(profileConfig.initScripts)
      ) {
        for (const scriptContent of profileConfig.initScripts) {
          await page.addInitScript({ content: scriptContent });
        }
      }

      // KHÔNG CẦN GỌI page.setGeolocation NỮA VÌ ĐÃ ĐƯỢC ĐẶT TRONG launchPersistentContext
      // if (profileConfig.geolocation && profileConfig.geolocation.latitude !== undefined) {
      //     await page.setGeolocation(profileConfig.geolocation); // Dòng này gây lỗi
      // }

      await page.goto(url);

      // Xử lý khi trình duyệt đóng (để giải phóng tài nguyên)
      browserContext.on("close", () => {
        console.log(`Browser context for profile '${profileName}' closed.`);
      });

      return {
        success: true,
        message: `Browser for profile '${profileName}' opened.`,
      };
    } catch (error) {
      console.error("Error opening browser:", error);
      return {
        success: false,
        message: `Failed to open browser: ${error.message}`,
      };
    }
  }
);
