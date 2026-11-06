package org.iscbrazil.mdmagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Após o reboot da tela, reabre o signage automaticamente. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val launch = Intent(context, MainActivity::class.java)
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(launch)
        }
    }
}
