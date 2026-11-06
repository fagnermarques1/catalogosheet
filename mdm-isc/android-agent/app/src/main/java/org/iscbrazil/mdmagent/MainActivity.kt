package org.iscbrazil.mdmagent

import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

/**
 * Activity de kiosk da ISC.
 *
 * Estratégia: hospeda um WebView em tela cheia que carrega o AGENTE WEB servido
 * pelo servidor central (SERVER_URL + "/agent/?auto=1"). Assim, signage (DMS),
 * PA System e heartbeat reusam 100% o código web já testado — e funciona igual
 * em qualquer painel. O que o WebView não pode fazer (reboot, volume do sistema,
 * kiosk/lock task, abrir outro app) é exposto pela ponte [AndroidNative], que só
 * tem poder de verdade quando o app é Device Owner.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var dpm: DevicePolicyManager
    private lateinit var admin: ComponentName

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        admin = ComponentName(this, AgentDeviceAdminReceiver::class.java)

        // mantém a tela sempre ligada
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage p/ guardar deviceId/token
            mediaPlaybackRequiresUserGesture = false  // PA toca sem gesto (estamos em kiosk)
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }
        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(AndroidNative(), "AndroidNative")

        // ?auto=1 pula o gate de clique; name/model/group viram identidade da tela
        val url = BuildConfig.SERVER_URL + "/agent/?auto=1" +
            "&model=" + android.net.Uri.encode(Build.MODEL ?: "Android") +
            "&name=" + android.net.Uri.encode(deviceLabel())
        webView.loadUrl(url)

        enterKioskIfOwner()
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
    }

    private fun deviceLabel(): String {
        // nome amigável; em produção venha de um provisionamento (QR/serial)
        return (Build.MODEL ?: "Tela") + "-" + (Build.SERIAL ?: "")
    }

    /** Modo imersivo (esconde barras de status/navegação). */
    private fun hideSystemUi() {
        @Suppress("DEPRECATION")
        webView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    /** Ativa o lock task (kiosk) se este app for Device Owner. */
    private fun enterKioskIfOwner() {
        if (dpm.isDeviceOwnerApp(packageName)) {
            dpm.setLockTaskPackages(admin, arrayOf(packageName))
            try { startLockTask() } catch (_: Exception) {}
        }
    }

    // bloqueia botão voltar (parte do kiosk)
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { /* no-op */ }

    /**
     * Ponte JS -> Android. Chamada pelo agente web (window.AndroidNative.*).
     * Só executa ações privilegiadas se o app for Device Owner.
     */
    inner class AndroidNative {

        @JavascriptInterface
        fun reboot() {
            runOnUiThread {
                if (dpm.isDeviceOwnerApp(packageName)) {
                    try { dpm.reboot(admin) } catch (_: Exception) {}
                }
            }
        }

        @JavascriptInterface
        fun setVolume(percent: Int) {
            val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val v = (max * percent / 100).coerceIn(0, max)
            am.setStreamVolume(AudioManager.STREAM_MUSIC, v, 0)
        }

        @JavascriptInterface
        fun setScreen(on: Boolean) {
            // Backlight real do painel é específico de fabricante (ex.: Samsung Knox / MDM SDK).
            // Aqui fazemos o possível com API padrão: trava/desperta.
            runOnUiThread {
                if (!on && dpm.isDeviceOwnerApp(packageName)) {
                    try { dpm.lockNow() } catch (_: Exception) {}
                } else {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }

        @JavascriptInterface
        fun launchApp(pkg: String) {
            val intent = packageManager.getLaunchIntentForPackage(pkg) ?: return
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        }

        @JavascriptInterface
        fun relaunch() {
            runOnUiThread { webView.reload() }
        }
    }
}
