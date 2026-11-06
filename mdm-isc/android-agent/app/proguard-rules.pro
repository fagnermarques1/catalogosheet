# Mantém a ponte JavascriptInterface (nomes usados pelo agente web via window.AndroidNative)
-keepclassmembers class org.iscbrazil.mdmagent.MainActivity$AndroidNative {
    @android.webkit.JavascriptInterface <methods>;
}
