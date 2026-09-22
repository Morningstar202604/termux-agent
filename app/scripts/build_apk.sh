#!/usr/bin/env bash
# 在 PC 上构建安卓 APK（Termux Agent 前端）
# 依赖：自动安装 JDK + Android SDK + Flutter
set -euo pipefail

cd "$(dirname "$0")/.."

# 1. 安装 Java (JDK 17)
if ! command -v java >/dev/null 2>&1; then
  echo "==> 安装 OpenJDK 17..."
  apt-get install -y openjdk-17-jdk
fi

# 2. 安装 Android SDK cmdline-tools
SDK_ROOT="${ANDROID_HOME:-$HOME/Android/sdk}"
if [ ! -d "$SDK_ROOT/platforms" ]; then
  echo "==> 安装 Android cmdline-tools..."
  CMDLINE="$SDK_ROOT/cmdline-tools"
  mkdir -p "$CMDLINE"
  curl -fsSL -o /tmp/cmdtools.zip \
    https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip
  cd /tmp && unzip -q -o cmdtools.zip -d "$CMDLINE"
  mv "$CMDLINE/cmdline-tools" "$CMDLINE/latest"
fi

export ANDROID_HOME="$SDK_ROOT"
export PATH="$SDK_ROOT/cmdline-tools/latest/bin:$PATH"

# 接受许可并装组件（无人值守）
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"

cd /workspace/app/android
# 3. 安装 Flutter
if ! command -v flutter >/dev/null 2>&1; then
  echo "==> 安装 Flutter SDK..."
  git clone --depth 1 -b stable https://github.com/flutter/flutter.git "$HOME/flutter"
  export PATH="$HOME/flutter/bin:$PATH"
fi
flutter config --no-analytics >/dev/null 2>&1 || true
flutter precache --android >/dev/null 2>&1 || true

# 4. 构建 APK（debug，可直接 adb 安装；release 需要签名 keystore）
# 先写入低内存 gradle 参数，避免在内存受限的 CI/容器上 OOM
cat > /workspace/app/android/gradle.properties <<'EOF'
org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=512m
org.gradle.parallel=false
org.gradle.caching=false
android.enableJetifier=false
android.useAndroidX=true
kotlin.daemon.jvmargs=-Xmx1g
EOF

cd /workspace/app
flutter pub get
flutter build apk --debug

echo ""
echo "APK 已生成: $(pwd)/build/app/outputs/flutter-apk/app-debug.apk"
echo "安装到手机:  adb install $(pwd)/build/app/outputs/flutter-apk/app-debug.apk"
echo "或把 apk 拷到手机直接安装。"
echo ""
echo "手机侧：先跑 termux/install.sh all 装好 goose + provider，"
echo "启动后在 Termux 里执行:"
echo "  source ~/.agent/termux.env && ~/.local/bin/goose serve --dangerously-unauthenticated"
echo "然后打开本 APK，默认地址 ws://127.0.0.1:3284/acp 即可连接。"
