# APK 签名材料

这个目录让**任何一台电脑**都能打出与线上包同签名、可直接覆盖升级的 APK。

## 里面有什么

| 文件 | 说明 |
|---|---|
| `turnloom-debug.keystore.enc` | 签名密钥库的**加密副本**（AES-256-CBC + PBKDF2-SHA256 200000 轮） |
| `restore-signing.ps1` | 在新机器上还原密钥库到 `%USERPROFILE%\.android\debug.keystore` |
| `encrypt-signing.ps1` | 反向操作，只在签名材料更换时才用 |

本仓库是 **public**，所以密钥库只以密文形式入库；口令不进仓库，由你本人保管。
明文密钥（`*.keystore` / `*.jks` / `keystore.properties`）已在仓库 `.gitignore` 里，不会被误提交。

## 关键身份（升级兼容就靠它）

| 项 | 值 |
|---|---|
| Key alias | `androiddebugkey` |
| Store / key 口令 | `android` / `android`（Android 调试密钥的标准口令） |
| 证书 SHA-256 | `2F:EB:63:C5:11:CD:72:57:95:CA:DC:8F:A8:90:F9:CB:C7:54:FE:59:C0:BB:FE:07:87:AC:33:F9:4F:44:FA:9C` |
| 明文 keystore SHA-256 | `329ffaae95367d9c9685ec39f657a495d811fe694175009f8845930b59365802` |

线上 2.1.3 ~ 2.1.7 都是这个证书签的；换证书装不上（`INSTALL_FAILED_UPDATE_INCOMPATIBLE`），
只能卸载重装，所以**必须在每台机器上还原同一份密钥库**。

## 在新电脑上出包（三步）

```powershell
git clone https://github.com/736368217/Codex-Turnloom.git
cd Codex-Turnloom

# 1) 还原签名密钥（会提示输入口令，口令向我要，不在仓库里）
powershell -NoProfile -ExecutionPolicy Bypass -File native-shell\signing\restore-signing.ps1
#    输出里应看到 sha256 = 329ffaae…；证书应为 2F:EB:63:C5…

# 2) 构建（口令传环境变量，不要写在命令行里）
$env:TURNLOOM_STORE_PASS="android"; $env:TURNLOOM_KEY_PASS="android"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-single-app.ps1 -OutDir .\dist-app

# 3) 自检：证书必须与上表一致
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs .\dist-app\Codex-Turnloom-<版本>-app.apk
```

构建脚本现在会自动校验证书指纹：不一致直接失败，避免"打出来了但装不上"。

## 换机器时的常见坑

- **keystore 路径**：构建脚本优先读 `$env:TURNLOOM_KEYSTORE`，否则用 `%USERPROFILE%\.android\debug.keystore`。
- **别用别的机器自带的 debug.keystore**：每台机器自动生成的 debug 证书都不一样，签出来装不上。
- **版本号必须递增**：`native-shell/app/build.gradle.kts` 的 `versionCode` 要大于线上包。
- **口令不要写进 `.ps1` / `.md` / 命令行**：本仓库 public，写进去等于公开私钥。
