const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getProfiles: () => ipcRenderer.invoke("get-profiles"),
  createProfile: (profileName) =>
    ipcRenderer.invoke("create-profile", profileName),
  deleteProfile: (profileName) =>
    ipcRenderer.invoke("delete-profile", profileName),
  getProfileConfig: (profileName) =>
    ipcRenderer.invoke("get-profile-config", profileName),
  updateProfileConfig: (profileName, config) =>
    ipcRenderer.invoke("update-profile-config", profileName, config),
  openBrowser: (profileName, url) =>
    ipcRenderer.invoke("open-browser", profileName, url),

  // Các API mới cho Proxy
  getProxies: () => ipcRenderer.invoke("get-proxies"),
  addProxy: (proxyConfig) => ipcRenderer.invoke("add-proxy", proxyConfig),
  updateProxy: (oldName, newConfig) =>
    ipcRenderer.invoke("update-proxy", oldName, newConfig),
  deleteProxy: (proxyName) => ipcRenderer.invoke("delete-proxy", proxyName),
});
