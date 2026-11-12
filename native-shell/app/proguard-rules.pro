# 本轮 assembleRelease 关闭 minify（isMinifyEnabled = false），本文件仅作占位。
# 若后续开启代码混淆，必须保留 @JavascriptInterface 桥方法，否则 window.TurnloomNative 会失效：
# -keepclassmembers class com.codex.turnloom.app.MainActivity$NativeBridge {
#     @android.webkit.JavascriptInterface <methods>;
# }
