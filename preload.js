const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Các hàm liên quan đến Profile
  getProfiles: () => ipcRenderer.invoke("get-profiles"),
  // === THAY ĐỔI Ở ĐÂY: Gửi một đối tượng thay vì chuỗi ===
  createProfile: (profileData) =>
    ipcRenderer.invoke("create-profile", profileData),
  deleteProfile: (profileName) =>
    ipcRenderer.invoke("delete-profile", profileName),
  getProfileConfig: (profileName) =>
    ipcRenderer.invoke("get-profile-config", profileName),
  updateProfileConfig: (profileName, config) =>
    ipcRenderer.invoke("update-profile-config", profileName, config),
  openBrowser: (profileName, url) =>
    ipcRenderer.invoke("open-browser", profileName, url),

  // Các hàm liên quan đến Proxy (Không thay đổi)
  getProxies: () => ipcRenderer.invoke("get-proxies"),
  addProxy: (proxyConfig) => ipcRenderer.invoke("add-proxy", proxyConfig),
  updateProxy: (oldName, newConfig) =>
    ipcRenderer.invoke("update-proxy", oldName, newConfig),
  deleteProxy: (proxyName) => ipcRenderer.invoke("delete-proxy", proxyName),
});
