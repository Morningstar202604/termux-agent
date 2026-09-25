/* 口袋 Agent · Android WebView 壳
 *
 * 作用：一个极轻的原生壳，启动即全屏加载本机 agentd 服务
 * （http://127.0.0.1:8787，Termux 里运行）。不内嵌任何业务代码、
 * 不引 Capacitor/Flutter，业务全部由 Web UI 承担。
 *
 * 为什么不直接装 PWA？—— PWA「添加到主屏幕」零构建已满足大部分需求；
 * 这个壳只是给想要独立 APK 的用户一条原生路径，30 行代码。
 */
package com.pocket.agent;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);                 // React 需要
        s.setDomStorageEnabled(true);                 // localStorage（主题/令牌）需要
        s.setMediaPlaybackRequiresUserGesture(false); // TTS/语音
        s.setSupportZoom(false);
        // 本机服务只此一家：页面跳转留在壳内，不抛给系统浏览器
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.loadUrl("http://127.0.0.1:8787");
        setContentView(web);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // 返回键先走页面历史，没有历史再退出壳
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
