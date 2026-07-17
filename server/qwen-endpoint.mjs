export const DEFAULT_QWEN_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export function isApprovedQwenBaseUrl(value = DEFAULT_QWEN_BASE_URL) {
  try {
    const url = new URL(String(value || ""));
    const singaporeWorkspace = /^[a-z0-9][a-z0-9-]*\.ap-southeast-1\.maas\.aliyuncs\.com$/i.test(url.hostname);
    const approvedHost = url.hostname === "dashscope-intl.aliyuncs.com" || singaporeWorkspace;
    return url.protocol === "https:" && approvedHost && url.pathname.replace(/\/$/, "") === "/compatible-mode/v1" && !url.search && !url.username && !url.password;
  } catch { return false; }
}
