// test-webrtc-final.js
const chromium = require("@sparticuz/chromium-min");
const { chromium: playwright } = require("playwright-core");

async function runFinalTest() {
  console.log("=============================================");
  console.log("== BẮT ĐẦU BÀI TEST CUỐI CÙNG VỚI CHROMIUM-MIN ==");
  console.log("=============================================");

  let browser;
  try {
    // Lấy đường dẫn thực thi từ @sparticuz/chromium-min
    const executablePath = await chromium.executablePath();

    // Khởi chạy trình duyệt bằng playwright-core
    browser = await playwright.launch({
      // Sử dụng trình duyệt đã được tối ưu hóa
      executablePath: executablePath,
      headless: false,
      // Thêm các cờ mặc định của chromium-min, trong đó đã có sẵn các cờ chống rò rỉ
      args: chromium.args,
    });

    const page = await browser.newPage();

    console.log(
      "\n[INFO] Đang điều hướng đến https://browserleaks.com/webrtc..."
    );
    await page.goto("https://browserleaks.com/webrtc");

    console.log("[INFO] Trang đã tải xong. Vui lòng kiểm tra kết quả.");
    console.log("[ACTION] Trình duyệt sẽ tự đóng sau 60 giây...");

    await page.waitForTimeout(60000);
  } catch (error) {
    console.error("\n[LỖI] Đã có lỗi xảy ra:", error);
  } finally {
    if (browser) {
      await browser.close();
      console.log("\n[INFO] Đã đóng trình duyệt.");
    }
  }
}

runFinalTest();
