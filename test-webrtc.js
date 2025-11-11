// test-webrtc-chrome.js
const { chromium } = require("playwright");

async function runTest() {
  console.log("=============================================");
  console.log("== BẮT ĐẦU BÀI TEST VỚI GOOGLE CHROME CÓ SẴN ==");
  console.log("=============================================");

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      // Yêu cầu Playwright sử dụng Google Chrome đã cài đặt trên máy bạn
      channel: "chrome",
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
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

runTest();
