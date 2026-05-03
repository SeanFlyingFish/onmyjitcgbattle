import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { resolve } from "path";
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
export class AuthManager {
    accounts = new Map();
    filePath;
    adminPassword;
    adminWsSet = new Set();
    constructor(filePath) {
        this.filePath = filePath ?? process.env.ACCOUNTS_FILE_PATH ?? "/data/accounts.json";
        this.adminPassword = process.env.ADMIN_PASSWORD ?? "admin123";
        this.loadFromFile();
    }
    register(name, password) {
        if (this.accounts.has(name))
            return null;
        const playerId = this.generatePlayerId();
        const { salt, hash } = this.hashPassword(password);
        const account = { playerId, name, passwordHash: hash, salt, plainPassword: password };
        this.accounts.set(name, account);
        this.saveToFile();
        return { playerId, name };
    }
    /** 查找账号（供内部使用） */
    getAccount(name) {
        return this.accounts.get(name);
    }
    login(name, password) {
        const account = this.accounts.get(name);
        if (!account)
            return null;
        const hash = this.hashPasswordWithSalt(password, account.salt);
        if (timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(account.passwordHash, "hex"))) {
            return { playerId: account.playerId, name: account.name };
        }
        return null;
    }
    adminAuth(password) {
        return password === this.adminPassword;
    }
    addAdminWs(ws) {
        this.adminWsSet.add(ws);
    }
    removeAdminWs(ws) {
        this.adminWsSet.delete(ws);
    }
    isAdminWs(ws) {
        return this.adminWsSet.has(ws);
    }
    listAccounts() {
        return [...this.accounts.values()].map(({ playerId, name }) => ({ playerId, name }));
    }
    deleteAccount(name) {
        const result = this.accounts.delete(name);
        if (result)
            this.saveToFile();
        return result;
    }
    resetPassword(name, newPassword) {
        const account = this.accounts.get(name);
        if (!account)
            return false;
        const { salt, hash } = this.hashPassword(newPassword);
        account.passwordHash = hash;
        account.salt = salt;
        account.plainPassword = newPassword;
        this.accounts.set(name, account);
        this.saveToFile();
        return true;
    }
    hashPassword(password) {
        const salt = randomBytes(SALT_LENGTH).toString("hex");
        const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
        return { salt, hash };
    }
    hashPasswordWithSalt(password, salt) {
        return scryptSync(password, salt, KEY_LENGTH).toString("hex");
    }
    generatePlayerId() {
        return randomBytes(8).toString("hex");
    }
    loadFromFile() {
        try {
            // 如果是Railway环境且文件不存在，尝试从项目根目录复制预设文件
            if (!existsSync(this.filePath)) {
                const presetPath = resolve(process.cwd(), "accounts.json");
                if (existsSync(presetPath)) {
                    copyFileSync(presetPath, this.filePath);
                    console.log(`[AuthManager] Copied preset accounts.json to ${this.filePath}`);
                }
                else {
                    writeFileSync(this.filePath, "[]", "utf-8");
                }
            }
            const content = readFileSync(this.filePath, "utf-8");
            const entries = JSON.parse(content);
            for (const entry of entries) {
                // 检查密码格式：如果是 [hashed:<salt>:<hash> 格式，直接加载
                const hashMatch = entry.password.match(/^\[hashed:(.+):(.+)\]$/);
                if (hashMatch) {
                    // 已哈希的密码
                    this.accounts.set(entry.name, {
                        playerId: entry.playerId || this.generatePlayerId(),
                        name: entry.name,
                        passwordHash: hashMatch[2],
                        salt: hashMatch[1]
                    });
                }
                else {
                    // 明文密码，需要哈希
                    const { salt, hash } = this.hashPassword(entry.password);
                    this.accounts.set(entry.name, {
                        playerId: entry.playerId || this.generatePlayerId(),
                        name: entry.name,
                        passwordHash: hash,
                        salt,
                        plainPassword: entry.password // 保留明文以便下次保存时转换格式
                    });
                }
            }
            // 如果有明文密码的账号，立即保存为哈希格式
            const needsReSave = [...this.accounts.values()].some(acc => acc.plainPassword);
            if (needsReSave) {
                this.saveToFile();
            }
            console.log(`[AuthManager] Loaded ${this.accounts.size} accounts`);
        }
        catch (error) {
            console.error("[AuthManager] Failed to load accounts:", error);
        }
    }
    saveToFile() {
        try {
            const entries = [];
            for (const account of this.accounts.values()) {
                // 保存时可以选择保存明文或哈希后的密码
                // 为了安全性和一致性，我们保存哈希后的格式
                entries.push({
                    playerId: account.playerId,
                    name: account.name,
                    // 密码格式："[hashed:<salt>:<hash>]"
                    password: `[hashed:${account.salt}:${account.passwordHash}]`
                });
            }
            writeFileSync(this.filePath, JSON.stringify(entries, null, 2), "utf-8");
        }
        catch (error) {
            console.error("[AuthManager] Failed to save accounts:", error);
        }
    }
}
