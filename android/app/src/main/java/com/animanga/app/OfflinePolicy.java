package com.animanga.app;

/** Offline rule: manual toggle wins; otherwise auto-offline when WiFi is gone (if enabled). */
public final class OfflinePolicy {
    private OfflinePolicy() {}

    // ponytail: single boolean expression, not a state machine.
    public static boolean isOffline(boolean manualOffline, boolean autoOnNoWifi, boolean wifiConnected) {
        if (manualOffline) return true;
        return autoOnNoWifi && !wifiConnected;
    }
}
