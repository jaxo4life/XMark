// 加密工具类
export class CryptoUtils {
  constructor() {
    this.algorithm = "AES-GCM";
    this.keyLength = 256;
  }

  // 生成加密密钥
  async generateKey() {
    return await crypto.subtle.generateKey(
      {
        name: this.algorithm,
        length: this.keyLength,
      },
      true, // 可导出
      ["encrypt", "decrypt"]
    );
  }

  // 导出密钥为可存储的格式
  async exportKey(key) {
    const exported = await crypto.subtle.exportKey("raw", key);
    return Array.from(new Uint8Array(exported));
  }

  // 从存储格式导入密钥
  async importKey(keyData) {
    const keyBuffer = new Uint8Array(keyData);
    return await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      {
        name: this.algorithm,
        length: this.keyLength,
      },
      true,
      ["encrypt", "decrypt"]
    );
  }

  // 加密文本
  async encrypt(text, key) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    // 生成随机IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      {
        name: this.algorithm,
        iv: iv,
      },
      key,
      data
    );

    // 返回IV和加密数据的组合
    return {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted)),
    };
  }

  // 解密文本
  async decrypt(encryptedData, key) {
    const iv = new Uint8Array(encryptedData.iv);
    const data = new Uint8Array(encryptedData.data);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: this.algorithm,
        iv: iv,
      },
      key,
      data
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  // 获取或创建主密钥
  async getMasterKey() {
    try {
      // 尝试从存储中获取密钥
      const result = await chrome.storage.local.get(["masterKey"]);

      if (result.masterKey) {
        return await this.importKey(result.masterKey);
      } else {
        // 生成新密钥
        const key = await this.generateKey();
        const exportedKey = await this.exportKey(key);

        // 保存密钥
        await chrome.storage.local.set({ masterKey: exportedKey });

        return key;
      }
    } catch (error) {
      console.error("获取主密钥失败:", error);
      throw error;
    }
  }

  // 加密WebDAV配置
  async encryptWebDAVConfig(config, chrome) {
    const key = await this.getMasterKey(chrome);

    const encryptedConfig = {
      url: config.url, // URL不加密，便于调试
      username: config.username, // 用户名不加密
      password: null, // 密码加密
      encrypted: true, // 标记为已加密
    };

    if (config.password) {
      encryptedConfig.password = await this.encrypt(config.password, key);
    }

    return encryptedConfig;
  }

  // 解密WebDAV配置
  async decryptWebDAVConfig(encryptedConfig, chrome) {
    if (!encryptedConfig.encrypted) {
      // 如果不是加密的配置，直接返回
      return encryptedConfig;
    }

    const key = await this.getMasterKey(chrome);

    const config = {
      url: encryptedConfig.url,
      username: encryptedConfig.username,
      password: "",
    };

    if (encryptedConfig.password) {
      try {
        config.password = await this.decrypt(encryptedConfig.password, key);
      } catch (error) {
        console.error("解密密码失败:", error);
        // 如果解密失败，返回空密码
        config.password = "";
      }
    }

    return config;
  }
}

// 创建全局实例
export const cryptoUtils = new CryptoUtils();
