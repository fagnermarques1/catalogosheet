package org.iscbrazil.mdmagent

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context

/**
 * Receiver de Device Admin. É o componente que o comando de provisionamento
 * (`adb shell dpm set-device-owner ...`) registra como Device Owner.
 */
class AgentDeviceAdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun componentName(context: Context): ComponentName =
            ComponentName(context.applicationContext, AgentDeviceAdminReceiver::class.java)
    }
}
